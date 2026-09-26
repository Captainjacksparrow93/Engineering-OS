# Engineering OS — Agent Rules

Engineering OS: ACS Engitech's internal project-management app (Next.js, Prisma, Postgres). Read [PROJECT.md](PROJECT.md) for the stack, hosting and deploy overview.

## The app is LIVE in production

Real employees of ACS Engitech use it every day at the VPS (`72.62.248.38`, `/root/engos-docker`). Treat every change as a production change.

- **Never push to `main` yourself.** Pushing to `main` runs CI, and a green CI auto-deploys to the live server. Make **local commits only**. The user relays the work to Claude for review, and the push happens after that, only when the user explicitly says so.
- **Schema changes go through migrations only.** Create schema changes with `npx prisma migrate dev --name <change>`. Permission and data changes must be hand-written SQL migrations created with `npx prisma migrate dev --create-only --name <change>`, inserting new permission keys into `core_permissions` (`ON CONFLICT (key) DO NOTHING`) and joining roles and permissions by `key` (never hard-code IDs). Never add new `grant-*.ts` scripts to `entrypoint.sh`. Never use `prisma db push` against any shared or production database. Migrations must be additive or come with a written, rehearsed data plan. Never drop or rename a column that holds live data in the same release that stops using it.
- **Never touch production data or the VPS.** No SSH, no scripts against the live DB. Claude does data operations and cut-overs, following `docs/deployment-runbook.md`, after a backup and only with the user's approval.
- **`entrypoint.sh` runs on every container start.** Anything added there must be idempotent and additive: upsert only, never delete or overwrite user data. One-off data fixes go in `prisma/scripts/` and are run by hand.
- **Passwords:** never hardcode, log, audit or commit a password. `prisma/data/logins.csv` is being retired (see `docs/client-requests-2026-09-25.md`, section 0 E). Do not add people to it.
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

## Skills to Use
- `ponytail` (full): default posture on every coding task.
- `tdd`: write each plan's tests first (red → green), then implement.
- `sequential-thinking`: for tricky logic or multi-step changes, think it through before editing.
- `diagnosing-bugs`: when a test fails or something breaks, diagnose the root cause instead of guessing fixes.
- `review-delta`: self-review your changes and their blast radius before setting a plan to DONE.
- `ux-writing` for UI text and `impeccable` for UI/visual changes (see Coding Standards).

## Two-Agent Workflow (you = implementer)
- Claude (Claude Desktop) writes plans in `plans/NNN-*.md`. You (Antigravity or another implementer AI) implement them. Parked modules: ERP, HRMS and Gate. Do not start them.
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
- Other Docker use ONLY when the user explicitly says so.
