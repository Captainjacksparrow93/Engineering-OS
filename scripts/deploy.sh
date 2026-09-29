#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Engineering OS - Local Image Build & Deploy Script
# Usage: ./scripts/deploy.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

VPS_HOST="${VPS_HOST:-72.62.248.38}"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/root/engos-docker}"
VPS_PORT="${VPS_PORT:-22}"

echo "==> Checking git repository status..."
git fetch origin main

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is dirty. Commit or stash changes before deploying." >&2
  exit 1
fi

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "Error: Local HEAD ($LOCAL_SHA) does not match origin/main ($REMOTE_SHA)." >&2
  echo "Please push your commits to origin/main or pull latest changes before deploying." >&2
  exit 1
fi

echo "==> Deploying commit: ${LOCAL_SHA}"

echo "==> Building Docker image locally (linux/amd64)..."
docker build --platform linux/amd64 -t "engineering-os:${LOCAL_SHA}" .

echo "==> Transferring Docker image to VPS (${VPS_HOST})..."
docker save "engineering-os:${LOCAL_SHA}" | gzip | ssh -p "${VPS_PORT}" "${VPS_USER}@${VPS_HOST}" 'gunzip | docker load'

echo "==> Deploying on VPS..."
REMOTE_EXIT=0
ssh -p "${VPS_PORT}" "${VPS_USER}@${VPS_HOST}" "bash -s -- \"${LOCAL_SHA}\" \"${VPS_DIR}\"" << 'REMOTE_SCRIPT' || REMOTE_EXIT=$?
set -euo pipefail
LOCAL_SHA="$1"
VPS_DIR="$2"
cd "$VPS_DIR"

echo "==> Pulling compose file and scripts on VPS..."
git pull origin main

echo "==> Running database backup on VPS..."
./scripts/backup.sh

if [ -f .deployed-sha ]; then
  cp .deployed-sha .previous-sha
fi

echo "==> Swapping container to engineering-os:${LOCAL_SHA}..."
docker tag "engineering-os:${LOCAL_SHA}" engineering-os:current
APP_IMAGE="engineering-os:${LOCAL_SHA}" docker compose up -d --no-build app
echo "${LOCAL_SHA}" > .deployed-sha

echo "==> Waiting up to 3 minutes for container to become healthy..."
HEALTHY=false
for i in $(seq 1 36); do
  STATUS=$(docker inspect -f '{{.State.Health.Status}}' engos_app 2>/dev/null || true)
  if [ "$STATUS" = "healthy" ]; then
    echo "==> Container is healthy!"
    HEALTHY=true
    break
  fi
  echo "Waiting for health check... ($i/36, status: ${STATUS:-starting})"
  sleep 5
done

if [ "$HEALTHY" != "true" ]; then
  echo "==> Container failed to become healthy. Showing last 150 logs:" >&2
  docker compose logs --tail 150 app >&2
  exit 1
fi

echo "==> Cleaning up older engineering-os images..."
PREV_SHA=""
if [ -f .previous-sha ]; then
  PREV_SHA=$(cat .previous-sha)
fi

for img in $(docker images --format '{{.Repository}}:{{.Tag}}' engineering-os 2>/dev/null || true); do
  tag="${img#engineering-os:}"
  if [ "$tag" = "current" ] || [ "$tag" = "${LOCAL_SHA}" ]; then
    continue
  fi
  if [ -n "$PREV_SHA" ] && [ "$tag" = "$PREV_SHA" ]; then
    continue
  fi
  if [ "$tag" = "<none>" ] || [ -z "$tag" ]; then
    continue
  fi
  echo "Removing old image: $img"
  docker rmi "$img" || true
done
REMOTE_SCRIPT

echo "==> Fetching newest backup from VPS..."
mkdir -p backups
NEWEST_BACKUP="$(ssh -p "${VPS_PORT}" "${VPS_USER}@${VPS_HOST}" "ls -t \"${VPS_DIR}/backups\"/backup_*.sql.gz 2>/dev/null | head -n 1" || true)"

LOCAL_BACKUP_PATH=""
BACKUP_COPY_FAILED=0
if [ -n "$NEWEST_BACKUP" ]; then
  if scp -P "${VPS_PORT}" "${VPS_USER}@${VPS_HOST}:$NEWEST_BACKUP" backups/; then
    LOCAL_BACKUP_PATH="backups/$(basename "$NEWEST_BACKUP")"
    echo "==> Downloaded backup to: ${LOCAL_BACKUP_PATH}"
  else
    echo "WARNING: backup was NOT copied off the VPS!" >&2
    BACKUP_COPY_FAILED=1
  fi
else
  echo "WARNING: backup was NOT copied off the VPS (no backup found on VPS)!" >&2
  BACKUP_COPY_FAILED=1
fi

if [ "$REMOTE_EXIT" -ne 0 ]; then
  echo "" >&2
  echo "=========================================" >&2
  echo " Deploy FAILED on VPS (exit code: ${REMOTE_EXIT})!" >&2
  if [ -n "$LOCAL_BACKUP_PATH" ]; then
    echo " Newest VPS backup copied locally to: ${LOCAL_BACKUP_PATH}" >&2
  else
    echo " WARNING: backup was NOT copied off the VPS!" >&2
  fi

  CURRENT_REMOTE_DEPLOYED="$(ssh -p "${VPS_PORT}" "${VPS_USER}@${VPS_HOST}" "cat \"${VPS_DIR}/.deployed-sha\" 2>/dev/null" || true)"
  if [ "$CURRENT_REMOTE_DEPLOYED" = "$LOCAL_SHA" ]; then
    echo " Rollback cmd:  ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_DIR} && ./scripts/rollback.sh'" >&2
  else
    echo " Live app unchanged; no rollback needed." >&2
  fi
  echo "=========================================" >&2
  exit "$REMOTE_EXIT"
fi

if [ "$BACKUP_COPY_FAILED" -ne 0 ] || [ -z "$LOCAL_BACKUP_PATH" ]; then
  echo "" >&2
  echo "=========================================" >&2
  echo " WARNING: backup was NOT copied off the VPS!" >&2
  echo " Deployed SHA:  ${LOCAL_SHA}" >&2
  echo " Health Status: healthy" >&2
  echo " Rollback cmd:  ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_DIR} && ./scripts/rollback.sh'" >&2
  echo "=========================================" >&2
  exit 1
fi

echo ""
echo "========================================="
echo " Deploy Succeeded!"
echo " Deployed SHA:  ${LOCAL_SHA}"
echo " Health Status: healthy"
echo " Local Backup:  ${LOCAL_BACKUP_PATH}"
echo " Rollback cmd:  ssh ${VPS_USER}@${VPS_HOST} 'cd ${VPS_DIR} && ./scripts/rollback.sh'"
echo "========================================="
