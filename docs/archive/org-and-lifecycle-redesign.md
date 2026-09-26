# Org hierarchy & project lifecycle — redesign

Triggered by `ACS Organisation chart - 24.9.26.xlsx`. The chart changes who reports to whom,
introduces a role the app has no concept of, and confirms that Assistant Managers run their
own squads. That ripples into how projects are owned, assigned and approved.

**This is a design document. It records the current state, what the chart changes, and the
decisions needed. Nothing here is ready to implement until the decisions at the end are
answered.**

---

## 1. What the chart says, versus what the app believes

### Headcount

| | Chart | App (live) |
|---|---|---|
| People | 82 | 94 (ACS company) |

**The gap is NOT 12 leavers.** Verified by diffing:

- **All three Directors** (Satish Nagar, Shaktikumar Vasava, Bhavesh Prajapati) appear in the
  chart only as *line managers*, never as rows.
- **~15 support staff** — security, canteen, cleaning, office staff — are simply not on an
  org chart.
- **Spelling variants of the same person**: `Surajkumar JaysukhbhaiChaniyara` (chart, missing
  space) vs `Surajkumar Jaysukhbhai Chaniyara` (app); `Anilkumar Ajitsinh Dabhi` vs
  `Anilkumar Arjitsinh Dabhi`; `Bharatkumar Bhupendrasinh Dabhi` vs `Bharat Dabhi`.

> **Rule for any future import: match on `employeeCode`, never on name, and never
> auto-deactivate. Absence from a chart is not evidence someone left.**

### Genuinely new people

