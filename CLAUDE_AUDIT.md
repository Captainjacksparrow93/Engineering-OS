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
  - `approveTaskReview` / `disapproveTaskReview`: replace the custom check with `await assertTaskPermission(principal, taskId, 'pm.progress.review');` (`pm.progress.review` is already in `MANAGER_IMPLIED`, so the project manager keeps access; department heads get it through their DEPARTMENT-scoped grant). Confirm in `src/core/rbac/permissions.ts` that `DEPARTMENT_HEAD` and `DIRECTOR` roles include `pm.progress.review`; add it to their role definitions if missing (and to seed).
  - `completeAutomationProject`: `await assertProjectPermission(principal, projectId, 'pm.project.update');` Keep the sponsor allowance only if the owner wants it — otherwise drop it.
  - Templates: add a permission key, e.g. `pm.template.manage` ("Edit master checklist templates"), in `src/core/rbac/permissions.ts`, grant it to `SUPER_ADMIN`, `DIRECTOR`, `DEPARTMENT_HEAD`; make sure the seed/permission sync picks it up. `assertTemplateAdmin` → `if (!hasPermissionAnywhere(principal, 'pm.template.manage')) throw new ForbiddenError(...)`. The templates page uses the same check for the redirect. Sidebar link visibility (if any) should use the same permission.
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

## Suggested order of work

1. A-1, B-1, B-2, B-3, B-5 (small, high-impact bug fixes)
2. A-2 + A-3 + A-5 together (move all auth into permissions / `access.ts`)
3. A-4, B-7, B-8 (validation and write-path consistency)
4. B-4, B-9, B-10, B-11, B-13
5. C-1, C-2, C-3
6. D-1 … D-5
7. E (design system)
8. F, G

After each step: `npm run typecheck && npm test && npm run build`, then summarize changes for the owner in plain language.
