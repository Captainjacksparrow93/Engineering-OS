# 016 — ERP release: ERPNext on the VPS, merge `erp` to `main`, backfill production

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity (steps 1–2) and **Claude** (steps 3–9, each VPS or production change only after the user approves it) · **Branch:** `erp`, then `main` · **Depends on:** 013, 014, 015 REVIEWED

## Goal
Take the ERP work live in one release, as the user decided on 2026-10-02 ("wait for 014–015", then deploy everything together):
- ERPNext on the VPS, using our `acs-erpnext` image, at its own HTTPS address;
- Engineering OS with the ERP entry, one-click sign-in, New project from a sales order, and order sync;
- every existing client and work-order project backfilled into ERPNext;
- after that, all new work orders start in ERPNext.

The rule in `CLAUDE.md` holds: **ERPNext must be on the VPS before `erp` merges to `main`**, because a merge to `main` deploys.

## Affected code
- `erp/acs_erp/acs_erp/public/css/acs_theme.css`: F12c icon fix (deferred from 013).
- `.github/workflows/ci.yml`: already runs on `erp` (plan 013); no change expected.
- `.github/workflows/deploy.yml`: unchanged. The ERPNext containers are deployed by hand (Claude), not by this workflow.
- `PROJECT.md` and `docs/archive/deployment-runbook.md`: ERPNext hosting, backup and restore, and how to upgrade the image (Claude).
- On the VPS (Claude):
  - `/root/erpnext-docker` (new compose project);
  - `/root/engos-docker/.env` (new keys);
  - Traefik route;
  - cron backup.
- **Blast radius:** everything from plans 013–015 reaches production at once. Their reviewed blast radius applies (137 files within 2 hops of the PM services). The production migrations are the additive ones from 013 (`erp_access_permission`), 014 (`erp_order_links`) and 015 (`erp_order_alerts`).

## Constraints
- The app is LIVE. **Every VPS change, every production data operation and the push to `main` happen only after the user approves that step.** Follow `docs/archive/deployment-runbook.md`: backup first, rehearse locally, then push, then smoke test.
- Never `docker compose down -v`, never delete volumes, and never touch the other apps on the box (Chatwoot, n8n, Supplychain and the rest).
- Memory: the ERPNext caps from plan 012 (sum 2,368 MiB). Gate 2 needs ≥ 1.5 GB left after the caps, from 3 samples.
- Secrets are generated on the VPS and live only in `/root/erpnext-docker/.env` (mode 600), ERPNext's `site_config.json` and `/root/engos-docker/.env`. Never in git, chat or notes; note key names only.
- ERPNext stays bound to `127.0.0.1`; the public route goes only through Traefik with HTTPS.
- **The image is built on the VPS** from `erp/Dockerfile` at the release commit, tagged `acs-erpnext:v16.37.0-acsN` (same N as the last local tag). No registry, no copying from the PC.
- **Rollback plan:**
  - Engineering OS: `gh workflow run Deploy -f sha=<previous main sha>` (tested 2026-09-30). The new columns are additive and harmless to the old code.
  - ERPNext: stop its compose project; the app with ERP off behaves as before. Remove `ERPNEXT_API_KEY` from the app `.env` and redeploy to turn ERP off.

## Tools & skills
- **Antigravity (steps 1–2):**
  - `git checkout erp`;
  - follow `AGENTS.md` "ERP work";
  - load `ponytail` (full), `impeccable` (step 1) and `review-delta`;
  - read the theme CSS by section (`acs_theme.css` section 7);
  - tests: `npm run typecheck && npm test && npm run build`, `npm run test:int` (also on a fresh CI-like DB), plus the acs_erp Python tests; paste the counts.
- **Claude (steps 3–9):**
  - read-only checks first;
  - `sequential-thinking` before the cut-over order in step 7;
  - code-review-graph `detect_changes` on the `main`…`erp` diff before the merge, and blast radius of the merged diff, pasted into notes;
  - the backup and rehearsal commands from the runbook.
- If a tool is missing or fails, say so in notes.

## Steps
- [x] **1. (Antigravity) F12c: readable tile icons.** As written in plan 013, F12c: a dark tile with a white symbol (e.g. `filter: grayscale(1) contrast(8) brightness(0.9)`), and the ACS logo not affected. Rebuild as the next tag, check it in the browser, and note what you saw.
- [ ] **2. (Antigravity) Bring `main` into `erp` and re-run everything.**
  - This is an exception to "never merge `main` into `erp`". **Wait until the user says "merge main into erp" in chat**; until then, this step is blocked.
  - Merge `main` into `erp`, resolve conflicts (plans and docs keep both sides), and run the full suite, including a fresh CI-like DB.
  - Note any conflict and how it was resolved.
- [ ] **3. (Claude) Gate 2 headroom (plan 012 step 6).** Two more samples of `free -m` and `docker stats` (one morning, one afternoon). Stop if it fails.
- [ ] **4. (Claude, approval) Install ERPNext on the VPS (plan 012 steps 7–8), using our image.**
  - Build `acs-erpnext` on the VPS from the release commit, then bring the compose project up in `/root/erpnext-docker` on `127.0.0.1:8080`, with the caps.
  - Create a fresh site, run the minimal setup (company, INR, Apr–Mar, standard chart), install `acs_erp`, and migrate.
  - Create the `engos-api` user (Sales User) with an API key.
  - Site config: `acs_erp_sso_secret`, `acs_erp_engos_origin` (production origin), `allowed_referrers`.
  - Daily backup cron (14 days); run it once.
