# Project wipe + PM team update — runbook

**Confirmed by the user, 24 Sep 2026:**

| Decision | Answer |
|---|---|
| Which projects to delete | **All 16.** Clean slate. |
| Seeds that recreate them | **Disable both.** |
| Org chart import | **Skip** — PM team only |
| Department renames | **Skip** |
| Service work as a module | **Skip for now** |
| Backups / password rotation | **Skip** |

> Earlier the user asked to treat demo data as live. That is **reversed**: it is all being
> deleted.

**Order matters.** The seeds must stop recreating projects *before* anything is deleted, or
the next container restart brings it all back. Part 1 ships first, then Part 2 deletes.

---

## For Antigravity — what you do, and what you must not do

**You write code and you write scripts. You do not touch production.**

| You DO | You DO NOT |
|---|---|
| Part 1 — edit `entrypoint.sh`, `seed.ts`, `seed-demo.ts` | Run anything against the VPS |
| Part 2 — write the delete SQL as a **file** in `prisma/scripts/` | Execute the delete |
| Part 3a — add the `SERVICE_HEAD` role + a grant script | Run the grant script on the VPS |
| Part 3b/3c — write the manager/designation update as a **script** | Execute it |
| Run `typecheck`, `test`, `build` locally | `git push` |

**Do not create Akash Vasava (§3d).** That is done by a human through the People screen,
because it involves setting a real person's password.

Commit your work. **Do not push** — pushing deploys to production, and Part 2's deletion is
irreversible and must be run in a controlled order with a `pg_dump` first.

Hand back: the commit, plus the exact commands the operator should run and in what order.

### Suggested shape for the scripts

Put both under `prisma/scripts/`, in the style of the existing
`grant-commissioning-permissions.ts`:

- `wipe-all-projects.ts` — the deletion in Part 2, **idempotent**, printing counts before
  and after so the operator can see what it did
- `update-pm-team.ts` — the manager and designation changes in Part 3b/3c, matching people
  by **`employeeCode`**, never by name, skipping anyone already correct and printing each
  change it makes

Both must be safe to run twice. Both must print, not just act — the last two silent scripts
in this project cost real debugging time.

---

## Part 1 — stop the seeds recreating projects (CODE, deploy first)

### 1a. `entrypoint.sh`

Remove the two `seed-demo.ts` invocations (both branches of the `if`). Nothing else in that
file changes — the honest failure messages from Task 0 stay.

### 1b. `prisma/seed.ts`

The file seeds two different kinds of thing and only the second is going:

| Lines | Section | Action |
|---|---|---|
| 1–1418 | permissions, roles, module registry, checklist templates, company, **people**, clients | **KEEP** |
| 1419–end | **projects**, tasks, assignments, handovers | **DELETE** |

Remove the `// --- projects` and `// --- tasks` sections and everything after them, plus any
now-unused helpers and imports. Delete the console line
`"3 live automation projects seeded with 13 standard checklist tasks each…"` — it must not
claim work it no longer does.

`seed.ts` must still seed people, roles, permissions, checklist templates and clients on
every start. **Only project creation goes.**

### 1c. `prisma/seed-demo.ts`

Keep the file (it is a useful demo fixture) but it is no longer called from `entrypoint.sh`.
Add a comment at the top: **not run automatically; run by hand only when demo data is
wanted.**

### Verify before deploying

`npm run typecheck && npm run test && npm run build`, then confirm by inspection that
`seed.ts` no longer contains `prisma.project.create`.

---

## Part 2 — delete all 16 projects (DATA, after Part 1 is live)

Only after the container is running Part 1's code. Otherwise the next restart re-seeds.

### What goes

All 16 projects: 8 `DEMO-*`, 3 `PRJ-2026-*` (VSPL), and 5 created through the wizard
(`3-SERVO`, `K100`, `EVS-1023`, `ACS-0002-0001`, `ACS-0002-0002`). **463 tasks**, every
assignment, progress log, comment, dependency, milestone and handover cascades with them.

