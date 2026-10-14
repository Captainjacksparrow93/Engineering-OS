import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, formatQty, money, sum, ZERO } from '../domain/money';
import { deliveryNoteSchema, lineEditSchema, type DeliveryNoteInput, type LineEditInput, type Raw } from '../validation';
import { manageArea, readArea } from './access';
import { cancelPostings, postGl, postStock, type Voucher } from './posting';
import { assertInspected } from './quality.service';
import { applyDelivered } from './sales-order.service';
import { nextNumber, SERIES } from './series';

/**
 * Delivery Note (ERPNext): goods out to the customer against a sales order. Stock leaves at
 * its valuation and is expensed:  Dr Cost of Goods Sold (tagged with the project)  Cr Stock In Hand.
 * Only stock items are delivered; services on the order are billed directly.
 */

export const VOUCHER = 'Delivery Note';
const lineInclude = { lines: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.ErpDeliveryNoteInclude;

export async function listDeliveryNotes(p: Principal, f: { customerId?: string | null } = {}) {
  await readArea(p, 'selling').catch(() => readArea(p, 'stock'));
  const rows = await prisma.erpDeliveryNote.findMany({ where: { companyId: p.companyId, ...(f.customerId ? { customerId: f.customerId } : {}) }, orderBy: { createdAt: 'desc' }, take: 300, include: { lines: { select: { qty: true, billedQty: true } } } });
  const customers = await prisma.erpParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } });
  const name = new Map(customers.map((c) => [c.id, c.name]));
  return rows.map(({ lines, ...r }) => ({ ...r, customerName: name.get(r.customerId) ?? '—', toBill: r.status === 'SUBMITTED' && lines.some((l) => D(l.qty).greaterThan(D(l.billedQty))) }));
}

export async function getDeliveryNote(p: Principal, id: string) {
  await readArea(p, 'selling').catch(() => readArea(p, 'stock'));
  const dn = await prisma.erpDeliveryNote.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
  if (!dn) throw new NotFoundError('Delivery note not found.');
  const [items, customer, warehouses, orderLines, gl] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: dn.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true, inspectionBeforeDelivery: true } }),
    prisma.erpParty.findUnique({ where: { id: dn.customerId } }),
    prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
    prisma.erpSalesOrderLine.findMany({ where: { id: { in: dn.lines.map((l) => l.orderLineId).filter((x): x is string => !!x) } }, include: { order: { select: { id: true, number: true } } } }),
    prisma.erpGlEntry.findMany({ where: { voucherType: VOUCHER, voucherId: id }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { dn, customer, items: new Map(items.map((i) => [i.id, i])), warehouses: new Map(warehouses.map((w) => [w.id, w.name])), orders: new Map(orderLines.map((l) => [l.id, l.order])), gl };
}

async function recompute(tx: Tx, id: string) {
  const lines = await tx.erpDeliveryNoteLine.findMany({ where: { deliveryNoteId: id } });
  await tx.erpDeliveryNote.update({ where: { id }, data: { netTotal: sum(lines, (l) => l.amount) } });
}

/** Sales order → draft delivery for everything still to deliver (stock items only). */
export async function makeDeliveryFromOrder(p: Principal, orderId: string, postingDate: Date) {
  await manageArea(p, 'selling').catch(() => manageArea(p, 'stock'));
  return prisma.$transaction(async (tx) => {
    const so = await tx.erpSalesOrder.findFirst({ where: { id: orderId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!so || so.status !== 'SUBMITTED' || so.isClosed) throw new DomainError('Only a submitted, open sales order can be delivered.');
    if (so.isOnHold) throw new DomainError(`${so.number} is on hold.`);
    const stock = new Set((await tx.erpItem.findMany({ where: { id: { in: so.lines.map((l) => l.itemId) }, isStockItem: true }, select: { id: true } })).map((i) => i.id));
    const drafted = await tx.erpDeliveryNoteLine.groupBy({ by: ['orderLineId'], where: { orderLineId: { in: so.lines.map((l) => l.id) }, deliveryNote: { status: 'DRAFT' } }, _sum: { qty: true } });
    const onDraft = new Map(drafted.map((d) => [d.orderLineId!, D(d._sum.qty)]));
    const open = so.lines
      .filter((l) => stock.has(l.itemId))
      .map((l) => ({ l, qty: D(l.qty).minus(D(l.deliveredQty)).minus(onDraft.get(l.id) ?? ZERO) }))
      .filter((x) => x.qty.greaterThan(0));
    if (open.length === 0) throw new DomainError('Nothing is left to deliver on this order (drafts count too).');
    const dn = await tx.erpDeliveryNote.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.deliveryNote), customerId: so.customerId, postingDate, projectId: so.projectId, remarks: `Against ${so.number}${so.poNo ? `, PO ${so.poNo}` : ''}`, createdById: p.userId },
    });
    await tx.erpDeliveryNoteLine.createMany({
      data: open.map(({ l, qty }, n) => ({ deliveryNoteId: dn.id, itemId: l.itemId, orderLineId: l.id, qty, rate: l.rate, amount: money(qty.times(l.rate)), gstRate: l.gstRate, warehouseId: l.warehouseId, sortOrder: n })),
    });
    await recompute(tx, dn.id);
    return dn;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const dn = await tx.erpDeliveryNote.findFirst({ where: { id, companyId: p.companyId } });
  if (!dn) throw new NotFoundError('Delivery note not found.');
  if (dn.status !== 'DRAFT') throw new DomainError(`${dn.number} is ${dn.status.toLowerCase()} and can't be changed.`);
  return dn;
}

export async function updateDeliveryNote(p: Principal, id: string, input: Raw<DeliveryNoteInput>) {
  await manageArea(p, 'selling').catch(() => manageArea(p, 'stock'));
  const data = deliveryNoteSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    return tx.erpDeliveryNote.update({ where: { id }, data });
  });
}

