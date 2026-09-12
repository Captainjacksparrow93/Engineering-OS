# ---------------------------------------------------------------------------
# Engineering OS - 1-Click Local to VPS Deploy Script (PowerShell)
# Updates your Hostinger VPS directly from your local machine.
# Usage: .\deploy-to-vps.ps1
# ---------------------------------------------------------------------------

param (
    [string]$VpsHost = "72.62.248.38",
    [string]$VpsUser = "root",
    [string]$RemoteDir = "/root/engos-docker"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Deploying Engineering-OS to VPS: $VpsHost" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Check SSH connection
Write-Host "==> [1/3] Connecting to VPS..." -ForegroundColor Yellow
$testSSH = ssh -o BatchMode=yes -o ConnectTimeout=5 "$VpsUser@$VpsHost" "echo OK" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Could not connect to $VpsUser@$VpsHost via SSH." -ForegroundColor Red
    Write-Host "Please verify your SSH key or password access." -ForegroundColor Red
    exit 1
}

# Execute remote pull and rebuild
Write-Host "==> [2/3] Pulling latest git changes and updating containers on VPS..." -ForegroundColor Yellow
$remoteCommands = @"
set -e
cd $RemoteDir
echo '--> Pulling latest code...'
git pull
echo '--> Rebuilding and restarting containers...'
docker compose up -d --build
echo '--> Container status:'
docker compose ps
"@

ssh "$VpsUser@$VpsHost" $remoteCommands

Write-Host "==> [3/3] Verifying deployment..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   Deployment Successful!" -ForegroundColor Green
Write-Host "   Live at: https://engos.srv1275499.hstgr.cloud" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
