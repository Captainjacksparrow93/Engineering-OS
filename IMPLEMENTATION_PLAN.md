# Implementation plan — data resets, step hours, dashboard type cards, team isolation

Date: 2026-09-17 · Base commit: `c10f8a5` (branch `main`)

Four changes, in this order. Step 1 comes first because until it's fixed, any checklist edit made for step 2 is wiped on the next restart.

1. **Bug:** edits reset when the app starts again
2. **Feature:** editable "time to complete" per checklist step, in hours
3. **Feature:** four type cards on the dashboards (PLC, SCADA, HMI, On hold)
4. **Feature:** team isolation — reassign only within your own PM's team

## Ground rules

- `CLAUDE.md` applies: explain each step to the owner in plain language and wait for "go" before editing code. Follow `docs/design-system.md`. Never check role names or grades in code.
- After each step: `npm run typecheck && npm test && npm run build`, then run that step's **Verify** checks and paste the results in the summary for the owner.
- Don't change or delete existing project data (including `DEMO-*` projects) while doing this work.

---

## Step 1. Bug: edits reset when the app starts again

### Root cause (verified in code)

The container start script [`entrypoint.sh`](entrypoint.sh) runs `prisma/seed.ts` **on every start**:
- the Hostinger VPS restarts on every push (GitHub Actions deploy)
- the local Docker app `engos_local_app` in `docker-compose.local.yml` restarts with Docker Desktop

`seed.ts` isn't "create if missing": it **overwrites** existing data from hard-coded lists.

| What the owner edits in the app | What `prisma/seed.ts` does on every start | Line |
|---|---|---|
| Checklist step title, seniority, duration, dependency | `checklistTemplateItem.update` back to the hard-coded values; deleted steps are re-created | 138–177 |
| Roles & permissions (admin screen) | `rolePermission.deleteMany` + `createMany` from `SYSTEM_ROLES` for every role | 47–61 |
| Module status | `moduleRegistryEntry.upsert` overwrites status / sortOrder | 66–81 |
| User name, designation, grade, department, skills, email | `user.upsert` → `update` overwrites all of them | 1328–1352 |
| **User passwords** | `update: { passwordHash }` resets every password to `SEED_PASSWORD` | 1345 |
| Line managers, department heads | overwritten for every seeded person / department | 1356–1389 |
| Role assignments given in the admin screen | `roleAssignment.deleteMany` for all non-project grants, then re-created from the seed list | 1391–1398 |
| Any project not among the 3 standard projects (except `DEMO-*`) | **deleted** with all its tasks | 1478–1502 |
| The 3 standard projects (PRJ-2026-001/002/003) | all tasks, assignments, progress logs, handovers and members **deleted and re-created** | 1504–1525 |

`prisma/seed-automation-templates.ts` has the same overwrite behaviour for checklist items (lines 93–126). It isn't called at startup, but anyone running it by hand resets the checklists.

`prisma/seed-demo.ts` is already safe: it exits if any `DEMO-*` project exists.

### Fix

Split seeding into a **safe startup bootstrap** and an **explicit, manual reset**.

1. **`prisma/seed.ts` becomes create-only (safe to run on every start).** For every block above:
   - Permissions: `upsert` with `update: {}`, so new keys are added and nothing existing is changed.
   - Roles: create a role and its permission links **only when the role doesn't exist yet**. Never delete or re-create `core_role_permissions` for existing roles.
   - Module registry, company, departments: create only (`update: {}`).
   - Checklist templates: create a template and its items **only when the template code doesn't exist**. Never update or re-create items of an existing template.
   - Users: create only. `update: {}`, so no password, name, grade, department or email overwrite. Set `managerId` and department `headId` only for users / departments created in this run.
   - Role assignments: remove the reconcile block (1391–1420 area) from startup. Create a person's seed role assignment only when that user was created in this run.
   - Projects: remove the purge (1478–1502) and the task wipe (1504–1525). Create the 3 standard projects and their tasks only when the project code doesn't exist.
   - Leaves: keep create-if-missing (already).
2. **New manual script `prisma/dev-reset.ts`** (`npm run db:reset:dev`) holds the old overwrite behaviour, for local development only.
   - It refuses to run when `NODE_ENV === 'production'` unless `ALLOW_DEV_RESET=true`.
   - Never call it from `entrypoint.sh`.
3. **Roles added or changed in code later:** because startup no longer re-syncs role permissions, a code change that grants an existing role a new permission needs an explicit one-off script, e.g. `prisma/scripts/grant-<name>.ts`, run once and committed. Add a short comment above `SYSTEM_ROLES` in `src/core/rbac/permissions.ts` explaining this.
4. **`prisma/seed-automation-templates.ts`:** make it create-only like step 1, or delete it if nothing uses it (`grep -rn seed-automation-templates`).
5. **Leave `entrypoint.sh` running `seed.ts` and `seed-demo.ts`.** Both are now safe.

