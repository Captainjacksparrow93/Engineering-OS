# 020 — HRMS: employee records, time, payslips, lifecycle, growth

**Status:** IN PROGRESS (phase 1 DONE, waiting for the user's review)
**Author:** Claude · **Implementer:** Claude (user decision 2026-10-11: Claude builds HRMS on branch `HRMS`)

## Goal
A full HR module inside Engineering OS, replacing the "Coming soon" page at `/hrms`. Scope follows
the PeopleStrong HRMS feature list (core + additional), sized for ACS Engitech. It ships **phase by
phase**; each phase can be reviewed and released alone.

User answers (2026-10-11):
1. Claude builds it.
2. HRMS runs on its own branch. It does **not** jump the ERP queue.
3. Payroll **only produces payslips from salary figures HR enters**. No statutory calculation in
   the app: the CA does PF / ESI / PT / TDS compliance. HR types the deduction amounts.
4. Attendance comes from the **biometric machine's CSV export**, imported by HR.
5. Visibility:
   - Directors and HR see everything, salary included.
   - Department heads see their own team's records, leave and attendance, but not salary.
   - Employees see only their own records.
   - Engineers keep logging PM work as today.
6. Leave approval: **reporting manager, then department head**, in that order.
7. Deliver phase by phase (1 → 6).

## Design decisions (all phases)
- **One person record.** `core_users` stays the identity (code, name, email, department, manager,
  status). HRMS adds `hr_*` tables keyed by `userId`. No second employee list.
- **Permissions** (checked in services; the UI only hides what the service refuses):

  | Key | Meaning | Roles |
  |---|---|---|
  | `hr.employee.read` | See employee records in scope: department-scoped grants see the covered departments; global grants see everyone | HR Manager, Director (global); Department Head, Technical Head, Head of Service (their department scope) |
  | `hr.employee.manage` | Edit HR records, upload employee documents and company policies | HR Manager, Director |
  | `hr.sensitive.read` | See bank account and ID numbers (PAN, Aadhaar, UAN, ESIC) | HR Manager, Director |
  | `hr.leave.approve` *(phase 2)* | Department-head approval step; HR override | Department heads (scoped), HR Manager |
  | `hr.attendance.manage` *(phase 2)* | Import the biometric CSV, fix attendance, holidays, shifts | HR Manager |
  | `hr.payroll.manage` *(phase 3)* | Salary figures, payroll runs, payslips | HR Manager, Director |
  | further keys per phase | recruitment, performance, expenses, compliance | HR Manager (+ Director) |

  Self-service needs **no key**: your own profile, documents, leave, attendance and payslips belong
  to you, as in Gate (plan 019).
- **New role `HR_MANAGER`** ("HR Manager"): all `hr.*` keys plus `admin.user.read` and
  `admin.user.manage`, so HR can add and deactivate accounts in People. HR **cannot** assign roles
  or reset passwords. A fresh seed gives it to ACS-0005 (HR executive). An existing database needs
  the role assigned once in People.
- **Department heads see team records but no salary or IDs.** Salary lives behind
  `hr.payroll.manage` (phase 3). Bank and ID numbers live behind `hr.sensitive.read`. Others see
  them masked (last 4 characters).
- **Documents live in Postgres** (`bytea`), up to 3 MB each (PDF, JPG, PNG). They are covered by
  the existing daily database backup, with no new volume or service. The server-action body limit
  is already 4 MB. Uploading the same category and title again makes a new version; old versions
  stay downloadable (version history).
- **Company policies** are documents with no employee (`userId` null). Everyone can read them.
- **PM keeps working unchanged.** Phase 2 writes an approved leave into `core_leaves`
  (`sourceModule = 'hrms'`). Availability and team load already read that table, so PM capacity
  follows HR leave with no PM change.
- **Times and dates are India time**, as in Gate.
- **No new npm dependency.** Payslip PDF uses the existing print-page pattern (browser "Save as PDF"),
  as the Sales quotation does.

## Phases
| Phase | Contents | Status |
|---|---|---|
| 1. Core | Employee records (job, personal, emergency, statutory and bank), employee directory, document management with versions, company policies, self-service "My profile", HR overview (headcount, joiners, probation ending, birthdays and work anniversaries, incomplete records), HR Manager role | DONE |
| 2. Time | Leave types and yearly balances, apply/cancel, manager → department head approval, approved leave feeds PM capacity. Holiday calendar. Biometric CSV import with daily attendance, late and short days, regularisation requests, overtime | TODO |
| 3. Payslips | Salary figures per employee (earnings and deductions typed by HR), monthly run with LOP days from attendance, payslip print/PDF, employee "My payslips", bank transfer CSV | TODO |
| 4. Lifecycle | Recruitment (openings, candidates, interview stages, offer), onboarding and exit checklists, exit sets the account to Exited | TODO |
| 5. Growth | Goals/KPIs, appraisal cycles (self → manager → director), succession (named successors and readiness) | TODO |
| 6. Extras | Expense claims with approval and reimbursement, benefits and insurance enrolment, compliance calendar with due-date alerts, HR analytics (headcount, attrition, leave and attendance trends) | TODO |

Out of scope (user decisions and existing rules): statutory payroll calculation, biometric device
integration (CSV only), geofencing, multi-country, accounting integration, a separate mobile app
(the web app works on phones).

## Phase 1 — Core

### Affected code
- `prisma/schema.prisma`: `HrEmployeeProfile` (1:1 with `User`), `HrDocument`, and enums
  `HrEmploymentType`, `HrGender`, `HrMaritalStatus`, `HrDocumentCategory`. Back-relations on
  `User` and `Company` (additive).
- `prisma/migrations/20261011120000_hrms_core` (new tables, enums, indexes, foreign keys only).
- `prisma/migrations/20261011120100_hrms_permissions` (hand-written SQL: three keys, the
  `HR_MANAGER` role, grants by key, `ON CONFLICT DO NOTHING`).
- `src/core/rbac/permissions.ts`: `hr.*` keys and `HR_MANAGER`. Directors and the three
  department-head roles get their keys.
- `src/core/rbac/engine.ts`: `isReadOnly` ignores `hr.*` grants, as it already ignores `sales.*`
  and `gate.*`. Callers: `task.service.ts` `addComment`, `handover.service.ts`,
  `pm/tasks/[id]/page.tsx`. No behaviour change, because nobody held an `hr.*` key before.
- `src/core/modules/registry.ts`: HRMS tile LIVE, visible to everyone (self-service).
- `src/components/shell/sidebar.tsx`: "HR" nav section.
- `prisma/seed.ts`: on a **fresh** seed, ACS-0005 also gets `HR_MANAGER` (create-only, like every
  seeded role).
- New files: `src/modules/hrms/**`, `src/app/(shell)/hrms/**` (replaces the coming-soon page),
  `src/app/actions/hrms.ts`, `src/app/api/hrms/documents/[id]/route.ts` (download).
- Blast radius: code-review-graph and Token Savior are **not available** in this cloud session.
  It comes from `grep` instead:
  - `isReadOnly`: 3 call sites.
  - `SYSTEM_ROLES`: seed only.
  - `MODULES`: launcher and coming-soon.

### Constraints
- Additive migrations only. No new npm dependency. No VPS, no production data. Never push to `main`.
- Every service ships with integration tests: allow, deny, happy path, validation failure.

### Steps
- [x] 1. Schema, both migrations, permission keys, HR Manager role, `isReadOnly`, registry, seed.
- [x] 2. Services: employee records (scope rules, masking, self-edit vs HR edit), documents
  (upload, versions, download rights), overview. Validation. Integration tests.
- [x] 3. UI: HR overview, employee directory, employee record, edit forms, documents, company
  policies, My profile, sidebar.
- [x] 4. Full suite on a fresh DB built like CI; browser check; notes; INDEX.

### Acceptance criteria
- [x] Typecheck, unit tests, build and integration tests pass on a fresh DB (migrate deploy + seed).
- [x] HR and Directors see every employee. A department head sees only their department's people,
  with bank and ID numbers masked. An employee opening someone else's record gets "not found".
- [x] An employee edits their own personal and emergency details but not job, ID or bank fields.
  HR edits everything. Every change is in the audit trail.
- [x] HR uploads a document for an employee. Uploading it again keeps the older version. The
  employee can download their own documents unless HR marked one HR-only. Others cannot download it.
- [x] HR publishes company policies and everyone can read them.
- [x] The HR overview shows headcount by department, joiners this month, probations ending in 30
  days, birthdays and work anniversaries this month, and records missing key details.

## Implementation notes (implementer)
See "Phase 1 notes" below; later phases add their own.

### Phase 1 notes
Built by Claude on `HRMS` (user decision 2026-10-11).

**What each person gets**
- **Every employee:**
  - "My profile" (`/hrms/me`) shows their whole HR record. They edit their personal details
    (birth date, gender, marital status, blood group, personal email, addresses) and emergency
    contact.
  - They see their own ID and bank numbers in full but cannot change them ("send HR the new
    document").
  - They open the documents HR filed for them, and get a notification when a new one arrives.
  - "Company policies" lists every policy.
  - Opening `/hrms` takes them to My profile.
- **HR Manager** (new role; ACS-0005 on a fresh seed):
  - "HR overview" shows active headcount, joiners this month, probations ending within 30 days
    (overdue ones flagged), headcount by department, birthdays and work anniversaries this month,
    and records missing key details.
  - "Employees" is a directory with search, department and status filters, and a
    "complete / N missing" marker per person.
  - On each employee record, HR edits job details (joining date, employment type, probation,
    confirmation, location, notice period), personal details, and ID and bank details.
  - HR uploads documents, versioned and optionally HR-only, and removes versions.
  - HR publishes company policies.
  - HR adds and deactivates accounts in People (`admin.user.read` / `admin.user.manage`), but
    cannot assign roles or reset passwords.
- **Directors:** the same as HR in HRMS (all three `hr.*` keys).
- **Department heads** (Department Head, Technical Head, Head of Service):
  - The HR overview and directory, limited to the departments their role covers.
  - Team records read-only, with PAN, Aadhaar, UAN, ESIC, account number and IFSC masked to the
    last 4 characters.
  - No employee documents.
  - Anyone outside their department reads "Page not found".

**Decisions taken while building**
- Documents are checked by their first bytes (PDF, PNG, JPEG), not by the browser's file type, so
  a renamed HTML file is refused. They are served `inline` with `private, no-store`.
- A new version keeps the title it was first filed under (the match ignores case). Removing the
  current version makes the previous one current again.
- The audit trail records before and after values for job and personal changes. For ID and bank
  changes it records **only the field names**, never the numbers.
- Saving a form with no change writes nothing and no audit row.
- The permission migration also inserts `admin.user.read` and `admin.user.manage` (`ON CONFLICT DO
  NOTHING`). On a fresh database the migrations run before the seed creates the catalogue, and
  the seed never changes a role that already exists, so without this HR Manager would miss People
  access on a fresh database.
- The migration was generated with `prisma migrate diff` against a database at the previous head.
  `migrate diff --from-migrations … --exit-code` reports "No difference detected".

**Tests** (fresh throwaway DB: empty → `prisma migrate deploy` → `npm run db:seed`, 2026-10-11)
- `npm run typecheck`: pass.
- `npm test`: 20 files, **216 passed**. 8 are new in `src/modules/hrms/domain/records.test.ts`
  (masking, file sniffing, file names, dates, missing details, validation).
- `npm run test:int`: 19 files, **133 passed**. 12 are new in `src/modules/hrms/hrms.int.test.ts`:
  - roles and read-only status
  - directory scope: HR sees everyone, a head sees their department, an employee is refused
  - HR job and statutory edits, with an audit row that holds no ID numbers
  - a head sees masked data and no documents
  - an employee sees only themselves
  - an employee edits personal details only
  - validation failures
  - audit before/after and no-op saves
  - document versions and download rights (HR-only, other employee, head, Director)
  - refused uploads (non-HR, HTML, over 3 MB, empty, short title)
  - policies
  - the overview in scope
- `npm run build`: pass.
- On the fresh DB: HR_MANAGER holds the 3 `hr.*` keys plus `admin.user.read` and
  `admin.user.manage`. ACS-0005 holds HR_MANAGER.
- Browser (Playwright + Chromium against `next start`, fresh seeded DB):
  - **Engineer (ACS-0008):** `/hrms` → My profile. The sidebar shows only "My profile" and
    "Company policies". Saving details works. A bad email shows "Enter a valid personal email.".
    `/hrms/employees` shows "Page not found". No horizontal scroll at 390 px.
  - **HR (ACS-0005):**
    - The overview shows 95 active and 1 probation ending.
    - Edited job and ID/bank details for ACS-0008; PAN shown in full.
    - Uploaded the offer letter twice: "Older versions" appeared.
    - An HTML file renamed `.pdf` was refused with "Upload a PDF, JPG or PNG file.".
    - Published a leave policy.
  - **Purchase head (ACS-0007):** 3 people in the directory; ACS-0008's PAN shows as `••••••234F`;
    no Documents card and no edit links.
  - **Engineer again:**
    - Their own offer letter opens (200, `application/pdf`) and the policy is listed.
    - Another engineer gets 404 on the same document.
    - That engineer sees "Page not found" on ACS-0008's record, and the page holds no PAN digits.
  - No page errors.

**Tools:** code-review-graph, Token Savior and sequential-thinking were **not available** in this
cloud session. The blast radius came from `grep`.

**Before production** (not done; needs the user):
- Rehearse both migrations on a production copy. Both are additive; the permission migration
  only inserts.
- In People, give the HR executive the **HR Manager** role. A fresh seed does this for ACS-0005
  only; an existing database needs it done by hand.
- Department heads get team read access automatically through their existing roles. The
  migration grants `hr.employee.read` to the three head roles.

## Review (Claude)
