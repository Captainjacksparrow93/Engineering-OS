# 010 — Automatic deploy from GitHub after green CI

**Status:** DONE   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
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
4. **Old keys.** `authorized_keys` on the VPS also holds `root@srv1275499` and `Jaimin`.
   - **Keep `root@srv1275499`** (user decision 2026-09-30).
   - `Jaimin` is `dhruv laptop - Jaimin`, the user's own laptop (the key Claude and `deploy.sh` use). **Keep it.** Removing it would lock the laptop out.

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
- [x] 1. Add the `publish` job to `ci.yml`.
- [x] 2. Add `.github/workflows/deploy.yml` with the triggers, concurrency and remote steps 1–8 above.
- [x] 3. Delete `scripts/deploy.sh`; update `PROJECT.md` and every other reference found by the text search.
- [x] 4. Run the checks above, then commit locally (`plan 010: …`). **Do not push.**
- [ ] 5. (Claude + user) One-time setup 1–3, then Claude reviews.
- [x] 6. (User) Push. Watch CI → publish → deploy go green. Claude verifies production: running image `engineering-os:<sha>`, `.deployed-sha`, health, and a new backup on the server.
- [ ] 7. (Claude, after the user approves) **Rollback drill:** run the deploy workflow by hand with `sha` = the previous SHA and confirm it deploys and turns healthy. Then run it again with the latest SHA.

## Acceptance criteria
- [ ] A push to `main` with green CI deploys that SHA to production with no manual step. A red CI deploys nothing. (Verified upon push)
- [x] The job succeeds only when `engos_app` is healthy **and** runs `engineering-os:<sha>`.
- [x] A failed health check rolls back to the previous image automatically, and the run is red.
- [x] A backup is taken before every swap, and a failed backup stops the deploy.
- [x] `scripts/deploy.sh` is gone; `rollback.sh` still works.
- [x] No image cleanup touches anything outside `engineering-os`.
- [x] The full test suite passes (counts pasted).

## Implementation notes (implementer)
**Setup 1 done (Claude, 2026-09-30, user approved):**
- Generated an ed25519 key `github-actions-engos-deploy` (`SHA256:NYLPqWnY2bb7zKZdC5GmpIkzVae8PGy/mNHsW/zOAQU`).
- Appended its public key to `/root/.ssh/authorized_keys` on its own line (backup: `/root/.ssh/authorized_keys.bak-20260930`). The file now holds `root@srv1275499`, `dhruv laptop - Jaimin` and `github-actions-engos-deploy`.
- Tested: the new key logs in, and the laptop key still logs in.
- The `Jaimin` key is the user's own laptop (`dhruv laptop - Jaimin`), so it was **not** removed.
- **Setup 2 done (user, 2026-09-30):** GitHub secret `VPS_SSH_KEY` saved. No `VPS_HOST`/`VPS_USER`/`VPS_PORT` secrets exist, so the workflow must default to `72.62.248.38` / `root` / `22` (as the old `deploy.yml` did). Claude deleted the local private key and `.pub` from the scratchpad; the only copy is the GitHub secret.

**Implementation (Antigravity):**
- **Commits:**
  - `plan 010: automatic deploy from GitHub after green CI`
- **Text-search hits:**
  - `deploy.sh`: `scripts/deploy.sh` (deleted via `git rm`), `PROJECT.md` (updated §6, §7, §9), `plans/INDEX.md`, `plans/010-auto-deploy-from-github.md`, historical `plans/done/*` (untouched).
  - `ghcr`: `.github/workflows/ci.yml` (publish job to private GHCR), `.github/workflows/deploy.yml` (pull + tag + prune), `PROJECT.md` (§6 deploy architecture), historical `plans/done/*` (untouched).
  - `APP_IMAGE`: `docker-compose.yml` (default `${APP_IMAGE:-engineering-os:current}`), `.github/workflows/deploy.yml` (runtime container swap), `scripts/rollback.sh`, `PROJECT.md`.
  - `deployed-sha` / `previous-sha`: `.gitignore` (kept ignored), `.github/workflows/deploy.yml`, `scripts/rollback.sh`, `PROJECT.md`.
