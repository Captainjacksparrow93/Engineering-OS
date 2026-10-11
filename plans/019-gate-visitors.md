# 019 — Gate & Visitors: reception desk, staff-scheduled visits, arrival alerts

**Status:** DONE (waiting for the user's review)
**Author:** Claude · **Implementer:** Claude (user decision 2026-10-11: Claude builds this module on branch `Gate-and-Visitor-Management-Modules`)

## Goal
A front-desk module for visitors (people only). The receptionist schedules visits, logs
walk-ins and checks visitors in and out. Scheduling works both ways: any employee can also
schedule a visit to themselves. When a visitor arrives, the person they came to see is alerted
on whatever screen they have open and replies. The receptionist sees the reply.

User answers (2026-10-11):
1. Claude builds it.
2. The host can reply to an arrival: "Coming down", "Ask them to wait", "Not available". The
   receptionist sees the reply.
3. Visitor details: name, phone, company, purpose. Nothing else (no ID proof, photo or vehicle).
4. A visit an employee schedules goes straight onto the list. No approval step.
5. No printable gate pass or badge.
6. The full log and history: the receptionist and Directors only. Each employee sees their own
   visitors.
7. People only. Material gate entry (goods in/out, challans) is out of scope.

## Design decisions
- **Own table `gate_visits`** (module seam; `User` and `Company` are the shared kernel). One row
  per visit: `EXPECTED → CHECKED_IN → CHECKED_OUT`, or `EXPECTED → CANCELLED`. `source` records
  who put it on the list (`DESK`, `HOST`, `WALK_IN`). A walk-in is created already `CHECKED_IN`,
  with `expectedAt` = arrival time, so one date field drives every list.
- **Permissions:** `gate.desk` (Receptionist) runs the desk; `gate.register.read` (Receptionist,
  Director) sees the full register. **Self-service needs no key:** scheduling a visit to yourself,
  seeing your own visitors and replying are tied to who you are, like notifications. So every
  employee, including the many with no role today, can use them.
- **Arrival alert:** an in-app notification (`core_notifications`), plus a banner at the top of
  every page in the shell while the visitor waits and the host has not replied. The shell already
  refreshes every 60 s (`FreshCountsListener`), so a new arrival appears within a minute without
  a reload. No new service, no new dependency.
- **The host's reply** is stored on the visit (`hostReply`, optional note); the desk sees it on its
  screen, and desk users also get a notification.
- **Status changes are race-safe:** check-in, check-out and cancel move a visit only from the
  expected status (`updateMany … where status`), so a double click or two desk screens cannot
  check someone in twice.
- **Times are India time.** Typed date and time are read as IST; "today" is the IST day.
- An expected visit from an earlier day that never arrived shows as "Did not arrive" (derived; no
  extra status).

## Affected code
- `prisma/schema.prisma`: `GateVisit` and enums `GateVisitStatus`, `GateVisitSource`,
  `GateHostReply`; back-relations on `User` and `Company` (additive).
- `prisma/migrations/20261011090000_gate_visitors` (generated with `prisma migrate diff`; new table,
  enums, indexes, foreign keys only).
- `prisma/migrations/20261011090100_gate_permissions` (hand-written SQL: two permission keys, the
  `RECEPTIONIST` role, grants by key; `ON CONFLICT DO NOTHING`).
- `src/core/rbac/permissions.ts`: `gate.*` keys; `RECEPTIONIST`; `DIRECTOR` gets `gate.register.read`.
- `src/core/rbac/engine.ts`: `homePath` sends the desk to `/gate`; `isReadOnly` ignores `gate.*`
  grants as it already ignored `sales.*` (callers: `task.service.ts` `addComment`,
  `handover.service.ts`, `pm/tasks/[id]/page.tsx`. No behaviour change for existing roles, since
  none held a `gate.*` key).
- `src/core/modules/registry.ts`: Gate tile is now "Gate & Visitors", LIVE, visible to everyone.
- `src/components/shell/sidebar.tsx` and `nav-link.tsx`: "Gate & visitors" nav section.
- `src/app/(shell)/layout.tsx`: loads `listWaitingForMe` and renders the arrival banner.
- `src/components/action-form.tsx`: moved from `src/app/(shell)/sales/_components/` so both
  modules share it (10 Sales imports updated; no behaviour change).
- `prisma/seed.ts`: the seeded receptionist (ACS-0006) gets `RECEPTIONIST` on a **fresh** seed
  (create-only, as for every seeded role).
- New: `src/modules/gate/**`, `src/app/(shell)/gate/**` (replaces the coming-soon page),
  `src/app/actions/gate.ts`.
- Blast radius: code-review-graph and Token Savior are **not available** in this cloud session. The
  blast radius above comes from `grep` (`isReadOnly`: 3 call sites; `homePath`: login redirect;
  `ActionForm`: 10 Sales pages).

## Permissions
| Key | Meaning | Roles |
|---|---|---|
| `gate.desk` | Front desk: schedule for anyone, log walk-ins, check in and out | Receptionist (and Platform Administrator) |
| `gate.register.read` | Full visitor register and history | Receptionist, Director (and Platform Administrator) |
| *(none)* | Schedule a visit to yourself, see your visitors, reply to an arrival | Every employee |

## Constraints
- Additive migrations only. No new npm dependency. No VPS, no production data. Never push to `main`.
- Every service ships with integration tests: allow, deny, happy path, validation failure.

## Steps
- [x] 1. Schema, both migrations, permission keys, Receptionist role, `homePath`, `isReadOnly`, registry.
- [x] 2. Service (`visit.service.ts`) and IST helpers, with unit and integration tests.
- [x] 3. UI: reception desk, my visitors, visitor register, arrival banner in the shell, sidebar.
- [x] 4. Full suite on a fresh DB built like CI; browser check; notes; INDEX.

## Acceptance criteria
- [x] Typecheck, unit tests, build and integration tests pass on a fresh DB (migrate deploy + seed).
- [x] The receptionist schedules a visit for any employee, logs a walk-in, and checks visitors in and out.
- [x] Any employee schedules a visit to themselves; it appears on the desk's list with no approval.
- [x] On check-in (scheduled or walk-in) the host gets a notification and a banner on every page.
- [x] The host replies Coming down / Ask them to wait / Not available (with an optional note), and the desk sees it.
- [x] The register (date range + search) is open to the receptionist and Directors only. Employees see only their own visitors.

## Implementation notes (implementer)
Built by Claude on `Gate-and-Visitor-Management-Modules` (user decision 2026-10-11).

**What each person gets**
- **Receptionist** (lands on `/gate` after sign-in): counts for expected, inside and left today;
  **Inside now** with the host's reply and Check out; **Expected today** with Check in and Cancel;
  **Walk-in visitor** (checked in at once, host alerted); **Schedule a visit** for any employee;
  **Coming up**; **Left today**; link to the register.
- **Every employee** (`/gate/my-visitors`, "My visitors" in the sidebar): schedule a visitor to
  themselves; see who is at reception and reply (with an optional note, and they can change it);
  coming up (with Cancel); the last 30 days. When a visitor checks in, a banner sits on top of
  every page with the three reply buttons until they answer, and a notification is added.
- **Directors** (`/gate/register`, "Visitor register" in the sidebar): every visit in a date range
  (default last 7 days) with search by visitor, company, phone, purpose or employee; type, status,
  in and out times, host reply. Directors cannot check people in (desk only).
- Notifications: the host is told when the desk schedules a visit for them, when their visitor
  arrives, and when the desk cancels their visit; desk users are told when a host replies.

**Decisions taken while building**
- `scheduleVisit` accepts today's date with an earlier time (the desk may log a visit that was due
  this morning); earlier dates are refused.