export async function updateDeliveryLine(p: Principal, id: string, lineId: string, input: Raw<LineEditInput>) {
  await manageArea(p, 'selling').catch(() => manageArea(p, 'stock'));
  const data = lineEditSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const line = await tx.erpDeliveryNoteLine.findFirst({ where: { id: lineId, deliveryNoteId: id } });
    if (!line) throw new NotFoundError('Line not found.');
    await tx.erpDeliveryNoteLine.update({ where: { id: lineId }, data: { qty: data.qty, amount: money(data.qty.times(line.rate)) } });
    await recompute(tx, id);
  });
}

export async function removeDeliveryLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'selling').catch(() => manageArea(p, 'stock'));
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpDeliveryNoteLine.deleteMany({ where: { id: lineId, deliveryNoteId: id } });
    await recompute(tx, id);
  });
}

export async function deleteDeliveryNote(p: Principal, id: string) {
  await manageArea(p, 'selling').catch(() => manageArea(p, 'stock'));
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpDeliveryNote.delete({ where: { id } });
  });
}

export async function submitDeliveryNote(p: Principal, id: string) {
  await manageArea(p, 'selling').catch(() => manageArea(p, 'stock'));
  return prisma.$transaction(async (tx) => {
    const dn = await tx.erpDeliveryNote.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!dn) throw new NotFoundError('Delivery note not found.');
    const { count } = await tx.erpDeliveryNote.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${dn.number} was already submitted or cancelled.`);
    if (dn.lines.length === 0) throw new DomainError('Add at least one item before submitting.');
    await assertInspected(tx, 'delivery', dn.lines);
    const items = await tx.erpItem.findMany({ where: { id: { in: dn.lines.map((l) => l.itemId) } }, select: { id: true, code: true } });
    const code = new Map(items.map((i) => [i.id, i.code]));
    for (const l of dn.lines) {
      if (!l.orderLineId) continue;
      const ol = await tx.erpSalesOrderLine.findUnique({ where: { id: l.orderLineId }, include: { order: true } });
      if (!ol || ol.order.status !== 'SUBMITTED' || ol.order.isClosed || ol.order.isOnHold) throw new DomainError(`The order for ${code.get(l.itemId)} is not open for delivery.`);
      const left = D(ol.qty).minus(D(ol.deliveredQty));
      if (D(l.qty).greaterThan(left)) throw new DomainError(`${code.get(l.itemId)}: only ${formatQty(left)} left to deliver on ${ol.order.number}.`);
    }
    const v: Voucher = { companyId: p.companyId, type: VOUCHER, id, no: dn.number, postingDate: dn.postingDate, projectId: dn.projectId };
    const moves = await postStock(tx, v, dn.lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId, qty: D(l.qty).negated(), lineId: l.id })));
    for (const [i, l] of dn.lines.entries()) await tx.erpDeliveryNoteLine.update({ where: { id: l.id }, data: { costAmount: moves[i]!.valueChange.negated() } });
    const cost = sum(moves, (m) => m.valueChange).negated();
    await postGl(tx, v, [{ account: 'COGS', debit: cost, remarks: 'Goods delivered' }, { account: 'STOCK_IN_HAND', credit: cost }]);
    for (const l of dn.lines) if (l.orderLineId) await applyDelivered(tx, l.orderLineId, D(l.qty));
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.delivery_note.submitted', entityType: 'ErpDeliveryNote', entityId: id, diff: { number: dn.number, cost: cost.toFixed(2) } }, tx);
  });
}

export async function cancelDeliveryNote(p: Principal, id: string) {
  await manageArea(p, 'selling').catch(() => manageArea(p, 'stock'));
  return prisma.$transaction(async (tx) => {
    const dn = await tx.erpDeliveryNote.findFirst({ where: { id, companyId: p.companyId }, include: lineInclude });
    if (!dn) throw new NotFoundError('Delivery note not found.');
    if (dn.lines.some((l) => D(l.billedQty).greaterThan(0))) throw new DomainError(`${dn.number} has been billed. Cancel the sales invoice first.`);
    const { count } = await tx.erpDeliveryNote.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted delivery can be cancelled; ${dn.number} is ${dn.status.toLowerCase()}.`);
    await cancelPostings(tx, { companyId: p.companyId, type: VOUCHER, id, no: dn.number, postingDate: dn.postingDate, projectId: dn.projectId });
    for (const l of dn.lines) if (l.orderLineId) await applyDelivered(tx, l.orderLineId, D(l.qty).negated());
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.delivery_note.cancelled', entityType: 'ErpDeliveryNote', entityId: id }, tx);
  });
}

