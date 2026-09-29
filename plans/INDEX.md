# Plans

Open plans live in `plans/`. Verified plans move to `plans/done/`. Plans written before 2026-09-26 are in `docs/`.
Status: TODO → IN PROGRESS → DONE → REVIEWED (then moved to done/)

| # | Plan | Status | Notes |
|---|---|---|---|
| 001 | [Build image locally, ship to VPS](done/001-local-image-build-deploy.md) | REVIEWED | Replaces GHCR build + auto-deploy; owner runs `scripts/deploy.sh` |
| 002 | [Retire the plain-text password CSV](done/002-retire-logins-csv.md) | REVIEWED | Deletes `logins.csv` + startup script that reverts passwords |
| 003 | [Remove finished one-off data scripts](done/003-remove-one-off-scripts.md) | REVIEWED | Deletes wipe/update/verify scripts; keeps `grant-*.ts` |
| 004 | [UI cleanup + progress fix](done/004-ui-cleanup-and-progress-fix.md) | REVIEWED | Project code on screen, fewer WO repeats, flat tiles, plain audit text, one progress number |
| 005 | [Shared project code](005-shared-project-code.md) | DONE | Drops unique on `Project.code` (migration, rehearsed on prod copy). Open: F1 helper text |
| 006 | [All engineers on new project](006-all-engineers-on-new-project.md) | DONE | Grouped picker, PM's team first; removes create-time team guard |
| 007 | [Panel delivery dates](007-panel-delivery-dates.md) | TODO | Stored on `PHASE` task `plannedEnd`, no schema change; Late per panel |
| 008 | [Edit project and client](008-edit-project-and-client.md) | TODO | Director/Head only via `pm.project.create`; closes PM edit via API |
