import type { ErpPartyType, ErpPaymentType, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, money, sum, ZERO } from '../domain/money';
import { allocationSchema, paymentSchema, type AllocationInput, type PaymentInput, type Raw } from '../validation';
import { assertProject, canRead, manageArea, readArea } from './access';
import {
  adjustOutstanding,
  assertSettles,
  invoiceTypeFor,
  loadInvoice,
  openInvoices,
  partyAccountKey,
  settlesReturns,
  type InvoiceType,
} from './outstanding';
import { cancelPostings, postGl, type GlRow, type Voucher } from './posting';
import { nextNumber, SERIES } from './series';

/**
 * Payment Entry (ERPNext). Receive: Dr bank/cash, Cr Debtors (customer) or Creditors
 * (supplier refund). Pay: Dr Creditors (supplier) or Debtors (customer refund), Cr bank/cash.
 * Each allocation's party row is posted against the invoice it settles; the rest is an
 * advance, posted against the payment itself, and can be reconciled later.
 * Internal transfer: Dr the receiving account, Cr the paying one.
 */

export const VOUCHER = 'Payment Entry';
const RECON = 'Payment Reconciliation';
export const PAYMENT_TYPE_LABEL: Record<ErpPaymentType, string> = { RECEIVE: 'Receive', PAY: 'Pay', INTERNAL_TRANSFER: 'Internal transfer' };

export async function paymentAccounts(companyId: string) {
  return prisma.erpAccount.findMany({ where: { companyId, isGroup: false, isActive: true, accountType: { in: ['BANK', 'CASH'] } }, select: { id: true, code: true, name: true, accountType: true }, orderBy: { code: 'asc' } });
}

