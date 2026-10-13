import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, formatQty, money, ZERO } from '../domain/money';
import { computeTotals, dueDate } from '../domain/totals';
import { incomeLineSchema, lineEditSchema, salesInvoiceSchema, type IncomeLineInput, type LineEditInput, type Raw, type SalesInvoiceInput } from '../validation';
import { manageArea, readArea } from './access';
import { activeParty } from './party.service';
import { cancelPostings, postGl, type GlRow, type Voucher } from './posting';
import { invoiceState } from './purchase-invoice.service';
import { nextNumber, SERIES } from './series';

/**
 * Sales Invoice (ERPNext). Bills the customer from a sales order or a delivery note:
 *   Dr Debtors (against this invoice, for the customer)
 *   Cr Sales / the item's income account (tagged with the PM project)  Cr Output CGST/SGST or IGST
 * Stock moves on the delivery note, not here, so billing ahead of delivery is allowed.
 */

export const VOUCHER = 'Sales Invoice';
const lineInclude = { lines: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.ErpSalesInvoiceInclude;
export { invoiceState };

const readSi = (p: Principal) => readArea(p, 'selling').catch(() => readArea(p, 'accounts'));
const manageSi = (p: Principal) => manageArea(p, 'selling').catch(() => manageArea(p, 'accounts'));

export async function listSalesInvoices(p: Principal, f: { customerId?: string | null; status?: string | null; projectId?: string | null; today: Date }) {
  await readSi(p);
  const rows = await prisma.erpSalesInvoice.findMany({
    where: {
      companyId: p.companyId,
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.status === 'DRAFT' || f.status === 'CANCELLED' ? { status: f.status } : f.status === 'UNPAID' ? { status: 'SUBMITTED', outstandingAmount: { gt: 0 } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const customers = await prisma.erpParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } });
  const name = new Map(customers.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, customerName: name.get(r.customerId) ?? '—', state: invoiceState(r, f.today) }));
}

