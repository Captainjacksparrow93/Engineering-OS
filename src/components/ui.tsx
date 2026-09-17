import { formatName } from '@/core/utils/strings';
import clsx from 'clsx';
import Link from 'next/link';

/**
 * Shared presentational primitives.
 *
 * Colour discipline, per `docs/design-system.md`:
 *   - Cursor Orange is a CTA colour only. Nothing here uses it.
 *   - Work-stage pastels mark lifecycle stages (planned → queued → in progress →
 *     in review → done) and nothing else.
 *   - Risk and confirmation use the two semantic tokens, `error` and `success`.
 *   - Everything else is ink, body, muted and hairlines.
 */

export function Avatar({
  name,
  color,
  size = 28,
  title,
}: {
  name: string;
  color?: string | null;
  size?: number;
  title?: string;
}) {
  const displayName = formatName(name);
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  // The stored per-person colour is used at low opacity only: enough to tell people
  // apart at a glance without introducing saturated colour into a restrained palette.
  const tint = color ? `${color}22` : 'var(--color-surface-strong)';

  return (
    <span
      title={title ?? displayName}
      className="inline-flex shrink-0 items-center justify-center rounded-pill border border-hairline font-medium text-ink"
      style={{ backgroundColor: tint, width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  IN_REVIEW: 'Waiting for approval',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  BLOCKED: 'Blocked',
  CANCELLED: 'Cancelled',
  ON_HOLD: 'On hold',
  DRAFT: 'Draft',
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

/**
 * Work-stage pills.
 *
 * Colour discipline per owner decision (Step 3 & 7):
 * - Completed = green (bg-success text-on-primary)
 * - To do = neutral (bg-surface-strong text-ink border border-hairline)
 * - In progress & Waiting for approval = stage pastels
 */
const STAGE_STYLES: Record<string, string> = {
  PLANNING: 'bg-stage-thinking',
  TODO: 'bg-surface-strong text-ink border border-hairline',
  IN_PROGRESS: 'bg-stage-edit',
  IN_REVIEW: 'bg-stage-read',
  COMPLETED: 'bg-success text-on-primary',
};

const STATE_STYLES: Record<string, string> = {
  // Risk and terminal states - never a stage pastel.
  BLOCKED: 'badge-error',
  CANCELLED: 'badge-neutral text-muted line-through',
  ON_HOLD: 'badge-outline',
  DRAFT: 'badge-outline',

  // Assignment and handover bookkeeping - system state, not work stage.
  ACTIVE: 'badge-ink',
  PENDING: 'badge-outline',
  ACCEPTED: 'badge-success',
  REJECTED: 'badge-error',
  DECLINED: 'badge-error',
  WITHDRAWN: 'badge-neutral text-muted',
  HANDED_OVER: 'badge-neutral',
  RELEASED: 'badge-neutral text-muted',
  SUSPENDED: 'badge-error',
  EXITED: 'badge-neutral text-muted',

  // Capacity signals - good/bad, so the two semantic tokens carry them.
  FREE: 'badge-success',
  AVAILABLE: 'badge-success',
  BUSY: 'badge-neutral',
  OVERLOADED: 'badge-error',
  ON_LEAVE: 'badge-outline text-muted',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
  const stage = STAGE_STYLES[status];

  if (stage) {
    return <span className={clsx('stage-pill', stage, className)}>{label}</span>;
  }
  return <span className={clsx('badge', STATE_STYLES[status] ?? 'badge-neutral', className)}>{label}</span>;
}

/** Priority escalates through weight, not hue: outline → neutral → ink → error. */
const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'badge-outline text-muted',
  MEDIUM: 'badge-neutral',
  HIGH: 'badge-ink',
  CRITICAL: 'badge-error',
};

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={clsx('badge', PRIORITY_STYLES[priority] ?? 'badge-neutral')}>{priority}</span>;
}

export function ProgressBar({
  value,
  className,
  tone,
}: {
  value: number;
  className?: string;
  tone?: 'default' | 'danger' | 'success';
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const fill = tone === 'danger' ? 'bg-error' : tone === 'success' ? 'bg-success' : 'bg-ink';
  return (
    <div className={clsx('h-1 w-full overflow-hidden rounded-pill bg-surface-strong', className)}>
      <div className={clsx('h-full rounded-pill transition-all', fill)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-hairline-strong bg-canvas-soft px-lg py-xxl text-center">
      <p className="text-title-sm text-ink">{title}</p>
      {hint ? <p className="mt-xs max-w-md text-body-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-base">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  hint?: string;
}) {
  const toneClass =
    tone === 'danger' || tone === 'warning' ? 'text-error' : tone === 'success' ? 'text-success' : 'text-ink';
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className={clsx('stat-value', toneClass)}>{value}</p>
      {hint ? <p className="mt-xxs text-caption text-muted">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: Array<{ label: string; href?: string }>;
}) {
  return (
    <div className="mb-xl flex flex-wrap items-start justify-between gap-base">
      <div>
        {breadcrumb?.length ? (
          <nav className="mb-xs flex items-center gap-xxs text-caption text-muted">
            {breadcrumb.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-xxs">
                {index > 0 ? <span className="text-muted-soft">/</span> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="link-muted">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <div className="mt-xs text-body-sm text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-xs">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('card', className)}>
      {title ? (
        <header className="card-header">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={clsx('card-body', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Only three tones exist. "Warning" is the error token held back to a tint rather than
 * a fourth colour - the palette has exactly two semantic hues and keeps them.
 */
export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
}) {
  const styles = {
    info: 'border-hairline bg-canvas-soft text-body',
    warning: 'border-error/30 bg-error/[0.06] text-ink',
    danger: 'border-error/40 bg-error/[0.08] text-ink',
    success: 'border-success/30 bg-success/[0.07] text-ink',
  }[tone];
  return <div className={clsx('rounded-md border px-base py-sm text-body-sm', styles)}>{children}</div>;
}
