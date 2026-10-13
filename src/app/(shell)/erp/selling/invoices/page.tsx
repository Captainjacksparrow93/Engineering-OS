import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { partyOptions } from '@/modules/erp/services/party.service';
import { listSalesInvoices } from '@/modules/erp/services/sales-invoice.service';
import { createSalesInvoiceAction } from '@/app/actions/erp-selling';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { SellingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales invoices' };

export default async function SalesInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling') && !canRead(p, 'accounts')) notFound();
  const sp = await searchParams;
  const [rows, customers] = await Promise.all([listSalesInvoices(p, { status: sp.status, today: new Date() }), partyOptions(p.companyId, 'CUSTOMER')]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Sales invoices" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Selling', href: '/erp/selling' }, { label: 'Sales invoices' }]} />
      <SellingTabs current="/erp/selling/invoices" />
      {canManage(p, 'selling') || canManage(p, 'accounts') ? (
        <Card title="Invoice for a service">
          <ActionForm action={createSalesInvoiceAction} className="flex flex-wrap items-end gap-sm">
            <div className="min-w-[14rem]">
              <label className="label" htmlFor="customerId">Customer</label>
              <select id="customerId" name="customerId" className="select w-full" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
            <Field label="Invoice date" name="postingDate" type="date" defaultValue={todayIso()} required />
            <Field label="Client PO number" name="poNo" />
            <SubmitButton pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
          <p className="mt-xs text-caption text-muted">Orders and deliveries are billed from their own page (Make invoice).</p>
        </Card>
      ) : null}
      <form method="get" className="flex gap-sm">
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status">
          <option value="">All</option>
          <option value="UNPAID">Unpaid</option>
          <option value="DRAFT">Draft</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No sales invoices" /> : (
        <table className="table">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due</th><th>Status</th><th className="text-right">Grand total</th><th className="text-right">Outstanding</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/erp/selling/invoices/${i.id}`} className="code hover:underline">{i.number}</Link></td>
                <td>{i.customerName}</td>
                <td>{showDate(i.postingDate)}</td>
                <td>{showDate(i.dueDate)}</td>
                <td><DocStatus status={i.state.key} label={i.state.label} /></td>
                <td className="text-right"><Money value={i.grandTotal} /></td>
                <td className="text-right">{i.status === 'SUBMITTED' ? <Money value={i.outstandingAmount} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
