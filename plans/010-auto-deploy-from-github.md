# 010 — Automatic deploy from GitHub after green CI

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity (workflow and script changes) · **Setup:** the user (GitHub secret) and Claude (VPS key, with approval)

## Goal
User decision 2026-09-30 (option C): **every push to `main` that passes CI deploys itself to production.** No PC, no Docker Desktop and no `deploy.sh` needed. This replaces the 2026-09-26 "build locally" rule and plan 001's mechanism.

It also removes a live bug. Release 009 showed that `scripts/deploy.sh` skips the swap and still prints "Deploy Succeeded". It sends the server steps on SSH stdin, and `docker compose exec -T db pg_dump` inside `backup.sh` swallows the rest of them (`plans/done/009-release-plans-002-008.md`, notes).

**Decisions (user, 2026-09-30):**
- GitHub builds the image and pushes it to **private GHCR** (`ghcr.io/n8nmonk-wq/engineering-os:<sha>`). The server pulls it.
- **Backups stay on the server** (14-day retention in `backup.sh`). Claude or the user copies them to the PC from time to time. No new storage account.
- **Fully automatic** on green CI, plus a manual "Run workflow" button for redeploys.

**How it works after this plan:**
1. Push to `main` → **CI** (tests, as today).
2. If CI is green → a **publish** job builds the image and pushes `ghcr.io/n8nmonk-wq/engineering-os:<sha>`.
3. When that succeeds → the **deploy** workflow connects to the VPS over SSH and runs the steps below.
4. If the new container isn't healthy → it **rolls back automatically** to the previous image, and the run fails (GitHub emails the owner).

## Where things stand (checked 2026-09-30)
- `.github/workflows/ci.yml`: tests only (`npm ci`, `prisma validate`, `migrate deploy`, `db:seed`, typecheck, unit, integration, build). No publish job, no `deploy.yml`.
- The old pipeline (commit `72d56b2`) had a `publish` job in `ci.yml` and `.github/workflows/deploy.yml` using `appleboy/ssh-action@v1.0.3` with secrets `VPS_SSH_KEY` (plus optional `VPS_HOST`, `VPS_USER`, `VPS_PORT`). Reuse its shape. Its remote script was passed as a command string, not stdin, so it did not have the `deploy.sh` bug.
- Production: `engos_app` runs `engineering-os:ccbdd71…` (`engineering-os:current`). `.deployed-sha` = `ccbdd71…`, `.previous-sha` = `06cdd68…`. `docker-compose.yml` app image: `${APP_IMAGE:-engineering-os:current}`.
- The VPS docker config has a `ghcr.io` login (it pulled private GHCR images before plan 001).
- The VPS is shared with Chatwoot, n8n, Supplychain and others. **Never run `docker image prune -a` or any cleanup that is not limited to `engineering-os` images.**

## Affected code
- `.github/workflows/ci.yml`: add a `publish` job: `needs` the test job, runs only on `push` to `main`, `permissions: packages: write`. It logs in to `ghcr.io` with `GITHUB_TOKEN`, builds with Buildx (GHA cache), and pushes `ghcr.io/n8nmonk-wq/engineering-os:${{ github.sha }}`. No `latest` tag is needed.
- `.github/workflows/deploy.yml` (new):
  - **Triggers:** `workflow_run` of `CI`, `completed`, `main`, only when `conclusion == 'success'` and the triggering event was a `push`. Also `workflow_dispatch` with an optional `sha` input (default: the latest `main` SHA) for manual redeploys.
  - `concurrency: { group: deploy-production, cancel-in-progress: false }`, so two deploys never overlap.
  - Runs the remote steps below over SSH with `appleboy/ssh-action` (script as a command string, not piped stdin).
- **Remote steps (in order; stop on the first failure):**
  1. `cd /root/engos-docker`, then bring the checkout to exactly the deployed SHA (fetch, then check out that SHA), so compose and scripts match the image.
  2. `./scripts/backup.sh </dev/null`. If the backup fails, the deploy stops before anything changes. Print the backup filename.
  3. Record `OLD` = the SHA the running container uses (`.deployed-sha`).
  4. `docker pull ghcr.io/n8nmonk-wq/engineering-os:<sha>` and tag it `engineering-os:<sha>`. This keeps `rollback.sh` and the compose default working unchanged.
  5. `APP_IMAGE=engineering-os:<sha> docker compose up -d --no-build app </dev/null`. **Only the `app` service**; never touch `db`.
  6. Wait up to 3 minutes for `engos_app` health `healthy`, **and** check the running container's image is `engineering-os:<sha>`. Both must hold. This is the check `deploy.sh` lacked.
  7. **On success:** tag `engineering-os:current`, write `.previous-sha` = `OLD` and `.deployed-sha` = `<sha>`, then remove `engineering-os:*` and `ghcr.io/n8nmonk-wq/engineering-os:*` images other than `current`, `<sha>` and `OLD`.
  8. **On failure:** print `docker compose logs --tail 150 app`, swap back to `engineering-os:OLD` (same compose command), wait for healthy, and exit non-zero so the run shows red. Don't change `.deployed-sha`.
- Any command in the remote script that could read stdin (`docker compose exec`, `docker compose up`, scripts that call them) gets `</dev/null`.
- `scripts/deploy.sh`: **delete**. It has the stdin bug, and the "Run workflow" button replaces it.
- `scripts/rollback.sh`: unchanged (it already uses `engineering-os:<sha>` tags). `scripts/backup.sh` and `scripts/restore.sh`: unchanged.
- `PROJECT.md`: rewrite the deploy section. Push → CI → publish → deploy; the manual button; the rollback command; where backups live and the command to copy the newest one to the PC (`scp root@72.62.248.38:/root/engos-docker/backups/<file> backups/`).

