# 001 — Build the Docker image locally and ship it to the VPS

**Status:** REVIEWED   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
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
- Blast radius: these are YAML and shell files, which code-review-graph does not index (`file_summary scripts/rollback.sh` → 0 nodes), so there is no graph output. Repo text search for `ghcr|APP_IMAGE|rollback.sh|deploy.yml|.deployed-sha` finds: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docker-compose.yml`, `scripts/rollback.sh`, `.gitignore` (keep `.deployed-sha`/`.previous-sha` ignored), plus docs `PROJECT.md`, `docs/archive/deployment-runbook.md`, `docs/archive/deploy-pipeline-plan.md`, `docs/client-requests-2026-09-25.md`, `docs/archive/follow-up-plan-gemini.md`. No application code (TypeScript) is affected.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`. **Do not run `scripts/deploy.sh` or anything against the VPS** — the owner runs the first deploy.
- Do not change `Dockerfile`, `entrypoint.sh`, `scripts/backup.sh`, `scripts/restore.sh`, or the `db` service in `docker-compose.yml`.
- No secrets in scripts. The VPS host/user come from env vars with the current defaults (`VPS_HOST=72.62.248.38`, `VPS_USER=root`, `VPS_DIR=/root/engos-docker`); SSH uses the owner's own key.
- Scripts must work in Git Bash on Windows (use `ssh`, `scp`, `docker`, `git`, `gzip`; no GNU-only flags that Git Bash lacks).
- Keep it boring: one script, no new dependencies, no registry.
- VPS verified 2026-09-26 (read-only): Ubuntu 24.04.4 LTS, `x86_64`, Docker 29.3.1; key-based SSH from the owner's PC as `root` works. So `--platform linux/amd64` is correct.

