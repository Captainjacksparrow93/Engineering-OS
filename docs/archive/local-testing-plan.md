# Local test environment — plan

**Goal:** run Engineering OS locally against a copy of production data, so failures can be
diagnosed from the logs instead of guessed at from screenshots.

**Why now:** the client-creation failure could not be diagnosed remotely. The service works
(reproduced server-side: `CREATED OK -> ACS-0001`), so the fault was in the browser session —
and the VPS logs show nothing, because the request never reached the server. Locally, the
browser console, the network tab and the dev-server output are all visible at once.

---

## What is already in place

| | |
|---|---|
| `.env` | points at `localhost:5432/engineering_os` ✅ |
| `.claude/launch.json` | `dev` config on port 3000 ✅ |
| `docker-compose.local.yml` | Postgres 16, same version as the VPS ✅ |
| Docker Desktop | **not running — the one manual step** |

## Step 1 — start Docker Desktop (manual)

The only part that needs a human. Once the whale icon is steady, everything else is
automatic.

## Step 2 — database

```bash
docker compose -f docker-compose.local.yml up -d db
```

Then load a **fresh dump of production**, so local matches it exactly — same people, same
squads, same empty client and project tables. Taken at test time, not reused from earlier
today, because production has changed repeatedly.

Fresh-dump parity matters: reproducing a bug against different data proves nothing.

## Step 3 — dev server

Started via `preview_start` with the `dev` config, **never** `npm run dev` in a shell — the
preview tooling captures server output, console messages and network requests together.

## Step 4 — sign in (manual, one action)

**The user signs in.** Claude does not enter passwords, including seeded ones. Once the
session exists in the browser pane, Claude can drive the app freely from there.

Sign in as **Shaktikumar Vasava (Director)** — the account with the widest visibility, and
the one most of the outstanding questions concern.

## Step 5 — reproduce the client bug

1. Open **New project**
2. Click **Add new client**, enter a name, submit
3. Capture **all three** at the moment of failure:
   - the browser console (`read_console_messages`)
   - the network request and its response (`read_network_requests`)
   - the dev server output (`preview_logs`)

**Expected, if the stale-deployment theory is right:** it works fine locally, because the
page and the server are from the same build. That would confirm the production failure was a
page left open across a redeploy — and the fix becomes making that visible to the user rather
than showing a generic "Failed to create client."

**If it fails locally too**, the console and network capture will say exactly why, and it is a
real bug to fix.

## Step 6 — use the environment for what comes next

Once it is running, keep it. It is the right place for:

- **Creating a test project end to end** — four squad leads, a fresh client, PLC × 2,
  per-panel engineers — before the handover rework is built on top
- **Verifying the handover rework** (`docs/archive/handover-rework-plan.md`), which needs several
  roles, two squads and a migration. Testing that on production would be reckless
- **Rehearsing migrations**, as done for the September release

---

## Standing rules for this environment

- **Local only.** Nothing here touches the VPS. Do not point `.env` at production.
- **The dump is production data** — real names and emails. Keep it out of git (`backups/`
  and `*.sql` are already ignored) and delete it when finished.
- **Claude never enters passwords.** The user signs in; Claude drives afterwards.
- **Reset with** `npm run db:reset:dev` (force-resets the schema and re-seeds people, roles
  and templates — no projects or clients, since those seeds were removed).
