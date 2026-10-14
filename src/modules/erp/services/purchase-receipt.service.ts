import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, formatQty, money, sum, ZERO } from '../domain/money';
import { lineEditSchema, priceLineSchema, purchaseReceiptSchema, type LineEditInput, type PriceLineInput, type PurchaseReceiptInput, type Raw } from '../validation';
import { manageArea, readArea } from './access';
import { assertWarehouse, itemByCode } from './item.service';
import { activeParty } from './party.service';
import { cancelPostings, postGl, postStock, type Voucher } from './posting';
import { applyReceived } from './purchase-order.service';
import { assertInspected } from './quality.service';
import { nextNumber, SERIES } from './series';
import { systemWarehouseId } from './setup';

/**
 * Purchase Receipt (ERPNext). Accepted stock goes into its warehouse at the order rate:
 *   Dr Stock In Hand   Cr Stock Received But Not Billed
 * Rejected quantity is held in the Rejected warehouse at no value until it goes back.
 * Each receipt updates the item's last purchase rate and adds a PURCHASE price to the
 * Sales catalogue, so quotes price at what was really paid.
 */

export const VOUCHER = 'Purchase Receipt';
const lineInclude = { lines: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.ErpPurchaseReceiptInclude;

export async function listPurchaseReceipts(p: Principal, f: { supplierId?: string | null; status?: string | null } = {}) {
  await readArea(p, 'buying').catch(() => readArea(p, 'stock'));
  const rows = await prisma.erpPurchaseReceipt.findMany({
    where: { companyId: p.companyId, ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.status ? { status: f.status as never } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { lines: { select: { qty: true, billedQty: true } } },
  });
  const suppliers = await prisma.erpParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true } });
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  return rows.map(({ lines, ...r }) => {
    const unbilled = sum(lines, (l) => Dec.max(ZERO, D(l.qty).minus(D(l.billedQty))));
    return { ...r, supplierName: name.get(r.supplierId) ?? '—', toBill: r.status === 'SUBMITTED' && unbilled.greaterThan(0) };
  });
}

export async function getPurchaseReceipt(p: Principal, id: string) {
  await readArea(p, 'buying').catch(() => readArea(p, 'stock'));
  const pr = await prisma.erpPurchaseReceipt.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
  if (!pr) throw new NotFoundError('Purchase receipt not found.');
  const [items, supplier, warehouses, orderLines, gl] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: pr.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true, inspectionBeforePurchase: true } }),
    prisma.erpParty.findUnique({ where: { id: pr.supplierId } }),
    prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
    prisma.erpPurchaseOrderLine.findMany({ where: { id: { in: pr.lines.map((l) => l.orderLineId).filter((x): x is string => !!x) } }, include: { order: { select: { id: true, number: true } } } }),
    prisma.erpGlEntry.findMany({ where: { voucherType: VOUCHER, voucherId: id }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { pr, supplier, items: new Map(items.map((i) => [i.id, i])), warehouses: new Map(warehouses.map((w) => [w.id, w.name])), orders: new Map(orderLines.map((l) => [l.id, l.order])), gl };
}

async function recompute(tx: Tx, id: string) {
  const lines = await tx.erpPurchaseReceiptLine.findMany({ where: { receiptId: id } });
  await tx.erpPurchaseReceipt.update({ where: { id }, data: { netTotal: sum(lines, (l) => l.amount) } });
}

/** A receipt without an order (ERPNext allows it): the supplier delivered, lines are typed in. */
export async function createPurchaseReceipt(p: Principal, supplierId: string, input: Raw<PurchaseReceiptInput>) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  const data = purchaseReceiptSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await activeParty(tx, p.companyId, 'SUPPLIER', supplierId);
    return tx.erpPurchaseReceipt.create({ data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.purchaseReceipt), supplierId, ...data, createdById: p.userId } });
  });
}

