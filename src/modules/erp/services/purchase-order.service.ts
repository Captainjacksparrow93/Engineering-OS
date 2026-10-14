import type { ErpPurchaseOrder, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, money, sum, ZERO } from '../domain/money';
import { computeTotals, orderStatus, percent } from '../domain/totals';
import { lineEditSchema, priceLineSchema, purchaseOrderSchema, type LineEditInput, type PriceLineInput, type PurchaseOrderInput, type Raw } from '../validation';
import { assertProject, manageArea, readArea } from './access';
import { assertWarehouse, itemByCode } from './item.service';
import { applyMaterialRequestProgress, pendingQty } from './material-request.service';
import { activeParty } from './party.service';
import { adjustBin } from './posting';
import { nextNumber, SERIES } from './series';
import { systemWarehouseId } from './setup';

/**
 * Purchase Order (ERPNext). Submitting raises the bins' ordered qty and settles the linked
 * material request lines. Receipts and invoices drive its status: To receive and bill →
 * To bill / To receive → Completed. Close stops whatever is still open.
 */

const lineInclude = { lines: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.ErpPurchaseOrderInclude;

type Line = { qty: Prisma.Decimal.Value; receivedQty: Prisma.Decimal.Value; billedQty: Prisma.Decimal.Value; itemId: string };

export function poProgress(lines: Line[], stockItems: Set<string>) {
  // Only stock items are received; services are just billed (as ERPNext treats non-stock lines).
  const stock = lines.filter((l) => stockItems.has(l.itemId));
  const received = percent(sum(stock, (l) => Dec.min(D(l.qty), D(l.receivedQty))), sum(stock, (l) => l.qty));
  const billed = percent(sum(lines, (l) => Dec.min(D(l.qty), D(l.billedQty))), sum(lines, (l) => l.qty));
  return { received, billed };
}

export function poState(po: Pick<ErpPurchaseOrder, 'status' | 'isClosed'>, lines: Line[], stockItems: Set<string>) {
  const { received, billed } = poProgress(lines, stockItems);
  return { ...orderStatus(po, received, billed, { fulfil: 'Receive' }), received, billed };
}

async function stockItemIds(itemIds: string[]) {
  const rows = await prisma.erpItem.findMany({ where: { id: { in: [...new Set(itemIds)] }, isStockItem: true }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export async function listPurchaseOrders(p: Principal, f: { supplierId?: string | null; projectId?: string | null; status?: string | null; q?: string | null } = {}) {
  await readArea(p, 'buying');
  const rows = await prisma.erpPurchaseOrder.findMany({
    where: {
      companyId: p.companyId,
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.status === 'DRAFT' || f.status === 'CANCELLED' ? { status: f.status } : f.status === 'OPEN' ? { status: 'SUBMITTED', isClosed: false } : {}),
      ...(f.q ? { OR: [{ number: { contains: f.q, mode: 'insensitive' } }, { supplierRef: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { lines: { select: { qty: true, receivedQty: true, billedQty: true, itemId: true } } },
  });
  const stock = await stockItemIds(rows.flatMap((r) => r.lines.map((l) => l.itemId)));
  const suppliers = await prisma.erpParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true } });
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  return rows.map(({ lines, ...po }) => ({ ...po, supplierName: name.get(po.supplierId) ?? '—', state: poState(po, lines, stock) }));
}

export async function getPurchaseOrder(p: Principal, id: string) {
  await readArea(p, 'buying');
  const po = await prisma.erpPurchaseOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
  if (!po) throw new NotFoundError('Purchase order not found.');
  const [items, supplier, warehouses] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: po.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true, isStockItem: true } }),
    prisma.erpParty.findUnique({ where: { id: po.supplierId } }),
    prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
  ]);
  const stock = new Set(items.filter((i) => i.isStockItem).map((i) => i.id));
  const [receipts, invoices] = await Promise.all([
    prisma.erpPurchaseReceipt.findMany({ where: { lines: { some: { orderLineId: { in: po.lines.map((l) => l.id) } } } }, select: { id: true, number: true, status: true, postingDate: true } }),
    prisma.erpPurchaseInvoice.findMany({ where: { lines: { some: { orderLineId: { in: po.lines.map((l) => l.id) } } } }, select: { id: true, number: true, status: true, postingDate: true } }),
  ]);
  return { po, supplier, items: new Map(items.map((i) => [i.id, i])), warehouses: new Map(warehouses.map((w) => [w.id, w.name])), state: poState(po, po.lines, stock), receipts, invoices };
}

