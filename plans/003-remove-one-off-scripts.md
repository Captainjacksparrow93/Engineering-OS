# 003 — Remove finished one-off data scripts

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity

## Goal
Four scripts in `prisma/scripts/` were written for one-time jobs that are finished (September 2026 project wipe and PM-team update). They are not run by the app, and keeping them is a risk: `wipe-all-projects.*` deletes every project if someone runs it against the wrong database. Git history keeps them if ever needed.

Remove:
- `prisma/scripts/wipe-all-projects.sql`
- `prisma/scripts/wipe-all-projects.ts`
- `prisma/scripts/update-pm-team.ts`
- `prisma/scripts/verify-handover-rework.ts`

Keep (still run on every start by `entrypoint.sh`): `grant-commissioning-permissions.ts`, `grant-password-reset.ts`, `grant-read-permissions.ts`, `grant-sales-head.ts`, `grant-service-head.ts`. `set-passwords-from-csv.ts` is handled by plan 002.

## Affected code
- The four files above — delete only.
- References (text search, excluding `node_modules`, `.git`, `.next`, caches): none in code, `package.json` or `entrypoint.sh`. Mentions remain only in `docs/archive/*` (history, leave as is) and `docs/client-requests-2026-09-25.md:16` (Claude handles docs).
- Blast radius (code-review-graph, 2026-09-26, graph at `c295254`):
  - `importers_of prisma/scripts/verify-handover-rework.ts` → 0 results.
  - `importers_of` `update-pm-team.ts` / `wipe-all-projects.ts` → node not found (standalone scripts, nothing imports them).
  - `get_impact_radius_tool` on the three `.ts` files reports "high / 98 files", but its key entities are other scripts' `main` functions and `loadPrincipal` — name collisions on `main`, not real dependencies. Treat as no real blast radius; confirm with the importers check in step 1.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`.
- Delete only these four files. Do not touch `grant-*.ts`, `entrypoint.sh`, `seed.ts`, `seed-demo.ts` or anything under `src/`.
- Do not edit anything in `docs/`.

## Tools & skills (implementer: follow these)
- **code-review-graph:** `query_graph_tool` `importers_of` on each of the four files before deleting; expect none. Paste results into Implementation notes.
- **Token Savior:** not needed (deletions only).
- **Text search:** after deleting, grep for `wipe-all-projects`, `update-pm-team`, `verify-handover-rework` excluding `node_modules`, `.git`, `.next`, `docs/`. Expect no matches.
- **sequential-thinking:** not needed.
- **Skills:** `ponytail` (full) · `review-delta` (before DONE). `tdd` not applicable.
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int` — full suite; paste pass/fail counts into Implementation notes. Typecheck matters here: it proves nothing imported the deleted files.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [ ] 1. Run the importers check on all four files; record results.
- [ ] 2. `git rm` the four files.
- [ ] 3. Run the text search and the full test suite; record results.

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [ ] `ls prisma/scripts` shows only the five `grant-*.ts` files (plus `set-passwords-from-csv.ts` if plan 002 isn't done yet).
- [ ] No references to the removed scripts outside `docs/`.

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups; Claude updates docs/client-requests-2026-09-25.md line 16 if needed>
