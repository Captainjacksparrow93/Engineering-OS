# Migration rehearsal plan — run this before anything touches the VPS

**For:** Gemini (or whoever runs the rehearsal)
**Goal:** prove there is a working deployment path for the September 2026 changes, on a
local database, before the VPS is touched.

---

## STOP — read this first. There is a blocker.

**This project does not use migrations in production.** `entrypoint.sh` line 6:

```sh
node node_modules/prisma/build/index.js db push --skip-generate
```

That means:

1. **The two migration files under `prisma/migrations/` will never run on the VPS.** Nothing
   calls `prisma migrate deploy`. The client backfill and the `workOrderNo` backfill — the
   entire data-transformation half of this release — would simply not happen.
2. **`db push` will fail on this schema change, and the container will not start.**
   `entrypoint.sh` begins with `set -e` and the `db push` line has no `|| true`, so a
   non-zero exit kills the container before `exec node server.js`.

   It will fail for two independent reasons:
   - `workOrderNo String @unique` is **required with no default**, being added to
     `pm_projects` which already has rows. `db push` cannot invent values.
   - Dropping `poNumber` and `orderValue` is **data loss**, which `db push` refuses without
     `--accept-data-loss` (not passed).

So the deploy as it stands does not half-work — it does not start. **Do not push to the VPS
until this plan produces a green result.**

---

---

# ROUND 1 RESULTS — read before re-running

A first rehearsal was run and **found a real bug**, which is exactly what it was for. The
migrations themselves applied cleanly; the failure was in the seed that runs afterwards.

### What failed

`prisma/seed.ts` threw during container boot (Step 7):

```
PrismaClientKnownRequestError: Unique constraint failed on the fields:
  (`companyId`,`refNumber`)
```

**Root cause — the seed assumed it owned the client table.** It does not. The migration
backfill creates a client row per existing project, and users create more in the app. The
seed hardcoded `ACS-0001`/`0002`/`0003`, which the migration had already handed out
alphabetically (`ACS-0001` → Adani Ports).

**Why it mattered more than it looked:** `entrypoint.sh` runs the seed with
`|| echo "Notice: Seed check completed."`, so the container kept starting while roughly
lines 1400–1985 of the seed — projects, tasks, assignments — never ran. In production this
would have half-seeded the database and reported success in the logs.

Note production has **two companies**, VSPL and ACS, which is what made the clash possible.

### What has ALREADY been fixed — do not redo or revert

Both fixes are applied in the working tree and verified (typecheck, 94/94 tests, build):

1. **`prisma/seed.ts`** — reference numbers are now **allocated from the highest existing
   number** for that company, and existing clients are looked up by name first. No
   hardcoded reference numbers remain.

2. **`prisma/seed-demo.ts`** — had the *same class of bug*, missed in round 1. It allocated
   from `count + 1`, which breaks because **the migration's sequence is global across
   companies**: clients are numbered 1–13 in alphabetical order regardless of company, so
   each company's numbers have gaps and `count + 1` can land on a taken one. Now allocates
   from max, like `seed.ts`.

**Rule going forward: never hardcode a client reference number anywhere, and never derive
one from a row count. Always allocate from the maximum existing value for that company.**

### Still open — user decision pending, do not change unprompted

`entrypoint.sh` prints the same reassuring "Notice: Seed check completed." whether the seed
succeeded or failed. That is how this bug would have reached production invisibly. Awaiting
a decision between making the failure message honest (no behaviour change) and letting a
seed failure stop the container. **Leave `entrypoint.sh` alone until then.**

### What round 2 must do

**Re-run from a clean restore** — drop the local database, reload `vps-snapshot.sql`, and
start again from Step 3. The seed files changed, so a partially-seeded database from round 1
is not a valid starting point.

Steps 6 and 7 are the ones that matter this time; Step 7 is what exercised the bug.

---

## What the production snapshot actually shows

A dump was taken from the VPS (`vps-snapshot.sql`, 419 KB, Postgres 16.15) and inspected.
Two things came out of it that change the plan:

**1. `_prisma_migrations` EXISTS and `_init` is recorded as applied** (2026-09-12).
So **no baselining is needed** — an earlier draft of this document was wrong about that.

**2. The live schema has drifted well ahead of the migration history.** Every schema change
since 2026-09-10 was applied by `db push` with no migration recorded. Confirmed by
comparing `_init`'s SQL against the dump:

| Object | In `_init` migration | In live database |
|---|---|---|
| `pm_project_handovers` (whole table) | no | **yes** |
| `pm_projects.automationTypes` | no | **yes** |
| `pm_checklist_template_items.defaultDurationHours` | no | **yes** |
| `...isSimulationSignoff`, `...dependsOnStep` | no | **yes** |

So the migration history describes a database that no longer exists. Any future
`prisma migrate dev` will detect this drift and offer to **reset the database** — which on
production would be catastrophic. Nobody should run `migrate dev` against the VPS, ever.

## Recommended path — apply the two migrations as plain SQL

