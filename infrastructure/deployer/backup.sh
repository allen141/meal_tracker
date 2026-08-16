#!/bin/sh

set -eu

DB_PATH=${DB_PATH:-/var/lib/macroflow/macroflow.db}
BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}

backup_once() {
  test -f "$DB_PATH" || { echo "Database does not exist: $DB_PATH" >&2; return 1; }
  mkdir -p "$BACKUP_DIR"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  temporary="$BACKUP_DIR/macroflow-$stamp.db.tmp"
  final="$BACKUP_DIR/macroflow-$stamp.db"
  sqlite3 "$DB_PATH" ".timeout 10000" ".backup '$temporary'"
  sqlite3 "$temporary" "PRAGMA quick_check;" | grep -Fxq ok
  mv "$temporary" "$final"
  find "$BACKUP_DIR" -type f -name 'macroflow-*.db' -mtime "+$((BACKUP_RETENTION_DAYS - 1))" -delete
  printf '%s\n' "$final"
}

if test "${RUN_ONCE:-0}" = 1; then
  backup_once
  exit
fi

while true; do
  backup_once || true
  sleep "$BACKUP_INTERVAL_SECONDS"
done
