# 008 — Edit project and client details (Director / Head only)

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
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
- `get_impact_radius_tool` on `client.service.ts`, `src/app/actions/pm.ts` and the project API route: "high", 131 files within 2 hops, key entities `handleSelectProject`, `handleAssign`, `handleCloseCommissioning`, `handleRelease`, `handleQuickStatus`. `actions/pm.ts` is a hub; only new exports are added there.
- Run `callers_of createClient`, `getClientById`, `listClients` and `importers_of client.service.ts` before editing; record the results.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`.
- No schema or permission migration. The gate reuses `pm.project.create`.
- Editing never deletes data. Changing a client, code or WO does not touch tasks, and changing dates does not re-plan steps.
- Old project codes keep the old client reference number when a client's reference number changes (user decision 2026-09-29).
- Do not change the Handover, Hold, Cancel or Complete flows.
- UI copy per `ux-writing`, form layout per `impeccable`.

## Tools & skills (implementer: follow these)
- **Session setup (do these first, in order):**
  1. `mcp__token-savior__switch_project` with `name: "Project management"` (a path-based switch can land on the parent `Downloads` folder).
  2. `mcp__code-review-graph__build_or_update_graph_tool` (incremental, default args). Confirm `head_matches_build: true` in the result.
  3. Load skills with the Skill tool: `ponytail` (full), then the others listed under **Skills** below.
- **How to call the graph:** `mcp__code-review-graph__query_graph_tool` with `pattern` (`callers_of` / `importers_of` / `tests_for`) and `target`.
  - Plain function names work, e.g. `target: "listProjects"`.
  - File targets and some symbols return *not found* with relative paths. Retry with the qualified form `C:\Users\Dhruv-Home\Downloads\projects\ACS\Project management\<path>::<symbol>`. If that still fails, use a text search and write "graph not_found → text search" in Implementation notes.
  - `mcp__code-review-graph__get_impact_radius_tool` takes `changed_files` (repo-relative paths) and `detail_level: "minimal"`.
  - `mcp__code-review-graph__get_affected_flows_tool` takes the same `changed_files`.
- **How to read code:**
  - `mcp__token-savior__get_function_source` with `name` (or `names`, up to 10).
  - `mcp__token-savior__find_symbol` to locate.
  - `mcp__token-savior__get_full_context` with `depth: 1` when you need dependents.
  - Never `cat` or Read a whole file over 300 lines; search for the quoted string and read that range.
- **sequential-thinking:** `mcp__sequential-thinking__sequentialthinking`. Paste its final conclusion (one or two lines) into Implementation notes for the step that requires it.
- **Paste back:** for every graph call, a one-line result (count plus names) in Implementation notes, so the reviewer can compare with **Affected code** above.
- **code-review-graph:** `query_graph_tool` `callers_of` `updateProject`, `createClient`, `getClientById`; `importers_of` `src/modules/project-management/services/client.service.ts`; `get_impact_radius_tool` on `project.service.ts` and `client.service.ts`; `get_affected_flows_tool` on the project page.
- **Token Savior:** `get_function_source` `updateProject`, `createClient`, `createProject`, `assertCan`; `find_symbol` `updateProjectSchema`, `createClientAction`.
- **sequential-thinking:** required for step 2 (the order of validation and writes inside one transaction: project row, `PHASE` rows, audit).
- **Skills:** `ponytail` (full) · `tdd` · `impeccable` + `ux-writing` · `review-delta` (before DONE).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int`. Run the full suite and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [ ] 1. **Tests first** (integration, per `AGENTS.md`: allow, deny, happy path, validation failure):
  - A Director edits WO, code, dates, priority and one panel date → saved and audited.
  - A PM calling `updateProject` → `ForbiddenError`.
  - A target date before a panel date → refused, naming the panel.
  - A duplicate WO → refused.
  - A Head renames a client → the client's projects show the new `clientName`.
  - A duplicate client reference number or name → friendly message.
  - A PM calling `updateClient` → forbidden.
- [ ] 2. `updateProject` changes (gate, fields, panel dates, client name, validation, audit).
- [ ] 3. `updateClient`.
- [ ] 4. Server actions + Edit details form on the project page + Edit on the client page.
- [ ] 5. Full suite; record counts. Check the audit trail shows the edits in plain words (plan 004).

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [ ] Director/Head sees Edit details on a project and Edit on a client; PM and engineer do not, and the service refuses them.
- [ ] Edits save, keep all tasks untouched, and appear in the audit trail in plain words.
- [ ] Panel dates cannot end up after the target date; reference numbers and client names cannot be duplicated, with a clear message.
- [ ] Renaming a client updates the client name shown on its projects.

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups>
