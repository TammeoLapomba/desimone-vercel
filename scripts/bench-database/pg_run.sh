#!/bin/zsh
# uso: pg_run.sh <db> <N>
P=${PGBIN:-$(dirname $(command -v pgbench))}; D=${0:A:h}/pgbench; DB=$1; N=$2
run() { # nome secondi client
  out=$($P/pgbench -h localhost -p 55432 -U postgres -n -D N=$N -f $D/$1.sql -T $2 -c $3 -j $3 $DB 2>&1)
  lat=$(echo "$out" | grep "latency average" | awk '{print $4}'); tps=$(echo "$out" | grep "^tps" | awk '{print $3}')
  printf "%-8s c=%-2s lat_ms=%-9s tps=%s\n" $1 $3 $lat $tps
}
for q in sku list mov rare count; do run $q 10 1; done
run common 20 1
run report 20 1
for q in sale edit ins; do run $q 10 1; done
echo "-- concorrenza: 8 utenti, mix realistico"
out=$($P/pgbench -h localhost -p 55432 -U postgres -n -D N=$N -f $D/sku.sql@45 -f $D/list.sql@15 -f $D/rare.sql@10 -f $D/mov.sql@10 -f $D/sale.sql@15 -f $D/ins.sql@5 -T 30 -c 8 -j 4 -r $DB 2>&1)
echo "$out" | grep -E "latency average|^tps|SQL script|latency stddev"
echo "-- ricerca testuale SENZA indice trigram (scansione completa)"
$P/psql -h localhost -p 55432 -U postgres -d $DB -Atq <<SQL
SET enable_bitmapscan = off;
\timing on
SELECT count(*) FROM (SELECT sku FROM articles WHERE name ILIKE '%' || upper(substr(md5('777'),1,6)) || '%' LIMIT 50) s;
SELECT count(*) FROM (SELECT sku FROM articles WHERE name ILIKE '%' || upper(substr(md5('778'),1,6)) || '%' LIMIT 50) s;
SELECT count(*) FROM (SELECT sku FROM articles WHERE name ILIKE '%corallo rosa%' AND name ILIKE '%goccia%' AND status='attivo' ORDER BY updated_at DESC LIMIT 50) s;
SQL
