# UI verification & the nested-form class of bug — plan

The handover rework is proven at the service layer: `prisma/scripts/verify-handover-rework.ts`
runs **51 assertions across every flow and every role** and passes. What is **not** verified is
the interface — rendering, which controls appear for which role, and whether errors reach the
user.

This plan covers that, plus a bug class found today that probably exists elsewhere.

---

## ⚠️ ALREADY DONE — do not redo or revert

**`6b610a0` — the Add-client dialog nested-form fix.**

The dialog rendered `<form onSubmit={handleCreateClient}>` **inside** the wizard's own
`<form onSubmit={handleSubmit}>`. Nested forms are invalid HTML, so the browser discards the
inner one: the handler never fired, the click bubbled to the outer form, and the browser did a
native `GET /pm/projects/new?`. **No request reached the server**, which is why nothing appeared
in any log and no error was shown — the dialog simply closed and no client was created. It
failed identically on production and locally.

It is now a `<div>`, with `type="button"` + `onClick` on Save and Enter-key handling on both
inputs. **Keep it that way** — a comment in the file explains why.

Also already done: the harness now deletes the notifications and domain events it generates
(they are not foreign-keyed to projects, so 347 orphans accumulated).

---

## Task A — find every other nested form (priority: high)

This bug was invisible for days: no error, no log, no failed request. **Anywhere the same
shape exists, the same silent failure exists.**

Search for `<form` in `src/app/**` and `src/components/**` and check whether any is rendered
inside another — directly or through a child component. Prime suspects are dialogs and inline
editors rendered inside a page-level form:

- the wizard (`automation-project-wizard.tsx`) — now has one form; confirm nothing else nested
- `confirm-dialog.tsx` and everything using it, including `project-danger-actions.tsx`
  (type-to-confirm has an input — check whether it sits in a form inside a form)
- `handover-form.tsx`, `handover-panel-button.tsx`, `hold-project-button.tsx`,
  `add-task-form.tsx`, `progress-form.tsx`, `comment-box.tsx`, `team-panel.tsx`

**How to detect it reliably rather than by eye:** run the dev server and load each screen.
React logs `In HTML, <form> cannot be a descendant of <form>` to the **server console** in dev.
That is how this one was found. Load every screen that has a dialog and read `preview_logs`.

Fix the same way: the inner element becomes a `<div>`, the submit becomes
`type="button"` + `onClick`, and Enter is handled explicitly if the field needs it.

---

## Task B — UI verification pass (priority: high)

Run the local environment (`docs/local-testing-plan.md`) against restored production data and
walk these. **Report what you see, with the dev server console alongside — a clean screen is
not proof when the failure mode is silence.**

### B1 — grouped engineer picker (Phase 5)

On a project page and in the wizard:

- groups are **squad leads in bold**, unselectable (`<optgroup>`), with their engineers under them
- **the current user's own squad appears first**
- other squads are marked **"(needs approval)"** — and are **not** so marked for a Head or Director
- Munaf and Dhrupin appear **only as group headings**, never as selectable engineers
  (they hold `ASST_MANAGER` and no longer hold `SENIOR_ENGINEER`)

### B2 — errors are visible (Phase 0)

Reassign a step and force a failure (e.g. pick someone already assigned).
**A message must appear.** Previously `assignee-cell.tsx` discarded the result and the editor
just closed. Confirm the editor stays open on failure.

### B3 — per-role controls

Sign in as each and record what is visible. The service layer is already proven; this is about
the UI hiding what a role cannot do.

| Role | Expect to see |
|---|---|
| Director (`ACS-0004`) | everything, including Cancel/Delete on a project |
| Technical Head (`ACS-0061`) | project create, approvals, commissioning |
| Service Head (`ACS-0062`) | commissioning, approvals — **verify the menus appear** |
| PM (`ACS-0074`) | own projects; **no** project create; **no** Delete |
| Asst Manager (`ACS-0075`) | same as PM |
| Engineer (`ACS-0077`) | My Work, task + panel handover; **no** project handover |

### B4 — approvals page

With a cross-squad handover sitting at `AWAITING_HEAD_APPROVAL`, confirm it is listed for the
Technical Head, the Service Head and the Director, and that approving from there works.
The harness proves `listHandovers` returns it; this checks it is rendered and actionable.

### B5 — the two flows end to end, through the UI

1. Create a client, then a project: PLC × 2, a different engineer per panel, confirm the
   double-booking guard still blocks the same engineer on both.
2. Move a step to another squad's engineer and walk it through PM2 → head, watching the status
   change and the work move only at the end.

---

## Task C — project delete should clear notifications (priority: low)

Deleting a project leaves its notifications behind pointing at dead links, because
`Notification.link` is a string with no foreign key. The wipe script and the test harness both
had to handle this explicitly.

Add the same cleanup to `deleteProject` in `project.service.ts`: inside the existing
transaction, before deleting, remove notifications whose `link` references that project or its
tasks. Low priority — the guard blocking deletion of projects with progress logs limits the
exposure.

---

## Definition of done

`npm run typecheck && npm run test && npm run build` pass, and
`npx tsx prisma/scripts/verify-handover-rework.ts` still reports **51 passed, 0 failed** —
it is the regression net for all of this.

Commit; **do not push.**
