# 022 — Native ERP: every ERPNext module, built into Engineering OS

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Claude (user decision 2026-10-13, phase by phase) · **Branch:** `ERPNEXT`
**Supersedes:** 012 part B, 016 (ERPNext release), 021. Plans 013–015 and 017 are retired with the ERPNext code they built.

## Goal
User decision (2026-10-13): **build ERP natively inside Engineering OS** (Next.js + Prisma + Postgres, one login, one design system, one permission model), using ERPNext/Frappe **only as the functional benchmark**. ERPNext is dropped: no ERPNext containers, no `acs_erp`, no SSO pass, no REST client. This reverses the 2026-10-01 and 2026-10-11 "keep ERPNext" decisions.

Scope: every standard ERPNext module an engineering company (control-panel builder) uses, with the same document workflows (draft → submitted → cancelled, partial fulfilment, status roll-ups, perpetual inventory, double-entry books), wired into PM, Sales and HRMS.

User answers (2026-10-13):
1. Native ERP; drop ERPNext.
2. Accounts: **full books** (double-entry GL, chart of accounts, journals, invoices, payments, AR/AP ageing, P&L, balance sheet, Apr–Mar FY, INR, GST fields, no GSTIN yet). The CA keeps statutory filing.
3. Order: **operations first**.
4. Claude builds each phase on `ERPNEXT`, tests it, commits, pushes, and opens a draft PR. Never merges to `main`.

## Design (applies to every phase)
- **Tables:** `erp_*`, one Prisma model per document header plus its lines. Everything carries `companyId`. Additive migrations only.
- **Document life cycle** (ERPNext `docstatus`): `DRAFT` (editable, deletable) → `SUBMITTED` (posts stock/GL, read-only) → `CANCELLED` (reverses its postings; never deleted). Statuses such as "To receive and bill" are derived from line fulfilment, as in ERPNext.
- **Naming series:** `erp_series` counter per company and prefix: `MAT-MR-2026-00001`, `PUR-ORD-2026-00001`, `SAL-ORD-…`, `ACC-SINV-…` and so on. Gap-free under concurrency (row lock in the posting transaction).
- **One posting engine, from day one.** Stock and GL entries are written only by `posting.ts` inside the submit/cancel transaction:
  - stock ledger (`erp_stock_ledger`) + bins (`erp_bins`), **moving-average valuation**, negative stock refused;
  - general ledger (`erp_gl_entries`), every voucher balanced (Σ debit = Σ credit, refused otherwise), with party (AR/AP) and project dimensions.
  - Perpetual inventory, as in ERPNext: Purchase Receipt Dr Stock In Hand / Cr Stock Received But Not Billed; Purchase Invoice Dr SRBNB (+ Input GST) / Cr Creditors; Delivery Dr Cost of Goods Sold / Cr Stock; Sales Invoice Dr Debtors / Cr Sales (+ Output GST); Payment Dr/Cr Bank vs party; stock adjustments vs Stock Adjustment; manufacture Dr FG, Cr raw material + operating cost absorbed.
  - Because the books post from phase 1, phase 7 adds screens and reports, not retro-posting.
