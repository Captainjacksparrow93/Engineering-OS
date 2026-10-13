import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { NotFoundError } from '@/core/rbac/errors';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getItem, itemGroups, warehouseOptions } from '@/modules/erp/services/item.service';
import { setItemActiveAction, updateItemAction } from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { Money, Qty, showDate } from '../../../_components/parts';
import { StockTabs } from '../../tabs';
import { ItemFields } from '../item-form';

export const dynamic = 'force-dynamic';

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const { id } = await params;
  const data = await getItem(p, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { item, ledger } = data;
  const [groups, warehouses] = await Promise.all([itemGroups(p.companyId), warehouseOptions(p.companyId)]);
  const whName = new Map(item.bins.map((b) => [b.warehouseId, b.warehouse.name]));
  const manage = canManage(p, 'stock');

  return (
    <div className="space-y-lg">
      <PageHeader
        title={`${item.code} · ${item.name}`}
        subtitle={[item.itemGroup, item.make, item.makerPartNo].filter(Boolean).join(' · ')}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Items', href: '/erp/stock/items' }, { label: item.code }]}
        actions={manage ? <DocButton action={setItemActiveAction} fields={{ itemId: item.id, active: String(!item.isActive) }} label={item.isActive ? 'Switch off' : 'Switch on'} confirm={item.isActive ? `Switch off ${item.code}? It can't be used on new documents.` : undefined} /> : null}
      />
      <StockTabs current="/erp/stock/items" />

      {item.isStockItem ? (
        <Card title="Stock by warehouse">
          {item.bins.length === 0 ? (
            <EmptyState title="No stock movements yet" />
          ) : (
            <table className="table">
              <thead><tr><th>Warehouse</th><th className="text-right">In stock</th><th className="text-right">Valuation rate</th><th className="text-right">Value</th><th className="text-right">Ordered</th><th className="text-right">Reserved</th></tr></thead>
              <tbody>
                {item.bins.map((b) => (
                  <tr key={b.id}>
                    <td>{b.warehouse.name}</td>
                    <td className="text-right"><Qty value={b.actualQty} uom={item.uom} /></td>
                    <td className="text-right"><Money value={b.valuationRate} /></td>
                    <td className="text-right"><Money value={b.stockValue} /></td>
                    <td className="text-right"><Qty value={b.orderedQty} /></td>
                    <td className="text-right"><Qty value={b.reservedQty} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {ledger.length ? (
        <Card title="Latest movements">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Document</th><th>Warehouse</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Balance</th><th className="text-right">Value after</th></tr></thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{showDate(l.postingDate)}</td>
                    <td><span className="text-caption text-muted">{l.voucherType}</span> <span className="code">{l.voucherNo}</span></td>
                    <td>{whName.get(l.warehouseId) ?? '—'}</td>
                    <td className={`text-right ${l.qtyChange.isNegative() ? 'text-error' : ''}`}><Qty value={l.qtyChange} /></td>
                    <td className="text-right"><Money value={l.rate} /></td>
                    <td className="text-right"><Qty value={l.qtyAfter} /></td>
                    <td className="text-right"><Money value={l.stockValue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {manage ? (
        <Card title="Details">
          <ActionForm action={updateItemAction} className="space-y-base">
            <input type="hidden" name="itemId" value={item.id} />
            <ItemFields item={item} groups={groups} warehouses={warehouses} />
            <SubmitButton pendingLabel="Saving…">Save item</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <Card title="Details">
          <dl className="grid gap-sm text-body-sm sm:grid-cols-3">
            <div><dt className="text-muted">Unit</dt><dd>{item.uom}</dd></div>
            <div><dt className="text-muted">GST</dt><dd>{item.gstRate.toString()}%</dd></div>
            <div><dt className="text-muted">HSN/SAC</dt><dd>{item.hsnCode ?? '—'}</dd></div>
            <div><dt className="text-muted">Selling rate</dt><dd>{item.standardRate ? <Money value={item.standardRate} /> : '—'}</dd></div>
            <div><dt className="text-muted">Last purchase rate</dt><dd>{item.lastPurchaseRate ? <Money value={item.lastPurchaseRate} /> : '—'}</dd></div>
            <div><dt className="text-muted">Reorder level</dt><dd>{item.reorderLevel ? <Qty value={item.reorderLevel} uom={item.uom} /> : '—'}</dd></div>
          </dl>
          {item.description ? <p className="mt-base text-body-sm">{item.description}</p> : null}
        </Card>
      )}
    </div>
  );
}
