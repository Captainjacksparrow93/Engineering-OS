# 015 — ERP: backfill existing clients and projects, and keep order changes in sync

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
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
- [x] **1. Mark imported orders, and add the alert columns.**
  - `acs_erp` adds `custom_imported` (Check, read-only, "Imported from Engineering OS") to Sales Order. Rebuild the image as the next tag, recreate, migrate, and confirm the field exists.
  - Add the migration `erp_order_alerts` (`Project.erpOrderAlert`, `Project.erpOrderAlertAt`).
- [x] **2. Backfill script `prisma/scripts/erp-backfill.ts`.**
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
- [x] **3. `syncOrderChanges`.** It fetches linked orders modified after the stored `erpOrderModified`, then applies these rules per project:
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
- **Order of work:** started right after 014 reached DONE (not yet REVIEWED), because the user asked for 014 → 015 → 017 in one go. Same container as 014 step 8: code-review-graph, Token Savior and sequential-thinking are not available here, so callers come from text search and the ordering reasoning is written out in these notes. Local ERPNext: `/var/tmp/erpnext-local` (see plan 014 step 8 notes).
- **Step 1 (imported flag and alert columns):**
  - `acs_erp`: `custom_imported` (Check, read-only, "Imported from Engineering OS", after `custom_project_link`) on Sales Order, added in `_ensure_custom_fields` (`install.py`), in `fixtures/custom_field.json` and in the `hooks.py` fixture filter, so the three lists agree.
  - New Python test `erp/acs_erp/acs_erp/tests/test_custom_fields.py` (2): the field is created as a read-only Check on Sales Order, and the fixture and hooks list it (red first: 2 failures; then green).
  - **Image `acs-erpnext:v16.37.0-acs7`** (same local-only proxy-CA build copy as acs6), `CUSTOM_TAG` switched, `docker compose … up -d --force-recreate`, `bench --site frontend migrate` OK; backend runs `acs-erpnext:v16.37.0-acs7`. The API now returns `custom_imported: 0` on SAL-ORD-2026-00001.
  - Prisma: `Project.erpOrderAlert String?`, `Project.erpOrderAlertAt DateTime?`; migration `20261002173213_erp_order_alerts`:
    ```sql
    ALTER TABLE "pm_projects" ADD COLUMN     "erpOrderAlert" TEXT,
    ADD COLUMN     "erpOrderAlertAt" TIMESTAMP(3);
    ```
    Applied to the dev DB with `npx prisma migrate dev --name erp_order_alerts`; `prisma migrate diff` (migrations vs schema): no difference. (`prisma format` re-aligned 115 unrelated schema lines; reverted, only the two new lines are in the diff.)
  - **Test counts:** typecheck clean; `npm test` 14 files / 165 passed; `npm run test:int` 17 files / 95 passed; build clean; `python3 -m unittest discover -s erp/acs_erp` 25 tests OK.
