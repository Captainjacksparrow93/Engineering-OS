import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { getItem } from '@/modules/sales/services/catalog.service';
import { PRICE_SOURCE_LABELS, PRICE_SOURCES } from '@/modules/sales/domain/pricing';
import { addPriceAction, updateItemAction } from '@/app/actions/sales';
import { Card, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '@/components/action-form';
import { formatINR, isoDay, pct, shortDate } from '../../_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Item' };

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  let item;
  try {
    item = await getItem(principal, id);
  } catch {
    notFound();
  }
  const canManage = hasPermissionAnywhere(principal, 'sales.catalog.manage');

  return (
    <div className="space-y-lg">
      <PageHeader
        title={item.name}
        breadcrumb={[{ label: 'Price catalogue', href: '/sales/catalog' }, { label: item.code }]}
        subtitle={
          item.latest
            ? `Latest: ${formatINR(item.latest.rate)} per ${item.uom}, ${PRICE_SOURCE_LABELS[item.latest.source].toLowerCase()}, ${shortDate(item.latest.effectiveDate)}${item.latest.stale ? ' (old)' : ''}`
            : 'No price yet'
        }
      />
      <div className="grid gap-lg lg:grid-cols-[1fr_340px]">
        <Card title="Price history" bodyClassName="p-0">
          {item.prices.length === 0 ? (
            <p className="p-base text-body-sm text-muted">No prices yet.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Source</th><th className="text-right">Net cost</th><th className="text-right">List / discount</th><th>Supplier</th><th>Reference</th></tr></thead>
              <tbody>
                {item.prices.map((p) => (
                  <tr key={p.id}>
                    <td>{shortDate(p.effectiveDate)}</td>
                    <td>{PRICE_SOURCE_LABELS[p.source]}</td>
                    <td className="text-right">{formatINR(p.rate)}</td>
                    <td className="text-right">{p.listPrice ? `${formatINR(p.listPrice)}${p.discountPct ? ` − ${pct(p.discountPct)}` : ''}` : '—'}</td>
                    <td>{p.supplier ?? '—'}</td>
                    <td>{p.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {canManage ? (
          <div className="space-y-lg">
            <Card title="Add a price">
              <ActionForm action={addPriceAction} resetOnSuccess className="space-y-sm">
                <input type="hidden" name="itemId" value={item.id} />
                <select name="source" defaultValue="PURCHASE" className="select w-full" aria-label="Source">
                  {PRICE_SOURCES.map((s) => <option key={s} value={s}>{PRICE_SOURCE_LABELS[s]}</option>)}
                </select>
                <input name="rate" type="number" min={0} step="any" placeholder="Net cost (₹)" className="input w-full" aria-label="Net cost" />
                <div className="grid grid-cols-2 gap-sm">
                  <input name="listPrice" type="number" min={0} step="any" placeholder="or list price" className="input w-full" aria-label="List price" />
                  <input name="discountPct" type="number" min={0} max={100} step="any" placeholder="discount %" className="input w-full" aria-label="Discount percent" />
                </div>
                <input name="supplier" placeholder="Supplier" className="input w-full" aria-label="Supplier" />
                <input name="reference" placeholder="PO or price-list reference" className="input w-full" aria-label="Reference" />
                <input name="effectiveDate" type="date" defaultValue={isoDay(new Date())} required className="input w-full" aria-label="Date" />
                <SubmitButton>Add price</SubmitButton>
              </ActionForm>
            </Card>
            <Card title="Item details">
              <ActionForm action={updateItemAction} className="space-y-xs">
                <input type="hidden" name="itemId" value={item.id} />
                <input name="code" defaultValue={item.code} required className="input w-full" aria-label="Item code" />
                <input name="name" defaultValue={item.name} required className="input w-full" aria-label="Name" />
                <input name="make" defaultValue={item.make ?? ''} placeholder="Make" className="input w-full" aria-label="Make" />
                <input name="makerPartNo" defaultValue={item.makerPartNo ?? ''} placeholder="Maker part no." className="input w-full" aria-label="Maker part number" />
                <input name="category" defaultValue={item.category ?? ''} placeholder="Category" className="input w-full" aria-label="Category" />
                <input name="uom" defaultValue={item.uom} className="input w-full" aria-label="Unit" />
                <input name="erpItemCode" defaultValue={item.erpItemCode ?? ''} placeholder="ERPNext item code" className="input w-full" aria-label="ERPNext item code" />
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
