# Engineering OS: project handover

**Start here.** This file is the single entry point for anyone (a person or an AI agent) taking over this project. It says what the system is, what it's built with, where it runs, how it's deployed, and how to work on it safely. Other docs go deeper; each one is linked where it's relevant.

Last updated: 2026-09-26.

---

## 1. What it is

Engineering OS is the internal operations platform of **ACS Engitech**, a control-panel manufacturer (PLC/SCADA/HMI automation panels).

- **Live module:** Project Management (projects, panel-wise WBS, task assignment, handovers, approvals, site commissioning, checklists, clients, dashboards, audit).
- **Parked, planning only:** HRMS, ERP, Gate Entry, Production, Quality, Maintenance. They show a "Coming soon" page. Don't start them without the owner's go-ahead.
- **Users:** real ACS employees every day. Production since 2026-09-25.
- **Owner / contact:** GitHub account `n8nmonk-wq` (firmtechno@gmail.com).

## 2. Tech stack

| Layer | Choice | Version |
|---|---|---|
| Language | TypeScript (strict) | 5.9 |
| Web framework | Next.js App Router, server components, Server Actions | 16.x |
| UI | React, Tailwind CSS | 19.x, 3.4 |
| Database | PostgreSQL | 16 (alpine image) |
| ORM / migrations | Prisma | 6.19.3 |
| Validation | Zod (every write, plus env config) | 3.25 |
| Auth | bcryptjs passwords (cost 12) + `jose` signed JWT in an HTTP-only cookie, backed by a `core_sessions` row | |
| AI (optional) | Google Vertex AI Gemini 2.5 Flash, for rationale text in auto-assign (`src/core/ai/vertex.ts`). **Not configured in production;** the feature is skipped when no credentials are set. | |
| Tests | Vitest: unit tests (pure domain) and integration tests (real Postgres) | 3.2 |
| Runtime | Node.js | 22 (Docker image), 20 or 22 locally |
| Container | Docker multi-stage image, Next.js `standalone` output | |
| Hosting | Hostinger VPS, Docker Compose, Traefik for HTTPS | |
| CI/CD | GitHub Actions | |

No other external services, no Redis, no queue. Emails and SMS aren't sent. Notifications are in-app only.

## 3. Architecture in one screen

A **modular monolith on one Postgres database**. Full reasoning: [docs/architecture.md](docs/architecture.md).

```
Browser ──► Server Actions (src/app/actions) ─┐
        └─► REST routes (src/app/api)       ─┴─► Services (src/modules/*/services)
                                                  │  authorisation + rules + transactions
                                                  ├─► Domain engines (pure functions, src/modules/*/domain)
                                                  ├─► Prisma → PostgreSQL
                                                  └─► Platform: audit, events (outbox), notifications (src/core)
```

**Rules that matter:**
- Routes and actions never call Prisma directly. Every service starts with a permission check (`assertCan`, `assertProjectPermission`, `assertTaskPermission`).
- **Permissions are data.** Keys live in `src/core/rbac/permissions.ts`, and roles and grants live in the database (`core_roles`, `core_role_permissions`), scoped GLOBAL, DEPARTMENT or PROJECT. See [docs/rbac.md](docs/rbac.md).
- Every mutation writes an audit row (`core_audit_logs`) in the same transaction.
- Table prefixes: `core_*` shared kernel, `pm_*` project management. Future modules get their own prefix.
- `process.env` is read only in `src/core/config.ts`. The app refuses to boot if the config is invalid.

### Repo layout
```
src/app/(shell)/        pages: dashboard, pm/*, admin/*, notifications, parked-module placeholders
src/app/actions/        Server Actions (UI mutations)
src/app/api/            REST API (docs/api.md); /api/health is the health check
src/core/               auth, rbac, audit, events, notifications, db, config, ai
src/modules/project-management/{domain,services,validation}
src/modules/admin/      people, roles, password reset, audit views
prisma/schema.prisma    28 models
prisma/migrations/      the migration history (baseline 2026-09-25, then forward only)
prisma/migrations-archive/  the old, broken history. Don't use it.
prisma/seed.ts          idempotent seed: permissions, system roles (create-only), org and people
prisma/scripts/         one-off / startup scripts (grant-*.ts run at every start, see §6)
scripts/backup.sh, restore.sh   database backup and restore on the VPS
entrypoint.sh           container start: migrate deploy → seed → grant scripts → server
docs/                   plans, runbooks, design notes (index in §10)
```

