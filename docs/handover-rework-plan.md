# Handover & assignment rework — implementation plan

Implements the movement-of-work rules in `docs/org-and-lifecycle-redesign.md` §4b.
**All rules there are confirmed by the user. Read §4b first; this document is the how.**

> **This supersedes Task 9** in `docs/follow-up-plan-gemini.md`. Task 9's "direct reassign
> for managers" is Phase 2 below. Do not implement Task 9 separately — but **do** apply its
> Fix 1 (stop discarding server-action results) as Phase 0, because without it every failure
> below is invisible.

## The rule in one line

**Inside your own squad you act directly. Across squads you need PM2 *and* a head. Heads and
Directors never ask.**

---

## Before you start — the ground has changed under this plan

All of the following landed on production **after** this plan was written. It is now the
state you are building against.

**The database is empty.** Zero projects, zero tasks, zero clients. **You cannot verify
anything without first creating test data** — make a project through the wizard (add a
client, pick a squad lead, PLC × 2, assign engineers) before testing any phase. Do not
mistake "no error" for "it works" when there is nothing to act on.

**Squads are now correct and are the fixtures for every test:**

| Lead | Role | Squad |
|---|---|---|
| Parth Nagar (`ACS-0063`) | `PROJECT_MANAGER` | Shivam, Sahil, Abbasali, Harmitsinh — 4 |
| Paras Prajapati (`ACS-0074`) | `PROJECT_MANAGER` | Harsh, Ridhhi, Anurag, Chirag (+ Akash when created) |
| Munaf Multani (`ACS-0075`) | `ASST_MANAGER` | Het, Agastya, Dixit, Hitesh, Ashish — 5 |
| Dhrupin Vaghasiya (`ACS-0070`) | `ASST_MANAGER` | Yogi, Jigar, Tejas — 3 |

All four report to **Dilip Asediya** (`TECHNICAL_HEAD`), who is the only `pm.oversight`
holder in the reporting line — that is what makes each of them a squad root.

**`SERVICE_HEAD` exists** (Rajani Nagar, `ACS-0062`) and **holds `pm.oversight`**, so she is
a head for every rule here: acts directly, and is a valid stage-2 approver. She manages
nobody, which is why granting her oversight did not disturb the squads.

**Munaf and Dhrupin no longer hold `SENIOR_ENGINEER`.** They are squad leads, not assignable
engineers, so they will not appear in the `colleagues` list. In Phase 5 they appear as
**group headings only** — never as a selectable member of anyone's group.

**Akash Vasava is not created yet** (a human adds him via the People screen). Paras's squad
is 4 until then; do not treat that as a bug.

---

## Phase 0 — make failures visible (do this first, it is tiny)

`src/components/assignee-cell.tsx` discards the result of `assignTaskAction`, so every
rejection looks like a no-op. Capture it, toast the error, keep the editor open on failure.
Detail in Task 9, Fix 1.

**Without this, nothing in the phases below is debuggable.**

---

## Phase 1 — schema

`TaskHandover` and `ProjectHandover` both gain a second approval stage.

```prisma
enum HandoverStatus {
  PENDING                  // waiting on the receiving manager (PM2)
  AWAITING_HEAD_APPROVAL   // NEW - PM2 approved, a head must still sign off
  ACCEPTED                 // both approvals in; work has moved
  DECLINED
  WITHDRAWN
  REJECTED
  CANCELLED
}
```

On **both** models add:

```prisma
headApprovedById String?
headApprovedAt   DateTime?
headDecisionNote String?
```

with the `User` relation for `headApprovedById` (`onDelete: SetNull`) and back-relations.

**Migration:** additive — one enum value, three nullable columns per table. Safe under
`--single-transaction` on PostgreSQL 16 (the new enum value is not *used* in the same
transaction). Follow `docs/deployment-runbook.md`: migrations are applied by hand with
`psql` **before** the code ships.

---

## Phase 2 — assignment becomes a branch, not a rejection

`assignTask` in `services/task.service.ts` currently hard-rejects an out-of-squad target:

```ts
if (team && !team.has(assignee.id)) throw new DomainError(OUTSIDE_TEAM_MESSAGE...)
```

Replace that with a branch:

| Caller | Target | Behaviour |
|---|---|---|
| holds `pm.oversight` (Head, Director) | anyone | **assign directly**, no request |
| PM / Asst PM | **own** squad | **assign directly**, notify the engineer |
| PM / Asst PM | **another** squad | **create a `TaskHandover`**, status `PENDING`, do **not** move the work |
| Engineer | own squad peer | today's request flow, unchanged |
| Engineer | another squad | **still blocked** — engineers may not cross squads |

Direct assignment replaces the existing owner: set the old `TaskAssignment` to
`status: 'RELEASED'` with `releasedAt`, create the new `ACTIVE` one, in one transaction.
**Never delete the old row** — it carries the hours already burned. Audit as
`task.reassigned` with from/to ids, and notify both engineers.