export async function getSalesInvoice(p: Principal, id: string) {
  await readSi(p);
  const inv = await prisma.erpSalesInvoice.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
  if (!inv) throw new NotFoundError('Sales invoice not found.');
  const [customer, accounts, gl, project] = await Promise.all([
    prisma.erpParty.findUnique({ where: { id: inv.customerId } }),
    prisma.erpAccount.findMany({ where: { id: { in: inv.lines.map((l) => l.incomeAccountId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } }),
    prisma.erpGlEntry.findMany({ where: { voucherType: VOUCHER, voucherId: id }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
    inv.projectId ? prisma.project.findUnique({ where: { id: inv.projectId }, select: { id: true, code: true, name: true } }) : null,
  ]);
  return { inv, customer, project, accounts: new Map(accounts.map((a) => [a.id, a])), gl };
}

async function recompute(tx: Tx, id: string) {
  const inv = await tx.erpSalesInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  const [settings, customer] = await Promise.all([tx.erpSettings.findUnique({ where: { companyId: inv.companyId } }), tx.erpParty.findUnique({ where: { id: inv.customerId } })]);
  const t = computeTotals(inv.lines, settings?.companyState, customer?.state);
  await tx.erpSalesInvoice.update({ where: { id }, data: { ...t, outstandingAmount: t.grandTotal } });
}

async function newInvoice(tx: Tx, p: Principal, customerId: string, postingDate: Date, extra: { projectId?: string | null; poNo?: string | null; remarks?: string | null; dueDate?: Date | null } = {}) {
  const customer = await activeParty(tx, p.companyId, 'CUSTOMER', customerId);
  return tx.erpSalesInvoice.create({
    data: {
      companyId: p.companyId,
      number: await nextNumber(tx, p.companyId, SERIES.salesInvoice),
      customerId,
      postingDate,
      dueDate: extra.dueDate ?? dueDate(postingDate, customer.paymentTermsDays),
      poNo: extra.poNo ?? null,
      projectId: extra.projectId ?? null,
      remarks: extra.remarks ?? null,
      createdById: p.userId,
    },
  });
}

/** An invoice with typed-in income lines (commissioning visit, AMC, a one-off service). */
export async function createSalesInvoice(p: Principal, customerId: string, input: Raw<SalesInvoiceInput>) {
  await manageSi(p);
  const data = salesInvoiceSchema.parse(input);
  return prisma.$transaction((tx) => newInvoice(tx, p, customerId, data.postingDate, data));
}

/** Sales order → draft invoice for everything not yet billed (or on another draft). */
export async function makeInvoiceFromSalesOrder(p: Principal, orderId: string, postingDate: Date) {
  await manageSi(p);
  return prisma.$transaction(async (tx) => {
    const so = await tx.erpSalesOrder.findFirst({ where: { id: orderId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!so || so.status !== 'SUBMITTED') throw new DomainError('Only a submitted sales order can be billed.');
    const drafted = await tx.erpSalesInvoiceLine.groupBy({ by: ['orderLineId'], where: { orderLineId: { in: so.lines.map((l) => l.id) }, invoice: { status: 'DRAFT' } }, _sum: { qty: true } });
    const onDraft = new Map(drafted.map((d) => [d.orderLineId!, D(d._sum.qty)]));
    const open = so.lines.map((l) => ({ l, qty: D(l.qty).minus(D(l.billedQty)).minus(onDraft.get(l.id) ?? ZERO) })).filter((x) => x.qty.greaterThan(0));
    if (open.length === 0) throw new DomainError('Everything on this order is billed or on a draft invoice.');
    const items = await tx.erpItem.findMany({ where: { id: { in: open.map((x) => x.l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const inv = await newInvoice(tx, p, so.customerId, postingDate, { projectId: so.projectId, poNo: so.poNo, remarks: `Against ${so.number}${so.woNumber ? `, WO ${so.woNumber}` : ''}` });
    await tx.erpSalesInvoiceLine.createMany({
      data: open.map(({ l, qty }, n) => {
        const item = byId.get(l.itemId)!;
        return { invoiceId: inv.id, itemId: l.itemId, description: l.description ?? `${item.code} ${item.name}`, qty, rate: l.rate, amount: money(qty.times(l.rate)), gstRate: l.gstRate, orderLineId: l.id, incomeAccountId: item.incomeAccountId, sortOrder: n };
      }),
    });
    await recompute(tx, inv.id);
    return inv;
  });
}

/** Delivery note → draft invoice for its unbilled lines. */
export async function makeInvoiceFromDelivery(p: Principal, deliveryId: string, postingDate: Date) {
  await manageSi(p);
  return prisma.$transaction(async (tx) => {
    const dn = await tx.erpDeliveryNote.findFirst({ where: { id: deliveryId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!dn || dn.status !== 'SUBMITTED') throw new DomainError('Only a submitted delivery can be billed.');
    const drafted = await tx.erpSalesInvoiceLine.groupBy({ by: ['deliveryLineId'], where: { deliveryLineId: { in: dn.lines.map((l) => l.id) }, invoice: { status: 'DRAFT' } }, _sum: { qty: true } });
    const onDraft = new Map(drafted.map((d) => [d.deliveryLineId!, D(d._sum.qty)]));
    const open = dn.lines.map((l) => ({ l, qty: D(l.qty).minus(D(l.billedQty)).minus(onDraft.get(l.id) ?? ZERO) })).filter((x) => x.qty.greaterThan(0));
    if (open.length === 0) throw new DomainError('Everything on this delivery is billed or on a draft invoice.');
    const items = await tx.erpItem.findMany({ where: { id: { in: open.map((x) => x.l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const inv = await newInvoice(tx, p, dn.customerId, postingDate, { projectId: dn.projectId, remarks: `Against ${dn.number}` });
    await tx.erpSalesInvoiceLine.createMany({
      data: open.map(({ l, qty }, n) => {
        const item = byId.get(l.itemId)!;
        return { invoiceId: inv.id, itemId: l.itemId, description: `${item.code} ${item.name}`, qty, rate: l.rate, amount: money(qty.times(l.rate)), gstRate: l.gstRate, orderLineId: l.orderLineId, deliveryLineId: l.id, incomeAccountId: item.incomeAccountId, sortOrder: n };
      }),
    });
    await recompute(tx, inv.id);
    return inv;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const inv = await tx.erpSalesInvoice.findFirst({ where: { id, companyId: p.companyId } });
  if (!inv) throw new NotFoundError('Sales invoice not found.');
  if (inv.status !== 'DRAFT') throw new DomainError(`${inv.number} is ${inv.status.toLowerCase()} and can't be changed.`);
  return inv;
}

export async function updateSalesInvoice(p: Principal, id: string, input: Raw<SalesInvoiceInput>) {
  await manageSi(p);
  const data = salesInvoiceSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const inv = await loadDraft(tx, p, id);
    const customer = await tx.erpParty.findUniqueOrThrow({ where: { id: inv.customerId } });
    return tx.erpSalesInvoice.update({ where: { id }, data: { ...data, dueDate: data.dueDate ?? dueDate(data.postingDate, customer.paymentTermsDays) } });
  });
}

export async function addIncomeLine(p: Principal, id: string, input: Raw<IncomeLineInput>) {
  await manageSi(p);
  const data = incomeLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const account = await tx.erpAccount.findFirst({ where: { id: data.accountId, companyId: p.companyId, isGroup: false, rootType: 'INCOME' } });
    if (!account) throw new DomainError('Pick an income account.');
    const count = await tx.erpSalesInvoiceLine.count({ where: { invoiceId: id } });
    await tx.erpSalesInvoiceLine.create({ data: { invoiceId: id, description: data.description, qty: data.qty, rate: data.rate, amount: money(data.qty.times(data.rate)), gstRate: data.gstRate, incomeAccountId: account.id, sortOrder: count } });
    await recompute(tx, id);
  });
}

export async function updateSalesInvoiceLine(p: Principal, id: string, lineId: string, input: Raw<LineEditInput>) {
  await manageSi(p);
  const data = lineEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const line = await tx.erpSalesInvoiceLine.findFirst({ where: { id: lineId, invoiceId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    const rate = data.rate ?? D(line.rate);
    await tx.erpSalesInvoiceLine.update({ where: { id: lineId }, data: { qty: data.qty, rate, amount: money(data.qty.times(rate)) } });
    await recompute(tx, id);
  });
}

export async function removeSalesInvoiceLine(p: Principal, id: string, lineId: string) {
  await manageSi(p);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpSalesInvoiceLine.deleteMany({ where: { id: lineId, invoiceId: id } });
    await recompute(tx, id);
  });
}

export async function deleteSalesInvoice(p: Principal, id: string) {
  await manageSi(p);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpSalesInvoice.delete({ where: { id } });
  });
}

async function applyBilled(tx: Tx, line: { qty: Prisma.Decimal.Value; orderLineId: string | null; deliveryLineId: string | null }, sign: 1 | -1) {
  const q = D(line.qty).times(sign);
  if (line.orderLineId) await tx.erpSalesOrderLine.update({ where: { id: line.orderLineId }, data: { billedQty: { increment: q } } });
  if (line.deliveryLineId) await tx.erpDeliveryNoteLine.update({ where: { id: line.deliveryLineId }, data: { billedQty: { increment: q } } });
}

export async function submitSalesInvoice(p: Principal, id: string) {
  await manageSi(p);
  return prisma.$transaction(async (tx) => {
    const found = await tx.erpSalesInvoice.findFirst({ where: { id, companyId: p.companyId }, select: { status: true } });
    if (!found) throw new NotFoundError('Sales invoice not found.');
    if (found.status === 'DRAFT') await recompute(tx, id);
    const inv = await tx.erpSalesInvoice.findUniqueOrThrow({ where: { id }, include: lineInclude });
    const { count } = await tx.erpSalesInvoice.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${inv.number} was already submitted or cancelled.`);
    if (inv.lines.length === 0) throw new DomainError('Add at least one line before submitting.');
    const items = await tx.erpItem.findMany({ where: { id: { in: inv.lines.map((l) => l.itemId).filter((x): x is string => !!x) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const gl: GlRow[] = [];
    for (const l of inv.lines) {
      const item = l.itemId ? byId.get(l.itemId) : undefined;
      if (l.deliveryLineId) {
        const dl = await tx.erpDeliveryNoteLine.findUniqueOrThrow({ where: { id: l.deliveryLineId } });
        const left = D(dl.qty).minus(D(dl.billedQty));
        if (D(l.qty).greaterThan(left)) throw new DomainError(`${item?.code ?? l.description}: only ${formatQty(left)} left to bill on that delivery.`);
      }
      if (l.orderLineId) {
        const ol = await tx.erpSalesOrderLine.findUniqueOrThrow({ where: { id: l.orderLineId } });
        const left = D(ol.qty).minus(D(ol.billedQty));
        if (D(l.qty).greaterThan(left)) throw new DomainError(`${item?.code ?? l.description}: only ${formatQty(left)} left to bill on the order.`);
      }
      const account = l.incomeAccountId ?? item?.incomeAccountId;
      gl.push({ account: account ? { id: account } : item && !item.isStockItem ? 'SERVICE_INCOME' : 'SALES', credit: money(l.amount), remarks: l.description });
    }
    gl.push({ account: 'OUTPUT_CGST', credit: inv.cgst }, { account: 'OUTPUT_SGST', credit: inv.sgst }, { account: 'OUTPUT_IGST', credit: inv.igst });
    gl.push({ account: 'DEBTORS', debit: inv.grandTotal, partyType: 'CUSTOMER', partyId: inv.customerId, againstType: VOUCHER, againstId: inv.id, remarks: inv.poNo ? `PO ${inv.poNo}` : null });
    const v: Voucher = { companyId: p.companyId, type: VOUCHER, id, no: inv.number, postingDate: inv.postingDate, projectId: inv.projectId };
    await postGl(tx, v, gl);
    for (const l of inv.lines) await applyBilled(tx, l, 1);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.sales_invoice.submitted', entityType: 'ErpSalesInvoice', entityId: id, diff: { number: inv.number, grandTotal: inv.grandTotal.toFixed(2) } }, tx);
  });
}

export async function cancelSalesInvoice(p: Principal, id: string) {
  await manageSi(p);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.erpSalesInvoice.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!inv) throw new NotFoundError('Sales invoice not found.');
    if (!D(inv.outstandingAmount).equals(D(inv.grandTotal))) throw new DomainError(`${inv.number} has payments against it. Cancel or unlink those first.`);
    const { count } = await tx.erpSalesInvoice.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted invoice can be cancelled; ${inv.number} is ${inv.status.toLowerCase()}.`);
    await cancelPostings(tx, { companyId: p.companyId, type: VOUCHER, id, no: inv.number, postingDate: inv.postingDate, projectId: inv.projectId });
    for (const l of inv.lines) await applyBilled(tx, l, -1);
    await tx.erpSalesInvoice.update({ where: { id }, data: { outstandingAmount: ZERO } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.sales_invoice.cancelled', entityType: 'ErpSalesInvoice', entityId: id }, tx);
  });
}

export async function incomeAccounts(companyId: string) {
  return prisma.erpAccount.findMany({ where: { companyId, isGroup: false, isActive: true, rootType: 'INCOME' }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
}
