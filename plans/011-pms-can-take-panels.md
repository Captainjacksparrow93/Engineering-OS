# 011 — PMs and Assistant PMs can take a panel

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity

## Goal
User request 2026-09-30: on the New project form (step 3, "Review Panels & Assign Engineers"), **every PM and Assistant PM** can be picked as a panel's engineer, and **Auto-Assign may pick them like any engineer**.

**Evidence (production, 2026-09-30):** the picker shows "Parth Nagar's team (PM)", "Dhrupin Vaghasiya's team", "Munaf Multani's team" and "Paras Prajapati's team", but none of those four people can be picked.
- `getPMTeamData` builds `allEngineers` from users holding `SENIOR_ENGINEER`/`JUNIOR_ENGINEER` in TECH and **drops any designation containing "Manager" or "Asst"**. The wizard's `engineerGroups` already tries to put each PM in their own group (`e.id === selectedPMId`, `e.id === m.id`), but PMs never reach `allEngineers`.
- `autoAssignAutomationTeam` fetches candidates with `grade notIn [MANAGER, HEAD, DIRECTOR]` and the same designation filter. In `domain/availability.ts`, `applyHardRules` (H4, via `isExecutionStaff`), `computeFairShare` and the escalation ladder's rung 3 in `allocateTeamForSteps` also drop grade `MANAGER`.
- PM pool (`projectManagerPool` in `access.ts`): active TECH users with `PROJECT_MANAGER` or `ASST_MANAGER`. Today that is Parth Nagar and Paras Prajapati (grade `MANAGER`, "Project Manager"), and Munaf Multani and Dhrupin Vaghasiya (grade `SENIOR_ENGINEER`, "Asst. Manager").

**What changes:**
- **Picker:** each PM/Asst PM appears **first in their own team group**, marked as PM (e.g. "Parth Nagar (PM)"). The selected PM's group stays first, as today.
- **Auto-Assign:** PMs/Asst PMs join the candidate pool with the same rules as engineers: grade floor, leave, free hours and fair share. The selected PM counts as part of their own squad.
- **Unchanged:** Directors and Heads are never candidates. `isExecutionStaff` stays as it is: it also drives the dashboards' free-engineer count, team load, `teamOf`, and handover rules (`requestHandover`, `requestProjectHandover`). Widening it would change all of those. **Don't touch it.**

