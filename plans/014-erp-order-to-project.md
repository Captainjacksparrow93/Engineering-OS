# 014 — ERP: every new project starts from a sales order

**Status:** DONE   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity · **Branch:** `erp` · **Depends on:** 013 REVIEWED (F14, F15 done)

## Goal
User decisions (2026-10-01, `CLAUDE.md` "ERP"): every work-order project comes from a **confirmed ERPNext sales order**, and nothing is created automatically.
- **New project** starts by picking a confirmed order that has no project yet. The list is pulled live from ERPNext.
- Picking an order fills in the client, WO number, client PO, panels (type × quantity, each with its delivery date) and the target delivery date. The Director then adds the PM and engineers as today.
- Saving writes the project code and a link back onto the order in ERPNext.
- The first time an ERPNext customer is used, our app gives it the next `ACS-XXXX`, creates our client, and writes the reference back to the customer's "ACS reference" field.
- Order fields are edited **only in ERP**: plan 008's Edit details stops changing them on linked projects.
- If ERPNext is down, new work orders wait; the rest of PM keeps working. Service calls stay PM-only.

Today none of this exists. `createAutomationProject` takes client, WO and panels straight from the wizard. Our app's only call to ERPNext is the best-effort SSO disable in `setUserStatus`.

## Affected code
- `src/core/config.ts`: add `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET` (optional, like the existing `ERPNEXT_URL`).
- `src/modules/erp/` (new files): a small ERPNext REST client and an order service.
- `prisma/schema.prisma` + one migration: new nullable columns (step 2).
- `src/modules/project-management/services/automation-project.service.ts`, `createAutomationProject`: accepts a sales order, and refuses a work order without one when ERP is on.
- `src/modules/project-management/services/client.service.ts`, `nextClientRef` / `createClient`: reused for the lazy client.
- `src/modules/project-management/services/project.service.ts`, `updateProject`: locks order fields on linked projects.
- `src/app/actions/automation-project.ts`, `createAutomationProjectAction`: passes the order through.
- `src/app/(shell)/pm/projects/new/page.tsx` (`NewProjectPage`) and `automation-project-wizard.tsx` (`AutomationProjectWizard`, 1,415 lines): new first step.
- `src/app/(shell)/pm/projects/[id]/page.tsx` and `edit-project-details-button.tsx`: order link; locked fields.
- **Blast radius (code-review-graph, 2026-10-02, on `erp` @ `ba9afeb`):**
  - The impact radius of `automation-project.service.ts`, `project.service.ts`, `client.service.ts` and `actions/automation-project.ts` is **high**: 137 files within 2 hops. Key entities: `DashboardPage`, `ClientDetailPage`, `ProjectPage`, `NewProjectPage`, wizard `handleSubmit`.
  - **Callers of `createAutomationProject`:** 21, namely `createAutomationProjectAction`, `createServiceCallAction`, and tests in `shared-project-code.int.test.ts`, `new-project-all-engineers.int.test.ts`, `panel-delivery-dates.int.test.ts`, `pm-panel-assignment.int.test.ts` and `project-edit.int.test.ts`.
  - **Callers of `updateProject`:** 7, namely `src/app/api/pm/projects/[id]/route.ts`, `updateProjectAction` (`actions/pm.ts`), and tests in `project-edit.int.test.ts`.
  - **Callers of `nextClientRef`:** `NewProjectPage`, `getNextClientRefAction`.
  - **Affected flows:** none detected by the graph (the wizard isn't traced as a flow), so the browser check in step 8 is required.
  - **Existing tests must keep passing with ERP off:** they create work orders without a sales order.

## Constraints
- The app is LIVE. Commit locally only, on `erp`; never push or merge. Never touch the VPS or production data.
- **Schema:** additive only, through `npx prisma migrate dev --name erp_order_links`. Nullable columns only; no drops or renames.
- **ERP on/off:** the ERP rules apply only when `ERPNEXT_URL`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` are all set (`isErpEnabled()`). With them unset (CI, `main`, existing tests), the app behaves exactly as today.
- **Secrets:** the API key and secret of the local `engos-api` user live only in `C:\Users\Dhruv-Home\erpnext-local\.env` and our local `.env`. Never commit them, never put them in notes or chat, and never send them to the browser.
- **The server trusts ERPNext, not the browser:** on save, the server re-reads the order from ERPNext and uses its client, WO, PO, panels and dates. Whatever the wizard sent for those fields is ignored.
- **No new npm dependencies:** use `fetch` with `AbortSignal.timeout`.
- **Tests mock ERPNext** (CI doesn't run it). Mock the new ERP client module, not global `fetch`.
- **ERPNext side:** use only the standard REST API (`/api/resource/...`, `Authorization: token key:secret`) and the custom fields from plan 012/013 (`custom_wo_number`, `custom_project_code`, `custom_project_link`, `custom_acs_reference`). Change `acs_erp` only if a step says so.
- **If ERPNext behaves differently from this plan, stop** and write what you found in Implementation notes.

## Tools & skills (implementer: follow these)
- **Setup:** `git checkout erp`. Point Token Savior at this project ("Project management") and update the code-review-graph. Load `ponytail` (full) and the skills below.
- **Look before you change:** use the graph for callers and blast radius, and Token Savior to read code by symbol rather than whole files. If the graph can't find something, use text search and say so in notes.
- **Check first (graph):**
  - callers of `createAutomationProject`, `updateProject`, `nextClientRef` and `createClient`;
  - importers of `src/core/config.ts` and `src/modules/erp/sso.ts`;
  - blast radius of `automation-project.service.ts` and `project.service.ts`;
  - affected flows for the New project wizard.
- **Read (Token Savior):**
  - `createAutomationProject` and `CreateAutomationProjectInput` (panel keys are `${templateCode}_${unit}`, dates in `panelDeliveryDates`);
  - `updateProject` (client / WO / target date / panel date handling);
  - `nextClientRef`, `createClient`, `getClientById`;
  - `setUserStatus` in `admin.service.ts` (the existing ERPNext call, for style);
  - `AutomationProjectWizard` (steps 1–3 and `handleSubmit`);
  - `NewProjectPage`.
- **sequential-thinking:** required for step 5 (order of DB transaction vs ERPNext write-back, and repair after a failed write-back) and step 4 (two people picking orders of the same new customer at once).
- **Skills:**
  - `ponytail` (full, always);
  - `tdd` (tests first, every step);
  - `diagnosing-bugs` when something fails;
  - `review-delta` (before DONE);
  - `ux-writing` and `impeccable` for steps 6–7.
- **Tests:**
  - Run `npm run typecheck && npm test && npm run build` and `npm run test:int` after every step, and paste the pass/fail counts into Implementation notes.
  - Before DONE, run `npm run test:int` on a throwaway database built like CI (empty DB → `npx prisma migrate deploy` → `npm run db:seed`).
- **Next.js:** read the relevant guide in `node_modules/next/dist/docs/` before writing server actions or pages.
- If a tool is missing or fails, say so in Implementation notes. Never claim you used one when you didn't.

## Steps
- [x] **1. ERPNext client.**
  - Add `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` to `src/core/config.ts` and `.env.example` (empty values).
  - Add a small module in `src/modules/erp/` with:
    - `isErpEnabled()`;
    - `erpGet(doctype, name)`, `erpList(doctype, {filters, fields, limit})` and `erpUpdate(doctype, name, fields)`, using token auth and a 10 s timeout.
  - ERPNext failures (network, timeout, 5xx, 401/403) become one `DomainError`: "ERP isn't responding. Try again in a minute." Log the details server-side, never the secret.
  - Unit tests: auth header built correctly, timeout → that error, a 404 is reported distinctly.
- [x] **2. Schema (one additive migration `erp_order_links`).** All nullable:
  - `Project.erpSalesOrder` (unique; the ERPNext order name, e.g. `SAL-ORD-2026-00052`);
  - `Project.clientPoNumber`;
  - `Project.erpOrderModified` (the order's `modified` timestamp when last read; used by plan 015);
  - `Client.erpCustomer` (unique per company; the ERPNext Customer name);
  - `Task.erpOrderItem` on panel (`PHASE`) tasks: the order item row name plus the unit number, e.g. `a1b2c3#2` (used by plan 015 to match panels).
  - Run the migration on the dev DB and on a fresh CI-like DB; paste the SQL into notes.
- [x] **3. Order service.**
  - `listWaitingOrders(principal)` (needs `pm.project.create`): submitted orders (`docstatus = 1`, status not Closed or Cancelled) whose `custom_project_code` is empty **and** whose name isn't already on a `Project.erpSalesOrder`. Return customer name, order name, WO, client PO, panels summary and delivery date, newest first.
  - `getOrderForProject(principal, orderName)` returns the order as our input shape:
    - client (ERPNext customer name + `custom_acs_reference`);
    - `custom_wo_number`;
    - `po_no`;
    - target date = the order's `delivery_date`;
    - panels: one scope per item code with the summed quantity, and per-panel delivery dates from each item row's `delivery_date`. Units are numbered in row order and keyed `${code}_${unit}` like today. Remember each unit's row name for `Task.erpOrderItem`.
  - **Refuse, with a clear message:** a draft, cancelled or closed order; an order that already has a project; an item code that isn't an active checklist template (PLC / SCADA / HMI); a missing or non-digit WO number.
  - Integration tests with the ERP client mocked: allow, deny (no `pm.project.create`), happy path, each refusal.
- [x] **4. Client from the ERPNext customer (lazy ACS reference).** `resolveClientForCustomer(principal, customer)`:
  1. find our client by `erpCustomer`;
  2. otherwise, if the customer's `custom_acs_reference` matches a client's `refNumber`, link that client;
  3. otherwise create a client named after the customer with `nextClientRef`.
  Then write `custom_acs_reference` back to the ERPNext customer if it's empty.
  - Two Directors picking orders of the same new customer at the same time must end with **one** client: rely on the unique constraints and retry the lookup.
  - A name clash with an existing unlinked client of the same name links that client instead of failing.
  - Tests: each branch, the race (two parallel calls), write-back failure (the client still exists; the next call writes the reference again).
- [x] **5. Create the project from the order.**
  - `createAutomationProject` takes an optional `salesOrder` (name).
  - **When ERP is on:** a `WORK_ORDER` without `salesOrder` is refused ("Pick a sales order first."); service calls are unaffected. With `salesOrder`, the server calls `getOrderForProject` and `resolveClientForCustomer`, and uses their values for client, WO, PO, panels, panel dates and target date. It also stores `erpSalesOrder`, `clientPoNumber`, `erpOrderModified` and each panel task's `erpOrderItem`.
  - **After the DB transaction commits**, write `custom_project_code` and `custom_project_link` (`<APP_URL>/pm/projects/<id>`) onto the order.
  - **If that write-back fails:**
    - the project stays;
    - audit `erp.writeback_failed`;
    - `listWaitingOrders` repairs it: any order already linked to a project gets its fields written again, and it never shows as waiting.
  - Audit `pm.project.created` with `erpSalesOrder` in the diff.
  - Tests:
    - ERP off: existing behaviour;
    - ERP on: refused without an order;
    - happy path with write-back;
    - an order taken by a parallel request is refused;
    - write-back failure and repair;
    - no `pm.project.create` → denied;
    - client-sent panels or WO that differ from the order are ignored.
- [x] **6. New project wizard: "Pick a sales order" first.** When ERP is on:
  - **Step 0** lists the waiting orders (customer, order number, WO, panels, delivery date), with a search box.
  - Picking one fills steps 1–2 and **locks** client, WO, PO, panels and dates, with a "From sales order SAL-ORD-…" line and a link to the order in ERPNext (`ERPNEXT_PUBLIC_URL/app/sales-order/<name>`). PM, engineers, task dates and priority stay editable.
  - **Empty state:** "No confirmed sales orders are waiting for a project. Create and submit the order in ERP first." with a link to ERP.
  - **ERP down:** say so with a "Try again" button. Service call creation stays available.
  - **ERP off:** the wizard is exactly as today.
  - Use `ux-writing` for the text and `impeccable` for layout.
- [x] **7. Project page and Edit details.**
  - The project page shows "From sales order SAL-ORD-…" (link to ERPNext) and the client PO when set.
  - `updateProject` refuses changes to client, WO, target date and panel delivery dates on a project with `erpSalesOrder`: "This comes from the sales order. Change it in ERP." The Edit details dialog shows those fields read-only with the same hint. Code, priority, PM and engineers stay editable.
  - Projects without `erpSalesOrder` (all existing ones until plan 015) keep today's behaviour.
  - Tests: refused on a linked project, still allowed on an unlinked one, PM still forbidden.
- [x] **8. Check it end to end on the local ERPNext, in the browser.**
  - As the Sales Head (SSO): create and submit a sales order in ERPNext for a **new** customer, with WO, PO and two item rows with different delivery dates.
  - As a Director in our app: the order is in the waiting list; pick it and assign PM and engineers; save.
  - Check:
    - the project has the right client, WO, PO, panels and per-panel dates;
    - the new client has the next ACS reference, and that reference is on the ERPNext customer;
    - the order in ERPNext shows the project code, and its link opens the project;
    - the order is no longer waiting;
    - a second order for the same customer reuses the client.
  - Stop the ERPNext backend container for a minute and confirm New project shows the ERP-down message while the rest of PM works. Start it again.
  - Write what you saw in notes (no screenshots in git).

## Acceptance criteria
- [x] Typecheck, unit tests, build and integration tests pass (full suite), including on a fresh CI-like database.
- [x] With ERP on, a work-order project can only be created from a confirmed sales order without a project. The order's values win over anything the browser sends.
- [x] Client, ACS reference, project code and link are consistent in both systems after step 8, and a failed write-back repairs itself.
- [x] Order fields of linked projects can't be edited in our app; unlinked projects behave as before.
- [x] ERPNext down: New project explains it; everything else in PM works.
- [x] With ERP off, behaviour is unchanged (existing tests untouched and green).
- [x] No secret in the repo, notes, logs or the browser.

## Implementation notes (implementer)
- **Step 1 (ERPNext client):**
  - Added optional `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET` to `src/core/config.ts` (treating empty string `""` as `undefined`), `.env.example`, and `docker-compose.yml`.
  - Created `src/modules/erp/client.ts` providing `isErpEnabled()`, `erpGet(doctype, name)`, `erpList(doctype, { filters, fields, limit, orderBy })`, and `erpUpdate(doctype, name, fields)` using `Authorization: token <key>:<secret>` and `AbortSignal.timeout(10_000)`.
  - Mapped HTTP 404 responses distinctly to `NotFoundError` (`src/core/rbac/errors.ts`), and network/timeout/5xx/401/403/invalid-JSON errors to `DomainError("ERP isn't responding. Try again in a minute.")` while logging server-side details without secrets.
  - Added TDD unit tests in `src/modules/erp/client.test.ts` (6 tests passing).
  - **Test counts:**
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 14 test files passed, 163 tests passed.
    - `npm run test:int`: 14 test files passed, 63 tests passed.
    - `npm run build`: clean.
- **F1 (one source for ERP settings, and no test switch in production code):**
  - Updated `readErpConfig()` in `src/modules/erp/client.ts` to read solely from `config()` without `try/catch` or `process.env` fallbacks.
  - Restored `if (cached) return cached;` in `src/core/config.ts` and exported `resetConfigCache()` for tests (`src/modules/erp/client.test.ts` uses `vi.stubEnv` + `resetConfigCache()`).
  - **Test counts:**
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 14 test files passed, 163 tests passed.
    - `npm run test:int`: 14 test files passed, 63 tests passed.
    - `npm run build`: clean.
- **Step 2 (Schema: additive migration `erp_order_links`):**
  - Added 5 nullable columns and 2 unique constraints in `prisma/schema.prisma`:
    - `Project.erpSalesOrder` (`String? @unique`)
    - `Project.clientPoNumber` (`String?`)
    - `Project.erpOrderModified` (`String?`)
    - `Client.erpCustomer` (`String?` + `@@unique([companyId, erpCustomer])`)
    - `Task.erpOrderItem` (`String?`)
  - Created and applied migration `prisma/migrations/20261002090500_erp_order_links/migration.sql`:
    ```sql
    -- AlterTable
    ALTER TABLE "pm_clients" ADD COLUMN     "erpCustomer" TEXT;

    -- AlterTable
    ALTER TABLE "pm_projects" ADD COLUMN     "clientPoNumber" TEXT,
    ADD COLUMN     "erpOrderModified" TEXT,
    ADD COLUMN     "erpSalesOrder" TEXT;

    -- AlterTable
    ALTER TABLE "pm_tasks" ADD COLUMN     "erpOrderItem" TEXT;

    -- CreateIndex
    CREATE UNIQUE INDEX "pm_clients_companyId_erpCustomer_key" ON "pm_clients"("companyId", "erpCustomer");

    -- CreateIndex
    CREATE UNIQUE INDEX "pm_projects_erpSalesOrder_key" ON "pm_projects"("erpSalesOrder");
    ```
  - Ran migration and generated Prisma client on dev DB (`engineering_os`), zero drift verified via `prisma migrate diff`.
  - Ran migration, seed, and integration tests on fresh CI-like throwaway DB (`engos_ci_014`): 14 test files passed, 63 tests passed.
  - **Test counts:**
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 14 test files passed, 163 tests passed.
    - `npm run test:int`: 14 test files passed, 63 tests passed.
    - `npm run build`: clean.
- **Step 3 (Order service):**
  - Created `src/modules/erp/order.service.ts` with `listWaitingOrders(principal)` and `getOrderForProject(principal, orderName)`.
  - Enforced permission checks gated on `pm.project.create` using `hasPermissionAnywhere`.
  - Implemented `listWaitingOrders`: queries submitted orders (`docstatus = 1`, not Closed or Cancelled), filters out orders with `custom_project_code` or existing `Project.erpSalesOrder`, fetches items via `erpGet` to summarize panel scopes (e.g. `2 × PLC, 1 × SCADA`), and returns newest first.
  - Implemented `getOrderForProject`: fetches order, validates draft/cancelled/closed, validates against existing linked project in ERPNext and Engineering OS, validates numeric WO number, validates active checklist templates (`PLC`, `SCADA`, `HMI`), looks up `custom_acs_reference` on ERP Customer, computes scopes and per-unit delivery dates, and maps `Task.erpOrderItem` row references (`${row.name}#${unitInRow}`).
  - Added integration tests in `src/modules/erp/order.service.int.test.ts` (12 tests) covering allow, deny (engineer lacking `pm.project.create`), happy paths for both functions, and all refusal cases (draft, cancelled, closed, already linked in ERPNext, already linked in DB, missing WO, non-digit WO, invalid checklist item code).
  - **Test counts:**
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 14 test files passed, 163 tests passed.
    - `npm run test:int`: 15 test files passed, 75 tests passed.
    - `npm run build`: clean.
- **F2 (the waiting list misses orders):**
  - Updated `listWaitingOrders` in `src/modules/erp/order.service.ts` to push filters directly to ERPNext: `docstatus = 1`, `custom_project_code is not set`, and `status not in ['Closed', 'Completed', 'Cancelled', 'On Hold']`, and set `limit: 0` (`limit_page_length=0` in Frappe) so all matching waiting orders are returned rather than being truncated by Frappe's 20-row default page limit.
  - Updated `getOrderForProject` to refuse `On Hold` orders with "Sales order is on hold." (and `Completed` orders with "Sales order is completed.") aligning the single-order validator with waiting order listing.
  - Updated `src/modules/erp/order.service.int.test.ts` (14 tests) to assert exact ERPNext filters and `limit: 0`, verify that a waiting order past the default 20-order limit (e.g. 25 orders returned with candidate at index 24) is returned, and verify `getOrderForProject` refuses `On Hold` orders.
  - **Test counts:**
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 14 test files passed, 163 tests passed.
    - `npm run test:int`: 15 test files passed, 77 tests passed.
    - `npm run build`: clean.
- **Step 4 (Client from the ERPNext customer — lazy ACS reference):**
  - Implemented `resolveClientForCustomer(principal, customer)` in `src/modules/erp/order.service.ts`:
    - Checks `pm.project.create` permission.
    - Branch 1: looks up existing client by `erpCustomer`.
    - Branch 2: if customer has `custom_acs_reference`, looks up client by `refNumber` and links `erpCustomer`.
    - Branch 3 (name clash): if an unlinked client exists with matching name, links that client and writes reference back.
    - Branch 4: creates a new client with `nextClientRef`, links `erpCustomer`, audits `client.created`, and writes reference back to ERPNext.
    - Handles concurrency races: catches unique constraint error `P2002` on parallel creation and safely retries lookup by `erpCustomer` / name so concurrent requests resolve to the exact same client.
    - Handles write-back failure: keeps created/linked client in DB without throwing away work, logging failure; subsequent resolutions re-attempt `erpUpdate`.
  - Added integration tests in `src/modules/erp/order.service.int.test.ts` (21 tests total) covering permission gate, all 4 branches, parallel creation race resolution, and write-back failure resilience.
  - **Test counts:**
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 14 test files passed, 163 tests passed.
    - `npm run test:int`: 15 test files passed, 84 tests passed.
    - `npm run build`: clean.
- **Step 5 (create the project from the order):**
  - **Environment / tools:** done in a cloud container, not on the user's PC. code-review-graph, Token Savior and sequential-thinking were **not available** here, so callers were found with text search (`grep`): `createAutomationProject` is called by `createAutomationProjectAction`, `createServiceCallAction` and the int tests named in "Affected code"; `writeProjectToOrder` is new (called by `createAutomationProject` and `listWaitingOrders`). The ordering questions (DB transaction vs write-back, repair, parallel saves) were reasoned through by hand. No local ERPNext and no Docker here: Postgres 16 ran directly on the container. **ERPNext check pending** for this step: the write-back to a *submitted* order relies on `allow_on_submit: 1` for `custom_project_code` / `custom_project_link` in `erp/acs_erp/acs_erp/fixtures/custom_field.json` (checked in the file only). Step 8 covers it in the browser.
  - `createAutomationProject` (`automation-project.service.ts`):
    - new optional `salesOrder`; `clientId` / `clientName` are now optional in `CreateAutomationProjectInput` (an order's client may not exist yet).
    - **ERP on** (`isErpEnabled()`): a work order without `salesOrder` → "Pick a sales order first."; service calls unaffected. `salesOrder` together with `kind: 'SERVICE_CALL'` → "A service call can't come from a sales order."
    - With `salesOrder`: `getOrderForProject` supplies WO, PO, target date, scopes, panel dates and `erpOrderItem`s; the browser's client, WO, target date, scopes and panel dates are ignored. Task drafts for panels that aren't on the order are dropped (so they add no members). `resolveClientForCustomer` runs only **after** every check has passed, so a refused save doesn't create a client. The project code is computed after that (moved below the date checks for both paths; no behaviour change).
    - Stores `erpSalesOrder`, `clientPoNumber`, `erpOrderModified` (ERPNext's string, unchanged) and each `PHASE` task's `erpOrderItem`.
    - Date errors on an order end with "Change the dates on the sales order in ERP." (reviewer's step-3 note).
    - Parallel saves of one order: the second is refused by `getOrderForProject`, or, if both pass that check, by the unique index (`P2002` on `erpSalesOrder` → "This sales order already has a project."; on `workOrderNo` → "Work Order No. … is already in use.").
    - **After the transaction commits**, `writeProjectToOrder` writes `custom_project_code` and `custom_project_link` (`<APP_URL>/pm/projects/<id>`). If it fails, the project stays, the error is logged and audited as `erp.writeback_failed` (diff: `erpSalesOrder`, `code`).
    - Audit: the create audit is now `pm.project.created` as the plan says (it was `pm.automation_project.created`, which nothing reads and the audit log didn't format). The diff gains `workOrderNo`, `projectManagerId` (so the audit log shows "WO … · PM …") and `erpSalesOrder`.
  - `order.service.ts`: new `writeProjectToOrder(orderName, {id, code})`. `listWaitingOrders` repairs a missed write-back: an order ERPNext still lists without a project code but that is on a `Project.erpSalesOrder` gets its fields written again (best effort, logged) and is never listed as waiting.
  - `createAutomationProjectSchema` (`schemas.ts`): optional `salesOrder`. With it, client, WO and scopes aren't required (the server reads them from ERP). Without it, client, client name, WO and scopes are required as before. The action passes `salesOrder` through unchanged.
  - **Tests (TDD, red first):** new `src/modules/erp/order-to-project.int.test.ts` (7): ERP off unchanged; ERP on refused without an order and service call still allowed; denied without `pm.project.create`; happy path (order beats browser values, new client linked to the customer, `erpOrderItem` and per-panel dates, ignored HMI draft adds no member, write-back payload, audit diff); parallel save refused (exactly one project); write-back failure kept + audited + repaired by `listWaitingOrders`; tight dates say to fix them in ERP. `schemas.test.ts`: +2 (order without client/WO/scopes accepted; still required without).
  - **One existing test changed (please check):** `pm-panel-assignment.int.test.ts` test 2 read `prisma.task.findFirst({ where: { projectId, type: 'PROJECT' } })` with **no `orderBy`** and assumed it got step 1 (T001). The new parallel-save test rolls back one transaction; Postgres reuses that space, and the unordered read then returned T002 (no assignee). It failed only when run after the new file (reproduced with just those two files; passed alone). Fix: added `orderBy: { code: 'asc' }`. No product behaviour changed.
  - **Test counts:**
    - `npm run typecheck`: clean (0 errors).
    - `npm test`: 14 test files passed, 165 tests passed.
    - `npm run test:int` (dev DB): 16 test files passed, 91 tests passed.
    - `npm run test:int` on a fresh throwaway DB (empty → `npx prisma migrate deploy` → `npm run db:seed`): 16 files, 91 tests passed.
    - `npm run build`: clean.
- **Step 6 (New project wizard: pick a sales order first):**
  - New server actions `src/app/actions/erp-orders.ts`: `listWaitingOrdersAction()` and `getSalesOrderAction(name)` wrap `listWaitingOrders` / `getOrderForProject`. Client-safe errors (`DomainError` etc.) pass their message; anything else is logged and becomes "ERP isn't responding. Try again in a minute."
  - New `sales-order-step.tsx` (`SalesOrderStep`): step 0 table (customer, order + PO, WO, panels, delivery), search box, Refresh, "Use this order"; empty state "No confirmed sales orders are waiting for a project." / "Create and submit the order in ERP first." with **Open ERP** (`/erp/open`, our SSO); ERP down → the error with **Try again**; **Create a service call instead** is always there. A refused pick (e.g. a missing WO) shows the reason inline.
  - `AutomationProjectWizard`: new props `erpEnabled` and `erpOrderUrlBase` (from `NewProjectPage`: `isErpEnabled()` and `ERPNEXT_PUBLIC_URL/app/sales-order/`). ERP on → starts on step 0; picking fills WO, client name, ACS reference (or "Assigned when you save"), target date, scopes and per-panel dates, and locks them (read-only WO, client and target date; scope checkboxes and quantities disabled; panel dates read-only). A "From sales order SAL-ORD-… · Client PO … Change them in ERP." line with **Open in ERP** shows on steps 1–3. The service-call toggle is hidden when ERP is on (step 0 decides); a service call shows "Service call: no sales order needed." with **Pick a sales order instead**. The target-date auto-bump is off for an order (so a too-tight order shows the error, ending "Change the dates on the sales order in ERP.", instead of being silently moved). Submit sends `salesOrder` and no `clientId` (the server resolves the client). PM, engineers, start date, code, end user, application stay editable. **ERP off: the wizard is unchanged** (starts at step 1, toggle shown, nothing locked).
  - No unit test for the components (the project has no React test setup); the logic they call is covered by the step 3–5 integration tests.
  - **Browser check (no real ERPNext here: ERPNext check pending).** No Docker in this container, so ERPNext couldn't run. Instead: production build (`next start`) with ERP env pointing at a **throwaway mock of the ERPNext REST endpoints** (`/api/resource/Sales Order|Customer`, GET/PUT, same filters; kept outside the repo), signed in as a Director in Chromium (Playwright):
    - step 0 listed the 2 submitted orders, not the draft; search "8101" → 1 row;
    - picking SAL-ORD-2026-00101 (new customer, 2 × PLC on two rows with different dates, PO) locked WO 8101, client, target date, 3 scope checkboxes and 2 panel dates; the order line and PO showed;
    - after choosing a PM and saving: project `ACS-0004-0001`, WO 8101, PO, `erpOrderModified`, PLC Panel 1/2 with `it101a#1` / `it101b#1` and their own dates; new client `ACS-0004` linked to the customer; the mock order got `custom_project_code` + `custom_project_link`, the customer got `custom_acs_reference = ACS-0004`;
    - the waiting list then showed only SAL-ORD-2026-00102;
    - mock ERP down: step 0 showed "ERP isn't responding. Try again in a minute." with Try again; `/pm/projects` still loaded (200); "Create a service call instead" opened the normal client picker; after bringing it up, "Pick a sales order instead" listed the orders again.
  - **Test counts:** typecheck clean; `npm test` 14 files / 165 tests passed; `npm run test:int` 16 files / 91 tests passed; `npm run build` clean.
- **Step 7 (project page and Edit details):**
  - `updateProject` (`project.service.ts`): on a project with `erpSalesOrder`, a **change** to WO, client (id or name), target date or any panel delivery date is refused with "This comes from the sales order. Change it in ERP." Values equal to the stored ones pass, because the Edit details dialog sends every field on each save. Code, name, priority, start date, end user and application stay editable. Unlinked projects are unchanged. The API route `PUT /api/pm/projects/[id]` goes through the same function, so it's locked too.
  - `EditProjectDetailsButton`: new `erpSalesOrder` prop. When set, client, WO, target date and panel dates are disabled, each with "This comes from the sales order. Change it in ERP."; the header says the order's name.
  - `ProjectPage`: the subtitle shows "From sales order SAL-ORD-…" (link to `ERPNEXT_PUBLIC_URL/app/sales-order/<name>`, or plain text without that setting) and "PO …" when set.
  - **Tests (TDD, red first):** new `src/modules/erp/order-field-lock.int.test.ts` (4): each order field refused on a linked project (and nothing saved); code, priority and unchanged order values still save on a linked project; unlinked project keeps today's behaviour; PM still forbidden.
  - **Browser check (mock ERPNext, as in step 6):** on the project from step 6, the subtitle link pointed at `…/app/sales-order/SAL-ORD-2026-00101` and "PO NCL/PO/7781" showed; in Edit details, client, WO, target and panel dates were disabled, code and priority were not; changing priority saved (`HIGH`), WO and target unchanged.
  - **Found, not fixed (outside this plan; needs its own plan):** Edit details fails with "Expected string, received null" whenever **End user name or Application name is empty**: the dialog sends `null` for an empty field, but `updateProjectSchema` (from `baseProjectSchema`) accepts only `string | undefined` for `endUserName` / `applicationName`. Pre-existing since plan 008 (same code on `main`), so it likely affects the live app. Workaround in the browser check: filled both fields.
  - **Test counts:** typecheck clean; `npm test` 14 files / 165 tests passed; `npm run test:int` 17 files / 95 tests passed; `npm run build` clean.
- **Step 8 (end to end on a real local ERPNext, in the browser):**
  - **Local ERPNext (this container, outside the repo, `/var/tmp/erpnext-local`):** Docker works here after all (started `dockerd` by hand). `frappe_docker` **v3.2.2** (same pinned tag as plan 012), compose `compose.yaml` + `overrides/compose.mariadb.yaml` + `overrides/compose.redis.yaml` + `overrides/compose.noproxy.yaml` (no trim override; it lives only on the user's PC), port `127.0.0.1:8080`, site `frontend`. `.env` keys: `ERPNEXT_VERSION`, `CUSTOM_IMAGE`, `CUSTOM_TAG`, `PULL_POLICY`, `DB_PASSWORD`, `ADMIN_PASSWORD`, `HTTP_PUBLISH_PORT`, `FRAPPE_SITE_NAME_HEADER`, `GUNICORN_*`, `ERP_SSO_SECRET`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET` (values only in that file).
    - **Image `acs-erpnext:v16.37.0-acs6`**, built from `erp/Dockerfile` + `erp/acs_erp` with **two local-only lines** (in a build copy outside the repo) that trust this container's HTTPS-proxy CA (`COPY ccr-ca.crt` + `ENV PIP_CERT=… NODE_EXTRA_CA_CERTS=…`). Without them `pip install -e acs_erp` can't reach pypi.org through the sandbox proxy (`CERTIFICATE_VERIFY_FAILED`). `erp/Dockerfile` itself is unchanged; the user's PC doesn't need this.
    - `bench new-site … --install-app erpnext --set-default frontend`, `install-app acs_erp`, `setup_complete` (ACS Engitech / ACS, India, INR, FY 2026-04-01 → 2027-03-31, Standard chart, no GSTIN), `set-config acs_erp_sso_secret` / `acs_erp_engos_origin http://localhost:3100` / `host_name`, `enable-scheduler`, `migrate`. Items PLC / SCADA / HMI exist after the migrate. API user `engos-api@acsengitech.com` with **only `Sales User`**, keys generated.
    - Our app: production build (`next start -p 3100`) with `ERPNEXT_URL` / `ERPNEXT_PUBLIC_URL=http://127.0.0.1:8080`, key, secret and `ERP_SSO_SECRET` passed **as process env only**. **Heads-up:** putting the ERP keys in our `.env` makes `npm run test:int` fail (21 tests), because Prisma loads `.env` into `process.env`, so `isErpEnabled()` is true and the existing ERP-off tests are refused "Pick a sales order first." CI has no keys, so CI is unaffected; locally, keep the ERP keys out of `.env` while running tests (or a future change could blank them in `vitest.integration.config.ts`).
  - **What I saw (Chromium via Playwright, signed in through our login and our SSO):**
    - **Sales Head** (`dharmesh.thummar@…`) → our ERP entry → landed in ERPNext as themselves. In that desk session created customer **Gujarat Alkalies Ltd** (new) and submitted **SAL-ORD-2026-00001**: WO 9301, PO `GACL/PO/2026/118`, rows PLC × 1 (delivery +120 days) and SCADA × 1 (+150 days). The order was created through ERPNext's own desk API calls (`frappe.client.insert` / `submit` in the user's browser session), not by clicking through the form.
    - **Director** (`satishkumar.nagar@…`) → New project: step 0 listed SAL-ORD-2026-00001 (with its PO); picked it → WO 9301, client "Gujarat Alkalies Ltd", ACS reference "Assigned when you save", target 2027-03-01, all locked; chose a PM, auto-assign filled engineers; saved.
    - **Project** `ACS-0005-0001`: WO 9301, client Gujarat Alkalies Ltd, PO `GACL/PO/2026/118`, target 2027-03-01; PLC Panel 1 → 2027-01-30 (`erpOrderItem` `77o7r9lgab#1`), SCADA Panel 1 → 2027-03-01 (`77og0bblnn#1`), the same as ERPNext's row names and dates.
    - **New client** `ACS-0005` (`erpCustomer` = the customer); ERPNext customer `custom_acs_reference` = `ACS-0005`.
    - **ERPNext order page** (desk, full Chromium): Project Code `ACS-0005-0001`, Project Link `http://localhost:3100/pm/projects/cmur8jjcp000p7dclgkfnsvaj`, last edited by EngOS API. Opening that link in our app shows the project; the project page's "From sales order" link (`/app/sales-order/…`) redirects to ERPNext v16's `/desk/sales-order/…` and opens the order.
    - The order was **no longer waiting**. A **second order** SAL-ORD-2026-00002 for the same customer (WO 9302, no PO) showed reference ACS-0005 when picked and became `ACS-0005-0002`; still exactly **one** client for that customer.
    - **ERPNext backend stopped for a minute** (`docker compose stop backend`): New project showed "ERP isn't responding. Try again in a minute." with Try again (after ~10 s, the client timeout); `/pm/projects`, the project page and `/dashboard` all returned 200; "Create a service call instead" opened the normal form. After `start backend`, New project showed the empty state "No confirmed sales orders are waiting for a project."
    - Side notes, not ours: the Playwright **headless shell** can't render ERPNext forms (`RangeError: Incorrect locale information provided`); full Chromium can. ERPNext logs "socket.io: Invalid origin" for the `127.0.0.1` host (realtime only; pages work).
  - **Before DONE:** `npm run test:int` on a fresh throwaway DB (empty → `npx prisma migrate deploy` → `npm run db:seed`): 17 files / 95 tests passed. `python3 -m unittest discover -s erp/acs_erp`: 23 tests OK. typecheck clean, `npm test` 165 passed, build clean (from step 7, no code change since).
  - **Self-review of the plan's diff (`review-delta` skill not installed here; done by hand):** ERP off → `isErpEnabled()` is false, wizard starts at step 1 and the server path is unchanged (step 5 test). The server never trusts order fields from the browser (step 5 test). Callers of the changed functions (`createAutomationProject`, `updateProject`, `listWaitingOrders`) were found by text search (graph/Token Savior not available in this container).

## Review (Claude)

**Review 2026-10-02, commit `e77084e` (step 1). Verdict: accepted, with one small follow-up.**
- **OK:**
  - token auth, 10 s timeout, one "ERP isn't responding" error for network/5xx/401/403/bad JSON, and a distinct `NotFoundError` for 404;
  - no secret in the logs; nothing sent to the browser.
  - The `optionalNonEmpty` change in `config.ts` also fixes a latent bug: `ERPNEXT_URL=""` from `.env.example` would have failed `z.string().url()` and broken `config()`.
  - Claude ran the ERP unit tests (16 passed) and typecheck (clean).
- [x] **F1: one source for ERP settings, and no test switch in production code.**
  - `readErpConfig` wraps `config()` in `try/catch` and falls back to `process.env` (and also ORs `process.env` back in). If the env is invalid, that hides it and runs on unvalidated values. Read only `config()` and let a bad config fail loudly.
  - `config.ts` now skips its cache when `NODE_ENV === 'test'`. That changes production code for tests. Instead, reset the module in the test (`vi.resetModules()` plus `vi.stubEnv`, or a small exported reset used only by tests), and put the cache line back as it was.
  - Re-run the full suite and paste the counts.

**Re-review 2026-10-02, commit `c14c749` (F1). Verdict: F1 accepted.**
- `readErpConfig` reads only `config()`, so a bad env now fails loudly.
- The `config.ts` cache line is restored; tests use `vi.stubEnv` plus a `resetConfigCache()` export.
- Claude re-ran the ERP unit tests: pass.
- **Next: step 2** (the `erp_order_links` migration).

**Review 2026-10-02, commit `af2fe4c` (step 2). Verdict: accepted.**
- The migration `20261002090500_erp_order_links` is purely additive: 5 nullable columns and 2 unique indexes. It sorts after `20261001122602_erp_access_permission`.
- Postgres allows many NULLs under a unique index, so the existing rows are unaffected. Tested on a fresh CI-like DB.
- **`erpOrderModified` is `TEXT`, not a timestamp.** Fine, and arguably better: keep it as ERPNext's own `modified` string (site time, no timezone) and only ever pass it back in ERPNext filters (`modified > value`). Don't turn it into a JS `Date` (steps 5 and 015).
- **Next: step 3** (order service).

**Review 2026-10-02, commit `894c152` (step 3). Verdict: accepted, with one real bug to fix first (F2).**
- **OK:**
  - `getOrderForProject` refuses draft, cancelled, closed and already-linked orders (both systems), missing or non-digit WO, unknown item codes and zero quantities;
  - units are numbered across rows, and `erpOrderItem` is `row#unitInRow`;
  - the ACS reference is read from the customer.
  - Claude ran `order.service.int.test.ts`: **12 passed**.
- [x] **F2: the waiting list misses orders.**
  - **The bug:** `listWaitingOrders` calls `erpList` with no `limit`, so Frappe returns only its default page (20 rows) of submitted orders, sorted by `modified desc`, and our code filters them afterwards. The local site already has 50+ submitted orders. After plan 015's backfill, production will have one per existing project, all with `custom_project_code` set. A real waiting order older than the newest 20 orders would silently never appear.
  - **Fix:** let ERPNext do the filtering: `docstatus = 1`, `custom_project_code` not set, and status not in `Closed`, `Completed`, `Cancelled`, `On Hold`. Ask for all rows (`limit_page_length` 0, or a stated high cap with a log line when it's hit).
  - **Also refuse `On Hold`** in `getOrderForProject`, so the list and the check agree.
  - **Optional (ponytail):** the per-order `erpGet` for item summaries is one call per waiting order. That's fine while the list is short. If you change it, use one list call with child-table fields, but don't build anything bigger.
  - **Test:** the mock returns more than 20 orders, with the waiting one oldest, and it's still listed. Assert the filters sent to `erpList`.
- **Note for step 5:** an order whose dates are too tight (the panel date before today, or shorter than the template's minimum working days) will be refused by `createAutomationProject`'s existing date checks. Make sure the message says to fix the dates **in ERP**.

**Re-review 2026-10-02, commit `661dc8b` (F2). Verdict: F2 accepted.**
- **Claude checked against the real local ERPNext (`acs5`)** with the `engos-api` key:
  - submitted orders with the default page: **20**;
  - with `limit_page_length=0`: **52**, which confirms the bug was real;
  - with the F2 filters (`custom_project_code is not set`, status not in Closed / Completed / Cancelled / On Hold) and limit 0: accepted by ERPNext, **52** returned. None has a project yet, so all are waiting.
- The code-side status filter remains as a second guard. `getOrderForProject` now also refuses On Hold and Completed orders.
- **Next: step 4** (client from the ERPNext customer).