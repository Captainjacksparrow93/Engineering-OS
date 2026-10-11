# 021 — ERP: every standard module, wired into Engineering OS

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Claude (user said "go ahead" on 2026-10-11 after being offered Claude or Antigravity; confirm before step 1) · **Branch:** `ERPNEW` · **Depends on:** `erp` merged into `ERPNEW` (done 2026-10-11, `da2523f`)

## Goal
User decision (2026-10-11): **keep ERPNext and integrate it into the existing system**, covering the standard modules an engineering company (control-panel builder) runs on. Plans 012–017 built the base: SSO, the ERP entry, the `acs_erp` theme, order → project, backfill, safe sync and the item master. Today, though, ERP is one tile that opens ERPNext's home page, for Directors and the Sales Head only. The rest of the app doesn't know about purchase, stock, production, quality or accounts.

What this plan delivers:
1. **ERPNext set up as a working plant ERP.** Selling, Buying, Stock, Manufacturing (BOM, Work Order, Job Card), Quality, Accounts and Maintenance are switched on. Warehouses, UOMs and naming series are configured. ERPNext's Projects module stays hidden (decision 2026-10-01).
2. **One place to start from.** The `/erp` page and module launcher show one card per ERP area: Sales, Purchase, Stores, Production, Quality, Accounts and Maintenance. Each opens the matching ERPNext workspace, already signed in. The `production`, `qms` and `maintenance` "coming soon" tiles become live entries into ERPNext's Manufacturing, Quality and Maintenance.
3. **People beyond Directors and the Sales Head.** New roles in our app (Purchase, Stores, Accounts, Production, Quality) map to the matching ERPNext roles through the existing SSO pass.
4. **Sales module → ERPNext.** Marking a deal **Won** creates a **draft** ERPNext Sales Order from the deal's latest quote: customer via the lazy ACS reference, panel lines, value and WO. Today the salesperson types the SO name in. A Director or the Sales Head confirms the draft in ERPNext, and plan 014's New project picks it up as today.
5. **Project materials in PM.** Material Requests, Purchase Orders, receipts and stock issued in ERPNext carry the PM project code. The PM project page gets a read-only **Materials** panel: what is requested, ordered, received and issued, and its value. PM stays the place for projects; ERPNext stays the place for material and money.

Out of scope: our own ERP screens (rejected 2026-10-01 and again 2026-10-11), Tally/Zoho, GST e-invoicing (no GSTIN yet), payroll in ERPNext (HRMS plan 020 owns it), and the test branch.

## Affected code
- `src/modules/erp/sso.ts`: `rolesFor`, `ERP_ROLES_DIRECTOR`, `ERP_ROLES_SALES_HEAD`; new per-role lists; the pass carries a target path.
- `src/app/erp/open/route.ts`, `GET`: accepts `?to=<area>` and maps it to a fixed Desk path (allow-list, never a raw URL).
- `erp/acs_erp/acs_erp/sso.py`, `login`: redirects to the path in the signed pass, if it is on the same allow-list, instead of always `/app`.
- `erp/acs_erp/acs_erp/install.py` + `fixtures/` + `patches/`: module setup, warehouses, `custom_project_code` on Material Request / Purchase Order / Purchase Receipt / Stock Entry / Purchase Invoice.
- `src/core/modules/registry.ts`, `MODULES`: `production`, `qms` and `maintenance` become LIVE and point at ERP areas; ERP gets its area list.
- `src/app/(shell)/erp/page.tsx`, `ERPPage`: area cards shown by role.
- `src/app/(shell)/production|qms|maintenance/page.tsx`: from `ComingSoon` to an ERP area entry.
- `src/modules/sales/services/deal.service.ts`, `closeDeal`: on WON with ERP on, creates the draft order through `src/modules/erp/client.ts` (`erpInsert`) and stores its name in `erpSalesOrder`.
- `src/modules/erp/order.service.ts`, `resolveClientForCustomer`: reused, in reverse (our client → ERPNext customer).
- `src/modules/erp/` (new) `materials.service.ts`: reads project materials live from ERPNext.
- `src/app/(shell)/pm/projects/[id]/page.tsx`: Materials panel.
- `prisma/migrations/`: one hand-written SQL migration for new roles and `erp.*` permission keys. No table changes are expected.
- **Blast radius:** to fill in at step 0 with code-review-graph (see Tools & skills). In this cloud session neither code-review-graph nor Token Savior was available. Affected code above comes from `grep` and reading the files, and the merged branch was checked by the full test suite instead (typecheck clean, unit 229/229, integration 166/166, build OK). Known callers from text search:
  - `closeDeal` is called from `src/app/actions/sales*` and `sales.int.test.ts`.
  - `rolesFor` is called from `src/app/erp/open/route.ts` and `sso.test.ts`.
  - `MODULES` is read by the module launcher and the sidebar.

