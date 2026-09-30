# 008 — Edit project and client details (Director / Head only)

**Status:** DONE   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity
**Depends on:** 004 (audit wording), 005 (shared project code), 007 (panel dates on `PHASE` rows)

## Goal
Client request 2026-09-29, item 9. Directors and Heads can correct a project's details and a client's details after creation. **PMs cannot.** Every edit is audited.

**Project fields editable:**
- client
- project code (pick or type, as in 005)
- WO number
- end user
- application
- start date and target delivery date
- priority
- each panel's delivery date (from 007)

**Not editable here:**
- the PM (use "Handover Project")
- adding or removing panels (that would rebuild the step list)
- status (existing buttons: hold, cancel, complete)

**Client fields editable:** name and reference number.

**Validation:**
- WO: digits only and unique (existing messages).
- Target delivery ≥ start.
- Every panel date between start and target. Moving the target before a panel date is refused, naming the panel.
- Client reference number: format `ACS-XXXX` and unique per company. The DB already enforces this (`@@unique([companyId, refNumber])`); the form must show "Reference number ACS-0004 is already used by <client name>." instead of a server error. The same applies to a duplicate client name.

**Who.** Gate on `pm.project.create`, held by Director, Technical Head, Service Head and Super Admin, and not by PMs or Assistant Managers (`src/core/rbac/permissions.ts`). This means no new permission key and no SQL migration.

**Found while auditing.** `updateProject` is gated on `pm.project.update`, which **PMs hold**. Its only caller is `PATCH /api/pm/projects/[id]`, so a PM can edit project details through the API today. This plan moves that gate to `pm.project.create`, closing the hole.

**Client renames.** `Project.clientName` is a copy of the client's name. Renaming a client must update `clientName` on all its projects in the same transaction.

## Affected code
- `src/modules/project-management/services/project.service.ts`, `updateProject`:
  - Gate becomes `assertCan(principal, 'pm.project.create', { departmentId })`, matching `createProject`.
  - Accept `code`, `workOrderNo` and panel dates. Panel dates are written to each `PHASE` task's `plannedEnd`, in the same transaction.
  - When `clientId` changes, set `clientName` from that client.
  - Validation as above.
  - One `project.updated` audit entry whose diff includes panel date changes (e.g. `"PLC Panel 1 delivery": { from, to }`).
- `src/modules/project-management/validation/schemas.ts`: `updateProjectSchema` currently omits `code`; allow it, and add panel dates.
- `src/modules/project-management/services/client.service.ts`: new `updateClient(principal, id, { name, refNumber })`, next to `createClient` and reusing its checks. Gate `pm.project.create`; audit `client.updated`; cascade `clientName`.
- `src/app/actions/pm.ts`: server actions for both edits (existing pattern: `createClientAction`).
- UI:
  - An **Edit details** button on the project page header (`src/app/(shell)/pm/projects/[id]/page.tsx`), shown only when the principal can `pm.project.create`. It opens a form with the fields above.
  - An **Edit** action on the client page (`src/app/(shell)/pm/clients/[id]/page.tsx`).
  - Reuse existing modal and form components; no new dependency.
- `src/app/api/pm/projects/[id]/route.ts` inherits the tighter gate through `updateProject`.

**Blast radius** (code-review-graph, 2026-09-29, graph at `65066d3`):
- `callers_of updateProject`: only `src/app/api/pm/projects/[id]/route.ts`.
- blast radius of `client.service.ts`, `src/app/actions/pm.ts` and the project API route: "high", 131 files within 2 hops, key entities `handleSelectProject`, `handleAssign`, `handleCloseCommissioning`, `handleRelease`, `handleQuickStatus`. `actions/pm.ts` is a hub; only new exports are added there.
- Run `callers_of createClient`, `getClientById`, `listClients` and `importers_of client.service.ts` before editing; record the results.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`.
- No schema or permission migration. The gate reuses `pm.project.create`.
- Editing never deletes data. Changing a client, code or WO does not touch tasks, and changing dates does not re-plan steps.
- Old project codes keep the old client reference number when a client's reference number changes (user decision 2026-09-29).
- Do not change the Handover, Hold, Cancel or Complete flows.
- UI copy per `ux-writing`, form layout per `impeccable`.

## Tools & skills (implementer: follow these)
- **Setup:** point Token Savior at this project and update the code-review-graph; load `ponytail` (full) and the skills below.
- **Look before you change:** use the graph for callers and blast radius, and Token Savior to read code by symbol rather than whole files. If the graph can't find something, use text search and say so in notes.
- **Check first (graph):** callers of `updateProject`, `createClient`, `getClientById`; importers of `src/modules/project-management/services/client.service.ts`; blast radius of `project.service.ts` and `client.service.ts`; affected flows for the project page.
- **Read (Token Savior):** `updateProject`, `createClient`, `createProject`, `assertCan`; find `updateProjectSchema`, `createClientAction`.
- **sequential-thinking:** required for step 2 (the order of validation and writes inside one transaction: project row, `PHASE` rows, audit).
- **Skills:** `ponytail` (full) · `tdd` · `impeccable` + `ux-writing` · `review-delta` (before DONE).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int`. Run the full suite and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [x] 1. **Tests first** (integration, per `AGENTS.md`: allow, deny, happy path, validation failure):
  - A Director edits WO, code, dates, priority and one panel date → saved and audited.
  - A PM calling `updateProject` → `ForbiddenError`.
  - A target date before a panel date → refused, naming the panel.
  - A duplicate WO → refused.
  - A Head renames a client → the client's projects show the new `clientName`.
  - A duplicate client reference number or name → friendly message.
  - A PM calling `updateClient` → forbidden.
