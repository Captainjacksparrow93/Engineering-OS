import type { ErpSalesOrder, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, formatMoney, formatQty, money, sum, ZERO } from '../domain/money';
import { computeTotals, orderStatus, percent } from '../domain/totals';
import {
  salesLineEditSchema,
  salesLineSchema,
  salesOrderSchema,
  submittedOrderSchema,
  type Raw,
  type SalesLineEditInput,
  type SalesLineInput,
  type SalesOrderInput,
  type SubmittedOrderInput,
} from '../validation';
import { manageArea, readArea } from './access';
import { assertWarehouse, itemByCode } from './item.service';
import { activeParty, partyBalance } from './party.service';
import { adjustBin } from './posting';
import { nextNumber, SERIES } from './series';
import { systemWarehouseId } from './setup';

/**
 * Sales Order (ERPNext). Carries the WO number, client PO, panels and delivery dates that a
 * PM project is made from (plan 014). Submitting reserves stock and checks the credit limit.
 * After submit the PO, dates, WO and items can still change ("Update Items"); PM follows
 * through the safe sync (plan 015). Deliveries and invoices drive the status.
 */

const lineInclude = { lines: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.ErpSalesOrderInclude;
type Line = { qty: Prisma.Decimal.Value; deliveredQty: Prisma.Decimal.Value; billedQty: Prisma.Decimal.Value; itemId: string };

export function soState(so: Pick<ErpSalesOrder, 'status' | 'isClosed' | 'isOnHold'>, lines: Line[], stockItems: Set<string>) {
  const stock = lines.filter((l) => stockItems.has(l.itemId));
  const delivered = percent(sum(stock, (l) => Dec.min(D(l.qty), D(l.deliveredQty))), sum(stock, (l) => l.qty));
  const billed = percent(sum(lines, (l) => Dec.min(D(l.qty), D(l.billedQty))), sum(lines, (l) => l.qty));
  if (so.status === 'SUBMITTED' && so.isOnHold && !so.isClosed) return { key: 'ON_HOLD', label: 'On hold', delivered, billed };
  return { ...orderStatus(so, delivered, billed, { fulfil: 'Deliver' }), delivered, billed };
}

async function stockItemIds(ids: string[], tx: Tx = prisma) {
  const rows = await tx.erpItem.findMany({ where: { id: { in: [...new Set(ids)] }, isStockItem: true }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export async function listSalesOrders(p: Principal, f: { customerId?: string | null; status?: string | null; q?: string | null; projectId?: string | null } = {}) {
  await readArea(p, 'selling');
  const rows = await prisma.erpSalesOrder.findMany({
    where: {
      companyId: p.companyId,
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.status === 'DRAFT' || f.status === 'CANCELLED' ? { status: f.status } : f.status === 'OPEN' ? { status: 'SUBMITTED', isClosed: false } : f.status === 'NO_PROJECT' ? { status: 'SUBMITTED', isClosed: false, projectId: null } : {}),
      ...(f.q ? { OR: [{ number: { contains: f.q, mode: 'insensitive' } }, { poNo: { contains: f.q, mode: 'insensitive' } }, { woNumber: { contains: f.q } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { lines: { select: { qty: true, deliveredQty: true, billedQty: true, itemId: true } } },
  });
  const stock = await stockItemIds(rows.flatMap((r) => r.lines.map((l) => l.itemId)));
  const customers = await prisma.erpParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } });
  const name = new Map(customers.map((c) => [c.id, c.name]));
  const projects = await prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId).filter((x): x is string => !!x) } }, select: { id: true, code: true } });
  const code = new Map(projects.map((x) => [x.id, x.code]));
  return rows.map(({ lines, ...so }) => ({ ...so, customerName: name.get(so.customerId) ?? '—', projectCode: so.projectId ? code.get(so.projectId) ?? null : null, state: soState(so, lines, stock) }));
}

export async function getSalesOrder(p: Principal, id: string) {
  await readArea(p, 'selling');
  const so = await prisma.erpSalesOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
  if (!so) throw new NotFoundError('Sales order not found.');
  const [items, customer, warehouses, project, deliveries, invoices] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: so.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true, isStockItem: true } }),
    prisma.erpParty.findUnique({ where: { id: so.customerId } }),
    prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
    so.projectId ? prisma.project.findUnique({ where: { id: so.projectId }, select: { id: true, code: true, name: true } }) : null,
    prisma.erpDeliveryNote.findMany({ where: { lines: { some: { orderLineId: { in: so.lines.map((l) => l.id) } } } }, select: { id: true, number: true, status: true, postingDate: true } }),
    prisma.erpSalesInvoice.findMany({ where: { lines: { some: { orderLineId: { in: so.lines.map((l) => l.id) } } } }, select: { id: true, number: true, status: true, postingDate: true } }),
  ]);
  const stock = new Set(items.filter((i) => i.isStockItem).map((i) => i.id));
  return { so, customer, project, items: new Map(items.map((i) => [i.id, i])), warehouses: new Map(warehouses.map((w) => [w.id, w.name])), state: soState(so, so.lines, stock), deliveries, invoices };
}

