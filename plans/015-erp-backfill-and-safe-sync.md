# 015 — ERP: backfill existing clients and projects, and keep order changes in sync

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity · **Branch:** `erp` · **Depends on:** 014 REVIEWED

## Goal
User decisions (2026-10-01, `CLAUDE.md` "ERP"):
- **Backfill:** every existing work-order project gets a sales order in ERPNext, marked **imported**, and every client gets an ERPNext customer carrying its ACS reference. After that, ERPNext is the single source for clients and orders. Service calls stay PM-only.
- **Safe sync** when an order changes after its project exists:
  - **client PO, delivery dates and client name** update PM automatically;
  - **added panels** are appended to the project;
  - **removed panels and cancelled orders** only raise an **"Order changed: review"** alert for a Director. Work is never deleted.

Plan 014 links new projects to orders (`Project.erpSalesOrder`, `Task.erpOrderItem`, `Project.erpOrderModified`, `Client.erpCustomer`), but nothing yet looks at an order after the project is created, and existing projects have no order.

**How sync is triggered (Claude's default; no scheduler exists in the app, and the 014 decision was "pull, no webhook"):** a sync runs when someone opens a linked project's page (that project only), and when the projects list loads, for all orders changed since the newest `erpOrderModified`. That's one ERPNext call, throttled to once per 5 minutes per server process. A failed sync never blocks the page.

**Defaults Claude chose (the user can change them before step 3):**
- **Cancelled projects** are not backfilled.
- **Completed and closed projects** are backfilled, then their orders are closed in ERPNext, so they don't show as open work.
- **Added panels** are assigned to the project's PM until a Director reassigns them, and the Director is alerted.

## Affected code
- `prisma/schema.prisma` + one migration: `Project.erpOrderAlert` (text), `Project.erpOrderAlertAt` (time), both nullable.
- `erp/acs_erp/acs_erp/install.py`, `_ensure_custom_fields`: a read-only check field `custom_imported` on Sales Order. Rebuild the image as the next `-acsN` tag.
- `prisma/scripts/erp-backfill.ts` (new): a one-off script, run by hand, never from `entrypoint.sh`.
- `src/modules/erp/` (new): `syncOrderChanges`.
- `src/modules/project-management/services/project.service.ts`:
  - `getProjectWorkspace` and `listProjects` call the sync (fire-safe);
  - a new `clearOrderAlert`.
- `src/modules/project-management/services/client.service.ts`, `updateClient`: reused for client renames from ERP (its cascade to `Project.clientName`).
- `src/core/notifications/notify.ts`, `notify`: alerts to Directors.
- `src/app/(shell)/pm/projects/[id]/page.tsx`: alert banner and "Mark reviewed".
- **Blast radius (code-review-graph, 2026-10-02, on `erp` @ `ba9afeb`):**
  - The impact radius of `project.service.ts` and `client.service.ts` is **high** (part of the 137-file radius measured for plan 014). Key entities: `ProjectPage`, `DashboardPage`, `ClientDetailPage`.
  - **`updateClient`** (graph): called from `actions/pm.ts`, and tested in `project-edit.int.test.ts` ("forbids PM from calling updateClient").
  - **`getProjectWorkspace` / `listProjects`** (graph names were ambiguous; text search used): callers are `src/app/(shell)/pm/projects/[id]/page.tsx`, `src/app/(shell)/pm/projects/page.tsx`, `src/app/api/pm/projects/route.ts` and `src/app/api/pm/projects/[id]/route.ts`, plus `project-progress-consistency.int.test.ts`, which must stay green.
  - **`notify`** (text search): used by `handover.service.ts`, `progress.service.ts`, `project.service.ts` and `task.service.ts`.

## Constraints
- The app is LIVE. Commit locally only, on `erp`; never push or merge. Never touch the VPS or production data. **Claude runs the backfill on production** in plan 016, with the user's approval.
- **Schema:** additive migration only (`npx prisma migrate dev --name erp_order_alerts`).
- **The backfill script:**
  - dry run by default (prints what it would do); `--apply` makes changes;
  - idempotent: re-running skips what's done (clients with `erpCustomer`, projects with `erpSalesOrder`);
  - never changes or deletes PM work, and never runs from `entrypoint.sh`;
  - reads the ERPNext keys from the environment only.
- **Sync never deletes:** tasks, panels, assignments, progress and projects are never removed by sync. Removals and cancellations only alert.
- **Sync writes are audited** with the ERP as the source (`actorId` null, action `erp.order_synced`, diff of changed fields).
- **ERP off** (keys unset): no sync, no banner, and the app behaves as today. A sync error is logged and swallowed; pages still render.
- **ERPNext:** standard REST API, using the `engos-api` user's existing `Sales User` role (it can create and submit Sales Orders, create Customers, and close orders). If ERPNext refuses an operation, stop and write it down; don't add roles or Custom DocPerms (see the `AGENTS.md` gotcha).
- **Tests mock ERPNext.** Rebuild the `acs-erpnext` image under a new tag for the custom-field change, recreate the containers, run `bench --site frontend migrate`, and note the tag.

## Tools & skills (implementer: follow these)
- **Setup:** `git checkout erp`. Point Token Savior at "Project management" and update the code-review-graph. Load `ponytail` (full) and the skills below.
- **Look before you change:** use the graph for callers and blast radius, and Token Savior to read by symbol. Where the graph is ambiguous (`updateClient`, `getProjectWorkspace`, `listProjects`, `notify`), use the full file-qualified name or text search, and say so in notes.
- **Check first (graph):**
  - callers of `getProjectWorkspace`, `listProjects`, `updateClient` and `notify`;
  - blast radius of `project.service.ts` and of the new `src/modules/erp/` files;
  - affected flows for the project page.
- **Read (Token Savior):**
  - `createAutomationProject` (how panel PHASE tasks and their steps are created, to reuse for appended panels);
  - `updateProject` (date checks, plan 007 panel dates on PHASE `plannedEnd`);
  - `updateClient` (rename cascade);
  - `notify`;
  - plan 014's `getOrderForProject` and `resolveClientForCustomer`.
- **sequential-thinking:** required for:
  - step 3, the sync rules: the order of applying date, client, PO, added and removed panels; conflicts such as a client rename clashing with another client's name, or a WO change clashing with another project;
  - step 2: backfill ordering and resuming after a partial run.
- **Skills:**
  - `ponytail` (full, always);
  - `tdd` (tests first);
  - `diagnosing-bugs`;
  - `review-delta` (before DONE);
  - `ux-writing` and `impeccable` for step 4.
- **Tests:**
  - Run `npm run typecheck && npm test && npm run build` and `npm run test:int` after every step, and paste the counts.
  - Run the acs_erp Python tests after step 1.
  - Before DONE, run `npm run test:int` on a fresh CI-like database.
- If a tool is missing or fails, say so in Implementation notes.

## Steps
- [ ] **1. Mark imported orders, and add the alert columns.**
  - `acs_erp` adds `custom_imported` (Check, read-only, "Imported from Engineering OS") to Sales Order. Rebuild the image as the next tag, recreate, migrate, and confirm the field exists.
  - Add the migration `erp_order_alerts` (`Project.erpOrderAlert`, `Project.erpOrderAlertAt`).
- [ ] **2. Backfill script `prisma/scripts/erp-backfill.ts`.**
  1. **Clients:** for each client without `erpCustomer`, find an ERPNext customer whose `custom_acs_reference` equals the client's `refNumber`, or else whose name matches. If none, create one (name = client name, `custom_acs_reference` = `refNumber`). Then set `Client.erpCustomer`.
  2. **Projects:** for each `WORK_ORDER` project without `erpSalesOrder`, except `CANCELLED`:
     - create a sales order with:
       - the customer;
       - `custom_wo_number` = `workOrderNo`;
       - `transaction_date` = the project's created date;
       - `delivery_date` = `targetEndDate`;
       - one item row per panel type, with the quantity, and each row's `delivery_date` from that panel's PHASE `plannedEnd`. Use one row per panel when panels of the same type have different dates;
       - rate 0;
       - `custom_imported` = 1;
       - `custom_project_code` and `custom_project_link`;
     - submit it;
     - then set `Project.erpSalesOrder`, `erpOrderModified`, and `Task.erpOrderItem` on each panel task.
     - Projects `COMPLETED` or `CLOSED`: close the order in ERPNext after submitting.
     - A project with no WO number or no panels is listed as "skipped: reason", not guessed.
  - **Output:** counts and one line per client and project (created / linked / skipped + reason). Dry run by default; `--apply` to write.
  - **Resume:** a crash halfway leaves no duplicate on re-run. Look up an existing imported order by `custom_project_code` before creating one.
  - **Prove it on the local stack:**
    - dry run, then `--apply`, against the local dev DB (seed + demo) and the local ERPNext;
    - run `--apply` a second time and show 0 created;
    - open three imported orders in ERPNext in the browser.
  - Paste the summaries into notes.
- [ ] **3. `syncOrderChanges`.** It fetches linked orders modified after the stored `erpOrderModified`, then applies these rules per project:
  - **Client PO** → `clientPoNumber`.
  - **Order delivery date** → `targetEndDate`.
  - **Item row delivery dates** → the matching panels' PHASE `plannedEnd` (matched by `Task.erpOrderItem`). ERP wins even if a task ends later; the existing Late logic shows it.
  - **WO number** → `workOrderNo`. If another project already has that WO, alert instead.
  - **Customer name** changed → rename our client through the `updateClient` path. On a name clash, alert instead.
  - **Quantity increased or a new row** → append panels with the same structure `createAutomationProject` builds (PHASE task + template steps), assigned to the PM; set `erpOrderItem`; alert "2 panels added: assign engineers".
  - **Quantity decreased, a row removed, or the order cancelled (`docstatus` 2) or closed while the project is open** → alert only, naming what changed. Nothing is deleted.
  - **For every alert:** set `erpOrderAlert` (plain words, newest change appended), set `erpOrderAlertAt`, and `notify` each active Director with a link to the project.
  - Then update `erpOrderModified` and audit `erp.order_synced`.
  - **Wire it in:**
    - `getProjectWorkspace`, for that project;
    - `listProjects`, for all linked orders, throttled to once per 5 minutes per process;
    - both wrapped so an ERP failure is logged and the page still renders.
  - **Tests (ERP mocked), covering each rule plus:**
    - no change → no write;
    - ERP down → page data still returned;
    - ERP off → no call;
    - a second sync of the same change → no duplicate panels or alerts.
- [ ] **4. Alert banner.**
  - On the project page, when `erpOrderAlert` is set, show an "Order changed: review" banner with the text, the time, and a link to the order in ERPNext.
  - Holders of `pm.project.create` see **Mark reviewed**, which clears the alert (`clearOrderAlert`, audited). Others see the banner without the button.
  - The projects list shows a small "Order changed" badge on those projects.
  - Use `ux-writing` and `impeccable`.
  - Tests: allow (Director clears), deny (PM can't clear), happy path, validation (clearing a project without an alert is a no-op).
- [ ] **5. Check it end to end on the local stack, in the browser.**
  - Using a project created in plan 014's step 8, edit its order in ERPNext with "Update Items" on the submitted order, as the Sales Head:
    1. change a row's delivery date and the client PO → PM updates on the next page load, with no alert;
    2. add one panel → it appears assigned to the PM, and the Director gets an alert and a notification;
    3. reduce a quantity → alert only, and the panel and its tasks are still there;
    4. cancel the order → alert only.
  - Mark reviewed as the Director.
  - Write what you saw in notes.

## Acceptance criteria
- [ ] Typecheck, unit tests, build and integration tests pass (full suite), including on a fresh CI-like database.
- [ ] Backfill:
  - dry run by default;
  - `--apply` links every client and every non-cancelled work order;
  - a second run creates nothing;
  - skipped items are listed with reasons;
  - imported orders are marked, submitted, and closed when the project is finished.
- [ ] Sync:
  - PO, dates, WO and client name follow ERP;
  - added panels are appended and assigned to the PM;
  - removals and cancellations only alert;
  - nothing in PM is ever deleted;
  - every change is audited.
- [ ] Directors are notified and can mark an alert reviewed; others can't.
- [ ] ERP off or down never breaks a page.

## Implementation notes (implementer)

## Review (Claude)
