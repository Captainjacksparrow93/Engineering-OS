# Follow-up plan — remaining work after the September 2026 update

Hand this to Gemini (or any agent) as the next work order. The September update is
**implemented, verified and deployed** (commit `911d58d`).

## Work queue — do them in this order

| # | Task | Why this order |
|---|---|---|
| 1 | **Task 0** — honest seed logging in `entrypoint.sh` | Has hidden two bugs already. Cheap. Do it before anything that touches the seed. |
| 2 | **Task 4b** — Team Load: percentage only | Small, user-requested, self-contained. |
| 3 | **Task 4c** — move the dashboard period toggle | Small, self-contained. |
| 4 | **Task 5** — server-side "every panel has an engineer" | ~5 lines beside an existing check. |
| 5 | **Task 2** — project On Hold | The real feature. Decisions already made; needs a migration. |
| 6 | **Task 8** — cancel / delete a project ✅ DONE | Director-only. Self-contained, no schema change. |
| 7 | **Task 7** — RBAC remediation | **BLOCKED** on user approval. Land alone, after everything else is stable. |

## 🔥 Task 9 — Reassigning a step silently does nothing (LIVE)

> **SUPERSEDED by `docs/archive/handover-rework-plan.md`.** Fix 2 below (direct reassign for
> managers) is Phase 2 of that plan and must not be built separately — the rules changed:
> managers act directly only **inside their own squad**, and crossing squads now raises a
> two-approval request instead of being rejected.
>
> **Fix 1 below still stands and is Phase 0 of that plan** — do it first and on its own if
> you like. Without it, every failure in the rework is invisible.

**Reported:** a Director picks a different engineer from the inline dropdown on a WBS step,
presses ✓, the editor closes and **nothing changes**. No message, no error in the server
logs.

### Two separate defects

**1. The error is discarded by the UI.** `src/components/assignee-cell.tsx`:

```ts
await assignTaskAction({}, formData);   // ← return value ignored
setIsEditing(false);
```

`assignTaskAction` returns `ActionState` — `{ error }` or `{ success }`. Errors are caught by
`run()` and returned **as data**, never thrown, so nothing is logged and nothing is shown.
Every rejection looks like a no-op.

**2. The assignment is genuinely refused.** `assignTask` in `task.service.ts`:

```ts
if (role === 'OWNER' && task.assignments.length > 0) {
  throw new DomainError('This task already has an owner. To reassign, submit a reassign request.');
}
```

The inline editor always sends `role: 'OWNER'`, so any step that already has an owner is
rejected. The dropdown was built for *first* assignment; reassignment was meant to go
through request-and-accept.

### Fix 1 — always surface the result (do this regardless)

Capture the return value and toast it:

```ts
const res = await assignTaskAction({}, formData);
if (res.error) { toast.error(res.error); return; }   // keep the editor open
toast.success('Engineer assigned.');
setIsEditing(false);
```

On failure **keep the editor open** so the user can pick someone else. `toast` is already
used across the app — follow `project-danger-actions.tsx`.

**Then check for the same pattern elsewhere.** Any `await someAction(...)` whose result is
ignored has this bug. It is the second time a swallowed error has cost us a debugging
session, after `entrypoint.sh`.

### Fix 2 — direct reassign for managers — CONFIRMED by the user

**Anyone holding `pm.task.assign` on the project (Director, Technical Head, Project Manager,
Asst Manager) may swap the owner outright.** Engineers keep using request-and-accept between
peers.

In `assignTask`, when `role === 'OWNER'` and an active owner already exists:

- if the caller holds `pm.task.assign` for that project → **release and replace**: set the
  existing assignment to `status: 'RELEASED'` with `releasedAt`, create the new `ACTIVE`
  owner, all in one transaction. Never delete the old row — it carries the hours already
  burned.
- otherwise → keep today's `DomainError` pointing at the reassign request flow.

Audit it (`task.reassigned`, with from/to user ids) and notify both the outgoing and
incoming engineer, reusing `notify` as the handover flow does.

**Do not touch the `TaskHandover` flow.** This is a separate, manager-level path; the
peer-to-peer request/accept behaviour stays exactly as it is.

### Verify

