# ERPNext integration — architecture and phased plan

> ## ⛔ PARKED — PLANNING ONLY. DO NOT IMPLEMENT.
>
> ERP is on hold (Sept 2026). This is a record of thinking, not a work order. Do not start
> it and do not offer it as the next task. Same for HRMS and Gate Entry. See
> `docs/archive/erp-spike-plan.md` for the full note.

> **CONDITIONAL — this is Path A, and the path has not been chosen yet.**
> This document assumes Engineering OS stays on Next.js and integrates ERPNext over its
> API. That assumption is no longer safe: the production projects turned out to be **demo
> data, not live**, which removes the main argument for keeping the current stack and makes
> rebuilding Engineering OS as Frappe apps (Path B) a serious contender.
>
> **Run `docs/archive/erp-spike-plan.md` first.** If it recommends Path B, most of this document is
> superseded — though the boundary table, the `pm_clients` collision and the capacity
> constraint still apply under either path.

**Branch:** `feat/erp-integration`
**Decision:** integrate ERPNext fully, as the system of record for all commercial data.
**Starting position:** no existing ERP data. Greenfield — nothing to migrate.

> **Do not merge this branch until the September 2026 release is deployed and stable on the
> VPS.** See `docs/migration-rehearsal-plan.md`. This work runs in parallel, not instead.

---

## The one-line architecture

**ERPNext runs headless as a separate service. Engineering OS is the only user interface.**

Every ERP screen is built in Engineering OS, in the Engineering OS design system, calling
ERPNext's REST API server-side. No Frappe UI is ever shown to a user.

```
Browser ──► Engineering OS (Next.js)  ──HTTP+API key──►  ERPNext (Frappe)
               Postgres  (engineering)                     MariaDB (commercial)
                   ▲                                          │
                   └──────────────  webhooks  ────────────────┘
```

## Why not the alternatives

**Why not iframe ERPNext's UI:** `docs/design-system.md` states every UI change in every
module must comply with the design system — warm cream floor, no shadows, scarce orange,
weight-400 display type, JetBrains Mono for codes. Frappe's UI complies with none of it,
and embedding it means a second login and a visible seam. This is a hard no, not a
preference.

**Why not put ERP tables in our Postgres:** ERPNext *is* the application. Its business logic
— tax, stock valuation, accounting entries — lives in Python on top of its own schema.
Reading or writing its tables directly bypasses all of it and breaks on every upgrade.
ERPNext runs on MariaDB and is not supported on Postgres, so it cannot share our database
in any case.

**Why not build ERP natively:** rejected by the user in favour of full ERPNext. Worth
recording that the module registry's original Phase 3 scope was narrower (sales order →
project, BOM gating, job costing, vendor POs) and could have been built natively. Full
ERPNext buys real accounting, GST and stock valuation — which is exactly the part that is
unwise to reimplement.

---

## Constraints to settle before writing code

### 1. Server capacity — check this first

ERPNext needs MariaDB, Redis (three instances), a scheduler, background workers and the
web server. A usable instance wants roughly **4 GB RAM on its own**, on top of what
Engineering OS uses.

Current allocation in `docker-compose.yml`: app 768 MB, Postgres 512 MB.

**First action on this branch — on the VPS:**

```bash
free -h && df -h
```

If there is not several GB of headroom, this is a hosting decision before it is an
engineering one. Options: resize the VPS, or put ERPNext on its own box and talk to it over
HTTPS. **Do not proceed past this check without an answer.**

### 2. Where the boundary sits

This must be written down and enforced, or you get two answers to the same question.

| Owned by ERPNext | Owned by Engineering OS |
|---|---|
| Customer, Supplier, Item, BOM | Projects, WBS, tasks, dependencies |
| Sales Order, Purchase Order | Assignments, panels, handovers |
| Sales Invoice, Payment, ledgers | Progress logs, capacity, Team Load |
| Stock, warehouses, valuation | Users, RBAC, audit trail |
| GST and statutory reporting | Checklist templates |

**ERPNext's own Projects and Tasks DocTypes are OUT OF SCOPE and must stay unused.** You
have just built a far better fit for panel manufacturing. Do not let a Sales Order create
an ERPNext Project.

### 3. The `pm_clients` collision — decide early

The September release introduced `pm_clients` with `refNumber` (`ACS-0001`…). Under this
architecture **ERPNext's Customer DocType becomes the source of truth for clients.**

