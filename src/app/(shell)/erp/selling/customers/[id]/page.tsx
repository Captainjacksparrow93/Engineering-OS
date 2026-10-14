import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getParty, partyBalance } from '@/modules/erp/services/party.service';
import { listSalesOrders } from '@/modules/erp/services/sales-order.service';
import { listSalesInvoices } from '@/modules/erp/services/sales-invoice.service';
import { setCustomerActiveAction, updateCustomerAction } from '@/app/actions/erp-selling';
import { formatMoney } from '@/modules/erp/domain/money';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { PartyFields } from '../../../_components/party-fields';
import { DocStatus, Money, orNotFound, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling')) notFound();
  const { id } = await params;
  const customer = await orNotFound(getParty(p, 'CUSTOMER', id));
  const [orders, invoices, balance, client] = await Promise.all([
    listSalesOrders(p, { customerId: id }),
    listSalesInvoices(p, { customerId: id, today: new Date() }),
    partyBalance(p.companyId, 'CUSTOMER', id),
    customer.clientId ? prisma.client.findUnique({ where: { id: customer.clientId }, select: { id: true, refNumber: true } }) : null,
  ]);
  const manage = canManage(p, 'selling');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={customer.name}
        subtitle={<span>{[customer.code, customer.city, customer.state, customer.gstin].filter(Boolean).join(' · ')}{client ? <> · <Link href={`/pm/clients/${client.id}`} className="hover:underline">{client.refNumber}</Link></> : null}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Customers', href: '/erp/selling/customers' }, { label: customer.name }]}
        actions={manage ? <DocButton action={setCustomerActiveAction} fields={{ id, active: String(!customer.isActive) }} label={customer.isActive ? 'Switch off' : 'Switch on'} /> : null}
      />
      <div className="grid gap-base sm:grid-cols-3">
        <Stat label="They owe us" value={formatMoney(balance)} tone={balance.greaterThan(0) ? 'warning' : 'default'} />
        <Stat label="Credit limit" value={customer.creditLimit ? formatMoney(customer.creditLimit) : 'None'} />
        <Stat label="Open orders" value={orders.filter((o) => o.status === 'SUBMITTED' && !o.isClosed).length} />
      </div>
      <Card title="Sales orders">
        {orders.length === 0 ? <EmptyState title="No orders yet" /> : (
          <table className="table">
            <thead><tr><th>Order</th><th>WO</th><th>Project</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr></thead>
            <tbody>{orders.slice(0, 20).map((o) => <tr key={o.id}><td><Link href={`/erp/selling/orders/${o.id}`} className="code hover:underline">{o.number}</Link></td><td className="code">{o.woNumber ?? '—'}</td><td>{o.projectId ? <Link href={`/pm/projects/${o.projectId}`} className="code hover:underline">{o.projectCode}</Link> : '—'}</td><td>{showDate(o.orderDate)}</td><td><DocStatus status={o.state.key} label={o.state.label} /></td><td className="text-right"><Money value={o.grandTotal} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Card title="Invoices">
        {invoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>{invoices.slice(0, 20).map((i) => <tr key={i.id}><td><Link href={`/erp/selling/invoices/${i.id}`} className="code hover:underline">{i.number}</Link></td><td>{showDate(i.postingDate)}</td><td>{showDate(i.dueDate)}</td><td><DocStatus status={i.state.key} label={i.state.label} /></td><td className="text-right"><Money value={i.grandTotal} /></td><td className="text-right"><Money value={i.outstandingAmount} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      {manage ? (
        <Card title="Details">
          <ActionForm action={updateCustomerAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <PartyFields party={customer} customer />
            <SubmitButton pendingLabel="Saving…">Save customer</SubmitButton>
            {customer.clientId ? <p className="text-caption text-muted">Renaming the customer renames its PM client and projects too.</p> : null}
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
