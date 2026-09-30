# Plans

Open plans live in `plans/`. Verified plans move to `plans/done/`. Plans written before 2026-09-26 are in `docs/`.
Status: TODO → IN PROGRESS → DONE → REVIEWED (then moved to done/)

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