- [ ] **5. (User + Claude, approval) Public HTTPS address.**
  - The user picks the hostname (e.g. `erp.<our domain>`; Claude reads the current domain from the VPS) and adds a DNS A record to `72.62.248.38`.
  - Claude adds the Traefik route with HTTPS and checks the certificate.
  - Check from outside: the HTTPS login page loads with our branding, and port 8080 is closed.
- [ ] **6. (Claude) Rehearse on a production copy, locally.**
  - Take a fresh `pg_dump` of production (copied off the box) and restore it into a throwaway local database.
  - Run `npx prisma migrate deploy` from the merged `erp`, and confirm the three migrations apply cleanly.
  - Run the plan 015 backfill **against the local ERPNext**: a dry run, then `--apply`, then `--apply` again (0 created).
  - Read the skipped list with the user (projects with no WO or no panels): fix them in PM first, or accept them as skipped.
- [ ] **7. (Claude, approval) Cut-over.**
  1. Put `ERPNEXT_URL` (internal), `ERPNEXT_PUBLIC_URL`, `ERP_SSO_SECRET`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` into `/root/engos-docker/.env`.
  2. The user approves; merge `erp` into `main` and push. CI then deploys automatically (backup, health check, auto-rollback).
  3. Smoke test:
     - the app's health is ok;
     - a Director's ERP button signs in;
     - the Sales Head signs in without System Manager;
     - a disabled user is refused;
     - New project shows the waiting list (empty is fine).
  4. Run the backfill on production: a dry run first, shown to the user, then `--apply` after approval, then `--apply` again (0 created).
  4b. Import the item master (plan 017): copy the xlsx into the ERPNext backend container, dry run shown to the user, `apply=True` after approval, then `apply=True` again (0 created, 0 updated).
  5. Spot-check 3 projects: the order link both ways, the ACS reference on the customer, and the per-panel dates.
- [ ] **8. (Claude) Watch for 24 hours (plan 012 step 9).** Memory morning and evening, no out-of-memory kills, app health ok, ERPNext backup present. Check the audit log for `erp.writeback_failed` and `erp.order_synced` errors.
- [ ] **9. (Claude) Close out.**
  - `PROJECT.md`: ERPNext hosting, backup and restore, and the image upgrade path (rebuild under a new tag, recreate, `bench migrate`).
  - `CLAUDE.md`: production migration state, and "ERP live since <date>".
  - Mark plans 012–016 REVIEWED and move them to `plans/done/`.
  - Tell the user what to tell the team: orders start in ERP, and New project picks them.

## Acceptance criteria
- [ ] ERPNext runs on the VPS: capped, private on `127.0.0.1`, public only over HTTPS, branded, backed up daily.
- [ ] Production runs the merged `main` with the three additive migrations. ERP is on, and SSO works for Directors and the Sales Head only.
- [ ] Every existing client has an ERPNext customer with its ACS reference. Every non-cancelled work order has an imported, linked sales order, and a re-run creates nothing.
- [ ] 24 hours with no out-of-memory kills and Engineering OS health ok.
- [ ] Docs updated, and plans 012–016 closed.

## Implementation notes (implementer / Claude)
- **Order of work:** started after 014, 015 and 017 reached DONE (not yet REVIEWED), as the user asked. Same cloud container as those plans (local ERPNext in `/var/tmp/erpnext-local`; graph / Token Savior / sequential-thinking not available here).
- **Step 1 (F12c, readable tile icons):** `acs_theme.css` section 7: the filter on the same selectors as F12b (`.icon-container img.app-icon`, `.desktop-icon img.app-icon`, `.header-logo img`, `.sidebar-header img`, `.sidebar-item-icon img`, `.dropdown-menu-item .sidebar-item-icon img`) is now `grayscale(1) contrast(8) brightness(0.9)` instead of `grayscale(100%) brightness(0.2)`. Section comment updated. No other CSS changed.
  - **Image `acs-erpnext:v16.37.0-acs9`** (local-only proxy-CA build copy as in 014–017), containers recreated, `bench --site frontend migrate` OK; backend and frontend run `acs9`.
  - **What I saw (Director via our SSO, full Chromium):** *before* (acs8): every desk tile a near-black square with a dark-grey symbol you can hardly see. *After* (acs9): desk home tiles (Organization, Accounting, Assets, Buying, Manufacturing, Quality, Selling, Stock, Subcontracting, ERP Settings) are near-ink squares with **crisp white symbols**, easy to tell apart; the Accounting folder tile shows its four mini-icons in ink on the light tile; the **Framework** tile comes out mid-grey with a white symbol (Frappe's own logo SVG has a lighter source colour than the ERPNext icons; still readable). Selling workspace: the sidebar header icon is a white symbol on an ink square. The **ACS logo** in the top bar is `.navbar-home img`, which none of the selectors match: computed `filter: none`, still in its own colours.
  - **Test counts:** acs_erp 46 OK; typecheck clean; `npm test` 168 passed; `npm run test:int` 20 files / 113 passed; build clean.

## Review (Claude)
