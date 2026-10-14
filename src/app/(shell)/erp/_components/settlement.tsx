import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import type { Principal } from '@/core/rbac/types';
import { canManage } from '@/modules/erp/services/access';
import { invoiceSettlements, partyAdvances } from '@/modules/erp/services/payment.service';
import { invoiceHref, type InvoiceType } from '@/modules/erp/services/outstanding';
import { prisma } from '@/core/db/prisma';
import { createPaymentForInvoiceAction, makeCreditNoteAction, makeDebitNoteAction, reconcileAdvanceAction } from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card } from '@/components/ui';
import { DocButton } from './doc-button';
import { Money, showDate } from './parts';

/**
 * Payments, journals and returns against a submitted invoice, with the next steps: take or
 * make the payment, raise a credit/debit note, or apply an advance the party already paid.
 */
export async function InvoiceSettlement({ p, type, inv, partyId, returnsArea }: { p: Principal; type: InvoiceType; inv: { id: string; status: string; isReturn: boolean; outstandingAmount: Prisma.Decimal; returnAgainstId: string | null }; partyId: string; returnsArea: 'selling' | 'buying' }) {
  if (inv.status !== 'SUBMITTED') return null;
  const partyType = type === 'Sales Invoice' ? 'CUSTOMER' : 'SUPPLIER';
  const [rows, advances, against] = await Promise.all([
    invoiceSettlements(p.companyId, type, inv.id),
    partyAdvances(p, partyType, partyId, inv.isReturn),
    !inv.returnAgainstId ? null : type === 'Sales Invoice' ? prisma.erpSalesInvoice.findUnique({ where: { id: inv.returnAgainstId }, select: { id: true, number: true } }) : prisma.erpPurchaseInvoice.findUnique({ where: { id: inv.returnAgainstId }, select: { id: true, number: true } }),
  ]);
  const accounts = canManage(p, 'accounts');
  const open = inv.outstandingAmount.greaterThan(0);
  const payLabel = type === 'Sales Invoice' ? (inv.isReturn ? 'Refund customer' : 'Receive payment') : inv.isReturn ? 'Receive refund' : 'Make payment';
  const noteAction = type === 'Sales Invoice' ? makeCreditNoteAction : makeDebitNoteAction;
  const canNote = !inv.isReturn && (canManage(p, returnsArea) || accounts);
  return (
    <Card
      title={inv.isReturn ? 'Credit left on this note' : 'Payments'}
      action={
        <div className="flex flex-wrap gap-xs">
          {accounts && open ? <DocButton action={createPaymentForInvoiceAction} fields={{ invoiceType: type, invoiceId: inv.id }} label={payLabel} variant="primary" /> : null}
          {canNote ? <DocButton action={noteAction} fields={{ id: inv.id }} label={type === 'Sales Invoice' ? 'Make credit note' : 'Make debit note'} /> : null}
        </div>
      }
    >
      <p className="text-body-sm">
        {inv.isReturn ? 'Unused credit' : 'Outstanding'} <Money value={inv.outstandingAmount} className="font-medium" />
        {against ? <> · against <Link href={invoiceHref(type, against.id)} className="code hover:underline">{against.number}</Link></> : null}
      </p>
      {rows.length ? (
        <table className="table mt-sm">
          <tbody>{rows.map((r) => (
            <tr key={r.key}><td>{r.what}</td><td><Link href={r.href} className="code hover:underline">{r.number}</Link>{r.draft ? <span className="badge badge-outline ml-xs">Draft</span> : null}</td><td>{showDate(r.date)}</td><td className="text-right"><Money value={r.amount} /></td></tr>
          ))}</tbody>
        </table>
      ) : null}
      {accounts && open && advances.length ? (
        <div className="mt-base border-t border-hairline pt-base">
          <p className="mb-xs text-caption uppercase text-muted">Apply an advance</p>
          {advances.map((a) => (
            <ActionForm key={a.id} action={reconcileAdvanceAction} className="mb-xs flex flex-wrap items-center gap-sm">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="invoiceId" value={inv.id} />
              <span className="text-body-sm"><Link href={`/erp/accounts/payments/${a.id}`} className="code hover:underline">{a.number}</Link> · {showDate(a.postingDate)} · <Money value={a.unallocatedAmount} /> unused</span>
              <input name="amount" type="number" step="0.01" className="input w-32" aria-label="Amount to apply" defaultValue={(a.unallocatedAmount.lessThan(inv.outstandingAmount) ? a.unallocatedAmount : inv.outstandingAmount).toFixed(2)} required />
              <SubmitButton size="sm">Apply</SubmitButton>
            </ActionForm>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
