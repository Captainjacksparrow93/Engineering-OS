# Change plan — September 2026 update

Ten requested changes, grouped into 7 phases. Local first, verified, then pushed to VPS.
Decisions confirmed by the user are marked **[decided]**.

---

## Decisions

| # | Question | Answer |
|---|---|---|
| 1 | Project code format | **[decided]** `<CLIENT_REF>-<4-digit seq>` e.g. `ACS-0042-0001` |
| 2 | Work order number | **[decided]** digits only, **unique** across all projects |
| 3 | PO Number / Order Value | **[decided]** **delete the columns**, add new fields |
| 4 | Panel naming | **[decided]** auto — "PLC Panel 1", "PLC Panel 2" |
| 5 | Logo | **[decided]** download from acsengitech.com into `public/` |
| 6 | Panel handover | **[decided]** engineer hands over their **remaining incomplete** tasks in a panel |

---

## Phase 1 — Client master

**Problem:** there is no `Client` entity. `Project.clientName` is free text, so every wizard run
can invent a new spelling of the same customer.

**Schema (`prisma/schema.prisma`)** — new model:

```prisma
model Client {
  id        String   @id @default(cuid())
  companyId String
  name      String
  refNumber String   // e.g. ACS-0042 — the client reference number
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  company  Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  projects Project[]

  @@unique([companyId, name])
  @@unique([companyId, refNumber])
  @@map("pm_clients")
}
```

`Project` gains `clientId String?` + relation, and **keeps** `clientName` as a denormalised
copy (18 files read `clientName`; keeping it means Phase 1 breaks nothing).

**Migration is data-bearing.** Steps, in one migration:
1. Create `pm_clients`.
2. Backfill: one row per `DISTINCT clientName` in `pm_projects`, ref number auto-assigned
   `ACS-0001`, `ACS-0002`, … in alphabetical order.
3. Set `pm_projects.clientId` from the matching name.

**Files:** `prisma/schema.prisma`, new `prisma/migrations/<ts>_client_master/migration.sql`,
`prisma/seed.ts` (seed the clients the demo projects use).

---

## Phase 2 — Wizard Step 1 rework

**File:** `src/app/(shell)/pm/projects/new/automation-project-wizard.tsx` (Step 1 block,
around lines 560–690) and `src/modules/project-management/validation/schemas.ts`.

| Out | In |
|---|---|
| Project Name (free text) | **Work Order No.** — numeric input, digits only, unique |
| Client Name (free text) | **Client** — `<select>` of active clients + "➕ Add new client" |
| Project Code (manual) | **Client Reference No.** — read-only, autofilled from the selected client |
| PO / Order Number | **End User Name** — optional text |
| Order Value (₹ Lakhs) | **Application Name** — optional text |

"Add new client" opens an inline row: name + reference number, both validated for
uniqueness, created via a new server action before the project is submitted.

**Schema changes (`prisma/schema.prisma`):**
- `Project.poNumber` — **dropped**
- `Project.orderValue` — **dropped**
- `Project.workOrderNo String @unique` — added (digits only, enforced in zod)
- `Project.endUserName String?` — added
- `Project.applicationName String?` — added
- `Project.name` — kept, populated as `WO <workOrderNo>` so every existing list/search/title
  that renders `project.name` keeps working untouched

**Project code generation** — replace `nextProjectCode` usage in
`automation-project.service.ts` with a client-scoped generator:
`ACS-0042-0001`, `-0002`, … (max existing sequence for that client ref + 1).
Note `createProjectSchema.code` regex allows 3–20 chars `[A-Z0-9-]` — `ACS-0042-0001` is 13, fits.

**Second migration** drops the two columns and adds the three new ones. Because
`workOrderNo` is `@unique NOT NULL`, existing rows need a backfill value — use the numeric
tail of the existing project code.

**Cleanup:** remove `poNumber`/`orderValue` from `director-dashboard.tsx`,
`pm/projects/[id]/page.tsx`, `dashboard.service.ts`, `project.service.ts`,
`schemas.ts`, `seed.ts`, `seed-demo.ts`.

---

## Phase 3 — Panel-based WBS (core change)

**Problem found in the audit:** `createAutomationProject`
(`src/modules/project-management/services/automation-project.service.ts:226`) loops over
*scopes*, not panels. `PLC × 2` creates **one** phase and **13** tasks whose hours are
doubled — not two panels. `TaskAssignmentDraft.unitIndex` already exists in the type but
is ignored by the `input.tasks.find(...)` lookup.

**Change:** nest a unit loop inside the scope loop.

```
for scope in scopes:                  for scope in scopes:
  create 1 phase                        for unit in 1..scope.quantity:
  create 13 tasks (hours × qty)           create 1 phase  "PLC Panel {unit}"
                                          create 13 tasks (template hours, ×1)
```

