import Link from 'next/link';
import clsx from 'clsx';
import type { Prisma } from '@prisma/client';
import { formatMoney, formatQty } from '@/modules/erp/domain/money';

export const DOC_STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Submitted', CANCELLED: 'Cancelled' };

/** Badge for any ERP status: the docstatus trio plus derived ones (To receive, Completed…). */
export function DocStatus({ status, label }: { status: string; label?: string }) {
  const style =
    status === 'DRAFT'
      ? 'badge-outline'
      : status === 'CANCELLED'
        ? 'badge-neutral text-muted line-through'
        : status === 'COMPLETED' || status === 'PAID' || status === 'ACCEPTED' || status === 'CLOSED_OK'
          ? 'badge-success'
          : status === 'OVERDUE' || status === 'REJECTED' || status === 'FAILED'
            ? 'badge-error'
            : 'badge-ink';
  return <span className={clsx('badge whitespace-nowrap', style)}>{label ?? DOC_STATUS_LABEL[status] ?? status.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>;
}

export const Money = ({ value, className }: { value: Prisma.Decimal.Value | null | undefined; className?: string }) => (
  <span className={clsx('tabular-nums whitespace-nowrap', className)}>{formatMoney(value)}</span>
);
export const Qty = ({ value, uom }: { value: Prisma.Decimal.Value | null | undefined; uom?: string }) => (
  <span className="tabular-nums whitespace-nowrap">{formatQty(value)}{uom ? ` ${uom}` : ''}</span>
);

export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
export const showDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export const todayIso = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Tab strip for an ERP area's screens. */
export function AreaTabs({ tabs, current }: { tabs: Array<{ href: string; label: string; show?: boolean }>; current: string }) {
  return (
    <nav className="-mt-base mb-lg flex flex-wrap gap-xs border-b border-hairline" aria-label="Sections">
      {tabs
        .filter((t) => t.show !== false)
        .map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.href === current ? 'page' : undefined}
            className={clsx('-mb-px border-b-2 px-sm py-xs text-body-sm', t.href === current ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {t.label}
          </Link>
        ))}
    </nav>
  );
}

/** `<datalist>` of item codes so line forms autocomplete. */
export function ItemDatalist({ id, items }: { id: string; items: Array<{ code: string; name: string }> }) {
  return (
    <datalist id={id}>
      {items.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
    </datalist>
  );
}

export function WarehouseSelect({ name, warehouses, defaultValue, label, optional }: { name: string; warehouses: Array<{ id: string; name: string }>; defaultValue?: string | null; label: string; optional?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue ?? ''} className="select w-full">
        {optional ? <option value="">—</option> : null}
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </div>
  );
}

export function ProjectSelect({ projects, defaultValue, name = 'projectId', label = 'Project (optional)' }: { projects: Array<{ id: string; code: string; name: string }>; defaultValue?: string | null; name?: string; label?: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue ?? ''} className="select w-full">
        <option value="">No project</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
      </select>
    </div>
  );
}

/** Label + input, the common form field. */
export function Field({ label, name, defaultValue, type = 'text', required, placeholder, step, list, className }: { label: string; name: string; defaultValue?: string | number | null; type?: string; required?: boolean; placeholder?: string; step?: string; list?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} defaultValue={defaultValue ?? ''} required={required} placeholder={placeholder} step={step ?? (type === 'number' ? 'any' : undefined)} list={list} className="input w-full" />
    </div>
  );
}

/** Who did what to a document, for its footer. */
export function DocTrail({ created, submitted, cancelled }: { created: { by?: string; at: Date }; submitted?: { by?: string; at: Date | null }; cancelled?: { by?: string; at: Date | null } }) {
  const fmt = (d: Date) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  return (
    <p className="text-caption text-muted">
      Created by {created.by ?? 'someone'} on {fmt(created.at)}
      {submitted?.at ? ` · submitted by ${submitted.by ?? 'someone'} on ${fmt(submitted.at)}` : ''}
      {cancelled?.at ? ` · cancelled by ${cancelled.by ?? 'someone'} on ${fmt(cancelled.at)}` : ''}
    </p>
  );
}

/** Runs a loader and turns "not found" into the 404 page. */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  const { notFound } = await import('next/navigation');
  const { NotFoundError } = await import('@/core/rbac/errors');
  try {
    return await load;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
