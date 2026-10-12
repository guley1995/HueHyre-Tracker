#!/usr/bin/env bash
# Legt eine lokale Testdatenbank an und spielt alle Migrationen ein.
# Nutzung: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/huehyre_test scripts/db-test-reset.sh
set -euo pipefail
URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/huehyre_test}"
DB="${URL##*/}"
ADMIN_URL="${URL%/*}/postgres"
cd "$(dirname "$0")/.."
psql "$ADMIN_URL" -q -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
for f in supabase/tests/bootstrap.sql supabase/migrations/*.sql; do
  PGOPTIONS="-c client_min_messages=warning" psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" \
    || { echo "Fehler in $f"; exit 1; }
done
echo "Testdatenbank $DB bereit."