As Director: change the engineer on a step that already has an owner → it changes, both
people are notified, the old assignment shows `RELEASED`, and the audit trail records it.
As an engineer: the same attempt is refused with the message about raising a reassign
request, **and that message is now visible on screen**. As Director on an *unassigned* step:
still works as before.

---

## ▶ CURRENT WORK — `docs/archive/ui-verification-plan.md`

UI verification of the handover rework, plus hunting the nested-form bug class. **Read its
"ALREADY DONE" section first.** The service layer is already proven by
`prisma/scripts/verify-handover-rework.ts` (51 assertions); what is unverified is the
interface.

### ✅ DONE — `docs/archive/handover-rework-plan.md`

The two-approval cross-squad handover rework. **Read its "Before you start" section first** —
the database is now empty, so you must create test data before verifying anything, and the
squad fixtures are listed there.

Work through the phases in order. Phase 0 is tiny and makes the rest debuggable. Phase 1
needs a migration — read `docs/archive/deployment-runbook.md` before writing it.

Commit, **do not push**.

### ✅ DONE — `docs/archive/reset-and-pm-team-plan.md`

All of it, live on production: project seeds disabled, all 16 projects wiped (with their
tasks, assignments, logs and 444 dead notifications), all clients deleted and client seeding
removed, `SERVICE_HEAD` created and granted to Rajani with `pm.oversight`, 13 reporting lines
corrected, `ASST_MANAGER` granted to Munaf and Dhrupin (and `SENIOR_ENGINEER` removed from
them), Krupesh Solanki moved to QC.

Outstanding from it: **Akash Vasava** is created by a human via `/admin/users`, not by a
script.

---

## 🔥 DO THIS FIRST — live breakage on production

`docs/archive/site-commissioning-plan.md` → **HOTFIX** section at the top.

**Technical Head gets "Something went wrong" on both `/pm/approvals` and
`/pm/commissioning`.** The permissions are granted correctly; the bug is that
`commissioning.service.ts` calls `assertCan(principal, 'pm.commissioning.*')` **with no
scope**, and `scopeMatches` returns `false` for a `DEPARTMENT`-scoped grant when no scope is
supplied. Only GLOBAL grants pass, so Director works and Technical Head — the role the
feature was built for — is locked out. Approvals is a daily-use page and it is 500ing.

Full diagnosis and the fix are in that section. **Do not grant TECHNICAL_HEAD a GLOBAL role
as a workaround.**

---

**Jump the queue for this one:** `docs/archive/site-commissioning-plan.md` **Part B2** — the director
cannot see or act on pending handovers anywhere in the app, confirmed live on production.
Oversight queries are scoped to projects you personally manage, and the director manages
none. Small fix, no schema change, and work is currently stuck because of it.

**Then:** the rest of `docs/archive/site-commissioning-plan.md` — the client's dashboard tiles and
the new Site Commissioning module. That depends on Task 2 (the Hold tile reads 0 without
it), so finish this queue first.

Tasks 1, 3, 4 and 6 are **done** — see the ✅ markers. Do not redo them.

## Out of scope — do not start these, do not propose them

**ERP / ERPNext, HRMS and Gate Entry are PLANNING ONLY.** They are not being implemented.
`docs/archive/erp-spike-plan.md` and `docs/archive/erp-integration-plan.md` are records of thinking, not
work orders, and the `COMING_SOON` entries in `src/core/modules/registry.ts` are a product
roadmap, not a backlog.

Take work **only** from this document and `docs/archive/site-commissioning-plan.md`. When both are
finished, **ask what is next** rather than picking something from a parked plan.

## Rules

- **Line numbers are stale the moment editing starts.** Search for the quoted code instead.
- **Definition of done:** `npm run typecheck && npm run test && npm run build` all pass.
  There is no `lint` script and one must not be added (see Task 6).
- **Pushing to `main` deploys to production** via `.github/workflows/deploy.yml`. Commit
  freely, but **do not push** — the user decides when things ship.
- **Any task needing a schema change also needs a migration**, and migrations on this
  project are applied **by hand with `psql`**, not `prisma migrate deploy`. Read
  `docs/archive/deployment-runbook.md` before writing one, and **never run `prisma migrate dev`
  against the VPS** — the schema has drifted from the migration history and it would offer
  to reset the database.

---

## Task 0 — Make seed failures visible (priority: high, quick)

**File:** `entrypoint.sh`

