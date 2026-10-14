import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { listWorkOrders } from '@/modules/erp/services/work-order.service';
import { JOB_STATUS_LABEL, listJobCards } from '@/modules/erp/services/job-card.service';
import { listSalesOrders } from '@/modules/erp/services/sales-order.service';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocStatus, Qty, showDate } from '../_components/parts';
import { ManufacturingTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Manufacturing' };

export default async function ManufacturingPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const [orders, cards] = await Promise.all([listWorkOrders(p, { status: 'OPEN' }), listJobCards(p)]);
  const salesOrders = canRead(p, 'selling') ? await listSalesOrders(p, { status: 'OPEN' }) : [];
  const late = orders.filter((o) => o.expectedEnd && o.expectedEnd < new Date());
  return (
    <div className="space-y-lg">
      <PageHeader title="Manufacturing" subtitle="Panel production: work orders, the shop floor's job cards, and planning from sales orders." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Manufacturing' }]} actions={<Link href="/erp/manufacturing/plans" className="btn btn-primary">Plan production</Link>} />
      <ManufacturingTabs current="/erp/manufacturing" />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Open work orders" value={orders.length} />
        <Stat label="Late" value={late.length} tone={late.length ? 'warning' : 'default'} />
        <Stat label="Job cards in progress" value={cards.filter((c) => c.status === 'WORK_IN_PROGRESS').length} />
        <Stat label="Open sales orders" value={salesOrders.length} />
      </div>
      <Card title="Open work orders" action={<Link href="/erp/manufacturing/work-orders?status=OPEN" className="link-muted text-caption">All</Link>}>
        {orders.length === 0 ? <EmptyState title="Nothing in production" /> : (
          <table className="table">
            <thead><tr><th>Work order</th><th>Item</th><th className="text-right">Made</th><th>Needed by</th><th>Status</th></tr></thead>
            <tbody>{orders.slice(0, 12).map((o) => <tr key={o.id}><td><Link href={`/erp/manufacturing/work-orders/${o.id}`} className="code hover:underline">{o.number}</Link></td><td>{o.item?.code} {o.item?.name}</td><td className="text-right"><Qty value={o.producedQty} /> / <Qty value={o.qty} /></td><td className={o.expectedEnd && o.expectedEnd < new Date() ? 'text-error' : ''}>{showDate(o.expectedEnd)}</td><td><DocStatus status={o.state.key} label={o.state.label} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Card title="Shop floor" action={<Link href="/erp/manufacturing/job-cards" className="link-muted text-caption">All job cards</Link>}>
        {cards.length === 0 ? <EmptyState title="No open job cards" /> : (
          <table className="table">
            <tbody>{cards.slice(0, 12).map((c) => <tr key={c.id}><td><Link href={`/erp/manufacturing/job-cards/${c.id}`} className="code hover:underline">{c.number}</Link></td><td>{c.operation}</td><td>{c.workstationName}</td><td>{c.workOrder?.itemCode}</td><td><DocStatus status={c.status} label={JOB_STATUS_LABEL[c.status]} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
