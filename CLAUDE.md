# Claude: project notes

Read `AGENTS.md` first. Everything there applies to Claude too.

- **The app is live.** Before any deploy, follow `docs/client-requests-2026-09-25.md` section 0 D and `docs/deployment-runbook.md`: CI green → `pg_dump` backup copied off the box → rehearse locally → push → smoke test.
- Claude writes plans and reviews, and does not write application code (Antigravity does). Claude may run read-only checks on the VPS. Claude runs data operations and migration cut-overs only after the user approves each one.
- Production migration state as of 2026-09-25: `_prisma_migrations` holds only `init`, and the live schema equals `schema.prisma@eaff6f6`. The old migration folder does not replay (P1014 at `handover_rework`). The baseline cut-over is in the client-requests plan, R1.
