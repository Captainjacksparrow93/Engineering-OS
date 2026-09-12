#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Engineering OS - Database Restore Script
# Usage: ./scripts/restore.sh ./backups/backup_YYYYMMDD_HHMMSS.sql.gz
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file '${BACKUP_FILE}' not found!"
  exit 1
fi

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-engos}"
POSTGRES_DB="${POSTGRES_DB:-engineering_os}"

echo "WARNING: This will overwrite the current '${POSTGRES_DB}' database with '${BACKUP_FILE}'."
read -p "Are you sure you want to proceed? (y/N): " -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Restore aborted."
  exit 0
fi

echo "==> Restoring database from ${BACKUP_FILE}..."

# Drop and recreate or pipe into psql
gunzip -c "${BACKUP_FILE}" | docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T db \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

echo "==> Database restore completed successfully."
