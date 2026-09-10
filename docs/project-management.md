# Project Management module

The module is built around the five problems stated for the panel business. Each
section below is one of them, and how it is handled.

## 1. Multiple hierarchies, multiple managers

Higher management defines a project; work is distributed to junior and senior engineers
who often report to a different manager than the person running the project.

The platform separates **who runs the work** from **who manages the person**:

- `Project.managerId` / `sponsorId` — accountability for delivery.
- `User.managerId` — the reporting line, used for escalation.
- `Department` is a tree, so "Head of Engineering" covers Electrical, Mechanical and
  Automation beneath it without a grant per department.
- Every grant carries a scope, so a project manager's authority stops at their project
  while a department head's spans their subtree. See [rbac.md](./rbac.md).

Creating a project also creates the manager's membership and a **project-scoped**
`PROJECT_MANAGER` grant in the same transaction — one action, complete authority on
exactly one project.

## 2. Ad-hoc work, and knowing who is free

**Resource board** (`/pm/resources`) and **Assign ad-hoc work** (`/pm/adhoc`).

For each person, over a window (two weeks by default):

```
capacity  = working days in window (Sundays excluded) − approved leave days
            × their daily capacity hours
committed = Σ over open assignments of  remaining effort × (days in window / task days)
free      = capacity − committed
```

Remaining effort is `allocatedHours × (1 − percentComplete/100)`, so a task that is 80%
done stops consuming a full slot. Work whose planned end has already passed is loaded
**entirely** onto the current window — overdue work does not quietly disappear from
somebody's load.

Candidates for a specific piece of work are then ranked:

```
score = 60 × capacity fit + 30 × skill match + 10 × grade fit
```

Capacity dominates, because the point is to find someone who can actually start. Skill
fit stops work landing on someone who needs a week to ramp up. The small grade term
keeps critical work off trainees without burying seniors in routine work. Each candidate
comes with its reasons ("55.8h free, needs 8h", "Missing: PLC", "2 overdue tasks") so
the manager can disagree with the ranking on informed grounds.

Ad-hoc tasks are typed `ADHOC` and still belong to a project, so unplanned effort stays
visible in project costing instead of vanishing.

## 3. Dependencies

`pm_task_dependencies` carries all four precedence types with lead/lag in working days:

| Type | Meaning |
|------|---------|
| `FINISH_TO_START` | The default: the predecessor must finish first |
| `START_TO_START` | Can run in parallel once the predecessor has started |
| `FINISH_TO_FINISH` | Can be worked, cannot be closed before the predecessor |
| `START_TO_FINISH` | Rare, but expressible |

Modelling only finish-to-start would idle engineers who could legitimately work in
parallel — hence all four.

What the engine does with them (`domain/scheduling.ts`, unit-tested):

- **Cycle detection** on every insert, before the write. A circular chain is rejected
  with the path that would form: `PRJ-2026-001-T005 → …-T007 → …-T005`.
- **Blocking** is derived, not typed in. `recomputeTaskDerivedState` recalculates
  `BLOCKED`/`TODO` after any structural change, so the flag cannot drift out of sync
  with the graph. A task cannot be started while a start-blocking dependency is open,
  and cannot be completed while a finish-blocking one is.
- **Critical path.** Forward and backward CPM passes give every task its float; zero
  float is flagged on the WBS. Without it every red task looks equally urgent.
- **Downstream awareness.** Completing a task notifies whoever was waiting on it.

## 4. Handover to a peer

The case: an engineer is halfway through and cannot finish — site visit, illness, a
hotter priority. They pass the **remaining** work to a peer.

`/pm/tasks/<id>` → *Hand remaining work to a peer* → `/pm/handovers`:

1. The remaining percentage and hours are computed from actual progress, not guessed.
2. Peers are offered **ranked by current load and skill fit**, so work does not simply
   go to whoever sits nearest.
3. The receiving engineer accepts or declines. Nothing moves until they do; if they
   decline, the task stays where it was and the manager is told.
4. On acceptance: the outgoing assignment becomes `HANDED_OVER` (kept, with the hours
   already spent attributed to that engineer), a new `ACTIVE` assignment is created for
   the remaining hours, and project membership is granted if needed.
5. The project manager is notified at every step.

A manager holding `pm.handover.override` can force one through when the receiver is
unreachable and the work cannot wait; the audit entry records that it was decided on
their behalf.

This is deliberately different from **reassignment** (`Assign / reassign` on the task),
which is top-down, immediate, and does not ask.

## 5. Punching in progress

`/pm/tasks/<id>` → *Punch in progress*: completion %, hours since the last update, what
moved, and optionally a blocker.

- The log is **append-only**; `percentComplete` and `actualHours` are projections of it.
- Progress cannot go backwards — that would silently erase the record. If work was
  undone, the note and a blocker say so.
- Reaching 100% moves the task to `IN_REVIEW`, not `COMPLETED`; a reviewer closes it.
- A **blocker notifies the project manager and the sponsor immediately** and puts the
  task on the management dashboard's blocker list. This is the one thing management must
  never learn about late.
- Progress on a phase is rolled up from its children **weighted by estimated hours**, so
  "50% done" cannot mean "the two easy subtasks are finished".
- Logging is not allowed on a parent task — it belongs on the leaf that did the work.

## Screens

| Route | For |
|-------|-----|
| `/dashboard` | Portfolio health (management) or personal queue (engineer) |
| `/pm/projects` | Projects in scope |
| `/pm/projects/new` | Define a project |
| `/pm/projects/<id>` | WBS, schedule, critical path, team |
| `/pm/my-work` | An engineer's queue, with what each task waits on |
| `/pm/tasks/<id>` | One task: progress, handover, dependencies, discussion |
| `/pm/resources` | Who is free, who is overloaded |
| `/pm/adhoc` | Raise urgent work and assign it to the best-placed person |
| `/pm/handovers` | Handover inbox and oversight |

## Integration seams already in place

`pm.project.created`, `pm.task.created`, `pm.task.assigned`, `pm.task.status_changed`,
`pm.task.completed`, `pm.task.blocked`, `pm.progress.logged`, `pm.handover.requested`,
`pm.handover.accepted`, `pm.handover.rejected`.

And in the other direction, already modelled: approved leave (`core_leaves`) reduces
availability today and becomes HRMS-owned later; `Project.orderValue` / `poNumber` move
to ERP; `Task.estimatedHours` vs `actualHours` is the input job costing will need.
