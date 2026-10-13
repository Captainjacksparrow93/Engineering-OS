import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getParty, partyBalance } from '@/modules/erp/services/party.service';
import { listPurchaseOrders } from '@/modules/erp/services/purchase-order.service';
import { listPurchaseInvoices } from '@/modules/erp/services/purchase-invoice.service';
import { setSupplierActiveAction, updateSupplierAction } from '@/app/actions/erp-buying';
import { formatMoney } from '@/modules/erp/domain/money';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { PartyFields } from '../../../_components/party-fields';
import { DocStatus, Money, orNotFound, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const { id } = await params;
  const supplier = await orNotFound(getParty(p, 'SUPPLIER', id));
  const today = new Date();
  const [orders, invoices, balance] = await Promise.all([listPurchaseOrders(p, { supplierId: id }), listPurchaseInvoices(p, { supplierId: id, today }), partyBalance(p.companyId, 'SUPPLIER', id)]);
  const manage = canManage(p, 'buying');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={supplier.name}
        subtitle={[supplier.code, supplier.city, supplier.state, supplier.gstin].filter(Boolean).join(' · ')}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Suppliers', href: '/erp/buying/suppliers' }, { label: supplier.name }]}
        actions={manage ? <DocButton action={setSupplierActiveAction} fields={{ id, active: String(!supplier.isActive) }} label={supplier.isActive ? 'Switch off' : 'Switch on'} /> : null}
      />
      <div className="grid gap-base sm:grid-cols-3">
        <Stat label="We owe them" value={formatMoney(balance)} tone={balance.greaterThan(0) ? 'warning' : 'default'} />
        <Stat label="Purchase orders" value={orders.length} />
        <Stat label="Unpaid invoices" value={invoices.filter((i) => i.state.key === 'UNPAID' || i.state.key === 'OVERDUE' || i.state.key === 'PARTLY_PAID').length} />
      </div>
      <Card title="Purchase orders">
        {orders.length === 0 ? <EmptyState title="No orders yet" /> : (
          <table className="table">
            <thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr></thead>
            <tbody>{orders.slice(0, 20).map((o) => <tr key={o.id}><td><Link href={`/erp/buying/orders/${o.id}`} className="code hover:underline">{o.number}</Link></td><td>{showDate(o.orderDate)}</td><td><DocStatus status={o.state.key} label={o.state.label} /></td><td className="text-right"><Money value={o.grandTotal} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      <Card title="Purchase invoices">
        {invoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Bill no.</th><th>Due</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>{invoices.slice(0, 20).map((i) => <tr key={i.id}><td><Link href={`/erp/buying/invoices/${i.id}`} className="code hover:underline">{i.number}</Link></td><td>{i.billNo ?? '—'}</td><td>{showDate(i.dueDate)}</td><td><DocStatus status={i.state.key} label={i.state.label} /></td><td className="text-right"><Money value={i.grandTotal} /></td><td className="text-right"><Money value={i.outstandingAmount} /></td></tr>)}</tbody>
          </table>
        )}
      </Card>
      {manage ? (
        <Card title="Details">
          <ActionForm action={updateSupplierAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <PartyFields party={supplier} />
            <SubmitButton pendingLabel="Saving…">Save supplier</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