- The migration was generated with `prisma migrate diff` against a database migrated to the
  previous head (the session blocked `prisma migrate dev`); `migrate diff --exit-code` afterwards
  shows no drift between the migrations and `schema.prisma`.
- `isReadOnly` ignores `gate.*` like `sales.*`, so a Receptionist (gate keys only) is read-only
  in Project Management.

**Tests** (fresh throwaway DB: empty → `prisma migrate deploy` → `npm run db:seed`, 2026-10-11)
- `npm run typecheck`: pass. `npm test`: 19 files, **208 passed** (4 new IST helper tests).
  `npm run test:int`: 18 files, **121 passed** (11 new in `src/modules/gate/gate.int.test.ts`:
  roles and landing page; schedule self/other/desk; validation (phone, name, time, past date,
  unknown host); check-in → alert → reply → check-out; walk-in; cancel by host/desk/other;
  register visibility; desk-only screens; audit trail). `npm run build`: pass.
- Browser (Playwright + Chromium against `next start`, seeded DB): an engineer schedules a visitor
  → receptionist (ACS-0006) signs in and lands on the desk, sees it expected, logs a walk-in for
  the same engineer and checks the scheduled visitor in → the engineer's My work page shows both
  arrival banners → "Coming down" on one clears it → "Ask them to wait" with a note from My
  visitors → the desk shows both replies → check-out moves the walk-in to Left today → a Director
  opening Gate lands on the register with both visits → an employee opening the register gets
  "not found", and Gate takes them to My visitors. No horizontal scroll at 390 px.

**Tools**: code-review-graph, Token Savior and sequential-thinking were **not available** in this
cloud session; the blast radius came from `grep`.

**Before production** (not done, needs the user): rehearse both migrations on a production copy
(both additive; the permission migration only inserts); in People, give the receptionist (and any
security staff who run the desk) the **Receptionist** role. A fresh seed does this for ACS-0006
only; an existing database needs it done by hand.

**Later (not built)**: material gate entry (out of scope by decision); WhatsApp/SMS alert to the
visitor or host (the notification table already has the channels); a desk screen that refreshes
faster than 60 s.

## Review (Claude)