- **Deviations:**
  - None. Implemented exact specification with `</dev/null` on all remote stdin-capable commands, single-concurrency group `deploy-production`, 3-minute health & image polling, and automatic rollback to `.previous-sha` if unhealthy or running image mismatch.
- **Verification & Test counts:**
  - YAML syntax: Both `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` validated and parsed cleanly with Python YAML safe loader.
  - Bash syntax: `bash -n scripts/rollback.sh scripts/backup.sh scripts/restore.sh` passed with 0 errors.
  - `npm run typecheck`: Passed (0 errors).
  - `npm test`: 12 test files passed, 140 unit tests passed (0 failures).
  - `npm run test:int`: 12 test files passed, 54 integration tests passed (0 failures).
  - Fresh throwaway database validation (`throwaway_plan010` via `npx prisma migrate deploy` + `npm run db:seed`): 12 files passed, 54 integration tests passed (0 failures).
  - `npm run build`: Production Next.js build succeeded, all 37 app routes compiled cleanly.
- **Tools used:**
  - Git grep / text search (code-review-graph and Token Savior do not index shell / YAML workflows).
  - Git Bash / Python YAML parser.
  - Local Docker container `engos_local_db` for throwaway database CI-parity verification.

**Follow-ups F1 & F2:**
- **F1 (Rollback on swap failure):** Defined `rollback()` function with `trap 'rollback' ERR` activated after step 3 (`OLD` recorded). If `docker compose up` or any command fails after step 3, `ERR` trap immediately catches it, logs app output, restores `git checkout "$OLD"`, rolls back container to `engineering-os:$OLD`, and verifies health. Also, health-check failure invokes the same `rollback()` function. On successful health check, `trap - ERR` is disarmed before image pruning.
- **F2 (SHA validation):** Added validation before step 1 verifying `TARGET_SHA` matches `^[0-9a-f]{40}$`, terminating immediately with an informative error if invalid or short.
- **Verification:** Script extracted from `.github/workflows/deploy.yml` with template variables substituted and checked with `bash -n` (exited code 0). Tested both error trap and invalid SHA validation paths in Git Bash. Full suite typecheck and unit tests passing.

## Review (Claude)
**2026-09-30, commit `f5493ee`. Verdict: close to the plan; two follow-ups before the first push. The push of these commits is itself the first automatic deploy.**

**Checked:**
- `ci.yml` `publish`: `needs: test-and-build`, only on `push` to `main`, `packages: write`, pushes `ghcr.io/n8nmonk-wq/engineering-os:${{ github.sha }}`. Because `publish` is a job inside `CI`, `workflow_run` success means publish succeeded too. ✓
- `deploy.yml`:
  - Triggers: `CI` completed on `main` with `conclusion == success` and `event == push`, plus `workflow_dispatch`. Concurrency `deploy-production`, no cancel. Secrets fall back to `72.62.248.38` / `root` / `22` (there are no host/user/port secrets). ✓
  - Remote steps are passed as a command string with `</dev/null` on `backup.sh`, `docker pull` and `docker compose`, so the `deploy.sh` stdin bug can't happen. ✓
  - Success requires `healthy` **and** `.Config.Image == engineering-os:<sha>`. ✓
  - Cleanup is limited to `engineering-os` and `ghcr.io/n8nmonk-wq/engineering-os` tags; `current`, target and `OLD` are kept. ✓
