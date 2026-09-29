# 006 — New project: pick engineers from every team, grouped by PM

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity

## Goal
Client request 2026-09-29, item 2. When creating a project, the engineer picker for each panel (PLC, SCADA and HMI) shows only the selected PM's team. It must show **all engineers**, grouped by team, with the **selected PM's team first and marked**. This is the same grouped-list pattern the task reassign picker already uses (`groupEngineersBySquad` in `src/modules/project-management/domain/teams.ts`, rendered as `<optgroup>` in `src/components/assignee-cell.tsx`).

**Today, the filter is in two places:**
- **Client:** `automation-project-wizard.tsx` has `const filterPMTeamOnly = true;` and `candidateEngineers` filters `allEngineers` to `teamsByPM[selectedPMId]`. The per-panel `<select>` renders `candidateEngineers` flat.
- **Server:** `createAutomationProject` (`automation-project.service.ts`) rejects any assignee outside the PM's team: `"Steps can only be assigned to engineers in the selected PM's team."`

**Who approves.** Only Director, Technical Head, Service Head and Super Admin hold `pm.project.create` (`src/core/rbac/permissions.ts`), and all of them hold `pm.oversight`. So the person creating the project *is* the Head, and a cross-team pick at creation needs no separate approval step.

The existing rule stays unchanged: after creation, a PM moving work to another PM's team still goes to `AWAITING_HEAD_APPROVAL` (covered by `pm-assignees.int.test.ts` cases 3–4 and 10).

## Affected code
- `src/app/(shell)/pm/projects/new/automation-project-wizard.tsx`: delete `filterPMTeamOnly`; replace the flat `candidateEngineers` list with groups:
  1. Selected PM's team first, labelled e.g. "Dhrupin Vaghasiya's team (PM)".
  2. Each other PM's team.
  3. "Other engineers" for anyone in no PM team.

  Build the groups from the `teamsByPM`, `managers` and `allEngineers` props the page already passes; no new server query.
- `src/modules/project-management/services/automation-project.service.ts`, `createAutomationProject`: remove the PM-team guard. Keep the "active employee in your company" check.
- Auto-assign (`autoAssignAutomationTeam`) is **unchanged**. It still prefers the PM's squad (`squadSet`); the user can override by hand.

**Blast radius** (code-review-graph, 2026-09-29, graph at `65066d3`):
- `callers_of getPMTeamData`: `NewProjectPage` (`pm/projects/new/page.tsx`), `ProjectsPage` (`pm/projects/page.tsx`, which feeds the service-call modal).
- `callers_of createAutomationProject`: `createAutomationProjectAction`, `createServiceCallAction`, `makeProject` (script removed by plan 003).
- `get_impact_radius_tool` on the service, wizard and page: "high", 132 files within 2 hops, key entities `ProjectsPage`, `createAutomationProjectAction`, `createServiceCallAction`, `autoAssignAutomationTeamAction`. The logic change is one deleted guard plus a client-side grouping.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`.
- No schema or permission change.
- Do not change reassignment or handover approval rules (`isCrossSquad`, `AWAITING_HEAD_APPROVAL`).
- Do not change auto-assign scoring.

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
- **code-review-graph:** `query_graph_tool` `callers_of` `createAutomationProject`, `getPMTeamData`, `groupEngineersBySquad`; `get_impact_radius_tool` on `automation-project.service.ts`.
- **Token Savior:** `get_function_source` `createAutomationProject` and `groupEngineersBySquad`. In the wizard, search `candidateEngineers` and `filterPMTeamOnly`; do not read the whole file.
- **sequential-thinking:** not needed.
- **Skills:** `ponytail` (full) · `tdd` · `impeccable` + `ux-writing` (group labels) · `review-delta` (before DONE).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int`. Run the full suite and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [ ] 1. **Test first:** integration test where a Director creates a project for PM A with a panel assigned to an engineer from PM B's team. It succeeds and the engineer becomes a project member. An inactive user or a user from another company is still rejected. See it fail on the team guard.
- [ ] 2. Remove the server guard. Test goes green.
- [ ] 3. Wizard: grouped picker, own team first and marked, for every panel type.
- [ ] 4. Full suite; record counts.

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [ ] On New project, every panel's engineer list contains all active engineers, grouped by team, with the selected PM's team first and marked.
- [ ] Creating a project with a cross-team engineer succeeds.
- [ ] Existing `pm-assignees.int.test.ts` cross-team approval cases still pass unchanged.

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups>
