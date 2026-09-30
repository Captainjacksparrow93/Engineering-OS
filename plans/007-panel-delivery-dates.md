# 007 — Delivery date per panel

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity
**Depends on:** 004 (timeline header changes). Must land before 008, whose edit screen edits these dates.

## Goal
Client request 2026-09-29, item 3. Each panel (PLC, SCADA and HMI; the panel as a whole, not its steps) gets its own **delivery date**.

**Rules:**
- The date is entered on the New project form.
- It defaults to the project's target delivery date.
- It can never be later than the project's target delivery date, nor before the start date.
- A panel past its delivery date, or forecast to finish after it, shows as **Late**.

**Where to store it: the panel's existing `PHASE` task `plannedEnd`. No schema change.**
- Each panel is already a `PHASE` task ("PLC Panel 1") created in `createAutomationProject` with `plannedEnd: targetEnd`. Existing projects therefore already carry panel date = project target date, and nothing needs backfilling.
- Nothing else writes `plannedEnd` on `PHASE` tasks. Text search 2026-09-29: the only writers are `createAutomationProject`, `createTask` and the generic `updateTask`. `recomputeTaskDerivedState` only touches `status` and `percentComplete`.
- Forecast, overdue and progress logic already ignore `PHASE` rows (`forecastFinish` is fed leaf steps; `dashboard.service.ts` filters `type !== 'PHASE'`), so using the field changes no existing number.

**Scheduling.** Today every panel's 13 steps are planned across the whole project window:
- **Server:** `planLaneByHours(stepHoursList, start, workingDaysBetween(start, targetEnd))`.
- **Wizard:** `stepPlanMap` in `automation-project-wizard.tsx` is keyed `${templateCode}_${stepNumber}`, so it is the same for every unit.

With panel dates, each panel's steps are planned inside **start → that panel's delivery date**. The wizard's plan therefore becomes per panel (`panelKey`), not per template.

## Affected code
- `automation-project-wizard.tsx`:
  - Step 3: one date input per panel (default = target date; `min` = start, `max` = target).
  - `stepPlanMap` becomes per panel; the minimum-days warning ("Min required …") is checked per panel.
  - Send `deliveryDate` per panel in the payload.
- `src/modules/project-management/validation/schemas.ts`: automation-project input accepts an optional per-panel delivery date keyed by `templateCode` + `unitIndex`.
- `automation-project.service.ts`, `createAutomationProject`:
  - Validate each panel date (start ≤ date ≤ target; error names the panel, e.g. "PLC Panel 2 delivery date is after the project target date.").
  - Set the `PHASE` task `plannedEnd` to it.
  - Plan that panel's steps within its window.
- `project.service.ts`, `getProjectTimeline`:
  - Each lane gets `deliveryDate` (phase `plannedEnd`, falling back to project `targetEndDate`) and `isLate`.
  - `isLate` is true when the lane has open steps and either today is past the delivery date or the lane's forecast (`forecastFinish` fed only that lane's leaf steps and its delivery date) is after it.
- `src/components/project-timeline.tsx`: show each lane's delivery date (marker or label on the lane) and a Late badge when `isLate`.
- `task.service.ts`, `updateTask`: refuse `plannedStart`/`plannedEnd` changes on `PHASE` tasks, so PMs (who hold `pm.task.update`) cannot move a panel date. Plan 008's edit screen is the only way to change it.