export async function listPayments(p: Principal, f: { paymentType?: string | null; status?: string | null; partyId?: string | null } = {}) {
  await readArea(p, 'accounts');
  const rows = await prisma.erpPayment.findMany({
    where: {
      companyId: p.companyId,
      ...(f.paymentType ? { paymentType: f.paymentType as ErpPaymentType } : {}),
      ...(f.status === 'DRAFT' || f.status === 'SUBMITTED' || f.status === 'CANCELLED' ? { status: f.status } : f.status === 'UNALLOCATED' ? { status: 'SUBMITTED', unallocatedAmount: { gt: 0 } } : {}),
      ...(f.partyId ? { partyId: f.partyId } : {}),
    },
    orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  });
  const [parties, accounts] = await Promise.all([
    prisma.erpParty.findMany({ where: { id: { in: rows.map((r) => r.partyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    prisma.erpAccount.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.accountId, r.transferToAccountId]).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);
  const party = new Map(parties.map((x) => [x.id, x.name]));
  const account = new Map(accounts.map((a) => [a.id, a.name]));
  return rows.map((r) => ({ ...r, partyName: r.partyId ? party.get(r.partyId) ?? '—' : null, accountName: account.get(r.accountId) ?? '—', transferToName: r.transferToAccountId ? account.get(r.transferToAccountId) ?? '—' : null }));
}

export async function getPayment(p: Principal, id: string) {
  await readArea(p, 'accounts');
  const pay = await prisma.erpPayment.findFirst({ where: { id, companyId: p.companyId }, include: { allocations: { orderBy: { createdAt: 'asc' } } } });
  if (!pay) throw new NotFoundError('Payment not found.');
  const [party, accounts, gl, project, si, pi] = await Promise.all([
    pay.partyId ? prisma.erpParty.findUnique({ where: { id: pay.partyId } }) : null,
    prisma.erpAccount.findMany({ where: { id: { in: [pay.accountId, pay.transferToAccountId].filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } }),
    prisma.erpGlEntry.findMany({ where: { OR: [{ voucherType: VOUCHER, voucherId: id }, { voucherType: RECON, voucherId: { in: pay.allocations.map((a) => a.id) } }] }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
    pay.projectId ? prisma.project.findUnique({ where: { id: pay.projectId }, select: { id: true, code: true, name: true } }) : null,
    prisma.erpSalesInvoice.findMany({ where: { id: { in: pay.allocations.filter((a) => a.invoiceType === 'Sales Invoice').map((a) => a.invoiceId) } }, select: { id: true, number: true, grandTotal: true, outstandingAmount: true, isReturn: true } }),
    prisma.erpPurchaseInvoice.findMany({ where: { id: { in: pay.allocations.filter((a) => a.invoiceType === 'Purchase Invoice').map((a) => a.invoiceId) } }, select: { id: true, number: true, grandTotal: true, outstandingAmount: true, isReturn: true } }),
  ]);
  const invoices = new Map([...si, ...pi].map((i) => [i.id, i]));
  const open = pay.partyType && pay.partyId && pay.paymentType !== 'INTERNAL_TRANSFER' ? await openInvoices(prisma, p.companyId, pay.partyType, pay.partyId, settlesReturns(pay.partyType, pay.paymentType)) : [];
  return { pay, party, project, accounts: new Map(accounts.map((a) => [a.id, a])), gl, invoices, open };
}

async function assertPaymentAccount(tx: Tx, companyId: string, accountId: string | null | undefined, label: string) {
  const a = accountId ? await tx.erpAccount.findFirst({ where: { id: accountId, companyId, isGroup: false, isActive: true, accountType: { in: ['BANK', 'CASH'] } } }) : null;
  if (!a) throw new DomainError(`Pick a bank or cash account ${label}.`);
  return a.id;
}

async function resolve(tx: Tx, companyId: string, data: ReturnType<typeof paymentSchema.parse>) {
  const accountId = await assertPaymentAccount(tx, companyId, data.accountId, data.paymentType === 'RECEIVE' ? 'to receive into' : 'to pay from');
  const transferToAccountId = data.paymentType === 'INTERNAL_TRANSFER' ? await assertPaymentAccount(tx, companyId, data.transferToAccountId, 'to move the money to') : null;
  let partyType: ErpPartyType | null = null;
  let partyId: string | null = null;
  if (data.paymentType !== 'INTERNAL_TRANSFER') {
    const party = await tx.erpParty.findFirst({ where: { id: data.partyId!, companyId, kind: data.partyType!, isActive: true } });
    if (!party) throw new DomainError(`Pick an active ${data.partyType === 'CUSTOMER' ? 'customer' : 'supplier'}.`);
    partyType = party.kind;
    partyId = party.id;
  }
  return {
    paymentType: data.paymentType,
    postingDate: data.postingDate,
    partyType,
    partyId,
    accountId,
    transferToAccountId,
    amount: money(data.amount),
    modeOfPayment: data.modeOfPayment,
    referenceNo: data.referenceNo,
    referenceDate: data.referenceDate,
    projectId: await assertProject(companyId, data.projectId),
    remarks: data.remarks,
  };
}

export async function createPayment(p: Principal, input: Raw<PaymentInput>) {
  await manageArea(p, 'accounts');
  const data = paymentSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const fields = await resolve(tx, p.companyId, data);
    return tx.erpPayment.create({ data: { ...fields, companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.payment, data.postingDate), unallocatedAmount: fields.amount, createdById: p.userId } });
  });
}

/** "Receive payment" / "Make payment" from an invoice or return: a draft for what is outstanding. */
export async function createPaymentForInvoice(p: Principal, type: InvoiceType, invoiceId: string, postingDate: Date) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    const inv = await loadInvoice(tx, p.companyId, type, invoiceId);
    if (inv.status !== 'SUBMITTED' || D(inv.outstanding).lessThanOrEqualTo(0)) throw new DomainError(`${inv.number} has nothing outstanding.`);
    const paymentType: ErpPaymentType = (inv.partyType === 'CUSTOMER') !== inv.isReturn ? 'RECEIVE' : 'PAY';
    const bank = await tx.erpAccount.findFirst({ where: { companyId: p.companyId, systemKey: 'BANK' } });
    const pay = await tx.erpPayment.create({
      data: {
        companyId: p.companyId,
        number: await nextNumber(tx, p.companyId, SERIES.payment, postingDate),
        paymentType,
        postingDate,
        partyType: inv.partyType,
        partyId: inv.partyId,
        accountId: bank!.id,
        amount: inv.outstanding,
        unallocatedAmount: ZERO,
        remarks: `Against ${inv.number}`,
        createdById: p.userId,
      },
    });
    await tx.erpPaymentAllocation.create({ data: { paymentId: pay.id, invoiceType: type, invoiceId, amount: inv.outstanding } });
    return pay;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const pay = await tx.erpPayment.findFirst({ where: { id, companyId: p.companyId }, include: { allocations: true } });
  if (!pay) throw new NotFoundError('Payment not found.');
  if (pay.status !== 'DRAFT') throw new DomainError(`${pay.number} is ${pay.status.toLowerCase()} and can't be changed.`);
  return pay;
}

async function refreshUnallocated(tx: Tx, id: string) {
  const pay = await tx.erpPayment.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
  const allocated = sum(pay.allocations, (a) => a.amount);
  if (allocated.greaterThan(D(pay.amount))) throw new DomainError('The allocations add up to more than the payment.');
  await tx.erpPayment.update({ where: { id }, data: { unallocatedAmount: money(D(pay.amount).minus(allocated)) } });
}

export async function updatePayment(p: Principal, id: string, input: Raw<PaymentInput>) {
  await manageArea(p, 'accounts');
  const data = paymentSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const pay = await loadDraft(tx, p, id);
    const fields = await resolve(tx, p.companyId, data);
    const partyChanged = fields.partyId !== pay.partyId || fields.paymentType !== pay.paymentType;
    if (partyChanged) await tx.erpPaymentAllocation.deleteMany({ where: { paymentId: id } });
    await tx.erpPayment.update({ where: { id }, data: fields });
    await refreshUnallocated(tx, id);
  });
}

export async function deletePayment(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPayment.delete({ where: { id } });
  });
}

