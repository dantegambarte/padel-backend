#!/bin/bash
# ══════════════════════════════════════════════════════
#  Restore a backup made by scripts/backup-db.sh
#
#  Usage:
#    bash scripts/restore-db.sh <file.dump> <target-database>
#
#  The target database must already exist and be EMPTY; the script refuses
#  to restore over existing tables. Connection values come from APP_DIR/.env
#  (DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD) or the environment.
#  Full procedure: README → "Backups y restauración".
# ══════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

fail() {
  echo "restore error: $1" >&2
  exit 1
}

env_value() {
  local key="$1"
  [ -f "$APP_DIR/.env" ] || return 0
  { grep -E "^${key}=" "$APP_DIR/.env" || true; } | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/\r$//'
}

[ $# -eq 2 ] || fail "usage: bash scripts/restore-db.sh <file.dump> <target-database>"
DUMP="$1"
TARGET_DB="$2"
[ -f "$DUMP" ] || fail "dump $DUMP not found."

DB_HOST="${DB_HOST:-$(env_value DB_HOST)}"
DB_PORT="${DB_PORT:-$(env_value DB_PORT)}"
DB_PORT="${DB_PORT:-5432}"
DB_USERNAME="${DB_USERNAME:-$(env_value DB_USERNAME)}"
DB_PASSWORD="${DB_PASSWORD:-$(env_value DB_PASSWORD)}"
[ -n "$DB_HOST" ] && [ -n "$DB_USERNAME" ] || fail "DB_HOST and DB_USERNAME must be set."

export PGPASSWORD="$DB_PASSWORD"
PSQL=(psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USERNAME" --dbname="$TARGET_DB" -v ON_ERROR_STOP=1 -tA)

TABLES="$("${PSQL[@]}" -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" ||
  fail "cannot connect to database $TARGET_DB (create it first: createdb $TARGET_DB)."
[ "$TABLES" = "0" ] || fail "database $TARGET_DB already has $TABLES tables; restore only into an empty database."

pg_restore --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USERNAME" \
  --dbname="$TARGET_DB" --no-owner --no-privileges --exit-on-error "$DUMP"

echo "restored $DUMP into $TARGET_DB"
echo "migrations recorded: $("${PSQL[@]}" -c 'SELECT count(*) FROM typeorm_migrations')"
