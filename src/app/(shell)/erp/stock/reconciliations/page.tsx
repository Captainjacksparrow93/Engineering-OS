import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listReconciliations } from '@/modules/erp/services/reconciliation.service';
import { createReconciliationAction } from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { StockTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock counts' };

export default async function ReconciliationsPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const rows = await listReconciliations(p);
  return (
    <div className="space-y-lg">
      <PageHeader title="Stock counts" subtitle="Post opening stock, or correct stock to what was counted. The difference goes to the books." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock', href: '/erp/stock' }, { label: 'Stock counts' }]} />
      <StockTabs current="/erp/stock/reconciliations" />
      {canManage(p, 'stock') ? (
        <Card title="New stock count">
          <ActionForm action={createReconciliationAction} className="flex flex-wrap items-end gap-sm">
            <div>
              <label className="label" htmlFor="purpose">Type</label>
              <select id="purpose" name="purpose" className="select" defaultValue="ADJUSTMENT">
                <option value="OPENING">Opening stock</option>
                <option value="ADJUSTMENT">Stock count</option>
              </select>
            </div>
            <Field label="Posting date" name="postingDate" type="date" defaultValue={todayIso()} required />
            <Field label="Remarks" name="remarks" className="min-w-[16rem] flex-1" />
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No stock counts yet" />
      ) : (
        <table className="table">
          <thead><tr><th>Count</th><th>Type</th><th>Date</th><th>Lines</th><th>Status</th><th className="text-right">Difference</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/erp/stock/reconciliations/${r.id}`} className="code hover:underline">{r.number}</Link></td>
                <td>{r.purpose === 'OPENING' ? 'Opening stock' : 'Stock count'}</td>
                <td>{showDate(r.postingDate)}</td>
                <td>{r._count.lines}</td>
                <td><DocStatus status={r.status} /></td>
                <td className="text-right"><Money value={r.differenceValue} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