## Constraints
- The app is LIVE. Work on `ERPNEW` only. Never push or merge to `main` (a push auto-deploys). Never touch the VPS or production data.
- **One release:** this ships with plan 016, not before. 016's cut-over merges `ERPNEW` (not `erp`) into `main`.
- **No partial-ERP behaviour on `main`:** every new path is behind `isErpEnabled()` / `ERPNEXT_PUBLIC_URL`. With ERP off (CI, today's production), the app behaves exactly as today, and the three tiles stay "coming soon".
- **Permissions:** new roles and permission keys go in a hand-written SQL migration (`npx prisma migrate dev --create-only --name erp_area_roles`). Insert into `core_permissions` with `ON CONFLICT (key) DO NOTHING`, and join roles to permissions by `key`. No `grant-*.ts` scripts.
- **The SSO target is never free text:** `to` is one of a fixed set of area keys, both in our app and in `acs_erp`. Anything else falls back to `/app`, which prevents an open redirect.
- **Frappe gotcha:** no Custom DocPerms in fixtures; use standard ERPNext roles only.
- **ERPNext is the record for material and money.** PM never writes stock or accounts. Our app writes to ERPNext only: (a) the draft Sales Order from a won deal; (b) plan 014's write-back.
- **Won deal → draft only:** never submit the order from our app. If ERPNext is down, the deal still closes as Won. The draft is created on a retry button ("Create ERP order") on the deal, and the failure is audited.
- No new npm dependencies. Tests mock `src/modules/erp/client.ts`, not `fetch`. Every ERPNext image rebuild gets a new tag.
- RAM: no new ERPNext containers or apps; only settings and fixtures inside the existing `acs-erpnext` image (VPS budget, `CLAUDE.md`).

## Open questions (ask the user at step 0; defaults are in brackets)
1. **Who gets which area.** Default: Directors get all areas; Sales Head gets Sales plus read access elsewhere; new roles get their own area: Purchase Head / Purchase Executive → Purchase + Stores read; Store Keeper → Stores; Accounts → Accounts; Production Head → Production + Stores; Quality → Quality. Department heads follow the deferred permission model later.
2. **Accounts depth.** Default: ERPNext's full books (standard chart, Apr–Mar FY, INR) for invoices, payments and receivables/payables. The CA keeps statutory filing. No GSTIN yet.
3. **Warehouses.** Default: Stores, Work In Progress, Finished Goods, Rejected, at one site.
4. **Production granularity.** Default: one ERPNext Work Order per panel line of the sales order, with Job Cards per stage (fabrication, busbar, wiring, testing, dispatch, as in the old registry scope).

## Tools & skills (implementer: follow these)
- **Setup:** `git checkout ERPNEW`. Point Token Savior at this project ("Project management") and update the code-review-graph. Load `ponytail` (full) and the skills below.
- **Check first (graph):**
  - callers of `closeDeal`, `rolesFor`, `buildPass`, `resolveClientForCustomer` and `isErpEnabled`;
  - importers of `src/core/modules/registry.ts` and `src/modules/erp/client.ts`;
  - blast radius of `deal.service.ts` and `src/app/erp/open/route.ts`;
  - affected flows for "close a deal" and "open ERP".
  - Paste the real output into "Affected code" before step 1.
- **Read (Token Savior):** `closeDeal`, `CloseDealInput` (`src/modules/sales/validation.ts`), `buildPass`, `verifyPass`, `rolesFor`, `GET` in `src/app/erp/open/route.ts`, `login` in `acs_erp/sso.py`, `resolveClientForCustomer`, `erpInsert`, `erpList`, `ProjectPage`.
- **sequential-thinking:** required for step 4 (won deal → draft order: idempotency, retry, ERP down) and step 5 (which ERPNext doctypes and states count as requested / ordered / received / issued).
- **Skills:** `ponytail` (full) · `tdd` (tests first) · `review-delta` (before DONE) · `ux-writing` + `impeccable` for the ERP cards, the deal retry and the Materials panel.
- **Tests:** `npm run typecheck && npm test && npm run build` and `npm run test:int`. Before DONE, run on a fresh DB built like CI (empty DB → `npx prisma migrate deploy` → `npm run db:seed`, with CI's env from `.github/workflows/ci.yml`). Paste the pass/fail counts into Implementation notes.
- **ERPNext side:** local stack at `C:\Users\Dhruv-Home\erpnext-local` (v16.37.0). Bump the image tag (`…-acsN`) and run `bench --site frontend migrate` before verifying. Verify in a real browser through our SSO, as each role.
- If a tool is missing or fails, say so in Implementation notes.

## Steps
- [ ] **0. Confirm.** The user answers the open questions (or accepts the defaults) and confirms the implementer. Fill in the blast radius.
- [ ] **1. ERPNext setup (acs_erp, no `src/`).**
  - Enable the modules listed in Goal.
  - Create the warehouses, default UOMs (Nos, Set, Mtr, Kg) and naming series.
  - Add `custom_project_code` (Data, searchable, in list view) to Material Request, Purchase Order, Purchase Receipt, Stock Entry and Purchase Invoice.
  - Keep Projects hidden.
  - Do all of this as idempotent install/patch code. A re-run changes nothing.
- [ ] **2. Area roles.** One migration adds the new roles and `erp.area.<key>` permission keys (`sales`, `purchase`, `stores`, `production`, `quality`, `accounts`, `maintenance`), with `erp.access` granted alongside. `rolesFor` maps each role to its ERPNext roles; Director keeps System Manager, and nobody else gets it. Unit tests cover every role, including "no ERP role → nothing".
- [ ] **3. One-click into each area.**
  - `/erp/open?to=<area>` puts the area key in the signed pass, and `acs_erp` redirects to that area's workspace. Allow-list on both sides; an unknown key goes to `/app`.
  - `/erp` shows the area cards the user may open.
  - `production`, `qms` and `maintenance` become LIVE entries when ERP is on, and stay "coming soon" when it's off.
  - Tests: allow, deny, unknown area, ERP off.
- [ ] **4. Won deal → draft ERPNext Sales Order.**
  - With ERP on, `closeDeal(WON)` builds the draft from the deal's latest quote (customer via ACS reference, one line per panel, WO, value, delivery date). It stores the order name in `erpSalesOrder`.
  - Idempotent: a deal that already has `erpSalesOrder` creates nothing.
  - If ERPNext fails: the deal is still Won, the failure is audited, and the deal shows "Create ERP order" to retry.
  - The manual SO field stays for ERP off.
  - Integration tests (ERP client mocked): happy path, retry, ERP down, already linked, a salesperson closing someone else's deal (deny).
- [ ] **5. Materials panel on the PM project.** `materials.service.ts` lists Material Requests, Purchase Orders, Purchase Receipts and Stock Entries (Material Issue / Transfer) with `custom_project_code = project.code`, grouped with totals. The project page shows it to people who can read the project. If ERPNext is down, it shows "Materials aren't available right now" and the rest of the page loads. Each row opens in ERPNext through SSO. Tests: allow, deny, ERP down, empty.
- [ ] **6. End to end on the local ERPNext, in the browser.**
  - Won deal → draft SO → Director confirms → New project picks it → Material Request with the project code → PO → receipt → issue to WIP → Work Order and Job Cards → Quality Inspection → Sales Invoice → payment.
  - Check the Materials panel at each stage. Sign in as each new role and confirm that it sees only its own areas.
- [ ] **7. Hand over to plan 016.** Add to 016's cut-over: the new migration, the ERPNext patches, and the area roles given to real people (user-approved list).

## Acceptance criteria
- [ ] Typecheck, unit tests, build and integration tests pass (full suite, fresh DB built like CI)
- [ ] With ERP off, the app behaves exactly as today (existing tests unchanged; three tiles still "coming soon")
- [ ] Each ERP area opens already signed in, only for roles that hold it; unknown areas can't redirect anywhere else
- [ ] A won deal creates exactly one draft ERPNext Sales Order; ERP down never blocks closing the deal
- [ ] The PM project page shows the project's material requests, orders, receipts and issues from ERPNext, read-only
- [ ] ERPNext setup re-runs with no changes; no Custom DocPerms; Projects module still hidden
- [ ] Browser check done as Director, Sales Head and each new role

## Implementation notes (implementer)

## Review (Claude)
