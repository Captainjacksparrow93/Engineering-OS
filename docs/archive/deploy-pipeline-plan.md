# Deploy pipeline: build once in CI, pull on the VPS (plan, 2026-09-26)

Goal: `git push origin main` gives a tested, backed-up, health-checked deploy, and rollback takes seconds.
This replaces the manual steps in `deployment-runbook.md`, which was written for the one-off September cut-over.

## Today

- `ci.yml` checks types, runs the unit and integration tests, runs migrations on an empty Postgres, and builds the app. `deploy.yml` runs only after CI passes on `main`. Keep both of these.
- `deploy.yml` SSHes to the VPS and runs `git pull` then `docker compose up -d --build`, so **the image is built on the production box**. The build is slow and loads the live server, the image isn't the one CI tested, and rollback means a rebuild.
- `docker-compose.yml` already names the image `${APP_IMAGE:-ghcr.io/n8nmonk-wq/engineering-os:latest}`. The Dockerfile already ships `prisma/`, the Prisma CLI and `entrypoint.sh`, so migrations and seeding run from the image. `/api/health` already fails while a migration is unfinished.
- Nothing takes a backup automatically before a deploy.
- Each permission change is a `prisma/scripts/grant-*.ts` script that runs on **every** container start. Failures are hidden by `|| echo`. There are already 4.

## Changes

### 0. Build the image in CI and push it to GHCR
- Add a `publish` job to `ci.yml` that runs only on push to `main`, after `test-and-build` passes. It uses `docker/login-action` with `GITHUB_TOKEN` (`permissions: packages: write`), then `docker/build-push-action` to push:
  - `ghcr.io/n8nmonk-wq/engineering-os:<full commit sha>`
  - `ghcr.io/n8nmonk-wq/engineering-os:latest`
- Use the GitHub Actions layer cache (`cache-from/to: type=gha`) so rebuilds stay fast.

### 1. Deploy by pulling, with a backup first
Rewrite the `deploy.yml` SSH script (keep `set -e`):
```sh
cd /root/engos-docker
git pull origin main                      # compose file and scripts only; nothing is built here
./scripts/backup.sh                       # aborts the deploy if the backup fails
SHA=${{ github.event.workflow_run.head_sha || github.sha }}
cat .deployed-sha 2>/dev/null > .previous-sha || true
export APP_IMAGE=ghcr.io/n8nmonk-wq/engineering-os:$SHA
docker compose pull app
docker compose up -d --no-build app
echo "$SHA" > .deployed-sha
```
- `.deployed-sha` and `.previous-sha` are what rollback reads. Add both to `.gitignore`.
- `docker compose up` must use `--no-build`, so the VPS never builds.

### 2. Health gate after deploy
Add this to the same script:
```sh
for i in $(seq 1 36); do
  s=$(docker inspect -f '{{.State.Health.Status}}' engos_app)
  [ "$s" = healthy ] && echo "==> healthy" && exit 0
  sleep 5
done
docker compose logs --tail 150 app; exit 1
```
- If the app isn't healthy within 3 minutes, the Actions run goes red and shows the logs.
- There is no automatic rollback: a migration may already have run, and putting the old image back on the new schema can be worse. Rollback is a person's decision (section 4).

### 3. Permission and data changes are SQL migrations, not scripts
- From now on, grant and revoke permissions in a migration made with `prisma migrate dev --create-only --name <change>`, then hand-write the SQL. It runs exactly once, CI runs it on every push, and it ships with the image.
- `migrate deploy` runs **before** `seed.ts` in `entrypoint.sh`, so a migration that grants a brand-new permission key must also insert that key into `core_permissions` (`ON CONFLICT (key) DO NOTHING`). Look up role and permission ids by `key`; never hard-code ids.
- Leave the 4 existing `grant-*.ts` scripts as they are. They're idempotent and already applied. Don't add new ones.
- Update `AGENTS.md` with this rule.

### 4. Rollback
Add `scripts/rollback.sh` for the VPS:
```sh
set -e; cd /root/engos-docker
PREV=$(cat .previous-sha)
export APP_IMAGE=ghcr.io/n8nmonk-wq/engineering-os:$PREV
docker compose pull app && docker compose up -d --no-build app
echo "$PREV" > .deployed-sha
```
- This covers code-only releases. If the bad release included a migration, restore the backup from step 1 with `scripts/restore.sh` first, then run the rollback. Only do this after the user approves.

### 5. Retire the old runbook
Put a note at the top of `deployment-runbook.md` saying it is historical (the September 2026 cut-over only) and pointing to the "Release" section below.

## One-time setup (the user does this, not Antigravity)
1. After the first `publish` run, open the GHCR package settings and give the repo access. Keep the package private.
2. On the VPS, log in once with a GitHub token that has **only** `read:packages`: `docker login ghcr.io -u n8nmonk-wq`. Claude and Antigravity never handle this token.
3. Run a first deploy with `workflow_dispatch` and watch it.

## Release, after this lands
1. CI is green: types, unit, integration, build, and image published.
2. `git push origin main`. Backup, pull, migrate, seed and the health gate then run automatically.
3. Copy the new backup off the VPS: `scp root@72.62.248.38:/root/engos-docker/backups/backup_<latest>.sql.gz <local folder>`.
4. Do a 2-minute click-through on prod: log in, then open the dashboard, a project, People and Audit.
5. Restore the backup locally and rehearse **only** when a migration changes existing rows. Permission migrations don't need it.

## Tests / verification
- A PR runs `test-and-build` only. It never publishes and never deploys.
- A push to `main` publishes both tags, then the deploy pulls the `<sha>` tag. `docker compose ps` shows the new image, and `.deployed-sha` matches the commit.
- A deliberately broken health check (tried on a throwaway branch through `workflow_dispatch`, never on `main`) turns the run red and prints the logs.
- `scripts/rollback.sh` brings back the previous sha within about 30 seconds.
- CI still runs every migration from empty, including the new permission migrations.
