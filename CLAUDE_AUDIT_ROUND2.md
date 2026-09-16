# Engineering OS — Audit Round 2 (for the implementing agent)

Date: 2026-09-16 · Audited commit: `1e3a5af` (branch `main`)

The first audit (now deleted; still in git history at commit `38b7574`) was implemented by the agent, but **its permission foundation was not applied**, and several screens still show actions the owner doesn't want. This file:
1. lists what was missed, with proof
2. records the owner's new decisions
3. gives exact specs and checks that must pass before anything is called done

**This file is now the only audit work order.** Where the current code follows an older decision that conflicts with this file, this file wins.

---

## Ground rules

1. `CLAUDE.md` applies. Explain each change to the owner in plain language and **wait for "go"** before editing code.
2. Never check role names or grades in code (`roleKeys.includes(...)`, `grade === ...`). Use permissions only.
3. Scope is **technical projects only**. Nothing for other modules or non-technical departments.
4. The 1-click persona login is intentional. Don't change it.
5. After each step: `npm run typecheck && npm test && npm run build`. Then run **that step's "Verify" checks**, both the database queries and the persona walkthrough in the browser, and paste the results in your summary to the owner. **A step isn't done until its Verify checks pass.**
6. Run permission and seed changes against a copy of the database first.

---

## Step 1. What round 1 missed (fix first)

Verified on 2026-09-16 in code (`src/core/rbac/permissions.ts`, `prisma/seed.ts`, `src/modules/project-management/services/access.ts`) and in the local database (`core_role_assignments`).

| # | Round 1 decision | Current state (proof) | Effect |
|---|---|---|---|
| M1 | Engineers get no department-wide grants | `seed.ts:886` etc.: `SENIOR_ENGINEER` / `JUNIOR_ENGINEER` at **DEPARTMENT TECH**. The DB has the same for Shivam, Harsh, Agastya… | Shivam sees **and edits** every TECH project's tasks |
| M2 | PMs only have project-scoped PM role | DB: Parth and Paras still hold `PROJECT_MANAGER` at **GLOBAL** | Parth can edit Paras's projects |
| M3 | `SENIOR_ENGINEER` reduced | `permissions.ts`: still has `pm.task.create/update/assign/dependency.manage` | Seniors see Cancel, Reassign and dependency editing |
| M4 | `DEPARTMENT_HEAD` loses project creation | `permissions.ts`: `DEPARTMENT_HEAD` now has `pm.project.read.all`, `pm.project.create`, `pm.template.manage`, `pm.oversight` | HR, Sales, Stores… heads see all projects, create projects, edit checklists and get oversight notifications |
| M5 | Dilip and Rajani become `TECHNICAL_HEAD` | DB: both still `DEPARTMENT_HEAD` | New role unused |
| M6 | Sponsor gives nothing | `access.ts:30, 117`: `sponsorId` still grants visibility | |
| M7 | No role-name checks | `dashboard.service.ts:114`, `dashboard/page.tsx:24`: `roleKeys.includes('TECHNICAL_HEAD')` | |
| M8 | Seed must reconcile existing grants | Seed doesn't remove old assignments | Old wide grants stay in the live DB forever |

These are replaced by the final role design in step 2. Implement step 2; don't patch the round 1 lists.

---

## Step 2. Role visibility ladder (owner decision)

**One app, same screens for everyone.** Moving down the ladder **removes** things. There are no separate views per role.

### 2.1 Ladder

| | Director | Technical Head | PM | Senior engineer | Junior engineer |
|---|---|---|---|---|---|
| Projects visible | All | Technical departments they head | **Only projects they manage** | Projects they or their team work on | Projects they work on |
| Dashboard | All sections | All sections (their departments) | Own projects only; no PM table, no ₹ | Not shown → My work | Not shown → My work |
| Project timeline | ✓ | ✓ | Own projects | Read-only | Read-only |
| Project plan (all steps) | ✓ | ✓ | Own projects | Read-only | Read-only |
| Approvals menu, Approve / Send back / Reopen | ✓ | ✓ | Own projects | ✗ | ✗ |
| Team load | ✓ | ✓ | ✓ (TECH) | ✗ | ✗ |
| Urgent task | ✓ | ✓ | Own projects | ✗ | ✗ |
| Checklists (steps, durations, **dependencies**) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Cancel task | ✓ | ✓ | ✗ | ✗ | ✗ |
| Delete task | ✓ | ✗ | ✗ | ✗ | ✗ |
| Add / remove project members | ✓ | ✓ | Own projects | ✗ | ✗ |
| Update progress, Mark as completed, Report a problem | — | — | — | Own + team's tasks | Own tasks |
| Reassign request (step 4) | ✓ | ✓ | Own projects | Own + team's tasks | Own tasks |
| Accept / decline a reassign addressed to me | ✓ | ✓ | ✓ | ✓ | ✓ |
| People, Roles, Audit trail | ✓ | ✗ | ✗ | ✗ | ✗ |
| New project | ✓ | ✓ | ✗ | ✗ | ✗ |