/** Recomputes a purchase order's totals with GST by the supplier's state. */
export async function recomputePurchaseOrder(tx: Tx, id: string) {
  const po = await tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  const [settings, supplier] = await Promise.all([tx.erpSettings.findUnique({ where: { companyId: po.companyId } }), tx.erpParty.findUnique({ where: { id: po.supplierId } })]);
  const t = computeTotals(po.lines, settings?.companyState, supplier?.state);
  await tx.erpPurchaseOrder.update({ where: { id }, data: t });
}

export async function createPurchaseOrder(p: Principal, input: Raw<PurchaseOrderInput>) {
  await manageArea(p, 'buying');
  const data = purchaseOrderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await activeParty(tx, p.companyId, 'SUPPLIER', data.supplierId);
    const po = await tx.erpPurchaseOrder.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.purchaseOrder), ...data, projectId: await assertProject(p.companyId, data.projectId), createdById: p.userId },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.purchase_order.created', entityType: 'ErpPurchaseOrder', entityId: po.id, diff: { number: po.number } }, tx);
    return po;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const po = await tx.erpPurchaseOrder.findFirst({ where: { id, companyId: p.companyId } });
  if (!po) throw new NotFoundError('Purchase order not found.');
  if (po.status !== 'DRAFT') throw new DomainError(`${po.number} is ${po.status.toLowerCase()} and can't be changed.`);
  return po;
}

export async function updatePurchaseOrder(p: Principal, id: string, input: Raw<PurchaseOrderInput>) {
  await manageArea(p, 'buying');
  const data = purchaseOrderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await activeParty(tx, p.companyId, 'SUPPLIER', data.supplierId);
    await tx.erpPurchaseOrder.update({ where: { id }, data: { ...data, projectId: await assertProject(p.companyId, data.projectId) } });
    await recomputePurchaseOrder(tx, id);
  });
}

export async function addPurchaseOrderLine(p: Principal, id: string, input: Raw<PriceLineInput>) {
  await manageArea(p, 'buying');
  const data = priceLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const po = await loadDraft(tx, p, id);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (!item.isPurchaseItem) throw new DomainError(`${item.code} is not bought from suppliers.`);
    const warehouseId = (await assertWarehouse(p.companyId, data.warehouseId, tx)) ?? item.defaultWarehouseId ?? (await systemWarehouseId(p.companyId, 'STORES', tx));
    const count = await tx.erpPurchaseOrderLine.count({ where: { orderId: id } });
    await tx.erpPurchaseOrderLine.create({
      data: { orderId: id, itemId: item.id, description: data.description, qty: data.qty, rate: data.rate, amount: money(data.qty.times(data.rate)), gstRate: item.gstRate, warehouseId, scheduleDate: data.scheduleDate ?? po.scheduleDate, sortOrder: count },
    });
    await recomputePurchaseOrder(tx, id);
  });
}

export async function updatePurchaseOrderLine(p: Principal, id: string, lineId: string, input: Raw<LineEditInput>) {
  await manageArea(p, 'buying');
  const data = lineEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const line = await tx.erpPurchaseOrderLine.findFirst({ where: { id: lineId, orderId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    const rate = data.rate ?? D(line.rate);
    await tx.erpPurchaseOrderLine.update({ where: { id: lineId }, data: { qty: data.qty, rate, amount: money(data.qty.times(rate)) } });
    await recomputePurchaseOrder(tx, id);
  });
}

export async function removePurchaseOrderLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPurchaseOrderLine.deleteMany({ where: { id: lineId, orderId: id } });
    await recomputePurchaseOrder(tx, id);
  });
}

export async function deletePurchaseOrder(p: Principal, id: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpPurchaseOrder.delete({ where: { id } });
  });
}

/** Ordered qty still to arrive on a line (0 once the order is closed). */
const toReceive = (l: { qty: Prisma.Decimal.Value; receivedQty: Prisma.Decimal.Value }, closed: boolean) => (closed ? ZERO : Dec.max(ZERO, D(l.qty).minus(D(l.receivedQty))));