- Phase code: `${project.code}-PH{n}` (counter continues across panels).
- Phase title: `PLC Panel 1` — `{templateCode} Panel {unitIndex}`.
- Task hours: plain `item.defaultDurationHours` — **the `× quantity` multiplier is removed**.
- Draft lookup becomes `templateCode + unitIndex + stepNumber`.
- Dependencies (`dependsOnStep`) wire **within a panel**, not across panels — so panels run
  in parallel, which is the whole point of one engineer each.

**Knock-on scheduling changes:**
- `automation-project-wizard.tsx` → `stepHours(item, quantity)` drops the multiplier;
  `minWorkingDaysForHours` and `planLaneByHours` are then computed **per panel**, and the
  project minimum is the longest single panel (panels are parallel), not the sum.
- `packageDays = scope.qty * 13` (wizard Step 2/3 display) becomes per-panel days.
- Service fallback plan (`planLaneByHours(stepHoursList, ...)`) follows the same rule.

**Validation** (`schemas.ts`): `createAutomationProjectSchema.tasks[].unitIndex` becomes
**required** (currently optional).

---

## Phase 4 — One engineer per panel

**Problem:** Step 3 renders one assignee `<select>` per template step — 13 dropdowns per
package, keyed `${templateCode}_${stepNumber}`.

**Change:** one engineer selector **per panel**, keyed `${templateCode}_${unitIndex}`.
The panel card collapses to a single row:

```
▸ PLC Panel 1    Engineer: [ A. Sharma ▾ ]    13 steps · 104 h · 12 Oct → 30 Oct
▸ PLC Panel 2    Engineer: [ B. Patel  ▾ ]    13 steps · 104 h · 12 Oct → 30 Oct
```

Expanding a panel still shows the 13 steps with dates — read-only, for inspection.
On submit, the wizard fans the panel's engineer out across all 13 task drafts, so the
server action contract (`tasks[].assigneeId`) is unchanged.

**Auto-assign** (`autoAssignAutomationTeam`) now allocates **per panel** instead of per
step: one `SmartStepRequirement` per panel carrying the panel's total hours and the
highest `recommendedSeniority` among its 13 steps. Returns one engineer per panel.

**Files:** `automation-project-wizard.tsx` (Step 3 block ~lines 830–1080),
`automation-project.service.ts` (`autoAssignAutomationTeam`), `schemas.ts`
(`autoAssignTeamSchema`).

---

## Phase 5 — Panel handover (remaining work only)

**What already exists:** `TaskHandover` (per task, carries `remainingPercent` /
`remainingHours`) and `ProjectHandover` (whole project). `requestHandover` in
`handover.service.ts:18` already computes remaining work correctly.

**What's missing:** the engineer's case — *"I finished 5 of 13, hand the rest to someone
else."*

**Change:** new `requestPanelHandover(principal, { phaseTaskId, toUserId, reason })` in
`handover.service.ts`:
1. Load the phase task's children.
2. Filter to tasks where the caller holds an **ACTIVE OWNER** assignment and status is
   **not** `COMPLETED` / `CANCELLED` — that is the "remaining 8".
3. Call the existing per-task handover logic for each, in one transaction, one shared reason.
4. One notification to the receiving engineer + one to the PM, summarising *n* tasks —
   not 8 separate pings.
5. The receiver accepts/rejects the batch as a unit.

**UI:** a "Hand over remaining work" button on the panel row in
`src/app/(shell)/pm/projects/[id]/wbs-table.tsx`, visible to the panel's owner and to the
PM. Reuses the existing `handover-form.tsx` dialog.

**API:** `POST /api/pm/handovers` gains a `phaseTaskId` variant, or a sibling route
`/api/pm/handovers/panel`.

**Permissions:** engineers already hold `pm.handover.request`; no RBAC change needed.

---

## Phase 6 — Engineer view

**Problem:** `getDashboard` (`dashboard.service.ts:121`) returns `{ kind: 'engineer' }` —
an empty stub — and `dashboard/page.tsx:26` redirects engineers to My Work. There is no way
for a PM or head to open *one engineer* and see their whole load.

**Change:** new route `src/app/(shell)/pm/resources/[userId]/page.tsx`, reachable by
clicking a name in the existing Team Load table. Guarded by `pm.resource.read`.

Shows, for the selected engineer:
- projects they are a member of, with health, PM and target date
- panels they own, with % complete
- open tasks grouped by project, overdue ones flagged
- capacity/utilisation over the window (reuses `getWorkloads`)
- pending handovers in and out