"Team" = people who report to the senior engineer directly or indirectly (`User.managerId` chain, already computed as `principal.reportIds`).

### 2.2 Final permission lists (`src/core/rbac/permissions.ts`)

Replace `SYSTEM_ROLES` with exactly these. Add new keys where noted.

- **New keys:** `pm.task.cancel` ("Cancel or restore a task"). Remove `pm.task.reassign.own` (replaced by step 4).
- `SUPER_ADMIN`: all permissions (unchanged).
- `DIRECTOR` (GLOBAL): every `pm.*` key, plus `admin.user.read`, `admin.user.manage`, `admin.role.read`, `admin.role.assign`, `admin.audit.read`.
- `TECHNICAL_HEAD` (DEPARTMENT scope): `pm.project.read`, `pm.project.create`, `pm.project.update`, `pm.project.member.manage`, `pm.task.read`, `pm.task.create`, `pm.task.update`, `pm.task.cancel`, `pm.task.assign`, `pm.task.adhoc.create`, `pm.progress.review`, `pm.template.manage`, `pm.oversight`, `pm.handover.request`, `pm.handover.decide`, `pm.resource.read`, `pm.report.read`.
  - **No** `pm.project.read.all` (visibility comes from department scope), **no** `pm.task.delete`, **no** `pm.task.dependency.manage` (dependencies are edited only through checklists, step 6), **no** `admin.*`.
- `DEPARTMENT_HEAD` (non-technical heads): **no `pm.*` permissions at all.** (They keep their account, and nothing in the PM module shows for them.)
- `PROJECT_MANAGER` (**PROJECT scope only**, granted automatically when made manager): `pm.project.read`, `pm.project.update`, `pm.project.member.manage`, `pm.task.read`, `pm.task.create`, `pm.task.update`, `pm.task.assign`, `pm.task.adhoc.create`, `pm.progress.review`, `pm.handover.request`, `pm.handover.decide`, `pm.resource.read`, `pm.report.read`.
  - **No** `pm.task.cancel`, `pm.task.delete`, `pm.task.dependency.manage`, `pm.handover.override`, `pm.progress.log`.
- `PM_BASE` (GLOBAL, eligible PMs): `pm.resource.read`, `pm.report.read`, `pm.handover.decide`.
- `SENIOR_ENGINEER` (GLOBAL): `pm.handover.request`, `pm.handover.decide`.
- `JUNIOR_ENGINEER` (GLOBAL): `pm.handover.request`, `pm.handover.decide`.
- `VIEWER`: unchanged.
- `pm.handover.override`: remove from every role (step 4: everyone needs acceptance).

**`MANAGER_IMPLIED`** in `access.ts` must equal the `PROJECT_MANAGER` list above. Remove `pm.task.delete`, `pm.task.dependency.manage`, `pm.handover.override` from it.

**Relationship rules** (`access.ts`):
- **Holder** (ACTIVE assignment on the task): `pm.task.read`, `pm.progress.log`, `pm.handover.request`.
- **Team lead** (a task holder is in `principal.reportIds`): the same three, for that task only. Keep `isHolderOfTask` behaviour, but **also** use it in `getTaskDetail`'s flags instead of broad `can(...)` checks.
- **Visibility** (`projectVisibilityWhere`, `assertProjectVisible`):
  - Director: `pm.project.read.all`.
  - Technical Head: departments covered by their DEPARTMENT grants.
  - PM: `managerId = me`.
  - Engineers: member of the project, **or** holds a task on it, **or** someone in their `reportIds` holds a task on it.
  - **Remove the `sponsorId` clauses.**