- **Step 2 (backfill script):**
  - **Shape:** the logic is in `src/modules/erp/backfill.ts` (`runBackfill({ companyId, apply, log })`, plus `planOrderRows`), so the integration test can run it with ERPNext mocked. `prisma/scripts/erp-backfill.ts` is the thin CLI: dry run by default, `--apply` to write, `--company=ACS` (default). It refuses to start without `ERPNEXT_URL` / `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` (env only) and uses `APP_URL` for the project links. It is never called from `entrypoint.sh`. Exit code 1 if anything failed.
  - **Clients:** for each client without `erpCustomer`: customer by `custom_acs_reference` = `refNumber`, else by `customer_name` = client name (skipped, not linked, if that customer carries a **different** ACS reference), else create one (`customer_name`, `customer_type` Company, `custom_acs_reference`). An empty reference on a matched customer is filled. A customer already linked to another client → skipped with reason. Then `Client.erpCustomer`.
  - **Projects:** `WORK_ORDER`, no `erpSalesOrder`, not `CANCELLED`. Skipped with a reason: no WO, WO not digits only, no client (by `clientId`, else by name like the project page), client without an ERP customer, no panels. Rows: one per panel type with the quantity; one row per panel when panels of that type have different dates (`plannedEnd`, else the target date). Order: the only ERPNext company, customer, `transaction_date` = project created date, `delivery_date` = the later of target and the last row date (ERPNext requires header ≥ rows), `po_no` (if any), `custom_wo_number`, `custom_project_code`, `custom_project_link`, `custom_imported` = 1, rate 0; then submitted (`docstatus` 1). COMPLETED / CLOSED → `update_status` Closed **before** our DB is linked. Then, in one transaction: `erpSalesOrder`, `erpOrderModified`, each panel's `erpOrderItem` (`<row>#<unit>`). It checks that the order's rows still match the panels (item code + qty, by `idx`) before linking; if not, that project fails with a reason (no guessing).
  - **Resume (ordering):** find/create → submit → close → link in our DB. A crash at any point leaves the order findable on re-run by **`custom_project_link`** (the plan says `custom_project_code`; project codes can be shared since plan 005, the link holds the project id, so it is the safe key). A draft is submitted, a submitted one reused, a closed one left closed, then linked. A crash after linking: the project has `erpSalesOrder` and is skipped.
  - **ERP client** (`client.ts`): new `erpInsert` (POST `/api/resource/<doctype>`) and `erpCall` (POST `/api/method/<method>`, returns `message`; `{}` → undefined). **Also:** HTTP **417** (ERPNext refused a save, e.g. a validation) now becomes `DomainError("ERP refused this: <ERPNext's message>")` instead of "ERP isn't responding." That was wrong for refusals and would have made the backfill report useless. 5xx / 401 / 403 / network are unchanged. `order.service.ts`: `projectLink(id)` extracted and reused by `writeProjectToOrder`.
  - **ERPNext check as `engos-api` (Sales User only, no new roles):** create Customer with `custom_acs_reference` ✔; insert Sales Order with read-only `custom_imported` = 1 (kept) ✔; PUT `docstatus: 1` ✔; `erpnext.selling.doctype.sales_order.sales_order.update_status` Closed ✔ (returns `{}`). (Probe records left in the local ERPNext: customer "Probe Customer Ltd" ACS-9999 and closed SAL-ORD-2026-00003.)
  - **Tests (`src/modules/erp/backfill.int.test.ts`, 4; own company so seed data is never touched; an in-memory fake ERPNext behind the mocked client):** dry run writes nothing and reports; `--apply` links by reference, by name (fills the reference), creates, skips a reference clash, creates/submits imported orders with the right rows (grouped vs per-panel), closes the completed one, links PM (`erpOrderItem`s) and leaves cancelled, service-call and skipped projects alone; a second `--apply` creates nothing; resume after a crash submits and links the existing draft, no duplicate. `client.test.ts` +3 (insert, call incl. empty reply, 417 message). **Written code-first by mistake**, so I checked the tests bite: removing the close, the per-panel split, or the resume lookup each turns exactly one test red.
  - **Local stack (dev DB with seed + demo, local ERPNext acs7):** the demo projects use an older panel title (`PLC × 1: PLC Programming + Simulation`), not `PLC Panel 1`, so they are skipped "no panels named …" (per the plan: skipped, not guessed). **Planner: production may have projects with that older title; the dry run on the production copy (016) will show how many.** To have real panels to import, I created three pre-ERP work orders with `createAutomationProject` (ERP off, as production did), one marked COMPLETED. I also unlinked one project and client from my earlier mock check (they pointed at an order that only existed in the mock), and deleted leftover test projects from old interrupted runs (the step 5 test now fails loudly instead of swallowing a cleanup error).
    - Dry run (DEMO lines omitted):
      ```
ERP backfill for ACS Engitech Pvt Ltd: dry run (no writes; add --apply to write)
client ACS-0004 "Nirma Chemicals Ltd": would create a customer
client ACS-0006 "Reliance Petrochem": would create a customer
client ACS-0007 "UltraTech Cement": would create a customer
client ACS-0008 "Amul Dairy": would create a customer
client ACS-0009 "Tata Power": would create a customer
client ACS-0010 "Adani Ports": would create a customer
client ACS-0011 "JSW Steel": would create a customer
client ACS-0012 "Asian Paints": would create a customer
client ACS-0013 "Larsen & Toubro": would create a customer
project ACS-0004-0001 (WO 8101): would create an imported order for "Nirma Chemicals Ltd": 1 × PLC 2027-01-30, 1 × PLC 2027-03-01
project ACS-0006-0001 (WO 7001): would create an imported order for "Reliance Petrochem": 2 × PLC 2027-01-15, 1 × HMI 2027-02-10
project ACS-0009-0001 (WO 7002): would create an imported order for "Tata Power": 1 × SCADA 2027-01-20, 1 × SCADA 2027-02-25
project ACS-0008-0001 (WO 7003): would create an imported order for "Amul Dairy": 1 × PLC 2027-01-05, then close it
Clients: 9 to create, 0 to link, 0 skipped, 0 failed (dry run)
Projects: 4 to create, 0 to link, 8 skipped, 0 failed (dry run)
      ```
    - `--apply`:
      ```
ERP backfill for ACS Engitech Pvt Ltd: APPLY (writes)
client ACS-0004 "Nirma Chemicals Ltd": created customer "Nirma Chemicals Ltd"
client ACS-0006 "Reliance Petrochem": created customer "Reliance Petrochem"
client ACS-0007 "UltraTech Cement": created customer "UltraTech Cement"
client ACS-0008 "Amul Dairy": created customer "Amul Dairy"
client ACS-0009 "Tata Power": created customer "Tata Power"
client ACS-0010 "Adani Ports": created customer "Adani Ports"
client ACS-0011 "JSW Steel": created customer "JSW Steel"
client ACS-0012 "Asian Paints": created customer "Asian Paints"
client ACS-0013 "Larsen & Toubro": created customer "Larsen & Toubro"
project ACS-0004-0001 (WO 8101): created SAL-ORD-2026-00004: 1 × PLC 2027-01-30, 1 × PLC 2027-03-01
project ACS-0006-0001 (WO 7001): created SAL-ORD-2026-00005: 2 × PLC 2027-01-15, 1 × HMI 2027-02-10
project ACS-0009-0001 (WO 7002): created SAL-ORD-2026-00006: 1 × SCADA 2027-01-20, 1 × SCADA 2027-02-25
project ACS-0008-0001 (WO 7003): created SAL-ORD-2026-00007: 1 × PLC 2027-01-05, closed
Clients: 9 created, 0 linked, 0 skipped, 0 failed
Projects: 4 created, 0 linked, 8 skipped, 0 failed
      ```
    - Second `--apply`: `Clients: 0 created, 0 linked, 0 skipped, 0 failed` / `Projects: 0 created, 0 linked, 8 skipped, 0 failed`
    - In ERPNext (desk, Director via SSO): SAL-ORD-2026-00005 (To Deliver, ACS-0006-0001, 2 × PLC + 1 × HMI), SAL-ORD-2026-00006 (To Deliver, ACS-0009-0001, SCADA rows with two dates), SAL-ORD-2026-00007 (**Closed**, ACS-0008-0001): each shows "Imported from Engineering OS" ticked, WO, project code and link.
  - **Test counts:** typecheck clean; `npm test` 14 files / 168 passed; `npm run test:int` 18 files / 99 passed; build clean; acs_erp 25 OK.
