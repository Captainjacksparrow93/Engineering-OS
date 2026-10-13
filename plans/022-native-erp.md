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
| 1 | **Foundation + Stock** | Company ERP settings, naming series, chart of accounts, fiscal year, GL engine; Warehouse, Item (groups, UOM, GST, reorder), Stock Entry (Material Receipt / Issue / Transfer), Stock Reconciliation (opening stock), Stock Ledger, Stock Balance, reorder report. Retire ERPNext code. ERP home. |
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
_Per phase, below._

## Review (Claude)