export async function salesOrderIdByNumber(companyId: string, number: string) {
  const so = await prisma.erpSalesOrder.findUnique({ where: { companyId_number: { companyId, number } }, select: { id: true } });
  return so?.id ?? null;
}

export async function recomputeSalesOrder(tx: Tx, id: string) {
  const so = await tx.erpSalesOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  const [settings, customer] = await Promise.all([tx.erpSettings.findUnique({ where: { companyId: so.companyId } }), tx.erpParty.findUnique({ where: { id: so.customerId } })]);
  // Touching updatedAt is what PM's order sync looks at, so any change here reaches the project.
  await tx.erpSalesOrder.update({ where: { id }, data: { ...computeTotals(so.lines, settings?.companyState, customer?.state), updatedAt: new Date() } });
}

/** Reserved qty follows what is still to deliver on an open order. */
const toDeliver = (l: { qty: Prisma.Decimal.Value; deliveredQty: Prisma.Decimal.Value }, closed: boolean) => (closed ? ZERO : Dec.max(ZERO, D(l.qty).minus(D(l.deliveredQty))));

async function reserve(tx: Tx, companyId: string, lines: Array<{ itemId: string; warehouseId: string; qty: Prisma.Decimal.Value; deliveredQty: Prisma.Decimal.Value }>, sign: 1 | -1, closed = false) {
  const stock = await stockItemIds(lines.map((l) => l.itemId), tx);
  for (const l of lines) if (stock.has(l.itemId)) await adjustBin(tx, companyId, l.itemId, l.warehouseId, 'reservedQty', toDeliver(l, closed).times(sign));
}

/** Delivery progress on an order line: delivered qty and the bin's reserved qty move together. */
export async function applyDelivered(tx: Tx, orderLineId: string, delta: Dec) {
  const line = await tx.erpSalesOrderLine.findUnique({ where: { id: orderLineId }, include: { order: true } });
  if (!line) return;
  const before = toDeliver(line, line.order.isClosed);
  const delivered = D(line.deliveredQty).plus(delta);
  await tx.erpSalesOrderLine.update({ where: { id: orderLineId }, data: { deliveredQty: delivered } });
  const after = toDeliver({ qty: line.qty, deliveredQty: delivered }, line.order.isClosed);
  const stock = await stockItemIds([line.itemId], tx);
  if (stock.size) await adjustBin(tx, line.order.companyId, line.itemId, line.warehouseId, 'reservedQty', after.minus(before));
}

async function checkWo(tx: Tx, companyId: string, wo: string | null, orderId: string | null, projectId: string | null) {
  if (!wo) return;
  const other = await tx.erpSalesOrder.findFirst({ where: { companyId, woNumber: wo, status: { not: 'CANCELLED' }, ...(orderId ? { id: { not: orderId } } : {}) }, select: { number: true } });
  if (other) throw new DomainError(`WO ${wo} is already on sales order ${other.number}.`);
  const project = await tx.project.findFirst({ where: { workOrderNo: wo, ...(projectId ? { id: { not: projectId } } : {}) }, select: { code: true } });
  if (project) throw new DomainError(`WO ${wo} is already used by project ${project.code}.`);
}

export async function createSalesOrder(p: Principal, input: Raw<SalesOrderInput>) {
  await manageArea(p, 'selling');
  const data = salesOrderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await activeParty(tx, p.companyId, 'CUSTOMER', data.customerId);
    await checkWo(tx, p.companyId, data.woNumber, null, null);
    const settings = await tx.erpSettings.findUnique({ where: { companyId: p.companyId } });
    const so = await tx.erpSalesOrder.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.salesOrder), ...data, terms: data.terms ?? (settings?.salesTerms || null), createdById: p.userId },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.sales_order.created', entityType: 'ErpSalesOrder', entityId: so.id, diff: { number: so.number } }, tx);
    return so;
  });
}

async function loadOrder(tx: Tx, p: Principal, id: string, allowSubmitted: boolean) {
  const so = await tx.erpSalesOrder.findFirst({ where: { id, companyId: p.companyId } });
  if (!so) throw new NotFoundError('Sales order not found.');
  if (so.status === 'DRAFT') return so;
  if (allowSubmitted && so.status === 'SUBMITTED' && !so.isClosed) return so;
  throw new DomainError(`${so.number} is ${so.isClosed ? 'closed' : so.status.toLowerCase()} and can't be changed.`);
}

