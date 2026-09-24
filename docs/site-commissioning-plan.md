# Site Commissioning + dashboard tiles — plan

Source: client's handwritten sheets, 22 Sep 2026, plus the user's clarifications.
Two sheets: dashboard count tiles, and an "Engineer calendar view" with site-attendance
numbers. The second turned out to need a whole new module, which is most of this document.

**All decisions below are CONFIRMED by the user. Do not re-ask.**

| Decision | Answer |
|---|---|
| "Waiting for approval" counts | **tasks**, not projects |
| "Handovered" tile | moves to the **engineer view**, lifetime count |
| Site attendance source | new **Site Commissioning** module (below) |
| What ends commissioning | head marks it closed → new **CLOSED** status |
| Who assigns engineers / approves logs | **Technical Head & Director** — explicitly *not* PMs |
| Daily log fields | date, work done, blocker — mirrors `TaskProgressLog` |

---

# HOTFIX — Technical Head is locked out of both new pages (LIVE on production)

**Symptoms**, reproduced by the user as `Dilip Asediya · TECHNICAL HEAD`:

- `/pm/approvals` → "Something went wrong"
- `/pm/commissioning` → "Something went wrong"

**Server log:**

```
⨯ Error [ForbiddenError]: Missing permission: pm.commissioning.approve
⨯ Error [ForbiddenError]: Missing permission: pm.commissioning.manage
```

## Root cause — scope mismatch between the page gate and the service assert

The permissions **are** granted correctly. Verified in production:
`TECHNICAL_HEAD` holds `pm.commissioning.manage` and `pm.commissioning.approve`.

The problem is **how the grant is scoped versus how it is checked**:

1. `TECHNICAL_HEAD` is assigned at **`DEPARTMENT`** scope (`prisma/seed.ts:933,934,946` —
   TECH and DESIGN). It is not a GLOBAL role.
2. `commissioning.service.ts` checks with **`assertCan(principal, 'pm.commissioning.manage')`
   — passing no scope** (lines 20, 98, 133, 207, 241, 292, 325, 356, 428…).
3. `scopeMatches` in `src/core/rbac/engine.ts` handles a DEPARTMENT grant as:

   ```ts
   case 'DEPARTMENT': {
     const target = scope.departmentId;
     if (!target) return false;      // ← no scope passed, so ALWAYS false
   ```

So a scope-less `assertCan` can **only ever be satisfied by a GLOBAL grant**. Director and
Super Admin pass; Technical Head — the role this whole feature was designed around — is
refused.

The approvals page compounds it: it gates the commissioning section with
`hasPermissionAnywhere(principal, 'pm.commissioning.approve')`, which **ignores scope** and
returns `true` for the head, then calls a service that asserts *with* scope and throws. The
gate and the assert disagree, so the whole page 500s instead of hiding one section.

PMs are unaffected — `hasPermissionAnywhere` is false for them, so the section is skipped
and the page still renders. **The regression is limited to department-scoped holders, i.e.
Technical Head.**

## Fix

**Commissioning is a company-wide capability, not a departmental one.** A head assigns
engineers "from any PM's team", so there is no meaningful department to scope against.

Replace every scope-less `assertCan(principal, 'pm.commissioning.*')` in
`src/modules/project-management/services/commissioning.service.ts` with a scope-agnostic
check that throws the same error type:

```ts
if (!hasPermissionAnywhere(principal, 'pm.commissioning.manage')) {
  throw new ForbiddenError('Missing permission: pm.commissioning.manage');
}
```

This is the existing precedent — `autoAssignAutomationTeam` in
`automation-project.service.ts` does exactly this for `pm.project.create`. It also makes the
service agree with how the pages already gate.

**Do not "fix" this by granting `TECHNICAL_HEAD` a GLOBAL role.** That would quietly widen
every other permission the role holds, well beyond commissioning.

## Also harden the approvals page

Even with the fix, one failing section should not take down the page. Wrap the
commissioning fetch so a failure yields an empty list and the task-approval and handover
sections still render. `/pm/approvals` is a daily-use screen for PMs and heads; it must not
be brought down by an unrelated feature.

## Verify

As `TECHNICAL_HEAD`: `/pm/commissioning` loads, a completed project can be assigned an
engineer, `/pm/approvals` loads with all three sections. As `DIRECTOR`: unchanged. As a
`PROJECT_MANAGER`: `/pm/approvals` still loads and shows **no** commissioning section, and
`/pm/commissioning` is neither visible in the sidebar nor reachable by URL.

