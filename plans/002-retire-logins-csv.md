# 002 — Retire the plain-text password CSV

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity

## Goal
`prisma/data/logins.csv` is committed to git with every user's password in plain text. `entrypoint.sh` runs `prisma/scripts/set-passwords-from-csv.ts` on **every container start**, which resets each listed person's password back to the CSV value — so a password a user changes in the app is silently reverted on the next deploy or restart.

The owner confirmed (2026-09-26) all passwords now live in the database, so the CSV and its script are no longer needed. Remove both, and the startup step that runs them. The script is already safe if the file is missing (`No password file ...; skipping.`), so this change cannot lock anyone out.

## Affected code
- `prisma/data/logins.csv` — delete.
- `prisma/scripts/set-passwords-from-csv.ts` — delete.
- `entrypoint.sh` — remove the two lines that run `set-passwords-from-csv.ts` (one in the `node node_modules/tsx/dist/cli.mjs ...` branch, one in the `npx tsx ...` branch). Leave the `grant-*.ts` lines and everything else unchanged.
- References found by text search (`logins.csv`, `set-passwords-from-csv`): `AGENTS.md:13`, `PROJECT.md:188`, the script's own header. Claude updates `AGENTS.md` and `PROJECT.md` in review; do not edit them.
- Blast radius: code-review-graph and Token Savior do not index `.sh`/`.csv`; the script has no importers (it's only invoked from `entrypoint.sh`). No application code under `src/` references either file.

## Constraints
- The app is LIVE. Commit locally only; never push to `main`.
- Do not touch `prisma/seed.ts` in this plan (its default-password fallback is a separate item).
- Do not rewrite git history. The passwords stay in old commits; the owner handles that separately (see Owner steps).
- Do not run anything against the VPS or production DB.

## Tools & skills (implementer: follow these)
- **code-review-graph:** `query_graph_tool` importers_of `prisma/scripts/set-passwords-from-csv.ts` — expect none. Paste the result in Implementation notes.
- **Token Savior:** not needed (no TypeScript symbols change besides deleting one standalone script).
- **Text search:** grep the repo (excluding `node_modules`, `.git`, `docs/`) for `logins.csv` and `set-passwords-from-csv` after your change; only `AGENTS.md` and `PROJECT.md` may still match.
- **sequential-thinking:** not needed.
- **Skills:** `ponytail` (full) · `review-delta` (before DONE). `tdd` not applicable (deleting a startup step; no behavior to test beyond startup).
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int` — run the full suite and paste pass/fail counts into Implementation notes.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [ ] 1. Delete `prisma/data/logins.csv` and `prisma/scripts/set-passwords-from-csv.ts` (`git rm`).
- [ ] 2. In `entrypoint.sh`, remove both `set-passwords-from-csv.ts` lines. Check with `sh -n entrypoint.sh`.
- [ ] 3. Run the search and the full test suite; record results.

## Acceptance criteria
- [ ] Full suite passes: `npm run typecheck && npm test && npm run build`, `npm run test:int` (paste counts).
- [ ] `git ls-files prisma/data` no longer lists `logins.csv`.
- [ ] `entrypoint.sh` has no reference to `set-passwords-from-csv`; `sh -n entrypoint.sh` passes.
- [ ] No references to `logins.csv` / `set-passwords-from-csv` outside `AGENTS.md`, `PROJECT.md` and `docs/`.

## Owner steps after review (not for the implementer)
- Deploy as usual. After this deploy, passwords changed in the app stay changed.
- The old passwords are still readable in git history by anyone with repo access. Ask everyone to change their password in the app after the deploy (before the deploy it would be reverted).

## Implementation notes (implementer)
<commits, deviations from plan, test pass/fail counts, tools used, open questions>

## Review (Claude)
<verdict, follow-ups; Claude updates AGENTS.md line 13 and PROJECT.md line 188>