**Blast radius** (code-review-graph, 2026-09-29, graph at `65066d3`):
- `callers_of createAutomationProject`: `createAutomationProjectAction`, `createServiceCallAction` (service calls send no scopes, so no panels; unaffected), `makeProject` (script removed by plan 003).
- `callers_of getProjectTimeline`: `getProjectTimelineAction`, `ProjectPage`, `DashboardPage`.
- blast radius of the service, wizard and page: "high", 132 files within 2 hops, key entities `ProjectsPage`, `createAutomationProjectAction`, `createServiceCallAction`, `autoAssignAutomationTeamAction`.
- Run `callers_of updateTask` before adding the `PHASE` guard; record the result.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`.
- No schema change. If you find a reason the `PHASE` `plannedEnd` cannot hold this (a writer this plan missed), **stop** and note it in Implementation notes instead of adding a column.
- Changing a panel date later does not re-plan existing steps. Steps keep their dates; the lane simply shows Late if they run past it.
- Project-level health on the dashboard is unchanged. Late is shown per panel on the timeline.
- UI copy per `ux-writing`, layout per `impeccable`.

## Tools & skills (implementer: follow these)
- **Setup:** point Token Savior at this project and update the code-review-graph; load `ponytail` (full) and the skills below.
- **Look before you change:** use the graph for callers and blast radius, and Token Savior to read code by symbol rather than whole files. If the graph can't find something, use text search and say so in notes.
- **Check first (graph):** callers of `createAutomationProject`, `getProjectTimeline`, `updateTask`, `planLaneByHours`, `forecastFinish`; blast radius of `automation-project.service.ts` and `project.service.ts`; affected flows for the wizard and service.
- **Read (Token Savior):** `createAutomationProject`, `getProjectTimeline`, `forecastFinish`, `planLaneByHours`, `updateTask`. In the wizard, search `stepPlanMap`, `panelKey` and `Min required`; do not read the whole file.
- **sequential-thinking:** required for step 3 (per-panel planning in the wizard and server must produce the same dates) and step 4 (the lane Late rule).
- **Skills:** `ponytail` (full) · `tdd` · `impeccable` + `ux-writing` · `review-delta` (before DONE).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int`. Run the full suite and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [x] 1. **Tests first:**
  - Integration test: creating a project with PLC Panel 1 due before the target stores that date on the `PHASE` row, and all its steps end on or before it.
  - A panel date after the target, or before the start, is rejected with a message naming the panel.
  - A PM's `updateTask` on a `PHASE` row's `plannedEnd` is refused.
  - Unit test the lane Late rule.
- [x] 2. Schema input + server validation + `PHASE` date + per-panel planning.
- [x] 3. Wizard: per-panel date inputs and per-panel step plans.
- [x] 4. Timeline: lane delivery date + Late. While there, fold the three copies of the step-mapping object in `getProjectTimeline` into one mapper and let TypeScript infer the lane type (left over from plan 004).
- [x] 5. `updateTask` `PHASE` guard.
- [ ] 6. Full suite; record counts. Open an existing production-copy project and confirm its panels show the project target date and nothing else changed.

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [x] New project form has a delivery date per panel (PLC, SCADA and HMI), defaulting to the target date; dates after the target or before the start are refused.
- [x] Each panel's steps are planned to finish by its own date.
- [x] Project timeline shows each panel's delivery date; a panel past it (or forecast past it) with open steps shows Late.
- [x] Existing projects look unchanged (panel date = project target).
- [x] PMs cannot change a panel date through task edits.

## Implementation notes (implementer)
- **Status at sign-off:** IN PROGRESS (Steps 1–5 complete, unit tests & build passing; local Postgres offline so `npm run test:int` pending container start).
- **Work completed:**
  - Step 1:
    - Added unit test suite for `isLaneLate` in `src/modules/project-management/domain/portfolio.test.ts` (all 5 test scenarios).
    - Created integration test suite `src/modules/project-management/services/panel-delivery-dates.int.test.ts`.
    - Added schema test for `panelDeliveryDates` in `src/modules/project-management/validation/schemas.test.ts`.
  - Step 2:
    - Added optional `panelDeliveryDates: z.record(z.string(), z.string()).optional()` to `createAutomationProjectSchema` in `src/modules/project-management/validation/schemas.ts`.
    - Added `panelDeliveryDates?: Record<string, string>` to `CreateAutomationProjectInput` interface in `automation-project.service.ts`.
    - Added pre-transaction validation in `createAutomationProject` ensuring `start <= panelDeliveryDate <= targetEnd` with errors naming the panel (`${panelTitle} delivery date is after the project target date.` and `${panelTitle} delivery date is before the project start date.`).
    - Stored `panelDeliveryDate` on the `PHASE` task `plannedEnd` and planned lane steps within `workingDaysBetween(start, panelDeliveryDate)`.
  - Step 3:
    - Added `panelDeliveryDates` state in `automation-project-wizard.tsx`.
    - Made `stepPlanMap` per-panel using each panel's delivery date.
    - Updated auto-assignment and submit tasks payload to look up step plans by panel key.
    - Added date input per panel in Step 3 constrained by `min={startDate}` and `max={targetEndDate}`, defaulting to `targetEndDate`.
    - Added per-panel minimum required working days check and warning ("Min required: X working days (finishes Y)").
    - Included `panelDeliveryDates` in payload sent to `createAutomationProjectAction`.
  - Step 4:
    - Implemented `isLaneLate` in `src/modules/project-management/domain/portfolio.ts`.
    - Folded triplicate step mapper in `getProjectTimeline` (`src/modules/project-management/services/project.service.ts`) into single `mapStep` and let TypeScript infer lane type.
    - Attached `deliveryDate` and `isLate` to each timeline lane.
    - Updated `src/components/project-timeline.tsx` to render `Due <date>`, a `Late` badge on late lanes, and a dashed vertical delivery marker line on the lane track.
  - Step 5:
    - Added guard in `updateTask` (`src/modules/project-management/services/task.service.ts`) throwing `DomainError` if `plannedStart` or `plannedEnd` is supplied for a `PHASE` task.
