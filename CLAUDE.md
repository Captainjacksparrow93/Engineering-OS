# Engineering OS — working notes

## Design system: mandatory

All UI work follows [`docs/design-system.md`](docs/design-system.md), which applies the
system in [`design/cursor-design-system.md`](design/cursor-design-system.md). This is
not advisory — it governs this module and every module added later.

Before writing UI, read `docs/design-system.md`. The short version:

- Tokens live in `tailwind.config.ts` and `src/app/globals.css`. **Never** write a raw
  hex value or a stock Tailwind palette class (`slate-500`, `red-600`, `amber-100`).
- Warm cream `canvas` page floor; white is a card surface.
- **Hairlines only — no shadows.**
- **Cursor Orange (`primary`) is scarce**: the wordmark, and one CTA per screen. Links,
  active nav and selected states use ink and `surface-strong`, never orange.
- Display type stays at weight 400 with negative tracking (`.page-title`,
  `.section-title`). Never bold display.
- Every code surface — task codes, employee codes, permission keys, event names, audit
  payloads — is JetBrains Mono via `.code` / `.code-chip` / `.code-block`, and keeps its
  case.
- The five `stage-*` pastels mark work-stage lifecycle pills only. Risk uses `error`,
  confirmation uses `success`. There is no third semantic hue.
- 8px controls, 12px cards, pills for badges; spacing on the 4px named steps.

Run through the checklist at the end of `docs/design-system.md` before finishing.

## Architecture

Modular monolith on one PostgreSQL database. See [`docs/architecture.md`](docs/architecture.md).

- Routes (server actions and REST) call services. A route never touches Prisma; a
  service never trusts its caller — every service call starts with a permission assert.
- Domain engines in `src/modules/*/domain/` are pure functions and are unit-tested.
- Tables are namespaced per module (`core_*`, `pm_*`). Cross-module traffic goes through
  the transactional outbox and the catalogue in `src/core/events/catalog.ts`.
- Access control is permission-based and scoped — see [`docs/rbac.md`](docs/rbac.md).
  Never branch on a role name.

## Commands

```bash
npm run dev          # development server
npm run build        # production build (must pass before committing)
npm test             # unit tests for the domain engines and RBAC
npm run typecheck    # tsc --noEmit
npm run db:migrate   # create/apply a migration in development
npm run db:seed      # demo data (needs SEED_PASSWORD)
```
