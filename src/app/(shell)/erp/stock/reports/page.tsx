import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { itemGroups, itemOptions, warehouseOptions } from '@/modules/erp/services/item.service';
import { reorderList, stockBalance, stockLedger } from '@/modules/erp/services/stock-report.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { EmptyState, PageHeader } from '@/components/ui';
import { AreaTabs, ItemDatalist, Money, Qty, showDate, todayIso } from '../../_components/parts';
import { StockTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock reports' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function StockReportsPage({ searchParams }: { searchParams: Promise<{ view?: string; warehouseId?: string; group?: string; q?: string; item?: string; from?: string; to?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const sp = await searchParams;
  const view = sp.view === 'ledger' || sp.view === 'reorder' ? sp.view : 'balance';
  const [warehouses, groups, items] = await Promise.all([warehouseOptions(p.companyId), itemGroups(p.companyId), itemOptions(p.companyId, 'stock')]);

  return (
    <div className="space-y-lg">
      <PageHeader title="Stock reports" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock', href: '/erp/stock' }, { label: 'Reports' }]} />
      <StockTabs current="/erp/stock/reports" />
      <AreaTabs
        current={`/erp/stock/reports?view=${view}`}
        tabs={[
          { href: '/erp/stock/reports?view=balance', label: 'Stock balance' },
          { href: '/erp/stock/reports?view=ledger', label: 'Stock ledger' },
          { href: '/erp/stock/reports?view=reorder', label: 'Reorder' },
        ]}
      />
      {view === 'balance' ? <Balance p={p} sp={sp} warehouses={warehouses} groups={groups} /> : null}
      {view === 'ledger' ? <Ledger p={p} sp={sp} warehouses={warehouses} items={items} /> : null}
      {view === 'reorder' ? <Reorder p={p} /> : null}
    </div>
  );
}

type P = Awaited<ReturnType<typeof requirePrincipal>>;

async function Balance({ p, sp, warehouses, groups }: { p: P; sp: { warehouseId?: string; group?: string; q?: string }; warehouses: Array<{ id: string; name: string }>; groups: string[] }) {
  const { rows, totalValue } = await stockBalance(p, sp);
  return (
    <>
      <form method="get" className="flex flex-wrap gap-sm">
        <input type="hidden" name="view" value="balance" />
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Item code or name" className="input w-64" aria-label="Item" />
        <select name="warehouseId" defaultValue={sp.warehouseId ?? ''} className="select" aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select name="group" defaultValue={sp.group ?? ''} className="select" aria-label="Item group">
          <option value="">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No stock matches" /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Item</th><th>Warehouse</th><th className="text-right">Actual</th><th className="text-right">Ordered</th><th className="text-right">Requested</th><th className="text-right">Reserved</th><th className="text-right">Projected</th><th className="text-right">Rate</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/erp/stock/items/${r.item.id}`} className="hover:underline"><span className="code mr-xs">{r.item.code}</span>{r.item.name}</Link></td>
                  <td>{r.warehouse.name}</td>
                  <td className="text-right"><Qty value={r.actualQty} uom={r.item.uom} /></td>
                  <td className="text-right"><Qty value={r.orderedQty} /></td>
                  <td className="text-right"><Qty value={r.requestedQty} /></td>
                  <td className="text-right"><Qty value={r.reservedQty} /></td>
                  <td className={`text-right ${r.projectedQty.isNegative() ? 'text-error' : ''}`}><Qty value={r.projectedQty} /></td>
                  <td className="text-right"><Money value={r.valuationRate} /></td>
                  <td className="text-right"><Money value={r.stockValue} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={8} className="text-right font-medium">Total</td><td className="text-right font-medium">{formatMoney(totalValue)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}

async function Ledger({ p, sp, warehouses, items }: { p: P; sp: { warehouseId?: string; item?: string; from?: string; to?: string }; warehouses: Array<{ id: string; name: string }>; items: Array<{ id: string; code: string; name: string }> }) {
  const to = sp.to && DATE.test(sp.to) ? sp.to : todayIso();
  const from = sp.from && DATE.test(sp.from) ? sp.from : `${to.slice(0, 8)}01`;
  const itemId = sp.item ? items.find((i) => i.code === sp.item?.trim().toUpperCase())?.id : undefined;
  const { rows, items: itemMap, warehouses: whMap } = await stockLedger(p, { itemId, warehouseId: sp.warehouseId, from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T00:00:00Z`) });
  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-sm">
        <input type="hidden" name="view" value="ledger" />
        <ItemDatalist id="ledger-items" items={items} />
        <input name="item" defaultValue={sp.item ?? ''} list="ledger-items" placeholder="Item code" className="input w-48" aria-label="Item code" />
        <select name="warehouseId" defaultValue={sp.warehouseId ?? ''} className="select" aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input type="date" name="from" defaultValue={from} className="input" aria-label="From" />
        <input type="date" name="to" defaultValue={to} className="input" aria-label="To" />
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No movements in this period" /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Date</th><th>Item</th><th>Warehouse</th><th>Document</th><th className="text-right">In / out</th><th className="text-right">Rate</th><th className="text-right">Balance</th><th className="text-right">Valuation</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{showDate(r.postingDate)}</td>
                  <td><span className="code">{itemMap.get(r.itemId)?.code}</span></td>
                  <td>{whMap.get(r.warehouseId)}</td>
                  <td><span className="text-caption text-muted">{r.voucherType}</span> <span className="code">{r.voucherNo}</span></td>
                  <td className={`text-right ${r.qtyChange.isNegative() ? 'text-error' : ''}`}><Qty value={r.qtyChange} /></td>
                  <td className="text-right"><Money value={r.rate} /></td>
                  <td className="text-right"><Qty value={r.qtyAfter} /></td>
                  <td className="text-right"><Money value={r.valuationRate} /></td>
                  <td className="text-right"><Money value={r.stockValue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Reorder({ p }: { p: P }) {
  const rows = await reorderList(p);
  if (rows.length === 0) return <EmptyState title="Nothing to reorder" hint="Set a reorder level on an item to watch it here." />;
  return (
    <table className="table">
      <thead><tr><th>Item</th><th className="text-right">In stock</th><th className="text-right">Projected</th><th className="text-right">Reorder level</th><th className="text-right">Suggested order</th><th>Lead time</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><Link href={`/erp/stock/items/${r.id}`} className="hover:underline"><span className="code mr-xs">{r.code}</span>{r.name}</Link></td>
            <td className="text-right"><Qty value={r.actualQty} uom={r.uom} /></td>
            <td className="text-right text-error"><Qty value={r.projectedQty} /></td>
            <td className="text-right"><Qty value={r.reorderLevel} /></td>
            <td className="text-right font-medium"><Qty value={r.suggestedQty} uom={r.uom} /></td>
            <td>{r.leadTimeDays ? `${r.leadTimeDays} days` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