- **Verification & Test Counts:**
  - `npm run typecheck`: Passed (0 errors)
  - `npm test`: Passed (12 files, 139 passed)
  - `npm run build`: Passed (clean production build)
  - `npm run test:int`: Docker Desktop service is stopped on this host, preventing container start at `localhost:5432`. Once Docker Desktop is launched by the user, `npm run test:int` can run against the local Postgres.

## Review (Claude)
**2026-09-30, commits `7833722` + `aca0f76`. Verdict: code matches the plan and is sound, but it is not REVIEWED yet. Step 6 and the integration run are still open, and F1 + F2 need fixing.**

**Checked:**
- Diff of both commits against the plan. Storage is on the `PHASE` `plannedEnd` with no schema change. The server validates each panel date and names the panel. Wizard and server plan each panel with the same `planLaneByHours(…, workingDaysBetween(start, panelDate))`, so their dates agree. Auto-assign windows now follow the per-panel step dates.
- `getProjectTimeline`: the mapper was folded into `mapStep`, and each lane gets `deliveryDate` + `isLate`.
- `isLaneLate` matches the rule: open steps AND (today past the date OR the lane's forecast past it).
- Graph: `callers_of updateTask` returns only `src/app/api/pm/tasks/[id]/route.ts` (PATCH) plus the new int test. No UI edits task dates, so the `PHASE` guard blocks nothing legitimate. Blast radius vs `8657f32`: high, 13 files changed, 129 files within 2 hops (key: `DashboardPage`, `ShellLayout`, `ApprovalsPage`, `MyWorkPage`, `ProjectPage`). Expected, because `project.service.ts` and `task.service.ts` are hubs.
- Re-ran here: `npm run typecheck` clean · `npm test` 12 files / 139 passed · `npm run build` clean. `npm run test:int` **not run** (no Docker on the review host either).

**Follow-ups (implementer):**
- [ ] **F1 — Validate panel dates at the boundary.** `panelDeliveryDates: z.record(z.string(), z.string())` accepts any string. `new Date('garbage')` is `NaN`, both `<`/`>` checks in `createAutomationProject` are false, so validation passes and Prisma then fails on an Invalid Date (500 instead of a clear error). Make the value a `YYYY-MM-DD` date string in `createAutomationProjectSchema` and add a schema test with a bad value.
- [ ] **F2 — Server must enforce "steps end by the panel date".** `createAutomationProject` uses the client's `draft.plannedEnd` when present and only falls back to `lanePlan`. The acceptance "each panel's steps finish by its own date" therefore holds only through the wizard. Refuse a task draft whose `plannedEnd` is after its panel's delivery date (message names the panel), with an integration test.
- [ ] **Step 6 — Existing data.** On the local production copy, confirm each panel shows the project target date. Also run `SELECT p.code, t.title, t."plannedEnd", p."targetEndDate" FROM pm_tasks t JOIN pm_projects p ON p.id = t."projectId" WHERE t.type = 'PHASE' AND t."plannedEnd"::date <> p."targetEndDate"::date;` and paste the result. Any rows are projects whose target was edited after creation: their panels now show the old date and may show Late.
- [ ] Run `npm run test:int` (start Docker Desktop, then `docker compose -f docker-compose.local.yml up -d`) and paste the counts.
- Nit (optional, `ux-writing`): "Panel dates cannot be modified directly." → "Panel delivery dates can't be changed from a task."

**Carry into plan 008:** `updateProject` can move `targetEndDate`, but panel dates don't follow it. If the target moves earlier than a panel date, that panel breaks the "never after the target" rule. 008's edit screen must refuse or clamp this, and say which.
