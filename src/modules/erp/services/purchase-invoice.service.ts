import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, formatQty, money, ZERO } from '../domain/money';
import { computeTotals, dueDate } from '../domain/totals';
import { expenseLineSchema, lineEditSchema, purchaseInvoiceSchema, type ExpenseLineInput, type LineEditInput, type PurchaseInvoiceInput, type Raw } from '../validation';
import { manageArea, readArea } from './access';
import { activeParty } from './party.service';
import { cancelPostings, postGl, type GlRow, type Voucher } from './posting';
import { nextNumber, SERIES } from './series';

/**
 * Purchase Invoice (ERPNext). The supplier's bill:
 *   stock lines        Dr Stock Received But Not Billed (at the receipt value)
 *                      ± Stock Adjustment for any price difference
 *   services/expenses  Dr the expense account (tagged with the project)
 *   GST                Dr Input CGST/SGST or IGST
 *   total              Cr Creditors (against this invoice, for the supplier)
 * Stock items are billed from a receipt; services straight from the order or typed in.
 */

export const VOUCHER = 'Purchase Invoice';
const lineInclude = { lines: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.ErpPurchaseInvoiceInclude;

export function invoiceState(inv: { status: string; outstandingAmount: Prisma.Decimal.Value; grandTotal: Prisma.Decimal.Value; dueDate: Date | null; isReturn?: boolean }, today: Date) {
  if (inv.status !== 'SUBMITTED') return { key: inv.status, label: inv.status === 'DRAFT' ? 'Draft' : 'Cancelled' };
  if (inv.isReturn) return { key: 'RETURN', label: 'Return' };
  const out = D(inv.outstandingAmount);
  if (out.lessThanOrEqualTo(0)) return { key: 'PAID', label: 'Paid' };
  if (inv.dueDate && inv.dueDate < today) return { key: 'OVERDUE', label: 'Overdue' };
  if (out.lessThan(D(inv.grandTotal))) return { key: 'PARTLY_PAID', label: 'Partly paid' };
  return { key: 'UNPAID', label: 'Unpaid' };
}

export async function listPurchaseInvoices(p: Principal, f: { supplierId?: string | null; status?: string | null; today: Date }) {
  await readArea(p, 'buying').catch(() => readArea(p, 'accounts'));
  const rows = await prisma.erpPurchaseInvoice.findMany({
    where: { companyId: p.companyId, ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.status === 'DRAFT' || f.status === 'CANCELLED' ? { status: f.status } : f.status === 'UNPAID' ? { status: 'SUBMITTED', outstandingAmount: { gt: 0 } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const suppliers = await prisma.erpParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true } });
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  return rows.map((r) => ({ ...r, supplierName: name.get(r.supplierId) ?? '—', state: invoiceState(r, f.today) }));
}

export async function getPurchaseInvoice(p: Principal, id: string) {
  await readArea(p, 'buying').catch(() => readArea(p, 'accounts'));
  const inv = await prisma.erpPurchaseInvoice.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
  if (!inv) throw new NotFoundError('Purchase invoice not found.');
  const [supplier, accounts, gl] = await Promise.all([
    prisma.erpParty.findUnique({ where: { id: inv.supplierId } }),
    prisma.erpAccount.findMany({ where: { id: { in: inv.lines.map((l) => l.expenseAccountId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } }),
    prisma.erpGlEntry.findMany({ where: { voucherType: VOUCHER, voucherId: id }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { inv, supplier, accounts: new Map(accounts.map((a) => [a.id, a])), gl };
}

/** Recomputes totals by the supplier's state; outstanding follows the total while a draft. */
async function recompute(tx: Tx, id: string) {
  const inv = await tx.erpPurchaseInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  const [settings, supplier] = await Promise.all([tx.erpSettings.findUnique({ where: { companyId: inv.companyId } }), tx.erpParty.findUnique({ where: { id: inv.supplierId } })]);
  const t = computeTotals(inv.lines, settings?.companyState, supplier?.state);
  await tx.erpPurchaseInvoice.update({ where: { id }, data: { ...t, outstandingAmount: t.grandTotal } });
}

async function newInvoice(tx: Tx, p: Principal, supplierId: string, postingDate: Date, extra: { projectId?: string | null; remarks?: string | null; billNo?: string | null; billDate?: Date | null; dueDate?: Date | null } = {}) {
  const supplier = await activeParty(tx, p.companyId, 'SUPPLIER', supplierId);
  return tx.erpPurchaseInvoice.create({
    data: {
      companyId: p.companyId,
      number: await nextNumber(tx, p.companyId, SERIES.purchaseInvoice),
      supplierId,
      postingDate,
      billNo: extra.billNo ?? null,
      billDate: extra.billDate ?? null,
      dueDate: extra.dueDate ?? dueDate(extra.billDate ?? postingDate, supplier.paymentTermsDays),
      projectId: extra.projectId ?? null,
      remarks: extra.remarks ?? null,
      createdById: p.userId,
    },
  });
}

/** A bill with typed-in expense lines (rent, freight, a service with no order). */
export async function createPurchaseInvoice(p: Principal, supplierId: string, input: Raw<PurchaseInvoiceInput>) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  const data = purchaseInvoiceSchema.parse(input);
  return prisma.$transaction((tx) => newInvoice(tx, p, supplierId, data.postingDate, data));
}

/** Unbilled quantity on receipt lines, minus what other drafts already bill. */
async function unbilledReceiptLines(tx: Tx, receiptLineIds: string[]) {
  const lines = await tx.erpPurchaseReceiptLine.findMany({ where: { id: { in: receiptLineIds }, receipt: { status: 'SUBMITTED' } }, include: { receipt: true } });
  const drafted = await tx.erpPurchaseInvoiceLine.groupBy({ by: ['receiptLineId'], where: { receiptLineId: { in: receiptLineIds }, invoice: { status: 'DRAFT' } }, _sum: { qty: true } });
  const onDraft = new Map(drafted.map((d) => [d.receiptLineId!, D(d._sum.qty)]));
  return lines.map((l) => ({ l, qty: D(l.qty).minus(D(l.billedQty)).minus(onDraft.get(l.id) ?? ZERO) })).filter((x) => x.qty.greaterThan(0));
}

async function addReceiptLines(tx: Tx, invoiceId: string, open: Awaited<ReturnType<typeof unbilledReceiptLines>>) {
  const items = await tx.erpItem.findMany({ where: { id: { in: open.map((x) => x.l.itemId) } }, select: { id: true, code: true, name: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const start = await tx.erpPurchaseInvoiceLine.count({ where: { invoiceId } });
  await tx.erpPurchaseInvoiceLine.createMany({
    data: open.map(({ l, qty }, n) => ({ invoiceId, itemId: l.itemId, description: `${byId.get(l.itemId)?.code} ${byId.get(l.itemId)?.name}`, qty, rate: l.rate, amount: money(qty.times(l.rate)), gstRate: l.gstRate, orderLineId: l.orderLineId, receiptLineId: l.id, sortOrder: start + n })),
  });
}

/** Purchase receipt → draft invoice for everything not yet billed. */
export async function makeInvoiceFromReceipt(p: Principal, receiptId: string, postingDate: Date) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  return prisma.$transaction(async (tx) => {
    const pr = await tx.erpPurchaseReceipt.findFirst({ where: { id: receiptId, companyId: p.companyId }, include: { lines: true } });
    if (!pr || pr.status !== 'SUBMITTED') throw new DomainError('Only a submitted receipt can be billed.');
    const open = await unbilledReceiptLines(tx, pr.lines.map((l) => l.id));
    if (open.length === 0) throw new DomainError('Everything on this receipt is billed or on a draft invoice.');
    const inv = await newInvoice(tx, p, pr.supplierId, postingDate, { projectId: pr.projectId, remarks: `Against ${pr.number}` });
    await addReceiptLines(tx, inv.id, open);
    await recompute(tx, inv.id);
    return inv;
  });
}

/** Purchase order → draft invoice: received stock not yet billed, plus services on the order. */
export async function makeInvoiceFromOrder(p: Principal, orderId: string, postingDate: Date) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  return prisma.$transaction(async (tx) => {
    const po = await tx.erpPurchaseOrder.findFirst({ where: { id: orderId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!po || po.status !== 'SUBMITTED') throw new DomainError('Only a submitted order can be billed.');
    const items = await tx.erpItem.findMany({ where: { id: { in: po.lines.map((l) => l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const receiptLines = await tx.erpPurchaseReceiptLine.findMany({ where: { orderLineId: { in: po.lines.map((l) => l.id) } }, select: { id: true } });
    const received = await unbilledReceiptLines(tx, receiptLines.map((l) => l.id));
    const drafted = await tx.erpPurchaseInvoiceLine.groupBy({ by: ['orderLineId'], where: { orderLineId: { in: po.lines.map((l) => l.id) }, receiptLineId: null, invoice: { status: 'DRAFT' } }, _sum: { qty: true } });
    const onDraft = new Map(drafted.map((d) => [d.orderLineId!, D(d._sum.qty)]));
    const services = po.lines
      .filter((l) => !byId.get(l.itemId)!.isStockItem)
      .map((l) => ({ l, qty: D(l.qty).minus(D(l.billedQty)).minus(onDraft.get(l.id) ?? ZERO) }))
      .filter((x) => x.qty.greaterThan(0));
    if (received.length === 0 && services.length === 0) throw new DomainError('Nothing on this order is ready to bill. Stock items are billed once received.');
    const inv = await newInvoice(tx, p, po.supplierId, postingDate, { projectId: po.projectId, remarks: `Against ${po.number}` });
    await addReceiptLines(tx, inv.id, received);
    const start = await tx.erpPurchaseInvoiceLine.count({ where: { invoiceId: inv.id } });
    await tx.erpPurchaseInvoiceLine.createMany({
      data: services.map(({ l, qty }, n) => {
        const item = byId.get(l.itemId)!;
        return { invoiceId: inv.id, itemId: l.itemId, description: l.description ?? `${item.code} ${item.name}`, qty, rate: l.rate, amount: money(qty.times(l.rate)), gstRate: l.gstRate, orderLineId: l.id, expenseAccountId: item.expenseAccountId, sortOrder: start + n };
      }),
    });
    await recompute(tx, inv.id);
    return inv;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const inv = await tx.erpPurchaseInvoice.findFirst({ where: { id, companyId: p.companyId } });
  if (!inv) throw new NotFoundError('Purchase invoice not found.');
  if (inv.status !== 'DRAFT') throw new DomainError(`${inv.number} is ${inv.status.toLowerCase()} and can't be changed.`);
  return inv;
}

export async function updatePurchaseInvoice(p: Principal, id: string, input: Raw<PurchaseInvoiceInput>) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  const data = purchaseInvoiceSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const inv = await loadDraft(tx, p, id);
    const supplier = await tx.erpParty.findUniqueOrThrow({ where: { id: inv.supplierId } });
    return tx.erpPurchaseInvoice.update({ where: { id }, data: { ...data, dueDate: data.dueDate ?? dueDate(data.billDate ?? data.postingDate, supplier.paymentTermsDays) } });
  });
}

export async function addExpenseLine(p: Principal, id: string, input: Raw<ExpenseLineInput>) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  const data = expenseLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const account = await tx.erpAccount.findFirst({ where: { id: data.accountId, companyId: p.companyId, isGroup: false } });
    if (!account || (account.rootType !== 'EXPENSE' && account.rootType !== 'ASSET')) throw new DomainError('Pick an expense or fixed-asset account.');
    const count = await tx.erpPurchaseInvoiceLine.count({ where: { invoiceId: id } });
    await tx.erpPurchaseInvoiceLine.create({ data: { invoiceId: id, description: data.description, qty: data.qty, rate: data.rate, amount: money(data.qty.times(data.rate)), gstRate: data.gstRate, expenseAccountId: account.id, sortOrder: count } });
    await recompute(tx, id);
  });
}

export async function updatePurchaseInvoiceLine(p: Principal, id: string, lineId: string, input: Raw<LineEditInput>) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  const data = lineEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const line = await tx.erpPurchaseInvoiceLine.findFirst({ where: { id: lineId, invoiceId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    const rate = data.rate ?? D(line.rate);
    await tx.erpPurchaseInvoiceLine.update({ where: { id: lineId }, data: { qty: data.qty, rate, amount: money(data.qty.times(rate)) } });
    await recompute(tx, id);
  });
}

export async function removePurchaseInvoiceLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPurchaseInvoiceLine.deleteMany({ where: { id: lineId, invoiceId: id } });
    await recompute(tx, id);
  });
}

export async function deletePurchaseInvoice(p: Principal, id: string) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPurchaseInvoice.delete({ where: { id } });
  });
}

async function applyBilled(tx: Tx, line: { qty: Prisma.Decimal.Value; receiptLineId: string | null; orderLineId: string | null }, sign: 1 | -1) {
  const q = D(line.qty).times(sign);
  if (line.receiptLineId) await tx.erpPurchaseReceiptLine.update({ where: { id: line.receiptLineId }, data: { billedQty: { increment: q } } });
  if (line.orderLineId) await tx.erpPurchaseOrderLine.update({ where: { id: line.orderLineId }, data: { billedQty: { increment: q } } });
}

export async function submitPurchaseInvoice(p: Principal, id: string) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  return prisma.$transaction(async (tx) => {
    const found = await tx.erpPurchaseInvoice.findFirst({ where: { id, companyId: p.companyId }, select: { status: true } });
    if (!found) throw new NotFoundError('Purchase invoice not found.');
    if (found.status === 'DRAFT') await recompute(tx, id);
    const inv = await tx.erpPurchaseInvoice.findUniqueOrThrow({ where: { id }, include: lineInclude });
    const { count } = await tx.erpPurchaseInvoice.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${inv.number} was already submitted or cancelled.`);
    if (inv.lines.length === 0) throw new DomainError('Add at least one line before submitting.');
    if (inv.billNo) {
      const dup = await tx.erpPurchaseInvoice.findFirst({ where: { companyId: p.companyId, supplierId: inv.supplierId, billNo: inv.billNo, status: 'SUBMITTED', id: { not: id } }, select: { number: true } });
      if (dup) throw new DomainError(`Supplier bill ${inv.billNo} is already entered as ${dup.number}.`);
    }

    const items = await tx.erpItem.findMany({ where: { id: { in: inv.lines.map((l) => l.itemId).filter((x): x is string => !!x) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const gl: GlRow[] = [];
    for (const l of inv.lines) {
      const item = l.itemId ? byId.get(l.itemId) : undefined;
      if (l.receiptLineId) {
        const rl = await tx.erpPurchaseReceiptLine.findUniqueOrThrow({ where: { id: l.receiptLineId } });
        const left = D(rl.qty).minus(D(rl.billedQty));
        if (D(l.qty).greaterThan(left)) throw new DomainError(`${item?.code ?? l.description}: only ${formatQty(left)} left to bill on that receipt.`);
        const atReceipt = money(D(l.qty).times(rl.rate));
        gl.push({ account: 'SRBNB', debit: atReceipt, remarks: l.description });
        const variance = money(l.amount).minus(atReceipt);
        if (!variance.isZero()) gl.push({ account: 'STOCK_ADJUSTMENT', debit: variance, remarks: `Price difference ${l.description}` });
      } else {
        if (item?.isStockItem) throw new DomainError(`${item.code} is a stock item. Receive it first, then bill the receipt.`);
        if (l.orderLineId) {
          const ol = await tx.erpPurchaseOrderLine.findUniqueOrThrow({ where: { id: l.orderLineId } });
          const left = D(ol.qty).minus(D(ol.billedQty));
          if (D(l.qty).greaterThan(left)) throw new DomainError(`${item?.code ?? l.description}: only ${formatQty(left)} left to bill on the order.`);
        }
        const account = l.expenseAccountId ?? item?.expenseAccountId;
        gl.push({ account: account ? { id: account } : 'PURCHASE_EXPENSES', debit: money(l.amount), remarks: l.description });
      }
    }
    gl.push({ account: 'INPUT_CGST', debit: inv.cgst }, { account: 'INPUT_SGST', debit: inv.sgst }, { account: 'INPUT_IGST', debit: inv.igst });
    gl.push({ account: 'CREDITORS', credit: inv.grandTotal, partyType: 'SUPPLIER', partyId: inv.supplierId, againstType: VOUCHER, againstId: inv.id, remarks: inv.billNo ? `Bill ${inv.billNo}` : null });
    const v: Voucher = { companyId: p.companyId, type: VOUCHER, id: inv.id, no: inv.number, postingDate: inv.postingDate, projectId: inv.projectId };
    await postGl(tx, v, gl);
    for (const l of inv.lines) await applyBilled(tx, l, 1);
    await tx.erpPurchaseInvoice.update({ where: { id }, data: { outstandingAmount: inv.grandTotal } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.purchase_invoice.submitted', entityType: 'ErpPurchaseInvoice', entityId: id, diff: { number: inv.number, grandTotal: inv.grandTotal.toFixed(2) } }, tx);
  });
}

export async function cancelPurchaseInvoice(p: Principal, id: string) {
  await manageArea(p, 'buying').catch(() => manageArea(p, 'accounts'));
  return prisma.$transaction(async (tx) => {
    const inv = await tx.erpPurchaseInvoice.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!inv) throw new NotFoundError('Purchase invoice not found.');
    if (!D(inv.outstandingAmount).equals(D(inv.grandTotal))) throw new DomainError(`${inv.number} has payments against it. Cancel or unlink those first.`);
    const { count } = await tx.erpPurchaseInvoice.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted invoice can be cancelled; ${inv.number} is ${inv.status.toLowerCase()}.`);
    await cancelPostings(tx, { companyId: p.companyId, type: VOUCHER, id, no: inv.number, postingDate: inv.postingDate, projectId: inv.projectId });
    for (const l of inv.lines) await applyBilled(tx, l, -1);
    await tx.erpPurchaseInvoice.update({ where: { id }, data: { outstandingAmount: ZERO } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.purchase_invoice.cancelled', entityType: 'ErpPurchaseInvoice', entityId: id }, tx);
  });
}

/** Expense and fixed-asset accounts a bill line can post to. */
export async function expenseAccounts(companyId: string) {
  return prisma.erpAccount.findMany({ where: { companyId, isGroup: false, isActive: true, rootType: { in: ['EXPENSE', 'ASSET'] }, OR: [{ rootType: 'EXPENSE' }, { accountType: 'FIXED_ASSET' }] }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
}