Recommended: keep `pm_clients` as a **local mirror**, add an `erpCustomerId` column, and
sync one-way ERPNext → Engineering OS. The wizard's client dropdown keeps reading the local
table, so it stays fast and works if ERPNext is briefly down; creating a client writes to
ERPNext first, then mirrors back.

The existing 13 clients become the seed for ERPNext's Customer list, so nothing is lost.

### 4. Identity and attribution

Engineering OS stays the only front door — users never log into ERPNext.

- **Server-to-server auth:** an ERPNext API key/secret held in Engineering OS env vars.
  **Never expose it to the browser.** All ERPNext calls go through server actions or route
  handlers, exactly like existing `src/app/actions/*.ts`.
- **Attribution:** decide between one shared service account (simple, but every ERPNext
  document is created by "engos-service" and the audit trail there is useless) or a
  mirrored ERPNext user per Engineering OS user (proper attribution, more sync).
  **Recommended: mirrored users**, created lazily on first write, because accounting
  records with no real author cause problems later.
- **Permissions stay in Engineering OS.** Add `erp.*` keys to
  `src/core/rbac/permissions.ts` and check them in our code. Do not rely on ERPNext's role
  system — a single service identity would bypass it anyway.

---

## Integration mechanics

**Outbound (Engineering OS → ERPNext):** a thin typed client, `src/core/erp/client.ts`,
wrapping `/api/resource/<DocType>` with the API key, timeouts, retries and typed errors.
Every ERPNext call goes through it — no raw `fetch` scattered around.

**Inbound (ERPNext → Engineering OS):** ERPNext webhooks to a route handler under
`src/app/api/erp/webhooks/`, verified by a shared secret. Use these to mirror Customers and
to react to Sales Orders.

**Cross-module events stay as designed:** `src/core/events/` and the `core_domain_events`
outbox. A Sales Order webhook publishes `erp.sales_order.confirmed`; a subscriber creates
the project shell. That is the seam `schema.prisma` already documents, and the panel-hold
work will add the first subscriber — build on that, do not invent a parallel mechanism.

**Failure behaviour must be decided per flow.** ERPNext will be down sometimes. Reading a
customer list can fall back to the local mirror. Posting an invoice cannot fail silently —
it needs a retry queue and a visible error. The outbox already gives you retry semantics
(`attempts`, `lastError`); use it rather than fire-and-forget `fetch`.

---

## Phases

Each phase is independently useful and independently revertible.

**Phase 0 — Feasibility (do this before anything else)**
Check VPS capacity. Stand up ERPNext locally via the official `frappe_docker` compose.
Create one Customer and one Sales Order by hand in its own UI, then read them back through
the REST API from a scratch script. **Goal: prove the API shape and the resource cost
before a single line of product code.** If capacity fails here, stop and re-scope.

**Phase 1 — Read-only customers**
`src/core/erp/client.ts`, the webhook route, and Customer mirroring into `pm_clients`. The
project wizard's client dropdown is now fed by ERPNext without any visible change. Small,
safe, and proves the whole pipe end to end.

**Phase 2 — Sales Order → Project**
A confirmed Sales Order publishes a domain event that creates the project shell —
work order number, client, panels. This is the single highest-value integration and the
first registry bullet.

**Phase 3 — ERP screens in our UI**
Build `/erp` properly: customers, sales orders, purchase orders, items. Design system
compliant, using `.card` / `.btn` / `.table` recipes and `src/components/ui.tsx`. Flip the
module registry entry from `COMING_SOON` to `BETA`. **Budget realistically — this is the
largest phase by far.** ERPNext has hundreds of fields per DocType; decide which ones your
team actually touches and build only those.

**Phase 4 — BOM / material gating**
Material readiness blocks or releases engineering tasks. Depends on Phase 3's Item and BOM
work.

**Phase 5 — Job costing**
Progress log hours post to ERPNext costing. Depends on a stable Phase 2 project ↔ sales
order link.

---

## Honest assessment of size

Phases 0–2 are a few days of focused work and deliver real value. **Phase 3 is where the
effort actually lives** — replicating enough of an ERP's UI to run a business is a large,
open-ended project, and every DocType you expose is a screen you now own and maintain.

The good news is the phasing means you find out early whether the payoff justifies it, and
Phases 0–2 have standalone value even if you stop there.

## Branch setup

```bash
git checkout -b feat/erp-integration
```

Keep ERPNext's compose file separate — `docker-compose.erp.yml` — so it can be started and
stopped independently of the main stack, and so nothing in this branch can break the
existing deployment.
