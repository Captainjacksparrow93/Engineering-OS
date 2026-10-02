# 014 — ERP: every new project starts from a sales order

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
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
- [ ] **4. Client from the ERPNext customer (lazy ACS reference).** `resolveClientForCustomer(principal, customer)`:
  1. find our client by `erpCustomer`;
  2. otherwise, if the customer's `custom_acs_reference` matches a client's `refNumber`, link that client;
  3. otherwise create a client named after the customer with `nextClientRef`.
  Then write `custom_acs_reference` back to the ERPNext customer if it's empty.
  - Two Directors picking orders of the same new customer at the same time must end with **one** client: rely on the unique constraints and retry the lookup.
  - A name clash with an existing unlinked client of the same name links that client instead of failing.
  - Tests: each branch, the race (two parallel calls), write-back failure (the client still exists; the next call writes the reference again).
- [ ] **5. Create the project from the order.**
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
- [ ] **6. New project wizard: "Pick a sales order" first.** When ERP is on:
  - **Step 0** lists the waiting orders (customer, order number, WO, panels, delivery date), with a search box.
  - Picking one fills steps 1–2 and **locks** client, WO, PO, panels and dates, with a "From sales order SAL-ORD-…" line and a link to the order in ERPNext (`ERPNEXT_PUBLIC_URL/app/sales-order/<name>`). PM, engineers, task dates and priority stay editable.
  - **Empty state:** "No confirmed sales orders are waiting for a project. Create and submit the order in ERP first." with a link to ERP.
  - **ERP down:** say so with a "Try again" button. Service call creation stays available.
  - **ERP off:** the wizard is exactly as today.
  - Use `ux-writing` for the text and `impeccable` for layout.
- [ ] **7. Project page and Edit details.**
  - The project page shows "From sales order SAL-ORD-…" (link to ERPNext) and the client PO when set.
  - `updateProject` refuses changes to client, WO, target date and panel delivery dates on a project with `erpSalesOrder`: "This comes from the sales order. Change it in ERP." The Edit details dialog shows those fields read-only with the same hint. Code, priority, PM and engineers stay editable.
  - Projects without `erpSalesOrder` (all existing ones until plan 015) keep today's behaviour.
  - Tests: refused on a linked project, still allowed on an unlinked one, PM still forbidden.
- [ ] **8. Check it end to end on the local ERPNext, in the browser.**
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
- [ ] Typecheck, unit tests, build and integration tests pass (full suite), including on a fresh CI-like database.
- [ ] With ERP on, a work-order project can only be created from a confirmed sales order without a project. The order's values win over anything the browser sends.
- [ ] Client, ACS reference, project code and link are consistent in both systems after step 8, and a failed write-back repairs itself.
- [ ] Order fields of linked projects can't be edited in our app; unlinked projects behave as before.
- [ ] ERPNext down: New project explains it; everything else in PM works.
- [ ] With ERP off, behaviour is unchanged (existing tests untouched and green).
- [ ] No secret in the repo, notes, logs or the browser.

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