Given the drift, **do not** adopt `migrate deploy` as part of this release. The lower-risk
path, and the one this rehearsal should validate:

1. Apply `20260923000001_client_master/migration.sql` and
   `20260923000002_project_fields_rework/migration.sql` **directly with `psql`**, inside a
   transaction, as a one-off. They are plain SQL and need no Prisma tooling.
2. **Leave `entrypoint.sh` alone.** Once the SQL has run, the database matches
   `schema.prisma`, so the existing `db push` on container start becomes a **no-op** — the
   thing that would have failed no longer has anything to do.
3. Optionally insert matching rows into `_prisma_migrations` afterwards so the history
   stays honest. Cosmetic, given the drift that is already there.

**Why not `migrate deploy`:** it would probably work — the two new migrations only touch
`pm_projects` and create `pm_clients`, none of which collide with the drifted objects. But
it permanently cements a migration history that disagrees with the real schema, and buys
nothing over running the same SQL directly. Reconciling the drift properly is worth doing
one day; it is not worth bundling into this release.

**Why the original `db push`-only path fails:** `db push` cannot add
`workOrderNo` (required + unique, no default) to a populated table, and refuses to drop
`poNumber`/`orderValue` without `--accept-data-loss`. With `set -e` in `entrypoint.sh` and
no `|| true`, that failure stops the container before the server starts.

## Expected results — taken from the real snapshot

The production database contains **13 projects** with **13 distinct client names**, one
each:

```
Adani Ports · Amul Dairy · Asian Paints · Godrej Foods Pvt Ltd · JSW Steel ·
Ketav Consultant · Larsen & Toubro · Mistrifabricator · Reliance Petrochem ·
Sunrise Cement Industries · Tata Chemicals Ltd · Tata Power · UltraTech Cement
```

So after the migration:
- `pm_clients` must contain **exactly 13 rows**
- reference numbers run **ACS-0001 … ACS-0013**, assigned alphabetically — `Adani Ports`
  gets `ACS-0001`, `UltraTech Cement` gets `ACS-0013`
- `pm_projects` must still contain **exactly 13 rows**, every one with a non-null `clientId`
- all 13 `workOrderNo` values must be present, unique and digits-only

None of the client names contain apostrophes or unusual characters, so the backfill's
string handling is low-risk. Verify the numbers anyway.

---

## Rehearsal — exact steps

### Step 0 — ✅ DONE, the snapshot already exists

`vps-snapshot.sql` has been taken from the VPS and is on the user's machine at:

```
C:\Users\Dhruv-Home\Downloads\vps-snapshot.sql
```

419 KB, Postgres 16.15, 13 projects. **Use this file** — do not fall back to seed data, and
do not take a new dump.

### Step 1 — local database from the VPS snapshot

```bash
docker compose -f docker-compose.local.yml up -d db
```

Wait for the healthcheck, then load the snapshot into the local database. Connection string
(already in `LOCAL_DEVELOPMENT.md`):

```
postgresql://engos:engos_local_password@localhost:5432/engineering_os?schema=public
```

### Step 2 — confirm the starting state matches the VPS

```sql
SELECT migration_name FROM _prisma_migrations;
SELECT count(*) AS projects, count(DISTINCT "clientName") AS clients FROM pm_projects;
```

Expect **exactly one** migration row (`20260910134722_init`) and **13 / 13**. If either
differs, the restore did not work — say so and stop rather than continuing.

### Step 3 — apply the two migrations as SQL, in a transaction

This is the step being tested. Run each file wrapped in a transaction so a failure rolls
back cleanly instead of leaving the database half-migrated:

```bash
psql "$LOCAL_DATABASE_URL" --single-transaction --set ON_ERROR_STOP=on \
  -f prisma/migrations/20260923000001_client_master/migration.sql

psql "$LOCAL_DATABASE_URL" --single-transaction --set ON_ERROR_STOP=on \
  -f prisma/migrations/20260923000002_project_fields_rework/migration.sql
```

`ON_ERROR_STOP=on` matters — without it `psql` ploughs on past errors and reports success.

Capture the **full output of both**, success or failure. If either rolls back, report the
exact error and how far it got; do not retry blindly.

### Step 4 — confirm `db push` is now a no-op

This is what proves the container will start on the VPS without touching `entrypoint.sh`:

```bash
npx prisma db push
```

It must report that the database is **already in sync** and make no changes. If it wants to
alter, add or drop anything, the migration SQL and `schema.prisma` disagree — **stop and
report exactly what it wants to change.** That difference would hit production on the next
container restart.

### Step 5 — verify the data, not just the exit code

A migration can exit 0 and still have mangled the data. Check all of it:

