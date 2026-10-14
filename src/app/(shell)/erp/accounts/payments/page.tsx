import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listPayments, PAYMENT_TYPE_LABEL, paymentAccounts } from '@/modules/erp/services/payment.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { createPaymentAction } from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Money, showDate } from '../../_components/parts';
import { AccountsTabs } from '../tabs';
import { PaymentFields } from './payment-fields';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payments' };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const sp = await searchParams;
  const manage = canManage(p, 'accounts');
  const rows = await listPayments(p, { paymentType: sp.type, status: sp.status });
  const [customers, suppliers, banks] = manage ? await Promise.all([partyOptions(p.companyId, 'CUSTOMER'), partyOptions(p.companyId, 'SUPPLIER'), paymentAccounts(p.companyId)]) : [[], [], []];
  return (
    <div className="space-y-lg">
      <PageHeader title="Payments" subtitle="Money in from customers, out to suppliers, and between our own accounts." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Accounts', href: '/erp/accounts' }, { label: 'Payments' }]} />
      <AccountsTabs current="/erp/accounts/payments" />
      <form method="get" className="flex flex-wrap gap-sm">
        <select name="type" defaultValue={sp.type ?? ''} className="select" aria-label="Type"><option value="">All types</option>{Object.entries(PAYMENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status"><option value="">All</option><option value="DRAFT">Draft</option><option value="SUBMITTED">Submitted</option><option value="UNALLOCATED">With unallocated advance</option><option value="CANCELLED">Cancelled</option></select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="No payments here" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Payment</th><th>Date</th><th>Type</th><th>Party</th><th>Account</th><th>Reference</th><th className="text-right">Amount</th><th className="text-right">Unallocated</th><th>Status</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/erp/accounts/payments/${r.id}`} className="code hover:underline">{r.number}</Link></td>
                  <td>{showDate(r.postingDate)}</td>
                  <td>{PAYMENT_TYPE_LABEL[r.paymentType]}</td>
                  <td>{r.partyName ?? (r.transferToName ? `→ ${r.transferToName}` : '—')}</td>
                  <td>{r.accountName}</td>
                  <td className="text-caption text-muted">{r.referenceNo ?? ''}</td>
                  <td className="text-right"><Money value={r.amount} /></td>
                  <td className="text-right">{r.status === 'SUBMITTED' && r.unallocatedAmount.greaterThan(0) ? <Money value={r.unallocatedAmount} /> : '—'}</td>
                  <td><DocStatus status={r.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      {manage ? (
        <Card title="New payment">
          <ActionForm action={createPaymentAction} className="space-y-base">
            <PaymentFields customers={customers} suppliers={suppliers} banks={banks} />
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
