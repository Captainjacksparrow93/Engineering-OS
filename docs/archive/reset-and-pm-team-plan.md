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

### Notifications are not cleared by the cascade

`Notification` stores a `link` string, not a foreign key, so every existing notification
survives the wipe and points at a deleted project or task — a 404 for each. Users currently
have dozens.

**Decide and state which:** clear them in the same run
(`prisma.notification.deleteMany({ where: { link: { not: null } } })`), or leave them as dead
history. Clearing is the tidier default for a clean slate; say so in the script output
either way.

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

### `SERVICE_HEAD` must include `pm.oversight` — CORRECTION

An earlier draft of this plan said to leave `pm.oversight` **off** `SERVICE_HEAD`. **That was
wrong and must be fixed.** Add it to the permission list.

**Why it is needed.** `reassignTeamFor` grants unrestricted assignment only to
`pm.oversight` holders; everyone else is confined to their own squad. Without it, Rajani's
"team" resolves to just herself, so **every assignment she attempts is rejected as outside
her team** — and she would not qualify as a head approver in the two-stage handover flow
(`docs/archive/handover-rework-plan.md` Phase 3), nor receive oversight notifications. That directly
contradicts the confirmed rule *"head can reassign without approval"*.

**Why it is safe.** `teamRootOf` walks **up a person's own manager chain** and stops at the
first manager holding oversight. A second oversight holder only re-cuts squads if they sit
**inside** that chain. Under §3b Rajani manages **nobody** — the four squad leads report to
Dilip — so she is in no one's chain and no squad boundary moves.

> **The rule to preserve:** exactly **one** oversight holder may sit above the four squad
> leads in the reporting line, and that is **Dilip Asediya**. Oversight held by someone
> outside the chain (Rajani, the Directors) is harmless. If Rajani is ever made the manager
> of a squad lead, this breaks — revisit it then.

After adding it, re-run `grant-service-head.ts` so the existing role row picks up the new
permission (role seeding is create-only and will not add it retroactively).

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
the `SERVICE_HEAD` role instead. Per §4 of `docs/archive/org-and-lifecycle-redesign.md`.

### 3c. Designation

**Harmitsinh Udavat (ACS-0080):** `Jr. Engineer` → **`Service Engineer`**.

He must stay in the engineer pool. The query needs a `SENIOR_ENGINEER`/`JUNIOR_ENGINEER`
role and excludes designations containing "Manager"/"Asst" — "Service Engineer" trips
neither, and his role assignment is unchanged. **Re-check the wizard dropdown after the
change.**

### 3e. Grant `ASST_MANAGER` to the two Assistant Managers — CONFIRMED

**Found during verification after §3b ran:** both Asst Managers still hold only
`SENIOR_ENGINEER`.

```
ACS-0070  Dhrupin Vaghasiya   SENIOR_ENGINEER
ACS-0075  Munaf Multani       SENIOR_ENGINEER
ACS-0063  Parth Nagar         PM_BASE, PROJECT_MANAGER
ACS-0074  Paras Prajapati     PM_BASE, PROJECT_MANAGER
```

`getPMTeamData` selects users holding `PROJECT_MANAGER` **or** `ASST_MANAGER`, so the wizard
currently offers **2 project owners, not the 4 required**. Their squads are already correct
— squad membership comes from the manager chain, not the role — so this is purely a grant.

**User confirmed: `ASST_MANAGER` carries PM-equivalent rights** (create and edit projects,
assign tasks, approve progress).

**Write a one-off script under `prisma/scripts/`** — idempotent, matching by `employeeCode`,
printing every change:

1. **Grant `ASST_MANAGER`** to `ACS-0070` and `ACS-0075` at **`GLOBAL`** scope, matching how
   `PROJECT_MANAGER` is granted to Parth and Paras today.
2. **Remove their `SENIOR_ENGINEER` assignment.** They are squad leads, not assignable
   engineers. Parth and Paras hold no engineer role, and these two should match. Without
   this they appear **both** as a squad-lead group heading *and* inside another group in the
   grouped picker (`docs/archive/handover-rework-plan.md` Phase 5), and remain selectable as
   assignees on the project page — whose `colleagues` query filters on role only, with no
   designation exclusion.

**Do this now, while the database holds zero tasks and zero assignments** (§Part 2). Removing
an engineer role from someone holding live work would be far riskier later.

Do **not** add `PM_BASE`: `ASST_MANAGER` already includes `pm.resource.read`,
`pm.report.read` and `pm.handover.decide`, so it would be redundant.

> **Scope caveat:** `GLOBAL` is used for consistency with the existing PMs, which is exactly
> the flaw `docs/archive/rbac-audit.md` Finding 1 raises — every PM currently has manager rights on
> every project. Do not fix that here for two people; fix all four together in Task 7.

**Verify:** the project wizard offers **four** owners (Parth, Paras, Munaf, Dhrupin); each
one's engineer list is exactly their own reports; and Munaf and Dhrupin no longer appear in
any engineer or assignee dropdown.

### 3f. Krupesh Solanki must leave the PM team

**The user supplied the authoritative Project & Service roster (screenshots, 24 Sep).
Krupesh Bhikhbhai Solanki (`ACS-0081`) is not on it.** The four squads are exactly:

| Lead | Members |
|---|---|
| Parth Nagar | Shivam Prajapati, Sahil Patil, Abbasali Sunasara, Harmitsinh Udavat — **4** |
| Munaf Multani | Het Patel, Agastya Patel, Dixit Prajapati, Hitesh Malviya, Ashish Hajare — **5** |
| Dhrupin Vaghasiya | Yogi Patel, Jigar Nayak, Tejas Rokade — **3** |
| Paras Prajapati | Harsh Suthar, Ridhhi Patel, Anurag Vaishnav, Chirag Prajapati, **Akash Vasava** — **5** |

Krupesh currently sits in TECH as a Sr. Engineer reporting to Paras, which makes him
assignable as one of Paras's engineers — wrong. Note Paras's count of 5 looks right today
only because Krupesh's presence masks Akash's absence; add Akash without moving Krupesh and
Paras has **6**.

He is now a **leaf** — §3b moved Ashish Hajare and Tejas Rokade off him, so nobody reports to
him. Moving him is therefore clean and low risk.

**Where he goes.** The chart puts him in **QC under Prakash Darji** — but Prakash does not
exist in the app (he is on the parked new-joiners list). The app's QC department is headed by
**Amey Kulkarni (`ACS-0057`, Testing & QC Manager)**.

**DECIDED — move him to QC under Amey Kulkarni:**

| Field | From | To |
|---|---|---|
| Department | Technical & Project Management (`TECH`) | **Quality Control & Testing** |
| Manager | Paras Prajapati (`ACS-0074`) | **Amey Kulkarni (`ACS-0057`)** |

Designation stays `Sr. Engineer` — the chart says Junior Engineer, but that belongs to the
parked org import, and demoting someone is not a change to make as a side effect of a squad
fix. Re-point him to Prakash Darji when that import happens.

Add this to the §3b script, keyed by `employeeCode`, idempotent, printing the change. Look
the department up by **code**, not name, and fail loudly if it is missing rather than
silently leaving him in TECH.

Leave his `SENIOR_ENGINEER` role alone — he is still an engineer, just not one of Paras's.

**Verify:** Paras's squad is exactly the five above, and Krupesh appears in no PM squad.

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
