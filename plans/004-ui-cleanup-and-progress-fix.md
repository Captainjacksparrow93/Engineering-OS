# 004 — UI cleanup: project code, fewer repeats, plain audit text, one progress number

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity

## Goal
Client requests of 2026-09-29 (items 4, 5, 6, 7, 8, 10) plus a progress bug found while auditing them. Display and read-only logic only; no schema change.

1. **One progress number per project (bug).** WO 6924 shows three numbers: the Projects card says **28/32 steps · 45%**, the project timeline says **28 of 30 steps**, and the dashboard says **90% done**. Cause, in `listProjects` (`src/modules/project-management/services/project.service.ts`):
   - It counts every task row, including the 2 `PHASE` rows (the panel containers "PLC Panel 1", "SCADA Panel 1") and `CANCELLED` tasks, which gives 32 instead of 30.
   - It weights progress by `estimatedHours` over all rows. Each `PHASE` row carries the whole panel's hours (`automation-project.service.ts`, the phase task is created with `estimatedHours: panelHours`) and is never COMPLETED, so the hours are counted twice and the percentage roughly halves (45% instead of 90%).
   - The dashboard (`dashboard.service.ts`) and the workspace already use `projectProgress()` in `src/modules/project-management/domain/portfolio.ts` (leaf, non-cancelled steps). The timeline (`getProjectTimeline`) counts leaf, non-cancelled steps.
   - `getProjectWorkspace` has the same counting problem: `summary.taskCount`, `openCount`, `completedCount` and `overdueCount` count every task row, `PHASE` rows included. Its `progressPercent` already uses `projectProgress`.
   - **Rule:** a "step" is a leaf, non-cancelled task, the same definition `projectProgress` uses. Every step count and progress % must follow it.
2. **Project code shown next to the WO (item 4).** Where a project is named, show its project code (`Project.code`, e.g. `ACS-0004-0001`) together with the WO number.
3. **Stop repeating the WO (item 5).** On the project page, "WO 6924" appears four times: breadcrumb, `<h1>` title (`project.name` is literally "WO 6924"), the grey mono tag in the subtitle, and the timeline card header. Target:
   - **Title:** the project code.
   - **Subtitle:** client · WO 6924 · status · priority. Service calls keep the SERVICE CALL badge in place of the WO.
   - **Breadcrumb:** Projects / project code.
   - **Timeline card header (project page):** no project name. Keep "PM: … · 28 of 30 steps done".
   - On the Projects list card: title = project code; second line = "WO 6924 · client".
4. **Dashboard stat cards (item 6).** Director dashboard tiles show a card inside a card. Each tile is a `card` `<Link>` wrapping `<Stat>`, and `.stat` (`src/app/globals.css`) has its own border. Make each tile a single bordered box. Do not add a "Total projects" tile (the user declined it).
5. **Live projects table (item 7).** In `director-dashboard.tsx` the first column shows `p.name` ("WO 6924") above the client, and the Work Order column repeats it. Show the **project code** above the client, and name the column header "Project & client". Keep the Work Order column as is.
6. **Remove descriptive filler text (item 8).** Remove explanatory sentences that repeat what the screen already shows, for example:
   - "Creates an urgent service call project in the client's name without waiting for a Work Order." (`service-call-modal.tsx`)
   - "Create project directly in client's name without waiting for a Work Order." and "Enter the Work Order No., select customer client, and schedule milestone dates." (`automation-project-wizard.tsx`)
   - The `hint=` lines on the director dashboard tiles ("In progress execution", "Finished switchgear projects", "Planning and draft stages", "Steps in review or flagged", etc.)
   - Page `subtitle=` sentences like "Technical department operations, delivery tracking and capacity oversight." and the New project page subtitle.

   **Keep:** field rules the user must follow ("Digits only, unique across all projects."), empty-state messages, error messages, and confirmation dialogs that warn about consequences (delete, cancel, hold).