export async function addAllocation(p: Principal, id: string, input: Raw<AllocationInput>) {
  await manageArea(p, 'accounts');
  const data = allocationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const pay = await loadDraft(tx, p, id);
    if (!pay.partyType || !pay.partyId) throw new DomainError('An internal transfer settles no invoices.');
    const type = invoiceTypeFor(pay.partyType);
    const inv = await loadInvoice(tx, p.companyId, type, data.invoiceId);
    const already = sum(pay.allocations.filter((a) => a.invoiceId === inv.id), (a) => a.amount);
    assertSettles(inv, { partyType: pay.partyType, partyId: pay.partyId }, settlesReturns(pay.partyType, pay.paymentType), money(data.amount).plus(already));
    await tx.erpPaymentAllocation.create({ data: { paymentId: id, invoiceType: type, invoiceId: inv.id, amount: money(data.amount) } });
    await refreshUnallocated(tx, id);
  });
}

export async function removeAllocation(p: Principal, id: string, allocationId: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPaymentAllocation.deleteMany({ where: { id: allocationId, paymentId: id } });
    await refreshUnallocated(tx, id);
  });
}

/** Allocate what is left of the payment to open documents, oldest due first. */
export async function allocateOutstanding(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    const pay = await loadDraft(tx, p, id);
    if (!pay.partyType || !pay.partyId) throw new DomainError('An internal transfer settles no invoices.');
    let left = D(pay.amount).minus(sum(pay.allocations, (a) => a.amount));
    const taken = new Map<string, Prisma.Decimal>();
    for (const a of pay.allocations) taken.set(a.invoiceId, (taken.get(a.invoiceId) ?? ZERO).plus(D(a.amount)));
    const open = await openInvoices(tx, p.companyId, pay.partyType, pay.partyId, settlesReturns(pay.partyType, pay.paymentType));
    for (const inv of open) {
      if (left.lessThanOrEqualTo(0)) break;
      const room = D(inv.outstanding).minus(taken.get(inv.id) ?? ZERO);
      if (room.lessThanOrEqualTo(0)) continue;
      const amount = room.lessThan(left) ? room : left;
      await tx.erpPaymentAllocation.create({ data: { paymentId: id, invoiceType: inv.type, invoiceId: inv.id, amount: money(amount) } });
      left = left.minus(amount);
    }
    await refreshUnallocated(tx, id);
  });
}

const voucherOf = (pay: { companyId: string; id: string; number: string; postingDate: Date; projectId: string | null }): Voucher => ({ companyId: pay.companyId, type: VOUCHER, id: pay.id, no: pay.number, postingDate: pay.postingDate, projectId: pay.projectId });

