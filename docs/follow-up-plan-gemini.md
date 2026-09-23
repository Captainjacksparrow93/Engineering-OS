# Follow-up plan — remaining work after the September 2026 update

Hand this to Gemini (or any agent) as the next work order. It assumes the September update
in `docs/change-plan-2026-09.md` is already implemented and verified locally.

**Before starting:** line numbers below are from commit `0a7a93c` plus the uncommitted
September changes. They will shift as soon as editing begins — search for the quoted code
instead of trusting the number.

**Definition of done for every task:** `npm run typecheck && npm run test && npm run build`
all pass. Do not run `npm run lint` — it is broken for an unrelated reason (see Task 6).

---

## Already done — do NOT redo these

- Client master table, wizard Step 1 rework, panel-based WBS, one engineer per panel,
  panel handover, engineer view, logo + Asst. Manager role (all 7 phases).
- **Escape key on global search** — fixed in `src/components/shell/quick-find.tsx`.
- **Double-booking guard** — fixed in both the wizard and
  `automation-project.service.ts` (`panelsByAssignee` check). Client-side blocks submit and
  marks the clashing selects; server-side throws `DomainError`.

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

## Task 4 — Capacity hours disagree between two screens (priority: medium)

`getWorkloads` uses each person's real `user.dailyCapacityHours`, but
`autoAssignAutomationTeam` hardcodes it:

```ts
dailyCapacityHours: 8,
```

in `src/modules/project-management/services/automation-project.service.ts` (in the
`candidates` mapping, search for `personWorkloadData`). For anyone not on a standard 8-hour
day, the wizard's auto-assign and the Team Load board will disagree about the same person.

**Fix:** use `user.dailyCapacityHours` — it is already selected on the `users` query in
that function.

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

`docs/rbac-audit.md` documents five findings. The headline one: `PROJECT_MANAGER` is
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

---

## Deployment — BLOCKED, see `docs/migration-rehearsal-plan.md`

**Do not deploy to the VPS yet.** `entrypoint.sh` runs `prisma db push --skip-generate`,
not `migrate deploy`, so the two migration files never execute in production — the client
and `workOrderNo` backfills would simply not happen. Worse, `db push` will *fail* on this
schema (a required unique column added to a populated table, plus two dropped columns), and
because `entrypoint.sh` uses `set -e` with no `|| true`, the container will not start.

`docs/migration-rehearsal-plan.md` has the full analysis, the recommended fix (baseline the
production database, switch the entrypoint to `migrate deploy`) and a step-by-step local
rehearsal. **Run that rehearsal and report before anything is pushed.**

The dump stays mandatory whatever path is chosen — the migrations drop `poNumber` and
`orderValue`:

```bash
pg_dump "$DATABASE_URL" > backup-before-2026-09-update.sql
```