## Audit the same mistake elsewhere

Grep for other scope-less `assertCan(` / `can(principal, 'x')` calls added recently. Any
permission checked without a scope is invisible to DEPARTMENT- and PROJECT-scoped holders,
so the same trap may exist in the hold and delete work.

---

# Part A — Site Commissioning module

The substantial piece. Build this before Part B, because two dashboard tiles depend on it.

## The flow, as the user described it

1. A project finishes → status `COMPLETED`.
2. **Head** opens **Site Commissioning**, sees the list of completed projects.
3. Head picks a project, then picks an engineer — **from any PM's team; no PM involved**.
   More engineers can be added one at a time via an "Add engineer" button that opens a
   dropdown.
4. That project moves to **COMMISSIONING**. Completed projects with nobody assigned show as
   **Pending**.
5. Assigned engineers get a **Commissioning** menu where they **log daily**.
6. Head **approves** those logs.
7. Head marks commissioning complete → project moves to **CLOSED**.

## Schema

**`ProjectStatus` gains two values:**

```prisma
enum ProjectStatus {
  DRAFT
  PLANNING
  IN_PROGRESS
  ON_HOLD
  COMPLETED
  COMMISSIONING   // new
  CLOSED          // new - commissioning finished
  CANCELLED
}
```

**"Pending" is NOT a status.** It is derived: `COMPLETED` with no commissioning assignment.
Do not add a third enum value for it.

**Two new tables:**

```prisma
model CommissioningAssignment {
  id         String    @id @default(cuid())
  projectId  String
  userId     String
  assignedById String
  assignedAt DateTime  @default(now())
  releasedAt DateTime?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@index([userId])
  @@map("pm_commissioning_assignments")
}

model CommissioningLog {
  id          String    @id @default(cuid())
  projectId   String
  userId      String
  loggedFor   DateTime  @db.Date     // the day on site - drives "days on site"
  workDone    String
  blocker     String?
  approvedById String?
  approvedAt  DateTime?
  rejectedAt  DateTime?
  decisionNote String?
  createdAt   DateTime  @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId, loggedFor])   // one log per engineer per project per day
  @@index([projectId, loggedFor])
  @@index([userId, loggedFor])
  @@map("pm_commissioning_logs")
}
```

That `@@unique` is what makes "days on site" a trustworthy count — it makes double-logging a
day impossible rather than something to de-duplicate later.

**Add the back-relations** on `Project` and `User`.

## Permissions

Add to `src/core/rbac/permissions.ts`:

- `pm.commissioning.manage` — assign engineers, mark commissioning complete
- `pm.commissioning.log` — record your own daily logs
- `pm.commissioning.approve` — approve or reject logs

Grant `manage` + `approve` to **TECHNICAL_HEAD**, **DIRECTOR** and **SUPER_ADMIN** only.
Grant `log` to **SENIOR_ENGINEER** and **JUNIOR_ENGINEER**.
**Do not grant any of these to PROJECT_MANAGER or ASST_MANAGER** — the user was explicit
that PMs are not part of this flow.

Note `SYSTEM_ROLES` seeding is **create-only** (see the comment in `permissions.ts`), so
existing roles will not pick up the new permissions automatically. A one-off script under
`prisma/scripts/` is needed to grant them to roles that already exist.

## Screens

**`/pm/commissioning` — head's view** (`pm.commissioning.manage`)
Two sections: **Pending** (completed, unassigned) and **In commissioning** (assigned).
Selecting a pending project opens assignment: a dropdown of **all active engineers across
every team** — not filtered by PM — plus "Add engineer" to append another. Each row shows
who is assigned and lets one be removed (set `releasedAt`).
Also the **"Commissioning complete"** action → project becomes `CLOSED`. Confirm before
doing it, following `complete-project-button.tsx`.

**`/pm/commissioning/my` — engineer's view** (`pm.commissioning.log`)
The projects they are assigned to, and a daily log form: date, work done, optional blocker.
Defaults to today. Shows their recent logs with approval state.

**Log approval** — extend the existing `/pm/approvals` page with a commissioning section
rather than building a second approvals screen. `listPendingApprovals` in `task.service.ts`
is the pattern to follow.