7. **Audit trail in plain words (item 10).** `formatAuditDetails` in `src/modules/admin/domain/audit-format.ts` falls back to `JSON.stringify` for nested values, so a status change shows as `status: {"to":"COMPLETED","from":"IN_REVIEW"}`. Target:
   - Any `{ from, to }` value reads as **Status: In review → Completed**, with enum values turned into sentence case.
   - Nothing in the Details column shows JSON or raw IDs.
   - The Item column names the thing: **Task: DI Mapping · WO 6924**, **Project: ACS-0004-0001 · WO 6924**. `formatAuditItem` already receives `nameMap`. The audit page (`src/app/(shell)/admin/audit/page.tsx`) already loads all tasks and projects; extend those selects to include the project's code and WO.

## Affected code
- `src/modules/project-management/services/project.service.ts`
  - `listProjects`: step counts and `progressPercent`. It needs task rows (`id, parentId, type, status, estimatedHours, percentComplete`) instead of the `groupBy`, so it can use `projectProgress`.
  - `getProjectWorkspace`: summary counts.
- `src/modules/project-management/domain/portfolio.ts`: `projectProgress` is the rule. Add a sibling step-count helper only if both call sites need it; do not duplicate the leaf filter inline twice.
- `src/modules/project-management/domain/project-label.ts`: `projectLabel` (add the code).
- `src/app/(shell)/pm/projects/[id]/page.tsx`: `PageHeader` title, breadcrumb and subtitle.
- `src/components/project-timeline.tsx`: header `<h3>{data.projectName}</h3>`.
- `src/app/(shell)/pm/projects/projects-client.tsx`: project card.
- `src/app/(shell)/dashboard/director-dashboard.tsx`: tiles, table first column, hints.
- `src/app/(shell)/pm/projects/service-call-modal.tsx`, `src/app/(shell)/pm/projects/new/automation-project-wizard.tsx`, `src/app/(shell)/pm/projects/new/page.tsx`, plus other page subtitles found by the inventory in step 5.
- `src/modules/admin/domain/audit-format.ts`: `formatAuditDetails` and `formatAuditItem`. Tests are in `audit-format.test.ts`.
- `src/app/(shell)/admin/audit/page.tsx`: name maps.

**Blast radius** (code-review-graph, 2026-09-29, graph at `65066d3`):
- `callers_of listProjects`: `src/app/api/pm/projects/route.ts` and `ProjectsPage` (`src/app/(shell)/pm/projects/page.tsx`).
- `callers_of getProjectTimeline`: `getProjectTimelineAction` (`src/app/actions/pm.ts`), `ProjectPage`, `DashboardPage`.
- `get_impact_radius_tool` on the 7 main files: "high", 133 files within 2 hops, key entities `DashboardPage`, `PMDashboard`, `TypeCards`, `AddTaskForm`, `CompleteProjectButton`. It is high because `project.service.ts` is a hub; the functions changed here have the few callers listed above.
- `get_affected_flows_tool` on `project.service.ts` + `audit-format.ts`: 0 flows.
- **Graph gap:** `importers_of` returned *not found* for `project-label.ts`, `audit-format.ts` and `project-timeline.tsx`. Text search instead:
  - `projectLabel` is imported by `src/app/(shell)/pm/clients/[id]/page.tsx` and `src/app/(shell)/pm/resources/[userId]/engineer-portfolio.tsx` (plus its test).
  - `audit-format` by `src/app/(shell)/admin/audit/page.tsx` (plus its test).
  - `project-timeline` by `director-dashboard.tsx` and `pm/projects/[id]/page.tsx`.
  - `projectProgress` by `dashboard.service.ts`, `client.service.ts` and `project.service.ts`.

## Constraints
- The app is LIVE. Commit locally only; never push to `main` (a push auto-deploys).
- No schema, migration or permission change in this plan.
- Do not rename or rewrite `Project.name` data. Existing names stay "WO 6924". Only the display changes.
- Keep `projectProgress` semantics unchanged: the dashboard's 90% is the correct number. Fix the other screens to match it.
- UI copy follows `ux-writing`; layout follows `impeccable`. Sentence case, no new explanatory text.

