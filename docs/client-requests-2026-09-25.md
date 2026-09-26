# Client requests — 2026-09-25

Three requests came from the client over WhatsApp. This plan covers each one. Claude wrote the plan; Antigravity builds it.

## 0. Release safety: the app is live (read first)

### Findings

1. **Passwords are effectively hardcoded.**
   - `prisma/data/logins.csv` holds every employee's password in plain text and is committed to git.
   - `entrypoint.sh` runs `set-passwords-from-csv.ts` on **every container start**, which resets everyone back to the CSV values.
   - `prisma/seed.ts:16` falls back to a default password (`'ACSengi@2026'`) when `SEED_PASSWORD` is unset, and `.env.example` ships the same value.
   - Result: anyone with repo access knows every login, and any password reset is undone on the next deploy.
2. **Every push to `main` deploys to production with no checks.** `.github/workflows/deploy.yml` SSHes to the VPS and runs `docker compose up --build`. It never runs tests, lint or a type-check.
3. **The schema is applied with `prisma db push` on start**, not `prisma migrate deploy`. The committed migration files are never used in production. A destructive diff makes `db push` refuse, and `set -e` then crash-loops the container. That is downtime.
4. **Tests today:** vitest unit tests cover domain, validation and RBAC. They do not cover services against a database, or any page or server action. The only DB-level check is the ad-hoc script `prisma/scripts/verify-handover-rework.ts`.

### Gate: build this before any feature below

**A. CI gate**
- Add a `ci.yml` workflow that runs on every PR and every push: `npm ci` → `prisma validate` → `tsc --noEmit` → `npm test` → `next build`.
- Change `deploy.yml` so it runs **only after `ci.yml` passes on main** (use `workflow_run`, or a `needs:` in the same workflow).
- Protect the default branch so work lands through PRs.

**B. Integration tests against a real Postgres**
- In CI, run a Postgres 16 service container. Locally, use `docker-compose.local.yml`.
- Add `vitest.integration.config.ts`, covering `src/**/*.int.test.ts`. Each test runs inside a transaction, or truncates between tests, and seeds its own users and roles. Tests never share data.
- Every service change in this plan ships with `.int.test.ts` coverage for:
  - RBAC allow and deny;
  - the happy path;
  - the validation failure;
  - an audit row written without secrets.

**C. Migration safety**
- Switch `entrypoint.sh` from `db push` to `prisma migrate deploy`.
- One-time baseline: run `prisma migrate resolve --applied` for each existing migration on prod, after a diff check shows prod equals the migrations.
- Before each deploy that includes a migration, take a `scripts/backup.sh` snapshot. Rehearse the migration on a restored copy of that snapshot locally, following `docs/migration-rehearsal-plan.md`.
- In this plan, only #1 (nullable `workOrderNo`, the `kind` enum) and #8 (the new permission key) touch data. Both are additive and non-destructive.

**D. Pre-deploy checklist (every release)**
1. CI is green: types, lint, unit, integration, build.
2. Take a backup (`scripts/backup.sh`) and copy it off the VPS.
3. Restore that backup locally, start the app, and click through the affected screens in the browser pane. Log in as Director, PM, engineer and Sales Head.
4. Deploy. Watch `docker compose logs` for the migration and seed output.
5. Smoke test on prod: log in, open the dashboard, a project, People and Audit. Confirm nothing returns 500.
6. Rollback plan: `git revert` plus a redeploy. If a migration ran, `scripts/restore.sh` from the backup in step 2.

**E. Passwords: cut over safely**
- Order matters, or people get locked out:
  1. Ship #8 (Director reset) while the CSV sync is still on.
  2. The Director verifies that a reset works for one test account.
  3. Next release: remove the CSV sync from `entrypoint.sh`. Passwords stay exactly as they are, because the hashes are already in the DB.
  4. Delete `logins.csv` and purge it from git history (`git filter-repo`), then force-push. Coordinate with Antigravity and the VPS checkout (`git pull` fails after the rewrite; re-clone or `git reset --hard origin/main`).
  5. **No forced reset.** Current passwords stay as they are (client decision, 2026-09-25). The Director resets any account he chooses from the People drawer. Nothing in the release changes anyone's password.
- Remove the `'ACSengi@2026'` fallback in `seed.ts`: fail if `SEED_PASSWORD` is unset. Change `.env.example` to a placeholder.
- Tests: a reset password survives a container restart (integration test: run the entrypoint seed steps twice, then log in).

### Per-feature test requirements

