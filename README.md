# Engineering OS

One platform for a control-panel manufacturing company — projects, people and plant —
built so that every function of the business eventually lives in it under a single
access model.

**Module 1, Project Management, is live.** HRMS, ERP, Gate Entry, Production, Quality
and Maintenance appear in the launcher with a *Coming soon* page describing their scope
and how they will connect. The platform they need — shared identity, scoped permissions,
one database, an event bus — is already in place.

---

## Quick start

### With Docker (how it is meant to run)

```bash
cp .env.example .env
# set AUTH_SECRET to something long and random, e.g.
#   openssl rand -base64 48
docker compose up -d --build

# first run only: load demo data
docker compose exec -e SEED_PASSWORD='Engos@2026' app npx prisma db seed
```

Open <http://localhost:3000>.

### Locally

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your Postgres
npx prisma migrate dev        # create the schema
npm run db:seed               # demo company, people and projects
npm run dev
```

### Demo accounts

All use the password from `SEED_PASSWORD` (`Engos@2026` in `.env.example`). Sign in as
different people — the navigation, the data and the available actions genuinely differ.

| Email | Role | What they see |
|-------|------|---------------|
| `rajesh.deshmukh@vidyutswitchgear.com` | Director | Every project, portfolio health, the blocker list |
| `meera.iyer@vidyutswitchgear.com` | Head of Engineering | Everything in Engineering and its sub-departments |
| `priya.nair@vidyutswitchgear.com` | Project Manager | Her two projects in full, her team's load |
| `kavita.rao@vidyutswitchgear.com` | Lead Engineer | Executes, creates tasks, pulls peers in |
| `farhan.qureshi@vidyutswitchgear.com` | Design Engineer | His own queue and progress |
| `sneha.patil@vidyutswitchgear.com` | Junior Engineer | Her queue only — no resource board, no project creation |
| `admin@vidyutswitchgear.com` | Platform admin | People, roles, permissions, audit trail |

Change these passwords before anyone real uses the system.

---

## What the Project Management module does

Built around the problems of running panel projects across several hierarchies:

- **Projects defined by management, executed by engineers.** Creating a project grants
  its manager authority over that project alone — not over anything else.
- **A work breakdown structure** with phases, subtasks and roll-up progress weighted by
  effort, so a phase's percentage means something.
- **Real dependencies** — finish-to-start, start-to-start, finish-to-finish,
  start-to-finish, with lead/lag. Circular chains are rejected before they are saved;
  blocked state is derived from the graph, never typed in; the critical path is
  calculated so managers know which slip actually threatens delivery.
- **Ad-hoc work with an answer to "who is free?"** — a live capacity board (open
  assignments, remaining effort, approved leave, Sundays excluded) and a ranked
  candidate list combining spare hours, skill fit and grade, with its reasons shown.
- **Peer handover.** An engineer who cannot finish passes the *remaining* work to a
  peer, who accepts or declines. Effort already spent stays attributed to whoever spent
  it; the manager is notified throughout; a manager can force one through when needed.
- **Progress punch-in** on an append-only ledger — percent, hours, what moved, and a
  blocker that immediately reaches the project manager and sponsor.

Details: [docs/project-management.md](docs/project-management.md).

## Access control

Permission-based and **scoped**, never role-name-based. A grant is a role given to a
person at a scope: the whole company, a department subtree, or one project. The same
"Project Manager" role on two projects gives two independent sets of rights. Deny is the
default and there is no admin bypass in application code.

Details: [docs/rbac.md](docs/rbac.md).

## Architecture

A modular monolith on one PostgreSQL database: one deployable, strict internal
boundaries, module-prefixed tables, and a transactional outbox so cross-module
integration is event-driven from day one. The parts worth getting exactly right — the
dependency graph, critical path, capacity arithmetic — are pure functions with unit
tests.

Details: [docs/architecture.md](docs/architecture.md) ·
[docs/api.md](docs/api.md) · [docs/roadmap.md](docs/roadmap.md).

## Layout

```
prisma/schema.prisma          One schema: core_* shared kernel, pm_* this module
src/core/                     Platform: config, db, auth, rbac, audit, events, notifications
  rbac/permissions.ts         The permission catalogue and shipped roles
  events/catalog.ts           The cross-module event contract
  modules/registry.ts         Module launcher, including what is still coming
src/modules/
  project-management/
    domain/                   Pure engines: scheduling (CPM, cycles), availability
    services/                 Authorisation + business rules + transactions
    validation/               Zod schemas shared by the UI and the API
  admin/                      People, role grants, audit
src/app/                      Routes: (shell) pages, /api REST, /actions server actions
src/components/               Shell and UI primitives
docs/                         Architecture, RBAC, module design, API, roadmap
```

## Commands

```bash
npm run dev          # development server
npm run build        # production build
npm test             # unit tests for the domain engines and RBAC
npm run typecheck    # tsc --noEmit
npm run db:migrate   # create/apply a migration in development
npm run db:deploy    # apply migrations in production
npm run db:seed      # demo data (needs SEED_PASSWORD)
npm run db:studio    # browse the database
```

## Stack

Next.js 15 (App Router, React 19, server components) · TypeScript · PostgreSQL 16 ·
Prisma · Zod · Tailwind CSS · bcrypt + JWT sessions · Vitest · Docker Compose.

## Before production

1. Set a strong `AUTH_SECRET`; change every seeded password.
2. Terminate TLS in front of the app (the session cookie is marked `secure` when
   `NODE_ENV=production`).
3. Schedule `pg_dump` into the `backups/` volume and copy it offsite.
4. Point monitoring at `GET /api/health`.
5. Replace the demo company, departments and people with the real org — or import them
   when HRMS lands.
