import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, money, sum } from '../domain/money';
import { lineEditSchema, priceLineSchema, supplierQuotationSchema, type LineEditInput, type PriceLineInput, type Raw, type SupplierQuotationInput } from '../validation';
import { manageArea, readArea } from './access';
import { itemByCode } from './item.service';
import { pendingQty } from './material-request.service';
import { activeParty } from './party.service';
import { nextNumber, SERIES } from './series';

/**
 * Supplier Quotation (ERPNext): prices asked from suppliers, usually against a material
 * request; compared side by side, and the chosen one becomes a purchase order.
 */

export async function listSupplierQuotations(p: Principal, f: { materialRequestId?: string | null } = {}) {
  await readArea(p, 'buying');
  return prisma.erpSupplierQuotation.findMany({
    where: { companyId: p.companyId, ...(f.materialRequestId ? { materialRequestId: f.materialRequestId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
}

export async function getSupplierQuotation(p: Principal, id: string) {
  await readArea(p, 'buying');
  const sq = await prisma.erpSupplierQuotation.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!sq) throw new NotFoundError('Supplier quotation not found.');
  const [items, supplier] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: sq.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true } }),
    prisma.erpParty.findUnique({ where: { id: sq.supplierId } }),
  ]);
  return { sq, supplier, items: new Map(items.map((i) => [i.id, i])) };
}

async function recompute(tx: Tx, id: string) {
  const lines = await tx.erpSupplierQuotationLine.findMany({ where: { quotationId: id } });
  await tx.erpSupplierQuotation.update({ where: { id }, data: { netTotal: sum(lines, (l) => l.amount) } });
}

export async function createSupplierQuotation(p: Principal, input: Raw<SupplierQuotationInput>) {
  await manageArea(p, 'buying');
  const data = supplierQuotationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await activeParty(tx, p.companyId, 'SUPPLIER', data.supplierId);
    const mr = data.materialRequestId
      ? await tx.erpMaterialRequest.findFirst({ where: { id: data.materialRequestId, companyId: p.companyId, purpose: 'PURCHASE', status: 'SUBMITTED' }, include: { lines: { orderBy: { sortOrder: 'asc' } } } })
      : null;
    if (data.materialRequestId && !mr) throw new DomainError('Pick a submitted purchase request.');
    const sq = await tx.erpSupplierQuotation.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.supplierQuotation), ...data, materialRequestId: mr?.id ?? null, createdById: p.userId },
    });
    if (mr) {
      const open = mr.lines.filter((l) => pendingQty(l, mr.isStopped).greaterThan(0));
      const items = await tx.erpItem.findMany({ where: { id: { in: open.map((l) => l.itemId) } }, select: { id: true, lastPurchaseRate: true } });
      const rate = new Map(items.map((i) => [i.id, D(i.lastPurchaseRate)]));
      await tx.erpSupplierQuotationLine.createMany({
        data: open.map((l, n) => {
          const qty = pendingQty(l);
          const r = rate.get(l.itemId) ?? D(0);
          return { quotationId: sq.id, itemId: l.itemId, qty, rate: r, amount: money(qty.times(r)), materialRequestLineId: l.id, sortOrder: n };
        }),
      });
      await recompute(tx, sq.id);
    }
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.supplier_quotation.created', entityType: 'ErpSupplierQuotation', entityId: sq.id, diff: { number: sq.number } }, tx);
    return sq;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const sq = await tx.erpSupplierQuotation.findFirst({ where: { id, companyId: p.companyId } });
  if (!sq) throw new NotFoundError('Supplier quotation not found.');
  if (sq.status !== 'DRAFT') throw new DomainError(`${sq.number} is ${sq.status.toLowerCase()} and can't be changed.`);
  return sq;
}

export async function addSupplierQuotationLine(p: Principal, id: string, input: Raw<PriceLineInput>) {
  await manageArea(p, 'buying');
  const data = priceLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    const count = await tx.erpSupplierQuotationLine.count({ where: { quotationId: id } });
    await tx.erpSupplierQuotationLine.create({ data: { quotationId: id, itemId: item.id, qty: data.qty, rate: data.rate, amount: money(data.qty.times(data.rate)), leadTimeDays: data.leadTimeDays, sortOrder: count } });
    await recompute(tx, id);
  });
}

export async function updateSupplierQuotationLine(p: Principal, id: string, lineId: string, input: Raw<LineEditInput>) {
  await manageArea(p, 'buying');
  const data = lineEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const line = await tx.erpSupplierQuotationLine.findFirst({ where: { id: lineId, quotationId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    const rate = data.rate ?? D(line.rate);
    await tx.erpSupplierQuotationLine.update({ where: { id: lineId }, data: { qty: data.qty, rate, amount: money(data.qty.times(rate)) } });
    await recompute(tx, id);
  });
}

export async function removeSupplierQuotationLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpSupplierQuotationLine.deleteMany({ where: { id: lineId, quotationId: id } });
    await recompute(tx, id);
  });
}

export async function deleteSupplierQuotation(p: Principal, id: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpSupplierQuotation.delete({ where: { id } });
  });
}

export async function submitSupplierQuotation(p: Principal, id: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    const sq = await tx.erpSupplierQuotation.findFirst({ where: { id, companyId: p.companyId }, include: { lines: true } });
    if (!sq) throw new NotFoundError('Supplier quotation not found.');
    if (sq.lines.length === 0) throw new DomainError('Add at least one item before submitting.');
    if (sq.lines.some((l) => D(l.rate).isZero())) throw new DomainError('Enter the quoted rate on every line.');
    const { count } = await tx.erpSupplierQuotation.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${sq.number} was already submitted or cancelled.`);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.supplier_quotation.submitted', entityType: 'ErpSupplierQuotation', entityId: id }, tx);
  });
}

export async function cancelSupplierQuotation(p: Principal, id: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    const sq = await tx.erpSupplierQuotation.findFirst({ where: { id, companyId: p.companyId } });
    if (!sq) throw new NotFoundError('Supplier quotation not found.');
    const ordered = await tx.erpPurchaseOrder.count({ where: { supplierQuotationId: id, status: { not: 'CANCELLED' } } });
    if (ordered > 0) throw new DomainError('A purchase order was made from this quotation. Cancel it first.');
    const { count } = await tx.erpSupplierQuotation.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError('Only a submitted quotation can be cancelled.');
  });
}

/**
 * Side-by-side comparison (ERPNext Supplier Quotation Comparison): every submitted, still
 * valid quote per item, cheapest first.
 */
export async function compareQuotations(p: Principal, f: { materialRequestId?: string | null; today: Date }) {
  await readArea(p, 'buying');
  const lines = await prisma.erpSupplierQuotationLine.findMany({
    where: {
      quotation: {
        companyId: p.companyId,
        status: 'SUBMITTED',
        ...(f.materialRequestId ? { materialRequestId: f.materialRequestId } : {}),
        OR: [{ validTill: null }, { validTill: { gte: f.today } }],
      },
    },
    include: { quotation: { select: { id: true, number: true, supplierId: true, quoteDate: true, validTill: true } } },
    orderBy: { rate: 'asc' },
  });
  const [items, suppliers] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.itemId))] } }, select: { id: true, code: true, name: true, uom: true } }),
    prisma.erpParty.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.quotation.supplierId))] } }, select: { id: true, name: true } }),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const byItem = new Map<string, typeof lines>();
  for (const l of lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
  return items
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((item) => ({ item, quotes: (byItem.get(item.id) ?? []).map((l) => ({ ...l, supplierName: supplierName.get(l.quotation.supplierId) ?? '—' })) }));
}