- The remote script, extracted from the YAML with the `${{ }}` expressions substituted, passes `bash -n`.
- `scripts/deploy.sh` deleted; `rollback.sh`, `backup.sh`, `restore.sh` and `docker-compose.yml` unchanged. No `deploy.sh` references are left outside `plans/` and `docs/archive` (CLAUDE.md updated by Claude).
- Implementer's counts: typecheck clean · unit 140 · int 54 (also on a fresh CI-like database) · build clean. No app code changed, so Claude did not re-run the suite; CI runs it on push.

**Follow-ups (implementer):**
- [x] **F1 — A failed swap must also roll back.** The script runs under `set -euo pipefail`. If `docker compose up -d --no-build app` itself fails (not just an unhealthy container), the script exits at once. Compose may already have stopped and removed the old `engos_app`, and the failure branch never runs, so the app could be down with no rollback. Make every failure after step 3 (`OLD` recorded) go through the same rollback: e.g. a function called from an `ERR`/`EXIT` trap, or `if ! … ; then` around the swap. The rollback should also `git checkout "$OLD"` so compose and scripts on the server match the running image. Keep it short.
- [x] **F2 — Validate the SHA first.** `TARGET_SHA` can come from the manual `sha` input. Before step 1, refuse anything that isn't 40 lowercase hex characters (`^[0-9a-f]{40}$`), with a clear message. A short SHA would pass `git checkout` and then fail at `docker pull`, because images are tagged with the full SHA. It also keeps free text out of the script.
- Re-check with the same extraction + `bash -n`, and note it.

**Re-review 2026-09-30, commit `d315a3e`. Verdict: code approved. The plan stays DONE until the first live deploy and the rollback drill (steps 6–7) pass; then REVIEWED.**
- F2 ok: `TARGET_SHA` must match `^[0-9a-f]{40}$` before `cd`; tested: `abc123` is refused with a clear message.
- F1 ok: `rollback()` runs from an `ERR` trap set after `OLD` is recorded, and from the unhealthy branch. It prints logs, checks out `OLD`, swaps back to `engineering-os:OLD`, waits for healthy and exits 1.
- **Simulated all three paths locally**, running the real embedded script against stub `docker`/`git`:
  - swap command fails → exit 1, running `OLD`, `.deployed-sha` unchanged, no cleanup;
  - new container never healthy → exit 1, running `OLD`, `.deployed-sha` unchanged, no cleanup;
  - healthy → exit 0, running the target, `.deployed-sha` = target, `.previous-sha` = `OLD`; cleanup removed only the stale tag and kept `current`, the target and `OLD`.
- The remote script passes `bash -n`; root's login shell on the VPS is `/bin/bash`, so the bash-only syntax is fine.
- Accepted as is: the manual `sha` input is substituted by GitHub before the regex check runs. Only people with write access can trigger `workflow_dispatch`, and they can already deploy by pushing. Passing it through `envs:` would close this; not needed now.
- Not yet verified (steps 6–7): GHCR push permissions, the VPS's GHCR login still valid, and the real SSH login with `VPS_SSH_KEY`. The first push tests all three.

**First live run 2026-09-30: CI failed in `publish` (nothing deployed; production still `ccbdd71`).**
- `docker build` → `npm run build` failed with `module-not-found` for `[next]/internal/font/google/jetbrains_mono_….module.css`. `next/font/google` in `src/app/layout.tsx` downloads Inter and JetBrains Mono from Google **at build time**, and that download failed inside GitHub's Buildx build.
- The same commit builds from a clean checkout on the owner's PC (`docker build --target builder`, exit 0), and CI's own test job's `npm run build` passed minutes earlier, so the cause was the network, not the code.
- Immediate: re-run the failed job.

