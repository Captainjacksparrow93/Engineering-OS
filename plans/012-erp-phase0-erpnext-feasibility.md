# 012 — ERP Phase 0: ERPNext running, measured, reachable by API

**Status:** TODO   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Runs it:** Claude (local and VPS steps; every VPS change only after the user approves it) · **Implementer:** none (no app code in this phase)
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
- **Private:** ERPNext gets **no public address**.
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

## Tools & skills
- **No app code changes**, so the code-review-graph and Token Savior have nothing to check this phase. Blast radius on Engineering OS: none (separate compose project, no shared files). Plan 013 runs the graph on the code it touches.
- **sequential-thinking:** required for step 5 (the memory budget and the go/no-go call).
- **Skills:** `ponytail` (full). Use stock `frappe_docker` and change only what the memory budget needs; no custom images.
- **Tests:** none for the app here (nothing in `src/` changes). The proof is the recorded API calls and memory numbers below.

## Steps

### A. Local (Claude, on the owner's PC with Docker Desktop)
- [ ] **1. Run ERPNext locally the production way.**
  - Clone `frappe_docker` at a pinned tag outside the repo.
  - Use the production compose (`compose.yaml` + MariaDB + Redis overrides + no-proxy) with `ERPNEXT_VERSION=v16.37.0`, published on `127.0.0.1:8080`.
  - Create one site with ERPNext installed.
  - Record the exact files, `.env` keys (not values) and commands used. Plan 013 and the VPS step reuse them.
- [ ] **2. Minimal setup, no setup wizard UI:**
  - Company "ACS Engitech" (abbr `ACS`), country India, currency INR, financial year 1 April–31 March, standard chart of accounts, no GSTIN.
  - Use the setup API or `bench` where possible, and record how.
  - Disable what we don't use at startup (e.g. email polling) only if it measurably saves memory.
- [ ] **3. Trim to the memory budget:**
  - One queue worker for all queues instead of `queue-short` + `queue-long`.
  - A small gunicorn worker count.
  - MariaDB `innodb_buffer_pool_size` about 256 MB.
  - Redis `maxmemory` caps.
  - A `mem_limit` on every service.
  - Record each setting and why.
- [ ] **4. Prove the API (`curl` or a throwaway script outside the repo):**
  1. Create an API user `engos-api` with only the roles needed for Customer, Item and Sales Order (start from "Sales User"/"Sales Manager"; **not** System Manager unless something fails, and record what). Generate its API key and secret.
  2. Create a **Customer**, list Customers, read one back.
  3. Create the panel **Items**: PLC Panel, SCADA Panel, HMI Panel (codes matching our checklist template codes), non-stock, UOM Nos.
  4. Add a custom field **WO Number** on Sales Order (Data, unique if ERPNext allows).
  5. Create a **Sales Order**: customer, `po_no`, WO number, `delivery_date`, and two item rows with their own `delivery_date`, plus an optional rate. Then **submit** it (`docstatus` 1) and read it back.
  6. Record the **minimum mandatory fields** for Customer and Sales Order and one real **error response** (a missing field) as JSON in the notes. Plans 013–014 build on these.
  7. **Webhook:** configure an ERPNext Webhook on Sales Order `on_submit` that posts to a local listener with a shared-secret header. Confirm it fires and record the payload shape. Plan 014 uses it to create the project.
- [ ] **5. Measure (gate 1).**
  - `docker stats` for every ERPNext container: at rest after 10 minutes, and peak while creating 50 customers and 50 submitted sales orders via the API.
  - Gate: **total peak ≤ 2.5 GB** with the caps in place, and no container killed for running out of memory.
  - If it fails, try the trims again once; if it still fails, stop and report.

### B. VPS (Claude, each step only after the user approves it)
- [ ] **6. Check headroom (gate 2, read-only).**
  - Record `free -m` and `docker stats --no-stream` at 3 different times of a working day.
  - Gate: available memory minus the ERPNext peak from step 5 must leave **≥ 1.5 GB**.
  - If not, stop and report: options then are trimming other services on the box, or a user decision.
- [ ] **7. Install ERPNext on the VPS.**
  - Folder `/root/erpnext-docker`, the same pinned `frappe_docker` tag and the compose from step 1 with the step 3 trims and caps.
  - `restart: unless-stopped`; listening only on `127.0.0.1:8080`.
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
- [ ] From the VPS: with the `engos-api` key, Customer, Item and Sales Order create/read/submit work, and the webhook fires.
- [ ] A daily ERPNext backup exists and its restore is documented.
- [ ] Engineering OS unaffected: health ok, no restarts or out-of-memory kills, same response times.

## Notes (Claude, per step)
<commands, file names, .env keys (not values), memory numbers, payloads, gate results>

## Review (Claude)
<verdict>
