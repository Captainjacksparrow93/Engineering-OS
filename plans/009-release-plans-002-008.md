# 009 — Release plans 002–008 to production

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Runs it:** the user (push, `deploy.sh`) and Claude (backup, rehearsal, production checks, each after the user approves)
**Depends on:** 002–008, all REVIEWED.

This is a release runbook, not an implementer plan. Antigravity has no steps here. No application code changes.

## Goal
Ship everything reviewed since the last deploy (plans 002–008) to the live app, without losing data and with a tested way back.

## Where things stand (read-only checks, 2026-09-30)
**Production (VPS `72.62.248.38`, `/root/engos-docker`):**
- Running `engos_app` from `ghcr.io/n8nmonk-wq/engineering-os:06cdd68…` (healthy, `.deployed-sha` = `06cdd68`). The VPS checkout is clean at `06cdd68`, and its `docker-compose.yml` still defaults to the GHCR image.
- `_prisma_migrations`: `20260925000000_baseline`, `20260925000001_service_call`, `20260926150000_revoke_pm_task_create`, all finished, none rolled back. **The R1 baseline cut-over is already done.** The CLAUDE.md note saying production holds only `init` is out of date.
- `pm_projects` indexes include `pm_projects_code_key` (unique) and `pm_projects_workOrderNo_key` (unique, also in `schema.prisma`). There are 0 duplicate project codes.
- 87 `PHASE` rows, of which 0 have `plannedEnd` ≠ the project's `targetEndDate`. Plan 007 therefore shows every existing panel with its project's target date.
- 110 active users. No PM/Assistant Manager still holds `pm.task.create`/`pm.task.adhoc.create`.
- Server resources: 7.8 GiB RAM (4.8 GiB available), 71 GB disk free. The box is shared with Chatwoot, n8n, Supplychain and others.
- Newest on-box backups: `backup_20260926_113349.sql.gz`, plus `local-copy-2026-09-29.sql`.

**Local `main`:** 43 commits ahead of `origin/main` (plans 002–008 plus plan and review commits). CI (`.github/workflows/ci.yml`) runs tests only and **does not deploy**. Deploys are `scripts/deploy.sh` (plan 001).

## What this release changes in production
- **Database: exactly one migration,** `20260929125414_project_code_shared` (plan 005): `DROP INDEX "pm_projects_code_key"` and `CREATE INDEX "pm_projects_companyId_code_idx"`. It only relaxes a rule and loses no data. It runs automatically via `migrate deploy` in `entrypoint.sh` when the new container starts.
- **No permission migration.** Plan 008 reuses `pm.project.create`.
- **Behaviour users will notice:**
  - Project codes shown on screen; flatter UI; plain audit text (004).
  - Shared project codes (005).
  - The engineer picker lists every team (006).
  - Sales Head can no longer request, approve or withdraw handovers (006 F1).
  - Per-panel delivery dates and a Late badge (007).
  - Directors/Heads can edit project and client details; PMs can no longer edit project details via the API (008).
- **Startup:** passwords are no longer reset from a CSV on start (002). `entrypoint.sh` still runs the create-only seed and the three `grant-*.ts` scripts.
- **First deploy with the new mechanism:** the image is built locally and shipped over SSH, and the VPS compose file switches to `engineering-os:current`.

## Constraints
- The app is LIVE. Every step that touches the VPS, other than read-only checks, happens only after the user approves that step.
- Claude never pushes. The user pushes `main` and runs `scripts/deploy.sh`.
- No `prisma db push`, no `docker compose down -v`, no deleting volumes.
- Do not start until every plan 002–008 is REVIEWED in `plans/INDEX.md` and `git status` is clean.

