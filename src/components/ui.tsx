import clsx from 'clsx';
import Link from 'next/link';

/** Small presentational primitives shared across every module screen. */

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
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <span
      title={title ?? name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: color ?? '#64748b', width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ people }: { people: Array<{ id: string; fullName: string; avatarColor?: string | null }> }) {
  if (people.length === 0) return <span className="text-xs text-slate-400">Unassigned</span>;
  return (
    <span className="flex -space-x-1.5">
      {people.slice(0, 4).map((person) => (
        <span key={person.id} className="ring-2 ring-white rounded-full">
          <Avatar name={person.fullName} color={person.avatarColor} size={24} />
        </span>
      ))}
      {people.length > 4 ? (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600 ring-2 ring-white">
          +{people.length - 4}
        </span>
      ) : null}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  TODO: 'bg-slate-100 text-slate-700',
  BLOCKED: 'bg-red-100 text-red-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  IN_REVIEW: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-400 line-through',
  PLANNING: 'bg-indigo-100 text-indigo-700',
  ON_HOLD: 'bg-amber-100 text-amber-700',
  PENDING: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  HANDED_OVER: 'bg-violet-100 text-violet-700',
  RELEASED: 'bg-slate-100 text-slate-500',
  FREE: 'bg-emerald-100 text-emerald-700',
  AVAILABLE: 'bg-emerald-100 text-emerald-700',
  BUSY: 'bg-amber-100 text-amber-700',
  OVERLOADED: 'bg-red-100 text-red-700',
  ON_LEAVE: 'bg-slate-200 text-slate-600',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={clsx('badge', STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600', className)}>
      {status.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-sky-100 text-sky-700',
  HIGH: 'bg-orange-100 text-orange-700',
  CRITICAL: 'bg-red-600 text-white',
};

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={clsx('badge', PRIORITY_STYLES[priority] ?? 'bg-slate-100')}>{priority.toLowerCase()}</span>;
}

export function ProgressBar({ value, className, tone }: { value: number; className?: string; tone?: 'default' | 'danger' | 'success' }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const colour = tone === 'danger' ? 'bg-red-500' : tone === 'success' ? 'bg-emerald-500' : 'bg-brand-500';
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-slate-200', className)}>
      <div className={clsx('h-full rounded-full transition-all', colour)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-border bg-white/60 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="mt-1 max-w-md text-sm text-slate-500">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
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
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : tone === 'success'
          ? 'text-emerald-600'
          : 'text-slate-900';
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className={clsx('stat-value', toneClass)}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
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
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        {breadcrumb?.length ? (
          <nav className="mb-1 flex items-center gap-1 text-xs text-slate-500">
            {breadcrumb.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? <span className="text-slate-300">/</span> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-brand-600 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: React.ReactNode }) {
  const styles = {
    info: 'border-brand-100 bg-brand-50 text-brand-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }[tone];
  return <div className={clsx('rounded-md border px-3 py-2 text-sm', styles)}>{children}</div>;
}