- **Chart of accounts:** a standard Indian chart, seeded per company on first ERP use (idempotent), with fiscal years Apr–Mar.
- **GST:** item GST rate; company state vs party state → CGST+SGST or IGST. GSTIN fields exist but stay empty (no GSTIN yet).
- **Item master:** `erp_items` is the company item master. A Sales catalogue item with the same code is linked (`sales_items.erpItemCode`), and every submitted Purchase Receipt appends a `PURCHASE` price to it, so Sales quotes price at the true last purchase rate (plan 018's priority order). A BOM's rolled-up cost appends `BOM_COST`.
- **Clients:** an ERP customer links to the PM client (`pm_clients.erpCustomer` holds the customer code) and gets the next `ACS-XXXX` reference the first time a project uses it (the plan 014 rule, now local). The Sales account links by name.
- **Order → project (plan 014/015 rules kept, source swapped):** New project's first step picks a submitted Sales Order with no project; panel lines (item code = checklist template code) prefill the panels; saving writes the project onto the order. Order changes after the project exists follow the plan 015 safe-sync rules (PO/dates/WO/client follow, added panels appended, removals and cancellations only alert).
- **Won deal → draft Sales Order** from the deal's latest quote (Directors/Sales Head submit it).
- **Permissions:** `erp.<area>.read` / `erp.<area>.manage` (+ `erp.accounts.*`, `erp.settings.manage`), hand-written SQL migration, `ON CONFLICT DO NOTHING`, roles joined by key. New roles: Purchase, Store Keeper, Accounts, Production, Quality, Maintenance. Directors get everything; Sales Head gets Selling + stock read.
- **UI:** our own screens in the existing design system (`docs/design-system.md`): `/erp` home with area cards and to-dos, one list + form + detail per document, printable documents under `(print)`. The Production, QMS and Maintenance tiles go live as ERP areas.
- **No new npm dependencies.** Money and quantity maths use Prisma `Decimal` at the boundary and integer paise / milli-units inside `domain/` helpers, so totals never drift.

## Phases (one commit series and draft PR update each; each is reviewable)
| # | Phase | ERPNext benchmark covered |
|---|---|---|
| 1 | **Foundation + Stock** | Company ERP settings, naming series, chart of accounts, fiscal year, GL engine; Warehouse, Item (groups, UOM, GST, reorder), Stock Entry (Material Receipt / Issue / Transfer), Stock Reconciliation (opening stock), Stock Ledger, Stock Balance, reorder report. Retire the ERPNext SSO, image and secret (the order/sync client PM still calls is replaced in phase 3). ERP home. |
| 2 | **Buying** | Supplier, Material Request (purchase/transfer/issue, project-tagged), Supplier Quotation + comparison, Purchase Order, Purchase Receipt (accepted/rejected qty), Purchase Invoice, purchase status roll-ups, Sales last-purchase-price feed. |
| 3 | **Selling + PM** | Customer, Sales Order (WO, client PO, panels, delivery dates, from won deal), Delivery Note, Sales Invoice; PM New project from native SO; safe sync; ERPNext order code paths removed. |
| 4 | **Manufacturing** | Workstation, Operation, BOM (multi-level, operations, cost roll-up), Work Order (from SO line, transfer to WIP, manufacture with valuation), Job Card (time logs), Production Plan (from open SOs: shortages → Material Requests, Work Orders). Production tile live. |
| 5 | **Quality** | Quality Inspection Template + Inspection (incoming on receipt, in-process on work order, outgoing on delivery; "inspection required" blocks submit), Non Conformance + corrective/preventive action, controlled documents with revisions and approval. QMS tile live. |
| 6 | **Assets + Maintenance** | Asset register (category, value, location), straight-line depreciation schedule + posting, preventive Maintenance Schedule + logs, breakdown/repair with downtime and cost. Maintenance tile live. |
| 7 | **Accounts** | Chart of accounts UI, Journal Entry, Payment Entry (receive/pay, allocation to invoices, advances), credit/debit notes (returns), bank accounts + reconciliation, period closing; General Ledger, Trial Balance, P&L, Balance Sheet, AR/AP ageing, GST summary, project profitability. |
| 8 | **Dashboards + PM** | ERP home dashboard, buying/selling/stock analytics, PM project Materials panel (requested/ordered/received/issued/value), CSV exports. |

Out of scope (now): Tally/Zoho, GST e-invoicing / e-way bills (no GSTIN), multi-currency, multi-company consolidation, payroll in ERP (HRMS owns it), POS, e-commerce, CRM (Sales owns it), Support/Helpdesk (PM service calls own it), the test branch.

## Affected code
- New: `src/modules/erp/**` (domain, services, validation, tests) replaces the ERPNext client modules (`client.ts`, `sso.ts`, `sync.ts`, `order.service.ts`, `backfill.ts`), which are deleted or rewritten in place behind the same exported names where PM calls them (`isErpEnabled`, `listWaitingOrders`, `getOrderForProject`, `resolveClientForCustomer`, `writeProjectToOrder`, `syncProjectOrderSafely`, `syncAllOrdersSafely`).
- Callers (text search; code-review-graph and Token Savior are **not available** in this cloud session):
  - `src/modules/project-management/services/automation-project.service.ts` (`isErpEnabled`, order functions);
  - `src/modules/project-management/services/project.service.ts` (sync);
  - `src/app/actions/erp-orders.ts`, `src/app/(shell)/pm/projects/new/*` (sales-order step);
  - `src/modules/admin/services/admin.service.ts` (`buildPass`);
  - `src/app/erp/open/route.ts` (SSO, deleted);
  - `src/app/(shell)/erp/page.tsx` (rewritten as the ERP home).
- `src/core/rbac/permissions.ts`, `src/core/modules/registry.ts`, `prisma/schema.prisma`, `prisma/migrations/*` (additive), `erp/` folder (ERPNext image, deleted).
- Existing columns kept (live-data rule): `pm_projects.erpSalesOrder`, `erpOrderModified`, `erpOrderAlert*`, `pm_tasks.erpOrderItem`, `pm_clients.erpCustomer`, `sales_items.erpItemCode`, `sales_deals.erpSalesOrder`. They now hold native document names.

## Constraints
- The app is LIVE. Work on `ERPNEXT` only. Never push or merge to `main`. Never touch the VPS or production data.
- Migrations additive; permissions in hand-written SQL; no `grant-*.ts`; nothing in `entrypoint.sh` beyond what exists.
- Every service change ships with integration tests covering allow, deny, the happy path and validation failure. Tests create their own company, so they never depend on production-copy data.
- Posting is the only writer of stock/GL tables. A submitted document is never edited; cancelling reverses it. A cancelled document is never deleted.
- No new npm dependencies.

## Tools & skills
- Code-review-graph and Token Savior are **not available** in this cloud session (named here per the rules). Blast radius was taken from `grep` over `src/` and is listed under Affected code. `sequential-thinking` is not available either. The posting rules were reasoned through in the plan's Design section instead.
- Skills: `ponytail` (full), `tdd` for the domain maths (valuation, GL balance, GST split), `ux-writing` for UI text, `impeccable` for screens.
- Tests: `npm run typecheck && npm test && npm run build` and `npm run test:int` against a fresh DB built like CI (`prisma migrate deploy`, `db:seed`). Pass/fail counts per phase go under Implementation notes.

## Acceptance criteria (whole plan)
- [ ] Phases 1–8 each DONE with the full suite green.
- [ ] No ERPNext code, container, env var or SSO path remains.
- [ ] Every submitted voucher's GL balances; the trial balance totals match; stock value in the GL equals the stock ledger value.
- [ ] Won deal → SO → project → MR → PO → receipt → work order → QI → delivery → invoice → payment works end to end in an integration test.
- [ ] The Production, QMS and Maintenance tiles are live.

## Implementation notes (implementer)

### Phase 1: foundation + stock (DONE 2026-10-13)
- **Removed:** `erp/` (Frappe image + `acs_erp`), `src/modules/erp/sso.ts` + test, `src/app/erp/open` (SSO route), `erp-access.int.test.ts`, the ERPNext user-disable call in `setUserStatus`, `ERP_SSO_SECRET` (config, CI, compose, `.env.example`). CI now also runs on pushes to `ERPNEXT` (was `erp`). `client.ts` / `order.service.ts` / `sync.ts` / `backfill.ts` stay until phase 3 swaps PM's order source; they are inert without `ERPNEXT_URL`.
- **Migrations:** `20261013183554_erp_foundation_stock` (settings, series, accounts, GL, warehouses, items, bins, stock ledger, stock entries, reconciliations; new tables only) and `20261013183600_erp_permissions` (15 `erp.*` keys, roles Purchase Manager, Store Keeper, Accounts Manager, Production Manager, Quality Manager, Maintenance Manager; Director and Super Admin get every ERP key; Sales Head gets `erp.access`, selling read/manage, stock read).
- **Engine:** `services/posting.ts` (bin row locks in sorted order, moving average, negative stock refused unless allowed in settings, balanced GL with ≤ ₹1 round-off, closed-books guard, cancel = reversing rows flagged cancelled). Maths in `domain/money.ts` uses Prisma `Decimal` throughout (not integer paise as first planned; exact either way).
- **Setup:** `ensureErpSetup` seeds the Indian chart (66 accounts, system keys), Stores/WIP/Finished Goods/Rejected, and settings on first ERP use per company.
- **Items:** creating or editing an ERP item creates or updates the Sales catalogue item with the same code (`erpItemCode`), so there is one item master.
- `isReadOnly` (PM read-only) now ignores `erp.*` grants, like Sales/Gate/HR; `sales-head.test.ts` allows `erp.selling.*` (Sales Head creates sales orders, decision 2026-10-01).
- **UI:** `/erp` home (area cards), `/erp/stock` overview, items (list, add, edit, switch off, stock by warehouse, movements), stock entries (draft → lines → submit/cancel/delete, ledger shown), stock counts (opening/adjustment), warehouses, reports (balance with projected qty, ledger, reorder), `/erp/settings` (company state, default GST, negative stock, chart of accounts). Sidebar ERP section.
- **Tests:** `domain/valuation.test.ts` (7), `stock.int.test.ts` (9: setup, allow/deny, items + Sales sync, receipt + GL balance, issue/negative stock/transfer, cancel guard, opening stock vs GL, reorder, default warehouse). Fixture `test-fixture.ts` makes a throwaway company.
- **Full suite** on a fresh DB (`migrate deploy` + `db:seed`): typecheck clean · unit 226/226 · integration 170/170 · build OK. Browser check (Chromium, Director): add item → receipt draft → add line → submit → GL shown → overview value ₹3,600.
- Tools: code-review-graph, Token Savior and sequential-thinking are not available in this cloud session; blast radius by `grep`.

### Phase 2: buying (DONE 2026-10-13)
- **Migration** `20261013184955_erp_buying` (new tables only): `erp_parties` (customers + suppliers, GSTIN/PAN/state/terms/credit limit, `clientId` for phase 3), material requests, supplier quotations, purchase orders, purchase receipts, purchase invoices (+ lines). No permission change (keys came in phase 1).
- **Material request** (purchase / transfer / issue, project-tagged): submit raises the bin's requested qty; purchase orders and stock entries fulfil lines (`applyMaterialRequestProgress`, hooked into stock entry submit/cancel); Stop / Re-open; "Request what's below reorder level" builds one draft from the reorder list (projected qty, so stock on order counts); transfer/issue requests make a draft stock entry.
- **Supplier quotation** (from a request or blank) and **comparison** of valid quotes per item, cheapest first; quotation → purchase order.
- **Purchase order**: GST by supplier state vs company state (`domain/totals.ts`, tax per rate on the taxable total); submit raises ordered qty and settles request lines; derived status (To receive and bill → To bill / To receive → Completed, Closed, Cancelled) and % received / % billed; Close / Re-open release / restore the ordered qty; cancel only before receipts or invoices; drafts made from a request or an order never double-count open quantity already on another draft.
- **Purchase receipt**: from an order or without one; accepted qty into stock at the order rate (Dr Stock In Hand / Cr SRBNB), rejected qty into the Rejected warehouse at no value; over-receipt refused; updates the item's last purchase rate and adds a `PURCHASE` price (supplier, receipt no.) to the Sales catalogue (removed again if the receipt is cancelled); a hook (`registerInspectionCheck`) is ready for phase 5.
- **Purchase invoice**: from a receipt, from an order (received stock + services) or typed-in charges to an expense / fixed-asset account; Dr SRBNB at receipt value, price difference to Stock Adjustment, Dr Input GST, Cr Creditors (party, against the invoice); duplicate supplier bill no. refused; due date from payment terms; derived Unpaid / Overdue / Partly paid / Paid. Cancel only while nothing is paid.
- **Print**: one letterhead route `/print/erp/[kind]/[id]` (`services/print.service.ts`); purchase order registered.
- **UI**: `/erp/buying` overview (requests to buy, orders to arrive, bills to pay) + tabs: material requests, supplier quotations (+ compare), purchase orders, receipts, purchase invoices, suppliers (with balance from the ledger). Inline line editing for drafts. Sidebar: Buying.
- **Tests**: `domain/totals.test.ts` (2), `buying.int.test.ts` (11: supplier allow/deny/validation, requested qty, quotation compare, PO IGST + ordered qty, partial/rejected/over-receipt, invoice with price variance clears SRBNB, cancel chain restores everything, close/re-open, service + charge + duplicate bill, reorder request, transfer request → stock entry).
- **Full suite** (fresh DB): typecheck clean · unit 228/228 · integration 181/181 · build OK. Browser (Director): supplier → request → order (rate edit) → receive → invoice with bill no.; GL rows shown at each step; no page errors.

### Phase 3: selling + PM (DONE 2026-10-13)
- **Migration** `20261013190949_erp_selling` (new tables: sales orders, delivery notes, sales invoices + lines; two additive `erp_settings` columns: `projectsFromSalesOrders` default **off**, `salesTerms`).
- **ERPNext retired:** deleted `client.ts` (+ test), `backfill.ts` (+ test, `prisma/scripts/erp-backfill.ts`), `scripts/verify_browser.py`, the ERPNext-mocking tests (`order.service`, `order-to-project`, `sync` int tests; coverage ported to `selling.int.test.ts`), and every `ERPNEXT_*` variable (config, compose, `.env.example`). `order.service.ts` and `sync.ts` keep their exports and plan 014/015 rules but read our own sales orders; `isErpEnabled()` became `projectsNeedSalesOrder(companyId)` (the ERP setting).
- **Decision taken here (Claude, safe rollout):** the "every work order starts from a sales order" rule is an ERP setting a Director switches on. Off (default) = New project behaves as today but still lists waiting orders, plus "Start without a sales order". This avoids blocking production project creation on the day ERP ships. Confirm with the user.
- **Panels:** every active checklist template is a sellable stock item (group Panels, Finished Goods), created on first Selling use; plus a FREIGHT service item. Panel lines (item = template code) become PM panels; other lines (freight, services, spares) stay commercial and are ignored by PM and sync.
- **Sales order:** GST by customer state; WO digits-only and unique (orders + projects); delivery date required to submit (target = order date or the latest line date); credit-limit check on submit (ledger balance + unbilled open orders + this order); reserves stock; Hold / Release, Close / Re-open, cancel only before deliveries/invoices; after submit the PO, WO, delivery date and lines can still change, bumping `updatedAt` so PM's sync follows. Order → project writes `projectId`; customer → PM client with lazy ACS-XXXX; customer renames cascade to the client and its projects.
- **Delivery note:** from the order; stock out at valuation, Dr Cost of Goods Sold / Cr Stock (project-tagged); over-delivery refused; transporter, vehicle, LR; inspection hook for phase 5.
- **Sales invoice:** from the order, a delivery, or typed-in income lines; Dr Debtors (party, against invoice) / Cr Sales or Service Income (project-tagged) + Output GST; a delivery line is also capped by what's left to bill on its order (no double billing).
- **Won deal → draft sales order** (`selling-bridge.ts`, in the same transaction as `closeDeal`): customer from the Sales account, one line per quote panel group (item = template the group name starts with) at the discounted group price, freight line, quote terms, WO if digits and free. The close-deal form no longer asks for an ERPNext order name; the deal links to the order.
- **Print:** sales order (Order Acknowledgement), delivery challan (no prices), tax invoice.
- **UI:** `/erp/selling` overview (waiting for a project, to deliver, money to collect) + orders, deliveries, invoices, customers (balance, credit limit, ACS ref, orders, invoices); `/erp/selling/orders/number/[number]` for links from PM and Sales; ERP settings gained the project rule and sales terms; sidebar Selling.
- **Tests:** `selling.int.test.ts` (13: panel items, customer allow/deny, order validation + reservation, credit limit, rule on → WO needs order, waiting list → project with links + ACS ref + order wins over the browser, hold/draft refused, sync of PO/date/added panel + Director alert + idempotent, customer rename cascade, delivery at cost + over-delivery, invoice GL + no double billing + cancel chain, cancelled order only alerts, won deal → draft order). `sales.int.test.ts` updated: a won deal records the native draft order.
- **Full suite** (fresh DB): typecheck clean · unit 219/219 · integration 151/151 · build OK (counts dropped because the ERPNext client/backfill/mock tests were removed). Browser (Director): customer → sales order with 2 × PLC → submit → New project lists it → picking it locks client, WO and dates. Bug found and fixed in the browser run: panel items were only created on first project pick, so the first order line failed; now created on first Selling use.
- **Not done yet (later phases):** native backfill of existing projects into imported sales orders (decision 2026-10-01) → phase 8.

### Phase 4: manufacturing (DONE 2026-10-13)
- **Migration** `20261013193405_erp_manufacturing` (new tables only): workstations, BOMs (+ items, operations), work orders (+ items), job cards (+ time logs), production plans (+ items).
- **Workstation:** hourly rate and capacity.
- **BOM:** materials + operations; cost rolls up (material rate = stock valuation, else last purchase rate, else the sub-assembly's own BOM; operation = minutes × workstation rate); multi-level (a material with its own default BOM is a sub-assembly), loops refused; submit → default if first, and a `BOM_COST` price for the item in the Sales catalogue; Update cost, Make default, Switch off, Copy as new revision, cancel only when unused.
- **Work order:** manual, from a sales order's lines ("Make work orders" on the order: one per line not yet covered, carrying the order's PM project), or from a production plan. Submit lists materials (single level), creates job cards per operation and raises the bin's planned qty. Transfer materials (Stores → WIP, partial allowed) and Finish (consume from WIP, finished item into Finished Goods; operating cost from job-card time if logged, else the BOM's operation cost, posted to Expenses Included In Valuation). Stop / Resume, cancel only without live entries; its stock entries are cancelled newest first from the work order page.
- **Job card:** time logs per person (overlaps refused), finished quantity, auto status, Mark complete.
- **Production plan:** pull open sales-order lines without work orders (items with a default BOM) or add items; materials across all BOM levels against projected stock; Make work orders; Request shortages (one draft purchase request).
- **Tiles and links:** the Production module tile is live and opens ERP Manufacturing (`/production` redirects); sidebar Manufacturing; ERP home card live.
- **Tests:** `manufacturing.int.test.ts` (6: workstation allow/deny, multi-level BOM cost + Sales BOM_COST + loop guard, work orders from a sales order + job cards + planned qty, transfer/finish priced by logged time → completed with balanced GL, newest-first cancel, production plan shortages → purchase request + work orders).
- **Full suite** (fresh DB): typecheck clean · unit 219/219 · integration 157/157 · build OK. Browser (Director): workstation → BOM for PLC with a material and a wiring operation → submit (cost shown) → work order → submit → move to WIP → finish → Completed; manufacturing, job cards, plans and `/production` load with no page errors.

## Review (Claude)
