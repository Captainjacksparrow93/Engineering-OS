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

## ERP (ERPNext, restyled)

User decision 2026-10-01: people use **ERPNext's own screens and dashboards** (all modules), restyled to belong to Engineering OS. The look comes from the custom Frappe app `acs_erp` (CSS only, loaded on ERPNext's desk via the app's `app_include_css` hook). ERPNext's layouts and widgets stay ERPNext's; **the target is "same family", not pixel-identical** (accepted by the user).

**Map our tokens onto ERPNext's desk** (override Frappe's CSS variables first, and write selectors only where a variable doesn't exist):
- **Floor:** page background → `canvas` #f7f7f4; cards, forms and list rows → `surface` (white).
- **Type:** Inter for UI text, page and section titles at weight 400 with negative tracking. JetBrains Mono for document numbers (`SO-…`, WO, item codes) wherever ERPNext renders them as names or IDs. Ship the font files in the app (same files as `src/app/fonts/`), with no Google Fonts.
- **Depth:** remove shadows (cards, dropdowns, modals use 1px `hairline` borders instead). Radius: 8px for controls, 12px for cards and modals, 9999px for pills.
- **Orange is scarce:** ERPNext's primary button (the one main action per page) uses `primary`. Every other button is secondary/ink. Links and the active sidebar item use ink weight and `surface-strong`, not orange or blue.
- **Status colours:** ERPNext indicators map to ours: green → `success`, red → `error`, blue and other neutrals → neutral `surface-strong`/ink. Don't introduce amber; "warning" indicators use the `error` tint, as in our app.
- **Branding:** our ACS logo and "Engineering OS · ERP" in ERPNext's navbar and on its (Administrator-only) login page. Hide ERPNext's "Help" menu and onboarding banners where config allows.

**Getting there from Engineering OS:** an **ERP** item in our sidebar and in the module launcher (registry entry `erp` → live, opening ERPNext's address in a new tab). It signs the user in automatically (see `CLAUDE.md`, "One login"). Don't embed ERPNext in an iframe.

**Links between the two:** our project page shows "From sales order `SO-0042`" linking to that order in ERPNext. The order in ERPNext shows the project code with a link back to `/pm/projects/[id]` (a field set by the integration).

**Checking it:** before shipping a theme change, screenshot ERPNext's Selling workspace, a Sales Order list, a Sales Order form and a Customer form next to our Director dashboard and Clients page, and check the checklist below where it applies.

## Checklist before shipping a UI change

- [ ] No `shadow-*`, no raw hex, no stock palette classes.
- [ ] At most one `.btn-primary` on the screen.
- [ ] Headings use `.page-title` / `.section-title`, not `font-bold`.
- [ ] Identifiers render in mono and keep their case.
- [ ] Stage pastels used only for lifecycle stages.
- [ ] Spacing comes from the named steps.
- [ ] `npm run build` passes and the screen was looked at, not just compiled.
