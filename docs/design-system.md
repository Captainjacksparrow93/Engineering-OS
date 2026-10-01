# Design system

The source of truth is [`design/cursor-design-system.md`](../design/cursor-design-system.md).
This document says how that system is applied to Engineering OS, where the tokens live
in code, and the handful of judgement calls made in adapting a marketing language to a
dense operational tool.

**Every UI change — this module and every module that follows — must comply.**

## Where the tokens live

| Concern | File |
|---|---|
| Colour, radius, spacing, type scale | `tailwind.config.ts` |
| Component recipes (`.card`, `.btn`, `.badge`, `.table`, …) | `src/app/globals.css` |
| Shared primitives (badges, avatars, stats, alerts) | `src/components/ui.tsx` |
| Fonts | `src/app/layout.tsx` |

Nothing in a component may carry a raw hex value or a stock Tailwind palette class
(`slate-500`, `red-600`, `amber-100`). If a colour is needed that the tokens do not
provide, the answer is almost always that the design intends a different treatment.

## The rules that carry the look

1. **The page floor is warm cream** (`canvas` #f7f7f4), never white. White (`surface`)
   is a card surface, and the slight white-on-cream contrast is what makes cards read.
2. **Hairline-only depth.** No shadows anywhere — `shadow-*` is banned. Cards are 1px
   `hairline` on cream.
3. **Cursor Orange is scarce.** `primary` appears in exactly two places: the wordmark,
   and the single most important action on a screen. Never on links, never on active
   nav, never on a second button in the same view. Nav and selection states are carried
   by ink weight and `surface-strong` fills.
4. **Display type stays at weight 400** with negative tracking. Page titles use
   `.page-title` (26px/400), section heads `.section-title` (22px/400). Only
   `title-md`/`title-sm` (18/16px) go to 600 — those are component labels, not display.
5. **Every code surface is JetBrains Mono**: task and project codes, employee codes,
   permission keys, event names, audit payloads. Use `.code`, `.code-chip` or
   `.code-block` — never a bare `font-mono`, and never inside an uppercase badge (a
   permission key is an identifier and must keep its case).
6. **8px controls, 12px cards, 9999px pills, 4px inline tags.**
7. **Spacing runs on the 4px grid** using the named steps (`xxs` 4 → `section` 80).

## Colour semantics in this app

The marketing system has one brand hue, five stage pastels and two semantic colours.
That is the entire palette; the app adds nothing.

| Meaning | Token | Where |
|---|---|---|
| Primary action | `primary` | One CTA per screen, plus the wordmark |
| Text | `ink` / `body` / `muted` / `muted-soft` | Headings / running text / labels / disabled |
| Surfaces | `canvas`, `canvas-soft`, `surface`, `surface-strong` | Page, inset panes, cards, chips |
| Structure | `hairline`, `hairline-soft`, `hairline-strong` | Dividers, card outlines, input borders |
| Risk | `error` | Blocked, overdue, overloaded, validation |
| Confirmation | `success` | Completed, on track, spare capacity |
| Work stage | `stage-*` | Lifecycle stage pills only — see below |

### Judgement call: the stage pastels and status pills

Per owner decisions (Audit Round 2, Steps 3 & 7), status pill semantics are:
- `COMPLETED` / Approved: `success` (solid green, `bg-success text-on-primary`) to unequivocally signal completion/approval.
- `TODO`: neutral (`bg-surface-strong text-ink border border-hairline`), never green so green is reserved for approved.
- `BLOCKED` / `LATE`: `error` (semantic red).
- `IN_PROGRESS`: `stage-edit` (lavender).
- `IN_REVIEW` ("Waiting for approval"): `stage-read` (blue).

| Stage | Token | Treatment |
|---|---|---|
| Project `PLANNING` | `stage-thinking` (peach) | Thinking |
| Task `TODO` | Neutral (`surface-strong`) | Queued / To do |
| Task `IN_PROGRESS` | `stage-edit` (lavender) | In progress |
| Task `IN_REVIEW` | `stage-read` (blue) | Waiting for approval |
| Task `COMPLETED` | `success` (green) | Approved / Completed |

States that are **not** stages deliberately fall through to neutral or semantic
treatments, so a pastel always means "work is at this stage":

- `BLOCKED` → `error`; `CANCELLED`, `ON_HOLD`, `DRAFT` → neutral or outline.
- Assignment and handover bookkeeping (`ACTIVE`, `PENDING`, `ACCEPTED`, `HANDED_OVER`)
  → ink, outline and the two semantic tokens.
- Capacity signals (`FREE`, `OVERLOADED`) → `success` / `error`.

If this reading is wrong, the fix is one map in `src/components/ui.tsx` — the pastels
are referenced nowhere else.

### Judgement call: no third semantic hue

The source has no amber. "Warning" is therefore the `error` token held back to a tint
(`bg-error/[0.06]`) rather than a new colour, and priority escalates through weight —
outline → neutral → ink → error — instead of through hue.

### Judgement call: section rhythm

The 80px section rhythm and 72px display are editorial devices. They apply on the
marketing-shaped surfaces (sign-in, module launcher, coming-soon pages). Dense
operational screens — tables, boards, task detail — use `lg`/`xl` (24/32px) so a
manager can see a project's tasks without scrolling. `max-w-content` (1200px) holds
everywhere.

## Component recipes

| Class | Use |
|---|---|
| `.card` / `.card-header` / `.card-body` | Standard content card: white, 12px, hairline |
| `.pane` | Inset panel on `canvas-soft` — the app's IDE-pane equivalent |
| `.btn` + `.btn-primary` | The one orange CTA per screen |
| `.btn-secondary` | Every other action |
| `.btn-ink` | Weighty non-brand action where orange would be too loud |
| `.btn-danger` | Destructive: error text on a white surface, never a filled red button |
| `.btn-text` / `.link` / `.link-muted` | Inline actions and links — ink, underline on hover |
| `.input` / `.select` / `.textarea` / `.label` / `.hint` | Forms: 44px, 8px radius, ink focus ring |
| `.badge` + `.badge-neutral\|outline\|ink\|error\|success` | Non-stage state |
| `.stage-pill` + `bg-stage-*` | Work-stage markers only |
| `.table` | Dense data: cream header, hairline rows, uppercase captions |
| `.stat` / `.stat-label` / `.stat-value` | KPI tiles |
| `.code` / `.code-chip` / `.code-block` | Identifiers and payloads |

## ERP screens (`/erp`)

User decision 2026-10-01: ERP pages **match the dashboard exactly**. ERPNext's own UI is never shown, and ERP adds no new tokens, components or colours. Every ERP screen is one of three patterns, built from the same pieces as PM's Clients pages (`src/app/(shell)/pm/clients/`), which are the reference.

**1. Document list** (e.g. Customers, Sales orders)
- `PageHeader`: title in plural nouns ("Sales orders"), one-line description, and the create action in `actions` as the screen's only `.btn-primary` ("New sales order").
- `DataTable` in a `.card`. Columns: the document number first in `.code` (e.g. `SO-0042`, WO `8871`), then the client name, then dates (`formatDate`), then the status badge **last**, then amounts right-aligned (when shown).
- Filters above the table as `.select`/`.input` in one row: status and date range only. No saved views, no column pickers.
- An `EmptyState` that says what goes here and offers the create action.

**2. Document page** (e.g. `/erp/sales-orders/[id]`)
- `PageHeader`: the document number as the title (`.code` inside the title is fine), the client as the description, status badge beside the title, and actions on the right. At most one `.btn-primary` (the next step, e.g. "Confirm order"); everything else `.btn-secondary`, and destructive actions `.btn-danger` behind `ConfirmDialog`.
- Body: a `.card` of key facts as label/value pairs (`.label` + `body` text) in two columns, then a `.card` with a `.table` of lines (panels: type, quantity, delivery date).
- Links to related records:
  - **Customer** → `/pm/clients/[id]`.
  - **Project created from this order** → `/pm/projects/[id]`, shown as the project code chip.
  - **And back:** the project page shows "From sales order `SO-0042`".

**3. Document form** (create / edit)
- A `.card` with `form.tsx` primitives: `.label`, `.input`/`.select`, `.hint` under a field when needed, `FormMessage` for server errors, and `SubmitButton` as the primary action.
- One column on narrow screens, two at `md`+. Line items (panels) are a small editable `.table`: add a row with a `.btn-text`, remove with an icon button.
- Copy per `ux-writing`: labels are nouns ("Client PO number"), errors say what to fix ("Pick a client"), and nothing names ERPNext.

**Document status → badge** (add to the one status map in `src/components/ui.tsx`; no new colours):

| ERPNext state | Label | Treatment |
|---|---|---|
| Draft (`docstatus` 0) | Draft | `badge-neutral` |
| Submitted, to deliver | Confirmed | `stage-thinking` pill (it is a work stage) |
| Completed / Closed | Completed | `success` |
| Cancelled (`docstatus` 2) | Cancelled | `badge-outline` |
| On hold | On hold | `badge-neutral` |
| Overdue delivery | Late | `error` |

**When ERPNext can't be reached:** show an `Alert` on the ERP page ("Orders can't be loaded right now. Try again in a few minutes."). Don't show a raw error or a blank table, and never block the rest of the app.

## Checklist before shipping a UI change

- [ ] No `shadow-*`, no raw hex, no stock palette classes.
- [ ] At most one `.btn-primary` on the screen.
- [ ] Headings use `.page-title` / `.section-title`, not `font-bold`.
- [ ] Identifiers render in mono and keep their case.
- [ ] Stage pastels used only for lifecycle stages.
- [ ] Spacing comes from the named steps.
- [ ] `npm run build` passes and the screen was looked at, not just compiled.