async function orderedDelta(tx: Tx, companyId: string, lines: Array<{ itemId: string; warehouseId: string; qty: Prisma.Decimal.Value; receivedQty: Prisma.Decimal.Value }>, sign: 1 | -1, closed = false) {
  for (const l of lines) await adjustBin(tx, companyId, l.itemId, l.warehouseId, 'orderedQty', toReceive(l, closed).times(sign));
}

export async function submitPurchaseOrder(p: Principal, id: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    const po = await tx.erpPurchaseOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!po) throw new NotFoundError('Purchase order not found.');
    if (po.lines.length === 0) throw new DomainError('Add at least one item before submitting.');
    const items = await tx.erpItem.findMany({ where: { id: { in: po.lines.map((l) => l.itemId) } }, select: { id: true, code: true, isStockItem: true } });
    const zero = po.lines.find((l) => D(l.rate).isZero());
    if (zero) throw new DomainError(`Enter a rate for ${items.find((i) => i.id === zero.itemId)?.code ?? 'every line'}.`);
    const { count } = await tx.erpPurchaseOrder.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${po.number} was already submitted or cancelled.`);
    await recomputePurchaseOrder(tx, id);
    const stock = new Set(items.filter((i) => i.isStockItem).map((i) => i.id));
    await orderedDelta(tx, p.companyId, po.lines.filter((l) => stock.has(l.itemId)), 1);
    for (const l of po.lines) if (l.materialRequestLineId) await applyMaterialRequestProgress(tx, l.materialRequestLineId, D(l.qty));
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.purchase_order.submitted', entityType: 'ErpPurchaseOrder', entityId: id, diff: { number: po.number, grandTotal: po.grandTotal.toFixed(2) } }, tx);
  });
}

export async function cancelPurchaseOrder(p: Principal, id: string) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    const po = await tx.erpPurchaseOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!po) throw new NotFoundError('Purchase order not found.');
    if (po.lines.some((l) => D(l.receivedQty).greaterThan(0) || D(l.billedQty).greaterThan(0))) throw new DomainError(`${po.number} has receipts or invoices. Cancel those first, or close the order.`);
    const { count } = await tx.erpPurchaseOrder.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted order can be cancelled; ${po.number} is ${po.status.toLowerCase()}.`);
    const stock = await stockItemIds(po.lines.map((l) => l.itemId));
    await orderedDelta(tx, p.companyId, po.lines.filter((l) => stock.has(l.itemId)), -1, po.isClosed);
    for (const l of po.lines) if (l.materialRequestLineId) await applyMaterialRequestProgress(tx, l.materialRequestLineId, D(l.qty).negated());
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.purchase_order.cancelled', entityType: 'ErpPurchaseOrder', entityId: id }, tx);
  });
}

export async function setPurchaseOrderClosed(p: Principal, id: string, closed: boolean) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    const po = await tx.erpPurchaseOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!po) throw new NotFoundError('Purchase order not found.');
    if (po.status !== 'SUBMITTED') throw new DomainError('Only a submitted order can be closed or re-opened.');
    if (po.isClosed === closed) return;
    await tx.erpPurchaseOrder.update({ where: { id }, data: { isClosed: closed } });
    const stock = await stockItemIds(po.lines.map((l) => l.itemId));
    await orderedDelta(tx, p.companyId, po.lines.filter((l) => stock.has(l.itemId)), closed ? -1 : 1);
    await audit({ actorId: p.userId, module: 'erp', action: closed ? 'erp.purchase_order.closed' : 'erp.purchase_order.reopened', entityType: 'ErpPurchaseOrder', entityId: id }, tx);
  });
}

/** Receipt progress on a PO line: keeps received qty and the bin's ordered qty in step. */
export async function applyReceived(tx: Tx, orderLineId: string, delta: Dec) {
  const line = await tx.erpPurchaseOrderLine.findUnique({ where: { id: orderLineId }, include: { order: true } });
  if (!line) return;
  const before = toReceive(line, line.order.isClosed);
  const received = D(line.receivedQty).plus(delta);
  await tx.erpPurchaseOrderLine.update({ where: { id: orderLineId }, data: { receivedQty: received } });
  const after = toReceive({ qty: line.qty, receivedQty: received }, line.order.isClosed);
  await adjustBin(tx, line.order.companyId, line.itemId, line.warehouseId, 'orderedQty', after.minus(before));
}