### What stays

**People, clients, roles, permissions, checklist templates, departments, audit log.** Nothing
outside the project tree is touched.

### The one thing cascade does NOT handle

`RoleAssignment.scopeId` has **no foreign key** to `Project`, so `PROJECT`-scoped role
assignments survive and become orphans pointing at dead ids. Delete them explicitly, first.

```sql
BEGIN;
DELETE FROM core_role_assignments WHERE "scopeType" = 'PROJECT';
DELETE FROM pm_projects;
COMMIT;
```

Everything under a project cascades (`onDelete: Cascade` on tasks, members, milestones,
handovers, and onward to assignments, logs, comments, dependencies).

### Verify

```sql
SELECT (SELECT count(*) FROM pm_projects)              AS projects,      -- 0
       (SELECT count(*) FROM pm_tasks)                 AS tasks,         -- 0
       (SELECT count(*) FROM pm_task_assignments)      AS assignments,   -- 0
       (SELECT count(*) FROM pm_task_progress_logs)    AS logs,          -- 0
       (SELECT count(*) FROM pm_commissioning_logs)    AS comm_logs,     -- 0
       (SELECT count(*) FROM core_users)               AS people,        -- unchanged (109)
       (SELECT count(*) FROM pm_clients)               AS clients,       -- unchanged (16)
       (SELECT count(*) FROM pm_checklist_templates)   AS templates;     -- unchanged (3)
```

Then **restart the container** and re-run the counts. Projects must still be 0 — that is the
real proof Part 1 worked.

A `pg_dump` is taken first regardless. That is a safety net for this one irreversible
operation, not the automated-backup work that was skipped.

---

## Part 3 — PM team update (DATA)

Scope: the **Project & Service** squad only. No other department, no new joiners elsewhere,
no department renames.

### 3a. New role `SERVICE_HEAD`

Add to `SYSTEM_ROLES` in `src/core/rbac/permissions.ts`, with the same permission set as
`TECHNICAL_HEAD` **plus** `pm.commissioning.manage` and `pm.commissioning.approve`.

**Confirmed: both heads get commissioning.** `TECHNICAL_HEAD` keeps its commissioning
rights; `SERVICE_HEAD` gets them too; Director keeps them.

Role seeding is create-only, so assign it to **Rajani Bhurabhai Nagar (`ACS-0062`)** via a
one-off script under `prisma/scripts/`, at `DEPARTMENT` scope on `TECH` — matching how
`TECHNICAL_HEAD` is granted to Dilip.

> **Do not give `SERVICE_HEAD` the `pm.oversight` permission unless you also intend to
> change squad boundaries.** Squads are computed by walking up to the nearest
> `pm.oversight` holder (`teamOf` → `teamMemberIds`). Adding a second oversight holder
> inside the tree re-cuts every squad and silently changes who may hand work to whom.

### 3b. Reporting line changes

Chart names are short; these are matched to employee codes. **Eleven real changes:**

| Employee | Code | Manager now | Manager should be |
|---|---|---|---|
| Dilipkumar Asediya (Head of Technical) | ACS-0061 | Satish Nagar | **Shaktikumar Vasava** |
| Rajani Nagar (Head of Service) | ACS-0062 | Dilip Asediya | **Shaktikumar Vasava** |
| Munaf Multani (Asst. Manager) | ACS-0075 | Paras Prajapati | **Dilip Asediya** |
| Dhrupin Vaghasiya (Asst. Manager) | ACS-0070 | Parth Nagar | **Dilip Asediya** |
| Het Patel | ACS-0067 | Parth Nagar | **Munaf Multani** |
| Agastya Patel | ACS-0068 | Parth Nagar | **Munaf Multani** |
| Dixit Prajapati | ACS-0069 | Parth Nagar | **Munaf Multani** |
| Hitesh Malviya | ACS-0079 | Paras Prajapati | **Munaf Multani** |
| Ashish Hajare | ACS-0082 | Krupesh Solanki | **Munaf Multani** |
| Jigar Nayak | ACS-0073 | Yogi Patel | **Dhrupin Vaghasiya** |
| Tejas Rokade | ACS-0083 | Krupesh Solanki | **Dhrupin Vaghasiya** |
| Anurag Vaishnav | ACS-0072 | Yogi Patel | **Paras Prajapati** |
| Harmitsinh Udavat | ACS-0080 | Chirag Prajapati | **Parth Nagar** |

