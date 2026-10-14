import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getJobCard, JOB_STATUS_LABEL } from '@/modules/erp/services/job-card.service';
import { addJobCardLogAction, completeJobCardAction, removeJobCardLogAction } from '@/app/actions/erp-manufacturing';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, orNotFound, Qty } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

const time = (d: Date) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export default async function JobCardPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const { id } = await params;
  const { card, wo, workstationName, people } = await orNotFound(getJobCard(p, id));
  const staff = await prisma.user.findMany({ where: { companyId: p.companyId, status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
  const open = card.status === 'OPEN' || card.status === 'WORK_IN_PROGRESS';
  const manage = canManage(p, 'manufacturing');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={card.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={card.status === 'COMPLETED' ? 'COMPLETED' : card.status} label={JOB_STATUS_LABEL[card.status]} /> {card.operation} at {workstationName} · <Link href={`/erp/manufacturing/work-orders/${wo.id}`} className="code hover:underline">{wo.number}</Link> · <Qty value={card.completedQty} /> of <Qty value={card.forQty} /> done · {card.totalMinutes.toString()} of {card.plannedMinutes.toString()} planned minutes</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Job cards', href: '/erp/manufacturing/job-cards' }, { label: card.number }]}
        actions={manage && open ? <DocButton action={completeJobCardAction} fields={{ id }} label="Mark complete" /> : null}
      />
      <Card title="Time logs">
        {card.logs.length === 0 ? <EmptyState title="No time logged yet" /> : (
          <table className="table">
            <thead><tr><th>Who</th><th>From</th><th>To</th><th className="text-right">Minutes</th><th className="text-right">Finished</th><th>Note</th>{manage && open ? <th /> : null}</tr></thead>
            <tbody>
              {card.logs.map((l) => (
                <tr key={l.id}>
                  <td>{people.get(l.employeeId) ?? '—'}</td>
                  <td>{time(l.fromTime)}</td>
                  <td>{time(l.toTime)}</td>
                  <td className="text-right">{l.minutes.toString()}</td>
                  <td className="text-right"><Qty value={l.completedQty} /></td>
                  <td className="text-caption text-muted">{l.note}</td>
                  {manage && open ? <td className="text-right"><DocButton action={removeJobCardLogAction} fields={{ id, logId: l.id }} label="Remove" /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {manage && open ? (
          <ActionForm action={addJobCardLogAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-sm sm:grid-cols-5">
              <div>
                <label className="label" htmlFor="employeeId">Who</label>
                <select id="employeeId" name="employeeId" defaultValue={p.userId} className="select w-full">{staff.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
              </div>
              <Field label="From" name="fromTime" type="datetime-local" required />
              <Field label="To" name="toTime" type="datetime-local" required />
              <Field label="Finished in this time" name="completedQty" type="number" />
              <Field label="Note" name="note" />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Logging…">Log time</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Card>
    </div>
  );
}