### 2.3 Seed grants and reconciliation (`prisma/seed.ts`)

| Who | Grant |
|---|---|
| All 4 Directors (`ACS-0001`–`ACS-0004`) | `DIRECTOR` GLOBAL (`ACS-0001` also `SUPER_ADMIN`) |
| `ACS-0061` Dilip Asediya | `TECHNICAL_HEAD` DEPARTMENT `TECH` + DEPARTMENT `DESIGN` |
| `ACS-0062` Rajani Nagar | `TECHNICAL_HEAD` DEPARTMENT `TECH` |
| `ACS-0063` Parth, `ACS-0074` Paras, `ACS-0070` Dhrupin, `ACS-0075` Munaf | `PM_BASE` GLOBAL |
| Every senior engineer in TECH / DESIGN | `SENIOR_ENGINEER` GLOBAL |
| Every junior / trainee in TECH / DESIGN | `JUNIOR_ENGINEER` GLOBAL |
| Non-technical heads (HR, Sales, Purchase, Trading, IT, Accounts, Stores, Production, QC) incl. `ACS-0028` Jay Patel if DESIGN head is not technical-head level | `DEPARTMENT_HEAD` DEPARTMENT (no PM rights) |
| `ACS-0011` Vasant, `ACS-0025` Kavin | no PM role |
| Non-technical engineers | no PM role (remove their `SENIOR_ENGINEER` / `JUNIOR_ENGINEER` department grants) |

**Reconciliation (mandatory):**
- For every seeded user, delete role assignments that are **not** in the seed list, **except** PROJECT-scoped `PROJECT_MANAGER` grants.
- Also delete any PROJECT-scoped `PROJECT_MANAGER` grant whose project's `managerId` isn't that user.
- Re-sync `core_role_permissions` from `SYSTEM_ROLES` (delete + insert per role).
- Seeding runs on startup (commit `7963e80`), so this must be idempotent.

### 2.4 Screens driven by the ladder

- **Sidebar** (`src/components/shell/sidebar.tsx`):
  - *Approvals* requires `pm.progress.review` anywhere, or managing a project (`Project.managerId = me`). **Remove the `memberProjectIds.length > 0` fallback.**
  - *Dashboard* requires `pm.report.read`.
  - *Team load* requires `pm.resource.read`.
  - *Urgent task* requires `pm.task.adhoc.create` anywhere, or managing a project.
  - *Checklists* requires `pm.template.manage`.
  - *People / Roles / Audit* require their `admin.*` permission.
- **Dashboard:** **one dashboard page** (merge the PM and Director dashboards). Show each section only when allowed:
  - PM table and ₹ need `pm.oversight`.
  - Team capacity needs `pm.resource.read`.
  - Data comes from `projectVisibilityWhere`.
  - Users without `pm.report.read` are redirected to My work.
- Remove `roleKeys.includes(...)` in `dashboard.service.ts` and `dashboard/page.tsx` (M7).

### Verify (step 2)

Database (paste output):
```sql
SELECT u."fullName", r.key, ra."scopeType", coalesce(d.code, p.code, '') scope
FROM core_role_assignments ra
JOIN core_users u ON u.id = ra."userId" JOIN core_roles r ON r.id = ra."roleId"
LEFT JOIN core_departments d ON d.id = ra."scopeId" LEFT JOIN pm_projects p ON p.id = ra."scopeId"
WHERE u.email IN ('admin@acsengitech.com','dilipkumar.asediya@acsengitech.com','rajani.nagar@acsengitech.com',
  'parth.nagar@acsengitech.com','paras.prajapati@acsengitech.com','shivam.prajapati@acsengitech.com',
  'dharmesh.thummar@acsengitech.com','vasant.patel@acsengitech.com')
ORDER BY 1, 2;
```
Expected:
- no `SENIOR_ENGINEER` / `JUNIOR_ENGINEER` at DEPARTMENT scope
- no `PROJECT_MANAGER` at GLOBAL scope
- Dilip and Rajani are `TECHNICAL_HEAD`
- Dharmesh (Sales head) is `DEPARTMENT_HEAD`, with a role that has no `pm.*` permissions
- Vasant has no PM role

Browser, as each persona:
- **Shivam:**
  - Projects lists only projects he or his reports work on.
  - Opening another project's task URL shows "not found".
  - No Approvals, Team load, Urgent task, Checklists or Dashboard in the sidebar.
