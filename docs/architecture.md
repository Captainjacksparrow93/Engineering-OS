# Architecture

## The problem this shape solves

Engineering OS has to become HRMS, ERP, Gate Entry, Production, Quality and more, and
those modules are not independent products — an approved leave changes who can take a
task, a sales order creates a project, a completed engineering task releases a job to
the shop floor. Anything that puts these in separate databases turns every one of those
sentences into a distributed transaction and a reconciliation job.

So: **a modular monolith on one PostgreSQL database.** One deployable, one schema,
strict internal boundaries.

## Layers

```
  Browser (server-rendered React)
        │
        ├── Server Actions  ─┐
        └── REST API routes ─┤   both call the same services; neither holds business logic
                             │
                    ┌────────▼────────┐
                    │    Services     │  authorisation + business rules + transactions
                    └────────┬────────┘
             ┌───────────────┼──────────────┐
             ▼               ▼              ▼
      Domain engines     Prisma / DB    Platform services
      (pure functions)                  (audit, events, notifications)
```

The rule that keeps this honest: **a route never talks to Prisma directly, and a
service never trusts its caller.** Every service call starts by asserting a permission
(`assertCan`, `assertProjectPermission`, `assertTaskPermission`). That is why the same
rules apply whether a request arrives from the web UI, the REST API, or a future mobile
client — there is only one place they are enforced.

### Domain engines are pure

`src/modules/project-management/domain/` holds the parts worth getting exactly right —
the dependency graph, the critical path, capacity arithmetic — as pure functions over
plain data. No database, no request context. They are unit-tested directly (`npm test`),
which is the only practical way to be confident about cycle detection and float
calculations.

## Module boundaries

| Prefix   | Owner                    | Status |
|----------|--------------------------|--------|
| `core_*` | Shared kernel            | live   |
| `pm_*`   | Project Management       | live   |
| `hrms_*` | HRMS                     | planned |
| `erp_*`  | ERP / Finance            | planned |
| `prod_*` | Production               | planned |
| `gate_*` | Gate Entry               | planned |

Rules that make a new module a safe addition rather than a rewrite:

1. **Only the shared kernel is shared.** A module may reference `core_users` and
   `core_departments` directly, because identity is shared by definition. It may not put
   a foreign key into another module's private tables.
2. **Cross-module traffic is events.** `src/core/events/catalog.ts` is the published
   contract. Project Management already emits `pm.task.completed`, `pm.handover.accepted`
   and the rest; Production will subscribe to them without Project Management changing.
3. **Events are written in the same transaction as the change** (transactional outbox,
   `core_domain_events`). An event can never describe a write that rolled back.
4. **Permissions are data.** A new module adds keys to the catalogue and they become
   grantable — no change to the authorisation engine.

### Why not microservices

They would be the wrong trade for this business. The modules share entities (an
employee, a project, a panel) and need consistency across them; a small internal team
would spend its time on service meshes and eventual-consistency bugs instead of shop
floor features. The seams above mean a genuinely hot module can be extracted later:
its events already exist, its tables are already namespaced, and its callers already go
through a service interface.

## Data

**PostgreSQL**, one database, one schema. Chosen for what this workload actually needs:
real transactions across module boundaries, recursive/graph queries for the WBS and the
department tree, JSONB for audit diffs and event payloads, arrays for skill tags, and
`NUMERIC` for order values.

Design notes worth knowing:

- **The progress ledger is append-only.** `pm_task_progress_logs` is the truth;
  `Task.percentComplete` and `Task.actualHours` are projections maintained by the
  service. Disputes months later are answerable.
- **Assignments are never deleted.** A handover retires the outgoing row as
  `HANDED_OVER` and creates a new one; effort stays attributed to whoever burned it.
- **Derived state is recomputed centrally.** `recomputeTaskDerivedState` recalculates
  blocked status and phase roll-ups after any structural change, so the blocked flag
  cannot drift away from the dependency graph.
- **Sessions are rows, not just tokens.** Signing out everywhere and revoking access the
  moment somebody leaves are requirements, and a stateless JWT alone cannot do either.

### Scaling path

The workload is a few hundred concurrent users on a factory network, so the honest
answer is that one server is enough for a long time. When it is not:

1. Run several `app` containers behind a load balancer (the app holds no local state).
2. Add a Postgres read replica and route dashboards to it.
3. Move the outbox drain from the request path into a worker container (the publish
   contract does not change).
4. Add Redis for session lookup caching and rate limiting.
5. Only then consider extracting a module into its own service.

## Deployment

`docker compose up -d --build` gives you Postgres, a migration job and the app. The
compose file runs `prisma migrate deploy` as a separate service that must complete
before the app starts, so a half-migrated database never serves traffic.

- **Migrations** are versioned SQL in `prisma/migrations/`, applied forward only.
- **Health**: `GET /api/health` checks the database, and the container healthcheck uses
  it.
- **Backups**: `docker compose exec db pg_dump -U engos engineering_os > backups/…`
  nightly; the `backups/` volume is where an offsite job should point.
- **Secrets**: `AUTH_SECRET` is required and unset by default — the app refuses to boot
  without it rather than falling back to something guessable. Rotating it invalidates
  every session.

## Security posture

- Passwords: bcrypt, cost 12.
- Sessions: HTTP-only, SameSite=Lax cookie carrying a signed JWT whose id must match a
  live, unrevoked `core_sessions` row.
- Authorisation: deny by default, permission-based, scoped (see [rbac.md](./rbac.md)).
  There is no "if admin then allow" branch anywhere in application code.
- Auditing: every mutation writes to `core_audit_logs` inside the same transaction.
- Enumeration: sign-in returns one message for unknown user and wrong password alike.
- Input: every write is parsed by a Zod schema before it reaches a service.
