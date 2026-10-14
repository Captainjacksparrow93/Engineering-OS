import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { itemOptions } from '@/modules/erp/services/item.service';
import { INSPECTION_LABEL, listInspections } from '@/modules/erp/services/quality.service';
import { createInspectionAction } from '@/app/actions/erp-quality';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, ItemDatalist, showDate, todayIso } from '../../_components/parts';
import { QualityTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quality inspections' };

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string; item?: string; referenceType?: string; referenceId?: string; referenceLineId?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'quality')) notFound();
  const sp = await searchParams;
  const [rows, items] = await Promise.all([listInspections(p, { type: sp.type, status: sp.status }), itemOptions(p.companyId)]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Quality inspections" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Quality', href: '/erp/quality' }, { label: 'Inspections' }]} />
      <QualityTabs current="/erp/quality/inspections" />
      {canManage(p, 'quality') ? (
        <Card title="New inspection">
          <ActionForm action={createInspectionAction} className="space-y-base">
            <input type="hidden" name="referenceType" value={sp.referenceType ?? ''} />
            <input type="hidden" name="referenceId" value={sp.referenceId ?? ''} />
            <input type="hidden" name="referenceLineId" value={sp.referenceLineId ?? ''} />
            <ItemDatalist id="qi-items" items={items} />
            <div className="grid gap-sm sm:grid-cols-4">
              <div>
                <label className="label" htmlFor="type">Type</label>
                <select id="type" name="type" defaultValue={sp.referenceType === 'Delivery Note' ? 'OUTGOING' : sp.referenceType === 'Work Order' ? 'IN_PROCESS' : 'INCOMING'} className="select w-full">{Object.entries(INSPECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <Field label="Item" name="itemCode" defaultValue={sp.item} required list="qi-items" />
              <Field label="Date" name="inspectionDate" type="date" defaultValue={todayIso()} required />
              <Field label="Sample size" name="sampleSize" type="number" defaultValue="1" />
            </div>
            {sp.referenceType ? <p className="text-caption text-muted">For {sp.referenceType.toLowerCase()} line; the result unlocks that document.</p> : null}
            <SubmitButton variant="primary" pendingLabel="Creating…">Start inspection</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <form method="get" className="flex flex-wrap gap-sm">
        <select name="type" defaultValue={sp.type ?? ''} className="select" aria-label="Type"><option value="">All types</option>{Object.entries(INSPECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status"><option value="">All</option><option value="DRAFT">Draft</option><option value="SUBMITTED">Submitted</option><option value="CANCELLED">Cancelled</option></select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No inspections" /> : (
        <table className="table">
          <thead><tr><th>Inspection</th><th>Type</th><th>Item</th><th>For</th><th>Date</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/erp/quality/inspections/${r.id}`} className="code hover:underline">{r.number}</Link></td>
                <td>{INSPECTION_LABEL[r.type]}</td>
                <td><span className="code mr-xs">{r.item?.code}</span>{r.item?.name}</td>
                <td className="text-caption text-muted">{r.referenceType ?? '—'}</td>
                <td>{showDate(r.inspectionDate)}</td>
                <td>{r.status === 'SUBMITTED' && r.result ? <DocStatus status={r.result} label={r.result === 'ACCEPTED' ? 'Accepted' : 'Rejected'} /> : <DocStatus status={r.status} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
