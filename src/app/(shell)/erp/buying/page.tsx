import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { listMaterialRequests, MR_PURPOSE_LABEL } from '@/modules/erp/services/material-request.service';
import { listPurchaseOrders } from '@/modules/erp/services/purchase-order.service';
import { listPurchaseInvoices } from '@/modules/erp/services/purchase-invoice.service';
import { formatMoney, sum } from '@/modules/erp/domain/money';
import { topParties } from '@/modules/erp/services/analytics.service';
import { BarList } from '../_components/charts';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocStatus, Money, showDate } from '../_components/parts';
import { BuyingTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Buying' };

export default async function BuyingPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const today = new Date();
  const [requests, orders, invoices, top] = await Promise.all([listMaterialRequests(p, { open: true }), listPurchaseOrders(p, { status: 'OPEN' }), listPurchaseInvoices(p, { status: 'UNPAID', today }), topParties(p, 'SUPPLIER')]);
  const toReceive = orders.filter((o) => o.state.received < 100);
  const pendingRequests = requests.filter((r) => r.purpose === 'PURCHASE' && r.state.key !== 'COMPLETED');
  const overdue = invoices.filter((i) => i.state.key === 'OVERDUE');
  return (
    <div className="space-y-lg">
      <PageHeader title="Buying" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Buying' }]} />
      <BuyingTabs current="/erp/buying" />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Requests to buy" value={pendingRequests.length} />
        <Stat label="Orders to receive" value={toReceive.length} />
        <Stat label="Unpaid bills" value={formatMoney(sum(invoices, (i) => i.outstandingAmount))} />
        <Stat label="Overdue bills" value={overdue.length} tone={overdue.length ? 'warning' : 'default'} />
      </div>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Requests waiting to be bought" action={<Link href="/erp/buying/requests?open=1" className="link-muted text-caption">All</Link>}>
          {pendingRequests.length === 0 ? <EmptyState title="Nothing waiting" /> : (
            <table className="table"><tbody>{pendingRequests.slice(0, 8).map((r) => <tr key={r.id}><td><Link href={`/erp/buying/requests/${r.id}`} className="code hover:underline">{r.number}</Link></td><td>{MR_PURPOSE_LABEL[r.purpose]}</td><td>{r.requiredBy ? `by ${showDate(r.requiredBy)}` : ''}</td><td><DocStatus status={r.state.key} label={r.state.label} /></td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Orders still to arrive" action={<Link href="/erp/buying/orders?status=OPEN" className="link-muted text-caption">All</Link>}>
          {toReceive.length === 0 ? <EmptyState title="Nothing on order" /> : (
            <table className="table"><tbody>{toReceive.slice(0, 8).map((o) => <tr key={o.id}><td><Link href={`/erp/buying/orders/${o.id}`} className="code hover:underline">{o.number}</Link></td><td>{o.supplierName}</td><td>{o.scheduleDate ? `by ${showDate(o.scheduleDate)}` : ''}</td><td className="text-right">{o.state.received}% in</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
      <Card title="Bills to pay" action={<Link href="/erp/buying/invoices?status=UNPAID" className="link-muted text-caption">All</Link>}>
        {invoices.length === 0 ? <EmptyState title="No unpaid bills" /> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Supplier</th><th>Due</th><th>Status</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>{invoices.slice(0, 10).map((i) => <tr key={i.id}><td><Link href={`/erp/buying/invoices/${i.id}`} className="code hover:underline">{i.number}</Link></td><td>{i.supplierName}</td><td>{showDate(i.dueDate)}</td><td><DocStatus status={i.state.key} label={i.state.label} /></td><td className="text-right"><Money value={i.outstandingAmount} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Top suppliers this year"><BarList rows={top} empty="No invoices yet this year." /></Card>
      </div>
    </div>
  );
}
