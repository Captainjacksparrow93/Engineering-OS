import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { partyOptions } from '@/modules/erp/services/party.service';
import { listSalesOrders } from '@/modules/erp/services/sales-order.service';
import { createSalesOrderAction } from '@/app/actions/erp-selling';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { SellingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales orders' };

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling')) notFound();
  const sp = await searchParams;
  const [rows, customers] = await Promise.all([listSalesOrders(p, sp), partyOptions(p.companyId, 'CUSTOMER')]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Sales orders" subtitle="Confirmed orders. A submitted order with panel lines and a WO number becomes a project in New project." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Selling', href: '/erp/selling' }, { label: 'Sales orders' }]} />
      <SellingTabs current="/erp/selling/orders" />
      {canManage(p, 'selling') ? (
        <Card title="New sales order">
          {customers.length === 0 ? <p className="text-body-sm text-muted">Add a customer first.</p> : (
            <ActionForm action={createSalesOrderAction} className="space-y-base">
              <div className="grid gap-sm sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="customerId">Customer</label>
                  <select id="customerId" name="customerId" className="select w-full" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                </div>
                <Field label="Order date" name="orderDate" type="date" defaultValue={todayIso()} required />
                <Field label="Delivery date" name="deliveryDate" type="date" />
                <Field label="WO number" name="woNumber" placeholder="Digits only" />
                <Field label="Client PO number" name="poNo" />
              </div>
              <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
            </ActionForm>
          )}
        </Card>
      ) : null}
      <form method="get" className="flex flex-wrap gap-sm">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Order, WO or client PO" className="input w-64" aria-label="Search" />
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status">
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="NO_PROJECT">Waiting for a project</option>
          <option value="DRAFT">Draft</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No sales orders" /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Order</th><th>Customer</th><th>WO</th><th>Project</th><th>Delivery</th><th>Status</th><th className="text-right">Delivered</th><th className="text-right">Billed</th><th className="text-right">Grand total</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/erp/selling/orders/${o.id}`} className="code hover:underline">{o.number}</Link>{o.poNo ? <span className="block text-caption text-muted">PO {o.poNo}</span> : null}</td>
                  <td>{o.customerName}</td>
                  <td className="code">{o.woNumber ?? '—'}</td>
                  <td>{o.projectId ? <Link href={`/pm/projects/${o.projectId}`} className="code hover:underline">{o.projectCode}</Link> : o.status === 'SUBMITTED' ? <span className="text-caption text-muted">Waiting</span> : '—'}</td>
                  <td>{showDate(o.deliveryDate)}</td>
                  <td><DocStatus status={o.state.key} label={o.state.label} /></td>
                  <td className="text-right">{o.status === 'SUBMITTED' ? `${o.state.delivered}%` : '—'}</td>
                  <td className="text-right">{o.status === 'SUBMITTED' ? `${o.state.billed}%` : '—'}</td>
                  <td className="text-right"><Money value={o.grandTotal} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
