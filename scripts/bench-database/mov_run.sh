#!/usr/bin/env bash
# mov_run.sh — Banco del registro dei movimenti sul modello vero (REQ-I-06, REQ-N-01), su macOS o Linux.
#
# Crea il database $DB (desimone_bench) con le stesse migrazioni della sede (sede/database/00_base_sede.sql,
# supabase/migrations tranne la 008, sede/database/9x), lo riempie con mov_gen.sql e misura con pgbench le
# operazioni del gestionale, con ruolo e token come in PostgREST. Il database della sede ("desimone") non si
# tocca: lo script si rifiuta di usarlo e non cambia ruoli né password.
#
# Uso: scripts/bench-database/mov_run.sh [N gioielli, 10000] [M movimenti per gioiello, 100]
# Variabili: PGHOST (localhost), PGPORT (5432), PGUSER (postgres), PGBIN (cartella di psql e pgbench), DB

set -euo pipefail
N=${1:-10000}; M=${2:-100}
DB=${DB:-desimone_bench}
export PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-postgres}
export PGCLIENTENCODING=UTF8 PGOPTIONS='-c client_min_messages=warning'
P=${PGBIN:-$(dirname "$(command -v psql)")}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd); D=$HERE/pgbench
LOG=$(mktemp -d)
trap 'rm -rf "$LOG"' EXIT

if [ "$DB" = desimone ]; then echo "Il database della sede non si usa per le prove: scegli un altro DB" >&2; exit 1; fi

psql() { "$P/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "== Database $DB: migrazioni della sede"
psql -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB ENCODING 'UTF8' TEMPLATE template0"
for f in "$REPO"/sede/database/00_*.sql "$REPO"/supabase/migrations/0*.sql "$REPO"/sede/database/9*.sql; do
  case "$(basename "$f")" in 008_*) continue ;; esac   # solo per lo sviluppo, come in installa.js
  psql -d "$DB" -f "$f" >/dev/null
done
echo "   ultima migrazione: $(basename "$(ls "$REPO"/supabase/migrations/0*.sql | tail -1)")"

echo "== Dati: $N gioielli, $M movimenti ciascuno"
psql -d "$DB" -v N="$N" -v M="$M" -f "$HERE/mov_gen.sql" | grep -E "gioielli|^ +[0-9]|Time: [0-9]{4,}" || true

PAGINE=$(psql -d "$DB" -tAc "SELECT greatest(1, ceil(count(*) / 1000.0))::int FROM stock_levels")
PREZZO=$(psql -d "$DB" -tAc "SELECT vendita_con_prezzo FROM bench.conf")
VENDITA=$([ "$PREZZO" = t ] && echo mov_vendita_prezzo || echo mov_vendita)

# Percentili dal registro di pgbench (tempo in microsecondi nella terza colonna, script nella quarta)
percentili() { # file del registro, numero dello script
  awk -v s="$2" '$4 == s { print $3 / 1000 }' "$1" | sort -n |
    awk '{ v[NR] = $1 } END { if (NR) printf "p50=%.1f p95=%.1f max=%.1f ms", v[int(NR*0.5)+1], v[int(NR*0.95)+1], v[NR] }'
}

# Un client che riceve un errore (per esempio una giacenza finita) si ferma: lo si dice, e le prove vanno avanti
avvisa() {
  echo "$1" | grep -E "aborted|ERROR" | head -2 | sed 's/^/   ATTENZIONE: /' || true
}

run() { # nome secondi client
  rm -f "$LOG"/pgbench_log.*
  out=$("$P/pgbench" -n -M prepared -D N="$N" -D PAGINE="$PAGINE" -f "$D/$1.sql" -T "$2" -c "$3" -j "$3" \
        --log --log-prefix="$LOG/pgbench_log" "$DB" 2>&1) || true
  avvisa "$out"
  lat=$(echo "$out" | awk '/^latency average/ { print $4 }'); tps=$(echo "$out" | awk '/^tps/ { print $3 }')
  printf "%-20s c=%-2s lat_ms=%-8s tps=%-8.1f %s\n" "$1" "$3" "$lat" "$tps" "$(cat "$LOG"/pgbench_log.* | percentili /dev/stdin 0)"
}

echo "== Un operatore alla volta"
run mov_giacenza 10 1
run mov_storico 10 1
run "$VENDITA" 10 1
run mov_trasferimento 10 1
run mov_articoli 20 1
run mov_giacenze_pagina 20 1
echo "   la schermata Giacenze legge $PAGINE pagine una dopo l'altra: circa $PAGINE × mov_giacenze_pagina"
run mov_giacenze_tutte 20 1

mix() { # titolo, poi coppie script@peso
  local title=$1; shift
  local args=() names=()
  for s in "$@"; do args+=(-f "$D/${s%@*}.sql@${s#*@}"); names+=("${s%@*}"); done
  rm -f "$LOG"/pgbench_log.*
  out=$("$P/pgbench" -n -M prepared -D N="$N" -D PAGINE="$PAGINE" "${args[@]}" -T 30 -c 10 -j 4 \
        --log --log-prefix="$LOG/pgbench_log" "$DB" 2>&1) || true
  avvisa "$out"
  echo "== 10 operatori insieme (REQ-N-01), 30 s: $title"
  echo "$out" | awk '/^latency average/ { printf "   tempo medio: %s ms\n", $4 } /^tps/ { printf "   in tutto: %.0f operazioni/s\n", $3 }'
  cat "$LOG"/pgbench_log.* > "$LOG/tutto"
  for i in "${!names[@]}"; do printf "   %-20s %s\n" "${names[$i]}" "$(percentili "$LOG/tutto" "$i")"; done
}
mix "registrazioni" mov_giacenza@35 mov_storico@25 "$VENDITA@25" mov_trasferimento@15
mix "registrazioni e schermate pesanti" mov_giacenza@33 mov_storico@24 "$VENDITA@24" mov_trasferimento@15 \
  mov_articoli@2 mov_giacenze_pagina@2

psql -d "$DB" -tAc "SELECT '== Alla fine: ' || count(*) || ' movimenti, database di ' || pg_size_pretty(pg_database_size(current_database())) FROM movements"
echo "Per cancellare il database delle prove: psql -d postgres -c 'DROP DATABASE $DB'"
