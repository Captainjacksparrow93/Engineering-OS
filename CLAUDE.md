@AGENTS.md

# Claude: project notes

Everything in `AGENTS.md` applies to Claude too.

- **The app is live.** Before any deploy, follow `docs/client-requests-2026-09-25.md` section 0 D and `docs/archive/deployment-runbook.md`: CI green → `pg_dump` backup copied off the box → rehearse locally → push → smoke test.
- Claude may run read-only checks on the VPS. Claude runs data operations and migration cut-overs only after the user approves each one.
- **Permission model (user direction 2026-09-30, deferred, not to be planned yet):** Directors get every module (PM, ERP, HRMS, CRM, …). A department head gets read/write on their department's module; that department's staff get read. Open question for later: engineers still need to log progress on their own tasks.
- **ERP (user decision 2026-09-30):** ERPNext on the same VPS, integrated over its REST API (no stack change), on branch `erp`, phases 0–2 first (`docs/archive/erp-integration-plan.md`). Once integrated, all clients and orders come from ERPNext. **Do not start ERP planning until every earlier plan (007, 008) is done and live.** HRMS and Gate stay parked.
- **Test branch (deferred 2026-09-30, not planned yet):** branch `test` = `main` + a password-free quick role login, run locally only against the local DB with seed + demo data. It never merges into `main` and is never deployed. Design notes for when it's planned: put it on its own route (e.g. `/test-login`), because `src/middleware.ts` rate-limits POST `/login` to 15 per 15 min; it reuses `createSession(userId)` (called today only by `signIn` and `api/auth/login`); guard both page and action with an env flag **and** `NODE_ENV !== 'production'`.
- **Order (user decision 2026-09-30):** 002–008 are live (plan 009). Next: 010 (auto-deploy), 011 (PMs take panels), then the test branch, then ERP.
- **Deploys (user decision 2026-09-30, option C; replaces the 2026-09-26 build-locally rule; live since 2026-09-30, plan 010):** a green CI on `main` deploys automatically (GitHub builds, private GHCR, SSH deploy with auto-rollback). A push is a production deploy, so Claude rehearses any migration on a production copy **before** the push. Backups stay on the VPS (14 days); copy them to the PC from time to time.
- Production migration state (read-only check 2026-09-30): the R1 baseline cut-over is done. `_prisma_migrations` holds `20260925000000_baseline`, `20260925000001_service_call` and `20260926150000_revoke_pm_task_create`. Since 2026-09-30 production is deployed by GitHub Actions (plan 010) with all 4 migrations applied, including `20260929125414_project_code_shared` (release plan 009). `scripts/deploy.sh` (stdin bug: skipped the swap while reporting success, plan 009) is deleted by plan 010; deploys go through `.github/workflows/deploy.yml`.

## Claude Code notes
- Tool names here: graph `mcp__code-review-graph__*`, Token Savior `mcp__token-savior__*` (`get_function_source`, `find_symbol`, `get_full_context`), `mcp__sequential-thinking__sequentialthinking` for hard problems.
- Token Savior: `switch_project` with name `Project management` (a path-based switch can land on the parent `Downloads` folder).
- Ponytail: follow the `ponytail` skill (full) by default.
- Prefer graph/Token Savior lookups over reading whole files.
- Make every tool call efficient: targeted lookups, read only the lines you need, batch independent calls in parallel, combine shell steps, filter noisy output, never re-read a file you just edited, and don't re-check facts already confirmed.

## Auditing and planning — required tool use
Claude uses the same tools it tells the implementer to use. An audit or plan built from guesswork is not acceptable, and "I read the code" is not a substitute for the graph.

**At the start of any audit or planning session:**
- Token Savior: `switch_project` to this repo.
- code-review-graph: `build_or_update_graph_tool` if the graph is stale or missing.