- [x] 2. `updateProject` changes (gate, fields, panel dates, client name, validation, audit).
- [x] 3. `updateClient`.
- [x] 4. Server actions + Edit details form on the project page + Edit on the client page.
- [x] 5. Full suite; record counts. Check the audit trail shows the edits in plain words (plan 004).

## Acceptance criteria
- [x] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [x] Director/Head sees Edit details on a project and Edit on a client; PM and engineer do not, and the service refuses them.
- [x] Edits save, keep all tasks untouched, and appear in the audit trail in plain words.
- [x] Panel dates cannot end up after the target date; reference numbers and client names cannot be duplicated, with a clear message.
- [x] Renaming a client updates the client name shown on its projects.

## Implementation notes (implementer)
- **Step 1 (TDD Tests First):** Created integration test suite `src/modules/project-management/services/project-edit.int.test.ts` covering all 7 required scenarios:
  1. Director edits WO, code, dates, priority, panel dates -> saved and audited.
  2. PM calling `updateProject` -> `ForbiddenError`.
  3. Moving target date before a panel date -> refused with message naming the panel.
  4. Refuses duplicate `workOrderNo` on `updateProject`.
  5. Technical Head renames client -> cascades new `clientName` to projects and audits `client.updated`.
  6. Friendly error when duplicate reference number is used ("Reference number ACS-XXXX is already used by <client name>.").
  7. PM calling `updateClient` -> `ForbiddenError`.
- **Step 2 (`updateProject` service & schema):**
  - Updated `updateProjectSchema` in `src/modules/project-management/validation/schemas.ts` to allow `code` and add `panelDeliveryDates: z.record(z.string(), dateString).optional()`.
  - In `src/modules/project-management/services/project.service.ts`:
    - Moved gate from `pm.project.update` to `assertCan(principal, 'pm.project.create', { departmentId })` closing security gap.
    - Added `code` and `workOrderNo` validation (digits only, duplicate check with friendly error).
    - Added `clientId` lookups updating `clientName`.
    - Validated start/target dates (`target >= start`) and panel dates (`start <= panelDate <= targetEnd`), with clear error naming the panel if violated.
    - Updated `PHASE` task `plannedEnd` dates in transaction and added panel changes to `project.updated` audit diff (`"${phaseTask.title} delivery": { from, to }`).
- **Step 3 (`updateClient` service):**
  - Added `updateClient` in `src/modules/project-management/services/client.service.ts` gated on `pm.project.create`.
  - Reused validation from `createClient` (name min 2 chars, refNumber `ACS-XXXX`), checking duplicates with friendly error message including other client's name.
  - Cascaded `clientName` update to all projects belonging to the client in the same transaction.
  - Recorded `client.updated` audit entry.
- **Step 4 (Server Actions & UI):**
  - Exported `updateProjectAction` and `updateClientAction` in `src/app/actions/pm.ts`.
  - Created `EditClientButton` (`src/app/(shell)/pm/clients/[id]/edit-client-button.tsx`) and mounted in `src/app/(shell)/pm/clients/[id]/page.tsx` when user has `pm.project.create`.
  - Created `EditProjectDetailsButton` (`src/app/(shell)/pm/projects/[id]/edit-project-details-button.tsx`) with client selector, pick-or-type project code datalist, digits-only WO, end user, application, dates, priority, and per-panel date inputs.
  - Mounted in `src/app/(shell)/pm/projects/[id]/page.tsx` header actions when user has `pm.project.create`.
- **Step 5 (Audit formatting & Verification):**
  - Updated `src/modules/admin/domain/audit-format.ts` to format `pm.client.created`, `pm.client.updated`, and `Client` items in plain words.
  - Checked audit trail diff formatting; transition objects `{ from, to }` format cleanly as `key: from → to`.
- **Tools & Skills Used:**
  - `code-review-graph`: `query_graph_tool` (callers_of updateProject, importers_of client.service.ts), `get_impact_radius_tool`.
  - `token-savior`: symbol search and inspection.
  - `sequential-thinking`: transaction ordering and atomic updates.
  - `ponytail` (full): Minimal changes, reused existing UI components and stdlib date helpers without new dependencies.
  - `tdd`: Red-to-green test-driven development.
  - `ux-writing` & `impeccable`: Accessible modals, responsive grid form, clear error feedback.
  - `review-delta`: Checked diff and blast radius.
