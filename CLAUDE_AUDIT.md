# Engineering OS — Code Audit (for the implementing agent)

Audit date: 2026-09-16 · Commit audited: `785beeb` (branch `main`)
Baseline: `npm run typecheck` passes, `npm test` passes (55 tests), `npm audit --omit=dev` reports 3 high (Prisma CLI `deepmerge-ts`, build-time only).

This file is a work order. Each item has: **Where**, **Problem**, **Fix**, **Done when**. Work top to bottom.
Line numbers refer to commit `785beeb` and may drift — search for the quoted code if they don't match.

---

## Ground rules (read before changing anything)

1. **Project rules in `CLAUDE.md` apply.** In particular:
   - Explain each change in plain language to the user and wait for their "go" before editing code.
   - Routes/server actions call services; services never trust callers — every service call starts with a permission assert.
   - **Never branch on a role name or grade** (`'DIRECTOR'`, `'HEAD'`, `roleKeys.includes(...)`). Use permissions via `can` / `assertCan` / `assertProjectPermission` / `assertTaskPermission` from `src/modules/project-management/services/access.ts` and `src/core/rbac`.
   - UI follows `docs/design-system.md`: no raw hex, no stock Tailwind palette classes, no shadows, no bold display type.
2. **Out of scope — do NOT change:** the 1-click persona login (`quickSwitchPersona`, `QuickLoginButtons`, `PersonaSwitcher`, `test-personas.ts`). The owner says it is intentional. See item A-0 for the one note about it.
3. Keep diffs minimal. Fix root causes in the shared function, not in each caller.
4. After each group: `npm run typecheck && npm test && npm run build` must pass.
5. For every bug fix in a domain engine or service with branching logic, add one small Vitest test that fails without the fix where practical.

---

## 0. TARGET WORKFLOW — the foundation (do this first)

The owner confirmed the intended workflow on 2026-09-16. **Everything else in this file builds on it.** Today the permission *grants* in `prisma/seed.ts` are far wider than this design (PMs hold `PROJECT_MANAGER` at GLOBAL scope; engineers hold their roles at DEPARTMENT scope), and several screens hide that with grade/role-name checks. Fix the grants and the rules below, and many A-items shrink.

### 0.1 Owner decisions (source of truth)