| # | Unit | Integration (real DB) | Browser check before deploy |
|---|---|---|---|
| 1 Service call | zod: WO optional only for `SERVICE_CALL` | create with no WO; two service calls with no WO; duplicate WO rejected; commissioning works with a null WO | wizard toggle, badge on dashboard, project page, commissioning |
| 2 Sales Head | role has no mutating key | `SALES_HEAD` principal gets 403 on every create, update and delete service; sees all projects | log in as him; no write buttons visible |
| 3 Dummy data | none | none | project and client are gone; no orphan notifications |
| 5 Timeline | label layout helper (positions and clamping) | none | three date scenarios, at desktop and 375px |
| 6 Clients | status split into current and past | scoped counts; 404 for a client in another company; legacy `clientName` match | list, detail, links |
| 8 Password reset | `passwordIssues` | only DIRECTOR and SUPER_ADMIN allowed; old password fails and new one works; audit row has no password; survives a restart | Director resets a test account and logs in with it |
| 9 People | role label formatter | last sign-in query | drawer at desktop and mobile |
| 10 Audit | formatter per action, plus fallback | none | audit page with real rows |
| 11 Portfolio | none | the query returns `clientName` | Tejas Rokade page |

## 1. Urgent service call without a work order

**Request:** "An urgent service call can come in. We need to add it without a work order, in the client's name."

**Today:** `Project.workOrderNo` is required and `@unique` (`prisma/schema.prisma:420`). Both zod schemas require digits (`validation/schemas.ts:20,115`). The project name defaults to `WO <no>`, and the WO number shows on the dashboard, the project page and the commissioning screens.

**Approach:** treat a service call as a project with no work order. Do not build a separate module, because commissioning, logs, members and notifications already hang off `Project`.

1. Schema migration `20260925000001_service_call`:
   - `workOrderNo String? @unique`. Postgres allows many NULLs under a unique index.
   - Add `enum ProjectKind { WORK_ORDER SERVICE_CALL }` and `kind ProjectKind @default(WORK_ORDER)`.
2. Validation: in `schemas.ts`, `workOrderNo` becomes optional when `kind = SERVICE_CALL` (use a discriminated union or a `superRefine`). `clientId` stays required.
3. Service, `automation-project.service.ts:229-250`: skip the WO uniqueness check when there is no WO. Name the project `SC <client name> <dd-MMM>`. Generate `code` the same way as today.
4. UI:
   - Add a "Service call (no WO)" toggle to the new-project wizard (`automation-project-wizard.tsx:400,462,520,660`) that hides the WO field.
   - Add a "Service call" quick-create button on `/pm/projects` for users with `pm.project.create`. It asks for client, PM, priority (default HIGH) and description only.
   - Wherever `WO {workOrderNo}` is shown (`director-dashboard.tsx:352`, `projects/[id]/page.tsx:107`, `commissioning-client.tsx:166,320`, `my-commissioning-client.tsx`), show a `SERVICE CALL` badge plus the client name when `workOrderNo` is null.
5. Later: add "Attach WO" to project edit, so a service call can be converted once the paperwork arrives. Setting a WO does not change `kind`.
6. Tests: create a service call with no WO; two service calls do not collide; a duplicate WO is still rejected; the display falls back correctly.

**Open question for the client:** does a service call get the checklist WBS, or is it commissioning/logs only? The default in this plan is **no checklist**. It jumps straight to commissioning assignment. Confirm before building.

## 2. Make Dharmesh Thummar a view-only Sales Head

**He already exists.** He is seeded in `prisma/seed.ts` (search `dharmesh.thummar@acsengitech.com`, "Dharmesh Bhartbhai Thummar"). On People, he is the manager Aakash Panchal reports to. He is **not** in `logins.csv`, so the CSV sync never touches his password. Do **not** create a new user, and do **not** change his password.

**Today:** he is seeded with `DEPARTMENT_HEAD` on the SALES department. That role has write keys, so he is not view-only. The `VIEWER` role (`permissions.ts`, `VIEWER:`) only covers projects he is a member of, so he would see almost nothing.

**Approach:**
1. Add a system role `SALES_HEAD` ("Sales Head", read-only) to `SYSTEM_ROLES`, with these permissions: `pm.project.read`, `pm.project.read.all`, `pm.task.read`, `pm.resource.read`, `pm.report.read`.
   - No `pm.oversight`, so he does not get flooded with notifications.
   - No write keys.