## Tools & skills (implementer: follow these)
- **code-review-graph:** does not cover `.yml`/`.sh` files (checked: 0 nodes for `scripts/rollback.sh`). Use text search instead: grep for `ghcr`, `APP_IMAGE`, `deployed-sha`, `previous-sha` to confirm no other references remain after your change.
- **Token Savior:** not useful for these files (no symbols). Read the five files listed in "Affected code" directly; they are short.
- **sequential-thinking:** required for step 3 (the order of operations in `deploy.sh`: what must happen before the container swap, and what happens if each step fails).
- **Skills:** `ponytail` (full, always — shortest working script) · `review-delta` (before DONE). `tdd` does not apply (no testable app code); instead do the dry-run checks in Acceptance.
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int` — run the full suite (nothing app-side should change) and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [x] 1. **CI tests only.** In `.github/workflows/ci.yml`, delete the whole `publish` job. Delete `.github/workflows/deploy.yml`.
- [x] 2. **Compose default.** In `docker-compose.yml`, change the `app` image default to `${APP_IMAGE:-engineering-os:current}`. Leave `build:` in place (used for local builds only).
- [x] 3. **`scripts/deploy.sh`** (new, executable, `set -euo pipefail`). In this order, stopping on any failure:
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
- [x] 4. **`scripts/rollback.sh`** (runs on the VPS): read `.previous-sha`, `docker tag engineering-os:$PREV engineering-os:current`, `APP_IMAGE=engineering-os:$PREV docker compose up -d --no-build app` (no `pull`), write `$PREV` to `.deployed-sha`. Exit with a clear message if `.previous-sha` is missing or that image isn't loaded.
- [x] 5. Grep the repo (excluding `docs/` and `node_modules/`) for `ghcr` — there must be no matches left. Leave `docs/` alone; Claude updates `PROJECT.md` and the docs in review.

## Acceptance criteria
- [x] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [x] `.github/workflows/` contains only `ci.yml`, and it has no `publish` job and no GHCR/registry steps.
- [x] `docker compose config` (run locally) shows the app image `engineering-os:current` when `APP_IMAGE` is unset.
- [x] `bash -n scripts/deploy.sh` and `bash -n scripts/rollback.sh` pass.
- [x] Running `scripts/deploy.sh` with a dirty tree, or with `HEAD` ≠ `origin/main`, stops before building (check both locally; it must never reach the `ssh` step in these checks).
- [x] No `ghcr` references outside `docs/`.

## Owner steps after review (not for the implementer)
- Push to `main` (CI runs tests only; nothing deploys).
- First deploy: from Git Bash in the repo, run `scripts/deploy.sh`. The VPS currently runs a GHCR image, so the first `.previous-sha` points at an image that isn't in the new naming; rollback works from the second deploy on (same caveat as the old pipeline). Keep the backup it copies down.
- Optional clean-up: on the VPS `docker logout ghcr.io`; in GitHub, delete the `VPS_SSH_KEY` secret and the private GHCR package.

## Implementation notes (implementer)
- Commits:
  - Plan 001: Local image build & deploy script, CI publish removal, compose default update
- Test Pass/Fail counts:
  - `npm run typecheck`: Passed (0 errors)
  - `npm test`: 12 test files passed, 126 unit tests passed (0 failures)
  - `npm run build`: Next.js production build succeeded with Turbopack, static pages generated
  - `npm run test:int`: 7 test files passed, 31 integration tests passed (0 failures)
- Verification:
  - `docker compose config` validated: resolved image is `engineering-os:current`.
  - `bash -n scripts/deploy.sh` & `bash -n scripts/rollback.sh`: 0 syntax errors.
  - Tested `scripts/deploy.sh` with dirty tree: halted immediately with error before building or calling SSH.
  - Tested `scripts/deploy.sh` with HEAD != origin/main: halted immediately with error before building or calling SSH.
  - Grep for `ghcr` confirmed 0 remaining occurrences outside `docs/` and `plans/` / `PROJECT.md`.
- Follow-ups (2026-09-29):
  - F1: Fixed git index mode for `scripts/rollback.sh` via `git update-index --chmod=+x scripts/rollback.sh`. Confirmed `git ls-files -s scripts/` reports `100755` for `rollback.sh` (and `deploy.sh`, `backup.sh`, `restore.sh`).
  - F2: Updated `scripts/deploy.sh` to capture `REMOTE_EXIT` from SSH invocation (`|| REMOTE_EXIT=$?`) without aborting, proceed to fetch the newest backup via SSH/SCP to local `backups/`, and then exit with `REMOTE_EXIT` if non-zero while reporting backup location. Tested failure progression and verified syntax with `bash -n`.
  - F3: In `scripts/deploy.sh`, on remote deploy failure (`REMOTE_EXIT -ne 0`), SSH reads `${VPS_DIR}/.deployed-sha`. Only prints the rollback command if it matches `LOCAL_SHA` (indicating container swap occurred). Otherwise prints "Live app unchanged; no rollback needed."
  - F4: In `scripts/deploy.sh`, tests `scp` success directly; sets `LOCAL_BACKUP_PATH` and prints "Downloaded" only when `scp` succeeds. On failure or missing backup, prints a loud `WARNING: backup was NOT copied off the VPS!` and exits non-zero (`exit 1` or `REMOTE_EXIT`). On the failure path, prints "Newest VPS backup" instead of "Pre-deploy backup". Checked syntax with `bash -n` (0 errors). Traced both branches in code review. No throwaway/separate test VPS was available, so never connected or ran against the live VPS.
- Tool notes:
  - `sequential-thinking` MCP server has no registered tools in environment; step 3 flow analysis was performed directly using analytical steps.
  - Shell scripts saved with LF line endings and executable mode (+x).

## Review (Claude)
**2026-09-29 — reviewed `f0c0caf`. Verdict: nearly there; two follow-ups before REVIEWED.**

**Checked**
- Diff matches steps 1–5:
  - `publish` job removed; `deploy.yml` deleted.
  - Compose default is `engineering-os:current`.
  - `deploy.sh` runs in the planned order: clean/pushed check → build → ship → pull → backup → `.previous-sha` → swap → `.deployed-sha` → health → prune → copy backup.
  - `rollback.sh` needs no registry and refuses clearly.
- Constraints respected: `Dockerfile`, `entrypoint.sh`, `backup.sh`, `restore.sh` and the `db` service are untouched; no secrets; env defaults as specified.
- `bash -n` on both scripts: OK.
- `git grep -i ghcr` outside `docs/` and `plans/`: only `PROJECT.md`, now rewritten (below).
- Tests (Claude): `npm run typecheck` pass; `npm test` 126/126 pass. `test:int` and `build` not re-run (Docker Desktop stopped); the diff has no TypeScript, and the implementer reported 31/31 and a green build.
- code-review-graph: not applicable (YAML/shell are not indexed, as the plan says).
- Implementer honestly reported that `sequential-thinking` was unavailable in their environment.
- VPS read-only check (2026-09-29):
  - Clean tree at `06cdd68`.
  - `.deployed-sha` = `06cdd68…`; no `.previous-sha`.
  - Only `ghcr.io/n8nmonk-wq/engineering-os:06cdd68…` is loaded.
  - `scripts/rollback.sh` is `-rw-r--r--` (not executable).

**Follow-ups (implementer)**
- [x] **F1 (must): `rollback.sh` is not executable in git.** It is committed as `100644`; the notes say +x, but this repo has `core.fileMode=false` on Windows, so the chmod never reached git. On the VPS, `./scripts/rollback.sh`, which is also the command `deploy.sh` prints, fails with "Permission denied" exactly when a rollback is needed. Fix: `git update-index --chmod=+x scripts/rollback.sh` and commit. Verify with `git ls-files -s scripts/` showing `100755` for `deploy.sh` and `rollback.sh`.
- [x] **F2 (should): the backup is only copied off the VPS when the deploy succeeds.** If the health check fails, the remote script exits non-zero, `set -e` stops `deploy.sh` locally, and step 5 (scp of the newest backup) never runs. That is the one case where the off-box copy matters most. Fix: run the remote block without aborting (capture its exit code), always fetch the newest backup, then exit with the remote exit code. Acceptance: with the remote block forced to fail (e.g. a bad `VPS_DIR` after the backup line, tested only against a local or throwaway host, **never the VPS**), the script still reaches the backup-fetch step before exiting non-zero. If no safe host is available, reason it through with `bash -n` plus a code read and say so in notes.

**2026-09-29 — re-review of `1097628` (F1/F2)**

**Checked**
- F1 is correct: `git ls-files -s scripts/` shows `100755` for all four scripts.
- F2 exit-code capture works. I tested the exact pattern (`cmd << 'EOF' || RC=$?` under `set -euo pipefail`) locally; it continues with `RC=7`.
- `bash -n scripts/deploy.sh`: OK.

**F2 introduced two misleading messages. Both matter on a live deploy:**
- [x] **F3 (must): don't suggest a rollback when the app was never swapped.**
  - The failure block always prints the rollback command. If the deploy fails *before* the swap (e.g. `git pull` or `backup.sh` fails), the live app is still the good current release.
  - Running `rollback.sh` at that point would switch production to the *older* release in `.previous-sha`.
  - Fix: after a failure, read the VPS `.deployed-sha` over ssh. Print the rollback command only if it equals `LOCAL_SHA`, meaning the swap happened. Otherwise print "Live app unchanged; no rollback needed."
- [x] **F4 (must): don't claim a backup was copied when it wasn't.**
  - `scp … || true` followed by an unconditional "Downloaded backup to …" reports success even when the copy failed. On the success path, a failed copy used to stop the script; now it is silent. The off-box backup is a release rule (`CLAUDE.md`).
  - Fix: set `LOCAL_BACKUP_PATH` and print "Downloaded" only when `scp` succeeds. Otherwise print a loud `WARNING: backup was NOT copied off the VPS` and make the script exit non-zero at the end, even on an otherwise healthy deploy.
  - On the failure path, also stop calling it "Pre-deploy backup" unless the remote got past `backup.sh`. Simplest: call it "Newest VPS backup" and print its timestamped name.

**Acceptance for F3/F4**
- `bash -n` passes.
- A code read shows both branches.
- Test against a local or throwaway host only, **never the VPS**. If none is available, say so in notes.

**Claude, done in this review**
- `PROJECT.md` §6 rewritten for the local-build deploy, including the one-line first-deploy re-tag that makes rollback work from the first deploy. The debt line in §9 is updated, and the two archive docs are labelled historical.

**2026-09-29 — re-review of `e3a43a8` (F3/F4). Verdict: REVIEWED.**
- `scripts/deploy.sh` blob `4bc1958` is identical to the version reviewed before it was committed.
- F3: the rollback hint appears only when the VPS `.deployed-sha` equals the new sha; otherwise it prints "Live app unchanged; no rollback needed."
- F4: "Downloaded" is printed only on a successful `scp`; otherwise a loud warning and a non-zero exit, even on a healthy deploy.
- `bash -n` OK; both scripts `100755`.
- Known edge, accepted: a failure after `docker tag … current` but before `compose up` leaves `current` pointing at the new image. PROJECT.md §6 says to use the scripts; the next deploy or rollback re-tags it.
- Owner: first-deploy re-tag on the VPS is done (verified 2026-09-29: `engineering-os:06cdd68…` present, same image ID as the running GHCR image).
