import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getNonConformance, NC_SOURCE_LABEL, NC_STATUS_LABEL } from '@/modules/erp/services/nc.service';
import { advanceNcAction, reopenNcAction, updateCapaAction } from '@/app/actions/erp-quality';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, isoDay, orNotFound, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

const NEXT_LABEL = { OPEN: 'Start investigation', INVESTIGATING: 'Action taken', ACTION_TAKEN: 'Close', CLOSED: null } as const;

export default async function NonConformancePage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'quality')) notFound();
  const { id } = await params;
  const { nc, item, supplier, customer, project, inspection, people } = await orNotFound(getNonConformance(p, id));
  const manage = canManage(p, 'quality');
  const canEdit = nc.status !== 'CLOSED' && (manage || nc.ownerId === p.userId);
  const staff = canEdit ? await prisma.user.findMany({ where: { companyId: p.companyId, status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }) : [];
  const next = NEXT_LABEL[nc.status];
  const text = (label: string, v: string | null) => (
    <div><dt className="text-caption uppercase text-muted">{label}</dt><dd className="mt-xxs whitespace-pre-line text-body-sm">{v || '—'}</dd></div>
  );
  return (
    <div className="space-y-lg">
      <PageHeader
        title={`${nc.number} · ${nc.title}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={nc.status === 'CLOSED' ? 'COMPLETED' : nc.status} label={NC_STATUS_LABEL[nc.status]} /> {NC_SOURCE_LABEL[nc.source]} · {nc.severity.toLowerCase()} · owner {people.get(nc.ownerId)}{nc.dueDate ? ` · due ${showDate(nc.dueDate)}` : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Non-conformances', href: '/erp/quality/non-conformances' }, { label: nc.number }]}
        actions={manage ? (nc.status === 'CLOSED' ? <DocButton action={reopenNcAction} fields={{ id }} label="Re-open" /> : next ? (
          nc.status === 'ACTION_TAKEN' ? null : <DocButton action={advanceNcAction} fields={{ id }} label={next} variant="primary" />
        ) : null) : null}
      />
      <Card title="What happened">
        <p className="whitespace-pre-line text-body-sm">{nc.description}</p>
        <p className="mt-sm text-caption text-muted">
          {[item ? `Item ${item.code} ${item.name}` : null, supplier ? `Supplier ${supplier.name}` : null, customer ? `Customer ${customer.name}` : null].filter(Boolean).join(' · ')}
          {project ? <> · <Link href={`/pm/projects/${project.id}`} className="hover:underline">{project.code}</Link></> : null}
          {inspection ? <> · from <Link href={`/erp/quality/inspections/${inspection.id}`} className="code hover:underline">{inspection.number}</Link></> : null}
          {` · raised by ${people.get(nc.createdById)} on ${showDate(nc.createdAt)}`}
        </p>
      </Card>
      {canEdit ? (
        <Card title="Investigation and actions">
          <ActionForm action={updateCapaAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            {(['rootCause', 'correction', 'correctiveAction', 'preventiveAction'] as const).map((f) => (
              <div key={f}>
                <label className="label" htmlFor={f}>{{ rootCause: 'Root cause', correction: 'Correction (immediate fix)', correctiveAction: 'Corrective action (stop it recurring)', preventiveAction: 'Preventive action (stop it elsewhere)' }[f]}</label>
                <textarea id={f} name={f} defaultValue={nc[f] ?? ''} rows={2} className="input w-full" />
              </div>
            ))}
            <div className="grid gap-sm sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="ownerId">Owner</label>
                <select id="ownerId" name="ownerId" defaultValue={nc.ownerId} className="select w-full">{staff.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
              </div>
              <Field label="Due by" name="dueDate" type="date" defaultValue={isoDay(nc.dueDate)} />
            </div>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
          {manage && nc.status === 'ACTION_TAKEN' ? (
            <ActionForm action={advanceNcAction} className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
              <input type="hidden" name="id" value={id} />
              <Field label="How the action was verified" name="closingNote" className="min-w-[20rem] flex-1" />
              <SubmitButton variant="primary" pendingLabel="Closing…">Close</SubmitButton>
            </ActionForm>
          ) : null}
        </Card>
      ) : (
        <Card title="Investigation and actions">
          <dl className="grid gap-base sm:grid-cols-2">
            {text('Root cause', nc.rootCause)}
            {text('Correction', nc.correction)}
            {text('Corrective action', nc.correctiveAction)}
            {text('Preventive action', nc.preventiveAction)}
            {nc.status === 'CLOSED' ? text(`Closed by ${people.get(nc.closedById ?? '') ?? ''} on ${showDate(nc.closedAt)}`, nc.closingNote) : null}
          </dl>
        </Card>
      )}
    </div>
  );
}
