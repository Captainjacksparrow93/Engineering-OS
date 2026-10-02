# Engineering OS — Agent Rules

Engineering OS: ACS Engitech's internal project-management app (Next.js, Prisma, Postgres). Read [PROJECT.md](PROJECT.md) for the stack, hosting and deploy overview.

## The app is LIVE in production

Real employees of ACS Engitech use it every day at the VPS (`72.62.248.38`, `/root/engos-docker`). Treat every change as a production change.

- **Never push to `main` yourself.** Pushing to `main` runs CI, and a green CI auto-deploys to the live server. Make **local commits only**. The user relays the work to Claude for review, and the push happens after that, only when the user explicitly says so.
- **Schema changes go through migrations only.** Create schema changes with `npx prisma migrate dev --name <change>`. Permission and data changes must be hand-written SQL migrations created with `npx prisma migrate dev --create-only --name <change>`, inserting new permission keys into `core_permissions` (`ON CONFLICT (key) DO NOTHING`) and joining roles and permissions by `key` (never hard-code IDs). Never add new `grant-*.ts` scripts to `entrypoint.sh`. Never use `prisma db push` against any shared or production database. Migrations must be additive or come with a written, rehearsed data plan. Never drop or rename a column that holds live data in the same release that stops using it.
- **Never touch production data or the VPS.** No SSH, no scripts against the live DB. Claude does data operations and cut-overs, following `docs/archive/deployment-runbook.md`, after a backup and only with the user's approval.
- **`entrypoint.sh` runs on every container start.** Anything added there must be idempotent and additive: upsert only, never delete or overwrite user data. One-off data fixes go in `prisma/scripts/` and are run by hand.
- **Passwords:** never hardcode, log, audit or commit a password. Passwords live only in the database (hashed); the old `logins.csv` and its startup reset script were removed (plan 002). Never add a password file or a startup step that sets passwords.
- Never run `docker compose down -v` or delete Docker volumes.
- Never commit, push, copy into an image, or print credential/key files (service-account JSON, `.env`, API keys).

## On Every Session Start
- Read `plans/INDEX.md` and the plan you're working on. The plans, this file and git history are the project memory. Older plans live in `docs/`.
- The code-review-graph is pre-built; use it for navigation instead of reading full files.
- Token Savior is indexed; prefer `get_structure_summary` / `get_function_source` over reading whole files.

## On Every Commit (Automatic)
- The code-review-graph updates incrementally via post-commit hook.
- Record what changed, why, and any decisions in the plan's "Implementation notes".

## Tools — use these instead of reading whole files
- **code-review-graph** — navigation and blast radius. `query_graph_tool` (callers_of / importers_of), `get_impact_radius_tool`, `get_affected_flows_tool`. Run this before editing anything shared.
- **Token Savior** — targeted reads. `find_symbol`, `get_function_source`, `get_full_context`. Never `cat` a whole file when a symbol lookup will do.
- **sequential-thinking** — `mcp__sequential-thinking__sequentialthinking` for tricky logic, multi-step changes and hard bugs. Think it through before editing, not after.
- **ponytail** — the laziness posture (see Coding Standards).
- If a tool is missing or fails, say so explicitly. Never claim you used one when you didn't.

## Coding Standards
- Ponytail (full) is the default posture: stdlib first, no unnecessary abstractions. Fix the root cause once in the shared function; deletion over addition.
- TypeScript strict: no `any`, no `as unknown as` casts. Validate input at the boundary.
- Reuse existing helpers, components (Ant Design) and installed packages before adding anything. No new dependencies without asking.
- This Next.js version has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Every service change ships with an integration test covering allow, deny, the happy path and validation failure.
- UI text (labels, buttons, errors, empty states, help text): follow the `ux-writing` skill.
- UI/visual changes (layout, tables, forms, accessibility, responsive): follow the `impeccable` skill.
- Database changes are **additive only** (see the migration rule above). User data must survive every restart, rebuild and deploy.
- Tests: `npm run typecheck && npm test && npm run build` and `npm run test:int` (needs the local Postgres from `docker-compose.local.yml`) must all pass before every commit and before marking a plan DONE.
- Before marking a plan DONE, run `npm run test:int` against a fresh database built like CI: empty DB, `npx prisma migrate deploy`, `npm run db:seed`. Use a throwaway database, not the dev one. A production copy can differ from the seed (e.g. edited checklist hours), so tests must not rely on data only the production copy has.

