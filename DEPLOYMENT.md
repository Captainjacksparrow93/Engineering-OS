# Local-to-VPS Deployment Guide (No GitHub Settings Needed)

If you do not have admin access to GitHub repository settings or secrets, you can deploy and update your Hostinger VPS directly from your local computer using the provided 1-click scripts.

---

## Method 1: 1-Click Git Deploy (Fastest & Simplest)

Whenever you make changes to your code:

### 1. Push your changes to Git
```powershell
git add .
git commit -m "update: your change description"
git push
```

### 2. Run the 1-Click Local Deploy Script
From your local terminal in the project directory:

* **On Windows (PowerShell)**:
  ```powershell
  .\deploy-to-vps.ps1
  ```
* **On Git Bash / Mac / Linux**:
  ```bash
  ./deploy-to-vps.sh
  ```

**What this script does automatically**:
1. Connects to `root@72.62.248.38` via SSH.
2. Runs `git pull` in `/root/engos-docker/`.
3. Runs `docker compose up -d --build` to rebuild and update the containers.
4. Checks container status and confirms your site is live at **`https://engos.srv1275499.hstgr.cloud`**.

---

## Method 2: Ship Local Docker Image Directly to VPS (Zero GitHub Required)

If you don't even want to push to GitHub or build on the VPS:

* **On Windows (PowerShell)**:
  ```powershell
  .\ship-image-to-vps.ps1
  ```

**What this script does automatically**:
1. Builds the Docker image locally on your fast PC: `docker build -t engineering-os:local .`
2. Streams the compiled image directly to your VPS Docker daemon over SSH (`docker save | ssh docker load`).
3. Restarts the container on the VPS with zero CPU/RAM strain on the server.

---

## First-Time Setup on the VPS (One-Time Only)

If this is your first time setting up the VPS:

1. SSH into the server:
   ```bash
   ssh root@72.62.248.38
   ```
2. Clone the repository into `/root/engos-docker`:
   ```bash
   mkdir -p /root/engos-docker && cd /root/engos-docker
   git clone https://github.com/n8nmonk-wq/Engineering-OS.git .
   ```
3. Run the initial deploy script:
   ```bash
   chmod +x deploy.sh scripts/*.sh
   ./deploy.sh
   ```
4. Initialize the database seed:
   ```bash
   docker compose exec app npm run db:seed
   ```
