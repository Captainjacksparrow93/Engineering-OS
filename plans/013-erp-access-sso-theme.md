# 013 — ERP access: one-click sign-in, restyled ERPNext, ERP entry in our app (local)

**Status:** IN PROGRESS   <!-- TODO → IN PROGRESS → DONE → REVIEWED -->
**Author:** Claude · **Implementer:** Antigravity · **Branch:** `erp`
**Depends on:** 012 part A (local ERPNext at `C:\Users\Dhruv-Home\erpnext-local`, v16.37.0, on `127.0.0.1:8080`).
**Where it runs:** **local only** (user decision 2026-10-01: all ERP development is done and tested locally first; the VPS comes after plan 015). Nothing in this plan touches the VPS.

## Goal
A Director or the Sales Head clicks **ERP** in Engineering OS and lands in ERPNext, **already signed in as themselves**, on screens restyled to our look. Nobody else sees ERP. Deactivating a user in our app also disables them in ERPNext.

Decisions this builds on (`CLAUDE.md`, "ERP"):
- ERPNext's own screens, restyled by our custom Frappe app `acs_erp` ("same family", not pixel-identical).
- One login via a signed, single-use pass.
- ERP access for Directors and the Sales Head.
- Don't embed ERPNext in an iframe.

## How it works
1. **Our side.** `/erp` (new **ERP** sidebar item and launcher tile) shows one card with an **Open ERP** button. It opens `/erp/open` in a new tab. That route handler:
   - checks the session and `erp.access`;
   - builds a **pass** for the signed-in user;
   - returns a tiny HTML page whose form **auto-submits by POST** to `${ERPNEXT_PUBLIC_URL}/api/method/acs_erp.sso.login` with one field, `pass`.

   The pass is never put in a URL.
2. **The pass format** (both sides must match exactly; cover it with the shared test vector):
   - `pass = base64url(payloadJSON) + "." + base64url(HMAC_SHA256(secret, base64url(payloadJSON)))`
   - Payload: `{ "v": 1, "act": "login" | "disable", "email": string, "name": string, "roles": string[], "iat": unixSeconds, "exp": iat + 30, "nonce": 16 random bytes as hex }`
   - The secret is `ERP_SSO_SECRET` (our env) and `acs_erp_sso_secret` (ERPNext `site_config.json`): the same random value of at least 32 bytes, never committed.