/** Purchase order → draft receipt for everything still to arrive. */
export async function makeReceiptFromOrder(p: Principal, orderId: string, postingDate: Date) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  return prisma.$transaction(async (tx) => {
    const po = await tx.erpPurchaseOrder.findFirst({ where: { id: orderId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!po || po.status !== 'SUBMITTED' || po.isClosed) throw new DomainError('Only a submitted, open purchase order can be received.');
    const items = await tx.erpItem.findMany({ where: { id: { in: po.lines.map((l) => l.itemId) }, isStockItem: true }, select: { id: true } });
    const stock = new Set(items.map((i) => i.id));
    const drafted = await tx.erpPurchaseReceiptLine.groupBy({ by: ['orderLineId'], where: { orderLineId: { in: po.lines.map((l) => l.id) }, receipt: { status: 'DRAFT' } }, _sum: { qty: true } });
    const onDraft = new Map(drafted.map((d) => [d.orderLineId!, D(d._sum.qty)]));
    const open = po.lines
      .filter((l) => stock.has(l.itemId))
      .map((l) => ({ l, qty: D(l.qty).minus(D(l.receivedQty)).minus(onDraft.get(l.id) ?? ZERO) }))
      .filter((x) => x.qty.greaterThan(0));
    if (open.length === 0) throw new DomainError('Nothing is left to receive on this order (drafts count too).');
    const pr = await tx.erpPurchaseReceipt.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.purchaseReceipt), supplierId: po.supplierId, postingDate, projectId: po.projectId, remarks: `Against ${po.number}`, createdById: p.userId },
    });
    await tx.erpPurchaseReceiptLine.createMany({
      data: open.map(({ l, qty }, n) => ({ receiptId: pr.id, itemId: l.itemId, orderLineId: l.id, qty, rate: l.rate, amount: money(qty.times(l.rate)), gstRate: l.gstRate, warehouseId: l.warehouseId, sortOrder: n })),
    });
    await recompute(tx, pr.id);
    return pr;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const pr = await tx.erpPurchaseReceipt.findFirst({ where: { id, companyId: p.companyId } });
  if (!pr) throw new NotFoundError('Purchase receipt not found.');
  if (pr.status !== 'DRAFT') throw new DomainError(`${pr.number} is ${pr.status.toLowerCase()} and can't be changed.`);
  return pr;
}

export async function addPurchaseReceiptLine(p: Principal, id: string, input: Raw<PriceLineInput>) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  const data = priceLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (!item.isStockItem) throw new DomainError(`${item.code} is not a stock item. Bill it on a purchase invoice instead.`);
    const warehouseId = (await assertWarehouse(p.companyId, data.warehouseId, tx)) ?? item.defaultWarehouseId ?? (await systemWarehouseId(p.companyId, 'STORES', tx));
    const count = await tx.erpPurchaseReceiptLine.count({ where: { receiptId: id } });
    await tx.erpPurchaseReceiptLine.create({ data: { receiptId: id, itemId: item.id, qty: data.qty, rate: data.rate, amount: money(data.qty.times(data.rate)), gstRate: item.gstRate, warehouseId, sortOrder: count } });
    await recompute(tx, id);
  });
}

/** Accepted and rejected quantities (and the rate, if the line has no order). */
export async function updatePurchaseReceiptLine(p: Principal, id: string, lineId: string, input: Raw<LineEditInput>) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  const data = lineEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const line = await tx.erpPurchaseReceiptLine.findFirst({ where: { id: lineId, receiptId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    const rate = line.orderLineId ? D(line.rate) : (data.rate ?? D(line.rate));
    await tx.erpPurchaseReceiptLine.update({ where: { id: lineId }, data: { qty: data.qty, rejectedQty: data.rejectedQty ?? ZERO, rate, amount: money(data.qty.times(rate)) } });
    await recompute(tx, id);
  });
}

export async function removePurchaseReceiptLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPurchaseReceiptLine.deleteMany({ where: { id: lineId, receiptId: id } });
    await recompute(tx, id);
  });
}

export async function deletePurchaseReceipt(p: Principal, id: string) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPurchaseReceipt.delete({ where: { id } });
  });
}

export async function updatePurchaseReceipt(p: Principal, id: string, input: Raw<PurchaseReceiptInput>) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  const data = purchaseReceiptSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    return tx.erpPurchaseReceipt.update({ where: { id }, data });
  });
}

