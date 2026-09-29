#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Engineering OS - Container Rollback Script (runs on VPS)
# Usage: ./scripts/rollback.sh
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if [ ! -f .previous-sha ] || [ ! -s .previous-sha ]; then
  echo "Error: .previous-sha does not exist or is empty. Cannot rollback." >&2
  exit 1
fi

PREV="$(tr -d ' \r\n' < .previous-sha)"

if [ -z "$PREV" ]; then
  echo "Error: No previous SHA found in .previous-sha. Cannot rollback." >&2
  exit 1
fi

if ! docker image inspect "engineering-os:$PREV" >/dev/null 2>&1; then
  echo "Error: Image engineering-os:$PREV is not loaded on this host. Cannot rollback." >&2
  exit 1
fi

echo "==> Rolling back to engineering-os:$PREV..."
docker tag "engineering-os:$PREV" engineering-os:current
APP_IMAGE="engineering-os:$PREV" docker compose up -d --no-build app
echo "$PREV" > .deployed-sha

echo "==> Rollback complete. Current deployed SHA: $PREV"