**Known effect (tell the user in the notes, don't design around it):** PMs usually hold few step assignments, so the workload balancer may treat them as the least-loaded people and give them panels first. The user accepted "like any engineer". If it misbehaves in practice, a follow-up plan can weight PMs lower.

## Affected code
- `src/modules/project-management/services/automation-project.service.ts`:
  - `getPMTeamData`: `allEngineers` also includes everyone in `managers` (the PM pool), with no duplicates and flagged as PM.
  - `autoAssignAutomationTeam`: the candidate query also returns PM-pool users, still excluding Directors and Heads. Mark those candidates as PMs. Add `input.managerId` itself to `squadSet`.
- `src/modules/project-management/domain/availability.ts`:
  - `SmartCandidate` gets an explicit flag, e.g. `isPM`.
  - `applyHardRules` (H4), `computeFairShare` (`workers`) and rung 3 of `allocateTeamForSteps` accept a candidate when `isExecutionStaff(candidate) || candidate.isPM`. The `MANAGER` grade exclusion must not reject a flagged PM; `HEAD`/`DIRECTOR` stay excluded always.
  - `isExecutionStaff` unchanged.
- `src/app/(shell)/pm/projects/new/automation-project-wizard.tsx`, `engineerGroups`: put the group's PM first and label them as PM. The `Engineer` type gets the flag from `getPMTeamData`.
- `createAutomationProject` already accepts any active same-company user as assignee (plan 006). Confirm; no change expected.

**Blast radius** (code-review-graph, 2026-09-30, graph at `c76ed86`):
- `callers_of getPMTeamData`: `ProjectsPage` (`src/app/(shell)/pm/projects/page.tsx`, uses only `managers`), `NewProjectPage`, and `beforeAll` in `new-project-all-engineers.int.test.ts`, `panel-delivery-dates.int.test.ts` and `project-edit.int.test.ts`.
- `callers_of autoAssignAutomationTeam`: `autoAssignAutomationTeamAction` (`src/app/actions/pm.ts`).
- `callers_of allocateTeamForSteps`: `autoAssignAutomationTeam` and 3 tests in `availability.test.ts`.
- `callers_of isExecutionStaff`: 8, including `applyHardRules`, `teamOf` (`access.ts`), `getDashboard` (`dashboard.service.ts`), `requestHandover` and `requestProjectHandover` (`handover.service.ts`). This is why it stays unchanged.
- Blast radius of `automation-project.service.ts` + `domain/availability.ts`: high, 23 nodes changed, 134 files within 2 hops (key: `ProjectPage`, `NewProjectPage`, `ProjectsPage`, `TeamLoadTable`, `createAutomationProjectAction`). `get_affected_flows`: 0 flows.

## Constraints
- The app is LIVE. Commit locally only; never push. **If plan 010 has landed, a push deploys.**
- No schema or permission change.
- Dashboards, team load, `teamOf` and handover rules must behave exactly as before. A PM given a panel won't count as a "free engineer" on the dashboard; that is intended for now.
- UI copy per `ux-writing`; the picker layout per `impeccable` (no new component).

## Tools & skills (implementer: follow these)
- **Setup:** point Token Savior at this project and update the code-review-graph; load `ponytail` (full) and the skills below.
- **Check first (graph):** callers of `getPMTeamData`, `autoAssignAutomationTeam`, `allocateTeamForSteps`, `applyHardRules`, `computeFairShare`, `isExecutionStaff`; blast radius of `automation-project.service.ts` and `domain/availability.ts`.
- **Read (Token Savior):** `getPMTeamData`, `autoAssignAutomationTeam`, `projectManagerPool`, `applyHardRules`, `computeFairShare`, `allocateTeamForSteps`, `isExecutionStaff`. In the wizard, search `engineerGroups`; don't read the whole file.
- **sequential-thinking:** required for the availability change: where the three `MANAGER` exclusions are, and why each is safe to open for flagged PMs only.
- **Skills:** `ponytail` (full) · `tdd` · `ux-writing` + `impeccable` (picker label) · `review-delta` (before DONE).
- **Tests:** `npm run typecheck && npm test && npm run build`, and `npm run test:int` **on a fresh CI-like database** (empty DB → `npx prisma migrate deploy` → `npm run db:seed`), not only the production copy. Tests must not depend on data that exists only in the production copy. Paste the counts.
- If a tool is missing or fails, say so in Implementation notes.

## Steps
- [ ] 1. **Tests first:**
  - **Unit (`availability.test.ts`):** a candidate flagged `isPM` with grade `MANAGER` passes the hard rules and can be allocated; a `HEAD` or `DIRECTOR` still can't; an unflagged `MANAGER` still can't; `isExecutionStaff` results unchanged.
  - **Integration:** `getPMTeamData().allEngineers` includes every PM-pool user, once each. `autoAssignAutomationTeam` can return a PM for a panel when the engineers are fully booked (build that state inside the test). `createAutomationProject` accepts a PM as a panel assignee. A Director is never auto-assigned.
- [ ] 2. `getPMTeamData` + wizard grouping and label.
- [ ] 3. Auto-assign candidates, the `isPM` flag and the domain rules.
- [ ] 4. Full suite (CI-like database); record counts.

## Acceptance criteria
- [ ] In the New project picker, each PM/Asst PM is pickable, listed first in their own team group and marked as PM.
- [ ] Auto-Assign can pick a PM/Asst PM under the same rules as engineers; never a Director or Head.
- [ ] Dashboards, team load and handover behaviour are unchanged (existing tests pass untouched).
- [ ] The full suite passes on a fresh CI-like database (counts pasted).

## Implementation notes (implementer)
<commits, graph output, deviations, test counts, tools used>

## Review (Claude)
<verdict, follow-ups>
