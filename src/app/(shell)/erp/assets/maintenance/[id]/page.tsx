import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getLog, MAINT_KIND_LABEL, MAINT_STATUS_LABEL } from '@/modules/erp/services/maintenance.service';
import { formatQty } from '@/modules/erp/domain/money';
import { cancelLogAction, completeRepairAction, startRepairAction } from '@/app/actions/erp-assets';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, Money, orNotFound } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

const when = (d: Date | null) => (d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default async function MaintenanceLogPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const { id } = await params;
  const { log, asset, schedule, people } = await orNotFound(getLog(p, id));
  const manage = canManage(p, 'assets');
  const open = log.status === 'OPEN' || log.status === 'IN_PROGRESS';
  const row = (label: string, value: React.ReactNode) => (
    <div><dt className="text-caption uppercase text-muted">{label}</dt><dd className="mt-xxs whitespace-pre-line text-body-sm">{value || '—'}</dd></div>
  );
  return (
    <div className="space-y-lg">
      <PageHeader
        title={`${log.number} · ${asset?.name ?? ''}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={log.status === 'DONE' ? 'COMPLETED' : log.status === 'OPEN' ? 'OVERDUE' : log.status} label={MAINT_STATUS_LABEL[log.status]} /> {MAINT_KIND_LABEL[log.kind]}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: log.kind === 'BREAKDOWN' ? 'Breakdowns' : 'Maintenance', href: log.kind === 'BREAKDOWN' ? '/erp/assets/breakdowns' : '/erp/assets/maintenance' }, { label: log.number }]}
        actions={manage && open ? (
          <>
            {log.status === 'OPEN' ? <DocButton action={startRepairAction} fields={{ id }} label="Start repair" variant="primary" /> : null}
            <DocButton action={cancelLogAction} fields={{ id }} label="Cancel" confirm="Cancel this record?" />
          </>
        ) : null}
      />
      <Card title="Record">
        <dl className="grid gap-base sm:grid-cols-3">
          {row('Asset', asset ? <Link href={`/erp/assets/register/${asset.id}`} className="hover:underline">{asset.number} · {asset.name}</Link> : null)}
          {row('Location', asset?.location)}
          {row('Assigned to', log.assignedToId ? people.get(log.assignedToId) : 'Anyone')}
          {row(log.kind === 'BREAKDOWN' ? 'Reported' : 'Done on', when(log.reportedAt))}
          {row('Started', when(log.startedAt))}
          {row('Finished', when(log.completedAt))}
          {row('Downtime', log.downtimeHours ? `${formatQty(log.downtimeHours)} hours` : null)}
          {row('Cost', log.cost.isZero() ? null : <Money value={log.cost} />)}
          {row('Done by', log.doneById ? people.get(log.doneById) : null)}
        </dl>
        <dl className="mt-base grid gap-base sm:grid-cols-2">
          {row(log.kind === 'BREAKDOWN' ? 'What went wrong' : 'Task', log.description)}
          {row('What was done', log.actionTaken)}
          {schedule?.checklist ? row('Checklist', schedule.checklist) : null}
        </dl>
      </Card>
      {manage && open && log.kind === 'BREAKDOWN' ? (
        <Card title="Repair done">
          <ActionForm action={completeRepairAction} className="space-y-sm">
            <input type="hidden" name="id" value={id} />
            <div>
              <label className="label" htmlFor="actionTaken">What was done</label>
              <textarea id="actionTaken" name="actionTaken" rows={3} required className="input w-full" placeholder="Replaced the seal on the main cylinder" />
            </div>
            <div className="grid gap-sm sm:grid-cols-3">
              <Field label="Cost (₹)" name="cost" type="number" step="0.01" placeholder="0" />
              <Field label="Downtime (hours)" name="downtimeHours" type="number" step="0.25" placeholder="From the report time" />
            </div>
            <SubmitButton variant="primary">Mark repaired</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
