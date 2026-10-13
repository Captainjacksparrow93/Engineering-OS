import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { itemGroups, listItems, warehouseOptions } from '@/modules/erp/services/item.service';
import { createItemAction } from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Money, Qty } from '../../_components/parts';
import { StockTabs } from '../tabs';
import { ItemFields } from './item-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Items' };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string; group?: string; inactive?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const sp = await searchParams;
  const [items, groups, warehouses] = await Promise.all([
    listItems(p, { q: sp.q, group: sp.group, includeInactive: sp.inactive === '1' }),
    itemGroups(p.companyId),
    warehouseOptions(p.companyId),
  ]);
  const manage = canManage(p, 'stock');

  return (
    <div className="space-y-lg">
      <PageHeader title="Items" subtitle="The company's item master. Sales quotes and every ERP document use these codes." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock', href: '/erp/stock' }, { label: 'Items' }]} />
      <StockTabs current="/erp/stock/items" />

      <form method="get" className="flex flex-wrap items-end gap-sm">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Code, name, make or part number" className="input w-80" aria-label="Search items" />
        <select name="group" defaultValue={sp.group ?? ''} className="select" aria-label="Item group">
          <option value="">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <label className="flex items-center gap-xs text-body-sm"><input type="checkbox" name="inactive" value="1" defaultChecked={sp.inactive === '1'} /> Include switched-off items</label>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>

      {items.length === 0 ? (
        <EmptyState title={sp.q || sp.group ? 'No items match' : 'No items yet'} hint={manage ? 'Add the first item below.' : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Item</th><th>Group</th><th>Make</th><th className="text-right">In stock</th><th className="text-right">Stock value</th><th className="text-right">Selling rate</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={i.isActive ? '' : 'text-muted'}>
                  <td>
                    <Link href={`/erp/stock/items/${i.id}`} className="hover:underline"><span className="code mr-xs">{i.code}</span>{i.name}</Link>
                    {!i.isActive ? <span className="badge badge-outline ml-xs">Off</span> : null}
                    {!i.isStockItem ? <span className="badge badge-outline ml-xs">Non-stock</span> : null}
                  </td>
                  <td>{i.itemGroup}</td>
                  <td>{i.make ?? '—'}</td>
                  <td className="text-right">{i.isStockItem ? <Qty value={i.stockQty} uom={i.uom} /> : '—'}</td>
                  <td className="text-right">{i.isStockItem ? <Money value={i.stockValue} /> : '—'}</td>
                  <td className="text-right">{i.standardRate ? <Money value={i.standardRate} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {manage ? (
        <Card title="Add an item">
          <ActionForm action={createItemAction} className="space-y-base">
            <ItemFields groups={groups} warehouses={warehouses} />
            <SubmitButton variant="primary" pendingLabel="Adding…">Add item</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