```sh
node node_modules/tsx/dist/cli.mjs prisma/seed.ts || echo "Notice: Seed check completed."
```

On failure this prints the **same reassuring message as on success**, and the container
carries on. It has now hidden two separate problems: the round-1 client reference collision,
and a boot-time seed that left the client table short until the seed was re-run by hand.

**Change:** make the failure branch say plainly that the seed FAILED and the data may be
incomplete, for all three seed/script lines. Keep the non-fatal behaviour — a hard stop
would turn a data bug into an outage, and that trade-off has not been approved.

Do not change anything else in `entrypoint.sh`. The `db push` line stays as it is: the
schema is applied by hand beforehand, so it is a no-op by design.

---

## Already done — do NOT redo these

- Client master table, wizard Step 1 rework, panel-based WBS, one engineer per panel,
  panel handover, engineer view, logo + Asst. Manager role (all 7 phases).
- **Escape key on global search** — fixed in `src/components/shell/quick-find.tsx`.
- **Double-booking guard** — fixed in both the wizard and
  `automation-project.service.ts` (`panelsByAssignee` check). Client-side blocks submit and
  marks the clashing selects; server-side throws `DomainError`.
- **Stale Team Load date inputs** — fixed in `src/app/(shell)/pm/resources/page.tsx`. The
  From/To inputs are uncontrolled, so `defaultValue` only applied on mount: clicking a
  preset navigated and re-rendered but left the old dates in the boxes, contradicting the
  data shown. They now carry a `key` derived from the window so they remount. **Keep the
  keys** — removing them reintroduces the bug.
- **September 2026 release is DEPLOYED** to the VPS (commit `911d58d`). Migrations applied
  by hand via `psql`; `db push` reports in sync; 13 projects, 16 clients, 0 orphans.
  `docs/archive/deployment-runbook.md` records the procedure. **Pushing to `main` auto-deploys** via
  `.github/workflows/deploy.yml` — assume any commit ships.

---

## Task 1 — Client reference fallback ✅ DONE

The `if (!clientRef) clientRef = 'ACS-0001'` fallback is gone. `createAutomationProject`
now requires `clientId`, resolves the client through
`getClientById(principal.companyId, input.clientId)` — which scopes by company, closing the
cross-company hole — and throws when it misses. Verified: typecheck, 94/94 tests, build.

**One residual, optional:** the caller-supplied `input.clientRefNumber` still takes
precedence over the resolved `client.refNumber`:

```ts
const clientRef = input.clientRefNumber?.trim().toUpperCase() || client.refNumber;
```

An API caller can pass client A's id with client B's reference number and get a project
code that disagrees with its client. The wizard always sends the matching pair, so this is
an API-only edge. Dropping `input.clientRefNumber` from the expression (and from
`createAutomationProjectSchema`) removes the field's only purpose and the hole with it.

---

## Task 2 — Project "On hold" has no way to be set (priority: high, needs a decision first)

**Current state, confirmed by tracing the code:**

- `ON_HOLD` is fully implemented on the **read** side: health badge
  (`domain/portfolio.ts:96`), excluded from `liveProjects`
  (`services/dashboard.service.ts:291`), filter tab on the projects list, status badge.
- It can only be **set** through `PATCH /api/pm/projects/{id}` with
  `{"status": "ON_HOLD"}` — guarded by `pm.project.update`, so Director, Technical Head,
  Project Manager, Assistant Manager and Super Admin.
- **There is no UI control anywhere.** `updateProject` is called from exactly one place:
  `src/app/api/pm/projects/[id]/route.ts:17`. No form, no button, no dropdown.
- Putting a project on hold **does not touch its tasks.** Engineers keep seeing them in My
  Work, and they keep consuming capacity in Team Load. A `pm.project.status_changed` event
  is published but `src/core/events/bus.ts` has **no subscribers**, so nothing consumes it.

### Decisions — CONFIRMED by the user, implement to these

1. **Who can hold:** **PM and above** — Project Manager, Assistant Manager, Technical Head,
   Director, Super Admin. That is the existing `pm.project.update` permission, so no RBAC
   change is needed. Every hold is audited.
2. **Tasks are FROZEN on hold.** They must leave My Work and stop consuming Team Load
   capacity. This is the part that matters — without it a held project keeps showing
   engineers as busy on work nobody is doing.
