import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { JOB_STATUS_LABEL, listJobCards } from '@/modules/erp/services/job-card.service';
import { workstationOptions } from '@/modules/erp/services/bom.service';
import { EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Qty, showDate } from '../../_components/parts';
import { ManufacturingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job cards' };

export default async function JobCardsPage({ searchParams }: { searchParams: Promise<{ status?: string; workstationId?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const sp = await searchParams;
  const [rows, ws] = await Promise.all([listJobCards(p, sp), workstationOptions(p.companyId)]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Job cards" subtitle="The shop floor's queue: one card per operation of a work order. Log time and finished quantity on each." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Manufacturing', href: '/erp/manufacturing' }, { label: 'Job cards' }]} />
      <ManufacturingTabs current="/erp/manufacturing/job-cards" />
      <form method="get" className="flex flex-wrap gap-sm">
        <select name="workstationId" defaultValue={sp.workstationId ?? ''} className="select" aria-label="Workstation">
          <option value="">All workstations</option>
          {ws.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status">
          <option value="">Open and in progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No job cards" /> : (
        <table className="table">
          <thead><tr><th>Job card</th><th>Work order</th><th>Operation</th><th>Workstation</th><th className="text-right">Done</th><th>Needed by</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id}>
                <td><Link href={`/erp/manufacturing/job-cards/${j.id}`} className="code hover:underline">{j.number}</Link></td>
                <td>{j.workOrder ? <Link href={`/erp/manufacturing/work-orders/${j.workOrder.id}`} className="code hover:underline">{j.workOrder.number}</Link> : '—'} <span className="text-caption text-muted">{j.workOrder?.itemCode}</span></td>
                <td>{j.operation}</td>
                <td>{j.workstationName}</td>
                <td className="text-right"><Qty value={j.completedQty} /> / <Qty value={j.forQty} /></td>
                <td>{showDate(j.workOrder?.expectedEnd)}</td>
                <td><DocStatus status={j.status === 'COMPLETED' ? 'COMPLETED' : j.status} label={JOB_STATUS_LABEL[j.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