### Key business rules
- **Roles:** Director, Technical Head, Service Head, Sales Head (read-only, company-wide), PM / Assistant PM, Senior and Junior Engineer, Admin.
- **4 peer delivery teams:** PM1, PM2, Asst PM1, Asst PM2. "Assistant PM" is only a title, with identical rights. Each leads the people under them in the org chart (`managerId`).
- **Only Directors and Technical Heads** create projects and tasks. PMs can't.
- **Reassigning:** within your own team it moves immediately. To another team it creates a request that a Technical Head or Director must approve (`AWAITING_HEAD_APPROVAL`). Engineers can't hand over across teams.
- **Auto-assign** only ever picks engineers, never PMs or heads.
- The progress ledger is append-only, and assignments are never deleted (they're released).

## 4. Environments

| | Local dev | Production |
|---|---|---|
| Where | your machine | Hostinger VPS `72.62.248.38` (`srv1275499`), dir `/root/engos-docker` |
| URL | http://localhost:3000 | https://engos.srv1275499.hstgr.cloud |
| App | `npm run dev` (native Node) | container `engos_app` |
| DB | container `engos_local_db` from `docker-compose.local.yml`, port 5432 | container `engos_db`, on a private Docker network, not exposed |
| HTTPS | none | Traefik, shared with an n8n stack on the same VPS (external network `n8n_default`, cert resolver `mytlschallenge`) |

The VPS also runs **other, unrelated apps** (n8n, chatwoot and others). Don't prune volumes or restart Traefik or n8n.

### Environment variables (names only, never commit values)
Production `.env` on the VPS holds: `DOMAIN`, `APP_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `AUTH_SECRET` (32+ chars; rotating it logs everyone out), `SESSION_TTL_SECONDS` (43200 = 12h), `SEED_PASSWORD`.
Optional: `VERTEX_AI_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS`. Template: `.env.example`.

## 5. Local development

Full guide: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).
```bash
npm install
docker compose -f docker-compose.local.yml up -d db
cp .env.example .env        # DATABASE_URL=postgresql://engos:engos_local_password@localhost:5432/engineering_os?schema=public
npx prisma migrate deploy
npm run db:seed
npm run dev
```

**Checks before every commit** (all must pass):
```bash
npm run typecheck && npm test && npm run build && npm run test:int
```
`test:int` needs the local Postgres running and seeded. Service changes ship with an integration test (`*.int.test.ts`) covering allow, deny, the happy path and a validation failure.

**Schema changes:** `npx prisma migrate dev --name <change>`, then commit the folder. **Never `prisma db push`** against a shared or production DB. Permission grants and revokes are hand-written SQL migrations (`migrate dev --create-only`), not new scripts. Example: `20260926150000_revoke_pm_task_create`.

## 6. How it's deployed (current reality)

**Pushing to `main` is the deploy.** There is no manual approval step.

1. `.github/workflows/ci.yml` runs on every push and PR to `main`: `npm ci` → `prisma validate` → migrate and seed a throwaway Postgres → typecheck → unit tests → integration tests → `next build`.
2. If CI passes on `main`, `.github/workflows/deploy.yml` SSHes to the VPS (secret `VPS_SSH_KEY`) and runs:
   `git pull origin main` → `docker compose up -d --build --remove-orphans` → `docker image prune -f`.
   **The image is built on the VPS** (it takes several minutes). The old container keeps serving until the new one is ready.
3. The new container runs `entrypoint.sh`:
   - `prisma migrate deploy`. This is fatal if it fails, so the container won't start on a bad migration.
   - `prisma/seed.ts`, plus the `grant-*.ts` scripts and `set-passwords-from-csv.ts`. These aren't fatal: failures are only logged.
   - Then the Next.js server starts.
4. Docker's healthcheck calls `/api/health`, which checks the DB and that no migration is left unfinished.

**Planned improvement (not built yet):** build the image once in CI, push it to GHCR, pull it on the VPS, take an automatic backup before migrating, add a health gate and one-command rollback. See [docs/deploy-pipeline-plan.md](docs/deploy-pipeline-plan.md).

### Release checklist (do this every time until the pipeline plan lands)
1. All local checks are green (§5) and the work has been reviewed.
2. On the VPS: `cd /root/engos-docker && ./scripts/backup.sh`, then `gunzip -t` the file.
3. Copy the backup off the VPS: `scp root@72.62.248.38:/root/engos-docker/backups/<file> <local folder>`.
4. `git push origin main`, then watch GitHub Actions and `docker compose logs -f app`.
5. Smoke test on prod: log in, then open the dashboard, a project, a task, People and Audit, and use the screens the change touched.

The older [docs/deployment-runbook.md](docs/deployment-runbook.md) covers the one-off September 2026 cut-over and is historical.

## 7. Operations cheat-sheet (on the VPS, in `/root/engos-docker`)

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| App logs | `docker compose logs -f --tail 200 app` |
| Deployed commit | `git log --oneline -1` |
| Applied migrations | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at"'` |
| DB shell | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` |
| Backup | `./scripts/backup.sh` → `backups/backup_<timestamp>.sql.gz` (keeps 14 days) |
| Restore | `./scripts/restore.sh <file>`. Stop the app first; the owner must approve. |
| Roll back code | `git revert <commit>` locally, then push (this redeploys). If a migration ran, restore the backup first. |
| Restart the app only | `docker compose restart app` |

**Gap:** there's **no scheduled nightly backup** on the VPS today (no cron entry). Backups happen only when someone runs `backup.sh`. Recommended: a cron job for `backup.sh`, plus a copy off the box.

## 8. Working rules (people and agents)

From `AGENTS.md` and `CLAUDE.md`, which remain the source of truth:
- The app is live. **Only push to `main` after review.** Agents make local commits only.
- Migrations must be additive, or come with a written and rehearsed data plan. Never drop a live column in the same release that stops using it.
- `entrypoint.sh` runs on every start, so anything added there must be idempotent and must never delete user data.
- Don't touch production data or the VPS except through a reviewed release, a backup first, and owner approval for data operations.
- Never commit, log or audit passwords or secrets.
- **Way of working so far:** Claude (Claude Code) writes plans in `docs/` and reviews commits. Antigravity (Gemini) implements. The owner relays between them and pushes.

## 9. Known debt and open items
- **Deploy pipeline** plan not implemented yet ([docs/deploy-pipeline-plan.md](docs/deploy-pipeline-plan.md)).
- **No automatic nightly backup** (§7).
- **Password handling:** `prisma/data/logins.csv` and `set-passwords-from-csv.ts` still run at startup. The retirement plan is in [docs/client-requests-2026-09-25.md](docs/client-requests-2026-09-25.md) §0 E. `seed.ts` still has a default-password fallback.
- **4 legacy `grant-*.ts` scripts** run at every start. They're idempotent. New permission changes go in migrations instead.
- **Manager detection:** `isExecutionStaff` (`domain/availability.ts`) still decides "manager" from grade and designation text. Newer code uses role keys. Moving everything to role keys is pending.
- **README.md is partly out of date:** its quick start and demo-account table date from before go-live. Trust this file for anything they disagree on.
- Parked item #7 in the client-requests doc.

## 10. Documentation index

| Doc | What it's for |
|---|---|
| [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) | rules for coding agents |
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | detailed local setup |
| [docs/architecture.md](docs/architecture.md) | design reasoning, data model notes, security posture |
| [docs/rbac.md](docs/rbac.md), [docs/rbac-audit.md](docs/rbac-audit.md) | permission model and audit |
| [docs/project-management.md](docs/project-management.md) | what the PM module does |
| [docs/api.md](docs/api.md) | REST API |
| [docs/design-system.md](docs/design-system.md) | UI tokens and components |
| [docs/client-requests-2026-09-25.md](docs/client-requests-2026-09-25.md) | current client change list and status of each item |
| [docs/deploy-pipeline-plan.md](docs/deploy-pipeline-plan.md) | planned deploy improvements |
| [docs/migration-rehearsal-plan.md](docs/migration-rehearsal-plan.md) | how to rehearse a risky migration on a restored backup |
| [docs/roadmap.md](docs/roadmap.md) | future modules (parked) |
| other `docs/*-plan.md` | past feature plans, kept as history |