export async function submitPayment(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    const pay = await tx.erpPayment.findFirst({ where: { id, companyId: p.companyId }, include: { allocations: true } });
    if (!pay) throw new NotFoundError('Payment not found.');
    const { count } = await tx.erpPayment.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${pay.number} was already submitted or cancelled.`);
    await assertPaymentAccount(tx, p.companyId, pay.accountId, '');
    const amount = D(pay.amount);
    const gl: GlRow[] = [];
    if (pay.paymentType === 'INTERNAL_TRANSFER') {
      await assertPaymentAccount(tx, p.companyId, pay.transferToAccountId, '');
      gl.push({ account: { id: pay.transferToAccountId! }, debit: amount, remarks: pay.remarks }, { account: { id: pay.accountId }, credit: amount, remarks: pay.remarks });
    } else {
      const partyType = pay.partyType!;
      const partyId = pay.partyId!;
      const receive = pay.paymentType === 'RECEIVE';
      const allocated = sum(pay.allocations, (a) => a.amount);
      if (allocated.greaterThan(amount)) throw new DomainError('The allocations add up to more than the payment.');
      const party = (value: Prisma.Decimal, againstType: string, againstId: string): GlRow => ({ account: partyAccountKey(partyType), ...(receive ? { credit: value } : { debit: value }), partyType, partyId, againstType, againstId, remarks: pay.referenceNo ? `Ref ${pay.referenceNo}` : pay.remarks });
      for (const a of pay.allocations) {
        const inv = await loadInvoice(tx, p.companyId, a.invoiceType as InvoiceType, a.invoiceId);
        assertSettles(inv, { partyType, partyId }, settlesReturns(partyType, pay.paymentType), D(a.amount));
        await adjustOutstanding(tx, inv.type, inv.id, D(a.amount).negated());
        gl.push(party(D(a.amount), inv.type, inv.id));
      }
      const advance = money(amount.minus(allocated));
      if (advance.greaterThan(0)) gl.push(party(advance, VOUCHER, pay.id));
      gl.push({ account: { id: pay.accountId }, ...(receive ? { debit: amount } : { credit: amount }), remarks: pay.remarks });
      await tx.erpPayment.update({ where: { id }, data: { unallocatedAmount: advance } });
    }
    await postGl(tx, voucherOf(pay), gl);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.payment.submitted', entityType: 'ErpPayment', entityId: id, diff: { number: pay.number, type: pay.paymentType, amount: amount.toFixed(2) } }, tx);
  });
}

/**
 * Apply an advance (the unallocated part of a submitted payment) to an invoice. Posts a
 * re-pointing pair on the party account so the invoice shows as settled.
 */
export async function reconcileAdvance(p: Principal, id: string, input: Raw<AllocationInput>, postingDate: Date) {
  await manageArea(p, 'accounts');
  const data = allocationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const pay = await tx.erpPayment.findFirst({ where: { id, companyId: p.companyId } });
    if (!pay || pay.status !== 'SUBMITTED') throw new DomainError('Only a submitted payment can be reconciled.');
    if (!pay.partyType || !pay.partyId) throw new DomainError('An internal transfer settles no invoices.');
    const amount = money(data.amount);
    if (amount.greaterThan(D(pay.unallocatedAmount))) throw new DomainError(`${pay.number} has only ${D(pay.unallocatedAmount).toFixed(2)} unallocated.`);
    const inv = await loadInvoice(tx, p.companyId, invoiceTypeFor(pay.partyType), data.invoiceId);
    assertSettles(inv, { partyType: pay.partyType, partyId: pay.partyId }, settlesReturns(pay.partyType, pay.paymentType), amount);
    const alloc = await tx.erpPaymentAllocation.create({ data: { paymentId: id, invoiceType: inv.type, invoiceId: inv.id, amount, isReconciliation: true } });
    await adjustOutstanding(tx, inv.type, inv.id, amount.negated());
    await tx.erpPayment.update({ where: { id }, data: { unallocatedAmount: { decrement: amount } } });
    const receive = pay.paymentType === 'RECEIVE';
    const row = (side: 'debit' | 'credit', againstType: string, againstId: string): GlRow => ({ account: partyAccountKey(pay.partyType!), [side]: amount, partyType: pay.partyType, partyId: pay.partyId, againstType, againstId, remarks: `${pay.number} applied to ${inv.number}` });
    await postGl(tx, { companyId: p.companyId, type: RECON, id: alloc.id, no: pay.number, postingDate, projectId: pay.projectId }, [
      row(receive ? 'debit' : 'credit', VOUCHER, pay.id),
      row(receive ? 'credit' : 'debit', inv.type, inv.id),
    ]);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.payment.reconciled', entityType: 'ErpPayment', entityId: id, diff: { invoice: inv.number, amount: amount.toFixed(2) } }, tx);
  });
}

export async function cancelPayment(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    const pay = await tx.erpPayment.findFirst({ where: { id, companyId: p.companyId }, include: { allocations: true } });
    if (!pay) throw new NotFoundError('Payment not found.');
    const { count } = await tx.erpPayment.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted payment can be cancelled; ${pay.number} is ${pay.status.toLowerCase()}.`);
    for (const a of pay.allocations) {
      await adjustOutstanding(tx, a.invoiceType as InvoiceType, a.invoiceId, D(a.amount));
      if (a.isReconciliation) {
        const gl = await tx.erpGlEntry.findFirst({ where: { voucherType: RECON, voucherId: a.id }, select: { postingDate: true } });
        await cancelPostings(tx, { companyId: p.companyId, type: RECON, id: a.id, no: pay.number, postingDate: gl?.postingDate ?? pay.postingDate });
      }
    }
    await cancelPostings(tx, voucherOf(pay));
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.payment.cancelled', entityType: 'ErpPayment', entityId: id, diff: { number: pay.number } }, tx);
  });
}

