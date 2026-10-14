import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { listSalesOrders } from '@/modules/erp/services/sales-order.service';
import { listSalesInvoices } from '@/modules/erp/services/sales-invoice.service';
import { formatMoney, sum } from '@/modules/erp/domain/money';
import { topItemsSold, topParties } from '@/modules/erp/services/analytics.service';
import { BarList } from '../_components/charts';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocStatus, Money, showDate } from '../_components/parts';
import { SellingTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Selling' };

export default async function SellingPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling')) notFound();
  const today = new Date();
  const [open, invoices, top, items] = await Promise.all([listSalesOrders(p, { status: 'OPEN' }), listSalesInvoices(p, { status: 'UNPAID', today }), topParties(p, 'CUSTOMER'), topItemsSold(p)]);
  const waiting = open.filter((o) => !o.projectId);
  const toDeliver = open.filter((o) => o.state.delivered < 100);
  const overdue = invoices.filter((i) => i.state.key === 'OVERDUE');
  return (
    <div className="space-y-lg">
      <PageHeader title="Selling" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Selling' }]} actions={<Link href="/erp/selling/orders" className="btn btn-primary">Sales orders</Link>} />
      <SellingTabs current="/erp/selling" />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Waiting for a project" value={waiting.length} />
        <Stat label="Orders to deliver" value={toDeliver.length} />
        <Stat label="Receivable" value={formatMoney(sum(invoices, (i) => i.outstandingAmount))} />
        <Stat label="Overdue invoices" value={overdue.length} tone={overdue.length ? 'warning' : 'default'} />
      </div>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Waiting for a project" action={<Link href="/erp/selling/orders?status=NO_PROJECT" className="link-muted text-caption">All</Link>}>
          {waiting.length === 0 ? <EmptyState title="Every open order has a project" /> : (
            <table className="table"><tbody>{waiting.slice(0, 8).map((o) => <tr key={o.id}><td><Link href={`/erp/selling/orders/${o.id}`} className="code hover:underline">{o.number}</Link></td><td>{o.customerName}</td><td className="code">{o.woNumber ? `WO ${o.woNumber}` : ''}</td><td>{showDate(o.deliveryDate)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="To deliver" action={<Link href="/erp/selling/orders?status=OPEN" className="link-muted text-caption">All</Link>}>
          {toDeliver.length === 0 ? <EmptyState title="Nothing to deliver" /> : (
            <table className="table"><tbody>{toDeliver.slice(0, 8).map((o) => <tr key={o.id}><td><Link href={`/erp/selling/orders/${o.id}`} className="code hover:underline">{o.number}</Link></td><td>{o.customerName}</td><td>{showDate(o.deliveryDate)}</td><td className="text-right">{o.state.delivered}% out</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
      <Card title="Money to collect" action={<Link href="/erp/selling/invoices?status=UNPAID" className="link-muted text-caption">All</Link>}>
        {invoices.length === 0 ? <EmptyState title="Nothing outstanding" /> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Status</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>{invoices.slice(0, 10).map((i) => <tr key={i.id}><td><Link href={`/erp/selling/invoices/${i.id}`} className="code hover:underline">{i.number}</Link></td><td>{i.customerName}</td><td>{showDate(i.dueDate)}</td><td><DocStatus status={i.state.key} label={i.state.label} /></td><td className="text-right"><Money value={i.outstandingAmount} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Top customers this year"><BarList rows={top} empty="No invoices yet this year." /></Card>
        <Card title="Top items sold this year"><BarList rows={items} empty="No item sales yet this year." /></Card>
      </div>
    </div>
  );
}
