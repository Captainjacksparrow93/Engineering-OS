# ERPNext spike — decide the architecture with evidence

> ## ⛔ PARKED — PLANNING ONLY. DO NOT IMPLEMENT.
>
> The user has put ERP on hold (Sept 2026). This document is a **record of thinking**, not
> a work order. **Do not start it, do not offer it as the next task, and do not install
> ERPNext anywhere.**
>
> The same applies to **HRMS and Gate Entry**. They appear in
> `src/core/modules/registry.ts` as `COMING_SOON` — that is the product roadmap, not a
> backlog. Note that HRMS in particular must not be built before the ERP question is
> settled: Frappe HR already covers attendance, leave and payroll, so building it natively
> risks being thrown away.
>
> Take work only from `docs/follow-up-plan-gemini.md` and
> `docs/site-commissioning-plan.md`. If both are empty, **ask rather than picking something
> from here.**

**Branch:** `feat/erp-spike`
**Type:** time-boxed investigation. **Throwaway code. Nothing here gets merged or shipped.**
**Time box:** 5 working days. Stop at the box even if unfinished and report what is known.

---

## Why this exists

The user wants ERPNext fully integrated, plus HRMS and Gate modules, in one system. There
are two ways to get there and they are not small variations of each other:

**Path A — keep Engineering OS on Next.js, integrate ERPNext over its API.**
Already drafted in `docs/erp-integration-plan.md`. Keeps the PM module as built. Costs a
permanent integration layer: webhooks, client mirroring, two identity systems, failure
handling. HRMS and Gate must still be built from scratch.

**Path B — rebuild Engineering OS as Frappe apps, inside ERPNext.**
One system, one database, one auth, one permission model. Frappe HR covers most of the
HRMS module already. Costs a rewrite of the PM module in Python/Frappe.

**What changed:** the 13 projects in production are **demo data, not live**. Nothing and
nobody depends on the current system, so "we already built it" is sunk cost, not a reason.
The decision is purely forward-looking, which makes Path B far more credible than it was.

**This spike produces the evidence to choose.** It is not a build. Do not start
implementing either path.

---

## Prerequisite — capacity. Do this first, stop if it fails.

ERPNext needs MariaDB, Redis, a scheduler, background workers and the web server —
roughly **4 GB RAM** for a usable instance, on top of Engineering OS.

On the VPS:

```bash
free -h && df -h && nproc
```

Record the numbers. Current container limits are app 768 MB, Postgres 512 MB.

**If there is not several GB of headroom, stop and report.** This becomes a hosting
decision before an engineering one, and it applies to *both* paths — ERPNext is being run
either way.

The spike itself runs **locally**, not on the VPS. Do not install ERPNext on the VPS.

---

## Task 1 — Stand up ERPNext locally

Use the official `frappe_docker` repository's single-server compose (`pwd.yml` or the
documented equivalent — check their current docs, do not follow blog posts). Get to a
working login and create one Company.

Record: how long it took, how much RAM it actually consumes at rest
(`docker stats`), and anything that did not work as documented.

**Do not touch `docker-compose.yml` or `docker-compose.local.yml`.** ERPNext gets its own
file so it cannot affect the existing stack.

---

## Task 2 — Prove the API (Path A's foundation)

Create a Customer and a Sales Order **through ERPNext's own UI**. Then, from a scratch
Node/TypeScript script, using an API key:

1. read them back via `/api/resource/Customer` and `/api/resource/Sales Order`
2. create a Customer purely over the API
3. submit a Sales Order over the API and confirm the expected side effects happen
   (document status, any ledger/stock effects)

**Record the actual JSON payloads** — how many fields are mandatory, what the errors look
like when one is missing. That field count is the real cost driver for Path A's UI work.

---

## Task 3 — Model the panel domain in Frappe (Path B's foundation) — THE CRITICAL TASK

This is the task the decision turns on. **Spend the most time here.**

Model, as Frappe DocTypes, one real project as Engineering OS does it today:

> Work Order `8871`, client Adani Ports (`ACS-0001`), project code `ACS-0001-0001`,
> scope PLC × 2 → **two panels running in parallel**, each with the **same 13 sequential
> checklist steps**, **one engineer per panel** (different engineers), each step carrying
> planned start/end and estimated hours.

Then answer, with working DocTypes, not opinion:

1. **Does the structure fit?** Project → Panel → 13 Steps. Child tables, linked DocTypes,
   or something else? How natural is it?
2. **Sequential dependencies within a panel** — step 5 blocked until step 4 finishes — and
   panels **independent of each other**. Can Frappe express that without custom code?
3. **Per-panel ownership.** One assignee owning all 13 steps of a panel.
4. **Handover of remaining work.** Engineer finishes 5 of 13, hands the remaining 8 to a
   peer, who accepts. Frappe has assignment and workflow features — do they cover this, or
   is it custom?
5. **The capacity engine.** Engineering OS computes free hours from open assignments minus
   approved leave over a window, prorated, with overdue work not diluted
   (`domain/availability.ts`). Is there anything in Frappe to build on, or is this a
   straight port to Python?
6. **Scoped permissions.** Engineering OS grants a role at GLOBAL / DEPARTMENT / PROJECT
   scope. How close is Frappe's permission model, and what is lost?

**Deliverable:** the DocType definitions (exported JSON is fine) plus an honest paragraph
per question. "It fits awkwardly" is a valid and useful answer — say so.

---

## Task 4 — Can the design system survive on Frappe?

Path B is only acceptable if the UI does not become stock Frappe. `docs/design-system.md`
requires warm cream canvas, no shadows, scarce orange, weight-400 display type, JetBrains
Mono for codes.

Frappe supports custom apps serving their own front end (their Helpdesk/CRM products work
this way). **Verify this from current Frappe documentation**, then build one throwaway page
— a list of projects — served from a Frappe app, styled with the Engineering OS tokens.

Answer: can we keep our design system on a Frappe backend, yes or no, and what does it cost
to set up? If the honest answer is "only by fighting the framework", Path B loses a lot of
its appeal.

---

## Task 5 — Does Frappe HR actually cover the HRMS module?

One of Path B's biggest claimed wins. Install Frappe HR and check against what the HRMS
module is meant to do (`src/core/modules/registry.ts`, `hrms` entry): employee master,
attendance, leave, payroll inputs, appraisals.

Answer plainly: what is covered out of the box, what needs configuration, what is missing
for an Indian manufacturing company. If it covers most of it, that is a strong argument for
Path B and should be stated as such.

---

## Task 6 — Gate module sanity check

Briefly: gate entry / visitor / material inward-outward. Nothing in ERPNext covers this
directly; it would be a custom DocType under Path B, or a custom module under Path A.
Estimate both in rough days. Keep this short — it is the smallest module and should not
consume spike time.

---

## The decision rubric

Report a recommendation with a reason against each line. Do not average these into a score
— say which ones dominated.

| Question | Favours A | Favours B |
|---|---|---|
| Does the panel domain fit Frappe DocTypes? (Task 3) | fits awkwardly / needs heavy custom code | fits naturally |
| Can we keep the design system? (Task 4) | no, or only by fighting it | yes, at reasonable cost |
| Does Frappe HR cover HRMS? (Task 5) | barely | mostly |
| Capacity engine and scoped RBAC | port looks expensive or lossy | ports cleanly |
| Server capacity | tight — two stacks is a real cost | fine either way |
| Python vs TypeScript for whoever maintains this | TS is a hard constraint | Python is acceptable |

**The last row is not a technical question and the spike cannot answer it — flag it for
the user rather than guessing.** Their whole toolchain is currently TypeScript.

**Tie-breaker:** if Tasks 3 and 4 both come back positive, Path B wins, because it removes
the integration layer permanently and delivers HRMS largely for free. If either comes back
negative, Path A wins, because a rewrite that fights the framework is the worst of both
worlds.

---

## Rules

- **Nothing here ships.** Throwaway branch, throwaway code, not merged.
- **Do not touch the main stack** — `docker-compose.yml`, `docker-compose.local.yml`,
  `entrypoint.sh`, `prisma/`, or `src/`. This spike must not disturb the September release
  or the migration rehearsal, which are still in flight.
- **Do not install anything on the VPS.** Local only.
- **Report unknowns as unknowns.** A spike that says "Task 3 was harder than expected and
  I only got halfway" is useful. A spike that reports confident conclusions it did not test
  is worse than no spike.
- Verify Frappe specifics against **current official documentation**. Frappe changes between
  major versions and much of what is written online is stale.
