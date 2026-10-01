# 012 — ERP Phase 0: ERPNext running, measured, reachable by API

**Status:** IN PROGRESS (part A done)   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Part A (steps 1–5, local on the owner's PC):** Antigravity · **Part B (steps 6–9, VPS):** Claude, each change only after the user approves it
**Branch:** `erp`

## Goal
Prove, with measurements and real API calls, that ERPNext can run **on the current VPS without endangering the live app**, and leave a working, private ERPNext there that phases 1–2 (plans 013–014) connect to.

**User decisions (2026-10-01, recorded in `CLAUDE.md`):**
- ERPNext on the same VPS, used only through its REST API.
- **No VPS upgrade and no second server.**
- Minimal setup defaults.
- No accounting-software integration.
- All modules eventually.
- Every work-order project originates from a confirmed sales order.
- Sales Head and Directors create orders.

## Facts this plan relies on (checked 2026-10-01)
- **ERPNext:** official images `frappe/erpnext`, current **v16.37.0**, in the `frappe_docker` repository.
  - `pwd.yml` is the quick start and is "intended for short-lived evaluation only".
  - Production uses `compose.yaml` plus overrides (MariaDB, Redis, proxy/no-proxy).
  - Services: `backend` (gunicorn), `frontend` (nginx), `websocket`, `scheduler`, `queue-short`, `queue-long`, `db` (MariaDB 11.8), `redis-cache`, `redis-queue`, plus one-shot `configurator` and `create-site`.
  - Re-check the exact override file names and `.env` keys in the official `frappe_docker` docs on the day; don't follow blog posts.
- **REST API:**
  - Auth header `Authorization: token <api_key>:<api_secret>`.
  - List: `GET /api/resource/<DocType>?fields=[..]&filters=[..]&limit_page_length=n`.
  - Read: `GET /api/resource/<DocType>/<name>`.
  - Create: `POST`. Update: `PUT`.
  - Submitting a document = setting `docstatus` to 1.
  - Errors return `exc` / `exc_type`.
- **VPS (read-only check 2026-09-30):**
  - 7.8 GiB RAM, about 4.8 GiB available; 71 GB disk free.
  - Shared with Chatwoot (rails, sidekiq, postgres, redis), n8n, Supplychain, Traefik and others.
  - Engineering OS limits: app 768 MB, Postgres 512 MB.
- **Sales order fit:** ERPNext's Sales Order already has `customer`, `po_no` (client PO number), `delivery_date`, and item rows with `item_code`, `qty` and their own `delivery_date`. Only the **WO number** needs a custom field. Panels map to Items (PLC / SCADA / HMI panel), one per checklist template code.

## Deployment shape (answer to "separate or same container?")
- ERPNext is a **separate deployment on the same VPS**: its own folder (`/root/erpnext-docker`), its own Docker Compose project, its own containers and its own MariaDB.
- **Nothing goes into `engos_app`**, and our GitHub deploy workflow (plan 010) never touches ERPNext. Engineering OS deploys and ERPNext upgrades are independent.
- **Private for now:** ERPNext gets **no public address in this phase**. Plan 013 adds its public HTTPS address together with single sign-on and the `acs_erp` theme (user decision 2026-10-01: people use ERPNext's own screens, restyled).
  - Its web container listens only on `127.0.0.1` for this phase's checks.
  - From plan 013 on, it joins a private Docker network that `engos_app` also joins.
  - No Traefik route and no public port.
- **Every ERPNext container gets a hard memory cap** (`mem_limit`), so ERPNext can only exhaust its own share and never the live app's.

## Constraints
- The app is LIVE. Nothing in `/root/engos-docker`, `engos_app` or `engos_db` changes in this plan.
- No `docker compose down -v`, no deleting volumes, no `docker system prune` / `image prune -a` (the server is shared).
- Secrets (MariaDB root password, ERPNext Administrator password, API key/secret) are generated on the server or locally. They live only in `/root/erpnext-docker/.env` (mode 600) or `/root/engos-docker/.env`, and are **never** committed, pasted into plans or printed.
- Local experiments live **outside** the repo (e.g. `C:\Users\Dhruv-Home\erpnext-local`). Nothing ERPNext-related is added to this repo in phase 0 except this plan and its notes.
- **Stop rule:** if a gate below fails, stop, write down the numbers, and report to the user before touching the VPS.

## Tools & skills (Antigravity: part A)
- **Before you start:**
  - `git checkout erp`.
  - Read `AGENTS.md` → "ERP work".
  - Work folder for ERPNext: `C:\Users\Dhruv-Home\erpnext-local` (outside the repo).
  - Docker Desktop must be running.
- **What you commit:** only edits to **this plan file**: tick the boxes and fill **Implementation notes** with commands, `.env` key **names**, settings, JSON payloads (without secrets) and memory numbers. **No files from `erpnext-local` go into the repo**, and there's no app code in this phase.
- **Docs to follow:** the official `frappe_docker` repository and docs (production compose with overrides) and the Frappe REST API docs (token auth `Authorization: token <key>:<secret>`, `/api/resource/<DocType>`). Record the URLs you used.
- **Memory numbers:** `docker stats --no-stream` (paste the table). Note Docker Desktop's own memory limit (Settings → Resources), because it caps what the containers can use.
- **No app code changes**, so the code-review-graph and Token Savior have nothing to check this phase. Blast radius on Engineering OS: none (separate compose project, no shared files). Plan 013 runs the graph on the code it touches.
- **sequential-thinking:** required for step 3 (choosing the trims) and step 5 (the memory gate and the go/no-go call).
- **Skills:** `ponytail` (full). Use stock `frappe_docker` and change only what the memory budget needs; no custom image in this phase (plan 013 builds the `acs_erp` image).
- **Tests:** no app tests (nothing in `src/` changes). Still run `npm run typecheck && npm test` once at the end to confirm the repo is untouched, and paste the counts. The proof is the recorded API calls and memory numbers.
- **When done with step 5:** set Status to `IN PROGRESS (part A done)`, commit locally on `erp` (`plan 012: part A ...`), leave the tree clean, and stop. Don't push.

## Steps

### A. Local (Antigravity, on the owner's PC with Docker Desktop; no VPS access)
- [x] **1. Run ERPNext locally the production way.**
  - Clone `frappe_docker` at a pinned tag outside the repo.
  - Use the production compose (`compose.yaml` + MariaDB + Redis overrides + no-proxy) with `ERPNEXT_VERSION=v16.37.0`.
  - **Bind the published port to `127.0.0.1:8080` explicitly.** The no-proxy override publishes on all interfaces by default, and Docker's published ports bypass host firewalls.
  - The Administrator and MariaDB root passwords are **generated**, never the quick-start defaults (`admin`).
  - Create one site with ERPNext installed.
  - Record the exact files, `.env` keys (not values) and commands used. Plan 013 and the VPS step reuse them.
- [x] **2. Minimal setup, no setup wizard UI:**
  - Company "ACS Engitech" (abbr `ACS`), country India, currency INR, financial year 1 April–31 March, standard chart of accounts, no GSTIN.
  - Time zone `Asia/Kolkata`, Indian number format (`#,##,###.##`), date format matching ours.
  - **Sign-up disabled** (no self-registration on the login page).
  - Use the setup API or `bench` where possible, and record how.
  - Disable what we don't use at startup (e.g. email polling) only if it measurably saves memory.
- [x] **3. Trim to the memory budget:**
  - One queue worker for all queues instead of `queue-short` + `queue-long`.
  - A small gunicorn worker count.
  - MariaDB `innodb_buffer_pool_size` about 256 MB.
  - Redis `maxmemory` caps.
  - A `mem_limit` on every service.
  - Record each setting and why.
- [x] **4. Prove the API (`curl` or a throwaway script outside the repo):**
  1. **Setup work (Items, custom fields) is done as Administrator, not with the API user.** Then create an API user `engos-api` with only what the integration needs: read Customer, Item and Sales Order, create/update Customer, and update the project-link fields on Sales Order (start from "Sales User"; **not** System Manager unless something fails, and record what). Generate its API key and secret.
  2. Create a **Customer**, list Customers, read one back.
  3. Create the panel **Items**: PLC Panel, SCADA Panel, HMI Panel (codes matching our checklist template codes), non-stock, UOM Nos.
  4. Add custom fields:
     - **WO Number** on Sales Order (Data, **not unique**: ERPNext's cancel-and-amend creates a new order with the same WO, which a unique field would block; our app enforces one active order per WO).
     - **Project code** and **Project link** on Sales Order (read-only in ERPNext, written by our app).
     - **ACS reference** on Customer (`ACS-0001` style, written by our app).
  5. Create a **Sales Order**: customer, `po_no`, WO number, `delivery_date`, and two item rows with their own `delivery_date`. Then **submit** it (`docstatus` 1) and read it back.
     - Also test one order with **no rate** (order value is optional): does ERPNext accept a zero or blank rate, and with what warning?
     - Then **cancel and amend** it: confirm the amended order (`…-1`) keeps the WO Number and has `amended_from` set.
  6. Record the **minimum mandatory fields** for Customer and Sales Order and one real **error response** (a missing field) as JSON in the notes. Plans 013–014 build on these.
  7. **List the orders that are waiting for a project:** submitted, not cancelled, with an empty Project link, filtered by API (for example `filters=[["docstatus","=",1],["project_link","is","not set"]]`). The New project form uses this list (pull design, decided).
- [x] **5. Measure (gate 1).**
  - `docker stats` for every ERPNext container: at rest after 10 minutes, and peak while creating 50 customers and 50 submitted sales orders via the API.
  - Also measure while clicking through ERPNext's desk for 5 minutes (Selling workspace, Sales Order list and form, Customer list), because people will use ERPNext's own screens.
  - Gate: **total peak ≤ 2.5 GB** with the caps in place, and no container killed for running out of memory.
  - If it fails, try the trims again once; if it still fails, stop and report.

### B. VPS (Claude only, each step after the user approves it). Antigravity: stop after step 5
- [ ] **6. Check headroom (gate 2, read-only).**
  - Record `free -m` and `docker stats --no-stream` at 3 different times of a working day.
  - Gate: available memory minus the **sum of the ERPNext `mem_limit` caps** (the most ERPNext can ever take, not the measured peak) must leave **≥ 1.5 GB**.
  - If not, stop and report: options then are trimming other services on the box, or a user decision.
- [ ] **7. Install ERPNext on the VPS.**
  - Folder `/root/erpnext-docker`, the same pinned `frappe_docker` tag and the compose from step 1 with the step 3 trims and caps.
  - `restart: unless-stopped`; listening only on `127.0.0.1:8080` (checked free on 2026-10-01; `0.0.0.0:8000` is already used by another app on the box, which is fine because ERPNext uses 8000 only inside its own network).
  - `.env` with generated secrets, mode 600.
  - Then repeat step 2 (minimal setup) and steps 4.1–4.4 (API user, Items, WO Number field). Store the API key and secret only in `/root/engos-docker/.env` as `ERPNEXT_URL`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET`.
- [ ] **8. Backups.**
  - A daily `bench backup` (database + files) into `/root/erpnext-docker/backups`, kept 14 days like ours, via a cron entry on the VPS.
  - Run it once and check the file.
  - Document how to restore it in `PROJECT.md` (Claude).
- [ ] **9. Watch for 24 hours (gate 3, read-only).**
  - `free -m` and `docker stats` morning and evening.
  - Engineering OS `/api/health` stays ok, and no out-of-memory kills (`dmesg`/`journalctl -k`) for any container.

## Acceptance criteria
- [ ] Gates 1–3 passed, with numbers in the notes.
- [ ] ERPNext v16.37.0 runs on the VPS in its own compose project, memory-capped, not reachable from the internet (checked from outside: port 8080 closed).
- [ ] From the VPS, with the `engos-api` key: create/read Customer works, Items and Sales Orders can be read, the project-link fields can be set, and the "orders waiting for a project" query returns the right orders.
- [ ] A daily ERPNext backup exists and its restore is documented.
- [ ] Engineering OS unaffected: health ok, no restarts or out-of-memory kills, same response times.

## Review findings (Claude, 2026-10-01): fixed above, or waiting for a decision
**Fixed in this plan:**
1. Port binding: explicit `127.0.0.1`. Docker would otherwise publish ERPNext on every interface, bypassing the host firewall.
2. Generated passwords, never the quick-start `admin`.
3. Setup done as Administrator; the API user gets least privilege.
4. WO Number not unique in ERPNext, because cancel-and-amend reuses it. Amendment tested.
5. The memory gate uses the sum of the caps (worst case), not the measured peak.
6. Time zone, number format and sign-up setting added.
7. Order without a rate tested.

**Integration design: decided by the user 2026-10-01, all as proposed (recorded in `CLAUDE.md`; affects plans 014–015):**
- **A. Pull instead of push.** "A confirmed order creates the project automatically" conflicts with "New project picks up the order". An order has no PM, engineers or start date, so an auto-created project would be half-finished. Frappe webhooks are also fire-and-forget, and every deploy restarts our app for 20–30 s, so an order confirmed during a deploy would silently never become a project. **Decided:** the New project form starts by picking a confirmed order that has no project yet (pulled live from ERPNext). It prefills client, WO, panels and dates, and on save writes the project code back to the order. No webhook, nothing to lose. The "orders waiting for a project" list is the to-do.
- **B. Changes to an order after the project exists.**
  - Decided: client PO, dates and client name update PM automatically.
  - Added panels → appended to the project.
  - Removed panels and cancelled orders → only flagged ("Order changed: review") for a Director, never deleting work.
- **C. Client reference numbers.** Customers created in ERPNext have no `ACS-0001` ref, but our project codes are built from it. Decided: our app assigns the next ref the first time a customer is used and writes it back to the Customer's "ACS reference" field.

**Also flagged:**
- **Single sign-on (plan 013):**
  - Send the pass as an auto-submitted POST, not in the URL (URLs land in proxy logs and browser history). Single-use and about 30 s expiry.
  - Re-sync roles on every sign-in, so demotions apply.
  - Deactivating a user in our app also disables their ERPNext user.
  - Directors get System Manager, never Administrator.
- **CI:** `ci.yml` runs only for `main` (pushes and PRs), so commits on `erp` get no CI. Add `erp` to the push branches in plan 013 (the publish/deploy jobs stay `main`-only).

## Implementation notes (Antigravity, Part A)

### 1. Stock ERPNext & production compose
- **Working folder (outside repo):** `C:\Users\Dhruv-Home\erpnext-local`
- **Repository cloned:** `https://github.com/frappe/frappe_docker.git` at pinned tag `v3.2.2` (commit `3061850feface8fbbad15b5dc08a110c596107cb`).
- **Compose files used:**
  - `compose.yaml` (base Frappe/ERPNext v16.37.0 services)
  - `overrides/compose.mariadb.yaml` (MariaDB 11.8 service)
  - `overrides/compose.redis.yaml` (Redis 8.6-alpine cache and queue)
  - `overrides/compose.noproxy.yaml` (Direct access on published port)
  - `overrides/compose.erp-phase0-trim.yaml` (Memory budget trims & per-service caps)
- **Environment variables in `.env` (keys only, no values):**
  - `ERPNEXT_VERSION` (pinned to `v16.37.0`)
  - `DB_PASSWORD` (generated 24-character random alphanumeric password)
  - `ADMIN_PASSWORD` (generated 24-character random alphanumeric password)
  - `HTTP_PUBLISH_PORT` (set to `127.0.0.1:8080` to bind explicitly to localhost)
  - `FRAPPE_SITE_NAME_HEADER` (set to `frontend`)
  - `GUNICORN_WORKERS` (set to `1`)
  - `GUNICORN_THREADS` (set to `2`)
  - `GUNICORN_TIMEOUT` (set to `120`)
  - `ERPNEXT_API_KEY` (generated for `engos-api`)
  - `ERPNEXT_API_SECRET` (generated for `engos-api`)
- **Commands used:**
  - Launch stack:
    `docker compose -f compose.yaml -f overrides/compose.mariadb.yaml -f overrides/compose.redis.yaml -f overrides/compose.noproxy.yaml -f overrides/compose.erp-phase0-trim.yaml up -d`
  - Create site:
    `docker compose ... exec -T backend bench new-site --mariadb-user-host-login-scope=% --mariadb-root-password "<db_pass>" --admin-password "<admin_pass>" --install-app erpnext --set-default frontend`
  - Enable scheduler:
    `docker compose ... exec -T backend bench --site frontend enable-scheduler`
  - Verify HTTP access:
    `curl.exe -I http://127.0.0.1:8080` -> HTTP 200 OK.

### 2. Minimal setup without setup wizard UI
- Executed via python using `frappe.desk.page.setup_wizard.setup_wizard.setup_complete`:
  - **Company:** "ACS Engitech" (abbr `ACS`)
  - **Country:** India
  - **Currency:** INR
  - **Fiscal year:** 2026-2027 (1 April 2026 – 31 March 2027)
  - **Chart of accounts:** Standard Template
  - **GSTIN:** None
  - **System Settings:** `time_zone = 'Asia/Kolkata'`, `number_format = '#,##,###.##'`, `date_format = 'dd-mm-yyyy'`
  - **Website Settings:** `disable_signup = 1` (self-registration disabled on login screen)
  - **Email polling:** Checked `Email Account`; none configured, 0 incoming polling overhead.

### 3. Memory budget trims & caps
Defined in `overrides/compose.erp-phase0-trim.yaml`:
1. **Queue workers:** Consolidated into a single worker: `queue-short` configured with `command: bench worker --queue short,default,long` (capped at `384m`); `queue-long` disabled via `profiles: [disabled]`. Saves an entire Python process (~75–120 MB).
2. **Gunicorn workers:** Reduced to 1 worker process with 2 threads (`GUNICORN_WORKERS=1`, `GUNICORN_THREADS=2`, `GUNICORN_TIMEOUT=120`, mem_limit: `768m`).
3. **MariaDB buffer pool:** Configured `--innodb-buffer-pool-size=256M`, mem_limit: `512m`.
4. **Redis memory caps:**
   - `redis-cache`: `--maxmemory 64mb --maxmemory-policy allkeys-lru`, mem_limit: `96m`.
   - `redis-queue`: `--maxmemory 64mb --maxmemory-policy noeviction --appendonly yes`, mem_limit: `96m`.
5. **Additional services:**
   - `frontend` (nginx): mem_limit `128m`
   - `websocket` (Node socketio): mem_limit `128m`
   - `scheduler` (bench schedule): mem_limit `256m`
- **Sum of all `mem_limit` caps:**
  `512 + 96 + 96 + 768 + 128 + 128 + 256 + 384 = 2368 MiB (2.31 GiB)`.
  This guarantees that even in the absolute worst-case container saturation, ERPNext cannot exceed 2.31 GB on the host.

### 4. API verification
- **Setup work (Administrator):**
  - Panel Items created matching checklist template codes:
    - `PLC` ("PLC Panel")
    - `SCADA` ("SCADA Panel")
    - `HMI` ("HMI Panel")
    All created non-stock (`is_stock_item: 0`), UOM `Nos`.
  - Custom fields created via `create_custom_fields`:
    - On `Sales Order`:
      - `custom_wo_number`: Data, `allow_on_submit: 1`, `unique: 0`.
      - `custom_project_code`: Data, `read_only: 1`, `allow_on_submit: 1`.
      - `custom_project_link`: Data, `read_only: 1`, `allow_on_submit: 1`.
    - On `Customer`:
      - `custom_acs_reference`: Data (e.g. `ACS-0001`).
- **Least-privilege API user:**
  - User `engos-api@acsengitech.com` created with single role `Sales User` (not System Manager).
  - API keys generated and authenticated with `Authorization: token <key>:<secret>`.
- **API calls proven:**
  - **Customer:** POST `/api/resource/Customer` created `Adani Power Ltd` with `custom_acs_reference: "ACS-0001"`. Listed and read back successfully.
  - **Item:** GET `/api/resource/Item/PLC`, `/SCADA`, `/HMI` verified.
  - **Sales Order:** POST `/api/resource/Sales Order` created `SAL-ORD-2026-00001` with `po_no: "PO-2026-99"`, `custom_wo_number: "WO-4001"`, delivery date `2026-11-15`, and 2 items (`PLC`, `SCADA`).
  - **Submit:** PUT `/api/resource/Sales Order/SAL-ORD-2026-00001` with `{"docstatus": 1}` submitted successfully.
  - **Project Link update:** PUT on submitted order updated `custom_project_code: "ACS-0001-P01"` and `custom_project_link: "/pm/projects/prj_123"` successfully with `engos-api` credentials.
  - **Zero/No rate test:** Created and submitted `SAL-ORD-2026-00002` with `rate` omitted. ERPNext accepted zero rate without blocking (`net_total = 0.0`).
  - **Cancel and amend test:** `SAL-ORD-2026-00001` cancelled (`docstatus: 2`), amended order `SAL-ORD-2026-00001-1` created with `amended_from: "SAL-ORD-2026-00001"` and retained `custom_wo_number: "WO-4001"`, and submitted successfully.
  - **Waiting for a project query:**
    `GET /api/resource/Sales Order?filters=[["docstatus","=",1],["custom_project_link","is","not set"]]` returned open submitted unlinked orders (`SAL-ORD-2026-00001-1` and `SAL-ORD-2026-00002`), while excluding cancelled and linked orders.
- **Minimum mandatory fields:**
  - `Customer`: `customer_name` (string).
  - `Sales Order`: `customer` (string), `delivery_date` (date string `YYYY-MM-DD`), `items` (array with `item_code`, `qty`, `delivery_date`).
- **Real error response recorded (missing mandatory field on Sales Order):**
```json
{
  "exception": "TypeError: bad operand type for abs(): 'NoneType'",
  "exc_type": "TypeError",
  "_exc_source": "erpnext (app)",
  "exc": "[\"Traceback (most recent call last):\\n  File \\\"apps/frappe/frappe/app.py\\\", line 158, in application\\n    response = frappe.api.handle(request)... TypeError: bad operand type for abs(): 'NoneType'\\n\"]"
}
```

### 5. Memory measurement (Gate 1 results)
- **Host info:** Windows host, Docker Desktop (Total Memory limit: 11.68 GiB).
- **At rest (after 10+ minutes):** 802.28 MiB (0.78 GiB).
- **Peak under load:** Tested by creating 50 Customers + 50 submitted Sales Orders via API (completed in 7.7s total), followed by 300 seconds (5 minutes) of continuous Desk browsing simulation (workspace sidebar, desktop page, reportview lists, form loads, search links).

| Service Container | Memory at Rest | Measured Peak | Memory Cap (`mem_limit`) |
|---|---|---|---|
| `erpnext-local-backend-1` | 285.00 MiB | 305.70 MiB | 768.00 MiB |
| `erpnext-local-db-1` | 269.90 MiB | 273.40 MiB | 512.00 MiB |
| `erpnext-local-frontend-1` | 14.86 MiB | 16.82 MiB | 128.00 MiB |
| `erpnext-local-queue-short-1` | 76.53 MiB | 123.10 MiB | 384.00 MiB |
| `erpnext-local-redis-cache-1` | 12.69 MiB | 16.85 MiB | 96.00 MiB |
| `erpnext-local-redis-queue-1` | 10.06 MiB | 11.14 MiB | 96.00 MiB |
| `erpnext-local-scheduler-1` | 109.60 MiB | 110.40 MiB | 256.00 MiB |
| `erpnext-local-websocket-1` | 23.64 MiB | 23.71 MiB | 128.00 MiB |
| **TOTAL** | **802.28 MiB (0.78 GiB)** | **881.12 MiB (0.86 GiB)** | **2368.00 MiB (2.31 GiB)** |

- **Gate 1 check:**
  - Total measured peak: **881.12 MiB (0.86 GiB)** ≤ **2.50 GiB** gate.
  - Worst-case sum of caps: **2368.00 MiB (2.31 GiB)** ≤ **2.50 GiB** gate.
  - Restarts or OOM kills: **0** (all containers up 30+ minutes continuously).
  - **Verdict: GATE 1 PASSED.**

### Tool & repo status
- `sequential-thinking`: Server registered but tool execution threw invalid tool call / not enabled; reasoning steps performed directly.
- Engineering OS repository verification: `npm run typecheck; npm test` ran cleanly with 0 modifications to `src/`:
  - `tsc --noEmit`: 0 errors.
  - Vitest: 12 test files passed, 147 tests passed (0 failed).

## Notes (Claude, per step)
<commands, file names, .env keys (not values), memory numbers, payloads, gate results>

## Review (Claude)
**Part A review, 2026-10-01, commit `3263fbf`. Verdict: part A accepted; gate 1 passed.**

**Verified on the PC by Claude:**
- `frappe/erpnext:v16.37.0`; all 8 containers up 33 min, `db` healthy; `/api/method/ping` → `pong`.
- `frontend` publishes **only** `127.0.0.1:8080`, unreachable from the LAN address.
- `HostConfig.Memory` caps sum to exactly **2,368 MiB**.
- The commit touches only the plan and the index: no secrets, no `erpnext-local` files.

**Accepted:**
- `frappe_docker` v3.2.2 production compose and overrides plus a trim override (one worker for all queues, gunicorn 1×2, `innodb_buffer_pool_size` 256M, Redis maxmemory).
- Minimal setup through the setup API: Asia/Kolkata, `#,##,###.##`, sign-up disabled.
- Items `PLC`/`SCADA`/`HMI` (= checklist template codes).
- Custom fields: `custom_wo_number` (not unique), `custom_project_code` / `custom_project_link` (read-only, allow on submit), `custom_acs_reference`.
- API user with `Sales User` only.
- Proven:
  - create, list and read Customer;
  - create and submit a Sales Order;
  - write the link fields on a submitted order;
  - an order with no rate is accepted (`net_total` 0);
  - cancel and amend keeps the WO and sets `amended_from`;
  - the "waiting for a project" filter returns exactly the open, unlinked orders.
- Memory: rest 802 MiB, peak 881 MiB (API load plus 5 min of desk browsing), caps 2,368 MiB, 0 out-of-memory kills.

**Carry into later plans:**
- **(014) WO format:** ERPNext accepted `WO-4001`, but PM's WO is digits only (`^\d+$`, globally unique in `pm_projects`). The New project form must refuse an order whose WO isn't digits, with a message naming the order. Plan 013's `acs_erp` app should also validate it in ERPNext on save, so the Sales Head sees the error while typing.
- **(014) ERPNext errors aren't friendly:** a missing mandatory field returned **500 `TypeError`**, not a validation message. Our ERP client must check inputs before writing, and show a generic "ERP couldn't save this, try again" for 5xx responses. Never show `exc` to users.
- **(013) Least privilege:** `Sales User` can also create, submit and cancel Sales Orders, which the integration never needs with the pull design (only the 015 backfill creates orders). Consider a custom "EngOS Integration" role (read Customer, Item and Sales Order; write Customer; write the link fields) when building `acs_erp`.
- **(014) Project link:** store an absolute URL to our project page in `custom_project_link`, so ERPNext users can open it.
- **(B or later) Fiscal year:** only FY 2026-27 exists. Before 1 April 2027, check that ERPNext creates FY 2027-28 by itself, or add it.
- **Desk speed:** gunicorn has 1 worker and 2 threads. Fine for about 5 users; if the desk feels slow, raise it to 2 workers (still within the 768 MiB cap).
- Antigravity could not use the sequential-thinking tool (noted in its implementation notes).

**Part B, gate 2 (Claude, read-only):**
- Sample 1, 2026-10-01 17:40 IST: `available` 5,070 MiB → 5,070 − 2,368 (ERPNext caps) = **2,702 MiB ≥ 1,536**. Pass so far.
- Samples 2 and 3 still to take (a morning and another afternoon).
- Risk outside this project: several neighbours are uncapped (`n8n-n8n-1` 657 MiB, `pcpt-crawler` 591 MiB, `quote-builder`, `supplychain_app`, `sm_posting_app`, `n8n-traefik-1`). Engineering OS and ERPNext are each capped, so they can't starve each other, but an uncapped neighbour can still squeeze the whole box. Capping them is the user's call (other projects).