## Tools & skills
- **Read-only production checks:** SSH + `psql` inside `engos_db`, `SELECT` only. Claude may run these without asking (project rule). Anything else on the VPS needs approval.
- **code-review-graph:** not needed. No code changes in this plan. The blast radius for each shipped change is in plans 002–008.
- **sequential-thinking:** used to order the steps (each depends only on earlier steps).
- **Skills:** `ponytail` (no extra tooling; use the existing `backup.sh`, `deploy.sh`, `rollback.sh`).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int`, on local `main`.

## Steps
- [x] **1. Pre-flight (Claude, local).**
  - `plans/INDEX.md`: 001–008 all REVIEWED.
  - `git status` clean.
  - The full suite passes on `main`; paste the counts here. **Run `test:int` against a fresh database built like CI** (empty DB, `migrate deploy`, `db:seed`), not only against the local production copy (lesson from step 3b).
- [x] **2. Fresh backup, copied off the box (Claude, after the user approves).**
  - On the VPS: `cd /root/engos-docker && ./scripts/backup.sh`.
  - Then `scp` the new `backups/backup_<ts>.sql.gz` to local `backups/` and check it is non-empty and that `gunzip -t` passes.
  - Record the filename here.
- [x] **3. Rehearse on a copy of production (Claude, local).**
  1. In the local Postgres container, create a separate database `engos_rehearsal` and restore the step-2 backup into it. Don't restore over the dev database: `restore.sh` pipes into an existing database and does not drop it first.
  2. With `DATABASE_URL` pointing at `engos_rehearsal`, run `npx prisma migrate status`. Expect exactly one pending migration, `20260929125414_project_code_shared`.
  3. Run `npx prisma migrate deploy`, then `migrate status`: expect "up to date". Check that `pm_projects_code_key` is gone and `pm_projects_companyId_code_idx` exists.
  4. Run the startup steps the entrypoint runs: `npx tsx prisma/seed.ts` and the three `prisma/scripts/grant-*.ts`. Expect no `ERROR`.
  5. Run `npm run build && npm start` against it and do the smoke test (step 6 list) locally with real data.
  6. Record any surprise here and **stop** if anything fails.
- [x] **3b. Fix the CI-only test failure (Antigravity), blocker.** On the first push, CI failed in `panel-delivery-dates.int.test.ts:219` (plan 007 F3 test): "rejects panel date with too few working days".
  - **Cause:** the test assumes PLC = 14 working days. CI builds its database from the seed, where PLC is 13 steps × 8 h = 104 h (13 days). 1–15 Oct 2026 has exactly 13 working days, so the project is accepted. Local runs passed because the local database is a production copy, whose PLC template was edited to 112 h.
  - **Fix (test only; no app change):** make the test independent of template data. Pick a panel date clearly too short for any real template (e.g. start `2026-10-01`, PLC Panel 1 due `2026-10-03`), and assert the message pattern `/PLC Panel 1 needs at least \d+ working days/` instead of a fixed number and date. Check the other tests in that file and in `project-edit.int.test.ts` for the same hidden assumption (fixed hours or day counts).
  - **Verify like CI:** run the integration tests against a fresh database built exactly as CI does: an empty database, then `npx prisma migrate deploy`, `npm run db:seed`, then `npm run test:int`. Use a separate throwaway database (e.g. `engos_ci`) so the dev database is untouched. Paste the counts. Commit as `plan 009: step 3b ...`.
- [ ] **4. Push (user).** `git push origin main`, then wait for CI (`ci.yml`) to go green. `deploy.sh` only checks that local HEAD matches `origin/main`. It does not check CI, so don't run it on a red build.
- [ ] **5. Deploy (user, from Git Bash in the repo).** `./scripts/deploy.sh`. It:
  - pulls the repo on the VPS;
  - runs `backup.sh`;
  - swaps to `engineering-os:<sha>`;
  - waits for `healthy`;
  - copies the newest backup down.

  Paste its final summary here. If it prints "Deploy FAILED", go to Rollback.
- [ ] **6. Verify production (Claude read-only, then the user in the browser).**
  - **Claude:**
    - `_prisma_migrations` lists 4 finished migrations.
    - `pm_projects_code_key` is gone.
    - `docker compose logs --tail 200 app` shows no `ERROR` from the seed or `grant-*` scripts.
    - `.deployed-sha` = the pushed SHA.
  - **User, signed in as each role:**
    - **Director:** the dashboard loads. A project page shows the timeline with each panel's "Due" date, equal to the project target, and no false Late badge. Edit details opens and saves a harmless change (e.g. priority, then change it back); it appears in the audit trail in plain words. Edit a client and cancel.
    - **Technical Head:** Edit details is visible on a TECH project.
    - **PM:** no Edit details. The New project form isn't available to them. Handover requests still work.
    - **Engineer:** My Work loads; progress can be logged.
    - **Sales Head:** can see projects; no handover approve or withdraw actions.
    - **New project (Director), on a test work order you then cancel:** per-panel delivery dates default to the target; the engineer picker shows every team.
- [ ] **7. Close out (Claude).**
  - Update the CLAUDE.md migration note: 4 migrations applied, production on the new SHA.
  - Set this plan to REVIEWED and move it to `plans/done/`.
  - Note in `plans/INDEX.md` that 002–008 are live.

## Rollback
- **Code (first choice).** The migration only drops a unique index, and the old code (`06cdd68`) runs fine without it, so the database can stay as it is.
  - `scripts/rollback.sh` **cannot** be used on this first deploy: `.previous-sha` points at `06cdd68`, but that image is named `ghcr.io/n8nmonk-wq/engineering-os:06cdd68fc4c9861c7a811da33ab0ea0e27fbd429`, not `engineering-os:06cdd68…`.
  - Roll back by hand on the VPS: `cd /root/engos-docker && APP_IMAGE=ghcr.io/n8nmonk-wq/engineering-os:06cdd68fc4c9861c7a811da33ab0ea0e27fbd429 docker compose up -d --no-build app`, then `echo 06cdd68fc4c9861c7a811da33ab0ea0e27fbd429 > .deployed-sha`.
  - That image stays on the box: `deploy.sh` cleanup only removes `engineering-os:*` tags.
  - From the next deploy on, `rollback.sh` works normally.
- **Data (last resort, only if data was damaged).** Restore the step-2 backup. Because `restore.sh` does not drop the existing database first, Claude writes the exact drop-and-restore commands at that moment and runs them only with the user's approval.

## Acceptance criteria
- [ ] Production runs the pushed SHA, healthy.
- [ ] `_prisma_migrations` has the 4 migrations; no pending ones.
- [ ] The step-2 backup exists locally and passes `gunzip -t`.
- [ ] Every smoke-test line in step 6 passes.
- [ ] CLAUDE.md migration note updated.

## Notes (whoever runs each step)
**2026-09-30, Claude, steps 1–3:**
- **Step 1:** 001–008 REVIEWED; tree clean at `1321f71`. `npm run typecheck` clean · `npm test` 12 files / 140 passed · `npm run test:int` 12 files / 54 passed · `npm run build` clean.
- **Step 2:** `backups/backup_20260930_063123.sql.gz` (404 KB) taken on the VPS with `backup.sh` and copied to local `backups/` (git-ignored). `gunzip -t` OK; 29 `COPY public.*` blocks.
- **Step 3:**
  - Restored into a fresh local database `engos_rehearsal` (`ON_ERROR_STOP`, exit 0).
  - `migrate status`: exactly one pending migration, `20260929125414_project_code_shared`. `migrate deploy` applied it, and `migrate status` then reports "up to date". `pm_projects_code_key` is gone and `pm_projects_companyId_code_idx` exists.
  - `prisma/seed.ts`, `grant-commissioning-permissions.ts`, `grant-password-reset.ts` and `grant-read-permissions.ts`: all exit 0, no errors.
  - Counts after the startup scripts match production: 110 active users, 42 projects, 87 panels (the seed added nothing).
  - Browser click-through on the copy **not done by Claude**: it needs real employees' passwords, which Claude must not enter. The behaviour is covered by the 54 integration tests. The user may sign in to the copy themselves before pushing (optional). The full role click-through happens in step 6 on production.
- **Step 3b (Antigravity):**
  - Fixed `panel-delivery-dates.int.test.ts:219`: changed panel delivery date to `2026-10-03` with `startDate: '2026-10-01'` (2 working days) and regex to `/PLC Panel 1 needs at least \d+ working days/`, removing the fixed 14 days assumption.
  - Checked `project-edit.int.test.ts`: dates used (`2026-10-25` target / panel dates) provide 17 working days, safely exceeding any template requirement in seed or prod.
  - Verified against a fresh throwaway database `engos_ci` built exactly like CI (`npx prisma migrate deploy` + `npm run db:seed` + `grant-*.ts` scripts):
    - `npm run test:int`: 12 test files passed, 54/54 tests passed.
    - `npm run typecheck`: 0 errors.
    - `npm test`: 12 test files passed, 140/140 tests passed.
  - Dropped throwaway database `engos_ci`.

**Step 3b check (Claude, 2026-09-30, `6d1e436`):** test-only change. PLC Panel 1 is now due `2026-10-03` and the test asserts `/PLC Panel 1 needs at least \d+ working days/`. Verified exactly like CI (no `grant-*` scripts): fresh database `engos_ci_check` → `prisma migrate deploy` → `npm run db:seed` → `npm run test:int` = 12 files / 54 passed. Database dropped afterwards. Ready for step 4.

## Review (Claude)
<verdict>
