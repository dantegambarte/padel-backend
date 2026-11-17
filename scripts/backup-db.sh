#!/bin/bash
# ══════════════════════════════════════════════════════
#  PostgreSQL backup (pg_dump custom format) with rotation
#
#  Usage on the server:
#    bash scripts/backup-db.sh
#
#  Daily cron example (03:30, as the deploy user):
#    30 3 * * * bash /home/deploy/padel-backend/scripts/backup-db.sh >> /home/deploy/backups/backup.log 2>&1
#
#  Connection values come from APP_DIR/.env (DB_HOST, DB_PORT, DB_USERNAME,
#  DB_PASSWORD, DB_DATABASE); variables already set in the environment win.
#
#  Settings (environment):
#    APP_DIR                 repository checkout   (default: the repo containing this script)
#    BACKUP_DIR              local destination     (default: $HOME/backups/padelsys)
#    BACKUP_RETENTION_DAYS   local dumps to keep   (default: 14)
#    BACKUP_LABEL            filename suffix       (default: daily)
#    BACKUP_OFFSITE_REMOTE   rclone destination for the off-server copy,
#                            e.g. "b2:padelsys-backups" (default: empty = skipped)
#
#  Prints the path of the new dump on the last line of stdout.
# ══════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/padelsys}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_LABEL="${BACKUP_LABEL:-daily}"
BACKUP_OFFSITE_REMOTE="${BACKUP_OFFSITE_REMOTE:-}"

fail() {
  echo "backup error: $1" >&2
  exit 1
}

# Reads KEY from .env without executing the file.
env_value() {
  local key="$1"
  [ -f "$APP_DIR/.env" ] || return 0
  { grep -E "^${key}=" "$APP_DIR/.env" || true; } | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/\r$//'
}

DB_HOST="${DB_HOST:-$(env_value DB_HOST)}"
DB_PORT="${DB_PORT:-$(env_value DB_PORT)}"
DB_PORT="${DB_PORT:-5432}"
DB_USERNAME="${DB_USERNAME:-$(env_value DB_USERNAME)}"
DB_PASSWORD="${DB_PASSWORD:-$(env_value DB_PASSWORD)}"
DB_DATABASE="${DB_DATABASE:-$(env_value DB_DATABASE)}"

[ -n "$DB_HOST" ] && [ -n "$DB_USERNAME" ] && [ -n "$DB_DATABASE" ] ||
  fail "DB_HOST, DB_USERNAME and DB_DATABASE must be set (APP_DIR/.env or environment)."
command -v pg_dump > /dev/null 2>&1 || fail "pg_dump is not installed (apt install postgresql-client)."
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$BACKUP_RETENTION_DAYS" -ge 1 ] ||
  fail "BACKUP_RETENTION_DAYS must be a positive integer."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/${DB_DATABASE}_${STAMP}_${BACKUP_LABEL}.dump"
TMP_FILE="$FILE.partial"

# Write to a temp name first so a failed dump never looks like a valid backup.
trap 'rm -f "$TMP_FILE"' EXIT
PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USERNAME" \
  --format=custom --no-owner --no-privileges \
  --file="$TMP_FILE" "$DB_DATABASE"

# A dump pg_restore cannot list is corrupt.
pg_restore --list "$TMP_FILE" > /dev/null || fail "pg_restore cannot read the new dump."
mv "$TMP_FILE" "$FILE"
chmod 600 "$FILE"
echo "dump written: $FILE ($(du -h "$FILE" | cut -f1))" >&2

if [ -n "$BACKUP_OFFSITE_REMOTE" ]; then
  command -v rclone > /dev/null 2>&1 || fail "BACKUP_OFFSITE_REMOTE is set but rclone is not installed."
  rclone copy "$FILE" "$BACKUP_OFFSITE_REMOTE" || fail "off-server copy to $BACKUP_OFFSITE_REMOTE failed."
  echo "off-server copy: $BACKUP_OFFSITE_REMOTE" >&2
else
  echo "warning: BACKUP_OFFSITE_REMOTE is empty, the dump only exists on this server." >&2
fi

# Rotation: only local dumps of this database older than the retention window.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_DATABASE}_*.dump" \
  -mtime "+$((BACKUP_RETENTION_DAYS - 1))" -print -delete >&2

echo "$FILE"