export async function updateSalesOrder(p: Principal, id: string, input: Raw<SalesOrderInput>) {
  await manageArea(p, 'selling');
  const data = salesOrderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const so = await loadOrder(tx, p, id, false);
    await activeParty(tx, p.companyId, 'CUSTOMER', data.customerId);
    await checkWo(tx, p.companyId, data.woNumber, id, so.projectId);
    await tx.erpSalesOrder.update({ where: { id }, data });
    await recomputeSalesOrder(tx, id);
  });
}

/** After submit: client PO, target date and WO may change; the PM project follows on its next sync. */
export async function updateSubmittedSalesOrder(p: Principal, id: string, input: Raw<SubmittedOrderInput>) {
  await manageArea(p, 'selling');
  const data = submittedOrderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const so = await loadOrder(tx, p, id, true);
    await checkWo(tx, p.companyId, data.woNumber, id, so.projectId);
    if (so.status === 'SUBMITTED' && !data.woNumber) throw new DomainError('A submitted order keeps its WO number.');
    await tx.erpSalesOrder.update({ where: { id }, data });
    await recomputeSalesOrder(tx, id);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.sales_order.updated_after_submit', entityType: 'ErpSalesOrder', entityId: id, diff: { poNo: data.poNo, woNumber: data.woNumber, deliveryDate: data.deliveryDate?.toISOString().slice(0, 10) ?? null } }, tx);
  });
}

export async function addSalesOrderLine(p: Principal, id: string, input: Raw<SalesLineInput>) {
  await manageArea(p, 'selling');
  const data = salesLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const so = await loadOrder(tx, p, id, true);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (!item.isSalesItem) throw new DomainError(`${item.code} is not sold to customers. Tick "Sold to customers" on the item first.`);
    const rate = data.rate ?? D(item.standardRate);
    const warehouseId = (await assertWarehouse(p.companyId, data.warehouseId, tx)) ?? item.defaultWarehouseId ?? (await systemWarehouseId(p.companyId, item.itemGroup === 'Panels' ? 'FINISHED_GOODS' : 'STORES', tx));
    const count = await tx.erpSalesOrderLine.count({ where: { orderId: id } });
    const line = await tx.erpSalesOrderLine.create({
      data: { orderId: id, itemId: item.id, description: data.description, qty: data.qty, rate, amount: money(data.qty.times(rate)), gstRate: item.gstRate, deliveryDate: data.deliveryDate ?? so.deliveryDate, warehouseId, sortOrder: count },
    });
    if (so.status === 'SUBMITTED') await reserve(tx, p.companyId, [line], 1);
    await recomputeSalesOrder(tx, id);
  });
}

