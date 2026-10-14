import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listWarehouses } from '@/modules/erp/services/item.service';
import { createWarehouseAction, renameWarehouseAction, setWarehouseActiveAction } from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, PageHeader } from '@/components/ui';
import { DocButton } from '../../_components/doc-button';
import { Money } from '../../_components/parts';
import { StockTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Warehouses' };

export default async function WarehousesPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const rows = await listWarehouses(p);
  const manage = canManage(p, 'stock');
  return (
    <div className="space-y-lg">
      <PageHeader title="Warehouses" subtitle="Stores, Work In Progress, Finished Goods and Rejected come built in. Add racks, sites or a scrap yard as needed." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock', href: '/erp/stock' }, { label: 'Warehouses' }]} />
      <StockTabs current="/erp/stock/warehouses" />
      <table className="table">
        <thead><tr><th>Warehouse</th><th className="text-right">Items held</th><th className="text-right">Stock value</th>{manage ? <th /> : null}</tr></thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className={w.isActive ? '' : 'text-muted'}>
              <td>
                {manage ? (
                  <ActionForm action={renameWarehouseAction} quiet className="flex items-center gap-xs">
                    <input type="hidden" name="warehouseId" value={w.id} />
                    <input name="name" defaultValue={w.name} className="input" aria-label={`Name of ${w.name}`} />
                    <SubmitButton size="sm">Rename</SubmitButton>
                  </ActionForm>
                ) : w.name}
                {w.systemKey ? <span className="badge badge-outline ml-xs">Default</span> : null}
                {!w.isActive ? <span className="badge badge-outline ml-xs">Off</span> : null}
              </td>
              <td className="text-right">{w.itemCount}</td>
              <td className="text-right"><Money value={w.stockValue} /></td>
              {manage ? <td className="text-right">{w.systemKey ? null : <DocButton action={setWarehouseActiveAction} fields={{ warehouseId: w.id, active: String(!w.isActive) }} label={w.isActive ? 'Switch off' : 'Switch on'} />}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {manage ? (
        <Card title="Add a warehouse">
          <ActionForm action={createWarehouseAction} resetOnSuccess className="flex flex-wrap items-end gap-sm">
            <div className="min-w-[16rem]"><label className="label" htmlFor="wh-name">Name</label><input id="wh-name" name="name" required className="input w-full" placeholder="Site store, Vadodara" /></div>
            <SubmitButton>Add warehouse</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