3. **A reason is REQUIRED** and must be displayed on the project page.

### Implementation notes

**UI:** a hold/resume control on `src/app/(shell)/pm/projects/[id]/page.tsx` next to the
existing `StatusBadge`. Follow `complete-project-button.tsx` in the same folder — server
action + confirm dialog + audit entry. The dialog must capture the reason and reject empty
input.

**Schema:** add `holdReason String?` and `heldAt DateTime?` to `Project`. A third
migration; the columns are nullable so no backfill is needed. Clear both on resume, and
keep the history in the audit trail rather than overwriting silently.

**Freezing:** do it with a subscriber for `PROJECT_STATUS_CHANGED` in `src/core/events/`,
not with cascading writes inline in `updateProject`. The transactional outbox exists for
exactly this and is currently unused — `bus.ts` has zero subscribers, so this will be the
first one. Verify the drain actually runs; `bus.ts` has a shortcut that bulk-marks events
processed when no handlers are registered, and that path must no longer be taken.

**What "frozen" must mean, concretely:**
- excluded from `getWorkloads` capacity maths (`domain/availability.ts` - the cleanest seam
  is the assignment query in `services/availability.service.ts`)
- excluded from My Work (`src/app/(shell)/pm/my-work/`)
- **resume must restore the previous state**, not blanket-reset tasks to TODO. Store enough
  to reverse it, or filter on the parent project's status at read time instead of mutating
  task rows — the read-time filter is simpler and cannot corrupt state, and is the
  recommended approach.

**Do not** cancel or complete tasks on hold. Hold is reversible; those states are not.

---

## Task 3 — Team Load date presets ✅ DONE

Implemented in `src/app/(shell)/pm/resources/page.tsx`: Today · Tomorrow · This week ·
Next 2 weeks, preserving the department/project/skills filters, plus the single-day notice.

**One correction applied after review:** "This week" originally ran Monday→Saturday, so on a
Wednesday it began two days in the past. Past days still add capacity while work completed
in them no longer counts as committed, so the board showed people as freer than they were.
It now runs **today→Saturday** (and on a Sunday, to the end of the week ahead). Verified
against all seven weekdays. Keep it that way.

<details>
<summary>Original task description (for reference)</summary>

**File:** `src/app/(shell)/pm/resources/page.tsx`

Single-day filtering **already works** — set From and To to the same date
(`workingDaysBetween` is inclusive). It is just two manual date edits.

Add preset buttons above the existing From/To inputs: **Today · Tomorrow · This week ·
Next 2 weeks**. They are plain links, no client JS needed:

```
/pm/resources?from=YYYY-MM-DD&to=YYYY-MM-DD
```

**While you are there, add a caveat line to the page** when `from === to`: overdue tasks
dump their *entire* remaining estimate into the window instead of being prorated
(`domain/availability.ts`, `assignmentHoursInWindow`), so a single-day view inflates load
for anyone carrying overdue work. The number is accurate for on-schedule work only.

</details>

---

## Task 4 — Capacity hours mismatch ✅ DONE

`autoAssignAutomationTeam` used to hardcode `dailyCapacityHours: 8` while `getWorkloads`
read each person's real value, so the wizard and Team Load disagreed about anyone not on a
standard 8-hour day. Now reads `user.dailyCapacityHours ?? 8` in
`src/modules/project-management/services/automation-project.service.ts`.

---

## Task 4b — Team Load: show only the percentage (priority: medium, quick)

**User feedback:** `22.5d of 12d` is confusing. Show the percentage alone.

**File:** `src/app/(shell)/pm/resources/team-load-table.tsx`

Remove the `{commDays}d of {totalDays}d` text in **both** places — the desktop table
(~line 201) and the mobile card (~line 339, where it reads `...d committed`). Keep the
percentage and the progress bar exactly as they are, including the red styling above 100%.

Then delete the `commDays` and `totalDays` locals if nothing else uses them (~lines 156–157
and 307–308), and check whether `freeDays` is still needed — the **Free** column uses it, so
it probably stays.

Do not change how the numbers are calculated. This is presentation only.

Verify with `npm run typecheck && npm run build`.

---

## Task 4c — Dashboard: move the period toggle to the card it controls (priority: low)

**File:** `src/app/(shell)/dashboard/director-dashboard.tsx`