/** Purchase request → draft purchase order for the open quantities, at the last purchase rate. */
export async function makePurchaseOrderFromRequest(p: Principal, materialRequestId: string, supplierId: string, orderDate: Date) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    await activeParty(tx, p.companyId, 'SUPPLIER', supplierId);
    const mr = await tx.erpMaterialRequest.findFirst({ where: { id: materialRequestId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!mr || mr.status !== 'SUBMITTED' || mr.isStopped || mr.purpose !== 'PURCHASE') throw new DomainError('Pick a submitted, open purchase request.');
    // Quantities already on draft orders count as taken, so two drafts don't order the same thing.
    const drafted = await tx.erpPurchaseOrderLine.groupBy({ by: ['materialRequestLineId'], where: { materialRequestLineId: { in: mr.lines.map((l) => l.id) }, order: { status: 'DRAFT' } }, _sum: { qty: true } });
    const onDraft = new Map(drafted.map((d) => [d.materialRequestLineId!, D(d._sum.qty)]));
    const open = mr.lines.map((l) => ({ l, qty: pendingQty(l).minus(onDraft.get(l.id) ?? ZERO) })).filter((x) => x.qty.greaterThan(0));
    if (open.length === 0) throw new DomainError('Everything on this request is already ordered or on a draft order.');
    const items = await tx.erpItem.findMany({ where: { id: { in: open.map((x) => x.l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const po = await tx.erpPurchaseOrder.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.purchaseOrder), supplierId, orderDate, scheduleDate: mr.requiredBy, projectId: mr.projectId, remarks: `Against ${mr.number}`, createdById: p.userId },
    });
    await tx.erpPurchaseOrderLine.createMany({
      data: open.map(({ l, qty }, n) => {
        const item = byId.get(l.itemId)!;
        const rate = D(item.lastPurchaseRate);
        return { orderId: po.id, itemId: l.itemId, qty, rate, amount: money(qty.times(rate)), gstRate: item.gstRate, warehouseId: l.warehouseId, scheduleDate: l.requiredBy ?? mr.requiredBy, materialRequestLineId: l.id, sortOrder: n };
      }),
    });
    await recomputePurchaseOrder(tx, po.id);
    return po;
  });
}

/** Supplier quotation → draft purchase order at the quoted rates. */
export async function makePurchaseOrderFromQuotation(p: Principal, quotationId: string, orderDate: Date) {
  await manageArea(p, 'buying');
  return prisma.$transaction(async (tx) => {
    const sq = await tx.erpSupplierQuotation.findFirst({ where: { id: quotationId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!sq || sq.status !== 'SUBMITTED') throw new DomainError('Pick a submitted supplier quotation.');
    await activeParty(tx, p.companyId, 'SUPPLIER', sq.supplierId);
    const mr = sq.materialRequestId ? await tx.erpMaterialRequest.findUnique({ where: { id: sq.materialRequestId } }) : null;
    const items = await tx.erpItem.findMany({ where: { id: { in: sq.lines.map((l) => l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const mrLines = await tx.erpMaterialRequestLine.findMany({ where: { id: { in: sq.lines.map((l) => l.materialRequestLineId).filter((x): x is string => !!x) } } });
    const mrLine = new Map(mrLines.map((l) => [l.id, l]));
    const stores = await systemWarehouseId(p.companyId, 'STORES', tx);
    const po = await tx.erpPurchaseOrder.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.purchaseOrder), supplierId: sq.supplierId, orderDate, scheduleDate: mr?.requiredBy ?? null, projectId: mr?.projectId ?? null, supplierQuotationId: sq.id, supplierRef: sq.supplierRef, remarks: `From ${sq.number}`, createdById: p.userId },
    });
    await tx.erpPurchaseOrderLine.createMany({
      data: sq.lines.map((l, n) => {
        const source = l.materialRequestLineId ? mrLine.get(l.materialRequestLineId) : undefined;
        return { orderId: po.id, itemId: l.itemId, qty: l.qty, rate: l.rate, amount: l.amount, gstRate: byId.get(l.itemId)!.gstRate, warehouseId: source?.warehouseId ?? byId.get(l.itemId)!.defaultWarehouseId ?? stores, scheduleDate: source?.requiredBy ?? null, materialRequestLineId: l.materialRequestLineId, supplierQuotationLineId: l.id, sortOrder: n };
      }),
    });
    await recomputePurchaseOrder(tx, po.id);
    return po;
  });
}