**Sidebar** (`src/components/shell/sidebar.tsx`): "Site Commissioning" under Management
(requires `pm.commissioning.manage`), "Commissioning" under Workspace (requires
`pm.commissioning.log`). The existing `requires` mechanism handles visibility.

## Careful — adding statuses ripples

Every place that treats `COMPLETED` as the terminal project state must be reviewed.
Confirmed project-level (task-level hits are unaffected):

- `domain/portfolio.ts:95` — `projectHealth`. Decide what health `COMMISSIONING` and
  `CLOSED` report. Suggest `CLOSED` → `COMPLETED`, and `COMMISSIONING` → its own state so it
  is not reported as late.
- `services/dashboard.service.ts:263` — `projectActive` excludes `ON_HOLD`/`COMPLETED`.
  A commissioning project is arguably still active; `CLOSED` is not.
- `services/dashboard.service.ts:291` — `liveProjects` filter.
- `src/app/(shell)/pm/projects/projects-client.tsx` — the status filter tabs need the two
  new states.
- `domain/portfolio.ts:85` — `HealthStatus` union.

**Do not skip this review.** A missed spot means commissioning projects silently vanish from
a dashboard or get reported as overdue forever.

## Migration

Schema change ⇒ a hand-written migration, applied with `psql`.
**Read `docs/deployment-runbook.md` first.** This project does not run
`prisma migrate deploy`; migrations are applied by hand before the code ships, which makes
the container's `db push` a no-op.

This migration is **additive only** — two new tables, two new enum values, no data loss and
no backfill. Much safer than the September one. Note Postgres requires `ALTER TYPE ... ADD
VALUE` for enum additions, which **cannot run inside a transaction block** — so this
migration cannot use `--single-transaction`. Split it: enum values first, then the tables.

---

# Part B — Dashboard tiles

Sheet 1: seven count tiles in two rows. Six read existing data.

**Row 1:** Running projects (`IN_PROGRESS`) · Completed (`COMPLETED`) · Not started
(`PLANNING` + `DRAFT`)

**Row 2:** Waiting for approval · Overdue · Hold · *(handover moves to the engineer view)*

- **Waiting for approval — counts TASKS**, not projects: tasks submitted for review, plus
  tasks where an engineer has raised an issue. The blocker/problem half exists via
  `summariseProblems`.

  **This tile replaces the current "Waiting on decisions" tile, which is BROKEN — fix it
  here.** Today it links to `/pm/approvals` (`director-dashboard.tsx:134`) but its count is
  `pendingApprovals + taskHandovers + projectHandovers` (`dashboard.service.ts:418`) —
  three different things under one label. With 0 approvals and 2 pending handovers it shows
  "2 items" and sends the user to a page that says "No items awaiting your approval."
  Confirmed live on production.

  **Fix:** the new tile counts **task approvals only**, so its label matches its number, and
  keeps the `/pm/approvals` link. Check whether `headline.waitingDecisions` is used anywhere
  else before changing its shape, and keep `oldestDays` meaningful for what it now counts.
  Pending handovers are not dropped — they get their own section on the Approvals page, per
  Part B2 below.

- **Overdue** — `health = LATE`, already computed.
- **Hold** — `status = ON_HOLD`. The column holds data today only because `seed-demo.ts`
  writes it directly (production currently shows 1 on hold, all demo). **No user can set it
  until Task 2 ships**, so for real projects this tile stays at 0. Ship Task 2 first.

**Plus two commissioning tiles** (from Part A):
- **X projects in commissioning** — `status = COMMISSIONING`
- **X engineers on commissioning** — distinct users with an active `CommissioningAssignment`

**Tiles are clickable** — the user asked that selecting a card shows the underlying list.
Link each to the relevant filtered list rather than building modals: e.g.
`/pm/projects?status=COMMISSIONING`, `/pm/commissioning`.

Keep to the design system: use the existing `Stat` primitive in `src/components/ui.tsx` and
the `.card` recipe. No new colours, no shadows.

---

# Part B2 — The director cannot reach pending handovers ✅ DONE

**Confirmed on production.** The director sees "2 items waiting on decisions" on his
dashboard, and there is **no screen in the app where he can see or act on them**. Approvals
is blank (0 tasks in review — correct) and Requests is blank too.

## Cause

`listHandovers` in `src/modules/project-management/services/handover.service.ts` builds its
oversight queries with:

```ts
task: { project: { managerId: principal.userId } }
```

and the project-handover equivalent, `project: { managerId: principal.userId }`.

**Oversight is defined as "projects I personally manage."** The director manages none — all
13 production projects belong to 2 PMs (8 and 5). Verified: `Shaktikumar Vasava` (`ACS-0004`,
Director) is manager of **0** projects. So all three of his queries — incoming, outgoing,
oversight — return nothing.

This is not a permissions problem. The director holds `pm.progress.review` and
`pm.handover.decide` at `GLOBAL` scope and *may* decide any handover; the list query simply
never shows them to him.

## Fix 1 — oversight must follow visibility, not management

Replace the `managerId: principal.userId` condition in both oversight queries with the
project visibility rule already used everywhere else:

```ts
project: projectVisibilityWhere(principal)
```

from `src/modules/project-management/services/access.ts`. For anyone holding
`pm.project.read.all` (Director, Super Admin) that resolves to the whole company; for a PM it
still resolves to their own projects, department and memberships — so **no one loses
anything, and managers see what they see today**.

Keep excluding handovers where the principal is the `from` or `to` user, since those are
already covered by the incoming/outgoing lists.

## Fix 2 — show pending handovers on the Approvals page

**User's words: "if a handover request is pending it should list there — don't keep it
blank."**

Add a **Pending handovers** section to `/pm/approvals`, below the task approvals, listing
both task and project handovers awaiting a decision within the principal's visibility.
Each row needs the task/project, from → to, the reason and the age, with the accept/reject
actions already implemented in `handover-actions.tsx`.

Reuse `listHandovers` rather than writing a new query, and reuse the existing row and action
components — this is assembly, not new machinery.

Update the empty state so it is only shown when **both** sections are empty, and reword it:
"Nothing is waiting on you" rather than "No items awaiting your approval."

## Why this matters beyond the director

Any oversight role that does not personally manage projects — Technical Head, Assistant
Manager, a Director — has the same blind spot today. The fix covers all of them at once.

## Verify

As the director, with a pending handover on a project he does not manage: it must appear on
`/pm/handovers` **and** in the new section on `/pm/approvals`, and he must be able to accept
or reject it. Then repeat as a PM and confirm they still see exactly what they saw before —
no more, no less.

---

# Part C — Engineer view additions

Sheet 2's two tiles belong on the engineer portfolio page
(`src/app/(shell)/pm/resources/[userId]/`), which already exists:

- **Number of site visits** — count of that engineer's `CommissioningLog` rows
- **Days on site** — count of distinct `loggedFor` dates (the `@@unique` makes these equal,
  but count distinct dates anyway so it stays correct if the constraint ever changes)
- **Handovers** — lifetime count of `TaskHandover` where this engineer was `fromUser` or
  `toUser`. **Confirmed: lifetime, not a rolling window.**

The client's sheet calls this a "calendar view". Start with the counts; a calendar grid of
logged days is a reasonable follow-up once there is data to show, and should not hold up
Part A.

---

# Part D — Approvals: separate button and reversible

The top of sheet 1 reads: *"Waiting for approval — separate button & reversible."*

**Do not build this yet — it needs scoping.** Making an approval reversible is not a UI
change: `TaskProgressLog` is an append-only ledger and task state is a projection of it, so
"un-approving" must be a new compensating entry, never a delete or an in-place edit. Getting
that wrong corrupts the audit trail, which is the one thing this system must not do.

Raise it with the user separately: what does reversing an approval do to the task's status,
its percent complete, and who is allowed to do it.

---

# Build order

| # | Item | Why |
|---|---|---|
| 1 | **Part B2 — director cannot reach pending handovers** | **Live bug.** Work is stuck with nobody able to action it. Small fix, no schema change. Do it first. |
| 2 | **Task 2 — project On Hold** (already queued) | The Hold tile is dead without it |
| 3 | Part A — schema + migration | Everything else depends on it |
| 4 | Part A — screens and permissions | The module itself |
| 5 | Part B — dashboard tiles | Now every tile has real data |
| 6 | Part C — engineer view counts | Small, additive |
| 7 | Part D | Blocked pending scoping |

**Definition of done for each:** `npm run typecheck && npm run test && npm run build`.
Commit, but **do not push** — pushing to `main` deploys to production.