The `Last 7 days / Last 30 days` toggle currently sits in the **page header** (~line 87),
beside the "New project" button, where it reads as a dashboard-wide filter. It is not — it
controls exactly one card, `{/* Period Stats */}` (~line 404), whose heading already reads
*"Last 7 days in numbers"*. Verified: every use of `period` resolves into that card's six
stats (`periodStats`), including `completedInPeriod` → `avgApprovalTimeHours` and
`summariseProblems`. Nothing else on the page changes with it.

**Do not remove the toggle** — the stats are meaningless without a stated period.

Move it into that card's `<header>`, right-aligned opposite the title. Keep the links and
the `period === value` active styling exactly as they are; this is a move, not a rewrite.
With the toggle adjacent to the title, drop the duplicated period wording from the heading
so it reads simply `In numbers` (or keep the title and let the toggle carry the period —
either is fine, just do not say it twice).

Leaves the page header with the title and one primary action, which is what
`docs/design-system.md` wants: orange appears once per screen.

---

## Task 5 — Enforce "every panel has an engineer" server-side (priority: low)

**Decision — CONFIRMED: reject it.** Mirror the wizard's rule in the service, next to the
existing `panelsByAssignee` check in `createAutomationProject`. One rule, enforced in one
place, so it stays enforced if a REST route is added later.

Group `input.tasks` by `${templateCode} Panel ${unitIndex}` and throw a `DomainError`
naming any panel whose tasks carry no `assigneeId`.

**Correction to the earlier description of this task:** there is no REST endpoint for
automation-project creation. `createAutomationProject` has exactly one caller —
`createAutomationProjectAction`, a server action used by the wizard. So this is not an open
public API today; the rule is there to keep the service honest on its own.

Note post-creation assignment exists (`assignTaskAction`, `/api/pm/tasks/[id]/assign`) but
only one task at a time — there is no per-panel bulk assign, so "create now, staff later"
is not a practical workflow and does not justify keeping the service permissive.

---

## Task 6 — `npm run lint` ✅ DONE

The script has been **removed** from `package.json`, per the user's decision. Aliasing it to
`tsc --noEmit` was rejected: it made `npm run lint` a duplicate of `typecheck` that passed
green while linting nothing, which is worse than failing loudly.

There is no ESLint binary or config in this repo. **Do not re-add a `lint` script** unless
ESLint is actually installed and configured. Use `npm run typecheck` and `npm run test`.

---

## Task 7 — RBAC remediation (priority: high, BLOCKED on user approval)

`docs/archive/rbac-audit.md` documents five findings. The headline one: `PROJECT_MANAGER` is
seeded at `GLOBAL` scope (`prisma/seed.ts:957`, `:1078`) although `schema.prisma`
explicitly designs it as `PROJECT`-scoped — so **every PM currently has manager rights on
every project in the company.** `ASST_MANAGER`, added in September, inherits the same flaw.

