# 007 — Delivery date per panel

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
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
- [ ] 1. **Tests first:**
  - Integration test: creating a project with PLC Panel 1 due before the target stores that date on the `PHASE` row, and all its steps end on or before it.
  - A panel date after the target, or before the start, is rejected with a message naming the panel.
  - A PM's `updateTask` on a `PHASE` row's `plannedEnd` is refused.
  - Unit test the lane Late rule.
- [ ] 2. Schema input + server validation + `PHASE` date + per-panel planning.
- [ ] 3. Wizard: per-panel date inputs and per-panel step plans.
- [ ] 4. Timeline: lane delivery date + Late.
- [ ] 5. `updateTask` `PHASE` guard.
- [ ] 6. Full suite; record counts. Open an existing production-copy project and confirm its panels show the project target date and nothing else changed.

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [ ] New project form has a delivery date per panel (PLC, SCADA and HMI), defaulting to the target date; dates after the target or before the start are refused.
- [ ] Each panel's steps are planned to finish by its own date.
- [ ] Project timeline shows each panel's delivery date; a panel past it (or forecast past it) with open steps shows Late.
- [ ] Existing projects look unchanged (panel date = project target).
- [ ] PMs cannot change a panel date through task edits.

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups>