Ten names appear in the chart with no match in the app. After removing the spelling variants
above, the real candidates are: **Akash Vasava** (Jr. Engineer, Project & Service),
**Ashish Kantibhai Kachhatiya** (Sr. Field Sales Engineer), **Prakash Vishnubhai Darji**
(Sr. Testing Cum QC Engineer, now QC's line manager), plus wire-men and panel-sticker
operators in Production and QC. **Each needs confirming individually.**

### Departments are a different taxonomy, not renames

| Chart | App |
|---|---|
| Project & Service | Technical & Project Management (`TECH`, 23 people) |
| QC | Quality Control & Testing |
| Production | Wiring & Cable Harness + Assembly + Logistics |
| Stores | Stores & Inventory |

The chart's **"Project & Service"** merges project delivery and service. The app splits
Production into three.

---

## 2. The three structural changes that actually affect behaviour

### 2a. Dual reporting — the schema cannot express it

Both Project Managers and both Assistant Managers report to **"Dlip / Rajani"** — two people.
`User.managerId` holds exactly one.

This is not cosmetic. `getDescendantUserIds` walks `managerId` to build a PM's squad, and
that squad decides who can be assigned to a panel and who auto-assign may pick. Get the
chain wrong and the wizard offers the wrong engineers.

### 2b. Head of Service is a role the app does not have

**Rajani Bhurabhai Nagar — Head of Service**, reporting to the Director alongside Dilip
Asediya (Head of Technical). There is no `SERVICE_HEAD` role, and nothing in the permission
catalogue distinguishes service from project work.

**This matters most for Site Commissioning.** Commissioning *is* service work — it happens
after delivery, on the customer's site. Today `pm.commissioning.manage` and `.approve` are
granted to `TECHNICAL_HEAD` and `DIRECTOR`. If service is Rajani's function, commissioning
plausibly belongs to **Head of Service**, not Head of Technical.

### 2c. Assistant Managers run squads — confirmed

- **Munaf Multani** (Asst. Manager) → Het Patel, Agastya Patel, Dixit Prajapati,
  Hitesh Malviya, Ashish Hajare
- **Dhrupin Vaghasiya** (Asst. Manager) → Yogi Patel, Jigar Nayak, Tejas Rokade
- **Parth Nagar** (PM) → Shivam Prajapati, Sahil Patil, Abbasali Sunasara, Harmitsinh Udavat
- **Paras Prajapati** (PM) → Harsh Suthar, Ridhhi Patel, Anurag Vaishnav, Chirag Prajapati,
  Akash Vasava

Four squad leads, not two. We added `ASST_MANAGER` to the project-owner dropdown on a hunch
earlier; the chart confirms it was right.

Note **Harmitsinh Udavat is a "Service Engineer"** sitting inside a PM's squad — service and
project staff are mixed in one department.

---

## 3. The lifecycle as it stands today

For deciding against reality rather than memory:

| Stage | Who acts | Mechanism |
|---|---|---|
| Create project | Director, Technical Head, PM, Asst Manager (`pm.project.create`) | Wizard: work order, client, panels, one engineer per panel |
| Assign a panel | Creator, at wizard time | One engineer per panel, enforced both sides |
| Reassign a step | Manager-level direct; engineers request-and-accept | `assignTask` / `TaskHandover` *(Task 9 pending)* |
| Report progress | Engineer | `TaskProgressLog`, append-only |
| Approve a step | `pm.progress.review` — Director, Head, PM, Asst Manager | Task → `COMPLETED` |
| Raise a problem | Engineer | `blocker` on a progress log |
| Hand over work | Engineer or PM | Task, panel or whole project |
| Hold | PM and above, reason required | Freezes tasks out of My Work and Team Load |
| Complete | PM | All leaf steps closed |
| Commission | `TECHNICAL_HEAD` / `DIRECTOR` | Assign engineers from any squad, daily logs, head approves |
| Close | `pm.commissioning.manage` | → `CLOSED` |

Squad membership — who a PM may assign — comes entirely from the `managerId` chain.

---

## 4. Proposed model

### Hierarchy

**Keep one `managerId`, and make it the *project* line.** For everyone in Project & Service
that is their squad lead (Parth, Paras, Munaf, Dhrupin), and the four leads report to
**Dilip Asediya (Head of Technical)**.

**Express Rajani's authority as a role, not a reporting line.** Add `SERVICE_HEAD` with
company-wide oversight of service work. This keeps `getDescendantUserIds` — and therefore
squad selection — a clean tree, while still giving Rajani real rights.

Rationale: `managerId` is load-bearing for assignment logic. Encoding a second reporting line
into it breaks squads. A second column (`serviceManagerId`) would mean touching every query
that walks the tree, for one org quirk. A role is cheaper and truer: Rajani's authority is
functional, not line-management of day-to-day project work.

### Departments

**Keep the app's department codes** — `TECH` is wired into
`TECHNICAL_DEPARTMENT_CODES`, the PM query, auto-assign and RBAC scopes. Change the
**display names** to match the chart's wording where they differ. Map chart
"Project & Service" → `TECH`.

Do not restructure Production into the chart's single department without a separate
decision; the app's split into Wiring / Assembly / Logistics may be more useful
operationally.

### Roles after the change

| Role | Held by | Can |
|---|---|---|
| `DIRECTOR` | Shaktikumar Vasava, Satish Nagar, Bhavesh Prajapati | Everything, company-wide |
| `TECHNICAL_HEAD` | Dilip Asediya | Projects, checklists, approvals, oversight |
| `SERVICE_HEAD` **(new)** | Rajani Nagar | Commissioning: assign, approve logs, close |
| `PROJECT_MANAGER` | Parth Nagar, Paras Prajapati | Own projects, assign own squad, approve |
| `ASST_MANAGER` | Munaf Multani, Dhrupin Vaghasiya | Same as PM |
| `SENIOR_ENGINEER` / `JUNIOR_ENGINEER` | squad members | Execute, log, request reassignment |

---

## 4b. The movement-of-work rules — CONFIRMED by the user

One principle governs everything below:

> **Inside your own squad you act directly. Across squads you must ask. Heads and Directors
> never have to ask.**

### What each role may move

| Role | Can hand over |
|---|---|
| Engineer | **a single task**, or **a whole panel's remaining work** — not a project |
| PM / Asst PM | task, panel, or **whole project** |
| Head, Director | task, panel, or **whole project** |

"A panel's remaining work" is the existing `requestPanelHandover`: an engineer who has
finished, say, 5 of 13 steps passes the remaining 8 to someone else in one action. Engineers
rely on it — it is not being taken away. The only thing an engineer may not move is a whole
project.

### The matrix

| Who | Moving what | To where | What happens |
|---|---|---|---|
| Engineer | own task | peer in **same** squad | request → peer accepts |
| Engineer | own task | engineer in **another** squad | **blocked** |
| PM / Asst PM | task or panel | engineer in **own** squad | **direct. No request — the engineer is notified** |
| PM / Asst PM | task or panel | engineer in **another** squad | request → **PM2 approves** **and** **head approves** |
| PM / Asst PM | whole project | another PM | request → **PM2 approves** **and** **head approves** |
| Technical / Service Head | anything | anyone | **direct, no request** |
| Director | anything | anyone | **direct, no request** |

"Head" means Technical Head **or** Service Head. **Both PM2 and a head must approve** —
one is not enough.

**The Director is notified of every cross-squad request** and sees them all, but does **not**
need to approve; they can simply do the move directly instead.

### The engineer picker — group by PM

A PM may hand a task to **any engineer in the company**, so the picker is not filtered by
squad. It already is not: `colleagues` on the project page queries every active
`SENIOR_ENGINEER` / `JUNIOR_ENGINEER` / `PM_BASE` in the company, flat and alphabetical.

**Change it to group by squad lead:**

```
Parth Nagar                 ← squad lead, bold, not selectable
   Shivam Prajapati
   Sahil Patil
   Abbasali Sunasara
   Harmitsinh Udavat
Paras Prajapati             ← bold
   Harsh Suthar
   Ridhhi Patel
   ...
```

Use `<optgroup label="…">` so the headings cannot be selected. Group by the engineer's squad
lead (their `managerId` chain up to the squad root — `teamRootOf` already computes this).
Put the current user's own squad **first**, since that is the no-approval path.

Ideally mark out-of-squad groups so the user knows the choice triggers an approval — a
suffix such as `(needs approval)` on the group label is enough.

### Visibility after a handover — important and easy to get wrong

**Cross-squad *task* handover:** PM2 gains sight of that engineer **within that one project
only**. It must not grant PM2 the project, nor visibility of PM1's other work. In practice:
add a `ProjectMember` row for the receiving engineer on that project and nothing more.

**Whole-project transfer:** the project then shows **engineers from both squads** — PM1's
people who are still mid-task on it, plus PM2's. Do not strip PM1's engineers on transfer;
their assignments and logged hours stay, and the team panel lists everyone with work on the
project regardless of which squad they belong to.

### What this changes in the code

`assignTask` currently **hard-rejects** an out-of-squad target:

```ts
if (team && !team.has(assignee.id)) throw new DomainError(OUTSIDE_TEAM_MESSAGE...)
```

That becomes the branch point: in-squad → assign directly and notify; out-of-squad → create
a handover request requiring two approvals instead of throwing.

### What already works

The squad boundary is built. `reassignTeamFor` returns `null` — unrestricted — for anyone
holding `pm.oversight` (Director, Technical Head), and otherwise `teamOf(...)`, which walks
up to the nearest oversight-holder and returns everyone beneath. PMs and Asst Managers do
**not** hold `pm.oversight`, so they are correctly confined to their own squad, and engineers
to theirs.

So rules 1, 2 and 6 are already enforced. Rule 3 is **Task 9**, already planned.

### What does NOT exist — two-stage approval

Rules 4 and 5 need a handover to be accepted by the receiving manager **and then** approved
by a head. Today a handover has one decision and one decider:

```prisma
enum HandoverStatus { PENDING  ACCEPTED  DECLINED  WITHDRAWN  REJECTED  CANCELLED }
```

`decidedById` / `decidedAt` / `decisionNote` — a single slot. There is no state meaning
"the receiving manager said yes, now a head must sign off".

**Proposed schema change**, applying to both `TaskHandover` and `ProjectHandover`:

```prisma
enum HandoverStatus {
  PENDING                  // waiting on the receiving manager (PM2)
  AWAITING_HEAD_APPROVAL   // new - PM2 approved, a head must still sign off
  ACCEPTED                 // both approvals in, work has moved
  DECLINED
  WITHDRAWN
  REJECTED
  CANCELLED
}
```

plus `headApprovedById`, `headApprovedAt`, `headDecisionNote` on both models, so PM2's
decision and the head's are recorded separately and the audit trail shows both.

**Either approver can reject**, and a rejection at any stage ends it — PM2 declining means
no head ever sees it.

**Routing rule when a handover is raised:**

- target is inside the requester's own squad → today's single-stage flow, unchanged
- target is outside it → on the peer's acceptance the status becomes
  `AWAITING_HEAD_APPROVAL`, **the work does not move yet**, and both heads plus the Director
  are notified
- a head or director raising it → applied immediately, no request record needed

**The work must not move until the head approves.** Assignments change only on the final
approval, never on the intermediate accept — otherwise a head's rejection would have to
unwind an assignment that is already live.

### Director visibility

The Director must **see every request in the company**, not only those addressed to them.
Part B2 already changed the oversight queries to use `projectVisibilityWhere`, which resolves
to the whole company for anyone holding `pm.project.read.all`. That covers it — but the new
`AWAITING_HEAD_APPROVAL` rows must appear in those lists too, or a handover can stall
invisibly waiting on a head.

### Project creation

The owner dropdown must offer **all four squad leads** — Parth Nagar and Paras Prajapati
(Project Managers) plus Munaf Multani and Dhrupin Vaghasiya (Asst. Managers). `getPMTeamData`
already queries `PROJECT_MANAGER` **or** `ASST_MANAGER` in `TECH`, so this should work once
the role grants and `managerId` lines match section 4. **Verify all four appear and that each
one's squad is exactly their own reports.**

### Commissioning

**Head of Service can create commissioning — confirmed.** `SERVICE_HEAD` gets
`pm.commissioning.manage` and `pm.commissioning.approve`.

Still open: whether `TECHNICAL_HEAD` keeps them (Q1 below).

---

## 4c. Approval is broken — a step can await sign-off at 50%

**Reported live:** `WO 7001` step 1 shows **WAITING FOR APPROVAL** while its progress bar
reads **50%**. The reviewer is being asked to approve a step that says it is half done.

**Cause — two inconsistent routes into review:**

| Route | Sets status | Sets percent |
|---|---|---|
| `submitProgress` with `percentComplete >= 100` (`progress.service.ts:55`) | `IN_REVIEW` | 100 ✅ |
| **"Mark completed" button** (`task-controls.tsx:81`, `handleMarkCompleted`) | `IN_REVIEW` | **untouched** ❌ |

The button sets the status directly and never updates `percentComplete`, so a task submitted
at 50% sits in review claiming to be half finished. `approveTaskReview` then moves it
straight to `COMPLETED`, and the ledger never reconciles.

**Fix — pick one and apply it consistently:**

- **Recommended:** "Mark completed" should go through the same path as a progress
  submission — write a `TaskProgressLog` at 100% with a required note, which sets
  `IN_REVIEW` and `submittedAt` as a side effect. One route into review, and the reviewer
  always has a note explaining what was done.
- Weaker alternative: keep the direct status change but force `percentComplete = 100`
  alongside it. Cheaper, but the reviewer still gets no note.

`percentComplete` is a projection of the append-only progress ledger. Any route that changes
completion without writing a log breaks that contract — that is the underlying defect, not
just the mismatched number.

**Also reorder the reviewer's view.** The Approve / Send back actions sit top-right, while
**Progress history** — the engineer's own account of the work — renders further down, below
the progress form (`pm/tasks/[id]/page.tsx:205`). Someone approving sees no evidence without
scrolling. Surface the latest progress note next to the Approve button.

---

## 4d. Harmitsinh Udavat — service engineer in a PM squad

**Confirmed: he belongs in the PM engineer pool.** He already appears there (holds a
`JUNIOR_ENGINEER` role in `TECH`), so nothing is blocking assignment today. Two fields are
stale against the chart:

| | App | Chart |
|---|---|---|
| Designation | `Jr. Engineer` | **Service Engineer** |
| Manager | Chirag Prajapati | **Parth Nagar** |

The manager change moves him into Parth's squad, which under §4b changes who may hand work
to him without approval.

> **Risk when updating designations in bulk:** the engineer pool query requires a
> `SENIOR_ENGINEER`/`JUNIOR_ENGINEER` role **and** excludes any designation containing
> "Manager" or "Asst" (`automation-project.service.ts:135`). Importing chart designations
> blindly can silently drop people out of the assignment dropdown. Change designations
> deliberately and re-check the pool afterwards.

---

## 5. Decisions needed before implementing

1. ~~Commissioning ownership~~ — **DECIDED: both heads.** `TECHNICAL_HEAD` **keeps**
   `pm.commissioning.manage` + `.approve`, and `SERVICE_HEAD` gets the same. Director keeps
   them too.
2. **Is `SERVICE_HEAD` the right model for Rajani**, or must dual reporting be represented
   literally in the data?
3. **Who is the primary manager for the four squad leads** — Dilip, as proposed?
   **This one has teeth:** squads are derived by walking up to the nearest `pm.oversight`
   holder. If Rajani is given `pm.oversight` *and* becomes anyone's manager, the squad
   boundaries shift underneath the handover rules in 4b. Keep exactly one oversight-holder
   above the four squad leads.
4. **Which of the ten new names are genuinely new hires** to be created, versus spelling
   variants to be corrected on existing records?
5. **The ~15 support staff and 3 Directors absent from the chart — confirm they stay active.**
   (Strongly assumed yes.)
6. **Do the department names change to the chart's wording**, keeping the codes?
7. **Service work as a project type.** The chart has a Service Engineer inside a project
   squad and a Head of Service over it, but the app models only automation projects. Is
   service work meant to live in this system at all, and if so, as what?

Question 7 is the largest and may deserve its own round.

---

## 6. Sequencing, once decided

1. `SERVICE_HEAD` role + permission grants (one-off script — role seeding is create-only)
2. Correct the spelling variants; create genuinely new people
3. Re-point `managerId` for the four squad leads and their members
4. Department display names
5. Re-verify squad selection in the wizard: each of the four leads offers exactly their own
   people
6. Re-verify commissioning access under whatever Q1 decides

**Steps 2–4 are data changes against live production**, so they go through
`docs/archive/deployment-runbook.md` with a `pg_dump` first — not a seed rewrite. `prisma/seed.ts`
is create-only and will not update existing rows.
