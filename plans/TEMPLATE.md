# NNN — <title>

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity

## Goal
<what and why — the audit finding and its evidence>

## Affected code
- `path/file` — `function_name` (reason)
- Blast radius: <callers/dependents from get_impact_radius_tool>

## Constraints
- The app is LIVE. Commit locally only; never push to `main` (a push auto-deploys).
- Schema/permission changes only via Prisma migrations (additive; permissions via hand-written SQL with `ON CONFLICT (key) DO NOTHING`). Never `prisma db push` on a shared DB. Never touch the VPS or production data.
- <plan-specific constraints>

## Tools & skills (implementer: follow these)
- **Navigate with code-review-graph, don't read whole files:**
  - `query_graph_tool` callers_of `<symbol>` / importers_of `<module>`
  - `get_impact_radius_tool` on `<symbol>` before changing it
  - `get_affected_flows_tool` if touching <flow>
- **Read code with Token Savior:** `find_symbol` `<symbol>`, `get_function_source` `<function>`, `get_full_context` `<file>`.
- **sequential-thinking:** <required for step N — reason / not needed>.
- **Skills:** `ponytail` (full, always) · `tdd` (tests first) · `review-delta` (before DONE)<· `ux-writing` / `impeccable` if UI>.
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int` — run the full suite and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [ ] 1. <outcome, not code>
- [ ] 2. ...

## Acceptance criteria
- [ ] Typecheck, unit tests, build and integration tests pass (full suite)
- [ ] <observable behavior>

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups>
