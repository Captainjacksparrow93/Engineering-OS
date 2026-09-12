#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Engineering OS - Automated Database Backup Script
# Usage: ./scripts/backup.sh
# Suitable for automated cron jobs (e.g. daily at 02:00 AM)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${ROOT_DIR}/backups"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}"

echo "==> [$(date)] Starting Engineering-OS PostgreSQL database backup..."

# Source environment variables if .env exists
if [ -f "${ROOT_DIR}/.env" ]; then
  # export variables from .env
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-engos}"
POSTGRES_DB="${POSTGRES_DB:-engineering_os}"

# Execute pg_dump inside db container and stream compressed to host
docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T db \
  pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${BACKUP_FILE}"

FILESIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
echo "==> [$(date)] Backup completed successfully: ${BACKUP_FILE} (${FILESIZE})"

# Prune backups older than RETENTION_DAYS
echo "==> Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "backup_*.sql.gz" -mtime +"${RETENTION_DAYS}" -exec rm -f {} +
echo "==> Backup maintenance complete."
