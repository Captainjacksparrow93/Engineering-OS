# 018 — Sales module: deals, one-click quote builder, live BOM pricing, pricing advice

**Status:** IN PROGRESS
**Author:** Claude · **Implementer:** Claude (user decision 2026-10-09: Claude implements this plan on branch `Sales-OS`)

## Goal
Give the sales team (Sales Head + 10–15 people) one place to run their work with the least effort:
deals and follow-ups, a BOM that is always priced at the latest item cost, a quotation produced in
one click on the letterhead, and rule-based advice on where to raise or lower the price based on
past data and the client relationship. Below-margin quotes need a Director's approval.

User answers (2026-10-09):
1. Latest price: last supplier purchase rate, a maintained price list (list price minus discount)
   and last BOM cost, picked by a priority order.
2. Past quotes/orders/win-loss exist in Excel/Tally; they will be loaded later → provide an import.
3. Plain rules first; AI later.
4. Relationship factors: years with us, total order value, repeat orders, payment delays, strategic flag.
5. BOM is built from scratch each time, but the system should suggest what to add from old data.
6. Sales Head + 10–15 people. A salesperson cannot see another salesperson's deals. A Director
   approves a discount below a set margin.
7. Quotation on the letterhead, with terms and GST shown (no GSTIN yet), sent through the
   salesperson's local Outlook.
8. Claude builds it on branch `Sales-OS`. 9. Start now, in parallel with ERP.

## Design decisions
- **Own tables, `sales_*`.** Deals, quotes, the sales catalogue, prices and history live in our
  Postgres (module seam: no foreign keys into `pm_*`; `User` is shared kernel). ERPNext is not live
  yet and cannot be required for daily quoting. ERPNext stays the owner of *confirmed sales orders*:
  a won deal records the ERPNext sales order name and WO number. Auto-creating the ERPNext order
  from a won deal is a later plan, once ERP (016) is live.
- **Latest price** = per item, the newest price of the highest-priority source that is not stale
  (older than `priceStaleDays`). If every source is stale, the newest price overall is used and
  flagged stale. Priority default: purchase rate → price list (net) → BOM cost; editable in settings.
  Prices are append-only (history kept).
- **Margin is on the selling price**: `price = cost / (1 − margin)`. The quote stores cost and
  margin per line; price is derived. Quote discount applies to the subtotal; freight is added
  without margin; GST is on the taxable value.
- **Approval:** a quote whose effective margin (after discount) is below `minMarginPct` goes to
  `PENDING_APPROVAL`; Directors (`sales.quote.approve`) are notified and approve or send it back.
- **Outlook:** "Email via Outlook" downloads an `.eml` draft (`X-Unsent: 1`) that opens in the
  salesperson's Outlook, addressed to the deal contact, with the quotation in the body and as an
  HTML attachment. No SMTP, no stored mail credentials, no new dependency. "Print / PDF" opens the
  letterhead page for the browser's Save as PDF.
- **Pricing advice (rules, pure functions, explainable):** relationship score → tier and margin
  adjustment; account and company win rates by margin band; deal size; per-line advice from the
  item's past won/lost margins; BOM suggestions from items that past BOMs contained together
  (co-occurrence). Each suggestion carries its reasons. An AI model can later sit behind the same
  interface.
- **Past data import:** CSV (save from Excel/Tally), one row per line. Closed deals write their
  final quote into the same history, so advice improves as the team uses the app.

## Affected code
- `prisma/schema.prisma` — new `sales_*` models and enums (additive).
- `prisma/migrations/*_sales_module` (generated) and `*_sales_permissions` (hand-written SQL: new
  permission keys, new `SALES_EXECUTIVE` role, grants by key, `ON CONFLICT DO NOTHING`).
- `src/core/rbac/permissions.ts` — `sales.*` keys; `SALES_EXECUTIVE`; `SALES_HEAD`, `DIRECTOR` grants.
- `src/core/rbac/engine.ts` — `isReadOnly` ignores `sales.*` grants so the Sales Head stays
  read-only in PM. Callers: `task.service.ts` (`addComment`), `handover.service.ts`, `pm/tasks/[id]/page.tsx`.
- `src/core/rbac/sales-head.test.ts` — the no-mutation check now applies to PM keys only.
- `src/core/modules/registry.ts`, `src/components/shell/sidebar.tsx` — Sales module tile and nav.
- New: `src/modules/sales/**`, `src/app/(shell)/sales/**`, `src/app/actions/sales.ts`,
  `src/app/api/sales/quotes/[id]/eml/route.ts`.
- `prisma/seed.ts` — sales staff created by a fresh seed get `SALES_EXECUTIVE` (create-only, as today).
- Blast radius: code-review-graph and Token Savior are **not available** in this cloud session;
  the blast radius above comes from `grep` (`isReadOnly`: 3 call sites; `SYSTEM_ROLES`: seed and
  `grant-*.ts` scripts; sidebar/registry are leaf UI).

## Permissions
| Key | Meaning | Roles |
|---|---|---|
| `sales.deal.read` | Open Sales; see own deals, shared accounts and the catalogue | Exec, Head, Director |
| `sales.deal.read.all` | See every salesperson's deals and quotes | Head, Director |
| `sales.deal.manage` | Create/edit deals, contacts, BOMs and quotes (own, or all with read.all) | Exec, Head, Director |
| `sales.account.manage` | Edit relationship factors (strategic, payment delay, customer since) | Head, Director |
| `sales.catalog.manage` | Items, prices, price-list and history imports | Head, Director |
| `sales.quote.approve` | Approve below-margin quotes | Director |
| `sales.settings.manage` | Margins, GST, terms, price priority | Director |

Existing users get the Sales Executive role from People → roles (no data migration assigns people).

## Constraints
- Branch `Sales-OS` only; never merge to `main` (a merge to `main` deploys). Additive migrations only.
- No new npm dependencies. No VPS, no production data.
- Every service ships with integration tests: allow, deny, happy path, validation failure.

## Steps
- [ ] 1. Schema + migrations + permissions + roles; `isReadOnly` fix; registry and sidebar.
- [ ] 2. Domain logic (pure, unit-tested): price resolution, quote totals, CSV parser,
      relationship score, margin suggestion, line advice, BOM suggestions.
- [ ] 3. Services + integration tests: settings, catalogue/prices/import, accounts/contacts,
      deals/activities, quotes (build, refresh, submit, approve, revise, send, accept), history import, dashboard.
- [ ] 4. UI: dashboard, pipeline, deal page, one-click quote builder with advice panel,
      approvals, accounts, catalogue, history import, settings, print page, Outlook `.eml`.
- [ ] 5. Full suite on a fresh DB built like CI; notes; INDEX.

## Acceptance criteria
- [ ] Typecheck, unit tests, build and integration tests pass on a fresh DB (migrate deploy + seed).
- [ ] A salesperson sees only their own deals; Head and Director see all.
- [ ] Adding an item to a BOM prices it at the latest price per the priority rule; stale prices are flagged; "Refresh prices" updates a draft.
- [ ] A below-margin quote cannot be sent until a Director approves it.
- [ ] The quote page shows a suggested margin with reasons, per-line raise/lower advice and "often added" items.
- [ ] History CSV import feeds the advice; closing a deal adds its quote to history.
- [ ] Print page shows letterhead, terms and GST; "Email via Outlook" downloads an `.eml` draft.

## Implementation notes (implementer)

## Review (Claude)
