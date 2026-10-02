# Plans

Open plans live in `plans/`. Verified plans move to `plans/done/`. Plans written before 2026-09-26 are in `docs/`.
Status: TODO → IN PROGRESS → DONE → REVIEWED (then moved to done/)

## Implementer: start here (the user only says "continue")
When the user says **"continue"** (or "next", or "go"), do this without asking:

1. **Branch:**
   - Plans marked "Branch `erp`" in the table → `git checkout erp`.
   - All others → `main`.
   - Never switch with uncommitted changes, never merge branches, never push.
2. **Pick the work:** the **first** plan in the table below whose Status isn't `REVIEWED`, `DONE`, or "waiting for Claude", and whose part is yours (a plan or step marked "Claude" or "VPS" is not).
3. **Inside that plan:** do the next item that isn't ticked. Open review follow-ups (`- [ ] F1 …` under "Review (Claude)") come first, then the next unticked **Step**. Do **exactly one step** (one follow-up, or one numbered step), then stop.
4. **Before you code:** read `AGENTS.md` (and "ERP work" for ERP plans), then the plan's "Tools & skills" section, and follow it: graph checks, Token Savior reads, skills and test commands.
5. **When the step is done:**
   - tick its box;
   - fill in "Implementation notes" (what changed, commands, test counts, deviations);
   - set Status to `IN PROGRESS`, or `DONE` if every step and acceptance box is ticked;
   - update this table's Status;
   - commit locally (`plan NNN: step N …`) and leave the tree clean.
6. **Reply to the user in two lines:**
   - what you did and the test counts;
   - the exact sentence to send Claude: **"Plan NNN step N done, review."**
7. **Stop** if a step is wrong, blocked, or needs the VPS or a secret you don't have. Write why in "Implementation notes", set the table's Status to "blocked: <reason>", commit, and tell the user. Don't improvise.

Claude (reviewer): when the user says **"review"** or **"check"**, review the latest implementer commits against their plan, write the verdict and any `- [ ] F…` follow-ups under "Review (Claude)", and update Status. The implementer's next "continue" then picks those follow-ups up automatically.

| # | Plan | Status | Notes |
|---|---|---|---|
| 001 | [Build image locally, ship to VPS](done/001-local-image-build-deploy.md) | REVIEWED | Replaces GHCR build + auto-deploy; owner runs `scripts/deploy.sh` |
| 002 | [Retire the plain-text password CSV](done/002-retire-logins-csv.md) | REVIEWED | Deletes `logins.csv` + startup script that reverts passwords |
| 003 | [Remove finished one-off data scripts](done/003-remove-one-off-scripts.md) | REVIEWED | Deletes wipe/update/verify scripts; keeps `grant-*.ts` |
| 004 | [UI cleanup + progress fix](done/004-ui-cleanup-and-progress-fix.md) | REVIEWED | Project code on screen, fewer WO repeats, flat tiles, plain audit text, one progress number |
| 005 | [Shared project code](done/005-shared-project-code.md) | REVIEWED | Drops unique on `Project.code` (migration, rehearsed on prod copy); pick-or-type code |
| 006 | [All engineers on new project](done/006-all-engineers-on-new-project.md) | REVIEWED | Grouped picker, PM's team first; Sales Head can no longer request/decide/cancel handovers |
| 007 | [Panel delivery dates](done/007-panel-delivery-dates.md) | REVIEWED | Per-panel date on `PHASE` `plannedEnd`, no schema change; Late per panel; server enforces date range, step ends and min window |
| 008 | [Edit project and client](done/008-edit-project-and-client.md) | REVIEWED | Director/Head only via `pm.project.create` (closes PM edit via API); panel dates, client rename cascade; status stays with its buttons |
| 009 | [Release plans 002–008](done/009-release-plans-002-008.md) | REVIEWED | Live 2026-09-30 on `ccbdd71`; `deploy.sh` stdin bug found (swap skipped, reported success); finished by hand |
| 010 | [Automatic deploy from GitHub](done/010-auto-deploy-from-github.md) | REVIEWED | Live 2026-09-30: green CI on `main` → GHCR → SSH deploy (reachability retry, backup, health + image check, auto-rollback); rollback drill passed; `deploy.sh` removed |
| 011 | [PMs can take a panel](done/011-pms-can-take-panels.md) | REVIEWED | PMs/Asst PMs pickable in the New project picker and in Auto-Assign via an `isPM` flag; `isExecutionStaff` unchanged |
| 012 | [ERP Phase 0: ERPNext feasibility](012-erp-phase0-erpnext-feasibility.md) | IN PROGRESS (part A done) | Branch `erp`. Part A done (gate 1 passed); part B (VPS) deferred until after 015. ERPNext v16.37.0 as a separate, memory-capped, private compose project on the VPS; API + webhook proven; gates on memory |
| 013 | [ERP access: sign-in, theme, ERP entry](done/013-erp-access-sso-theme.md) | REVIEWED | SSO (Director: System Manager + 20 roles; Sales Head: 20 roles), ERP entry, theme and full rebrand, sign-in tests; F12c (tile icons) moved to 016 step 1 |
| 014 | [ERP: every new project starts from a sales order](014-erp-order-to-project.md) | DONE | Branch `erp`. After 013. ERP client, links (additive migration), lazy client + ACS ref, New project step 0 picks a confirmed order, write-back with self-repair, order fields locked in Edit details |
| 015 | [ERP: backfill and safe sync](015-erp-backfill-and-safe-sync.md) | DONE | Branch `erp`. After 014. Backfill script (dry run default, idempotent), order-change sync on page load (PO/dates/WO/client follow ERP, added panels appended, removals only alert), Director alert banner |
| 016 | [ERP release](016-erp-release.md) | TODO | Steps 1–2 Antigravity (F12c, then merge `main` into `erp` only when the user says so); steps 3–9 **Claude/VPS** with approval: ERPNext on VPS, HTTPS route, prod-copy rehearsal, merge to `main`, production backfill, 24 h watch |
| 017 | [ERP: import the item master](017-erp-item-master-import.md) | DONE | Branch `erp`, ERPNext only (no `src/`/Prisma). Clean import of the 38 demo PLC items from `docs/erp/demo-items-2026-10-02.xlsx`: item group tree, Siemens brand, maker part no. field, dry run default, idempotent. Build before 016; production import is 016 step 7.4b |
