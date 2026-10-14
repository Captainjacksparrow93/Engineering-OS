import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, projectOptions } from '@/modules/erp/services/access';
import { itemOptions } from '@/modules/erp/services/item.service';
import { listWorkOrders } from '@/modules/erp/services/work-order.service';
import { createWorkOrderAction } from '@/app/actions/erp-manufacturing';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, ItemDatalist, ProjectSelect, Qty, showDate } from '../../_components/parts';
import { ManufacturingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work orders' };

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const sp = await searchParams;
  const [rows, items, projects] = await Promise.all([listWorkOrders(p, sp), itemOptions(p.companyId, 'stock'), projectOptions(p.companyId)]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Work orders" subtitle="Usually made from a sales order (Make work orders) or a production plan." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Manufacturing', href: '/erp/manufacturing' }, { label: 'Work orders' }]} />
      <ManufacturingTabs current="/erp/manufacturing/work-orders" />
      {canManage(p, 'manufacturing') ? (
        <Card title="New work order">
          <ActionForm action={createWorkOrderAction} className="space-y-base">
            <ItemDatalist id="wo-items" items={items} />
            <div className="grid gap-sm sm:grid-cols-5">
              <Field label="Item to make" name="itemCode" required list="wo-items" />
              <Field label="Quantity" name="qty" type="number" required />
              <Field label="Planned start" name="plannedStart" type="date" />
              <Field label="Needed by" name="expectedEnd" type="date" />
              <ProjectSelect projects={projects} />
            </div>
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <form method="get" className="flex gap-sm">
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status">
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="DRAFT">Draft</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No work orders" /> : (
        <table className="table">
          <thead><tr><th>Work order</th><th>Item</th><th className="text-right">Qty</th><th className="text-right">Made</th><th>Sales order</th><th>Needed by</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td><Link href={`/erp/manufacturing/work-orders/${w.id}`} className="code hover:underline">{w.number}</Link></td>
                <td><span className="code mr-xs">{w.item?.code}</span>{w.item?.name}</td>
                <td className="text-right"><Qty value={w.qty} uom={w.item?.uom} /></td>
                <td className="text-right"><Qty value={w.producedQty} /></td>
                <td>{w.salesOrderId ? <Link href={`/erp/selling/orders/${w.salesOrderId}`} className="code hover:underline">{w.salesOrderNumber}</Link> : '—'}</td>
                <td>{showDate(w.expectedEnd)}</td>
                <td><DocStatus status={w.state.key} label={w.state.label} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