New service function `getEngineerPortfolio(principal, userId, window)` in
`dashboard.service.ts`, mirroring the shape of `PMDashboardData` so the existing
`pm-dashboard.tsx` presentation components can be reused rather than rewritten.

**Files:** new `pm/resources/[userId]/page.tsx` + `engineer-portfolio.tsx`,
`dashboard.service.ts`, `pm/resources/team-load-table.tsx` (make names links).

---

## Phase 7 — Branding + role hierarchy

### 7a. Logo
Download the mark from https://acsengitech.com/ into `public/acs-logo.svg` (or `.png`).
- `src/components/shell/sidebar.tsx:151` — replace the `Engineering`/`OS` wordmark with
  `<Image src="/acs-logo.svg" ... />`; collapsed sidebar shows the mark only.
- `src/components/shell/sidebar.tsx:245` — **delete** the "ACS Engitech Pvt Ltd" footer
  block (and the now-empty footer container).
- `src/app/login/page.tsx` — same logo swap, for consistency.
- `src/app/layout.tsx:26` — metadata title template: keep or change, your call.

### 7b. Assistant Managers in PM selection
`getPMTeamData` (`automation-project.service.ts:112`) filters managers by
`role PROJECT_MANAGER` **and** TECH department, and the engineer query explicitly excludes
`designation contains 'Asst'` / `'Manager'`.

Change: include users holding an `ASST_MANAGER` role in the manager list. Requires
- a new `ASST_MANAGER` system role in `src/core/rbac/permissions.ts` (`SYSTEM_ROLES`),
  permissions = `PROJECT_MANAGER`'s set (they run projects the same way), and
- assigning it in `prisma/seed.ts` to the asst. managers currently seeded as engineers.

`SENIORITY_ORDER` in the wizard already has an `ASST_MANAGER` entry — it was anticipated.

### 7c. Role hierarchy audit (written deliverable)
Findings so far, to be confirmed and written up as `docs/archive/rbac-audit.md`:

1. **`PROJECT_MANAGER` is seeded at `GLOBAL` scope** (`prisma/seed.ts:957`, `:1078`) —
   but `schema.prisma` documents it as PROJECT-scoped ("a Project Manager role granted at
   scope PROJECT:abc gives nothing on project xyz"). As seeded, every PM has PM rights on
   **every** project. This is the most significant finding.
2. `SENIOR_ENGINEER` and `JUNIOR_ENGINEER` are also `GLOBAL` and identical in permissions —
   the two roles are indistinguishable in practice.
3. `DEPARTMENT_HEAD` has exactly one permission (`admin.user.read`) — heads of HR,
   Purchase, Sales etc. can effectively do nothing in the platform.
4. Two parallel hierarchies exist and can disagree: `User.managerId` (drives "PM squad" via
   `getDescendantUserIds`) and `Department.headId` / `parentId`. Nothing keeps them in sync.
5. `PM_BASE` vs `PROJECT_MANAGER` overlap is undocumented.

The audit will map role → permissions → scope → who holds it, flag each mismatch, and
propose the corrected grants. **No RBAC changes are applied until you approve the audit.**

---

## Order of work and risk

| Phase | Depends on | Risk | Migration? |
|---|---|---|---|
| 1 Client master | — | medium (data backfill) | yes |
| 2 Wizard Step 1 | 1 | medium (column drops) | yes |
| 3 Panel WBS | — | **high** (scheduling maths) | no |
| 4 Engineer per panel | 3 | medium | no |
| 5 Panel handover | 3 | low | no |
| 6 Engineer view | — | low | no |
| 7a/7b Branding + Asst Mgr | — | low | 7b seed only |
| 7c RBAC audit | — | none (report) | no |

Phases 3 and 6 and 7a are independent of 1–2, so they can move in parallel if you want to
see progress early. **Phase 3 is the one to test hardest** — it changes how every
automation project is scheduled.

## Verification before push

Run locally, in this order:

```bash
npm run typecheck && npm run test && npm run build
```

Then a manual pass: create a project with PLC × 2 + SCADA × 1, confirm 3 panels, 39 tasks,
3 engineers, correct dates; complete 5 tasks as an engineer and hand the rest over.

## VPS deployment

> **Superseded — do not follow this section.** It assumed production applies migrations. It
> does not: `entrypoint.sh` runs `prisma db push --skip-generate`, so these migrations would
> never execute, and `db push` will fail on this schema and stop the container from starting.
> See `docs/migration-rehearsal-plan.md` for the analysis and the corrected path.

Only after you sign off locally:

```bash
npx prisma migrate deploy
```

Both migrations are destructive in part (dropped columns), so take a DB dump first:

```bash
pg_dump "$DATABASE_URL" > backup-before-2026-09-update.sql
```