- **Parth:**
  - Projects shows only his own.
  - Opening a Paras project URL shows "not found".
  - Approvals is visible.
  - No Checklists and no Cancel.
- **Dilip:** New project, Checklists and Approvals are visible; People / Roles / Audit are not.
- **Satish:** everything is visible.
- **Sales head:** no PM menu items, and no project is visible.

---

## Step 3. Task page and task actions

Files: `src/modules/project-management/services/task.service.ts` (`getTaskDetail`, `changeTaskStatus`), `src/app/(shell)/pm/tasks/[id]/*`.

1. **Permission flags in `getTaskDetail`.** Compute from step 2 only:
   - `canStart` / `canMarkCompleted` / `canLogProgress` / `canReportProblem` = holder or team lead (task open, no blockers for Start).
   - `canReview` / `canReopen` = `pm.progress.review` on the project (PM of the project, Technical Head, Director).
   - `canCancel` = `pm.task.cancel` (Technical Head, Director).
   - `canDelete` = `pm.task.delete` (Director).
   - `canRequestReassign` = holder, team lead, PM of the project, Technical Head, Director.
   - `canManageDependencies` = **always false on the task page** (step 6).
   - Server actions must enforce the same rules; hiding a button is not enough.
2. **Engineer's button** is **"Mark as completed"**. It moves IN_PROGRESS → IN_REVIEW, displayed everywhere as **"Waiting for approval"**. PM / Technical Head / Director see **Approve** and **Send back** (feedback required). Only an approval sets COMPLETED and `completedAt` / `completedById`.
3. **Cancel task:** Technical Head and Director only.
4. **Remove "Log for a different day?"** from `progress-form.tsx`. Progress is always logged for today; drop `loggedFor` from the form (the server sets today).
5. **Remove the "Who is on this" card** for engineers (holders and team leads without `pm.progress.review`). Show the current owner as one line under the title instead: "Assigned to Shivam Prajapati".
6. **Dependencies panel:** read-only for everyone. Show "Waiting on: <step>" and "Next step: <step>". No add or remove controls anywhere on the task page (see step 6).
7. **Status pill vs. blocked banner:** a task with unmet dependencies must show **Blocked** in the pill. Today *Simulation Trial* shows `TODO` with a "Blocked" banner. Fix at the source:
   - `recomputeTaskDerivedState` must run after every approval, reopen and dependency change, and set TODO ↔ BLOCKED correctly.
   - The pill on the page is derived from the same `blockers` list the banner uses.

### Verify (step 3)
- As a junior holding a task: Start → Update progress (no date option) → **Mark as completed** → status "Waiting for approval". No Cancel, Reassign-now, Delete or dependency controls. No "Who is on this" card.
- As Shivam on his report's task: the same actions work.
- As Parth on his project: Approve and Send back work. There's no Cancel button, and calling the cancel action returns 403.
- As Dilip: Cancel works.
- A step whose predecessor isn't approved shows a **Blocked** pill and banner, never TODO + banner.

---

## Step 4. Reassign = request → accept, for everyone (owner decision)

Replaces the separate instant **Reassign** and merges it with **Handover**. There's one flow. Project handover (PM → PM) stays as it is.

1. **Who can request:** see ladder 2.1 (holder, team lead, PM of the project, Technical Head, Director). Juniors can request for their own tasks.
2. **Who can receive (the list):** active users holding `SENIOR_ENGINEER` or `JUNIOR_ENGINEER` (engineering team only).
   - **Exclude** PMs (`PM_BASE`), Technical Heads, Directors, anyone else, and the task's current holders.
   - Query by role assignment, never by designation or name.
   - Order by current load (lowest first), showing "free N days".
