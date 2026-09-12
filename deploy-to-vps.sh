#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Engineering OS - 1-Click Local to VPS Deploy Script (Bash)
# Usage: ./deploy-to-vps.sh
# ---------------------------------------------------------------------------

set -euo pipefail

VPS_HOST="${1:-72.62.248.38}"
VPS_USER="${2:-root}"
REMOTE_DIR="${3:-/root/engos-docker}"

echo "=========================================================="
echo "   Deploying Engineering-OS to VPS: ${VPS_HOST}"
echo "=========================================================="

echo "==> [1/3] Pulling latest git changes and rebuilding containers on VPS..."
ssh "${VPS_USER}@${VPS_HOST}" << EOF
set -e
cd ${REMOTE_DIR}
echo "--> Pulling latest code..."
git pull
echo "--> Rebuilding and launching containers..."
docker compose up -d --build
echo "--> Container status:"
docker compose ps
EOF

echo "==> [2/3] Waiting for services to become healthy..."
sleep 3

echo "=========================================================="
echo "   Deployment Complete!"
echo "   Live at: https://engos.srv1275499.hstgr.cloud"
echo "=========================================================="