/** Unallocated advances a party has with us, for "Apply advance" on an invoice. */
export async function partyAdvances(p: Principal, partyType: ErpPartyType, partyId: string, isReturn: boolean) {
  if (!canRead(p, 'accounts')) return [];
  const paymentType: ErpPaymentType = (partyType === 'CUSTOMER') !== isReturn ? 'RECEIVE' : 'PAY';
  return prisma.erpPayment.findMany({ where: { companyId: p.companyId, status: 'SUBMITTED', partyType, partyId, paymentType, unallocatedAmount: { gt: 0 } }, select: { id: true, number: true, postingDate: true, unallocatedAmount: true }, orderBy: { postingDate: 'asc' } });
}

/** Everything settling an invoice or return: payments, journal lines and credit/debit notes. */
export async function invoiceSettlements(companyId: string, type: InvoiceType, invoiceId: string) {
  const [allocs, lines, returns] = await Promise.all([
    prisma.erpPaymentAllocation.findMany({ where: { invoiceType: type, invoiceId, payment: { companyId, status: 'SUBMITTED' } }, include: { payment: { select: { id: true, number: true, postingDate: true } } } }),
    prisma.erpJournalLine.findMany({ where: { againstType: type, againstId: invoiceId, entry: { companyId, status: 'SUBMITTED' } }, include: { entry: { select: { id: true, number: true, postingDate: true } } } }),
    type === 'Sales Invoice'
      ? prisma.erpSalesInvoice.findMany({ where: { companyId, returnAgainstId: invoiceId, status: { not: 'CANCELLED' } }, select: { id: true, number: true, postingDate: true, grandTotal: true, status: true } })
      : prisma.erpPurchaseInvoice.findMany({ where: { companyId, returnAgainstId: invoiceId, status: { not: 'CANCELLED' } }, select: { id: true, number: true, postingDate: true, grandTotal: true, status: true } }),
  ]);
  return [
    ...allocs.map((a) => ({ key: a.id, href: `/erp/accounts/payments/${a.payment.id}`, number: a.payment.number, date: a.payment.postingDate, amount: a.amount, what: a.isReconciliation ? 'Advance applied' : 'Payment', draft: false })),
    ...lines.map((l) => ({ key: l.id, href: `/erp/accounts/journals/${l.entry.id}`, number: l.entry.number, date: l.entry.postingDate, amount: D(l.debit).plus(D(l.credit)), what: 'Journal entry', draft: false })),
    ...returns.map((r) => ({ key: r.id, href: type === 'Sales Invoice' ? `/erp/selling/invoices/${r.id}` : `/erp/buying/invoices/${r.id}`, number: r.number, date: r.postingDate, amount: r.grandTotal, what: type === 'Sales Invoice' ? 'Credit note' : 'Debit note', draft: r.status === 'DRAFT' })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
}
