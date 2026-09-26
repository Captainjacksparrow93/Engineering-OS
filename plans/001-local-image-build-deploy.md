# 001 — Build the Docker image locally and ship it to the VPS

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity

## Goal
New rule (2026-09-26): VPS projects deploy a **prebuilt image built on the owner's machine**. GitHub and the VPS never build or publish images.

Today (commit `72d56b2`), a push to `main` makes GitHub build the image (`publish` job in `.github/workflows/ci.yml`), push it to GHCR, and `.github/workflows/deploy.yml` auto-deploys it to the VPS. After this plan:
- **CI only tests.** A push to `main` no longer deploys anything.
- **Deploy is one local command**, run by the owner from Git Bash on their PC: `scripts/deploy.sh`. It builds the image from a clean, pushed commit, copies it to the VPS over SSH (no registry), backs up the DB (and copies the backup to the PC), swaps the container, and waits for it to be healthy.
- **Rollback** uses the previous image that is already loaded on the VPS. Nothing is downloaded.

What stays the same: `Dockerfile`, `entrypoint.sh`, `/api/health`, `scripts/backup.sh`, `scripts/restore.sh`, the server folder `/root/engos-docker`, the container name `engos_app`.

## Affected code
- `.github/workflows/ci.yml` — remove the `publish` job (GHCR build and push). Keep `test-and-build` unchanged.
- `.github/workflows/deploy.yml` — delete (no more auto-deploy).
- `docker-compose.yml` — `app.image` default `${APP_IMAGE:-ghcr.io/n8nmonk-wq/engineering-os:latest}` → `${APP_IMAGE:-engineering-os:current}`.
- `scripts/deploy.sh` — new (runs on the owner's PC).
- `scripts/rollback.sh` — stop pulling from GHCR; use the local image `engineering-os:<previous sha>`.
- Blast radius: these are YAML and shell files, which code-review-graph does not index (`file_summary scripts/rollback.sh` → 0 nodes), so there is no graph output. Repo text search for `ghcr|APP_IMAGE|rollback.sh|deploy.yml|.deployed-sha` finds: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docker-compose.yml`, `scripts/rollback.sh`, `.gitignore` (keep `.deployed-sha`/`.previous-sha` ignored), plus docs `PROJECT.md`, `docs/deployment-runbook.md`, `docs/deploy-pipeline-plan.md`, `docs/client-requests-2026-09-25.md`, `docs/follow-up-plan-gemini.md`. No application code (TypeScript) is affected.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`. **Do not run `scripts/deploy.sh` or anything against the VPS** — the owner runs the first deploy.
- Do not change `Dockerfile`, `entrypoint.sh`, `scripts/backup.sh`, `scripts/restore.sh`, or the `db` service in `docker-compose.yml`.
- No secrets in scripts. The VPS host/user come from env vars with the current defaults (`VPS_HOST=72.62.248.38`, `VPS_USER=root`, `VPS_DIR=/root/engos-docker`); SSH uses the owner's own key.
- Scripts must work in Git Bash on Windows (use `ssh`, `scp`, `docker`, `git`, `gzip`; no GNU-only flags that Git Bash lacks).
- Keep it boring: one script, no new dependencies, no registry.

## Tools & skills (implementer: follow these)
- **code-review-graph:** does not cover `.yml`/`.sh` files (checked: 0 nodes for `scripts/rollback.sh`). Use text search instead: grep for `ghcr`, `APP_IMAGE`, `deployed-sha`, `previous-sha` to confirm no other references remain after your change.
- **Token Savior:** not useful for these files (no symbols). Read the five files listed in "Affected code" directly; they are short.
- **sequential-thinking:** required for step 3 (the order of operations in `deploy.sh`: what must happen before the container swap, and what happens if each step fails).
- **Skills:** `ponytail` (full, always — shortest working script) · `review-delta` (before DONE). `tdd` does not apply (no testable app code); instead do the dry-run checks in Acceptance.
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int` — run the full suite (nothing app-side should change) and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [ ] 1. **CI tests only.** In `.github/workflows/ci.yml`, delete the whole `publish` job. Delete `.github/workflows/deploy.yml`.
- [ ] 2. **Compose default.** In `docker-compose.yml`, change the `app` image default to `${APP_IMAGE:-engineering-os:current}`. Leave `build:` in place (used for local builds only).
- [ ] 3. **`scripts/deploy.sh`** (new, executable, `set -euo pipefail`). In this order, stopping on any failure:
  1. Refuse to run unless the working tree is clean and `HEAD` equals `origin/main` (run `git fetch` first). Print the sha being deployed. Rationale: the image must match reviewed, pushed code, and the VPS `git pull` must get the same compose file and scripts.
  2. Build: `docker build --platform linux/amd64 -t engineering-os:<sha> .`
  3. Ship: `docker save engineering-os:<sha> | gzip | ssh $VPS_USER@$VPS_HOST 'gunzip | docker load'`.
  4. On the VPS, in one `ssh` session, with `set -e`:
     - `cd $VPS_DIR && git pull origin main` (compose file and scripts only).
     - `./scripts/backup.sh`.
     - Save the current `.deployed-sha` into `.previous-sha` (if any).
     - `docker tag engineering-os:<sha> engineering-os:current`, then `APP_IMAGE=engineering-os:<sha> docker compose up -d --no-build app`.
     - Write `<sha>` to `.deployed-sha`.
     - Wait up to 3 minutes for `engos_app` health status `healthy` (same loop as the old `deploy.yml`). If not healthy, print `docker compose logs --tail 150 app` and exit non-zero. No automatic rollback.
     - Remove old `engineering-os:*` images except `current`, `<sha>` and the one in `.previous-sha` (keeps disk usage bounded; rollback target stays).
  5. Copy the newest `backups/backup_*.sql.gz` from the VPS to a local `backups/` folder (already git-ignored) with `scp`, so every deploy leaves a backup off the server.
  6. Print: deployed sha, health result, local backup path, and the rollback command.
- [ ] 4. **`scripts/rollback.sh`** (runs on the VPS): read `.previous-sha`, `docker tag engineering-os:$PREV engineering-os:current`, `APP_IMAGE=engineering-os:$PREV docker compose up -d --no-build app` (no `pull`), write `$PREV` to `.deployed-sha`. Exit with a clear message if `.previous-sha` is missing or that image isn't loaded.
- [ ] 5. Grep the repo (excluding `docs/` and `node_modules/`) for `ghcr` — there must be no matches left. Leave `docs/` alone; Claude updates `PROJECT.md` and the docs in review.

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [ ] `.github/workflows/` contains only `ci.yml`, and it has no `publish` job and no GHCR/registry steps.
- [ ] `docker compose config` (run locally) shows the app image `engineering-os:current` when `APP_IMAGE` is unset.
- [ ] `bash -n scripts/deploy.sh` and `bash -n scripts/rollback.sh` pass.
- [ ] Running `scripts/deploy.sh` with a dirty tree, or with `HEAD` ≠ `origin/main`, stops before building (check both locally; it must never reach the `ssh` step in these checks).
- [ ] No `ghcr` references outside `docs/`.

## Owner steps after review (not for the implementer)
- Push to `main` (CI runs tests only; nothing deploys).
- First deploy: from Git Bash in the repo, run `scripts/deploy.sh`. The VPS currently runs a GHCR image, so the first `.previous-sha` points at an image that isn't in the new naming; rollback works from the second deploy on (same caveat as the old pipeline). Keep the backup it copies down.
- Optional clean-up: on the VPS `docker logout ghcr.io`; in GitHub, delete the `VPS_SSH_KEY` secret and the private GHCR package.

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups; Claude updates PROJECT.md §6 and marks docs/deployment-runbook.md / docs/deploy-pipeline-plan.md as superseded>
