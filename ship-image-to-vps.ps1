# ---------------------------------------------------------------------------
# Engineering OS - Ship Local Docker Image Directly to VPS (PowerShell)
# Builds image locally on your PC and pipes it directly into the VPS Docker engine.
# Requires ZERO GitHub access, ZERO GitHub Secrets, and saves VPS build CPU.
# Usage: .\ship-image-to-vps.ps1
# ---------------------------------------------------------------------------

param (
    [string]$VpsHost = "72.62.248.38",
    [string]$VpsUser = "root",
    [string]$ImageTag = "engineering-os:local",
    [string]$RemoteDir = "/root/engos-docker"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Shipping Local Docker Image to VPS: $VpsHost" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Build Docker image locally
Write-Host "==> [1/3] Building Docker image locally on your PC..." -ForegroundColor Yellow
docker build -t $ImageTag .

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Local Docker build failed." -ForegroundColor Red
    exit 1
}

# 2. Stream image directly to VPS
Write-Host "==> [2/3] Streaming image directly over SSH to VPS..." -ForegroundColor Yellow
docker save $ImageTag | ssh "$VpsUser@$VpsHost" "docker load"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to stream image to VPS." -ForegroundColor Red
    exit 1
}

# 3. Update remote container to use the local image
Write-Host "==> [3/3] Restarting container on VPS with new image..." -ForegroundColor Yellow
$remoteCommands = @"
set -e
cd $RemoteDir
APP_IMAGE=$ImageTag docker compose up -d app migrate
docker compose ps
"@

ssh "$VpsUser@$VpsHost" $remoteCommands

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   Image Shipped and Deployed Successfully!" -ForegroundColor Green
Write-Host "   Live at: https://engos.srv1275499.hstgr.cloud" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
