import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, projectOptions } from '@/modules/erp/services/access';
import { partyOptions } from '@/modules/erp/services/party.service';
import { listPurchaseOrders } from '@/modules/erp/services/purchase-order.service';
import { createPurchaseOrderAction } from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, ProjectSelect, showDate, todayIso } from '../../_components/parts';
import { BuyingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Purchase orders' };

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const sp = await searchParams;
  const [rows, suppliers, projects] = await Promise.all([listPurchaseOrders(p, sp), partyOptions(p.companyId, 'SUPPLIER'), projectOptions(p.companyId)]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Purchase orders" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Buying', href: '/erp/buying' }, { label: 'Purchase orders' }]} />
      <BuyingTabs current="/erp/buying/orders" />
      {canManage(p, 'buying') ? (
        <Card title="New purchase order">
          <ActionForm action={createPurchaseOrderAction} className="space-y-base">
            <div className="grid gap-sm sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="supplierId">Supplier</label>
                <select id="supplierId" name="supplierId" className="select w-full" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </div>
              <Field label="Order date" name="orderDate" type="date" defaultValue={todayIso()} required />
              <Field label="Required by" name="scheduleDate" type="date" />
              <ProjectSelect projects={projects} />
              <Field label="Supplier's ref." name="supplierRef" />
            </div>
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <form method="get" className="flex flex-wrap gap-sm">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Order number or supplier ref." className="input w-64" aria-label="Search" />
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status">
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="DRAFT">Draft</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No purchase orders" /> : (
        <table className="table">
          <thead><tr><th>Order</th><th>Supplier</th><th>Date</th><th>Required by</th><th>Status</th><th className="text-right">Received</th><th className="text-right">Billed</th><th className="text-right">Grand total</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/erp/buying/orders/${o.id}`} className="code hover:underline">{o.number}</Link></td>
                <td>{o.supplierName}</td>
                <td>{showDate(o.orderDate)}</td>
                <td>{showDate(o.scheduleDate)}</td>
                <td><DocStatus status={o.state.key} label={o.state.label} /></td>
                <td className="text-right">{o.status === 'SUBMITTED' ? `${o.state.received}%` : '—'}</td>
                <td className="text-right">{o.status === 'SUBMITTED' ? `${o.state.billed}%` : '—'}</td>
                <td className="text-right"><Money value={o.grandTotal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