### Verify (step 1)

Paste the results:
1. Run `npx tsx prisma/seed.ts` twice in a row. Compare row counts of `pm_projects`, `pm_tasks`, `pm_task_progress_logs`, `core_role_assignments`, `core_role_permissions`, `pm_checklist_template_items` before and after the second run: they must be identical.
2. In the app:
   - edit checklist step 3's title
   - change a role's permissions
   - change a user's designation
   - log progress on a standard-project task
   - create a new project
3. Restart the app the way the owner does (`docker compose -f docker-compose.local.yml restart app`, or redeploy). All five edits from step 2 are still there, and all `DEMO-*` projects are unchanged.
4. Sign in with a password changed in the app. It still works after the restart.

---

## Step 2. Checklist step "time to complete" in hours

### Current state (verified)

- `ChecklistTemplateItem.defaultDurationDays Int @default(1)` (`prisma/schema.prisma`).
- The Checklists screen `src/app/(shell)/pm/templates/template-manager.tsx` has **no duration column and no duration input**:
  - the header at line 152 is an empty leftover
  - the edit row has no field for it (state `editDuration` exists but isn't rendered)
  - "Add Subtask" always sends `defaultDurationDays: 1` (line 99)
- The wizard and `automation-project.service.ts` schedule in whole days (`defaultDurationDays × quantity`) and store `estimatedHours = days × 8`.
- Note: an earlier decision removed tracking of **hours spent**. This feature is **planned** time per step, entered by Directors / Technical Heads in Checklists. It's a different thing, and the owner asked for it explicitly.

### Decisions (owner)

- Time to complete is entered **in hours** per checklist step. Default **8 hours**.
- For a project with N panels of a type, each step's time = step hours × N (same rule as before, now in hours).

### Rules (defaults; adjust only if the owner says otherwise)

- One working day = **8 hours**. Sundays are not working days (existing `addWorkingDays`).
- Allowed values: 0.5 to 200 hours, in steps of 0.5.
- **Scheduling within a lane (package)** is by cumulative hours, so short steps can share a day:
  - `hoursBefore` = sum of hours of earlier steps in the lane
  - start day index = `floor(hoursBefore / 8)`
  - end day index = `ceil((hoursBefore + stepHours) / 8) − 1`
  - `plannedStart = addWorkingDays(projectStart, startIndex)`, `plannedEnd = addWorkingDays(projectStart, endIndex)`
  - Example: steps of 4 h, 4 h, 12 h → step 1 day 1, step 2 day 1, step 3 days 2–3.
- Minimum project length = `ceil(total lane hours / 8)` working days for the longest lane. The wizard's pre-filled target date and "needs at least N working days" message use this.
- `Task.estimatedHours` = step hours × quantity. Team load, auto-assign and progress weighting already use `estimatedHours`, so no changes there.

### Changes

1. **Schema**:
   - add `defaultDurationHours Float @default(8)` to `ChecklistTemplateItem`
   - backfill `defaultDurationHours = defaultDurationDays * 8` for existing rows (all are 1 day today, so all become 8 h)
   - stop reading `defaultDurationDays`, but don't drop the column in this change; add a `ponytail:` comment
   - entrypoint uses `prisma db push`, so also add the backfill as an idempotent SQL statement in the create-only bootstrap (`UPDATE … WHERE "defaultDurationHours" = 8 AND "defaultDurationDays" <> 1`)
   - create a proper migration in `prisma/migrations/` as well
2. **Pure helper** `planLaneByHours(stepHours: number[], projectStart: Date): Array<{ plannedStart; plannedEnd }>` in `src/modules/project-management/domain/scheduling.ts`, with unit tests:
   - 13 × 8 h = 13 working days
   - 4 h + 4 h in one day
   - a Sunday is skipped
   - quantity 2 doubles the hours
3. **Validation** (`src/modules/project-management/validation/schemas.ts`, template item schema ~line 194): replace `defaultDurationDays` with `defaultDurationHours: z.coerce.number().min(0.5).max(200).multipleOf(0.5)`.
4. **Service** `template.service.ts`: `updateTemplateItem` / `addTemplateItem` accept `defaultDurationHours` (default 8). Audit the change.
5. **Checklists screen** (`template-manager.tsx`):
   - Replace the empty header with **Time to complete**. Display e.g. `8 h`, or `12 h · 1.5 days` when not a whole day.
   - Edit row: number input (hours, `step="0.5"`, `min="0.5"`).
   - Add Subtask modal: a "Time to complete (hours)" field, default 8.
   - Card header shows the template total: "13 steps · 104 h · 13 working days".
   - Design tokens only (the edit row currently uses `bg-amber-50/40`; replace it with a token).
6. **Project creation**:
   - In `automation-project-wizard.tsx` and `automation-project.service.ts`, replace every `defaultDurationDays` / `durationDays × 8` usage with `defaultDurationHours × quantity`, and use `planLaneByHours` for dates.
   - Wizard step 3 shows each step's hours and dates.
   - Remove the day-based `taskDurations` state or convert it to hours.
   - Check with `grep -rn "defaultDurationDays\|durationDays" src prisma`.
7. **Task page** (`src/app/(shell)/pm/tasks/[id]/page.tsx:149`): show planned time as `12 h (2 working days)` instead of rounding to days only.
8. **Demo script** `prisma/seed-demo.ts`: use `defaultDurationHours` when it builds new demo data. It doesn't change existing demo projects.
9. Existing projects keep their current dates. Only new projects use the hours.

### Verify (step 2)

- As Dilip in Checklists, set PLC step 5 to 4 h and step 6 to 4 h. Reload, restart the app (step 1), and the values are still there.
- Create a PLC × 1 project starting on a Monday: steps 5 and 6 share one day. The pre-filled target date equals the new minimum length (12 working days for 13 steps with two 4 h steps).
- Create a PLC × 2 project: every step's `estimatedHours` is double its template hours.
- The new unit tests pass.

---

## Step 3. Dashboard type cards: PLC, SCADA, HMI, On hold

### Decisions (owner)

- **Four cards, one number each:** PLC, SCADA, HMI, On hold. No per-status breakdown.
- **Director / Technical Head dashboard:** counts across all projects they can see.
- **PM dashboard:** counts only projects that PM manages.
- **PLC / SCADA / HMI cards** count **active** projects: status `PLANNING`, `IN_PROGRESS` or `DRAFT`. On-hold, completed and cancelled projects are not in these three.
- **On hold card** counts projects with status `ON_HOLD`, of any type.
- A project with two types (e.g. PLC + HMI) counts in **both** type cards.
- The "Last 7 / 30 days" toggle doesn't affect these cards.

### Knowing a project's types

Today the type isn't stored:
- Projects created by the wizard have a PHASE task titled like `PLC × 2: PLC Programming + Simulation`.
- The 3 standard seed projects have no PHASE tasks.

Parsing titles is fragile, so:
1. **Schema:** add `automationTypes String[] @default([])` to `Project` (values `PLC`, `SCADA`, `HMI`).
2. **Set it on creation:**
   - `createAutomationProject` sets it from `input.scopes` (distinct `templateCode`s with quantity > 0)
   - `prisma/seed-demo.ts` sets it from each spec's lanes, for new runs
3. **One-off backfill script** `prisma/scripts/backfill-automation-types.ts` for existing projects. It's safe to re-run and only fills projects whose `automationTypes` is empty. For each project, a type applies when:
   - a PHASE task title starts with that code (`PLC`, `SCADA`, `HMI`), **or**
   - the project has a task whose title equals that template's step 1 title (these are unique per template: PLC "Review Control Philosophy / Functional Requirements", SCADA "Review P&ID and requirement", HMI "Review P&ID and HMI screen requirements").
   
   Print a table of project code → types so the owner can check it.

### Service and UI

1. `src/modules/project-management/services/dashboard.service.ts`:
   - add `typeCounts: { PLC: number; SCADA: number; HMI: number; onHold: number }` to both `DirectorDashboardData` and `PMDashboardData`
   - select `automationTypes` in the existing projects query (no extra query)
   - Director: count over all projects in scope
   - PM: count over `managerId === principal.userId`
   - put the counting in a small pure function with a unit test (multi-type project counted in both, on hold not in type cards, completed excluded)
2. `director-dashboard.tsx` and `pm-dashboard.tsx`:
   - a row of four cards directly **under the headline cards** (above Needs attention)
   - same card style as the existing headline cards: label, big number, caption "active projects" (or "projects on hold")
   - 4 columns on desktop, 2 × 2 below 640 px
   - design tokens only, no orange
   - not clickable in this change (a type filter on the Projects page would be a separate request)

### Verify (step 3)

Expected with the current local data (standard projects Tata Chemicals = PLC, Sunrise Cement = SCADA, Godrej Foods = HMI, all active, plus the demo projects). If a standard project's status has changed, adjust and explain.

| Viewer | PLC | SCADA | HMI | On hold |
|---|---|---|---|---|
| Director | 5 (DEMO-01, 04, 05, 08, Tata) | 2 (DEMO-02, Sunrise) | 3 (DEMO-03, 05, Godrej) | 1 (DEMO-06) |
| Parth (PM) | 3 (DEMO-01, 05, Tata) | 0 | 3 (DEMO-03, 05, Godrej) | 0 |
| Paras (PM) | 2 (DEMO-04, 08) | 2 (DEMO-02, Sunrise) | 0 | 1 (DEMO-06) |

DEMO-07 (completed) appears in no card. DEMO-05 (PLC + HMI) appears in both PLC and HMI.

---

## Step 4. Team isolation for reassigning

### Decision (owner)

- A **PM** can reassign a task only to engineers **in their own team**.
- An **engineer** can reassign a task only to other engineers **in the same PM's team**. For example, an engineer under Parth can only pick engineers under Parth.

### Definitions

- **Team root:** start from the person and walk up `User.managerId`. Stop at the first person whose own manager holds `pm.oversight` (a Technical Head or Director), or who has no manager. That person is the team root.
  - Parth and Paras report to Dilip (Technical Head), so they are team roots.
  - Dhrupin → Parth, so Dhrupin's team root is Parth.
  - Yogi → Dhrupin → Parth, so Yogi's team root is Parth.
  - This is based on the reporting chain, not on job titles or grades.
- **Team:** everyone in the team root's report subtree (reuse `expandReportSubtree` in `src/core/rbac/principal.ts`), plus the root.
- **Reassign candidates:** team members who are execution staff (`isExecutionStaff` in `domain/availability.ts`: no PMs, assistant managers, heads or directors), are active, and aren't already holding the task.
- **Which team applies:**
  - the **requester's** team root
  - for a PM, that's their own team
  - an engineer from Paras's team working on one of Parth's projects can still only choose people in Paras's team
- **Directors and Technical Heads** aren't restricted by team (upper management). *Default; confirm with the owner.*

### Changes

1. **Helper** `teamMemberIds(companyId, userId)` in `src/modules/project-management/services/access.ts`: one query for `{ id, managerId }` of active users, then in-memory walk up and down. Unit-test the pure part with the example tree above.
2. **Server-side enforcement** (hiding names in a list isn't enough):
   - `requestHandover` in `services/handover.service.ts`: if the requester doesn't hold `pm.oversight`, reject a `toUserId` outside the requester's team with `DomainError('You can only reassign to engineers in your own team.')`.
   - Assigning a task that has **no owner** (instant assignment by the PM): apply the same team rule.
3. **Candidate lists use the same helper:**
   - task page `assignableUsers` (`src/app/(shell)/pm/tasks/[id]/page.tsx:36–45`, currently every Senior/Junior engineer in the company)
   - `handoverCandidates` / `peersForHandover` (`services/availability.service.ts:209, 367`)
   - the Urgent task assignee list
4. **Project creation (wizard + auto-assign):**
   - assignee dropdowns list only the selected PM's team
   - auto-assign only picks from the PM's team: remove the cross-squad fallback in `allocateTeamForSteps` (`domain/availability.ts`, `pool = squadEligible.length > 0 ? squadEligible : eligible`)
   - if nobody in the team qualifies, leave the step unassigned with "No one in the PM's team is free for this step"
   - *Default; confirm with the owner.*
5. **Not affected:** project handover from one PM to another.

### Verify (step 4)

With the current org chart:

| Requester | Allowed receivers (engineers only, minus the current holder) |
|---|---|
| Parth (PM) | Shivam, Sahil, Abbasali, Het, Agastya, Dixit, Yogi, Anurag, Jigar |
| Yogi (engineer, reports to Dhrupin → Parth) | the same list, minus Yogi |
| Paras (PM) | Ridhhi, Harsh, Chirag, Hitesh, Krupesh, Harmitsinh, Ashish, Tejas |
| Harsh (engineer under Paras) | Paras's list, minus Harsh |

- The task page list for Parth shows no one from Paras's team, and no PMs, assistant managers, heads or directors.
- Calling the reassign action as Harsh with Shivam as receiver returns the "own team" error. No handover row is created.
- Auto-assign for a Parth project assigns only people from Parth's list.

---

## Order and done

1. Step 1 → owner checks that edits survive a restart → "go"
2. Step 2 → owner edits step hours and creates a test project → "go"
3. Step 3 → owner checks the four cards as Director, Parth and Paras → "go"
4. Step 4 → owner tries reassigning as Parth, Paras and an engineer from each team

Each step is committed separately with a message describing the change.