Squad membership comes from `reassignTeamFor(principal)` → `teamOf` → `teamMemberIds`, which
already returns `null` (unrestricted) for oversight holders. **Do not reimplement it.**

---

## Phase 3 — two-stage approval

A cross-squad request needs **both** PM2 and a head. Either may reject, and a rejection at
any stage ends it.

```
PM1 raises  ──▶ PENDING
                  │ PM2 approves
                  ▼
        AWAITING_HEAD_APPROVAL
                  │ Technical or Service Head approves
                  ▼
               ACCEPTED  ──▶ work moves here, and only here
```

**The work must not move on PM2's approval.** Assignments change only on the head's final
approval. If work moved earlier, a head's rejection would have to unwind a live assignment
mid-project.

- **PM2 approving** sets `AWAITING_HEAD_APPROVAL`, records `decidedById`/`decidedAt`, and
  notifies both heads and the Director.
- **A head approving** sets `ACCEPTED`, records `headApprovedById`/`headApprovedAt`, applies
  the assignment change, and notifies PM1, PM2 and both engineers.
- **Either rejecting** ends it (`REJECTED` / `DECLINED`) with the note, notifying the
  requester.

Who may act at each stage:

- stage 1 — the receiving squad's lead (PM2), **or** anyone with `pm.oversight`
- stage 2 — `TECHNICAL_HEAD` or `SERVICE_HEAD` (`pm.oversight`), **or** Director

A Director may approve either stage outright, or skip the request entirely by assigning
directly.

**Self-approval guard:** the same person must not satisfy both stages. If PM2 also holds a
head role, require a different user for stage 2, or make it explicit in the audit that one
person did both.

---

## Phase 4 — the lists must show the new state

`AWAITING_HEAD_APPROVAL` rows are **not** terminal and must appear where they can be acted
on, or handovers stall invisibly:

- `/pm/approvals` — heads and Director see rows awaiting head approval
- `/pm/handovers` (Requests) — PM1 sees "waiting on head", PM2 sees what they approved
- the dashboard's waiting-on-decisions count

`listHandovers` already uses `projectVisibilityWhere` (Part B2), which resolves to the whole
company for `pm.project.read.all` holders, so **the Director sees everything** — but the
queries filter `status: 'PENDING'` and must be widened to include the new status.

---

## Phase 5 — grouped engineer picker

A PM may target any engineer, so the list is not squad-filtered — and already is not:
`colleagues` on the project page queries every active `SENIOR_ENGINEER` / `JUNIOR_ENGINEER` /
`PM_BASE` in the company.

Group it with `<optgroup>` so headings cannot be selected:

```
Parth Nagar                     ← own squad first
   Shivam Prajapati
   …
Paras Prajapati (needs approval)
   Harsh Suthar
   …
```

- group by the engineer's squad lead — `teamRootOf` already computes this
- **the current user's own squad first**, it is the no-approval path
- suffix other groups `(needs approval)` so the consequence is visible before clicking
- for a Head or Director every group is direct, so **no suffix** for them

Applies to `assignee-cell.tsx` and the handover forms.

---

## Phase 6 — visibility after a handover

**Get this right or it either leaks work or hides people.**

**Cross-squad *task* handover, once accepted:** add a `ProjectMember` row for the receiving
engineer on **that project only**. PM2 gains sight of that engineer's work there and nothing
else — not the project, not PM1's other projects. **Do not** grant PM2 a project-scoped role.

**Whole-project transfer:** the project shows **both squads' engineers**. Do **not** strip
PM1's engineers — their assignments and logged hours stay, and the team panel lists everyone
holding work on the project regardless of squad.

---

## Phase 7 — role gates

- **Engineers: tasks only.** Hide the project-handover control and reject it server-side.
- **PM / Asst PM / Head / Director: task or project.**

UI must hide what a role cannot do *and* the service must reject it — never one alone.

---

## Verify

Run as each role; the seeded squads are in `docs/org-and-lifecycle-redesign.md` §3b.

1. **PM1 → own engineer**: assigns immediately, no request, engineer notified.
2. **PM1 → PM2's engineer**: no immediate change; request appears for PM2, heads and
   Director. PM2 approves → still not moved, now `AWAITING_HEAD_APPROVAL`. Head approves →
   work moves, everyone notified.
3. **PM2 rejects**: ends there, PM1 told, no head involved.
4. **Head rejects after PM2 approved**: ends, nothing moved, assignment untouched.
5. **Head assigns across squads**: immediate, no request.
6. **Director**: same, and sees every pending and awaiting-head request company-wide.
7. **Engineer → same-squad peer**: unchanged. **→ other squad**: blocked with a visible
   message.
8. **Engineer**: no project-handover control; calling the endpoint directly is rejected.
9. **After a cross-squad task handover**: PM2 sees that engineer on that project only, and
   still cannot see PM1's other projects.
10. **After a project transfer**: both squads' engineers are listed on the project.

`npm run typecheck && npm run test && npm run build` must pass. Commit, **do not push** —
the user decides when it ships, and Phase 1 needs its migration applied first.