- **Step 3 (`syncOrderChanges`, `src/modules/erp/sync.ts`):**
  - **Which orders:** linked projects of the company; one `erpList` of orders with `modified >` the **oldest** stored `erpOrderModified` (for one project: also `name =` its order; for all: `custom_project_link is set`). Then each order is applied only if its `modified` is newer than **that project's** `erpOrderModified`. The plan says "since the newest". With the newest, a change to an order whose project was synced earlier than another's would be skipped forever, so I used the oldest. `modified` stays ERPNext's own string and is only compared as a string or passed back in a filter.
  - **Rules, in order, for one order:**
    1. `docstatus` 2 → alert only ("Order cancelled in ERP. Nothing was changed or deleted here."). Nothing else is applied.
    2. Status Closed while the project is open → alert.
    3. `po_no` → `clientPoNumber`.
    4. `delivery_date` → `targetEndDate`.
    5. `custom_wo_number` → `workOrderNo`; another project already has it, or it isn't digits → alert, WO unchanged.
    6. Customer: if `order.customer` is the linked customer, or a customer with the same `custom_acs_reference` (a renamed ERPNext doc), its `customer_name` renames our client through **`renameClientCascade`**. That function is extracted from `updateClient` (which now uses it), so the project `clientName` cascade is shared. A different customer, or a name another client already has → alert, client unchanged.
    7. Rows, matched by `Task.erpOrderItem`: a row's `delivery_date` → its panels' PHASE `plannedEnd` (ERP wins). More units than we have, or a new row → panels appended. Fewer units → alert naming the kept panels. A row gone → alert naming the kept panels. An item that isn't an active template → alert.
  - **Appended panels:** built by **`createPanelTasks`**, extracted from `createAutomationProject` (which now calls it per panel; all existing tests unchanged and green): PHASE + template steps + in-panel dependencies. Next "<TYPE> Panel N", next `-PH`/`-T` numbers, every step assigned to the PM, `erpOrderItem` = `<row>#<unit>`, the type added to `automationTypes`, and an alert "PLC Panel 3, HMI Panel 1 added from the sales order and assigned to the PM: assign engineers."
  - **Alerts:** new lines are appended to `erpOrderAlert` (a line that is already there is not repeated, so a standing condition like "order closed" doesn't re-alert on later changes), `erpOrderAlertAt` set, and `notify` each active Director ("Order changed: review <code>", link `/pm/projects/<id>`). The update, panels, rename, audit and notifications are in one transaction. Then `erpOrderModified` = the order's `modified`. Audit `erp.order_synced`, `actorId` null, with the changed fields, panel dates, client rename, added panels and alerts. No change → no write: unchanged `modified` makes no call to the order and no write.
  - **Wiring:** `getProjectWorkspace` → `syncProjectOrderSafely` (this project); `listProjects` → `syncAllOrdersSafely` (all; at most once per 5 minutes per process per company). Both swallow and log errors. **Addition:** after an ERP failure, both skip syncing for 60 s, so a down ERPNext doesn't add its timeout to every page load. ERP off → no call.
  - **Tests** (`src/modules/erp/sync.int.test.ts`, 11, ERP mocked): ERP off; no change → no write; PO + dates without alert, audited with null actor; WO follows / clash alerts; customer rename cascades / name clash alerts; added panels (qty up + new row) appended to the PM with steps, `erpOrderItem`, alert and a notification to every Director; reduced qty + removed row + cancelled order only alert and keep every task; the same change twice → no duplicates; a standing condition isn't re-alerted; ERP down → page loads; page sync + list sync throttled to 5 minutes (fake clock). Checked they bite: removing the WO clash check, the throttle, the add rule or the alert dedupe each turns tests red.
  - **Test counts:** typecheck clean; `npm test` 14 files / 168 passed; `npm run test:int` 19 files / 110 passed; build clean; acs_erp 25 OK.

## Review (Claude)
