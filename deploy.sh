#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Engineering OS - Hostinger VPS Traefik Deployment Script
# Uses Prebuilt GHCR Image for ultra-fast, zero-overhead deployment
# ---------------------------------------------------------------------------

set -euo pipefail

echo "=========================================================="
echo "   Engineering OS - VPS Traefik Deployment (Prebuilt Image)"
echo "=========================================================="

# Check Docker
if ! command -v docker &> /dev/null; then
  echo "Error: Docker is not installed."
  exit 1
fi

# Ensure external Traefik network exists
if ! docker network inspect n8n_default >/dev/null 2>&1; then
  echo "==> Creating external network 'n8n_default' for Traefik..."
  docker network create n8n_default
fi

# Setup .env if missing
if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example..."
  cp .env.example .env

  RANDOM_AUTH_SECRET=$(openssl rand -hex 32)
  RANDOM_DB_PASS=$(openssl rand -hex 16)

  sed -i "s/generate-a-random-32-char-secret-key-here/${RANDOM_AUTH_SECRET}/" .env
  sed -i "s/generate-a-strong-db-password-here/${RANDOM_DB_PASS}/g" .env

  echo "==> Generated strong AUTH_SECRET and POSTGRES_PASSWORD in .env"
fi

mkdir -p backups
mkdir -p scripts
chmod +x scripts/*.sh 2>/dev/null || true

echo "==> Pulling prebuilt Docker images..."
docker compose pull db app || true

echo "==> Launching Docker containers in background..."
docker compose up -d --build

echo "==> Waiting for services to become healthy..."
sleep 5

docker compose ps

DOMAIN_VAL=$(grep "^DOMAIN=" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'" || echo "engos.srv1275499.hstgr.cloud")

echo "=========================================================="
echo "   Deployment Complete!"
echo "   Application available at: https://${DOMAIN_VAL}"
echo "   Check logs with: docker compose logs -f"
echo "=========================================================="