export async function updateSalesOrderLine(p: Principal, id: string, lineId: string, input: Raw<SalesLineEditInput>) {
  await manageArea(p, 'selling');
  const data = salesLineEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const so = await loadOrder(tx, p, id, true);
    const line = await tx.erpSalesOrderLine.findFirst({ where: { id: lineId, orderId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    const floor = Dec.max(D(line.deliveredQty), D(line.billedQty));
    if (data.qty.lessThan(floor)) throw new DomainError(`The quantity can't go below the ${formatQty(floor)} already delivered or billed.`);
    if (so.status === 'SUBMITTED' && data.rate && !D(line.billedQty).isZero() && !data.rate.equals(D(line.rate))) throw new DomainError("The rate can't change once the line is billed.");
    const rate = data.rate ?? D(line.rate);
    if (so.status === 'SUBMITTED') await reserve(tx, p.companyId, [line], -1);
    const updated = await tx.erpSalesOrderLine.update({ where: { id: lineId }, data: { qty: data.qty, rate, amount: money(data.qty.times(rate)), deliveryDate: data.deliveryDate ?? line.deliveryDate } });
    if (so.status === 'SUBMITTED') await reserve(tx, p.companyId, [updated], 1);
    await recomputeSalesOrder(tx, id);
  });
}

export async function removeSalesOrderLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'selling');
  return prisma.$transaction(async (tx) => {
    const so = await loadOrder(tx, p, id, true);
    const line = await tx.erpSalesOrderLine.findFirst({ where: { id: lineId, orderId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    if (!D(line.deliveredQty).isZero() || !D(line.billedQty).isZero()) throw new DomainError('This line has deliveries or invoices, so it stays. Reduce it to what was delivered instead.');
    if (so.status === 'SUBMITTED') {
      const left = await tx.erpSalesOrderLine.count({ where: { orderId: id } });
      if (left <= 1) throw new DomainError('A submitted order keeps at least one line. Cancel the order instead.');
      await reserve(tx, p.companyId, [line], -1);
    }
    await tx.erpSalesOrderLine.delete({ where: { id: lineId } });
    await recomputeSalesOrder(tx, id);
  });
}

export async function deleteSalesOrder(p: Principal, id: string) {
  await manageArea(p, 'selling');
  return prisma.$transaction(async (tx) => {
    const so = await loadOrder(tx, p, id, false);
    await tx.erpSalesOrder.delete({ where: { id } });
    if (so.dealId) await tx.salesDeal.updateMany({ where: { id: so.dealId, erpSalesOrder: so.number }, data: { erpSalesOrder: null } });
  });
}

export async function submitSalesOrder(p: Principal, id: string) {
  await manageArea(p, 'selling');
  return prisma.$transaction(async (tx) => {
    const so = await tx.erpSalesOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!so) throw new NotFoundError('Sales order not found.');
    if (so.lines.length === 0) throw new DomainError('Add at least one item before submitting.');
    if (!so.deliveryDate && so.lines.some((l) => !l.deliveryDate)) throw new DomainError('Set the delivery date (on the order or on every line).');
    await checkWo(tx, p.companyId, so.woNumber, id, so.projectId);
    const { count } = await tx.erpSalesOrder.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${so.number} was already submitted or cancelled.`);
    await recomputeSalesOrder(tx, id);
    const fresh = await tx.erpSalesOrder.findUniqueOrThrow({ where: { id } });
    const customer = await tx.erpParty.findUniqueOrThrow({ where: { id: so.customerId } });
    if (customer.creditLimit && D(customer.creditLimit).greaterThan(0)) {
      const owed = await partyBalance(p.companyId, 'CUSTOMER', customer.id);
      const open = await tx.erpSalesOrder.findMany({ where: { companyId: p.companyId, customerId: customer.id, status: 'SUBMITTED', isClosed: false, id: { not: id } }, include: { lines: true } });
      const unbilled = open.reduce((acc, o) => acc.plus(sum(o.lines, (l) => Dec.max(ZERO, D(l.qty).minus(D(l.billedQty))).times(l.rate))), ZERO);
      const exposure = owed.plus(unbilled).plus(fresh.grandTotal);
      if (exposure.greaterThan(D(customer.creditLimit))) throw new DomainError(`${customer.name} would be ${formatMoney(exposure)} against a credit limit of ${formatMoney(customer.creditLimit)}. Raise the limit or collect payment first.`);
    }
    await reserve(tx, p.companyId, so.lines, 1);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.sales_order.submitted', entityType: 'ErpSalesOrder', entityId: id, diff: { number: so.number, grandTotal: fresh.grandTotal.toFixed(2), woNumber: so.woNumber } }, tx);
  });
}

export async function cancelSalesOrder(p: Principal, id: string) {
  await manageArea(p, 'selling');
  return prisma.$transaction(async (tx) => {
    const so = await tx.erpSalesOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!so) throw new NotFoundError('Sales order not found.');
    if (so.lines.some((l) => !D(l.deliveredQty).isZero() || !D(l.billedQty).isZero())) throw new DomainError(`${so.number} has deliveries or invoices. Cancel those first, or close the order.`);
    const { count } = await tx.erpSalesOrder.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted order can be cancelled; ${so.number} is ${so.status.toLowerCase()}.`);
    await reserve(tx, p.companyId, so.lines, -1, so.isClosed);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.sales_order.cancelled', entityType: 'ErpSalesOrder', entityId: id, diff: { number: so.number, projectId: so.projectId } }, tx);
  });
}

export async function setSalesOrderClosed(p: Principal, id: string, closed: boolean) {
  await manageArea(p, 'selling');
  return prisma.$transaction(async (tx) => {
    const so = await tx.erpSalesOrder.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!so) throw new NotFoundError('Sales order not found.');
    if (so.status !== 'SUBMITTED') throw new DomainError('Only a submitted order can be closed or re-opened.');
    if (so.isClosed === closed) return;
    await tx.erpSalesOrder.update({ where: { id }, data: { isClosed: closed } });
    await reserve(tx, p.companyId, so.lines, closed ? -1 : 1);
    await audit({ actorId: p.userId, module: 'erp', action: closed ? 'erp.sales_order.closed' : 'erp.sales_order.reopened', entityType: 'ErpSalesOrder', entityId: id }, tx);
  });
}

export async function setSalesOrderOnHold(p: Principal, id: string, onHold: boolean) {
  await manageArea(p, 'selling');
  const so = await prisma.erpSalesOrder.findFirst({ where: { id, companyId: p.companyId } });
  if (!so) throw new NotFoundError('Sales order not found.');
  if (so.status !== 'SUBMITTED' || so.isClosed) throw new DomainError('Only an open, submitted order can be put on hold.');
  await prisma.erpSalesOrder.update({ where: { id }, data: { isOnHold: onHold } });
}