```sql
-- every project has a client, and the client matches its old free-text name
SELECT count(*) FROM pm_projects WHERE "clientId" IS NULL;                -- expect 0
SELECT count(*) FROM pm_clients;                                          -- expect 13
SELECT count(*) FROM pm_clients WHERE "refNumber" !~ '^ACS-\d{4}$';       -- expect 0
SELECT p.code, p."clientName", c.name, c."refNumber"
  FROM pm_projects p JOIN pm_clients c ON c.id = p."clientId"
  ORDER BY c."refNumber";      -- 13 rows; clientName must equal c.name on every row,
                               -- Adani Ports = ACS-0001 ... UltraTech Cement = ACS-0013

-- work order numbers: present, unique, digits only
SELECT count(*) FROM pm_projects WHERE "workOrderNo" IS NULL;             -- expect 0
SELECT count(*) - count(DISTINCT "workOrderNo") FROM pm_projects;         -- expect 0
SELECT count(*) FROM pm_projects WHERE "workOrderNo" !~ '^\d+$';          -- expect 0

-- old columns are gone
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'pm_projects' AND column_name IN ('poNumber','orderValue');  -- expect 0 rows

-- nothing was lost
SELECT count(*) FROM pm_projects;   -- expect 13, same as Step 2

-- the drifted objects are untouched
SELECT count(*) FROM pm_project_handovers;   -- must not error
```

### Step 6 — prove the app actually runs on the migrated data

Schema correctness is not the same as a working app. Start it and click through:

```bash
npm run dev
```

- open `/pm/projects` — existing projects still list, with their clients
- open one existing project — no crash on the removed `poNumber` / `orderValue`
- create a **new** project through the wizard: pick a client, confirm the reference number
  autofills, set PLC × 2, assign **two different** engineers
- confirm it creates **2 panels × 13 tasks**, and that the project code follows
  `<CLIENT_REF>-0001`
- try assigning the **same** engineer to both panels — it must be blocked
- open `/pm/resources`, click an engineer, confirm the portfolio page loads
- press `Esc` on the global search after clicking elsewhere — it must close

### Step 7 — rehearse the real container start

**Do not modify `entrypoint.sh`.** The whole point of the chosen path is that it does not
need changing. Build and run the stack exactly as the VPS does:

```bash
docker build -t engos-test:latest .
docker compose -f docker-compose.local.yml up -d
```

Watch the logs:

```bash
docker compose -f docker-compose.local.yml logs -f app
```

The container must pass `==> Synchronizing Prisma database schema...` **without error**
(the `db push` no-op from Step 4), run the seeds, reach
`==> Starting Engineering OS Next.js server...` and stay up.

**This is the single most important check in the whole rehearsal** — it is the exact code
path the VPS will take on the next restart. If this passes against restored production
data, the deploy is safe.

**Check the seed actually completed, do not trust the log line.** Round 1's failure was
invisible because `entrypoint.sh` prints "Notice: Seed check completed." on failure too.
Grep the container logs for the real thing:

```bash
docker compose -f docker-compose.local.yml logs app | grep -iE "error|exception|constraint|Invalid .*invocation"
```

Expect **no matches**. Then confirm the seed reached the end by checking data it writes in
its final third — projects, tasks and assignments — not just the client rows it writes early:

```sql
SELECT count(*) FROM pm_projects;        -- 13 from the snapshot, plus any demo projects
SELECT count(*) FROM pm_tasks;           -- must be non-zero
SELECT count(*) FROM pm_task_assignments;-- must be non-zero

-- reference numbers must still be unique and gap-tolerant
SELECT "companyId", "refNumber", count(*) FROM pm_clients
  GROUP BY 1,2 HAVING count(*) > 1;      -- expect 0 rows
```

Also confirm the seeds did not duplicate anything: they run on **every** container start and
are create-only, so restart the stack once more and check the counts are identical.

---

## What to report back

State plainly, for each of Steps 3–7: **passed / failed**, with the actual command output.
Do not summarise a failure as a success.

Specifically answer:

1. Did both migration SQL files apply cleanly under `ON_ERROR_STOP=on`?
2. Did `npx prisma db push` report **already in sync**, changing nothing? If it wanted to
   change something, what exactly?
3. Did every data check in Step 5 return the expected value? Quote the numbers — 13
   projects, 13 clients, `ACS-0001`–`ACS-0013`, 0 nulls.
4. Did the container reach `Starting Engineering OS Next.js server` and stay up?
5. **Did the seed complete, proven by data rather than by the log line?** Quote the
   `pm_tasks` and `pm_task_assignments` counts, and the grep for errors in the container
   logs. "No error shown" is not evidence — round 1 showed the log lies.
6. Did a second container restart leave all counts unchanged (seeds are create-only)?
7. Anything that had to be changed to make it work — every such change is a change the VPS
   will also need, so name it explicitly.

## Rules for this rehearsal

- **Touch nothing on the VPS.** This is entirely local.
- **Do not edit the migration SQL to make an error go away** without explaining what the
  error was and why the edit is correct. A backfill that "works" because a constraint was
  relaxed is not a fix.
- If the migration fails halfway, note **how far it got** — that is exactly the information
  needed to plan the real deploy.
- Reset between attempts with `npm run db:reset:dev`, and reload the snapshot if using
  Step 1a.