2. Add the script `prisma/scripts/grant-sales-head.ts`, modelled on `grant-service-head.ts`. It is idempotent:
   - Upsert the role and its permissions.
   - Find the user by email `dharmesh.thummar@acsengitech.com`. Fail loudly if he is not found; never create him.
   - Remove his current `DEPARTMENT_HEAD` assignment (DEPARTMENT scope, SALES), plus any other role he holds, so that he is purely view-only. Log what was removed.
   - Add the `SALES_HEAD` COMPANY-scope assignment.
   - Leave his password, profile and reporting line untouched.

   Also change his seed entry in `seed.ts` to `roles: [{ key: 'SALES_HEAD', scopeType: 'COMPANY' }]`, so that a fresh environment matches production. The seed is create-only, so this change alone does not affect production.

   Run the script on a restored copy of production first, then on production after the deploy.
3. If he has never had a password handed to him, the Director sets one using the People drawer reset (#8). So #8 ships before this.
4. Tests:
   - Unit: `SALES_HEAD` holds no create, update, delete, assign, manage or approve key.
   - Integration: a `SALES_HEAD` principal gets 403 from each mutating service and can list all projects.
   - Browser: log in as him. The dashboard, Projects, Clients and Team load are visible, and there are no write buttons.

## 3. Delete dummy project "WO 123123" (client "gggg")

This is a data task, not a code change.
- Use the existing Delete action on the project page (`project-danger-actions.tsx` → `deleteProject`, `project.service.ts:1138`). It asks for the code as confirmation, and since `fd5b53d` it also cleans up linked notifications.
- Then delete the dummy client "gggg" if it has no other projects. Check whether there is a client delete/deactivate path. If there is none, set `isActive=false` in Prisma Studio.
- Before deleting, check prod for any other test projects (e.g. `workOrderNo` matching `^1231`, or clients with junk names) and list them for the client to confirm.

## 4. Tasks can be assigned to PMs and Assistant PMs (confirmed 2026-09-26)

**Request (clarified by the user):** the 4 people offered as PM in the new-project wizard (`PROJECT_MANAGER` / `ASST_MANAGER`) must also be assignable on tasks.

**Rules:**
- "PM" and "Assistant PM" are just two names for the same role. Both have exactly the same permissions, and each leads their own team (their subtree through `managerId`). Nothing in this change checks which of the two titles someone holds; `projectManagerPool` treats both the same.
- PMs don't create projects or tasks. Directors and Technical Heads (`pm.oversight`) do, and they can assign to anyone, including all 4.
- A PM or Assistant PM can reassign a task to anyone in any team, including themselves and the other PMs/Assistant PMs.
  - **Same team** (the current owner and the target share a team root): the task moves immediately, with no approval.
  - **Another PM's team**: this creates a request that a Technical Head or Director must approve. The task stays with its current owner until the request is approved.
- Auto-assign stays engineers only.

**Today:**
- `isExecutionStaff` (`domain/availability.ts:292`) and `teamOf` (`services/access.ts:320`) drop anyone graded MANAGER or with "manager/asst" in their designation, so no picker offers these 4.
- `requestHandover` and `requestPanelHandover` (`handover.service.ts:68`, `:1652`) only accept targets with the `SENIOR_ENGINEER` / `JUNIOR_ENGINEER` role, and reject `PROJECT_MANAGER`.
- A PM reassignment is always direct, even across teams (`handover.service.ts:120`, the `isManagerOrLead` branch). The head-approval stage (`AWAITING_HEAD_APPROVAL`, approved through `decideHandover` stage 2 at `:716`, listed for heads in `listHandovers` at `:1432`) already exists, but is only reached through the two-stage flow.

**Approach:**
1. Leave `isExecutionStaff` as it is. `handover.service.ts` also uses it as a manager-rights check, and `dashboard.service.ts:317` uses it to count free engineers.
2. `access.ts`: add `projectManagerPool(companyId)`, using the same query as `getPMTeamData().managers`. Refactor `getPMTeamData` to call it, so the wizard and the task pickers list the same people.
3. Handover target check (task and panel): accept a user who is either an engineer (as today) or in `projectManagerPool`. Other roles stay rejected.
4. Handover routing when the requester is a PM or Assistant PM without `pm.oversight`:
   - `isCross === false`: direct move, as today.
   - `isCross === true`: create the `TaskHandover` with `status: 'AWAITING_HEAD_APPROVAL'`, skipping stage 1, and notify Technical Heads and Directors. Nothing moves until `decideHandover` stage 2 approves. Apply the same routing to `requestPanelHandover`.
   - Oversight holders (Directors, Technical Heads) stay direct in every case.
   - `teamRootOf` must treat a pool member as the root of their own team, so a PM moving work to themselves or to their own engineer counts as same-team.
5. Pickers: the reassign list for PMs shows every engineer plus the pool. Mark people outside the requester's team "Needs Head approval", so the PM knows before submitting. `suggestAssignees` shows pool members in a "Project Managers" group, ranked by free hours. `applyHardRules` H4 stays, so auto-assign never picks them.
6. Tests (integration suite):
   - A Technical Head assigns a task to an Assistant PM: it moves immediately, shows in their My Work, notification sent.
   - A PM reassigns to their own engineer or to themselves: it moves immediately.
   - A PM reassigns to another PM's engineer, or to another PM/Assistant PM: a request is created in `AWAITING_HEAD_APPROVAL`, the owner is unchanged, and heads are notified. After a head approves, the task moves. After a head rejects, it stays.
   - An engineer still can't hand over across teams.
   - Auto-assign never selects a pool member.
   - Existing handover tests stay green.

## 4b. PMs and Assistant PMs can't create tasks (confirmed 2026-09-26)

**Rule:** only Directors and Technical Heads create tasks, planned or urgent (adhoc). PMs and Assistant PMs keep read, update, assign, reassign and review.

**A PM can create tasks today through 4 paths, and all 4 must close:**
1. `core/rbac/permissions.ts:191,194` (`PROJECT_MANAGER`) and `:210,213` (`ASST_MANAGER`): remove `pm.task.create` and `pm.task.adhoc.create`.
2. `services/access.ts:106,109` `MANAGER_IMPLIED`: remove both keys. Without this, the manager of a project still gets them on their own project.
3. `services/project.service.ts:557-558`: remove the `|| project.managerId === principal.userId` fallback on `canCreateTask` and `canCreateAdhocTask`. It bypasses the permission check and would keep the buttons visible.
4. **Live database:** role permissions are stored in `core_role_permissions`, and code changes don't touch them. Add a migration (`prisma migrate dev --create-only --name revoke_pm_task_create`) that deletes those two keys for `PROJECT_MANAGER` and `ASST_MANAGER`, looking roles and permissions up by `key`. It runs once through `migrate deploy`, after the automatic pre-deploy backup (see `docs/deploy-pipeline-plan.md` §3). The user approves the release that carries it.

**Follow-on effects:** the "Urgent task" sidebar item (`sidebar.tsx:114`) and `/pm/adhoc` (`adhoc/page.tsx:28`) hide or redirect by themselves once the permission is gone. Check that PMs still see and edit existing tasks. `pm.task.update` and `pm.task.assign` stay.

**Tests:**
- A PM calling `createTask` (planned and ADHOC) on their own project gets `ForbiddenError`.
- A Technical Head can still create both kinds.
- The PM's project page returns `canCreateTask: false` and `canCreateAdhocTask: false`.

## 5. Timeline header labels overlap

**Bug (screenshot, WO 123123):** in the project timeline header (`src/components/project-timeline.tsx:246-278`), all the labels are absolutely positioned on one 24px line:
- "Today (25 Sept)" sits on top of "Start: …" when today is close to the start date.
- When the project is late, "Target: 8 Oct" (centred at `targetEndX%`) collides with the right-aligned "Forecast: 9 Oct (Late)". The Target label also wraps ("Oct" drops to a second line).

**Fix:**
1. Split the header into two rows. Row 1 holds Start (left) and Target / Forecast (right). Row 2 holds only the Today pill at `todayX%`. Make the header `h-12` instead of `h-6`.
2. When forecast is late, render a single right-aligned label, "Target 8 Oct · Forecast 9 Oct (Late)". Keep the target position as a dashed tick on the axis only, with no floating text.
3. Add `whitespace-nowrap` to every header label. Clamp the Today pill with `-translate-x-0` near 0% and `-translate-x-full` near 100%, so it never spills past the edges.
4. Verify in the browser pane on WO 123123 or a seeded late project, at desktop and 375px widths. Cover three cases: today at the start, target and forecast one day apart, and today near the end.

## 6. Clients menu: client list and client detail

**Request:** a Clients menu that lists every client. Clicking a client shows all of that client's past and present projects.

**Today:** `client.service.ts` has `listClients` and `getClientById`, but neither checks permissions, and there is no clients page. Clients are only picked inside the new-project wizard.

**Approach:**
1. Sidebar (`src/components/shell/sidebar.tsx:118`): add `{ label: 'Clients', href: '/pm/clients', requires: 'pm.project.read', icon: Icons.Projects }` directly under Projects. No new permission is needed, so the Sales Head from #2 gets it automatically.
2. Service (`client.service.ts`): add two functions that take a `principal`.
   - `listClientsWithStats(principal)` returns each client with its ref number, name, active flag, active project count and completed project count. Counts use a `groupBy` on `Project` filtered by `projectVisibilityWhere(principal)`, so a user only counts projects they are allowed to see.
   - `getClientPortfolio(principal, clientId)` returns the client plus its visible projects (code, WO, or the SERVICE CALL badge from #1, name, status, priority, PM, start and target dates, progress %). Return 404 if the client belongs to a different company.
   - Match projects on `clientId`. Older rows may have `clientId = null` with only a `clientName`, so also match `clientName` (case-insensitive) as a fallback.
3. Pages:
   - `/pm/clients/page.tsx`: a searchable table (ref no., name, active, completed, last project date). Each row links to the detail page. Show an "Add client" button only to users who hold `pm.project.create`, reusing the existing add-client dialog.
   - `/pm/clients/[id]/page.tsx`: a header with the client name, ref no. and totals, then two sections:
     - **Current**: DRAFT, PLANNING, IN_PROGRESS, ON_HOLD, COMMISSIONING.
     - **Past**: COMPLETED, CLOSED, CANCELLED, newest first.

     Rows link to `/pm/projects/[id]` and reuse the existing status and priority badges.
   - Make the client name on the project page (`projects/[id]/page.tsx:107`) a link to the client page.
4. Tests:
   - A user without `read.all` sees only their own projects, both in the counts and on the detail page.
   - A client from another company returns 404.
   - A project with only a legacy `clientName` still appears under its client.
5. Verify in the browser pane, including the dummy client "gggg" before and after #3.

## 7. Show the client name next to the WO in project dropdowns — PARKED (urgent task skipped for now)

**Request:** the "Charge to project" dropdown on Urgent task lists only "WO 7120", "WO 7055" and so on, which makes it hard to tell projects apart.

**Fix:** label each option `WO 7120 — <client name>`.
1. `src/app/(shell)/pm/adhoc/adhoc-form.tsx:77-78`: render `{project.name} — {project.clientName}`. `adhoc/page.tsx` already selects `clientName`, so the query needs no change.
2. Also sort the list by WO number, newest first. It currently sorts by `code`, which looks random to users.
3. Apply the same label to the other project `<select>` elements:
   - the project picker in the timeline (`src/components/project-timeline.tsx:232`);
   - the project picker in the resources and team-load filters (grep for `<option` + `p.name`).

   Put the label in a small helper, `projectLabel(p)` in `modules/project-management/domain`, so the format stays the same everywhere. Service calls from #1 show as `SERVICE CALL — <client>`.
4. Verify in the browser pane: the Urgent task dropdown shows "WO 7120 — <client>".

## 8. Passwords: set, reset and change

**Today:**
- An admin types an "Initial password" when adding an employee (`admin/users/user-admin-panel.tsx:136`). It is stored only as a bcrypt hash, so **nobody can see an existing password**, admins included. It can only be replaced.
- The password policy (`core/auth/password.ts`) is at least 10 characters, with an uppercase letter, a lowercase letter and a digit.
- Nothing in the UI lets a user change their own password, and nothing lets an admin reset one.
- `prisma/scripts/set-passwords-from-csv.ts` **runs on every container start** and resets everyone listed in `prisma/data/logins.csv` back to the password in the CSV. Any change a user made is undone on the next deploy, and the passwords sit in git in plain text.

**Decision (client, 2026-09-25): only a Director can change passwords.** Employees get no self-service change.

**Who can reset:** add a dedicated permission, `admin.user.password.reset` ("Reset an employee's password"), and grant it to **DIRECTOR** and to SUPER_ADMIN (the break-glass account) only. Don't reuse `admin.user.manage`: that permission can be handed to other roles in the role editor, and resetting passwords should stay with the Director. Add a sync script, `grant-password-reset.ts`, modelled on `grant-service-head.ts`, so that production picks up the new key.

**Approach:**
1. **Director "Reset password" in the People drawer** (`admin.user.password.reset` only):
   - When an admin clicks an employee row on People, the right-hand drawer opens (`users-table.tsx`, around line 340). Add a **Password** section under "Account & contact", holding a "Set new password" button.
   - The button opens an inline form with two choices: **Generate** (a random password that meets the policy) or **Type one**. The admin can copy it and pass it to the employee in person.
   - On save, call a new server action `resetUserPassword(principal, userId, newPassword)` in `admin.service.ts`. It checks `admin.user.password.reset`, runs `passwordIssues`, and saves `hashPassword`.
   - Write an audit entry `admin.user.password_reset`, with the target employee, and never the password.
   - After saving, show "Password updated for Aakash Panchal". Show the new password once, with a copy button. It is never retrievable again.
   - Users without `admin.user.password.reset` do not see the section at all.
2. **Stop the CSV overwrite:**
   - Remove `set-passwords-from-csv.ts` from `entrypoint.sh`. Otherwise the next deploy reverts every password reset.
   - Delete `prisma/data/logins.csv` from the repo and purge it from history.
3. Tests:
   - Every role except DIRECTOR and SUPER_ADMIN gets 403 (loop over SYSTEM_ROLES).
   - A weak password is rejected.
   - After a reset, the old password fails and the new one works.
   - The audit entry does not contain the password.

**Until this ships:** the only way to change a password is to edit `logins.csv` and redeploy.

## 9. People table and drawer cleanup

**Role column** (`users-table.tsx:217-223`): system roles render as a grey rounded pill, e.g. "JUNIOR ENGINEER". Other people show plain designation text, so the column looks inconsistent.
- Drop the `badge bg-surface-strong` classes and render plain text, like the designation.
- Title case the role name with `role.name`, e.g. "Junior Engineer", instead of the lower-cased key that the CSS then upper-cases.
- Keep the `(+N)` suffix and the tooltip.

**Drawer details** (screenshot: Aakash Panchal):
- **Header:** show the role or designation and the department under the name.
- **Account & contact:** add **Last sign-in**, taken from the latest `auth.signed_in` audit row, or "Never". Add **Account created**. The status pill stays.
- **Organization:** make "Reports to" a link that opens that person's drawer.
- **Roles & scopes:** the empty state "No access or roles assigned yet." is red, which reads as an error. Make it muted grey and explain what it means: "No app access, so this employee cannot sign in to any module." Show an **Assign role** link for users with `admin.role.assign`.
- **Password:** the section from #8.
- **Workload:** for engineers, show open tasks and current load hours, with a link to `/pm/resources/[userId]`.

## 10. Audit trail readability

**"Why did Shakti Vasava sign in as Employee?"** He didn't. The ITEM column shows the type of record that was touched, and a sign-in is recorded against the user's own account record (`entityType = User`). `formatItemType` (`admin/audit/page.tsx:52`) maps `User` to "Employee". His role is not involved. Fix the wording so it doesn't mislead:
- For auth actions (`signed_in`, `signed_out`, `password_reset`), set ITEM to **Account**.
- For admin actions on a user, set ITEM to **Employee: <name>**.

**Details column** (`formatDiff`, `page.tsx:83`): right now it dumps raw keys, e.g. `note: null, role: OWNER, to user id: Agastya Patel, from user id: Hitesh …`.
- Write a per-action sentence formatter, with the fallback being today's key/value list:
  - REASSIGNED TASK → "Hitesh → Agastya Patel (owner)", with the task title linked.
  - PROJECT TASKS BULK REASSIGNED → "27 tasks: Yogi Patel → Paras Prajapati".
  - PM PROJECT DELETED → "WO 123123 · gggg · 42 tasks".
  - AUTOMATION PROJECT CREATED → "WO 7096 · PM Dhrupin Vaghasiya".
  - PROJECT MEMBER REMOVED → "Removed Abbasali Sunasara".
- Hide keys whose value is `null` or empty.
- Resolve `to/from user id` to "to" and "from" with names. The `nameMap` already does the lookup, so this is only a label change.
- Make ITEM a link to the project or task when it still exists.
- Show the full text in a hover title or an expandable row instead of truncating at `max-w-md`.
- Show the ACTION label in sentence case ("Project deleted"), not upper case, and drop the "PM" module prefix.

**Tests:** unit-test the formatter for each action above, plus the fallback.

## 11. Engineer portfolio: client name on the "Panels owned" cards

**Request:** on `/pm/resources/[userId]` (screenshot: Tejas Rokade), each panel card shows "WO 6934" with no client name.

**Fix:**
1. Add `clientName` to the panel rows returned by the service that feeds `engineer-portfolio.tsx` (the query that already selects `projectName`). No schema change is needed, because `Project.clientName` exists.
2. `engineer-portfolio.tsx:135`: render `WO 6934 · <client name>`. Truncate with a `title` tooltip so long names do not wrap the card.
3. Do the same for the other `projectName` lines on this page: open steps (`:229`) and handovers (`:260`, `:280`).
4. Use the same `projectLabel(p)` helper proposed in #7, so the format is identical everywhere. If #7 stays parked, create the helper here.
5. Verify in the browser pane on Tejas Rokade's portfolio.

## For Antigravity: how to work this plan

**Toolchain (required; use the tools, don't just mention them):**
- **code-review-graph**: update the graph at the start (don't rebuild from scratch). Before changing any service, run `query_graph` (callers_of / importers_of), `get_impact_radius` and `get_affected_flows`, and put the results in your summary.
- **token-savior**: `switch_project` to this repo first. Read code with `find_symbol`, `get_function_source` and `get_full_context` instead of dumping whole files.
- **sequential-thinking**: use it to order the steps of each section, and for any bug you hit, before concluding.
- **ponytail** (full): take the smallest change that works. Don't add abstractions the plan doesn't ask for.
- **Matt Pocock skills**:
  - `tdd`: write the failing test first for every service change, following the #0 test table.
  - `diagnosing-bugs`: use it when something fails.
  - `codebase-design`: use it when adding helpers such as `projectLabel`.
- If a tool is missing or fails, say so in your summary. Never claim you used it.

**Rules:**
- **Local commits only. Never push.** A push to `main` deploys to the live site until #0 A is in place. The user relays each batch to Claude for review before anything is pushed.
- One commit per plan section, with a message like `feat(pm): #6 clients menu`.
- Line numbers in this plan go stale as soon as you edit. Search for the quoted code instead.
- Before each commit, run `npm run typecheck && npm test && npm run build` (there is no lint script yet; #0 A adds one if wanted). Also run `npm run test:int` once #0 B exists. All of them must pass.
- Do not touch the parked item #7, or ERP, HRMS and Gate.

**Already done: do not redo or revert:**
- Multi-panel engineer assignment and direct management handover (`eaff6f6`).
- `deleteProject` cleans up notifications linked to the project (`fd5b53d`).
- The Add-client dialog fix for the nested form (`6b610a0`).
- Test harness cleanup of notifications and events (`433f404`).

**When done:** give the user a short summary per section. List the files changed, the tests added, the tool results (graph impact and so on), and anything skipped and why.

## Review of Antigravity batch 1 (commits `5a887d0`..`3f6bd94`): fixes required before push

**Status:** typecheck, 115 unit tests and `next build` all pass. The integration tests were **not** run, because Docker was down locally. **Do not push.** Fixes R1 and R2 would take the live site down.

### Live DB facts (checked on the VPS, 2026-09-25, read-only)

- `_prisma_migrations` holds **only `20260910134722_init`**. The five later migrations were applied through `db push` and were never recorded.
- The live schema matches the deployed `schema.prisma` at `eaff6f6` exactly (`migrate diff --from-url … --to-schema-datamodel` gives an empty migration).
- **The migration folder is broken.** Replayed on an empty DB, `20260924000002_handover_rework` fails with P1014 (`pm_project_handovers` does not exist), because no migration ever creates that table. `prisma migrate deploy` therefore fails both on a fresh CI database and on production. On production it would try to re-run `20260923000001_client_master` against existing tables, then `set -e` crash-loops the container.

### R1 (blocker): replace the migration history with a baseline

1. Move the six existing migration folders out of `prisma/migrations/` into `prisma/migrations-archive/` for reference. Prisma must not see them.
2. Generate the baseline from the **live** schema, which is `schema.prisma` as of `eaff6f6` (no service call):
   `git show eaff6f6:prisma/schema.prisma > /tmp/live.prisma`
   `npx prisma migrate diff --from-empty --to-schema-datamodel /tmp/live.prisma --script > prisma/migrations/20260925000000_baseline/migration.sql`
3. Keep `20260925000001_service_call` as the next migration, unchanged.
4. Prove it on a local Postgres, starting from an empty DB:
   - `migrate deploy` applies both migrations cleanly.
   - `migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …` returns an empty migration.
   - The seed runs.
5. Production cut-over, done by Claude on the VPS after the user approves, **before** the push that deploys this code:
   1. Run `pg_dump` into `backups/pre-baseline-<ts>.sql` and copy it off the box.
   2. `DELETE FROM _prisma_migrations;` removes the single stale `init` row.
   3. `prisma migrate resolve --applied 20260925000000_baseline`.
   4. Check with `migrate status`: exactly one pending migration, `20260925000001_service_call`.
   5. Then push. The entrypoint's `migrate deploy` applies only the service-call migration, which is additive (a new enum, a new column with a default, and dropping `NOT NULL`).

   Rollback: restore the dump, then redeploy `eaff6f6`.
6. Add this to `docs/deployment-runbook.md`: from now on, every schema change needs a migration made with `prisma migrate dev`. `db push` is never used against production again.

### R2 (blocker): the Sales Head grant must not run on every start

Remove `grant-sales-head.ts` from both branches of `entrypoint.sh`. Change the script so that it:
- removes **only** a `DEPARTMENT_HEAD` assignment, and only if it still exists;
- never deletes other roles;
- is idempotent.

Claude runs it once on the VPS after the deploy: `docker compose exec app npx tsx prisma/scripts/grant-sales-head.ts`.

`grant-password-reset.ts` may stay in the entrypoint. It is additive only.

### R3: secure password generator

`generateSecurePassword` uses `Math.random`. Switch it to `crypto.getRandomValues`, which works in both the browser and Node 20, and use rejection sampling or a modulo over a `Uint32Array`.

### R4: keep bcrypt out of the client bundle

`users-table.tsx` (a `'use client'` component) imports from `core/auth/password.ts`, which also imports `bcryptjs`. Move `generateSecurePassword` and `passwordIssues` into `core/auth/password-policy.ts`, which has no bcrypt import. `password.ts` re-exports `passwordIssues`, so existing server imports still work.

### R5: company-scope the client lookup

In `getClientPortfolio`, put `companyId: principal.companyId` inside the `findFirst` `where`, alongside the `id`/`refNumber` OR, instead of checking it after the lookup.

### R6: run the integration tests

With Docker Desktop up, run:
- `docker compose -f docker-compose.local.yml up -d db`
- `npx prisma migrate deploy`
- `npm run db:seed`
- `npm run test:int`

All must pass. Paste the output into the summary.

**Commit these as local commits only:** `fix(db): R1 baseline migrations`, `fix(rbac): R2 sales head one-off`, `fix(auth): R3/R4 password generator`, `fix(pm): R5 client lookup scope`. Then hand back to Claude for re-review and the production cut-over.

## 12. Sales Head sees everything a Technical Head sees, read-only

**Client, 2026-09-25:** Dharmesh "should see everything, same as Technical Head but no edit".

**Live state (checked 2026-09-25):** `grant-sales-head.ts` has **not** been run on production yet. He still holds only `DEPARTMENT_HEAD` (DEPARTMENT scope), which is why he sees just the People menu. The `SALES_HEAD` role exists in production with its 5 read keys. Once the script runs, he gets Dashboard, Projects, Clients and Team load.

**Gap:** Technical Head also sees **Site Commissioning** and **Checklists**. Both pages are gated on write keys (`pm.commissioning.manage` in `pm/commissioning/page.tsx`, and `pm.template.manage` in `pm/templates/page.tsx`), so a read-only role can never open them. Approvals, Requests, My work and Urgent task are action queues. They stay hidden for a view-only user, because there is nothing to act on.

**Approach:**
1. Add two keys in `permissions.ts`:
   - `pm.commissioning.read` ("View site commissioning status and logs");
   - `pm.template.read` ("View master checklist templates").

   Grant them to SALES_HEAD, and also to TECHNICAL_HEAD, SERVICE_HEAD and DIRECTOR so nothing changes for them. SUPER_ADMIN gets them automatically through `ALL_PERMISSIONS`.
2. Sidebar: Site Commissioning and Checklists require the `.read` key.
3. Pages: gate on `read || manage`. Pass `canManage` to the client components and hide every action when it is false: assign engineer, close commissioning, approve or reject logs, and create, edit or delete templates.
4. Services: listing and read functions assert the `.read` key (or accept manage), and every mutating service keeps asserting the write key. **The server is the real guard, not the hidden buttons.**
5. Project and task pages: check that each write control (Handover Project, Put on hold, Add urgent task, Cancel, Delete, Add task, team panel edits, progress forms) is hidden when the viewer lacks the key. Any control that shows for SALES_HEAD is a bug.
6. Add a sync script, `grant-read-permissions.ts`, that is additive and idempotent (upsert only), and put it in `entrypoint.sh` after `grant-password-reset.ts`.
7. Tests:
   - Unit: SALES_HEAD still holds no mutating key.
   - Integration: SALES_HEAD can list commissioning and templates, and gets 403 on assign, approve, close, and template create, update and delete.
   - Browser (the user checks): log in as Dharmesh and see Dashboard, Projects, Clients, Site Commissioning, Team load and Checklists, with no edit buttons anywhere.

**Order:** do this next, as its own local commit, `feat(rbac): #12 read-only commissioning and checklists`.

## Order

0. #0 A–C: CI gate, integration test setup, migrate deploy. **Nothing ships before this.**
1. #3: delete the dummy data (5 minutes, no deploy).
2. #8: Director password reset, then the #0 E cutover in the following release.
3. #2: Sales Head.
4. #5 and #11: timeline labels overlap, and client name on the portfolio cards.
5. #9 and #10: People and Audit cleanup. This is UI only; ship it together with #8.
6. #6: Clients menu.
7. #1: service call (confirm the open question first).

Parked: #7 (urgent task). #4 was un-parked on 2026-09-26 (PM and Assistant PM assignees).

## Side note

The `logins.csv` issue is now covered by #0 E.
