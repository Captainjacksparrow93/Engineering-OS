# Engineering OS: rules for coding agents

Read [PROJECT.md](PROJECT.md) for the stack, hosting and deploy overview.

## The app is LIVE in production

Real employees of ACS Engitech use it every day at the VPS (`72.62.248.38`, `/root/engos-docker`). Treat every change as a production change.

- **Never push to `main` yourself.** Pushing to `main` runs CI, and a green CI auto-deploys to the live server. Make **local commits only**. The user relays the work to Claude for review, and the push happens after that.
- **Schema changes go through migrations only.** Create them with `npx prisma migrate dev --name <change>` and commit the folder. Never use `prisma db push` against any shared or production database. Migrations must be additive or come with a written, rehearsed data plan. Never drop or rename a column that holds live data in the same release that stops using it.
- **Never touch production data or the VPS.** No SSH, no scripts against the live DB. Claude does data operations and cut-overs, following `docs/deployment-runbook.md`, after a backup.
- **`entrypoint.sh` runs on every container start.** Anything added there must be idempotent and additive: upsert only, never delete or overwrite user data. One-off data fixes go in `prisma/scripts/` and are run by hand.
- **Passwords:** never hardcode, log, audit or commit a password. `prisma/data/logins.csv` is being retired (see `docs/client-requests-2026-09-25.md`, section 0 E). Do not add people to it.

## Before every commit

Run `npm run typecheck && npm test && npm run build`. Also run `npm run test:int` (it needs the local Postgres from `docker-compose.local.yml`). All of them must pass. Every service change ships with an integration test covering allow, deny, the happy path and validation failure.

## How work is split

Claude plans and reviews; the plans live in `docs/`. Antigravity implements them. Follow the plan's "For Antigravity" section, including the required toolchain. Line numbers in plans go stale, so search for the quoted code. Parked modules: ERP, HRMS and Gate. Do not start them.
