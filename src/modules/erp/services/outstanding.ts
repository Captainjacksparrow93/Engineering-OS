import type { ErpPartyType, ErpPaymentType, Prisma } from '@prisma/client';
import type { Tx } from '@/core/db/prisma';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import { D, formatMoney } from '../domain/money';

/**
 * What a payment or journal line can settle, and the outstanding amounts it moves. Invoices
 * keep `outstandingAmount`; credit notes (sales returns) and debit notes (purchase returns)
 * keep the credit still unused. The rule for which document a payment settles:
 *   customer + receive → sales invoice      customer + pay → credit note (refund)
 *   supplier + pay     → purchase invoice   supplier + receive → debit note (refund)
 */

export type InvoiceType = 'Sales Invoice' | 'Purchase Invoice';
export const INVOICE_TYPES: InvoiceType[] = ['Sales Invoice', 'Purchase Invoice'];

export interface OpenInvoice {
  type: InvoiceType;
  id: string;
  number: string;
  partyType: ErpPartyType;
  partyId: string;
  isReturn: boolean;
  postingDate: Date;
  dueDate: Date | null;
  grandTotal: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  status: string;
}

export const partyAccountKey = (partyType: ErpPartyType) => (partyType === 'CUSTOMER' ? 'DEBTORS' : 'CREDITORS');
export const invoiceTypeFor = (partyType: ErpPartyType): InvoiceType => (partyType === 'CUSTOMER' ? 'Sales Invoice' : 'Purchase Invoice');
/** Does this payment direction settle returns (refunds) rather than invoices? */
export const settlesReturns = (partyType: ErpPartyType, paymentType: ErpPaymentType) => (partyType === 'CUSTOMER' ? paymentType === 'PAY' : paymentType === 'RECEIVE');
export const invoiceHref = (type: string, id: string) => (type === 'Sales Invoice' ? `/erp/selling/invoices/${id}` : `/erp/buying/invoices/${id}`);

export async function loadInvoice(tx: Tx, companyId: string, type: InvoiceType, id: string): Promise<OpenInvoice> {
  if (type === 'Sales Invoice') {
    const i = await tx.erpSalesInvoice.findFirst({ where: { id, companyId } });
    if (!i) throw new NotFoundError('Sales invoice not found.');
    return { type, id: i.id, number: i.number, partyType: 'CUSTOMER', partyId: i.customerId, isReturn: i.isReturn, postingDate: i.postingDate, dueDate: i.dueDate, grandTotal: i.grandTotal, outstanding: i.outstandingAmount, status: i.status };
  }
  const i = await tx.erpPurchaseInvoice.findFirst({ where: { id, companyId } });
  if (!i) throw new NotFoundError('Purchase invoice not found.');
  return { type, id: i.id, number: i.number, partyType: 'SUPPLIER', partyId: i.supplierId, isReturn: i.isReturn, postingDate: i.postingDate, dueDate: i.dueDate, grandTotal: i.grandTotal, outstanding: i.outstandingAmount, status: i.status };
}

export async function invoiceByNumber(tx: Tx, companyId: string, number: string): Promise<OpenInvoice> {
  const n = number.trim().toUpperCase();
  const [si, pi] = await Promise.all([
    tx.erpSalesInvoice.findUnique({ where: { companyId_number: { companyId, number: n } }, select: { id: true } }),
    tx.erpPurchaseInvoice.findUnique({ where: { companyId_number: { companyId, number: n } }, select: { id: true } }),
  ]);
  if (si) return loadInvoice(tx, companyId, 'Sales Invoice', si.id);
  if (pi) return loadInvoice(tx, companyId, 'Purchase Invoice', pi.id);
  throw new DomainError(`No invoice numbered ${n}.`);
}

/** Moves an invoice's outstanding amount by `delta` (negative settles), never below zero. */
export async function adjustOutstanding(tx: Tx, type: InvoiceType, id: string, delta: Prisma.Decimal) {
  const row =
    type === 'Sales Invoice'
      ? await tx.erpSalesInvoice.update({ where: { id }, data: { outstandingAmount: { increment: delta } }, select: { number: true, outstandingAmount: true, grandTotal: true } })
      : await tx.erpPurchaseInvoice.update({ where: { id }, data: { outstandingAmount: { increment: delta } }, select: { number: true, outstandingAmount: true, grandTotal: true } });
  if (D(row.outstandingAmount).lessThan(0)) throw new DomainError(`That is more than ${row.number} has outstanding.`);
  if (D(row.outstandingAmount).greaterThan(D(row.grandTotal))) throw new DomainError(`${row.number} can't owe more than its total.`);
}

/** A settlement must match the party, the direction and what is left on the document. */
export function assertSettles(inv: OpenInvoice, party: { partyType: ErpPartyType; partyId: string }, wantsReturn: boolean, amount: Prisma.Decimal) {
  if (inv.status !== 'SUBMITTED') throw new DomainError(`${inv.number} is not submitted.`);
  if (inv.partyType !== party.partyType || inv.partyId !== party.partyId) throw new DomainError(`${inv.number} belongs to a different ${party.partyType === 'CUSTOMER' ? 'customer' : 'supplier'}.`);
  if (inv.isReturn !== wantsReturn) throw new DomainError(wantsReturn ? `${inv.number} is an invoice, not a return. Use the other direction.` : `${inv.number} is a return. Use the other direction to settle it.`);
  if (amount.greaterThan(D(inv.outstanding))) throw new DomainError(`${inv.number} has only ${formatMoney(inv.outstanding)} outstanding.`);
}

/** Open documents a party's payment could settle, oldest due first. */
export async function openInvoices(tx: Tx, companyId: string, partyType: ErpPartyType, partyId: string, isReturn: boolean): Promise<OpenInvoice[]> {
  const where = { companyId, status: 'SUBMITTED' as const, isReturn, outstandingAmount: { gt: 0 } };
  const rows =
    partyType === 'CUSTOMER'
      ? (await tx.erpSalesInvoice.findMany({ where: { ...where, customerId: partyId }, orderBy: [{ dueDate: 'asc' }, { postingDate: 'asc' }] })).map((i) => ({ type: 'Sales Invoice' as const, id: i.id, number: i.number, partyType, partyId, isReturn, postingDate: i.postingDate, dueDate: i.dueDate, grandTotal: i.grandTotal, outstanding: i.outstandingAmount, status: i.status }))
      : (await tx.erpPurchaseInvoice.findMany({ where: { ...where, supplierId: partyId }, orderBy: [{ dueDate: 'asc' }, { postingDate: 'asc' }] })).map((i) => ({ type: 'Purchase Invoice' as const, id: i.id, number: i.number, partyType, partyId, isReturn, postingDate: i.postingDate, dueDate: i.dueDate, grandTotal: i.grandTotal, outstanding: i.outstandingAmount, status: i.status }));
  return rows;
}

/** Is anything still settling this document (live payment allocation or journal line)? */
export async function hasSettlements(tx: Tx, type: InvoiceType, id: string) {
  const [alloc, jl] = await Promise.all([
    tx.erpPaymentAllocation.count({ where: { invoiceType: type, invoiceId: id, payment: { status: 'SUBMITTED' } } }),
    tx.erpJournalLine.count({ where: { againstType: type, againstId: id, entry: { status: 'SUBMITTED' } } }),
  ]);
  return alloc + jl > 0;
}