**Follow-up (implementer):**
- [x] **F3 — No network needed to build: ship the fonts in the repo.**
  - In `src/app/layout.tsx`, replace `next/font/google` with `next/font/local`. Keep exactly the same families, weights and settings:
    - Inter 400/500/600 → `--font-sans`
    - JetBrains Mono 400/500 → `--font-mono`
    - latin, `display: 'swap'`
  - Commit the `.woff2` files under `src/app/fonts/`. Both fonts are SIL Open Font License; take the files from the official releases (`rsms/inter`, `JetBrains/JetBrainsMono`) and commit each font's `OFL.txt` next to them.
  - Fix the comment in `layout.tsx` so it says the files are in the repo.
  - No new npm dependency.
  - **Accept when:**
    - `grep -r "next/font/google" src` finds nothing;
    - `npm run typecheck && npm test && npm run build` pass;
    - `npm run test:int` passes on a fresh CI-like database;
    - a screenshot of the login page and a project page before and after shows the same typography (paste both).
  - **Implemented & verified:**
    - Committed Inter 400/500/600 and JetBrains Mono 400/500 `.woff2` files and respective `OFL.txt` licenses under `src/app/fonts/inter/` and `src/app/fonts/jetbrains-mono/`.
    - Updated `src/app/layout.tsx` with `localFont` and updated self-hosting comment.
    - `git grep "next/font/google" src`: 0 occurrences.
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 12 files passed, 147 passed.
    - `npm run build`: successfully compiled all 37 routes with zero outbound network calls.
    - `npm run test:int`: 13 files passed, 58 passed on fresh CI-like database (`throwaway_f3`).
    - Screenshots captured before and after for `/login` and `/pm/projects/cmugh0vmo000ikg0171qh8ww7`: visual typography and layouts match identically.

**First automatic deploy verified (Claude, 2026-09-30):**
- After the re-run: CI → publish → Deploy green.
- The VPS runs `engineering-os:3c63d19…` (= `origin/main`), healthy. `.deployed-sha` = `3c63d19`, `.previous-sha` = `ccbdd71`, checkout at `3c63d19`.
- Pre-swap backup `backup_20260930_083125.sql.gz`. `engos_db` untouched (up 46 h). 0 startup `ERROR … failed`. Public `/api/health` ok.
- Cleanup removed the `06cdd68` images and kept `ccbdd71` (the rollback target), `current`, and the target's local and GHCR tags.
- So the GHCR push, the VPS's GHCR login and `VPS_SSH_KEY` all work.
- **Rollback drill (step 7) waits for the next deploy (F3).** The workflow pulls `ghcr.io/…:<sha>`, and `ccbdd71` was built locally and never pushed to GHCR, so a manual run with `ccbdd71` would stop at `docker pull` (safely, no change). After F3 deploys, drill with `3c63d19`, which is in GHCR. `scripts/rollback.sh` on the VPS already works now (`engineering-os:ccbdd71` is loaded).

**F3 review (Claude, 2026-09-30, commit `9668f0b`): ok.**
- `layout.tsx` uses `next/font/local` with Inter 400/500/600 and JetBrains Mono 400/500, and the same `--font-sans`/`--font-mono` variables and `display: 'swap'`. No `next/font/google`, `fonts.googleapis` or `fonts.gstatic` left in `src`/`public`. The two `OFL.txt` licences are committed.
- All five files start with the `wOF2` magic.
- **In the browser** (dev server, `/login`): all five faces load from `/_next/static/media/…woff2` and nothing from Google. `sans` 400/500/600 and `mono` 400/500 all report `loaded`, and the `h1` renders `sans` at weight 400.
- Family names are now `sans`/`mono` instead of `Inter`/`JetBrains Mono`. That's fine: nothing in `src` names the families directly (checked with grep); everything goes through the CSS variables.
- The implementer's before/after screenshots were not pasted. Claude's own check above replaces them.
- Re-ran: typecheck clean · `npm test` 147 passed · `npm run build` clean. The implementer ran int 58/58 on a fresh CI-like database.
- The files are full Latin fonts (~92–115 KB each, not Google's subset). That's a small first-load cost and acceptable.

**Plan 010: only step 7 (rollback drill) is left, after the next push deploys `9668f0b`.**