## Skills to Use
- `ponytail` (full): default posture on every coding task.
- `tdd`: write each plan's tests first (red → green), then implement.
- `sequential-thinking`: for tricky logic or multi-step changes, think it through before editing.
- `diagnosing-bugs`: when a test fails or something breaks, diagnose the root cause instead of guessing fixes.
- `review-delta`: self-review your changes and their blast radius before setting a plan to DONE.
- `ux-writing` for UI text and `impeccable` for UI/visual changes (see Coding Standards).

## Two-Agent Workflow (you = implementer)
- Claude (Claude Desktop) writes plans in `plans/NNN-*.md`. You (Antigravity or another implementer AI) implement them. Parked modules: HRMS and Gate. Do not start them. **ERP is active** (plans 012 onward), under the rules in "ERP work" below.
- Never touch `plans/done/` (verified plans). Do not write or restructure plans. You may only tick checkboxes, change **Status**, and fill "Implementation notes".
- Pick plans in order from `plans/INDEX.md`. Update the Status there as well as in the plan file.
- Set Status to IN PROGRESS when starting, DONE when finished. Follow the plan; if it's wrong, stop and note why in "Implementation notes" instead of improvising.
- Do ONLY the steps the plan (or the user) scopes you to. Don't range ahead.
- Line numbers in plans go stale; search for the quoted code.
- Run the FULL test suite before setting DONE, and paste the pass/fail counts into "Implementation notes".
- Set Status DONE only if every acceptance box is ticked; otherwise list what is left.
- Commit locally only, small commits referencing the plan (e.g. `plan 003: step 2 ...`).
- Only one agent works at a time: always leave the tree clean (committed) when you finish.

## Running the App
- Development: run locally, never Docker by default (except the local Postgres).
  - Setup: `npm install`, then `docker compose -f docker-compose.local.yml up -d` for Postgres, then `npx prisma migrate dev`.
  - Start: `npm run dev`
  - Tests: `npm run typecheck && npm test && npm run build`, plus `npm run test:int`
- Other Docker use ONLY when the user explicitly says so, or when an ERP plan step tells you to run the local ERPNext stack.

## ERP work (branch `erp`)
ERPNext (v16.37.0) runs as a **separate** set of containers next to Engineering OS, never inside `engos_app`. People use ERPNext's own screens (restyled by our custom Frappe app `acs_erp`) and reach them from our app with one-click sign-in. Our app talks to ERPNext over its REST API. The full decisions are in `CLAUDE.md` ("ERP").
- **Branch:** every ERP commit goes on `erp` (`git checkout erp` before you start). Never merge `erp` into `main`, never merge `main` into `erp`, and never push; the user and Claude do that. A merge to `main` deploys to production.
- **Local ERPNext only:** run ERPNext on this PC with the official `frappe_docker` (pinned tag, `ERPNEXT_VERSION=v16.37.0`) in a folder **outside the repo**: `C:\Users\Dhruv-Home\erpnext-local`. Bind its port to `127.0.0.1` only. Don't use `pwd.yml` (evaluation only) unless the plan says so.
- **Never touch the VPS** (no SSH, nothing on `72.62.248.38`). VPS steps in ERP plans belong to Claude.
- **Secrets:** generate ERPNext passwords and API keys yourself. Keep them only in `C:\Users\Dhruv-Home\erpnext-local\.env`, never in the repo, plan notes, commits or chat. In notes, write the `.env` **key names**, never values.
- **Follow the official docs** for `frappe_docker` and the Frappe REST API (current versions). If a plan step doesn't match what ERPNext actually does, stop and write what you found in Implementation notes instead of improvising.
- **Test the code that's actually running:** every rebuild of the `acs-erpnext` image gets a **new tag** (`…-acs2`, `-acs3`, …). Recreate the ERPNext containers on it and run `bench --site frontend migrate` before you verify anything, and write the running tag in the notes.
- **Frappe permissions gotcha:** adding **any** Custom DocPerm to a DocType makes Frappe ignore that DocType's standard permissions for every role. Don't add Custom DocPerms in fixtures; use standard roles.
- **Verify in a real browser,** signed in through our SSO as each affected role, not only with scripts.
- **Don't stop the live-app pieces** you share the PC with: leave `engos_local_db` / `engos_local_app` running, and never run `docker compose down -v`, `docker system prune` or `docker volume rm`.