**Do not change any role grant until the user has read and approved the audit.** When
approved, the migration path is: grant `PROJECT_MANAGER` at `PROJECT` scope on project
creation (the code in `createAutomationProject` already does this via `roleAssignment.upsert`),
then revoke the `GLOBAL` grants in a one-off script under `prisma/scripts/`, following the
convention noted in `src/core/rbac/permissions.ts` ("seeding is create-only... add a one-off
script").

Expect regressions in visibility when this lands — `pm/projects`, the dashboards and
`getWorkloads` all resolve scope through the RBAC engine. Plan a full manual pass after.

### DO NOT touch the DIRECTOR grants — confirmed requirement

**The director must be able to see AND approve everything in the company.** Verified working
today, and it works *because* `DIRECTOR` is seeded at `GLOBAL` scope (`prisma/seed.ts:242`)
and `scopeMatches` returns `true` unconditionally for `GLOBAL` (`src/core/rbac/engine.ts`).
That covers listing tasks in review (`listPendingApprovals` + `projectVisibilityWhere`),
approving them (`assertTaskPermission` → `assertProjectPermission`) and deciding handovers.

This remediation is about **`PROJECT_MANAGER` and `ASST_MANAGER` only**. Narrowing scope
across the board would silently remove the director's company-wide approval rights, which
the user has explicitly asked for. Same applies to `SUPER_ADMIN`.

After any RBAC change, re-verify as a director: a task in review on a project he does not
manage must still be approvable.

---

## Task 8 — Cancel and delete a project ✅ DONE

**Confirmed decisions:** both actions; **Cancel is the everyday one**; delete is guarded;
**Director only**.

**Current state:** `pm.project.delete` exists in `src/core/rbac/permissions.ts` and is held by
`DIRECTOR` and `SUPER_ADMIN` only — **not** `PROJECT_MANAGER`, `ASST_MANAGER` or
`TECHNICAL_HEAD`, which is what the user wants. The audit page already renders a
`pm.project.deleted` label. But **nothing implements either action** — no service, no route,
no UI. This is a build, not a wiring-up.

### Cancel — the default action

Sets `status = 'CANCELLED'`. Reversible, keeps every task, log and handover.

`CANCELLED` is already handled in the data layer (the dashboard query excludes it), but the
projects list has **no `CANCELLED` filter chip** (`projects-client.tsx`, `filterChips`). Add
one — without it a cancelled project cannot be found again, and "reversible" is a fiction.

Add a **Restore** action from the cancelled state that returns the project to `PLANNING`.
Audit both directions.

### Delete — guarded, and genuinely permanent

`Project` cascades on delete to `ProjectMember`, `Task`, `Milestone` and `ProjectHandover`,
and `Task` cascades on to `TaskAssignment`, `TaskProgressLog`, `TaskComment`,
`TaskDependency` and `TaskHandover`. **A delete erases the entire work history of the
project.** There is no undo short of a database restore.

Three guards, all required:

1. **Block the delete if any real work has been recorded.** The test: any `TaskProgressLog`
   row against any task of the project. If there is one, refuse with a message saying to
   cancel it instead. This is the rule that makes the feature safe — you can remove a
   mistake, you can never erase history.
2. **Type-to-confirm.** The dialog requires typing the project code exactly (e.g.
   `ACS-0001-0001`). Follow `confirm-dialog.tsx`, extended to take a confirmation string.
3. **Audit before deleting, not after.** The row is gone afterwards, so write the audit
   entry (code, name, client, work order, task count) inside the same transaction and
   *before* the delete. Use the existing `pm.project.deleted` action key.

### Where it goes

`src/app/(shell)/pm/projects/[id]/page.tsx`, alongside the existing
`complete-project-button.tsx` and `handover-project-button.tsx` — follow their pattern
(server action + confirm dialog + audit). Both actions must be invisible to anyone without
`pm.project.delete`; do not render them and then reject server-side.

### Verify

As a director: cancel a project → it leaves the active lists, appears under the new
`Cancelled` chip, and restores cleanly. Delete a project with **no** progress logs → gone,
with an audit entry naming it. Attempt to delete one **with** progress logs → refused with a
clear message. As a PM: neither action is visible, and calling the endpoint directly is
rejected.

---

## Deployment — ✅ DONE for the September release, and how to do the next one

The September release is **live on the VPS** (commit `911d58d`). Verified after deploy:
`db push` reports in sync, 13 projects, 16 clients, 0 orphans, container healthy.

**How this project deploys, because it is not standard:**

1. `entrypoint.sh` runs `prisma db push --skip-generate`, **not** `migrate deploy`. Migration
   files are never executed by the container.
2. So any schema change is applied **by hand with `psql`** on the VPS *before* the code ships,
   which makes the container's `db push` a no-op.
3. **Pushing to `main` is the deploy** — `.github/workflows/deploy.yml` SSHes to the VPS,
   pulls and rebuilds. There is no approval step.
4. Because of (3), the migration SQL cannot arrive via `git pull` — it must be `scp`'d to the
   VPS separately, *before* pushing.

`docs/archive/deployment-runbook.md` has the exact sequence, the verification queries and the
rollback. **Follow it for any future change that touches the schema.** Take a `pg_dump`
first, every time.

**Never run `prisma migrate dev` against the VPS.** The live schema has drifted from the
migration history (an entire table and several columns were applied by `db push` and never
recorded), so `migrate dev` would detect the drift and offer to reset the database.

**Worth doing at some point:** gate the deploy workflow behind `workflow_dispatch` only, so
a push to `main` stops being a production deploy. Every future schema change hits the same
ordering trap, and next time it may not be caught in advance.