| Topic | Decision |
|---|---|
| Project Managers | Control **only the projects they manage**. They **cannot see** other PMs' projects, not even read-only. Their company-wide `PROJECT_MANAGER` grant is removed. |
| Senior engineers | Act **only on tasks assigned to them and to their team**. "Team" = people who report to them directly or indirectly (`User.managerId` chain). |
| Senior engineers — reassigning | May reassign **their own tasks** to **anyone, from any team**. They may **not** reassign tasks held by other people (team members' tasks go through handover or the PM). |
| Engineers viewing a project | On projects they work on, they see the **whole plan read-only**: all tasks and who holds them. They can change only what the task rules allow. |
| Rajani Nagar (Head of Service) | **Same rights as Dilip** (create projects + edit checklists). |
| Vasant (Sales), Kavin (Stores) | **Lose** their PM roles. |
| Urgent (ad-hoc) tasks | PM (own projects), Heads, Directors. **Not** senior engineers. |
| Planning a project (add/remove members, add tasks, change task dates or hours) | PM (own projects), Heads, Directors only. |
| Project sponsor | **Just a label.** No rights, no special visibility, no special notifications. |
| Team load for PMs | A PM sees **everyone in the TECH department** (not DESIGN), plus anyone on their own projects. |
| Directors | All four Directors (`ACS-0001`–`ACS-0004`) have the same full rights. |
| Upper management | **Every Director and every Technical Head (Dilip, Rajani) is kept in the loop on the whole app.** See 0.7. |
| Review gate | A task that reaches 100% (or is submitted) goes to **IN_REVIEW**. Only the project's **PM**, a **Head** covering the project's department, or a **Director** may approve (→ COMPLETED) or send back (→ IN_PROGRESS). |
| Juniors | May press **Start** and **Submit for review** on **their own** tasks. ("Mark complete" for engineers becomes "Submit for review".) |
| Creating projects & editing checklist templates | **Director + Head of Technical only.** Other department heads (HR, Sales, Stores, Accounts, QC, Purchase, Production, IT) may not. |

### 0.1a Out of scope for now (owner decision)

Do **not** build these yet: leave entry/approval screens, change/reset password, editing employee manager/department, a cancel / on-hold project flow. (Team load keeps using leave rows already in the database. The senior "team" rule reads `User.managerId` as seeded.)

**Scope: technical projects only (owner, 2026-09-16).** The app currently serves the Technical department's automation projects only. Everything else is skipped:
- Other modules (HRMS, ERP, Production, Gate, QMS, Maintenance) get no work. Remove their "SOON" links from the sidebar and remove `/modules`, but keep the routes' placeholder pages.
- Other departments (HR, Sales, Purchase, Stores, Accounts, QC, Production, IT, Admin) get no PM features, dashboards or notifications. Their heads keep only what 0.3 leaves them. No UI work for them.
- Where this file mentions non-technical departments, treat it only as "make sure they have no access", nothing more.

### 0.2 Target lifecycle

```
PROJECT
  Director / Head of Technical creates project (wizard)
    → status PLANNING; PM gets PROJECT-scoped PROJECT_MANAGER grant (already implemented)
  First task started                → project auto-moves PLANNING → IN_PROGRESS
  All leaf tasks COMPLETED/CANCELLED → "Complete project" enabled (PM / Head / Director)
    → COMPLETED (server refuses if any leaf task is still open)
  Project handover PM → PM          → receiver accepts (existing flow; see B-3)

TASK
  TODO ──(dependencies open)──► BLOCKED   (automatic, recompute)
  TODO/BLOCKED(unblocked) ──Start──► IN_PROGRESS            holder, their senior, PM
  IN_PROGRESS ──Submit for review / log 100%──► IN_REVIEW   holder, their senior, PM
  IN_REVIEW ──Approve──► COMPLETED                          PM / Head / Director only
  IN_REVIEW ──Send back (feedback required)──► IN_PROGRESS  PM / Head / Director only
  COMPLETED ──Reopen──► IN_PROGRESS                         PM / Head / Director only
  any open ──Cancel──► CANCELLED ; CANCELLED ──Restore──► TODO   PM / Head / Director only
  Roadblock (any open status)       → BLOCKED with reason   holder, their senior, PM
  Handover (peer consent)           → holder or their senior requests; receiver accepts
  Reassign (top-down, no consent)   → PM / Head / Director; senior only within their team
```

Remove the direct shortcuts `TODO→COMPLETED`, `IN_PROGRESS→COMPLETED`, `TODO→IN_REVIEW` from `ALLOWED_TRANSITIONS` (`src/modules/project-management/services/task.service.ts:21`).

### 0.3 Target role → permission design

Permissions are still checked only through `can` / `assertProjectPermission` / `assertTaskPermission`. Changes:

1. **New permission keys** in `src/core/rbac/permissions.ts`:
   - `pm.template.manage` — Edit master checklist templates. (`SUPER_ADMIN`, `DIRECTOR`, `TECHNICAL_HEAD`)
   - `pm.oversight` — Kept informed about all project activity in scope. (`SUPER_ADMIN`, `DIRECTOR`, `TECHNICAL_HEAD`; see 0.7)
   - `pm.task.reassign.own` — Reassign a task you hold to someone else. (`SENIOR_ENGINEER`; see 0.4 item 2a)
   - Remove `pm.task.adhoc.create` from any engineer role. It stays with `DIRECTOR`, `TECHNICAL_HEAD`, `DEPARTMENT_HEAD`, and `PROJECT_MANAGER` (project-scoped).
2. **Role blueprints** (`SYSTEM_ROLES`):
   - `DIRECTOR`: add `pm.template.manage`.
   - **New** `TECHNICAL_HEAD`: everything `DEPARTMENT_HEAD` has **plus** `pm.project.create`, `pm.template.manage`.
   - `DEPARTMENT_HEAD`: **remove** `pm.project.create`. (Keeps department-scoped oversight but cannot create projects or edit templates.)
   - `PROJECT_MANAGER`: unchanged permission list, but **only ever granted at PROJECT scope** (the create-project and project-handover flows already do this).
   - **New** `PM_BASE` (granted GLOBAL to people eligible to manage projects): `pm.resource.read`, `pm.report.read`, `pm.handover.decide`. No project/task mutation rights. Also used to build the "eligible PM" dropdown in the wizard (replaces the name/grade matching in `getPMTeamData`, see D-4).
   - `SENIOR_ENGINEER` and `JUNIOR_ENGINEER`: reduce to `pm.handover.decide` only, granted GLOBAL. All task rights come from the relationship rules in 0.4. (Do **not** keep them at DEPARTMENT scope — a DEPARTMENT grant makes every task in TECH editable and every TECH project visible.)
   - `pm.progress.review`: held by `DIRECTOR` (GLOBAL), `TECHNICAL_HEAD`/`DEPARTMENT_HEAD` (DEPARTMENT), and implied for the project's manager (`MANAGER_IMPLIED` already contains it). **Not** held by engineers.
3. **Seed grants** (`prisma/seed.ts`, user list ~line 145–1100):
   - `ACS-0061` Dilip Asediya → `TECHNICAL_HEAD` at DEPARTMENT `TECH` and DEPARTMENT `DESIGN` (replaces his two `DEPARTMENT_HEAD` grants).
   - `ACS-0063` Parth, `ACS-0074` Paras, `ACS-0070` Dhrupin, `ACS-0075` Munaf → `PM_BASE` GLOBAL (replaces `PROJECT_MANAGER` GLOBAL).
   - `ACS-0011` Vasant Patel (Sales) and `ACS-0025` Kavin Patel (Stores): **remove** their `PROJECT_MANAGER` DEPARTMENT grants (owner confirmed). Give them the same base role as their department peers.
   - Every `SENIOR_ENGINEER` / `JUNIOR_ENGINEER` DEPARTMENT grant → same role at GLOBAL scope (with the reduced permission list above).
   - Other heads keep `DEPARTMENT_HEAD` (now without `pm.project.create`).
   - `ACS-0062` Rajani Nagar (Head of Service, TECH) → `TECHNICAL_HEAD` at DEPARTMENT `TECH` (owner confirmed: same rights as Dilip).
   - The live database already contains the old grants. Make the seed **reconcile** role assignments for seeded users (delete assignments not in the seed list for that user, except PROJECT-scoped ones) and re-sync role permissions, so running `npm run db:seed` on an existing DB applies the new model. Do not delete PROJECT-scoped `PROJECT_MANAGER` grants created by the app.

### 0.4 Relationship rules (code, in `src/modules/project-management/services/access.ts`)

1. **Holder rule** (`HOLDER_IMPLIED`, line ~215): keep `pm.task.read`, `pm.progress.log`, `pm.handover.request`. Holder = ACTIVE assignment on the task.
2. **Team-lead rule (new)**: if any ACTIVE assignee of the task is in the principal's report subtree (`User.managerId` descendants — load once per request, same BFS as `expandDepartmentSubtrees`), the principal gets `pm.task.read`, `pm.progress.log`, `pm.handover.request`. **No** `pm.task.assign` on team members' tasks. Add `reportIds: string[]` to `Principal` (`src/core/rbac/types.ts`) computed in `loadPrincipal`.
2a. **Reassign own work (new, owner confirmed)**: a holder with the `SENIOR_ENGINEER` role may reassign a task **they currently hold** to **any active employee** in the company. Implement as a permission rather than a role check: add `pm.task.reassign.own` ("Reassign a task you hold to someone else") to `PERMISSIONS`, grant it to `SENIOR_ENGINEER`, and in `assignTask` allow the call when `can(principal, 'pm.task.reassign.own')` **and** the principal holds an ACTIVE OWNER assignment on the task (otherwise require `pm.task.assign` via `assertTaskPermission`). The previous owner (the senior) is released as today; audit `onBehalf: false, selfReassign: true`. Juniors do not get this; they use handover.
3. **Manager rule** (`MANAGER_IMPLIED`): unchanged; confirm it contains `pm.progress.review`.
4. **Visibility** (`projectVisibilityWhere`, `assertProjectVisible`): unchanged logic; with the new grants it yields: Director → all; Heads → their department subtree; PMs → **only** projects they manage/sponsor/are members of (never other PMs' projects); engineers → projects they are members of or hold a task on, shown as the **whole plan read-only**; seniors additionally → projects where someone in their team holds a task (add that clause). "Read-only" means `getProjectWorkspace` returns all tasks, and every `permissions.can*` flag is false unless the task-level rules grant it.
5. **Status transitions** — in `changeTaskStatus` replace the single `pm.task.update` assert with a per-transition permission:

   | Transition | Permission (via `assertTaskPermission`) |
   |---|---|
   | `TODO/BLOCKED → IN_PROGRESS`, `IN_PROGRESS → IN_REVIEW` | `pm.progress.log` (holder / team-lead implied) |
   | `IN_REVIEW → COMPLETED`, `IN_REVIEW → IN_PROGRESS`, `COMPLETED → IN_PROGRESS` | `pm.progress.review` |
   | `→ CANCELLED`, `CANCELLED → TODO`, `DRAFT → TODO` | `pm.task.update` |

   Then `approveTaskReview` / `disapproveTaskReview` become thin wrappers (feedback required on send-back) and their grade checks are deleted (supersedes A-2 for these two).
6. **Progress logging** (`logProgress`): when `percentComplete === 100` and status is `IN_PROGRESS`, set status `IN_REVIEW` and notify the PM (the notification already exists). Enforce server-side: percent cannot decrease; no logging on tasks that have children (both are documented in `docs/project-management.md` but not enforced).
7. **Project auto-status**: in `changeTaskStatus` / `logProgress`, when a task moves to IN_PROGRESS and the project is `PLANNING`, set project `IN_PROGRESS` (audit + event). In `completeAutomationProject` and `updateProject(status: 'COMPLETED')`, refuse with `DomainError` while any leaf task is not COMPLETED/CANCELLED.
8. **Project list**: `listProjects` uses `projectVisibilityWhere` (A-3). Engineers then see the projects they work on instead of "0 projects".

### 0.5 Screens that must follow the new rules

- `task-controls.tsx` `NEXT_STATUS`: engineers see **Start** (TODO), **Submit for review** (IN_PROGRESS); reviewers see **Approve** / **Send back** (IN_REVIEW, send back asks for feedback) and **Reopen** (COMPLETED). Buttons render from server-computed `permissions` in `getTaskDetail` (add `canStart`, `canSubmit`, `canReview`, `canCancel`) — never show a button the server will reject.
- New **Approvals** page `/pm/approvals`: list of IN_REVIEW tasks the viewer may review (PM: own projects; Head: department; Director: all), each with Approve / Send back. Sidebar item with a count badge, visible when the user holds `pm.progress.review` anywhere **or** manages any project. The dashboard "Awaiting approval" tile links here.
- Templates page and "Checklists" nav: `pm.template.manage`. New-project page, "New project" buttons: `pm.project.create`.
- Handover form on task page: show for holder and team lead (remove the `!permissions.canAssign` condition at `src/app/(shell)/pm/tasks/[id]/page.tsx:283`).
- "Raise ad-hoc task" button (`projects/[id]/page.tsx:74`) must use `pm.task.adhoc.create` (currently `canCreateTask`, so seniors see a button that redirects them away).

### 0.6a Sponsor becomes a label, and PM team load (owner decisions)

- Remove every sponsor-based right:
  - `completeAutomationProject` (`isSponsor`)
  - the `sponsorId` clauses in `projectVisibilityWhere` / `assertProjectVisible` (`access.ts`)
  - handover oversight lists in `listHandovers` (`project: { sponsorId }`, `sponsorId` in the task oversight clause)
  - sponsor notifications in `flagRoadblock` and `logProgress`; these are replaced by 0.7
  
  Keep showing the sponsor's name on the project page.
- `getWorkloads` / `visibilityFilter` (`availability.service.ts:172`): a principal without `pm.project.read.all` sees active users in the **TECH** department (by department, not only their own `departmentId`), plus members of projects they manage. Remove the hardcoded `['TECH','DESIGN']` filter for this path (D-4 constant). Directors and Heads keep their current reach.

### 0.7 Upper management in the loop (owner decision)

"Upper management" = everyone holding the new permission **`pm.oversight`** ("Kept informed about all project activity"). Grant it to `DIRECTOR` (GLOBAL) and `TECHNICAL_HEAD` (DEPARTMENT). Never select recipients by grade, designation or name. Remove the current `grade: { in: ['DIRECTOR','HEAD'] }` / `designation contains 'Director'` recipient queries in `changeTaskStatus` (`task.service.ts:244–256`) and `completeAutomationProject` (`project.service.ts:672–683`).

1. Add a helper `oversightRecipients(tx, companyId, departmentId)` in `src/core/notifications/` (or in `access.ts`). It returns active users with a `pm.oversight` grant that covers the project: GLOBAL, or a DEPARTMENT grant whose subtree contains `departmentId`. Resolve through `roleAssignments → role.permissions`.
2. Notify upper management (excluding the actor) on these events, alongside the existing recipients:

   | Event | Existing recipients | + Upper management |
   |---|---|---|
   | Project created | PM | yes |
   | Task submitted for review (IN_REVIEW) | PM | yes |
   | Task approved (COMPLETED) | holder(s) | yes |
   | Task sent back | holder(s) | yes |
   | Problem / roadblock reported | PM | yes |
   | Task or project handover requested / accepted / declined | receiver, requester, PM | yes |
   | Reassignment (top-down or senior self-reassign) | new holder | yes |
   | Project status change (started, completed) | PM | yes |
   | Urgent (ad-hoc) task created | assignee | yes |

3. **Avoid notification overload** (this will be a lot of messages): on the notifications page and in the bell, group oversight notifications by project, e.g. "Monk Media One PLC – 6 updates today", and add a filter *Needs my action / Just for information*. Add a boolean `isOversight` to `core_notifications` (migration) so these can be filtered and grouped. Action-required notifications (approvals, handovers addressed to you) are never grouped away.
4. Upper management's **Dashboard** (UX-3) already shows everything in their scope. Make sure its "Needs attention" list includes the same event types for Directors (all projects) and Technical Heads (their departments).
5. Nobody else gets oversight notifications: other department heads, PMs on projects they don't manage, and sponsors (0.6a).

### 0.6 Done when (write these as tests where possible)

- Parth cannot open, list, update, assign or delete anything on a project managed by Paras (API and server action return 404).
- Shivam can start/submit/log on his own tasks and his reports' tasks; gets 403 on a TECH task held by someone outside his team; cannot approve reviews.
- Shivam can reassign a task he holds to an engineer on another PM's team; he cannot reassign a task held by one of his reports.
- An engineer on a project sees all its tasks, with no edit controls on tasks they don't hold.
- Rajani and Dilip can create projects and edit checklists; Vasant and Kavin have no PM grants.
- A senior engineer cannot open `/pm/adhoc` or create an ADHOC task via API.
- A sponsor who is not the PM, a Head or a Director has no extra rights on the project.
- Parth's Team load lists everyone active in TECH (and nobody from DESIGN unless on his projects).
- Submitting, approving and sending back a task notifies the PM or holder **and** all four Directors plus Dilip and Rajani (not the actor). The Sales head receives nothing.
- A junior can Start and Submit for review on their own task; cannot mark COMPLETED.
- Logging 100% moves the task to IN_REVIEW; PM approves → COMPLETED and downstream unblocks.
- HR/Sales/Stores heads cannot open `/pm/projects/new` or `/pm/templates` and cannot call the actions.
- Engineers' Projects page lists the projects they work on.
- `grep -rnE "grade === '(DIRECTOR|HEAD|MANAGER)'|roleKeys.includes" src` returns nothing.

---

## A. Security & authorization

### A-0 (INFO ONLY — no change unless the owner asks) Persona login reachable in production
- **Where:** `src/app/actions/auth.ts:47` `quickSwitchPersona`; `docker-compose.yml` exposes app publicly via Traefik.
- **Note:** The action accepts *any* email (not only `TEST_PERSONAS`) and has no environment gate, so on the public host anyone can sign in as any active user without a password. Owner has marked this intentional. Leave it. If the owner later asks: gate on an env flag (e.g. `ENABLE_PERSONA_LOGIN=true`) and restrict `email` to `TEST_PERSONAS` emails.

### A-1 `flagRoadblock` has no permission check
- **Where:** `src/modules/project-management/services/task.service.ts:731`
- **Problem:** Any signed-in user can set any task in any project/company to `BLOCKED`, write a progress log, notify PM/sponsor and publish `TASK_BLOCKED`.
- **Fix:** First line of the function: `await assertTaskPermission(principal, taskId, 'pm.progress.log');` (holders are allowed via `HOLDER_IMPLIED`; managers via project grants). Also reject closed tasks (`COMPLETED`/`CANCELLED`) with a `DomainError`.
- **Done when:** A user who is neither holder nor has `pm.progress.log` on the project gets `ForbiddenError`; a task from another company returns `NotFoundError`.

### A-2 Role/grade-name authorization (violates CLAUDE.md)
- **Where (all five):**
  - `task.service.ts:638–647` `approveTaskReview`
  - `task.service.ts:691–700` `disapproveTaskReview`
  - `project.service.ts:650–660` `completeAutomationProject`
  - `template.service.ts:6–15` `assertTemplateAdmin`
  - `src/app/(shell)/pm/templates/page.tsx:12–20`
  - (also `listProjects`, see A-3, and `dashboard.service.ts:12–18` `isManagement`)
- **Problem:** Checks `principal.grade === 'DIRECTOR' | 'HEAD'` or `roleKeys.includes(...)`. No project/department scoping and no company check → a Head of any department can approve reviews / complete **any** project.
- **Fix:**
  - `approveTaskReview` / `disapproveTaskReview`: handled by section 0.4 item 5 (`pm.progress.review` via `assertTaskPermission`).
  - `completeAutomationProject`: `await assertProjectPermission(principal, projectId, 'pm.project.update');` plus the "all leaf tasks closed" rule from 0.4 item 7. Keep the sponsor allowance only if the owner wants it — otherwise drop it.
  - Templates: use `pm.template.manage` from section 0.3 (held by `SUPER_ADMIN`, `DIRECTOR`, `TECHNICAL_HEAD` only). `assertTemplateAdmin` → `if (!hasPermissionAnywhere(principal, 'pm.template.manage')) throw new ForbiddenError(...)`. The templates page redirect and the sidebar "Checklists" item (`src/components/shell/sidebar.tsx`, currently `requires: 'pm.project.create'`) use the same permission.
  - Sidebar "Other modules" block (`sidebar.tsx`, `isDirector` check) → `hasPermissionAnywhere(principal, 'admin.module.manage')`, or remove the block (see UX-2).
  - Dashboard header buttons (`src/app/(shell)/dashboard/page.tsx:16–44`, `isDirectorOrHead`) → `pm.project.create` for "New project", `pm.template.manage` for "Checklists".
  - `dashboard.service.ts` `isManagement`: keep only the `can(...)` terms.
- **Done when:** `grep -rnE "grade === '(DIRECTOR|HEAD)'|roleKeys.includes" src` returns nothing outside `src/core/rbac` tests.

### A-3 `listProjects` scoping diverges from `projectVisibilityWhere`
- **Where:** `src/modules/project-management/services/project.service.ts:217–283`
- **Problem:**
  1. Uses grade/role names (see A-2).
  2. Engineers/members see no projects in the list, although `assertProjectVisible` lets them open those projects.
  3. `filters.managerId` replaces the scope entirely — any caller passing it sees every project of that manager regardless of access. (No caller passes it today; it's a latent hole.)
- **Fix:** Replace the whole `isDirector`/`isHead`/`scopeWhere` block with `projectVisibilityWhere(principal)` from `./access`. Apply `managerId` as an *additional* AND filter, never as a replacement.
- **Done when:** List page and `GET /api/pm/projects` show exactly the projects `assertProjectVisible` would allow.

### A-4 Unvalidated server-action payloads (automation wizard)
- **Where:** `src/app/actions/automation-project.ts` (`createAutomationProjectAction`), `src/app/actions/pm.ts:522` (`autoAssignAutomationTeamAction`), `src/app/actions/template.ts` (all three).
- **Problem:** Server actions are public endpoints; these accept raw objects with no schema. `tasks[].assigneeId` is never checked to be an active user in the principal's company. `quantity`, dates, `estimatedHours`, `defaultDurationDays` are unbounded.
- **Fix:** Add zod schemas in `src/modules/project-management/validation/schemas.ts` (`createAutomationProjectSchema`, `autoAssignTeamSchema`, `templateItemSchema`) and `.parse()` in the action (or at the top of the service). Bound arrays (e.g. `tasks.max(500)`, `scopes[].quantity` int 0–20), dates as `YYYY-MM-DD`, hours/durations positive with sane max. In `createAutomationProject`, before the transaction, load `prisma.user.findMany({ where: { id: { in: assigneeIds }, companyId: principal.companyId, status: 'ACTIVE' } })` and throw `DomainError` if any id is missing.
- **Done when:** Posting a foreign/inactive assignee id or a malformed payload returns a clean validation/domain error, not a Prisma error.

### A-5 Task-handover candidate lookups don't check task visibility
- **Where:** `src/modules/project-management/services/availability.service.ts:207` `handoverCandidates`, `:268` `peersForHandover`; reachable via `GET /api/pm/tasks/[id]/handover`.
- **Fix:** First line of each: `await assertTaskVisible(principal, taskId);` (import from `./access`).

### A-6 Rate limiter trusts spoofable header
- **Where:** `src/middleware.ts:33–36`
- **Problem:** Uses the first `x-forwarded-for` value, which the client controls, so the limit is bypassed by rotating the header.
- **Fix (minimal):** Behind Traefik, use the **last** entry of `x-forwarded-for` (the one Traefik appended) or `x-real-ip` set by Traefik. Add a `// ponytail: in-memory per-process limiter; move to Postgres/Redis if running >1 replica` comment. Apply the same IP extraction in `src/app/actions/auth.ts` and `src/app/api/auth/login/route.ts` (extract one helper in `src/core/http/` and reuse).

---

## B. Correctness bugs

### B-1 "Complete project" notifies every employee when there is no sponsor
- **Where:** `project.service.ts:672–683`
- **Problem:** `OR: [{ id: project.sponsorId ?? undefined }, ...]` — in Prisma `{ id: undefined }` is an empty filter and matches **all** users.
- **Fix:** Build the OR list conditionally: `...(project.sponsorId ? [{ id: project.sponsorId }] : [])`. Replace `{ grade: 'HEAD' }` with the role-assignment clause only (A-2 spirit), or a permission-based recipient lookup.
- **Done when:** Completing a sponsor-less project notifies only department heads.

### B-2 Multi-unit automation projects reuse Unit 1's drafts
- **Where:** `automation-project.service.ts:248–253`
- **Problem:** `unitTasks` filter is `t.unitIndex === u || t.unitIndex === 1 || !t.unitIndex`; the wizard pushes unit 1 drafts first, so `unitTasks.find(d => d.stepNumber === ...)` returns Unit 1's draft for every unit → PLC 2 gets PLC 1's assignee and dates.
- **Fix:** `const draft = input.tasks.find(d => d.templateCode === scope.templateCode && (d.unitIndex ?? 1) === u && d.stepNumber === item.stepNumber);`
- **Done when:** Creating a project with PLC quantity 2 and different assignees per unit persists the per-unit assignees. Add a unit test if the matching is extracted to a pure helper.

### B-3 Handover can create two active owners
- **Where:** `src/modules/project-management/services/handover.service.ts`
- **Problems:**
  1. `requestHandover` (line 68–78): when a manager uses override on a task they don't hold, `fromUserId` is the manager. On accept (line 185), only the manager's (non-existent) assignment is released; the real holder keeps an ACTIVE OWNER assignment.
  2. `decideHandover` (line 146–171): the PENDING check is outside the transaction → two concurrent accepts both create assignments.
  3. Line 162–168: `(isReceiver && can(... 'pm.handover.decide'...)) || isReceiver || canOverride` — the permission term is dead code.
- **Fix:**
  1. On request with override and no own assignment, set `fromUserId` to the current OWNER (`task` ACTIVE assignment with role OWNER); if there is no owner, throw `DomainError`.
  2. On accept: release **all** ACTIVE `OWNER` assignments on the task (not just `fromUserId`'s). Make the status flip atomic: inside the transaction use `tx.taskHandover.updateMany({ where: { id: handoverId, status: 'PENDING' }, data: {...} })` and throw `DomainError('This handover has already been decided.')` if `count === 0`. Do the same in `decideProjectHandover` (line 413–422).
  3. Simplify to `const canDecide = isReceiver || canOverride;` (or require `pm.handover.decide` for the receiver if the owner prefers — ask).
- **Done when:** After any accept, the task has exactly one ACTIVE OWNER.

### B-4 "Reassign all tasks" rewrites completed history
- **Where:** `project.service.ts:552–577` `reassignAllMemberTasks`
- **Problem:** Selects all assignments of `fromUserId` in the project, including `COMPLETED` / `HANDED_OVER` / `RELEASED`, and moves them to the new user.
- **Fix:** Filter `status: 'ACTIVE', task: { projectId, status: { notIn: ['COMPLETED', 'CANCELLED'] } }`. Instead of mutating `userId`, mark the old assignment `RELEASED` (`releasedAt: now`) and create a new ACTIVE assignment for `toUserId` (skip if they already hold the same role). Add a per-task audit row like `decideProjectHandover` does. The membership-removal check should count only ACTIVE assignments. Refuse if `fromUserId === project.managerId` (use the project handover flow instead).

### B-5 Deleting a template step breaks dependencies
- **Where:** `template.service.ts:142–176` `deleteTemplateItem`
- **Problem:** Steps are renumbered, but `dependsOnStep` on remaining items is not remapped; items that depended on the deleted step keep a dangling number.
- **Fix:** Build `oldStep → newStep` map during renumbering; update each remaining item's `dependsOnStep` through the map; if it pointed at the deleted step, set it to the deleted item's own `dependsOnStep` (bridge the chain) or `null`. Keep `code` in sync (`${template.code}_STEP_${NN}`) so `addTemplateItem` never generates a duplicate code.

### B-6 `progressFeed` silently ignores `projectId` (and is unused)
- **Where:** `progress.service.ts:150–172`
- **Problem:** Two `task:` keys in one object literal; the second overwrites the first.
- **Fix:** Function has no callers → **delete it** (see D-1). If kept, merge into `task: { projectId, project: { companyId } }` and add a permission check.

### B-7 `createProject` authorizes against one department but writes another
- **Where:** `project.service.ts:26` vs `:62`; same pattern in `automation-project.service.ts:133` vs `:173`
- **Fix:** Resolve `const departmentId = input.departmentId || manager.departmentId || principal.departmentId` **first**, then `assertCan(principal, 'pm.project.create', { departmentId })`, then write that same `departmentId`. (Load the manager before the assert.)

### B-8 `updateProject` side effects
- **Where:** `project.service.ts:146–209`
- **Problems:** (a) `actualEndDate` is reset to "now" every time a completed project is re-saved (the edit form always sends `status`). (b) `managerId`/`departmentId`/`sponsorId` can be changed directly, bypassing the project-handover consent flow and leaving PROJECT-scoped role assignments stale.
- **Fix:** (a) set `actualEndDate` only when status transitions *into* COMPLETED (`statusChanged && input.status === 'COMPLETED'`), clear it when moving out. (b) Remove `managerId`, `sponsorId`, `departmentId` from `updateProjectSchema` and from `updateProjectAction` (`src/app/actions/pm.ts:134`); manager changes go through `requestProjectHandover`. Check the edit UI still compiles and drop the manager field there.

### B-9 Lost updates on hours
- **Where:** `progress.service.ts:29–34, 56–65`
- **Fix:** Drop the `existingLogs` read; use `actualHours: { increment: input.hoursSpent }` in the update; for the audit diff read the returned row's `actualHours`.

### B-10 Status changes that bypass the transition table
- **Where:** `task.service.ts:757–760` (`flagRoadblock`), `progress.service.ts:49–54`, `task.service.ts:438–448` (`recomputeTaskDerivedState`)
- **Problem:** Tasks jump to BLOCKED from any status; when unblocked, recompute sets them to TODO even if work had started (IN_PROGRESS lost).
- **Fix (minimal):** In recompute, when a BLOCKED task is no longer blocked, set `TODO` only if `actualStart` is null, else `IN_PROGRESS` (add `actualStart` to the graph select in `loadProjectGraph`). Do not flag roadblocks on `COMPLETED`/`CANCELLED` tasks (A-1).

### B-11 `changeTaskStatus` race
- **Where:** `task.service.ts:150–155`
- **Fix:** Inside the transaction, use `tx.task.updateMany({ where: { id: taskId, status: task.status }, data })`; if `count === 0` throw `DomainError('The task changed while you were editing. Reload and try again.')`, then re-read the row to return it.

### B-12 Outbox may double-process events
- **Where:** `src/core/events/bus.ts:52–91`
- **Problem:** Every request fires `drainOutbox()` concurrently with no claim/lock. No subscribers exist today, so impact is currently nil.
- **Fix (minimal):** Claim each event before processing: `const claimed = await prisma.domainEvent.updateMany({ where: { id: event.id, status: 'PENDING' }, data: { status: 'PROCESSING' } }); if (claimed.count === 0) continue;` — add `PROCESSING` to the `EventStatus` enum via a migration, and on failure set it back to `PENDING`/`FAILED`. Alternatively, if the owner agrees, skip the drain entirely when `subscribersFor` is empty for all pending names. Mark with a `ponytail:` comment either way.

### B-13 Auto-assign code generation collides
- **Where:** `automation-project.service.ts:137–141`
- **Problem:** `count + 1` duplicates an existing code after any deletion or concurrent create.
- **Fix:** Reuse `nextProjectCode` logic from `project.service.ts:134` (export it) or query the max existing `ACS-PRJ-` sequence. Keep the unique-constraint error mapped to `DomainError`.

---

## C. Performance

### C-1 `recomputeTaskDerivedState` is N+1 and O(n²)
- **Where:** `task.service.ts:431–460`
- **Fix:** (a) Precompute `const parentIds = new Set(graph.tasks.map(t => t.parentId).filter(Boolean))`. (b) Fetch latest blocker per task in one query: `prisma.taskProgressLog.findMany({ where: { task: { projectId } }, orderBy: { createdAt: 'desc' }, distinct: ['taskId'], select: { taskId: true, blocker: true } })` → map. (c) Accept `tx` properly (already does). Behaviour must be identical — run existing tests.

### C-2 Org-chart walk is one query per person
- **Where:** `automation-project.service.ts:51–70` `getDescendantUserIds`, called per manager in `getPMTeamData` (`:96–98`)
- **Fix:** Load `{ id, managerId }` for all active users in the company once, build a children map, BFS in memory (same pattern as `expandDepartmentSubtrees` in `src/core/rbac/principal.ts:89`). Pass `companyId` in.

### C-3 AI call on every auto-assign
- **Where:** `automation-project.service.ts:508–530`, `src/core/ai/vertex.ts`
- **Notes/fix:** Token fetch (`vertex.ts:69`) has no timeout — add an `AbortController` (reuse `timeoutMs`). Fallback retry to `gemini-2.0-flash` restarts the full timeout — pass the remaining budget or skip fallback on abort. Employee names and grades are sent to Google Vertex: **ask the owner** whether that is acceptable; if not, send ids/grades only.

---

## D. Dead code, duplication, hardcoding (delete/simplify)

### D-1 Delete unused code
- `progressFeed` — `progress.service.ts:150` (no callers)
- `handoverProject` — `project.service.ts:713–812` (superseded by `decideProjectHandover`; no callers)
- `getTaskContextForHandover` — `handover.service.ts:669` (no callers)
- `updateTaskSchema`/`updateTask` are used by the REST PATCH — keep.
- `scratch.ts` at repo root — delete.
- Verify with `grep -rn "<name>" src` before each deletion.

### D-2 Remove pointless dynamic imports
- **Where:** `src/app/actions/pm.ts` lines ~418, 442, 459, 476, 494, 512, 525
- **Problem:** `await import('@/modules/.../project.service')` etc. for modules that are already (or can be) statically imported at the top.
- **Fix:** Add the names to the static imports at the top and call directly.

### D-3 Duplicated helpers
- `value(form, key)` in `src/app/actions/pm.ts:69` and `src/app/actions/admin.ts:9` → move to `src/core/utils/form.ts` and import in both.
- `handleSort` duplicated in `src/app/(shell)/dashboard/dashboard-my-work-table.tsx:31`, `src/app/(shell)/pm/my-work/my-work-table.tsx:41`, `src/app/(shell)/dashboard/live-projects-table.tsx:36` → extract a tiny `useSort` hook in `src/components/` (or reuse `DataTable` sorting if it already covers these tables).

### D-4 Hardcoded people and company data in code
- `src/modules/project-management/services/dashboard.service.ts:183–195` — teams defined by first-name lists. **Fix:** derive teams from the org chart (`managerId` descendants of each PM, same as C-2).
- `src/app/(shell)/dashboard/page.tsx:197–240` — card titles "Team 1: Parth Nagar", "Team 2: Paras Prajapati". **Fix:** render from the derived team data (`formatName(manager.fullName)`).
- `automation-project.service.ts:80–81` — PMs found by `fullName contains 'Parth'/'Paras'`. **Fix:** identify PMs by a PROJECT_MANAGER role assignment (any scope) or grade `MANAGER`; drop the name clauses.
- `src/core/utils/strings.ts:3–8` — `'Admin Controller' → 'Satish Nagar'`, `Canteen`/`Kichen Cleaning` stripping, `Kumar` suffix stripping. **Fix:** correct the data (seed / user records) and reduce `formatName` to "first + last word". Ask owner before removing the `Kumar` rule.
- `src/app/login/login-form.tsx:25` placeholder `name@vidyutswitchgear.com` → `name@acsengitech.com` (confirm with owner).
- `src/core/ai/vertex.ts:31` hardcoded `C:\Users\Dhruv-Home\Downloads\Vertex AI Key.json` → remove; rely on `VERTEX_AI_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS`. Route env reads through `src/core/config.ts` (add both as optional) — `config.ts` says reading `process.env` elsewhere is a bug. Add `Vertex AI Key.json` and `vertex-key.json` to `.gitignore` and `.dockerignore`.
- Department codes `['TECH', 'DESIGN']` hardcoded in `availability.service.ts:61, 279` and `automation-project.service.ts:78` → one exported constant (e.g. in `src/modules/project-management/domain/constants.ts`). Ask owner whether it should become config.

### D-5 Error messages leak internals
- **Where:** `run()` / `toState()` in `src/app/actions/pm.ts:56–67`, `src/app/actions/admin.ts:16–24`, and all `catch` blocks returning `error.message` in actions.
- **Fix:** Return `error.message` only for `DomainError | ForbiddenError | NotFoundError | ValidationError | UnauthorizedError | ZodError`; otherwise `console.error` it and return `'Something went wrong.'`. Share one helper for all action files.

---

## E. Design-system violations (`docs/design-system.md`)

Replace with design tokens (`canvas`, `surface-*`, `ink`, `body`, `muted`, `hairline`, `error`, `success`, `stage-*`, `primary` only for the one CTA). Remove every `shadow*`.

| File | Issues |
|---|---|
| `src/app/(shell)/pm/projects/new/automation-project-wizard.tsx` | 17 stock palette classes, 1 shadow |
| `src/app/(shell)/pm/templates/template-manager.tsx` | 16 stock palette classes, 1 shadow |
| `src/app/(shell)/pm/projects/[id]/page.tsx` | 4 stock palette classes |
| `src/app/(shell)/dashboard/live-projects-table.tsx` | 3 stock palette classes |
| `src/app/(shell)/pm/tasks/[id]/page.tsx` | 2 stock palette classes |
| `src/app/(shell)/dashboard/page.tsx` | 2 stock palette classes |
| `src/app/(shell)/admin/users/user-admin-panel.tsx` | 6 shadows |
| `src/app/(shell)/admin/users/users-table.tsx`, `src/app/(shell)/pm/handovers/page.tsx`, `src/components/data-table.tsx` (2) | shadows |
| `src/components/shell/sidebar.tsx:148` | `font-bold` on display wordmark → remove (weight 400) |
| `src/components/ui.tsx` | raw hex value → token |

Persona components (`quick-login-buttons.tsx`, `persona-switcher.tsx`, `test-personas.ts`) also violate the palette rules but are out of scope per ground rule 2 — only restyle them if the owner asks.

Find remaining offenders with:
```bash
grep -rnE "\b(bg|text|border|ring|from|to)-(slate|gray|zinc|red|amber|blue|emerald|teal|purple|green|yellow|orange|indigo|rose|sky)-[0-9]{2,3}|\bshadow(-[a-z]+)?\b|#[0-9a-fA-F]{6}\b" src
```
Then run the checklist at the end of `docs/design-system.md`.

---

## F. Build, deploy, dependencies

### F-1 Runtime image copies source and full `node_modules`
- **Where:** `Dockerfile` runner stage (`COPY ... /app/src`, `COPY ... tsconfig.json`, `COPY --from=deps ... /app/node_modules`)
- **Problem:** Defeats the standalone build; image carries all source and dev dependencies (the header comment says "No source, no dev dependencies").
- **Fix:** Keep standalone output + `.next/static` + `public` + `prisma/`. For migrations, install only the Prisma CLI into the runner (`npm i --no-save prisma@6.19.3` in a separate stage and copy `node_modules/prisma` + `node_modules/@prisma`) instead of the full tree. Remove `src` and `tsconfig.json` copies unless `prisma/seed.ts` must run in the container (ask owner). Verify `docker build` and that `entrypoint.sh` still runs `migrate deploy`.

### F-2 `npm audit`: 3 high (Prisma CLI → `@prisma/config` → `deepmerge-ts`)
- Do **not** run `npm audit fix --force` (it downgrades Prisma). Check for a patched `prisma`/`@prisma/client` 6.19.x or later compatible release; if none, add an `overrides` entry for a fixed `deepmerge-ts` in `package.json`, reinstall, run build + tests.

### F-3 Repo hygiene
- Consolidate deploy scripts (`deploy.sh`, `deploy-to-vps.sh`, `deploy-to-vps.ps1`, `ship-image-to-vps.ps1`) — ask owner which one is used; delete the rest.
- `AGENTS.md`, `GEMINI.md`, `CLAUDE.md` overlap — ask owner; keep one source of truth and have the others point to it.
- Add `.code-review-graph/`, `.token-savior-cache.json`, `tsconfig.tsbuildinfo` to `.gitignore` if not already ignored.

---

## G. Tests to add (smallest useful set)

Untested hotspots from the graph: `changeTaskStatus`, `createAutomationProject`, `autoAssignAutomationTeam`, `decideHandover`, `DataTable`.
Minimum:
1. Pure helper for B-2 draft matching (unit index) — Vitest.
2. `recomputeTaskDerivedState` unblock logic (B-10) — extract the status decision into a pure function in `domain/scheduling.ts` and test it.
3. Template step renumber + dependency remap (B-5) — extract to a pure function in `domain/` and test.
4. RBAC: a principal with only a DEPARTMENT grant in dept A cannot pass `assertProjectPermission` for a dept B project (extend `src/core/rbac/engine.test.ts` or add an access test with a stubbed context).

---

## H. UX audit — goal: very simple, easy to navigate

Method: the running app (`localhost:3000`) was walked as Director and as Senior Engineer (Shivam), at desktop 1366px and phone 375px, plus a read of every screen's code. The owner's goal is a **very simple, easy-to-navigate UI**. All UX changes must still follow `docs/design-system.md` (section E).

### Principles to apply everywhere

1. **Each role lands on the screen they need.** Engineers: their work. PMs: their projects plus what needs their decision. Director/Heads: what needs attention.
2. **One primary action per screen**, clearly labelled with the next workflow step (Start, Submit for review, Approve).
3. **Never show a button or menu the user can't use.** Every visible action must succeed server-side (drive it from the `permissions` objects).
4. **One name per thing**, used in nav, buttons, page titles and breadcrumbs.
5. **Same number everywhere.** Progress, status and health come from one function.
6. **Hide empty and "coming soon" content** instead of showing boxes that say nothing.

### UX-1 Navigation per role (sidebar `src/components/shell/sidebar.tsx`)

Target (items appear only if the rule in brackets holds):

| Group | Item | Who |
|---|---|---|
| Work | **My work** | everyone (engineers' home) |
| Work | **Approvals** (badge = count) | `pm.progress.review` anywhere or manages a project (new page, section 0.5) |
| Work | **Handovers** (badge) | everyone |
| Manage | **Dashboard** | `pm.report.read` anywhere (PM / Head / Director home) |
| Manage | **Projects** | everyone (engineers see projects they work on) |
| Manage | **Team load** (rename of "Resource") | `pm.resource.read` |
| Setup | **Checklists** | `pm.template.manage` |
| Setup | **People**, **Roles**, **Audit trail** | existing admin permissions |

- Remove the "Ad hoc" nav item. Keep ad-hoc as a button on Dashboard and on a project page ("Add urgent task").
- Remove the 7 "SOON" module links from the sidebar. At most keep one "All modules" link for admins (`admin.module.manage`).
- Root `/` and post-login redirect: to `/pm/my-work` for users without `pm.report.read`, else `/dashboard`. Both `src/app/page.tsx` and `signIn` / `quickSwitchPersona` redirects need this.
- Header (`src/components/shell/*`): replace "Inbox" text with a bell icon + unread count. Hide the role pill below 768px.

### UX-2 Consistent names (rename everywhere, including titles and breadcrumbs)

| Today (mixed) | Use |
|---|---|
| "Define new project", "+ New Automation Project", "Create Automation Project", "New Automation Project" | **New project** |
| "Resource", "Resource board", "Team load" | **Team load** |
| "Checklists", "Checklist Templates", "Checklist Templates Management" | **Checklists** |
| "Ad hoc", "Raise ad-hoc task", "Assign ad-hoc work", "Create unassigned" | **Add urgent task** (button); page title **Urgent task** |
| "Punch in progress", "Record progress" | **Update progress** |
| "Mark complete" (engineer) | **Submit for review** |
| "Flag Roadblock", "Raise a Roadblock", "Resolve Roadblock & Resume" | **Report a problem** / **Problem solved – resume** |
| "My Work", "My work" | **My work** |

Also make text case consistent: sentence case for labels and options. Status filter options currently lowercase (`draft`, `in progress`); team role options lowercase (`lead`, `engineer`); the ALL-CAPS field labels are hard to scan. Use one status-label map (e.g. `src/components/ui.tsx`) for pills, filters and selects.

### UX-3 Dashboard (`src/app/(shell)/dashboard/page.tsx`, `dashboard.service.ts`)

Observed: KPI tiles → "Live projects" table → large red "Roadblocks (0 active)" box even when empty → two hardcoded team cards (Het Patel appears in **both** teams; overloaded people are listed last) → "Recent activity" with test text ("ggg"), raw "Step 4:" prefixes and duplicate entries.

Target (management):
1. Four tiles, each a **link** to its filtered list: Overdue projects, Problems reported, Awaiting approval (→ `/pm/approvals`), Handovers waiting.
2. **Needs attention** list (only when non-empty): problems, items awaiting approval, overdue tasks, pending handovers. One row each with a single action.
3. **Projects** table (existing `LiveProjectsTable`).
4. Team load summary: only people who are **overloaded** or **free**, sorted by load, grouped by the PM from the org chart (D-4). Link "See team load".
5. Remove "Recent activity" from the dashboard (it's in the audit trail), or cap it at 5, deduplicated, with `cleanTaskTitle` applied.
- Engineers are redirected to My work (UX-1), so the engineer branch of the dashboard can be deleted. That removes the duplicate stats and table they see today.

### UX-3a Director dashboard (owner request)

For users with `pm.oversight` (the four Directors; Dilip and Rajani get the same layout limited to their departments). Scope: **technical projects and TECH people only**. A reference mockup was shown to the owner on 2026-09-16; the layout below is that mockup.

Top to bottom:

1. **Header**: greeting, date, a period selector (*This week* / *This month*), and one primary button **New project** (`pm.project.create`).
2. **Three headline tiles.** Each tile links to a filtered list. (No "Order value at risk" tile; owner removed it.)
   | Tile | Value | Sub-line |
   |---|---|---|
   | On-time projects | live projects whose forecast finish ≤ target date, "X of Y" | "N late" in `error` if any |
   | Deliveries next 30 days | live projects with `targetEndDate` in the next 30 days | "next: <date>" |
   | Waiting on decisions | tasks IN_REVIEW + pending task/project handovers in scope | "oldest N days" |
3. **Needs attention** (left, wider). A ranked list with one action link each, shown only when non-empty:
   - late projects (by days late × order value)
   - approvals waiting longer than 2 days
   - problems (roadblocks) open longer than 1 day
   - overloaded engineers
   - handovers with no reply for 2 days
   
   Max 6 rows, plus "See all".
4. **Team capacity · TECH** (right): % of TECH capacity committed in the period (from `getWorkloads`), a single bar, and counts for *Overloaded* (`error`), *Free next week* (`success`), *On leave*. Links to Team load.
5. **Projects table** with filter chips *All / Late / At risk / On track*. Columns:
   - Project (+ client and scope, e.g. "2 PLC")
   - PM
   - Value (₹ lakh)
   - **Done vs time used**: progress bar (UX-4 `projectProgress`) with a tick mark at the % of planned time elapsed
   - **Finish**: target date, or "+N days" in `error` when the forecast is later
   - Health pill
6. **Project managers** (bottom left): per PM, live projects, on-time %, and items waiting for their approval.
7. **This week** (bottom right), each with last period's value in muted text:
   - tasks approved
   - sent back for rework
   - problems reported / solved
   - average approval time (IN_REVIEW → COMPLETED)

Definitions (put them in `src/modules/project-management/domain/portfolio.ts` as pure functions with unit tests):
- **Forecast finish** = the later of `targetEndDate` and the latest early-finish date from `computeSchedule` (`domain/scheduling.ts`) for open leaf tasks, anchored at today for tasks not started. If the schedule can't be computed, fall back to `targetEndDate`.
- **Health**:
  - **Late**: forecast finish > target, or target already passed with open tasks.
  - **At risk**: progress % < (time elapsed % − 15), or any open problem, or approvals waiting > 2 days.
  - **On track**: otherwise.
  - **On hold**: projects with status ON_HOLD are shown separately and excluded from health counts.
- **Time elapsed %** = (today − startDate) / (targetEndDate − startDate), clamped 0–100.
- **Average approval time** comes from audit rows `task.status_changed` (to IN_REVIEW, then to COMPLETED) per task.

Design-system rules (`docs/design-system.md`): Late = `error`, On track = `success`. There is **no third hue**, so *At risk* is an outlined neutral pill (`ink` text, `hairline` border). No shadows; hairline cards on `canvas`. `primary` (orange) only on the **New project** button. Numbers use tabular figures.

Data and performance:
- One service function `getDirectorDashboard(principal, period)` in `dashboard.service.ts`, starting with `assertCan`-style permission checks (`pm.oversight` anywhere).
- Load tasks and dependencies for all live projects in scope in **one query each** (no per-project queries), then compute in memory.
- Replace the hardcoded team cards (D-4) entirely.
- Order value is shown only to users with `pm.oversight`. PMs' dashboards don't show ₹.

Phone (375px): tiles stacked in one row of three (or one column if they don't fit); Needs attention first; Projects table becomes cards (name, PM, bar, finish, health); PM and This-week sections collapse under "More".

Done when: the numbers on this dashboard match the Projects list and project page (UX-4); a Director sees all technical projects; Dilip and Rajani see only their departments' projects; nobody without `pm.oversight` can load it.

### UX-3b Project timeline (owner request)

**What:** the user selects a project and sees a **horizontal timeline from the project's start date to its target finish date**. Each **completed step is a milestone marker on that line**, placed at the date it was completed. A reference mockup was shown to the owner on 2026-09-16.

**Where:**
1. **Director dashboard (UX-3a):** a "Project timeline" card under the Projects table, with a project selector (defaults to the most at-risk project). Clicking a row in the Projects table selects it.
2. **Project page** (`/pm/projects/[id]`): the same component at the top, above the task table, for everyone who can view the project.

**Layout:**
- Header: project name, PM, "N of M steps done", the project selector (dashboard only).
- Axis: start date on the left, **target finish** on the right, a few date ticks in between (weekly, or daily for projects shorter than ~3 weeks). If the forecast finish (UX-3a definition) is later than target, extend the axis and mark **Forecast finish** in `error` text.
- **One lane per unit** (PLC 1, PLC 2, SCADA 1…, i.e. each PHASE task), labelled on the left. A project with no phases gets a single lane.
- **Completed step**: filled `ink` marker with the step number, positioned at the task's `actualEnd` date (the COMPLETED transition date). The lane is drawn solid from start up to the latest completed step.
- **Upcoming steps**: hollow outlined markers at their `plannedEnd` date, muted. They show what's still ahead.
- **Late steps**: an upcoming step whose `plannedEnd` has passed gets an `error` outline.
- **Today**: a dashed vertical line labelled "Today".
- Markers that fall on the same or nearby dates must not overlap: offset them vertically above/below the lane (as in the mockup), or group them into one marker with a count ("3") that expands on hover/tap.
- **Hover / tap a marker**: small popover with step number and title (`cleanTaskTitle`), completed date (or planned date), who completed it, and "on time" / "N days late" versus `plannedEnd`. Clicking goes to the task page.
- Legend below: Completed step · Upcoming step · Today.

**Data:** one service call, e.g. `getProjectTimeline(principal, projectId)` in `project.service.ts`:
- Starts with `assertProjectVisible`.
- Returns start, target and forecast dates, plus lanes → steps `{ taskId, stepNumber, title, status, plannedEnd, completedAt, completedBy }`.
- `completedAt` / `completedBy` come from `Task.actualEnd` and the audit row `task.status_changed` to COMPLETED (after section 0 this is the review approval). Step number comes from the task's order within its phase (or the template step number if stored; otherwise order by `code`).
- A single query for tasks plus one for the audit rows. No per-task queries.

**Build notes:**
- Plain SVG in a client component (`src/components/project-timeline.tsx`). **No charting library.** Position by date → x with a small pure helper, unit-tested in `domain/` (clamping, same-day grouping).
- Design system: `ink` / `hairline` / `canvas` tokens, `error` only for late/forecast/today, no shadows, no orange. Step numbers in tabular figures.
- Accessibility: each marker is a focusable element with an `aria-label` ("Step 4, Verify PLC CPU config, completed 16 Sept, on time"). Also provide a visually hidden list of the steps.
- Phone (375px): the timeline scrolls horizontally **inside its own card** (the page doesn't), with lanes stacked, and the selector full-width above.

**Done when:** selecting a project on the Director dashboard updates the timeline; every COMPLETED step appears as a filled marker at its completion date, and every open step as a hollow marker at its planned date; the project page shows the same timeline; overlapping same-day markers stay readable.

### UX-4 Numbers must agree

Observed: *Monk Media One PLC* shows **27 %** on the dashboard and project page but **32 %** on the Projects list. *MMO HMI* shows **On hold** on the Projects list but counts as an active **Overdue** project on the dashboard.
- Create one `projectProgress(tasks)` helper in `src/modules/project-management/domain/` (hours-weighted over leaf tasks). Use it in `listProjects`, `getProjectWorkspace` and `getDashboard`. Unit-test it.
- Dashboard "active projects" and health must exclude `ON_HOLD` (or show "On hold" as its own health state). One `projectHealth()` helper, used in all three places.
- Project page "Effort 0/928h": hide when no hours are logged, or show "No hours logged yet".

### UX-5 My work (`src/app/(shell)/pm/my-work/*`)

Observed: identical rows ("DI Mapping" twice, "DQ Mapping" twice) because the PLC 1 / PLC 2 unit isn't shown.
- Show the parent phase/unit under the task name (e.g. "DI Mapping · PLC 2").
- Group rows by **To do now** (IN_PROGRESS / unblocked TODO), **Waiting** (BLOCKED, IN_REVIEW), **Later**. Keep sort by due date inside each group.
- Put the next-step button on each row (Start / Submit for review), so simple updates don't need the task page.
- Colour: "Due this week" is rendered red although nothing is overdue. Red (`error`) only for overdue/problems.

### UX-6 Task page (`src/app/(shell)/pm/tasks/[id]/*`)

Observed: the Actions card shows up to five competing actions at once: Mark complete, Cancel task, an always-open red "Raise a roadblock" box with a filled red button, a Reassign form, and Delete task.
- Top of page: status pill + **one primary button** for the next step (per section 0.5).
- "Report a problem": secondary button that opens a small inline form. Not an always-open red box.
- Manager-only actions (Reassign, Cancel, Delete, Reopen) go into a **"More"** menu.
- Update progress form: replace the slider with quick choices **25 / 50 / 75 / 100 %** plus a custom number. Keep "Hours spent" and "What moved forward". Default date = today and hide the date field behind "Different day?".
- Show the step number and "Next step: <title>" / "Waiting on: <title>". "Downstream: 0 task(s) wait on this" is confusing, and on step 4 of a 13-step sequence it currently reads 0. Verify template dependencies are actually created (see UX-8).
- No-access / missing task screen says "may have been deleted" and uses amber palette classes. Say "You don't have access to this task, or it no longer exists", use tokens, and link to My work.

### UX-7 Project page (`src/app/(shell)/pm/projects/[id]/*`)

- Status and priority are editable dropdowns inside the subtitle, so it's easy to change them by accident, and they allow "Completed" with open tasks. Show read-only pills. Status changes happen through workflow buttons (Start is automatic; **Complete project** appears only when all tasks are closed, per 0.4 item 7). Priority edit moves into an "Edit project" dialog for PM/Head/Director.
- Task table: 28+ rows flat. Make each unit (PLC 1, PLC 2, SCADA 1…) a **collapsible group** with its own progress, show the step number, and add filter chips *All / Open / Waiting for approval / Problems*.
- Header actions: keep **Add urgent task** (primary for managers) and **Team load**. Move "Handover project" into a "More" menu.
- Team panel "Add member": the dropdown lists 28 people including heads. Use a searchable select and exclude people already on the project.
- "All tasks are 100% complete!" banner (`page.tsx:83`) uses `emerald-*` palette classes and is based on % instead of task status. Base it on status (all leaf tasks COMPLETED/CANCELLED). Show it only to users who can complete the project, and use `success` tokens.

### UX-8 New project wizard (`src/app/(shell)/pm/projects/new/automation-project-wizard.tsx`, 735 lines)

Observed: one long page with 4 numbered sections. The step circles are orange, which breaks the "orange is scarce" rule. Section 4 renders an assignee plus two dates for every step of every unit (13 × units rows).
- Split into **3 steps with Back/Next**: (1) Order details, (2) Scope & project manager, (3) Review team & dates.
- In step 3, **run auto-assign automatically** and show a compact summary per unit ("PLC 1 – 13 steps – Shivam, Sahil – 15 → 30 Sept"). Show per-step rows only after "Edit assignments".
- PM dropdown: only `PM_BASE` holders (0.3). Explain the "Show PM team members only" checkbox in one line, or remove it and always filter to the PM's team with a "Show everyone" link.
- Numbered step markers use `ink`/`surface-strong`, not `primary`.
- Split the component (form state hook + 3 step components) as part of this change.
- Verify multi-unit drafts (B-2) and that the 13-step dependencies are created. In the demo data, step 12 is completed while steps 5–11 are still To do.

### UX-9 Team load (`src/app/(shell)/pm/resources/page.tsx`)

Observed: 30 large cards in alphabetical order. (The current load figures are deliberate test assignments by the owner. This item is about layout, not data.) With real data, anyone overloaded ends up wherever their name falls alphabetically, so a manager has to scroll through every card to find them.
- Default view: a **compact table** sorted by load (highest first), columns *Person · Load bar · Free hours · Open tasks · Leave*.
- Filter chips: *Overloaded / Busy / Free / On leave*, plus the existing date and department filters.
- Clicking a person expands their task list inline.

### UX-10 Projects list (`src/app/(shell)/pm/projects/page.tsx`)

- Engineers currently see "0 projects – Projects you manage appear here" while working on a project. Fixed by 0.4 item 8. The empty-state text must match the role ("Projects you work on appear here").
- Filter by status with chips instead of a select + Apply button, and search as you type (debounced) instead of "Apply".
- Show the same progress number as everywhere else (UX-4) and the health pill.

### UX-11 Phone layout (375px)

Observed on the engineer dashboard: the user's name wraps next to a large role pill; the four stat tiles stack vertically and fill the whole first screen; the task table overflows sideways.
- Stat tiles in a **2 × 2 grid** below 640px.
- Tables (`DataTable`, My work, projects, team load) render as **stacked cards** below 640px: title, one meta line, status pill, primary action.
- Header: avatar + bell only; name and role move into the menu sheet.
- Tap targets ≥ 44px for row actions.

### UX-12 Demo data and small polish

- Seed/demo data contains test notes ("ggg"), clients named "Dhruv", and duplicate progress entries. Clean `prisma/seed.ts` so demos look real (ask owner before wiping the local DB).
- Table sort indicators are text glyphs (`⇅`, `▲`). Use the icon style used in the sidebar, with `aria-sort` on the header cell.
- Every icon-only button (sidebar collapse, team-panel ⇄ / ✕) needs an `aria-label`.
- The login screen placeholder uses another company's domain (D-4).

### UX done when

- A junior engineer can go from login → their task → Start → Update progress → Submit for review without seeing a button that fails, and without passing through an empty or unrelated screen.
- A PM can see everything waiting for their approval in one place and approve it in one click per task.
- Every screen named in UX-2 uses the same label in nav, title and breadcrumb.
- Progress and health for a project are identical on Dashboard, Projects and the project page.
- At 375px no page scrolls sideways (tables become cards).
- The design-system checklist in `docs/design-system.md` passes for every changed screen.

---

## Suggested order of work

1. **Section 0** — target workflow: roles/permissions, seed grants and reconciliation, relationship rules, status transitions, auto project status, review gate. Includes A-2, A-3 and the `/pm/approvals` page.
2. A-1, B-1, B-2, B-3, B-5 (small, high-impact bug fixes)
3. A-4, A-5, B-7, B-8 (validation and write-path consistency)
4. **UX-1, UX-2, UX-4** (navigation, names, one source for numbers). These make everything after them simpler.
5. **UX-5, UX-6** (My work and Task page: the engineer's daily path)
6. **UX-3, UX-3a, UX-3b, UX-7, UX-10** (Dashboards incl. Director dashboard, Project page, Projects list)
7. **UX-8, UX-9, UX-11, UX-12** (wizard, team load, phone layout, polish)
8. B-4, B-9, B-10, B-11, B-13
9. C-1, C-2, C-3
10. D-1 … D-5
11. E (design system — also apply while touching each screen in steps 4–7)
12. F, G

After each step: `npm run typecheck && npm test && npm run build`, then summarize changes for the owner in plain language and wait for "go" before the next step.