## Tools & skills (implementer: follow these)
- **code-review-graph:**
  - `query_graph_tool` `callers_of` on `listProjects`, `getProjectWorkspace`, `getProjectTimeline`, `projectProgress`, `formatAuditDetails` and `formatAuditItem` before editing each.
  - `get_impact_radius_tool` on `project.service.ts` and `audit-format.ts`.
  - Where the graph returns *not found* (it does for `project-label.ts`, `audit-format.ts` and `project-timeline.tsx`), use text search for importers and note it in Implementation notes.
- **Token Savior:**
  - `get_function_source` for `listProjects`, `getProjectWorkspace`, `projectProgress`, `formatAuditDetails`, `formatAuditItem` and `projectLabel`.
  - `find_symbol` `Stat` (`src/components/ui.tsx`).
  - Do not read the 1,200-line wizard whole; search for the quoted strings.
- **sequential-thinking:** required for step 1 (the step-count and progress rule across `listProjects` and `getProjectWorkspace`), so all three screens agree.
- **Skills:** `ponytail` (full, always) · `tdd` (tests first for steps 1 and 6) · `ux-writing` + `impeccable` (steps 2–5) · `review-delta` (before DONE).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int` (needs the local Postgres from `docker-compose.local.yml`). Run the full suite and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [ ] 1. **Progress fix (TDD).**
  - Write an integration test that creates a project with 2 panels (so 2 `PHASE` rows), completes some steps and cancels one. It asserts that `listProjects` stats, `getProjectWorkspace` summary, `getProjectTimeline` totals and the dashboard's `progressPercent` all report the same step count and the same percentage.
  - See it fail, then fix `listProjects` and `getProjectWorkspace` to count leaf non-cancelled steps and use `projectProgress`.
- [ ] 2. **Project identity.**
  - Extend `projectLabel` to include the project code (update `project-label.test.ts` first).
  - Apply the title, subtitle and breadcrumb target on the project page, the card target on the Projects list, and the header change on the timeline card.
  - The dashboard timeline (with its project selector) may show "project code · WO" once; the project page shows no project name in the timeline header.
- [ ] 3. **Live projects table:** project code above the client in the first column; header "Project & client".
- [ ] 4. **Dashboard tiles:** one border per tile. Fix it in `director-dashboard.tsx`, not in `.stat` globally, because `<Stat>` is also used unwrapped on My Work, Team Load and the project page.
- [ ] 5. **Filler text.**
  - Inventory first with a text search of `src/app` for `subtitle="`, `hint="`, `description=` and muted `<p>` sentences. 25 hits in 15 files as of `65066d3`.
  - Remove per the Goal rule and list every removed string in Implementation notes.
- [ ] 6. **Audit wording (TDD).**
  - Add `audit-format.test.ts` cases for `{ status: { from: 'IN_REVIEW', to: 'COMPLETED' } }` → "Status: In review → Completed", for a priority and a date change, and for the Item labels (task with project, project with code and WO).
  - Then implement. Update the audit page's name maps.
- [ ] 7. Run the full suite; record counts.

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [ ] For any project, the Projects card, project page timeline, project page Progress stat and dashboard row show the same step count and percentage. WO 6924 on production data: 28/30 and about 90%.
- [ ] Project page shows the WO number once (subtitle) and the project code as title and breadcrumb.
- [ ] Projects card and Live projects table show the project code; the WO column is unchanged.
- [ ] Dashboard tiles have a single border; no "Total projects" tile added.
- [ ] Service-call modal, wizard step 1 and dashboard tiles carry no explanatory filler; the removed strings are listed in notes.
- [ ] Audit Details column contains no `{`, `"` or raw IDs for task status, priority, date and reassign entries; the Item column names the task or project.

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups>