- **Follow-ups (2026-09-30):**
  - **F1 (Status not editable):** Omitted `status` and `kind` from `updateProjectSchema`. Removed status update, `actualEndDate`, and `PROJECT_STATUS_CHANGED` event publishing from `updateProject`. Added integration test in `project-edit.int.test.ts` verifying that passing `status` in input changes nothing.
  - **F2 (Page gate alignment):** Aligned `canEditProjectDetails` in `src/app/(shell)/pm/projects/[id]/page.tsx` with the service gate by checking `can(principal, 'pm.project.create', { departmentId: departmentId ?? undefined })` and removing the `hasPermissionAnywhere` fallback.
  - **F3 (Action error handling):** Updated `updateProjectAction` and `updateClientAction` in `src/app/actions/pm.ts` to use `toState(error).error` so Zod validation issues and domain errors format cleanly for users.
  - **Nit (`as unknown as` elimination):** Passed `{ name: before.name, refNumber: before.refNumber }` to `diffOf` in `updateClient` and typed `beforeData` in `updateProject`, removing all `as unknown as` assertions.
- **Test suite results:**
  - `npm run typecheck`: 0 errors.
  - `npm test`: 12 test files passed, 140 tests passed.
  - `npm run test:int`: 12 test files passed, 54 tests passed (including 8 tests in `project-edit.int.test.ts`).
  - `npm run build`: Succeeded (Next.js 16.3.5 client & server bundles generated cleanly).

## Review (Claude)
**2026-09-30, commit `3b59442`. Verdict: the core works and matches the plan. Three small follow-ups before REVIEWED.**

**Checked:**
- Re-ran: `npm run typecheck` clean · `npm test` 12 files / 140 passed · `npm run test:int` 12 files / 53 passed · `npm run build` clean.
- Graph: `callers_of updateProject` = `src/app/api/pm/projects/[id]/route.ts`, `updateProjectAction` and the new int tests. The PM hole is closed: the gate is now `pm.project.create` at the project's department. Blast radius vs `ab7edbd`: high, 12 files changed, 133 files within 2 hops (key: `AuditPage`, `DashboardPage`, `handleSelectProject`, `handleAssign`, `handleCloseCommissioning`). Expected: `actions/pm.ts` and `project.service.ts` are hubs, and only new exports were added to `actions/pm.ts`.
- Panel dates: each `PHASE` row is checked against the new start/target, and moving the target before a panel date is refused, naming the panel. Changed panel dates are written in the same transaction and appear in the audit diff as `"PLC Panel 1 delivery": { from, to }`. Steps are not re-planned. ✓
- `updateClient`: company-scoped lookup, friendly duplicate messages, `clientName` cascades to the client's projects in the same transaction, `client.updated` audited and shown in plain words. Project codes are untouched. ✓

**Follow-ups (implementer):**
- [x] **F1 — Status must not be editable here.** `updateProjectSchema` is `baseProjectSchema.partial()` minus four fields, so it still accepts `status` (and `kind`), and `updateProject` still writes `status`, sets `actualEndDate` and publishes `PROJECT_STATUS_CHANGED`. A Director/Head can therefore change status through `updateProjectAction` or `PATCH /api/pm/projects/[id]`, bypassing Hold / Cancel / Complete. The plan says status is not editable here. Omit `status` and `kind` from `updateProjectSchema`, drop `status` from the `data` written by `updateProject` (along with the now-dead status branch there, if nothing else needs it; check with the graph), and add an int test showing a `status` in the input changes nothing.
- [x] **F2 — The page must show Edit details only to people the service lets save.** `page.tsx` shows the button when `can(principal, 'pm.project.create', { departmentId: project.departmentId })` **or** `hasPermissionAnywhere(...)`. The service checks only the department (`project.departmentId ?? principal.departmentId`). Heads are department-scoped (Technical Head: TECH + DESIGN; Service Head: TECH), so a Head sees the button on another department's project, and saving fails with "forbidden". Use the same department rule on the page as in the service, and drop the `hasPermissionAnywhere` fallback.
- [x] **F3 — Friendly errors from the two new actions.** `updateProjectAction` and `updateClientAction` return `err.message` raw. A Zod failure becomes a JSON blob in the form, and an unexpected Prisma error leaks its internals. Use the existing `toState` helper in `src/core/utils/actions.ts`, which formats Zod issues and passes only client-safe errors.
- [x] Nit (`AGENTS.md`: no `as unknown as`): `updateClient` adds `diffOf(before as unknown as Record<string, unknown>, …)`. Pass `{ name: before.name, refNumber: before.refNumber }` instead.

