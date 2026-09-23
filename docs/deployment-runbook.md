# Deployment runbook — September 2026 release

**Status:** rehearsal round 2 passed on restored production data. Cleared to deploy.
**Expected downtime:** about 5–10 minutes, deliberate.

---

## READ FIRST — pushing to `main` deploys automatically

`.github/workflows/deploy.yml` triggers on every push to `main`. It SSHes to the VPS, runs
`git pull origin main`, then `docker compose up -d --build`.

**Consequences you must plan around:**

1. **`git push origin main` IS the deploy.** There is no separate approval step.
2. **If you push before applying the SQL, the app goes down.** The rebuilt container runs
   `entrypoint.sh` → `prisma db push`, which fails on this schema (required unique column on
   a populated table, plus two dropped columns). `entrypoint.sh` uses `set -e`, so the
   container exits instead of serving.
3. **The migration SQL only reaches the VPS via `git pull`** — which only happens because
   you pushed. So the SQL files must be copied to the VPS **separately, beforehand**.

The whole sequence below exists to work around those three facts.

---

## Pre-flight (on your machine)

1. Confirm the working tree is green:

   ```bash
   npm run typecheck && npm run test && npm run build
   ```

2. Add `.claude/` to `.gitignore` — it is currently untracked and would be swept into
   `git add -A`.

3. Commit everything **but do not push yet.**

   ```bash
   git add -A && git commit -m "feat(pm): client master, panel WBS, per-panel engineers, ERP prep"
   ```

   Pushing is Step 5. Nothing before that touches production.

---

## Step 1 — Fresh backup (on the VPS)

The rehearsal snapshot is days old. Take a new one immediately before deploying.

```bash
cd /root/engos-docker
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backups/pre-deploy-$(date +%F-%H%M).sql
ls -lh backups/
```

**Do not continue until you have confirmed this file is a sensible size** (~400 KB or more)
and starts with `-- PostgreSQL database dump`.

## Step 2 — Copy the migration SQL to the VPS

From **your machine**, because the VPS does not have these files yet:

```bash
scp prisma/migrations/20260923000001_client_master/migration.sql root@72.62.248.38:/root/engos-docker/backups/m1_client_master.sql
scp prisma/migrations/20260923000002_project_fields_rework/migration.sql root@72.62.248.38:/root/engos-docker/backups/m2_project_fields.sql
```

`backups/` is already bind-mounted into the db container at `/backups`, so the files are
reachable from inside it without further copying.

## Step 3 — Stop the app, leave the database running

Take the app down deliberately. Otherwise the old code keeps querying `poNumber` and
`orderValue` while Step 4 drops them, and users see errors instead of a clean stop.

```bash
docker compose stop app
```

## Step 4 — Apply the two migrations

Each runs in a single transaction and rolls back cleanly on error.

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set ON_ERROR_STOP=on -f /backups/m1_client_master.sql'

docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set ON_ERROR_STOP=on -f /backups/m2_project_fields.sql'
```

**If either reports an error, STOP.** The transaction has rolled back, so the database is
unchanged and the app can be restarted with `docker compose start app`. Report the error
rather than retrying.

## Step 5 — Verify the data before deploying code

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT count(*) AS projects FROM pm_projects;                        -- expect 13
SELECT count(*) AS clients FROM pm_clients;                          -- expect 13
SELECT count(*) AS orphans FROM pm_projects WHERE "clientId" IS NULL;-- expect 0
SELECT count(*) AS no_wo FROM pm_projects WHERE "workOrderNo" IS NULL;-- expect 0
SELECT count(*) - count(DISTINCT "workOrderNo") AS dupe_wo FROM pm_projects; -- expect 0
SELECT column_name FROM information_schema.columns
  WHERE table_name='pm_projects' AND column_name IN ('poNumber','orderValue'); -- expect 0 rows
SQL
```

Expected: **13 projects, 13 clients, zeros everywhere, no rows for the dropped columns.**
Clients becomes 16 after the seed runs in Step 6 — that is correct (the seed adds three
clients under the ACS company that previously existed only under VSPL).

**Anything unexpected — stop and roll back (see below). Do not push.**

## Step 6 — Deploy the code

Now, and only now:

```bash
git push origin main
```

This triggers the auto-deploy. Watch it in the GitHub Actions tab, then on the VPS:

```bash
docker compose logs -f app
```

You are waiting for `db push` to report **already in sync**, the seeds to run without error,
and `==> Starting Engineering OS Next.js server...`.

## Step 7 — Verify the deployment

```bash
docker compose ps                                   # app healthy
docker compose logs app | grep -iE "error|exception|constraint"   # expect nothing
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pm_clients;"'  # expect 16
```

Then in the browser:

- log in
- open an existing project — must render without the removed PO/order-value fields
- create a project: client dropdown populated, reference number autofills, PLC × 2 produces
  **2 panels of 13 tasks**, code follows `ACS-00NN-0001`
- assigning the same engineer to both panels must be **blocked**
- open Team Load, click an engineer, confirm the portfolio page loads
- press `Esc` on the global search after clicking elsewhere — it must close

---

## Rollback

**If Step 4 failed:** nothing to roll back. The transaction reverted. `docker compose start app`.

**If Step 5 looked wrong, or Step 6/7 failed:** restore the backup and revert the code.

```bash
# 1. stop the app
docker compose stop app

# 2. restore the pre-deploy dump
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/pre-deploy-<timestamp>.sql

# 3. revert the code — this re-triggers auto-deploy with the old version
git revert --no-edit HEAD && git push origin main
```

Restoring into a non-empty database can conflict. If it does, drop and recreate the
database first, then restore — the dump is complete, so nothing is lost.

---

## Notes for next time

- **The migrations are applied by hand and are not recorded in `_prisma_migrations`.** The
  schema will be correct, but the migration history stays incomplete — consistent with the
  drift already there from `db push`. **Never run `prisma migrate dev` against the VPS:** it
  would detect that drift and offer to reset the database.
- **`entrypoint.sh` still prints "Notice: Seed check completed." whether the seed succeeded
  or failed.** That is how the round-1 bug stayed invisible. Making that message honest is
  still an open decision.
- Consider gating the auto-deploy workflow behind `workflow_dispatch` only, so a push to
  `main` stops being a production deploy. This release survives it, but any future change
  needing a data migration hits the same chicken-and-egg.