**Already correct, leave alone:** Parth Nagar and Paras Prajapati report to Dilip; Shivam,
Sahil and Abbasali report to Parth; Harsh, Ridhhi and Chirag report to Paras; Yogi reports
to Dhrupin.

Note **Krupesh Solanki** currently manages two Project & Service people but sits in **QC** on
the chart (Junior Engineer under Prakash Darji). Moving Ashish and Tejas off him fixes that.
His own record is out of scope.

**On dual reporting:** the chart shows the four squad leads under *"Dlip / Rajani"*.
`managerId` holds one, so the **project** line is used — Dilip. Rajani's authority comes from
the `SERVICE_HEAD` role instead. Per §4 of `docs/org-and-lifecycle-redesign.md`.

### 3c. Designation

**Harmitsinh Udavat (ACS-0080):** `Jr. Engineer` → **`Service Engineer`**.

He must stay in the engineer pool. The query needs a `SENIOR_ENGINEER`/`JUNIOR_ENGINEER`
role and excludes designations containing "Manager"/"Asst" — "Service Engineer" trips
neither, and his role assignment is unchanged. **Re-check the wizard dropdown after the
change.**

### 3d. New person — Akash Vasava (CONFIRMED)

**Add him to the team.** The only genuinely new name in this squad.

**Create him through the app, on `/admin/users` (People) — not by SQL.** `createUser` in
`modules/admin/services/admin.service.ts` already hashes the password, enforces
email/employee-code uniqueness, grants the role and sets the manager in one transaction, and
the action is audited. A raw insert would need a `passwordHash` invented by hand and would
skip all of that.

| Field | Value |
|---|---|
| Full name | Akash Vasava |
| Employee code | **ACS-0096** — codes run to `ACS-0095`; confirm nothing was added since |
| Email | `akash.vasava@acsengitech.com` — matches the `firstname.lastname@` convention |
| Designation | Jr. Engineer |
| Grade | `JUNIOR_ENGINEER` |
| Department | Technical & Project Management (`TECH`) |
| Manager | **Paras Prajapati (ACS-0074)** |
| Role | `JUNIOR_ENGINEER` |
| Password | set by whoever creates the account; he changes it at first login |

**Claude does not set the password.** The person doing this enters it in the People screen.

**After creating, verify he appears** in the project wizard's engineer list under Paras's
group, and in Team Load.

> Note `prisma/scripts/set-passwords-from-csv.ts` runs on every container start from
> `prisma/data/logins.csv`. Akash is not in that file, so his password will not be
> overwritten — but if he is ever added there, the file is committed to git in plain text.
> That remains a known, accepted risk the user has chosen not to address for now.

### Verify

Open the project wizard: all four squad leads (Parth, Paras, Munaf, Dhrupin) appear as
project owners, and each one's engineer list is exactly their own reports per the table
above. Check Team Load still resolves everyone.

---

## Execution order

1. Part 1 (code) → commit → **push** → container rebuilds
2. Confirm the startup log no longer mentions seeding projects
3. `pg_dump`
4. Part 2 (delete) → verify → **restart container** → verify again
5. Part 3a (code: `SERVICE_HEAD` + script) → push
6. Part 3b–3d (data) → verify the wizard
