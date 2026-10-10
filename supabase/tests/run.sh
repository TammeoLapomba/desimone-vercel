#!/usr/bin/env bash
# supabase/tests/run.sh — Prova le migrazioni su un PostgreSQL 17 vuoto, come quello del PC server (D-1).
#
# Avvia un contenitore usa e getta, esegue il minimo di Supabase che serve alle migrazioni 001–021
# (tests/supabase_stub.sql), tutte le migrazioni in ordine e poi le prove della 022.
# Serve Docker (OrbStack sul Mac). Il contenitore si cancella alla fine, anche se una prova fallisce.
#
# Uso: supabase/tests/run.sh

set -euo pipefail
cd "$(dirname "$0")/.."

NAME=desimone-prova-pg
IMAGE=postgres:17

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" -c wal_level=logical >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

# Il server temporaneo dell'inizializzazione ascolta solo sul socket: via TCP risponde quello definitivo
until docker exec "$NAME" psql -h 127.0.0.1 -U postgres -qtAc 'SELECT 1' >/dev/null 2>&1; do sleep 1; done
echo "PostgreSQL $(docker exec "$NAME" psql -h 127.0.0.1 -U postgres -qtAc 'SHOW server_version')"

run() {
  docker exec -i "$NAME" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -q -f - < "$1"
}

run tests/supabase_stub.sql
for f in migrations/0*.sql; do
  # 008 spegneva la sicurezza solo in sviluppo (la 013 la riaccende) e cita raw_photos, che nasce con la 009
  if [ "$f" = migrations/008_dev_rls_bypass.sql ]; then
    continue
  fi
  if [ "$f" = migrations/022_movimenti.sql ]; then
    run tests/prima_della_022.sql
  fi
  echo "migrazione $(basename "$f")"
  run "$f"
done
run tests/022_movimenti_test.sql
