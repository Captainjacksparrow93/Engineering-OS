import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { reorderList, stockSummary } from '@/modules/erp/services/stock-report.service';
import { listStockEntries, PURPOSE_LABEL } from '@/modules/erp/services/stock-entry.service';
import { warehouseOptions } from '@/modules/erp/services/item.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { Alert, Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocStatus, Money, Qty, showDate } from '../_components/parts';
import { StockTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock' };

export default async function StockOverviewPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const [summary, reorder, recent, warehouses] = await Promise.all([stockSummary(p), reorderList(p), listStockEntries(p), warehouseOptions(p.companyId)]);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const mismatch = !summary.stockValue.equals(summary.glValue);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Stock"
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock' }]}
        actions={canManage(p, 'stock') ? <Link href="/erp/stock/entries?new=MATERIAL_RECEIPT" className="btn btn-primary">New stock entry</Link> : null}
      />
      <StockTabs current="/erp/stock" />

      <div className="grid gap-base sm:grid-cols-3">
        <Stat label="Stock value" value={formatMoney(summary.stockValue)} />
        <Stat label="Below reorder level" value={reorder.length} tone={reorder.length ? 'warning' : 'default'} />
        <Stat label="Draft entries" value={recent.filter((e) => e.status === 'DRAFT').length} />
      </div>
      {mismatch ? (
        <Alert tone="warning">Stock value ({formatMoney(summary.stockValue)}) and the Stock In Hand account ({formatMoney(summary.glValue)}) differ. Check journal entries posted to Stock In Hand.</Alert>
      ) : null}

      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Value by warehouse">
          {summary.byWarehouse.length === 0 ? (
            <EmptyState title="No stock yet" hint="Post opening stock with a stock count, or receive stock with a stock entry." />
          ) : (
            <table className="table">
              <tbody>
                {summary.byWarehouse.map((w) => (
                  <tr key={w.warehouseId}><td>{whName.get(w.warehouseId) ?? 'Inactive warehouse'}</td><td className="text-right"><Money value={w._sum.stockValue} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Reorder now" action={<Link href="/erp/stock/reports?view=reorder" className="link-muted text-caption">All</Link>}>
          {reorder.length === 0 ? (
            <EmptyState title="Nothing to reorder" hint="Items show here when their projected quantity falls to the reorder level." />
          ) : (
            <table className="table">
              <thead><tr><th>Item</th><th className="text-right">Projected</th><th className="text-right">Reorder level</th></tr></thead>
              <tbody>
                {reorder.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/erp/stock/items/${r.id}`} className="hover:underline"><span className="code mr-xs">{r.code}</span>{r.name}</Link></td>
                    <td className="text-right text-error"><Qty value={r.projectedQty} /></td>
                    <td className="text-right"><Qty value={r.reorderLevel} uom={r.uom} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Recent stock entries" action={<Link href="/erp/stock/entries" className="link-muted text-caption">All</Link>}>
        {recent.length === 0 ? (
          <EmptyState title="No stock entries yet" />
        ) : (
          <table className="table">
            <thead><tr><th>Entry</th><th>Purpose</th><th>Date</th><th>Status</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {recent.slice(0, 8).map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/erp/stock/entries/${e.id}`} className="code hover:underline">{e.number}</Link></td>
                  <td>{PURPOSE_LABEL[e.purpose]}</td>
                  <td>{showDate(e.postingDate)}</td>
                  <td><DocStatus status={e.status} /></td>
                  <td className="text-right"><Money value={e.totalValue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