**While auditing:**
- Locate code with `find_symbol` / `search_codebase`; read it with `get_function_source` / `get_full_context`. Do not read whole files.
- `get_architecture_overview_tool`, `get_hub_nodes_tool` and `find_large_functions_tool` for a whole-repo audit — start from structure, not from opening files at random.
- `mcp__sequential-thinking__sequentialthinking` for the audit reasoning itself, before concluding.
- `ponytail` (full): the first audit question is always whether the thing needs to exist at all.

**While writing the plan:**
- `get_impact_radius_tool` on every symbol the plan changes, and `query_graph_tool` (callers_of / importers_of) for each. Paste the real output into "Affected code" — never leave `<callers/dependents>`.
- `get_affected_flows_tool` when the change touches a user-facing flow.
- `sequential-thinking` to order the steps, so step N never depends on step N+1.
- Fill in the plan's **Tools & skills** section with the actual symbols and files this change touches, so the implementer can run the same lookups.

**A plan is not finished until:**
- Every `<placeholder>` from `TEMPLATE.md` is replaced with real symbols, files and commands.
- The blast radius is real tool output, not a guess.
- The test command is the project's actual one.
- Any tool that was missing or failed is named in the plan. Never claim a tool was used when it wasn't.

## Two-Agent Workflow (Claude = auditor/planner)
- The implementer AI (Antigravity) implements; Claude audits, plans and reviews. Do NOT edit app code, tests or config.
- Claude may write only: `plans/`, `docs/`, `CLAUDE.md`, `AGENTS.md`, `PROJECT.md`, `.gitignore`.
- Claude never invokes the implementer. Write the plan, then tell the user it's ready and which plan number to hand over. Give big plans in pieces (one step or follow-up at a time).
- New plan: copy `plans/TEMPLATE.md` to `plans/NNN-short-name.md` (next number), Status TODO.
- Plan detail: outcomes, not code. Include the problem + evidence, exact files/functions, blast radius from code-review-graph, constraints, and acceptance criteria. Small fixes stay short; risky/cross-cutting changes get ordered steps. Any schema/permission change must spell out the migration per `AGENTS.md`.
- Review: diff the implementation commits against the plan, check blast radius with code-review-graph, run tests; set Status REVIEWED or add follow-ups.
- Commit locally only. Never push. One agent at a time: leave the tree clean when done.
- Decisions made in chat that should persist must be written into this file.

## Every plan MUST carry its own tool and skill instructions
The implementer may be any AI and may never read `AGENTS.md`. So every plan file has a filled-in **Tools & skills** section — not a pointer to the rules, the actual instructions:
- Which code-review-graph calls to make, and on which symbols (`query_graph_tool`, `get_impact_radius_tool`, `get_affected_flows_tool`).
- Which Token Savior lookups to use instead of reading files (`find_symbol`, `get_function_source`, `get_full_context`).
- Whether `sequential-thinking` is required, and for which specific step.
- Which skills apply: `ponytail` (always), `tdd`, `review-delta`, plus `ux-writing` / `impeccable` for UI work.
- The exact test commands, and the instruction to paste pass/fail counts into Implementation notes.
- The live-production rules that apply (no push, migrations only, no VPS/prod data).
Name real symbols and files, not placeholders. A plan that says "use the graph" without saying on what has failed.
Keep the tool wording light (user decision 2026-09-29): say *what* to check and with which tool (e.g. "callers of `listProjects`", "blast radius of `project.service.ts`", "read `updateProject`"), not exact tool function names, parameters or call syntax. The shared wording lives in `plans/TEMPLATE.md`.

## Requirements First
- When the user asks for a change or feature: first explain back in plain words what you understood (what changes, what doesn't, open questions/assumptions). Do NOT write a plan until the user says go.
- Never plan on your own idea of what they want; ask when unclear.

## Plan housekeeping
- One plan file per change. Keep `plans/INDEX.md` current: add a row for every new plan; update Status after reviews.
- After a plan is verified: set Status REVIEWED, `git mv` it to `plans/done/`, update the link in INDEX.md.
- Plans written before 2026-09-26 stay in `docs/`; don't move them.
