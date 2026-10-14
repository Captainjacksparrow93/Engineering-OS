import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, userNames } from '@/modules/erp/services/access';
import { getPayment, PAYMENT_TYPE_LABEL, paymentAccounts } from '@/modules/erp/services/payment.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { invoiceHref } from '@/modules/erp/services/outstanding';
import {
  addAllocationAction,
  allocateOutstandingAction,
  cancelPaymentAction,
  deletePaymentAction,
  reconcileAdvanceAction,
  removeAllocationAction,
  submitPaymentAction,
  updatePaymentAction,
} from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { GlTable } from '../../../_components/gl-table';
import { DocStatus, DocTrail, Money, orNotFound, showDate } from '../../../_components/parts';
import { PaymentFields } from '../payment-fields';

export const dynamic = 'force-dynamic';

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const { id } = await params;
  const { pay, party, project, accounts, gl, invoices, open } = await orNotFound(getPayment(p, id));
  const manage = canManage(p, 'accounts');
  const draft = pay.status === 'DRAFT';
  const [names, customers, suppliers, banks] = await Promise.all([
    userNames([pay.createdById, pay.submittedById, pay.cancelledById]),
    draft && manage ? partyOptions(p.companyId, 'CUSTOMER') : [],
    draft && manage ? partyOptions(p.companyId, 'SUPPLIER') : [],
    draft && manage ? paymentAccounts(p.companyId) : [],
  ]);
  const transfer = pay.paymentType === 'INTERNAL_TRANSFER';
  const account = accounts.get(pay.accountId);
  const to = pay.transferToAccountId ? accounts.get(pay.transferToAccountId) : null;
  const openForm = (action: typeof addAllocationAction, label: string, cap?: string) => (
    <ActionForm action={action} resetOnSuccess className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
      <input type="hidden" name="id" value={id} />
      <div>
        <label className="label" htmlFor={`inv-${label}`}>Invoice</label>
        <select id={`inv-${label}`} name="invoiceId" className="select" required defaultValue="">
          <option value="" disabled>Pick one</option>
          {open.map((i) => <option key={i.id} value={i.id}>{i.number} · due {showDate(i.dueDate ?? i.postingDate)} · ₹ {i.outstanding.toFixed(2)}</option>)}
        </select>
      </div>
      <div><label className="label" htmlFor={`amt-${label}`}>Amount (₹)</label><input id={`amt-${label}`} name="amount" type="number" step="0.01" className="input w-36" defaultValue={cap} required /></div>
      <SubmitButton size="sm">{label}</SubmitButton>
    </ActionForm>
  );
  return (
    <div className="space-y-lg">
      <PageHeader
        title={pay.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={pay.status} /> {PAYMENT_TYPE_LABEL[pay.paymentType]} · {showDate(pay.postingDate)} · <Money value={pay.amount} />{party ? ` · ${party.name}` : ''}{project ? <> · <Link href={`/pm/projects/${project.id}`} className="hover:underline">{project.code}</Link></> : null}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Payments', href: '/erp/accounts/payments' }, { label: pay.number }]}
        actions={manage ? (
          draft ? (
            <>
              <DocButton action={submitPaymentAction} fields={{ id }} label="Submit" variant="primary" confirm="Submit this payment? It posts to the books and settles the allocated invoices." />
              <DocButton action={deletePaymentAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
            </>
          ) : pay.status === 'SUBMITTED' ? <DocButton action={cancelPaymentAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this payment? Its invoices become outstanding again." /> : null
        ) : null}
      />
      {draft && manage ? (
        <Card title="Payment">
          <ActionForm action={updatePaymentAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <PaymentFields pay={pay} customers={customers} suppliers={suppliers} banks={banks} />
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <Card title="Payment">
          <dl className="grid gap-base text-body-sm sm:grid-cols-4">
            <div><dt className="text-caption uppercase text-muted">{transfer ? 'From' : pay.paymentType === 'RECEIVE' ? 'Into' : 'From'}</dt><dd>{account ? `${account.code} ${account.name}` : '—'}</dd></div>
            {to ? <div><dt className="text-caption uppercase text-muted">To</dt><dd>{to.code} {to.name}</dd></div> : null}
            <div><dt className="text-caption uppercase text-muted">Mode</dt><dd>{pay.modeOfPayment ?? '—'}</dd></div>
            <div><dt className="text-caption uppercase text-muted">Reference</dt><dd>{pay.referenceNo ?? '—'}{pay.referenceDate ? ` · ${showDate(pay.referenceDate)}` : ''}</dd></div>
            <div><dt className="text-caption uppercase text-muted">Cleared by the bank</dt><dd>{pay.clearanceDate ? showDate(pay.clearanceDate) : 'Not yet'}</dd></div>
            <div className="sm:col-span-3"><dt className="text-caption uppercase text-muted">Remarks</dt><dd>{pay.remarks ?? '—'}</dd></div>
          </dl>
        </Card>
      )}
      {!transfer ? (
        <Card title="Allocated to" action={draft && manage && open.length ? <DocButton action={allocateOutstandingAction} fields={{ id }} label="Allocate oldest first" /> : null}>
          {pay.allocations.length === 0 ? <EmptyState title="Not allocated" hint={draft ? 'Allocate it to invoices, or submit it as an advance.' : undefined} /> : (
            <table className="table">
              <thead><tr><th>Invoice</th><th className="text-right">Invoice total</th><th className="text-right">Allocated</th><th /></tr></thead>
              <tbody>{pay.allocations.map((a) => {
                const inv = invoices.get(a.invoiceId);
                return (
                  <tr key={a.id}>
                    <td><Link href={invoiceHref(a.invoiceType, a.invoiceId)} className="code hover:underline">{inv?.number}</Link>{a.isReconciliation ? <span className="badge badge-outline ml-xs">Advance applied</span> : null}</td>
                    <td className="text-right"><Money value={inv?.grandTotal} /></td>
                    <td className="text-right"><Money value={a.amount} /></td>
                    <td className="text-right">{draft && manage ? <DocButton action={removeAllocationAction} fields={{ id, allocationId: a.id }} label="Remove" /> : null}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          <p className="mt-sm text-right text-body-sm">Unallocated <Money value={pay.unallocatedAmount} className="font-medium" /></p>
          {manage && draft && open.length ? openForm(addAllocationAction, 'Allocate', pay.unallocatedAmount.toFixed(2)) : null}
          {manage && pay.status === 'SUBMITTED' && pay.unallocatedAmount.greaterThan(0) && open.length ? openForm(reconcileAdvanceAction, 'Apply advance', pay.unallocatedAmount.toFixed(2)) : null}
        </Card>
      ) : null}
      <GlTable rows={gl} />
      <DocTrail created={{ by: names.get(pay.createdById), at: pay.createdAt }} submitted={{ by: names.get(pay.submittedById ?? ''), at: pay.submittedAt }} cancelled={{ by: names.get(pay.cancelledById ?? ''), at: pay.cancelledAt }} />
    </div>
  );
}