export async function submitPurchaseReceipt(p: Principal, id: string) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  return prisma.$transaction(async (tx) => {
    const pr = await tx.erpPurchaseReceipt.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!pr) throw new NotFoundError('Purchase receipt not found.');
    const { count } = await tx.erpPurchaseReceipt.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${pr.number} was already submitted or cancelled.`);
    if (pr.lines.length === 0) throw new DomainError('Add at least one item before submitting.');
    await assertInspected(tx, 'purchase', pr.lines.filter((l) => D(l.qty).greaterThan(0)));

    const items = await tx.erpItem.findMany({ where: { id: { in: pr.lines.map((l) => l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    // Over-receipt is refused: never more than the order still expects.
    for (const l of pr.lines) {
      if (!l.orderLineId) continue;
      const ol = await tx.erpPurchaseOrderLine.findUnique({ where: { id: l.orderLineId }, include: { order: true } });
      if (!ol || ol.order.status !== 'SUBMITTED' || ol.order.isClosed) throw new DomainError(`The order for ${byId.get(l.itemId)?.code} is no longer open.`);
      const left = D(ol.qty).minus(D(ol.receivedQty));
      if (D(l.qty).greaterThan(left)) throw new DomainError(`${byId.get(l.itemId)?.code}: only ${formatQty(left)} left to receive on ${ol.order.number}.`);
    }

    const v: Voucher = { companyId: p.companyId, type: VOUCHER, id: pr.id, no: pr.number, postingDate: pr.postingDate, projectId: pr.projectId };
    const rejectedWh = await systemWarehouseId(p.companyId, 'REJECTED', tx);
    const accepted = pr.lines.filter((l) => D(l.qty).greaterThan(0));
    const moves = await postStock(tx, v, accepted.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId, qty: D(l.qty), rate: D(l.rate), lineId: l.id })));
    const rejected = pr.lines.filter((l) => D(l.rejectedQty).greaterThan(0));
    if (rejected.length) await postStock(tx, v, rejected.map((l) => ({ itemId: l.itemId, warehouseId: rejectedWh, qty: D(l.rejectedQty), rate: ZERO, lineId: l.id })));
    const value = sum(moves, (m) => m.valueChange);
    await postGl(tx, v, [
      { account: 'STOCK_IN_HAND', debit: value },
      { account: 'SRBNB', credit: value, remarks: `Received from supplier` },
    ]);

    for (const l of pr.lines) if (l.orderLineId) await applyReceived(tx, l.orderLineId, D(l.qty));
    const supplier = await tx.erpParty.findUnique({ where: { id: pr.supplierId }, select: { name: true } });
    for (const l of accepted) {
      const item = byId.get(l.itemId)!;
      await tx.erpItem.update({ where: { id: item.id }, data: { lastPurchaseRate: l.rate } });
      const salesItem = await tx.salesItem.findUnique({ where: { companyId_code: { companyId: p.companyId, code: item.code } }, select: { id: true } });
      if (salesItem) {
        await tx.salesItemPrice.create({ data: { itemId: salesItem.id, source: 'PURCHASE', rate: l.rate, supplier: supplier?.name ?? null, reference: pr.number, effectiveDate: pr.postingDate, createdById: p.userId } });
      }
    }
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.purchase_receipt.submitted', entityType: 'ErpPurchaseReceipt', entityId: id, diff: { number: pr.number, value: value.toFixed(2) } }, tx);
  });
}

export async function cancelPurchaseReceipt(p: Principal, id: string) {
  await manageArea(p, 'stock').catch(() => manageArea(p, 'buying'));
  return prisma.$transaction(async (tx) => {
    const pr = await tx.erpPurchaseReceipt.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!pr) throw new NotFoundError('Purchase receipt not found.');
    if (pr.lines.some((l) => D(l.billedQty).greaterThan(0))) throw new DomainError(`${pr.number} has been billed. Cancel the purchase invoice first.`);
    const { count } = await tx.erpPurchaseReceipt.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted receipt can be cancelled; ${pr.number} is ${pr.status.toLowerCase()}.`);
    await cancelPostings(tx, { companyId: p.companyId, type: VOUCHER, id, no: pr.number, postingDate: pr.postingDate, projectId: pr.projectId });
    for (const l of pr.lines) if (l.orderLineId) await applyReceived(tx, l.orderLineId, D(l.qty).negated());
    await tx.salesItemPrice.deleteMany({ where: { reference: pr.number, source: 'PURCHASE', item: { companyId: p.companyId } } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.purchase_receipt.cancelled', entityType: 'ErpPurchaseReceipt', entityId: id }, tx);
  });
}