**Blast radius:** code-review-graph does not index `.yml`/`.sh` (plan 001 checked: 0 nodes for `scripts/rollback.sh`), so there is no graph output. No TypeScript is touched. Text search before editing: `deploy.sh`, `ghcr`, `APP_IMAGE`, `deployed-sha`, `previous-sha` across the repo, to update every reference (expected: `PROJECT.md`, `README.md` if present, `docs/`, `scripts/`, `.github/`, `docker-compose.yml`). Record the hits in Implementation notes.

## One-time setup (before the first automatic run; not the implementer)
1. **Deploy key (Claude, with the user's approval).** Generate a new ed25519 key pair used only by GitHub Actions (comment `github-actions-engos-deploy`). Append the public key to `/root/.ssh/authorized_keys` on the VPS. Hand the private key to the user once, and don't store it in the repo or anywhere else.
2. **GitHub secret (user).** Repo → Settings → Secrets and variables → Actions:
   - Set `VPS_SSH_KEY` to that private key.
   - If `VPS_HOST`, `VPS_USER` or `VPS_PORT` exist from the old pipeline, check they are `72.62.248.38` / `root` / `22`, or delete them.
   - Then delete the private key from wherever it was handed over.
3. **GHCR (user).** After the first publish, check that the package `engineering-os` is **private** and linked to the repository (Packages → engineering-os → Package settings).
4. **Old keys (user decides).** `authorized_keys` on the VPS also holds `root@srv1275499` and `Jaimin`. Confirm both are still needed. If the old pipeline's `VPS_SSH_KEY` was one of them, it is replaced by the new key.

## Constraints
- The app is LIVE. The implementer commits locally only and never pushes: **after this plan, a push is a production deploy.** The implementer never runs anything against the VPS and never adds secrets.
- **New release rule, effective when this plan lands (write it into `CLAUDE.md` and `AGENTS.md`, Claude):** a push to `main` deploys. So any change with a migration must be rehearsed on a production copy by Claude **before** the push, and every migration must keep the previous code working (additive; this is already the rule), because automatic rollback swaps code only.
- Migrations still run from `entrypoint.sh` (`migrate deploy`), as today. No change.
- No new dependencies in the app. GitHub Actions used: `actions/checkout`, `docker/setup-buildx-action`, `docker/login-action`, `docker/build-push-action`, `appleboy/ssh-action` (all were used before, in `72d56b2`).

## Tools & skills (implementer: follow these)
- **Setup:** load `ponytail` (full). Token Savior and code-review-graph don't cover YAML or shell; use text search and say so in the notes.
- **Look before you change:** read the old workflows with `git show 72d56b2:.github/workflows/deploy.yml` and `git show 72d56b2:.github/workflows/ci.yml` (the `publish` job). Read the current `scripts/rollback.sh` and `docker-compose.yml`.
- **sequential-thinking:** required for the remote-step order and the failure/rollback branch (steps 5–8). Each step may only rely on earlier ones, and a failure at any step must leave the old container running or restore it.
- **Skills:** `ponytail` (full) · `review-delta` (before DONE). No `tdd`: workflows can't be unit-tested here, so they are verified by the first real run (acceptance).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int` on a fresh CI-like database (empty DB → `npx prisma migrate deploy` → `npm run db:seed`), to prove nothing in the app moved. Also `bash -n` on every changed shell script, and parse both workflow files as YAML (e.g. `node -e "require('yaml')"` only if `yaml` is already installed; otherwise just review carefully). Paste the results.
- If a tool is missing or fails, say so in Implementation notes.

## Steps
- [ ] 1. Add the `publish` job to `ci.yml`.
- [ ] 2. Add `.github/workflows/deploy.yml` with the triggers, concurrency and remote steps 1–8 above.
- [ ] 3. Delete `scripts/deploy.sh`; update `PROJECT.md` and every other reference found by the text search.
- [ ] 4. Run the checks above, then commit locally (`plan 010: …`). **Do not push.**
- [ ] 5. (Claude + user) One-time setup 1–3, then Claude reviews.
- [ ] 6. (User) Push. Watch CI → publish → deploy go green. Claude verifies production: running image `engineering-os:<sha>`, `.deployed-sha`, health, and a new backup on the server.
- [ ] 7. (Claude, after the user approves) **Rollback drill:** run the deploy workflow by hand with `sha` = the previous SHA and confirm it deploys and turns healthy. Then run it again with the latest SHA.

## Acceptance criteria
- [ ] A push to `main` with green CI deploys that SHA to production with no manual step. A red CI deploys nothing.
- [ ] The job succeeds only when `engos_app` is healthy **and** runs `engineering-os:<sha>`.
- [ ] A failed health check rolls back to the previous image automatically, and the run is red.
- [ ] A backup is taken before every swap, and a failed backup stops the deploy.
- [ ] `scripts/deploy.sh` is gone; `rollback.sh` still works.
- [ ] No image cleanup touches anything outside `engineering-os`.
- [ ] The full test suite passes (counts pasted).

## Implementation notes (implementer)
<commits, text-search hits, deviations, test counts, tools used>

## Review (Claude)
<verdict, follow-ups>
