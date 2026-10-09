# 018 — Sales module: deals, one-click quote builder, live BOM pricing, pricing advice

**Status:** DONE (waiting for the user's review)
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
- [x] 1. Schema + migrations + permissions + roles; `isReadOnly` fix; registry and sidebar.
- [x] 2. Domain logic (pure, unit-tested): price resolution, quote totals, CSV parser,
      relationship score, margin suggestion, line advice, BOM suggestions.
- [x] 3. Services + integration tests: settings, catalogue/prices/import, accounts/contacts,
      deals/activities, quotes (build, refresh, submit, approve, revise, send, accept), history import, dashboard.
- [x] 4. UI: dashboard, pipeline, deal page, one-click quote builder with advice panel,
      approvals, accounts, catalogue, history import, settings, print page, Outlook `.eml`.
- [x] 5. Full suite on a fresh DB built like CI; notes; INDEX.

## Acceptance criteria
- [x] Typecheck, unit tests, build and integration tests pass on a fresh DB (migrate deploy + seed).
- [x] A salesperson sees only their own deals; Head and Director see all.
- [x] Adding an item to a BOM prices it at the latest price per the priority rule; stale prices are flagged; "Refresh prices" updates a draft.
- [x] A below-margin quote cannot be sent until a Director approves it.
- [x] The quote page shows a suggested margin with reasons, per-line raise/lower advice and "often added" items.
- [x] History CSV import feeds the advice; closing a deal adds its quote to history.
- [x] Print page shows letterhead, terms and GST; "Email via Outlook" downloads an `.eml` draft.

## Implementation notes (implementer)
Implemented by Claude on `Sales-OS` (user decision 2026-10-09). Commits: `plan 018: step 1` … `step 4`.

**What a salesperson gets**
- **Sales overview** (`/sales`): pipeline and weighted pipeline, won and win rate (90 days), follow-ups due (with Done), approved quotes not yet sent, deals gone quiet; the Head also sees a team table. Salespeople land here after sign-in (`homePath`).
- **Deals** (`/sales/deals`): pipeline board by stage, search, stage and (Head) owner filters, recently closed. Deal page: stage buttons, activity log with follow-up dates, contact, details, Mark won (records the ERPNext sales order and WO) / Mark lost (reason required).
- **One-click quote**: "Build quote" creates `Q-YYYY-NNNN R1` with the company terms, validity and GST; "New quote from the latest" or "Copy at today's prices" re-prices every line from the catalogue and keeps the margins.
- **Quote builder** (`/sales/quotes/[id]`): BOM grouped by panel; catalogue search adds an item at its latest price (the source and any old price are shown); custom lines take a typed cost; edit qty and either margin or selling price (the other follows); "Refresh prices" when the catalogue moves (count shown). Advice panel: client tier, suggested margin with every reason (+/− points), "Apply X% to every line", per-line "raise/lower to X%" from that item's won/lost history with "Apply these margins", and "Often added with this BOM" (one-click Add with the typical quantity). Totals: cost, discount, freight, taxable, GST, grand total, margin after discount.
- **Approval**: Submit auto-approves at or above the minimum margin; below it the quote waits for a Director (notified in the app), who approves or sends it back with a note. A pending quote cannot be sent. "Revise" makes R2 and supersedes R1.
- **Send**: "Email via Outlook" downloads an `.eml` draft (`X-Unsent: 1`) addressed to the deal contact, quotation in the body and attached; it marks the quote sent, moves the deal to Quoted and schedules a follow-up. "Print / PDF" opens the letterhead copy (logo, company address, terms, GST, amount in words, salesperson signature; no cost or margin; DRAFT watermark until approved). GSTIN is left off for now.
- **Accounts**: relationship tier (Strategic / Key / Regular / New / Watch payments) from years with us, total ordered, repeat orders, payment delay and the strategic flag; the Head and Directors set the flag, payment delay and "client since". Contacts. History per client.
- **Price catalogue**: latest price per item by the priority rule; price history per item; add a price (net, or list price minus discount); CSV price-list import (all-or-nothing, creates new items).
- **Past quotes** (`/sales/history`, Head/Director): CSV import of old Excel/Tally quotes and orders (one row per line; works with or without cost and item codes), duplicate refs refused, imports can be deleted. Closed deals add their final quote automatically.
- **Sales settings** (Director): target and minimum margin, GST, validity, price staleness, follow-up days, price source priority, default terms.

**Decisions taken while building**
- Margin is on the selling price. The approval check uses the margin after discount, freight excluded.
- Advice rules (all in `src/modules/sales/domain/intelligence.ts`, unit-tested): relationship −2 strategic, −1/−0.5 for 5+/2+ years, −1.5/−0.75 for ₹1 Cr/₹25 L ordered, −1/−0.5 for 5+/2+ repeat orders, +3/+1.5 for >60/>30 days late; half-way to the client's median won margin (3+ quotes); just under the client's median lost margin (2+ lost); ±2.5 when company win rates by margin band say so (5+ quotes per band); −1 for a ₹50 L+ BOM, +2 under ₹2 L; never below the minimum margin or above 45%. Line advice when an item's margin is 4+ points from its median won margin (3+ wins), or ±10% from its median won price when the history has no cost. BOM suggestions: items in at least half (and 2+) of the past BOMs that held an item already in this BOM.
- `isReadOnly` ignores `sales.*` grants, so the Sales Head keeps PM read-only behaviour while running Sales. `sales-head.test.ts` now checks PM keys only.
- The PDF is the browser's "Save as PDF" from the print page; the Outlook draft attaches the quotation as HTML. A real PDF attachment needs a PDF library (new dependency): ask first.
- `prisma/seed-sales-demo.ts` (`npm run db:seed:sales-demo`) is local demo data only; it is not in `entrypoint.sh`.
- A fresh seed gives ACS-0011 to ACS-0016 the Sales Executive role (create-only, as for every seeded role). On an existing database, assign "Sales Executive" from People.

**Tests** (fresh throwaway DB: empty → `prisma migrate deploy` → `npm run db:seed`, 2026-10-09)
- `npm run typecheck`: pass. `npm test`: 18 files, **204 passed** (39 new: pricing 9, intelligence 19, CSV 6, quotation document 5). `npm run test:int`: 17 files, **110 passed** (19 new in `src/modules/sales/sales.int.test.ts`: allow, deny, happy path, validation for every service). `npm run build`: pass.
- Browser (Playwright + Chromium against `next start`, demo data): salesperson signs in → lands on Sales → new deal → contact → Build quote → catalogue search adds the CPU at the latest purchase rate → three "Often added" items → VFD → custom line → margins below minimum → Submit for approval → Director approves from Approvals → salesperson downloads the Outlook draft (quote Sent, deal Quoted, follow-up scheduled) → print page. A second salesperson opening that deal gets "Page not found". The Sales Head lands on the PM dashboard, sees the team table, and PM still opens read-only.

**Tools**: code-review-graph, Token Savior and sequential-thinking were **not available** in this cloud session; blast radius came from `grep` (see Affected code). `git push` was blocked by the session's permission policy (and `CLAUDE.md` says Claude never pushes): the commits are local on `Sales-OS`.

**Before production** (not done, needs the user): rehearse the two migrations on a production copy (both additive; the permission migration only inserts); assign Sales Executive roles; check `core_companies.address` holds the real address (it prints on the letterhead); load the price list and the past quotes.

**Later plans (not built)**: create the ERPNext sales order from a won deal once ERP (016) is live; feed ERPNext purchase receipts in as purchase prices; PDF attachment (dependency); AI advice behind the same interface; fold Sales into the master role control (2026-09-30 note).

## Review (Claude)
