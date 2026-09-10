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

### Judgement call: the stage pastels

The source scopes the five pastels to "in-product agent timeline visualizations" and
forbids them as generic system action colours. This app's closest equivalent is the
**work-stage timeline** a task moves along, so the pastels mark exactly that and
nothing else:

| Stage | Token | Original meaning |
|---|---|---|
| Project `PLANNING` | `stage-thinking` (peach) | Thinking |
| Task `TODO` | `stage-grep` (mint) | Grepping |
| Task `IN_PROGRESS` | `stage-edit` (lavender) | Editing |
| Task `IN_REVIEW` | `stage-read` (blue) | Reading |
| Task `COMPLETED` | `stage-done` (gold) | Done |

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

## Checklist before shipping a UI change

- [ ] No `shadow-*`, no raw hex, no stock palette classes.
- [ ] At most one `.btn-primary` on the screen.
- [ ] Headings use `.page-title` / `.section-title`, not `font-bold`.
- [ ] Identifiers render in mono and keep their case.
- [ ] Stage pastels used only for lifecycle stages.
- [ ] Spacing comes from the named steps.
- [ ] `npm run build` passes and the screen was looked at, not just compiled.