3. **On request:** nothing moves yet.
   - Create a `TaskHandover` row with status `PENDING`, `fromUserId` = current OWNER of the task (not the requester, if the requester isn't the holder), `requestedById` = requester (add the column).
   - The **requester** sees on the task page and in *Requests*: **"Reassign request pending – waiting for <receiver>"**, with *Withdraw*.
   - The **receiver** gets an in-app notification (action required) with **Accept** / **Decline**.
   - Only one pending request per task.
4. **On accept:** status **Accepted**.
   - Release every ACTIVE OWNER assignment on the task (`HANDED_OVER`).
   - Create the receiver's ACTIVE OWNER assignment and add them as a project member.
   - Notify requester, previous owner, PM and upper management (`pm.oversight`).
   - The task page history shows "Accepted by <receiver> on <date>".
5. **On decline:** status **Declined**, with an optional reason. Notify the requester. The task stays with the current owner.
6. **Nobody accepts on someone else's behalf.** Remove `pm.handover.override` and its code paths in `decideHandover` and `requestHandover`.
7. **Direct assignment stays only in two places:**
   - project creation (wizard)
   - assigning a task that currently has **no owner** (PM / Technical Head / Director, instant)
   
   Every other change of owner goes through this request flow. Remove the instant "Reassign" form from `task-controls.tsx` and the instant path of `assignTaskAction` for owned tasks.
8. **Names:**
   - Sidebar item *Handovers* → **Requests**.
   - Button **Request reassign**.
   - Statuses **Pending / Accepted / Declined / Withdrawn**.
   - Use these names everywhere: nav, page titles, buttons, notifications and breadcrumbs.

### Verify (step 4)
- As Parth: request reassign of a step from Shivam to Sahil. The list contains only engineers; there's no Paras, Dilip, Rajani or Director. The task stays with Shivam and shows "Reassign request pending – waiting for Sahil".
- As Sahil: a notification arrives. Accept, and the task shows Sahil as owner, the request shows **Accepted**, and Parth and Shivam are notified.
- Decline and withdraw paths work, and a second request while one is pending is refused.
- As a junior: they can request reassign of their own task, and can't for a task they don't hold.

---

## Step 5. Durations and panel quantity (owner decisions)

1. **Default step duration = 1 day.**
   - `schema.prisma` `ChecklistTemplateItem.defaultDurationDays @default(1)` (migration).
   - `template.service.ts` `addTemplateItem` default 1.
   - `prisma/seed-automation-templates.ts`: every item `days: 1`.
   - A migration sets all existing template items to 1.
   - Directors / Technical Heads can still change a step's duration in Checklists.
2. **Day counting is inclusive and uses working days** (Sundays excluded). A 1-day step starts and ends on the same day. The next step starts on the next working day. So 13 one-day steps take exactly 13 working days.
   - Fix `addWorkingDays` usage in `automation-project.service.ts:315` and the wizard (`automation-project-wizard.tsx:353–368`): end = start + (days − 1) working days.
   - Today a 2-day step shows "1–3 Oct", which is 3 days.
3. **Quantity multiplies duration; it doesn't duplicate steps.**
   - 2 PLC panels = **one set of 13 steps**, each lasting `defaultDurationDays × 2` working days (26 working days minimum).
   - The phase is titled "PLC × 2".
   - Remove the per-unit loop (`for (let u = 1; u <= scope.quantity; u++)`, `unitIndex`, per-unit drafts) from `createAutomationProject`, `autoAssignAutomationTeam`, the wizard and `AutoAssignTeamInput`.
   - Supersedes the earlier per-unit draft matching and the "one lane per unit" timeline rule.
4. **Several packages** (e.g. PLC × 2 + HMI × 1): each package's 13 steps run sequentially inside the package. Packages run **in parallel**, all starting on the project start date, one timeline lane per package.
5. **Target date:**
   - The wizard computes the minimum finish = start + the longest package duration (working days), and pre-fills the target date with it.
   - If the user picks an earlier target, show "Needs at least N working days (finishes <date>)" and block creation.
6. Existing projects are not rescheduled automatically.

### Verify (step 5)
- New project: PLC × 1 from Mon 5 Oct → 13 steps, step 1 on 5 Oct, step 13 on 19 Oct (13 working days, Sunday skipped). The target date is pre-filled to 19 Oct.
- New project: PLC × 2 → 13 steps (not 26), each 2 working days, finishing on the 26th working day.
- PLC × 2 + HMI × 1 → two lanes starting the same day.
- A unit test in `src/core/utils/dates.test.ts` covers the inclusive working-day end, and one in the automation service helper covers the quantity multiplier.

---

## Step 6. Dependencies only in Checklists (owner decision)

1. Dependencies are defined **only** on checklist template steps (`dependsOnStep`), editable only with `pm.template.manage` (Director, Technical Head) in `/pm/templates`.
2. Remove add and remove dependency controls from the task page and the project page.
   - Remove `addDependencyAction` / `removeDependencyAction` from the UI.
   - The services and REST routes (`/api/pm/dependencies`) require `pm.template.manage`; nobody else may call them. Better still, delete the task-level add and remove routes if nothing else uses them.
3. Projects created from a template get their task dependencies from the template at creation time (already done in `createAutomationProject`). Editing a template does **not** change existing projects.

### Verify (step 6)
- As Parth, Shivam or a junior: no dependency controls anywhere. `POST /api/pm/dependencies` returns 403.
- As Dilip in Checklists: set step 5 depends on step 4, then create a project, and the dependency exists on the new project's steps.

---

## Step 7. Project timeline (owner decisions)

File: `src/components/project-timeline.tsx`, plus the timeline service in `project.service.ts` / `dashboard.service.ts`.

1. **Show all steps, not only completed ones.** Remove `.filter((step) => step.status === 'COMPLETED')` (line ~159).
2. **Marker per step, by state:**
   | State | Look | Position |
   |---|---|---|
   | Approved (COMPLETED) | **filled green** (`success`) | `completedAt` |
   | Late (not approved and `plannedEnd` < today) | red outline (`error`) | `plannedEnd` |
   | Waiting for approval (IN_REVIEW, not late) | green outline | `plannedEnd` |
   | To do / in progress / blocked (not late) | neutral hollow | `plannedEnd` |
3. **Completed means approved by a PM or higher.** Position approved steps by `completedAt` **only**. Remove the fallback `step.completedAt ?? step.submittedAt ?? step.plannedEnd` (line ~161): a COMPLETED step without `completedAt` is a data error, so log it and use `plannedEnd`.
4. **One lane per package** (step 5), with each lane holding its 13 steps.
5. **Axis:**
   - For projects up to 60 working days, draw a tick for **every working day**, so 13 one-day steps show as 13 evenly spaced dots, one per day.
   - Longer projects get weekly ticks.
   - Keep the Today line, and mark Forecast finish in red when late.
6. **Legend:** Approved · Waiting for approval · Late · To do · Today.
7. **Popup:** step title, planned dates, submitted date, approved date and approver (or "Not approved yet"), and on time / N days late.
8. **Pill colours** (`src/components/ui.tsx` status map):
   - **Completed** = `success` (green).
   - **To do** = neutral (`surface-strong` / `ink`). **Not green**, because green now means approved.
   - **Blocked** / **Late** = `error`.
   - Waiting for approval and In progress keep their existing stage pastels.
   - Update `docs/design-system.md` to record this owner decision.
9. **CRITICAL badge:** in a straight 13-step chain every step is critical, so the badge is noise. Show it only when a lane has at least one non-critical open step.

### Verify (step 7)
- A project with 3 approved, 1 waiting, 2 late and 7 to-do steps shows **13 markers**: 3 filled green at their approval dates, 1 green outline, 2 red outlines, 7 neutral.
- A 13-working-day project shows 13 day ticks.
- As Shivam (read-only), the same timeline appears with no edit actions.
- The task list no longer shows CRITICAL on every row.

---

## Step 8. Final walkthrough (paste results)

Log in as each persona and confirm every row of ladder 2.1:

| Persona | Account |
|---|---|
| Director | Satish Nagar (`admin@acsengitech.com`) |
| Technical Head | Dilip Asediya |
| PM | Parth Nagar |
| Senior | Shivam Prajapati |
| Junior | Sahil Patil (log in with a password or add him to the persona list temporarily; don't commit that) |
| Non-technical head | Dharmesh Thummar |

For each row, write ✓ or ✗ with a one-line note. Any ✗ means the step isn't done.

Then run: `grep -rnE "roleKeys.includes|grade === '|designation: \{ contains|sponsorId === principal|pm\.handover\.override|reassign\.own" src`. Expect no matches, except the `designation` display fields in `select` clauses.

---

## Order of work

1. Step 2 (ladder, permissions, seed reconciliation). **Must be first.**
2. Step 3 (task page and actions)
3. Step 4 (reassign request flow)
4. Step 5 (durations and quantity)
5. Step 6 (dependencies only in Checklists)
6. Step 7 (timeline)
7. Step 8 (final walkthrough)

After each step, summarize for the owner in plain language, include the Verify results, and wait for "go".
