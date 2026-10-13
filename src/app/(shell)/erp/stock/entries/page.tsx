import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, projectOptions } from '@/modules/erp/services/access';
import { warehouseOptions } from '@/modules/erp/services/item.service';
import { listStockEntries, PURPOSE_LABEL } from '@/modules/erp/services/stock-entry.service';
import { STOCK_PURPOSES } from '@/modules/erp/validation';
import { createStockEntryAction } from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, ProjectSelect, showDate, todayIso, WarehouseSelect } from '../../_components/parts';
import { StockTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock entries' };

export default async function StockEntriesPage({ searchParams }: { searchParams: Promise<{ status?: string; purpose?: string; q?: string; new?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const sp = await searchParams;
  const [entries, warehouses, projects] = await Promise.all([listStockEntries(p, sp), warehouseOptions(p.companyId), projectOptions(p.companyId)]);
  const stores = warehouses.find((w) => w.systemKey === 'STORES')?.id;
  const manage = canManage(p, 'stock');

  return (
    <div className="space-y-lg">
      <PageHeader title="Stock entries" subtitle="Receive, issue and move stock. A submitted entry updates stock and the books; cancel it to reverse." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock', href: '/erp/stock' }, { label: 'Stock entries' }]} />
      <StockTabs current="/erp/stock/entries" />

      {manage ? (
        <Card title="New stock entry">
          <ActionForm action={createStockEntryAction} className="space-y-base">
            <div className="grid gap-sm sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="purpose">Purpose</label>
                <select id="purpose" name="purpose" defaultValue={sp.new && (STOCK_PURPOSES as readonly string[]).includes(sp.new) ? sp.new : 'MATERIAL_RECEIPT'} className="select w-full">
                  {STOCK_PURPOSES.map((s) => <option key={s} value={s}>{PURPOSE_LABEL[s]}</option>)}
                </select>
              </div>
              <Field label="Posting date" name="postingDate" type="date" defaultValue={todayIso()} required />
              <ProjectSelect projects={projects} />
              <WarehouseSelect name="fromWarehouseId" label="From warehouse (issue, transfer)" warehouses={warehouses} defaultValue={stores} optional />
              <WarehouseSelect name="toWarehouseId" label="To warehouse (receipt, transfer)" warehouses={warehouses} defaultValue={stores} optional />
              <Field label="Remarks" name="remarks" />
            </div>
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      <form method="get" className="flex flex-wrap gap-sm">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Number or remarks" className="input w-64" aria-label="Search" />
        <select name="purpose" defaultValue={sp.purpose ?? ''} className="select" aria-label="Purpose">
          <option value="">All purposes</option>
          {Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status">
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>

      {entries.length === 0 ? (
        <EmptyState title="No stock entries" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Entry</th><th>Purpose</th><th>Date</th><th>Lines</th><th>Status</th><th className="text-right">Value</th><th>Remarks</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/erp/stock/entries/${e.id}`} className="code hover:underline">{e.number}</Link></td>
                  <td>{PURPOSE_LABEL[e.purpose]}</td>
                  <td>{showDate(e.postingDate)}</td>
                  <td>{e._count.lines}</td>
                  <td><DocStatus status={e.status} /></td>
                  <td className="text-right"><Money value={e.totalValue} /></td>
                  <td className="text-caption text-muted">{e.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
