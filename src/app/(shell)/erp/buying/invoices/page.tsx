import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { partyOptions } from '@/modules/erp/services/party.service';
import { listPurchaseInvoices } from '@/modules/erp/services/purchase-invoice.service';
import { createPurchaseInvoiceAction } from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { BuyingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Purchase invoices' };

export default async function PurchaseInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying') && !canRead(p, 'accounts')) notFound();
  const sp = await searchParams;
  const [rows, suppliers] = await Promise.all([listPurchaseInvoices(p, { status: sp.status, today: new Date() }), partyOptions(p.companyId, 'SUPPLIER')]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Purchase invoices" subtitle="Suppliers' bills. Bill stock from its receipt; bill services and charges directly." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Buying', href: '/erp/buying' }, { label: 'Purchase invoices' }]} />
      <BuyingTabs current="/erp/buying/invoices" />
      {canManage(p, 'buying') || canManage(p, 'accounts') ? (
        <Card title="Bill for a service or charge">
          <ActionForm action={createPurchaseInvoiceAction} className="flex flex-wrap items-end gap-sm">
            <div className="min-w-[14rem]">
              <label className="label" htmlFor="supplierId">Supplier</label>
              <select id="supplierId" name="supplierId" className="select w-full" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>
            <Field label="Posting date" name="postingDate" type="date" defaultValue={todayIso()} required />
            <Field label="Supplier bill no." name="billNo" />
            <Field label="Bill date" name="billDate" type="date" />
            <SubmitButton pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
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
      {rows.length === 0 ? <EmptyState title="No purchase invoices" /> : (
        <table className="table">
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Bill no.</th><th>Date</th><th>Due</th><th>Status</th><th className="text-right">Grand total</th><th className="text-right">Outstanding</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/erp/buying/invoices/${i.id}`} className="code hover:underline">{i.number}</Link></td>
                <td>{i.supplierName}</td>
                <td>{i.billNo ?? '—'}</td>
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