3. **ERPNext side (`acs_erp.sso.login`, guest-allowed, POST only).** In this order, failing safely and returning a plain "Sign-in link expired. Open ERP again from Engineering OS." page on any failure:
   1. Verify the HMAC with a constant-time compare.
   2. Check `act == "login"`, `exp` not passed (allow ≤ 5 s clock skew), `v == 1`.
   3. Make the **nonce single-use** (store it in Frappe's cache for 120 s; reject if already there).
   4. **Get or create the User** by email (enabled, System User, no welcome email, **no password set**).
   5. **Set the user's roles to exactly the managed roles in the pass.** "Managed" = an allowlist in `acs_erp` (below). Remove managed roles not in the pass, never touch roles outside the allowlist, and **never** allow `Administrator` or `Guest`.
   6. Log in as that user and redirect to `/app`.
4. **Role mapping** (decided in our app; `acs_erp` enforces the allowlist):
   - Our `DIRECTOR` or `SUPER_ADMIN` → `System Manager`, `Sales Manager`, `Sales User`, `Purchase Manager`, `Stock Manager`, `Accounts Manager`, `Item Manager`.
   - Our `SALES_HEAD` → `Sales Manager`, `Sales User`.
   - Anyone else → no pass (no `erp.access`).
5. **Disable on deactivate.** When `setUserStatus` sets a user to `SUSPENDED` or `EXITED`, our app POSTs a pass with `act: "disable"` (server to server, to `ERPNEXT_URL`) to `acs_erp.sso.disable_user`, which disables that ERPNext user and ends their sessions. This is best effort: on failure, record it in our audit trail and carry on. **Never block** the status change because ERPNext is down.
6. **The look.** `acs_erp` adds `app_include_css` (desk) and `web_include_css` (login page) pointing to one CSS file, plus our font files. It follows `docs/design-system.md` → "ERP (ERPNext, restyled)".

## Affected code
**Engineering OS (TypeScript):**
- `src/core/rbac/permissions.ts`: new key `'erp.access': 'Open ERP with single sign-on'`; add it to `SYSTEM_ROLES.DIRECTOR` and `SYSTEM_ROLES.SALES_HEAD` (`SUPER_ADMIN` gets everything already).
- **New SQL migration** (`npx prisma migrate dev --create-only --name erp_access_permission`): insert `erp.access` into `core_permissions` (`ON CONFLICT (key) DO NOTHING`) and grant it to roles `DIRECTOR`, `SALES_HEAD` and `SUPER_ADMIN`, joining by `key`, never by ID, and idempotent. No schema change.
- `src/core/modules/registry.ts`, entry `erp`:
  - `status: 'LIVE'`, `route: '/erp'`, `requires: 'erp.access'`;
  - replace the `scope` lines with today's reality (orders, customers and all ERPNext modules in ERPNext; projects come from orders, in plan 014).
- `src/components/shell/sidebar.tsx`: an **ERP** nav item, `href: '/erp'`, `requires: 'erp.access'`, in the same section as Projects/Clients.
- `src/app/(shell)/erp/page.tsx`: replace `<ComingSoon moduleKey="erp" />` with:
  - a `PageHeader` ("ERP", one line saying it opens in a new tab and you'll be signed in);
  - a `.card` with one `.btn-primary` link "Open ERP" (`target="_blank"`, `rel="noopener"`) to `/erp/open`;
  - an `Alert` instead of the button when the ERP settings are missing.
  - Gate the page on `erp.access`.
- `src/app/erp/open/route.ts` (new route handler, **outside** the `(shell)` group, so it renders no app chrome): `GET` → session, `erp.access`, build the pass, return the auto-submit HTML (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`). Without a session → redirect to `/login`; without the permission → 403.
- `src/modules/erp/sso.ts` (new): `buildPass(user, act, now?)` and `rolesFor(roleKeys)`, using Node `crypto` only. **No new npm dependency.**
- `src/modules/admin/services/admin.service.ts`, `setUserStatus`: after a successful change to `SUSPENDED`/`EXITED`, a best-effort `disable` call (short timeout, about 5 s); failures audited, never thrown.
- `.env.example`: `ERPNEXT_PUBLIC_URL`, `ERPNEXT_URL`, `ERP_SSO_SECRET` (no values).
- `docker-compose.yml`: pass those three to `app` (empty is fine; nothing reads them until set).
- `.github/workflows/ci.yml`: `on.push.branches` gets `erp` next to `main`. `publish` stays `main`-only, so no deploy happens from `erp`. Add a dummy `ERP_SSO_SECRET` to the test env.

**ERPNext app (new folder `erp/acs_erp/` in this repo, plus `erp/Dockerfile`):**
- A minimal installable Frappe app `acs_erp` (`hooks.py`, package metadata, `modules.txt`, `patches.txt`, module folder). Version `0.1.0`.
- `hooks.py`:
  - `app_include_css` and `web_include_css` → `/assets/acs_erp/css/acs_theme.css`;
  - `fixtures` for the four custom fields from 012 (`custom_wo_number`, `custom_project_code`, `custom_project_link` on Sales Order; `custom_acs_reference` on Customer) and for an **`EngOS Integration`** role with only what the integration needs: read Customer, Item and Sales Order; create/write Customer; write the two project-link fields on submitted Sales Orders;
  - `doc_events` → Sales Order `validate`: `custom_wo_number`, when set, must be digits only ("WO number must contain digits only.");
  - `after_install`: session expiry `08:00`, sign-up disabled, "login with email link" off, items `PLC`/`SCADA`/`HMI` exist (create if missing), and navbar logo and title "Engineering OS · ERP".
- `acs_erp/sso.py`: `login` and `disable_user` as above. The pass decode/verify lives in a **Frappe-free** helper module (`acs_erp/passcodec.py`) so it can be unit-tested with plain Python.
- `acs_erp/public/css/acs_theme.css` + `acs_erp/public/fonts/` (copy the five `.woff2` files and both `OFL.txt` from `src/app/fonts/`).
- `erp/Dockerfile`: `FROM frappe/erpnext:v16.37.0`, add `acs_erp` into the bench `apps/`, install it, register it in `sites/apps.txt`, build its assets. Local tag `acs-erpnext:v16.37.0-acs1`.
- Local switch (outside the repo, in `erpnext-local`): point the compose image to `acs-erpnext:v16.37.0-acs1`, recreate the containers (volumes kept), `bench --site frontend install-app acs_erp`, `bench --site frontend migrate`, and put `acs_erp_sso_secret` in the site config. Move the API user `engos-api` from `Sales User` to `EngOS Integration` only.

**Blast radius** (code-review-graph on branch `erp`, graph at `eb9fb57`):
- Blast radius of `permissions.ts`, `registry.ts`, `sidebar.tsx`, `admin.service.ts` and `(shell)/erp/page.tsx`: **high**, 20 nodes changed, 119 files within 2 hops (key: `AuditPage`, `RolesPage`, `UsersPage`, `ShellLayout`, `assignRoleAction`). Expected: `permissions.ts` is imported by 12 files and the sidebar sits in every page. The change is additive (a new key, a new nav item).
- `callers_of setUserStatus`: only `setUserStatusAction` (`src/app/actions/admin.ts`).
- `importers_of registry.ts`: 3 files: `prisma/seed.ts` (upserts module rows), `src/app/(shell)/modules/page.tsx` (launcher) and `src/components/coming-soon.tsx` (no longer used by `/erp`, still used by the other coming-soon modules).
- `get_affected_flows` for `admin.service.ts` + `sidebar.tsx`: 0 flows.

## Constraints
- The app is LIVE, but **nothing here reaches production**: branch `erp`, no push, no VPS. A merge to `main` happens only after plan 015 and the VPS steps.
- The permission change goes through a **hand-written SQL migration** only (`AGENTS.md`). Never edit `entrypoint.sh` for it.
- Never commit a secret: not `ERP_SSO_SECRET`, not `acs_erp_sso_secret`, not API keys. The test vector uses an obvious test secret.
- No new npm dependency. No Python dependency beyond what the ERPNext image already has.
- `acs_erp` must not change ERPNext business logic beyond the WO-digits check and the setup items above.
- UI per `ux-writing` and `impeccable`; the ERP theme per `docs/design-system.md` → "ERP (ERPNext, restyled)".

## Tools & skills (implementer: follow these)
- **Setup:** `git checkout erp`; read `AGENTS.md` → "ERP work"; point Token Savior at this project and update the code-review-graph; load `ponytail` (full) and the skills below.
- **Check first (graph):** callers of `setUserStatus`; importers of `src/core/rbac/permissions.ts` and `src/core/modules/registry.ts`; blast radius of `permissions.ts`, `sidebar.tsx`, `admin.service.ts`.
- **Read (Token Savior):** `setUserStatus`, `SYSTEM_ROLES`, `MODULES`, `Sidebar`, `requirePrincipal`, `getPrincipal`, `hasPermissionAnywhere`. Read the existing permission migration `prisma/migrations/20260926150000_revoke_pm_task_create/migration.sql` as the pattern.
- **Next.js:** route handlers changed in this version; read `node_modules/next/dist/docs/` on route handlers before writing `src/app/erp/open/route.ts`.
- **Frappe:** official docs for hooks (`app_include_css`, `web_include_css`, `fixtures`, `doc_events`, `after_install`), whitelisted methods (`allow_guest`, `methods=["POST"]`), `frappe.cache`, and `login_manager.login_as`. Record the URLs used.
- **sequential-thinking:** required for step 3 (the order of checks in `acs_erp.sso.login`: signature → expiry → nonce → user → roles → session) and step 4 (where the disable call sits so it can never block or undo the status change).
- **Skills:** `ponytail` (full) · `tdd` · `ux-writing` + `impeccable` (ERP page + theme) · `review-delta` (before DONE).
- **Tests:**
  - `npm run typecheck && npm test && npm run build`, and `npm run test:int` on a **fresh CI-like database** (empty DB → `npx prisma migrate deploy` → `npm run db:seed`).
  - Python: `python -m unittest` for `passcodec` (plain Python, no Frappe).
  - Paste all counts.
- If a tool is missing or fails, say so in Implementation notes.

## Steps (hand over one at a time)
- [x] **1. Tests first (red):**
  - **TS unit** (`src/modules/erp/sso.test.ts`): `buildPass` makes the exact format; `rolesFor` maps Director, Super Admin and Sales Head as above and returns `[]` for everyone else.
  - **One shared test vector:** a fixed secret, payload and time give a fixed `pass` string, saved as `erp/acs_erp/acs_erp/tests/pass_vector.json`. Both the TS and the Python tests read it.
  - **TS integration:**
    - `/erp/open` with no session → redirect to `/login`;
    - an Engineer (no `erp.access`) → 403;
    - a Director → 200 HTML with a POST form to `${ERPNEXT_PUBLIC_URL}/api/method/acs_erp.sso.login`, a `pass` that verifies, and `Cache-Control: no-store`;
    - after the migration, `erp.access` is held by `DIRECTOR`, `SALES_HEAD` and `SUPER_ADMIN` and nobody else;
    - `setUserStatus` to `EXITED` succeeds and is audited even when ERPNext is unreachable.
  - **Python** (`passcodec`): accepts the vector (with the clock fixed); rejects a bad signature, expired, wrong `v`, wrong `act`, and malformed input.
- [x] **2. Our app:** permission key + SQL migration, `SYSTEM_ROLES`, registry, sidebar item, `/erp` page, `/erp/open`, `sso.ts`, env names, compose pass-through, CI `erp` branch.
- [x] **3. `acs_erp`:** app skeleton, `passcodec` + `sso.login` + `sso.disable_user`, role allowlist, fixtures (custom fields + `EngOS Integration` role), WO-digits validation, `after_install` settings, theme CSS + fonts, `erp/Dockerfile`. Build the image locally, switch `erpnext-local` to it, install, migrate, set the secret, and move `engos-api` to `EngOS Integration`.
- [x] **4. Disable on deactivate** in `setUserStatus` (best effort, audited).
- [x] **5. Check it end to end locally:**
  - Run `npm run dev` on port 3001 with `ERPNEXT_PUBLIC_URL=http://127.0.0.1:8080`, `ERPNEXT_URL=http://127.0.0.1:8080` and the shared secret.
  - Sign in as a seeded Director → ERP → Open ERP → you land on ERPNext `/app` signed in as that Director, with the mapped roles. Repeat as the Sales Head (Sales roles only) and an Engineer (no ERP item; `/erp/open` → 403).
  - Replaying the same pass → refused. A pass older than 30 s → refused.
  - Set the Sales Head to `EXITED` in People → their ERPNext user is disabled and their session ended.
  - A Sales Order with WO `WO-4001` → refused; `4001` → saved.
  - The API user can no longer create or submit a Sales Order, but can still read and write the link fields.
- [x] **6. Full suite (CI-like database) + Python tests; record counts.** Commit locally on `erp`. Don't push.

## Acceptance criteria
- [x] Directors and the Sales Head see **ERP** and land in ERPNext signed in with the mapped roles; nobody else sees it, and `/erp/open` refuses them.
- [x] The pass travels only in a POST body, is single-use, expires in 30 s, and is verified constant-time. Our app and ERPNext agree on the shared test vector.
- [x] SSO-created ERPNext users have no usable password; only Administrator can sign in on the ERPNext login page.
- [x] Deactivating a user disables their ERPNext user (best effort; never blocks the change).
- [x] ERPNext looks like the same family as our app (screenshots), with no Google font requests.
- [x] WO numbers in ERPNext must be digits.
- [x] `erp.access` arrives by SQL migration; CI runs on `erp`; full suite and Python tests pass (counts pasted).

## Implementation notes (implementer)
- **Step 1 (Tests first & test vector):**
  - Created shared vector in `erp/acs_erp/acs_erp/tests/pass_vector.json`.
  - Python test suite in `erp/acs_erp/acs_erp/tests/test_passcodec.py` (8 tests passing).
  - TS unit tests in `src/modules/erp/sso.test.ts` (10 tests passing).
  - TS integration tests in `src/modules/erp/erp-access.int.test.ts` (5 tests passing).
- **Step 2 (Engineering OS integration):**
  - Added `'erp.access'` permission to `src/core/rbac/permissions.ts` (granted to `DIRECTOR`, `SALES_HEAD`, `SUPER_ADMIN`) and `READ_ONLY_PERMISSIONS` in `src/core/rbac/engine.ts`.
  - Added idempotent SQL migration `20261001122602_erp_access_permission`.
  - Updated module registry (`src/core/modules/registry.ts`) for `erp`: status `LIVE`, route `/erp`, requires `erp.access`.
  - Added ERP navigation link and icon to sidebar (`src/components/shell/sidebar.tsx`).
  - Added launcher card page (`src/app/(shell)/erp/page.tsx`) and auto-submitting POST SSO route handler (`src/app/erp/open/route.ts`).
  - Implemented `buildPass`, `verifyPass`, and `rolesFor` in `src/modules/erp/sso.ts`.
  - Updated config and environment in `src/core/config.ts`, `.env.example`, `docker-compose.yml`, and `.github/workflows/ci.yml`.
- **Step 3 (`acs_erp` Frappe custom app & Docker image):**
  - Built `acs_erp` containing: `passcodec.py`, `sso.py` (login and disable_user endpoints), `events.py` (WO digits validator), `install.py` (after_install config), `hooks.py`, custom field and role fixtures.
  - Bundled styling in `public/css/acs_theme.css` with local Inter and JetBrains Mono woff2 fonts (no Google Fonts).
  - Created `erp/Dockerfile` based on `frappe/erpnext:v16.37.0`, built as `acs-erpnext:v16.37.0-acs1`.
  - Recreated local containers at `C:\Users\Dhruv-Home\erpnext-local` with custom image.
  - Installed and migrated `acs_erp`. Configured `acs_erp_sso_secret` in `site_config.json`.
  - Restricted `engos-api` to `EngOS Integration` role only.
- **Step 4 (Disable on deactivate):**
  - Integrated best-effort HTTP call to `acs_erp.sso.disable_user` inside `setUserStatus` (`src/modules/admin/services/admin.service.ts`).
  - Audited with action `'USER_DISABLE_ERPNEXT'`, never throws on failure.
- **Step 5 (End-to-end verification):**
  - Automated e2e verification script executed against live local stack:
    - Director SSO login verified: redirected to `/app` with cookie and all 7 roles assigned (`System Manager`, `Sales Manager`, etc.).
    - Sales Head SSO login verified: redirected to `/app` with cookie and 2 roles assigned (`Sales Manager`, `Sales User`).
    - Replay refusal verified: replaying identical pass returns 401.
    - Expired pass refusal verified: timestamp older than 30s returns 401.
    - Deactivation verified: `disable_user` disables user in ERPNext; logging in via SSO re-enables user.
    - Sales Order WO number validation: `WO-4001` rejected; `4001` accepted.
    - API user privileges: `engos-api` reads Customer, Item, Sales Order (200), but creating a Sales Order is forbidden (403).
  - Verified `acs_theme.css` and local font files (`Inter-Regular.woff2`, etc.) served directly with 200 OK without external requests.
- **Step 6 (Test suite counts):**
  - `python -m unittest discover -s erp/acs_erp`: Ran 8 tests in 0.002s — OK.
  - `npm run typecheck`: Passed clean, 0 errors.
  - `npm test`: 13 test files passed, 157 tests passed.
  - `npm run test:int`: 14 test files passed, 63 tests passed (tested with local Postgres instance).
  - `npm run build`: Production build succeeded with all static and dynamic routes compiled.

- **Follow-ups (Claude review 2026-10-01):**
  - **F1 (security):** Added email validation in `passcodec.py` rejecting invalid formats and forbidden identities (`administrator`, `guest`), tested in `test_passcodec.py` (9 tests passing). Added checks in `sso.py` rejecting existing users with `Administrator`, `EngOS Integration`, or non-`System User`.
  - **F2 (bug risk / CSRF on repeat SSO):** Tested in real Chrome. Found that repeat auto-submitting POST with an existing session cookie triggered Frappe CSRF check because `Referrer-Policy: no-referrer` prevented Frappe's `allowed_referrers` whitelist from matching. Changed `Referrer-Policy` to `origin-when-cross-origin` in `src/app/erp/open/route.ts` and configured `allowed_referrers` on site. Repeated SSO logins for same and different users now seamlessly land on `/desk`.
  - **F4 (pycache cleanup):** Untracked and removed committed `__pycache__/*.pyc` files from git index.
  - **F5 (image build hygiene):** Removed `|| true` from `bench build --app acs_erp` in `erp/Dockerfile`; rebuilt image cleanly. Noted that on an existing volume, `apps.txt` is updated via container setup or `bench --site frontend install-app acs_erp`.
  - **F6 (small improvements):** Capped `body` to 500 characters in `erp.user_disable_failed` and added successful audit log `erp.user_disabled` in `src/modules/admin/services/admin.service.ts`.

## Review (Claude)
**2026-10-01, commit `588b681` (all six steps in one commit). Verdict: well built and close to the plan. Fix the two security gaps and prove it in a real browser before REVIEWED.**

**Checked:**
- **Re-ran on a fresh CI-like database:** typecheck clean · `npm test` 13 files / 157 · `npm run test:int` 14 files / 63 · `python -m unittest` 8 OK · build clean. Migration `20261001122602_erp_access_permission` applies cleanly, and `erp.access` is held by exactly `DIRECTOR`, `SALES_HEAD` and `SUPER_ADMIN` (idempotent, joined by key).
- **Pass:** the exact agreed format on both sides, with a shared vector. HMAC is compared in constant time (`timingSafeEqual` / `hmac.compare_digest`). 30 s expiry and 5 s skew. `act` checked in Python. Nonce single-use (cache, 120 s, longer than validity).
- **`/erp/open`:** redirects to `/login` with no session, 403 without `erp.access`, POST-only pass, `no-store` and `no-referrer`.
- **`acs_erp.sso.login` order:** signature → expiry → nonce → user → managed roles only (allowlist) → `login_as` → `/app`. Failures show the plain "Sign-in link expired" page; details only go to the log.
- **`disable_user`:** signed, `act` = disable, nonce, disables the user and clears their sessions. `setUserStatus` calls it best-effort with a 5 s timeout, and failures are audited, never thrown.
- **API user moved to `EngOS Integration`:** read Customer, Item and Sales Order; creating a Sales Order → 403.
- **WO validation:** `WO-4001` refused, `4001` accepted.
- **CI:** runs on `erp`, while `publish`/deploy stay `main`-only.
- **Accepted deviation (should have been noted):** `erp.access` was added to `READ_ONLY_PERMISSIONS` in `engine.ts`. That's correct: it keeps the Sales Head "read-only" in PM (so `isDirectorUser` stays false for them), because ERP access grants no PM writes.
- **Accepted behaviour:** an ERPNext user disabled directly in ERPNext is re-enabled on their next sign-in from our app. Our app is the source of truth for who is active.

**Follow-ups (implementer):**
- [x] **F1 (security): never sign in to a privileged or system ERPNext account.**
  - `login` signs in **any** existing user whose email matches the pass. Today that includes the integration user `engos-api@acsengitech.com`, and lookups are case-insensitive, so the email `administrator` would reach Administrator. A Director-created Engineering OS user with such an email would become that account.
  - Refuse (plain failure page plus a log entry) when the email isn't a normal address (one `@`, not `administrator` or `guest`), or when the existing ERPNext user holds `Administrator` or `EngOS Integration`, or isn't a `System User`.
  - Put the email check in `passcodec` (plain-Python tested) and the role check in `sso.py`.
  - Test both: a pass for the API user's email → refused; a pass for `administrator` → refused.
- [x] **F2 (bug risk): opening ERP while already signed in.** Step 5 was checked with a script, not a browser. In a browser that already has an ERPNext session, the auto-submitted POST may carry that session cookie: `127.0.0.1:3001` → `:8080` is same-site, and in production `engos.…` and `erp.…` will be same-site too. Frappe would then demand a CSRF token and answer "Invalid Request".
  - Test in a real browser: Open ERP, then go back and Open ERP again, as the same user and as a different user.
  - If it fails, fix it, for example: when the request already has a session, end it first, or detect that it's the same user and just redirect to `/app`.
  - Record what happened.
- [ ] **F3: the real browser check and screenshots** (step 5 acceptance, not yet met):
  - sign in as a seeded Director and as the Sales Head; click **ERP** → **Open ERP**;
  - screenshots of ERPNext's Selling workspace, Sales Order list, Sales Order form, Customer form and login page, next to our Director dashboard and Clients page;
  - confirm in the browser's network tab that no font or CSS comes from Google.
- [x] **F4: remove the committed `__pycache__/*.pyc` files** (`git rm -r --cached` on the three `__pycache__` folders). Claude added `__pycache__/` and `*.pyc` to `.gitignore`.
- [x] **F5: image build hygiene.**
  - Remove `|| true` from `bench build --app acs_erp` in `erp/Dockerfile`, so a broken asset build fails the image.
  - In the notes, say exactly how `acs_erp` got into `sites/apps.txt` on the existing local `sites` volume. The Dockerfile edits the image copy, but an existing volume keeps its own copy. Claude needs the exact step for the VPS install.
- [x] **F6 (small):**
  - Cap the response body stored in the `erp.user_disable_failed` audit entry (about 500 characters).
  - Also audit a successful disable (`erp.user_disabled`).
  - Fix the notes: the action isn't `USER_DISABLE_ERPNEXT`.
  - `install.py` re-creates the custom fields and DocPerms that the fixtures already ship (`_ensure_custom_fields`, `_ensure_docperms`). Keep one source (the fixtures) unless there's a reason; if so, write it down.
- [ ] **F7: role mapping (user decision 2026-10-01).**
  - **Directors (and Super Admin):** `System Manager` **plus every ERPNext module role**.
  - **Sales Head:** **every ERPNext module role, without `System Manager`** (they work in every module but can't change ERPNext settings, users or customisation).
  - "Every module role" = the business roles ERPNext v16 installs for its modules: Selling, Buying, Stock, Accounts, Manufacturing, Quality, Assets, Support/Maintenance, and the master-data roles (e.g. `Sales Manager`, `Sales User`, `Sales Master Manager`, `Purchase Manager`, `Purchase User`, `Purchase Master Manager`, `Stock Manager`, `Stock User`, `Item Manager`, `Accounts Manager`, `Accounts User`, `Manufacturing Manager`, `Manufacturing User`, `Quality Manager`, `Maintenance Manager`, `Maintenance User`). **Check the real list on the local site** and paste it into the notes.
  - Leave out: `Projects Manager`, `Projects User` (see F8), `Administrator`, `Guest`, `System Manager` for the Sales Head, and any HR roles (HRMS isn't installed).
  - Update `rolesFor`/the role constants in `sso.ts` and `MANAGED_ROLES` in `sso.py` to match exactly. Update the unit tests (Director has `System Manager`; Sales Head has every module role but not `System Manager`; Engineer has none).
  - Re-check in the browser: the Sales Head can open Buying/Stock/Accounts/Manufacturing, but not System Settings or User management.
- [ ] **F8: hide ERPNext's own Projects module (user decision 2026-10-01).** Projects live only in PM. In `acs_erp` (fixtures or `after_install`, idempotent):
  - hide the **Projects** workspace for everyone;
  - give no user `Projects Manager`/`Projects User` (they stay out of the managed roles, and the sign-in removes them if present);
  - remove *create* on the `Project` DocType for every role, `System Manager` included;
  - hide the `project` link field on Sales Order (and on Quotation, Sales Invoice and Purchase Order if present) with Property Setters, so nobody links an order to an ERPNext Project by mistake.
  - Check in the browser as a Director: no Projects workspace in the sidebar, no Project field on the Sales Order form, and `/app/project/new` refuses to create one.

