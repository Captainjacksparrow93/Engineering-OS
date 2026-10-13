import type { ErpWorkOrder, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, formatQty, money, sum, ZERO } from '../domain/money';
import { percent } from '../domain/totals';
import { qtySchema, workOrderSchema, type Raw, type WorkOrderInput } from '../validation';
import { assertProject, manageArea, readArea } from './access';
import { defaultBom, explodeBom } from './bom.service';
import { itemByCode } from './item.service';
import { adjustBin } from './posting';
import { nextNumber, SERIES } from './series';
import { systemWarehouseId } from './setup';
import { cancelStockEntryTx, submitStockEntryTx } from './stock-entry.service';

/**
 * Work Order (ERPNext). Makes `qty` of an item from a BOM:
 *   submit      → required materials from the BOM, job cards per operation, bin planned qty;
 *   transfer    → a "transfer for manufacture" stock entry, source → Work In Progress;
 *   manufacture → a "manufacture" stock entry: materials consumed from WIP, the finished item
 *                 into Finished Goods at material cost + operating cost (job-card time if
 *                 logged, else the BOM's operation cost).
 * Usually made from a sales order's panel line, so it carries the order's PM project.
 */

export function woState(wo: Pick<ErpWorkOrder, 'status' | 'isStopped' | 'qty' | 'producedQty' | 'materialTransferredQty'>) {
  if (wo.status === 'DRAFT') return { key: 'DRAFT', label: 'Draft', produced: 0 };
  if (wo.status === 'CANCELLED') return { key: 'CANCELLED', label: 'Cancelled', produced: 0 };
  const produced = percent(D(wo.producedQty), D(wo.qty));
  if (produced >= 100) return { key: 'COMPLETED', label: 'Completed', produced };
  if (wo.isStopped) return { key: 'CLOSED', label: 'Stopped', produced };
  if (D(wo.materialTransferredQty).greaterThan(0) || D(wo.producedQty).greaterThan(0)) return { key: 'IN_PROCESS', label: 'In process', produced };
  return { key: 'NOT_STARTED', label: 'Not started', produced };
}

export async function listWorkOrders(p: Principal, f: { status?: string | null; projectId?: string | null; salesOrderId?: string | null } = {}) {
  await readArea(p, 'manufacturing');
  const rows = await prisma.erpWorkOrder.findMany({
    where: {
      companyId: p.companyId,
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.salesOrderId ? { salesOrderId: f.salesOrderId } : {}),
      ...(f.status === 'DRAFT' || f.status === 'CANCELLED' ? { status: f.status } : f.status === 'OPEN' ? { status: 'SUBMITTED', isStopped: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const items = await prisma.erpItem.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } }, select: { id: true, code: true, name: true, uom: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const orders = await prisma.erpSalesOrder.findMany({ where: { id: { in: rows.map((r) => r.salesOrderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const so = new Map(orders.map((o) => [o.id, o.number]));
  return rows
    .map((r) => ({ ...r, item: byId.get(r.itemId), salesOrderNumber: r.salesOrderId ? so.get(r.salesOrderId) ?? null : null, state: woState(r) }))
    .filter((r) => f.status !== 'OPEN' || r.state.key !== 'COMPLETED');
}

export async function getWorkOrder(p: Principal, id: string) {
  await readArea(p, 'manufacturing');
  const wo = await prisma.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  if (!wo) throw new NotFoundError('Work order not found.');
  const [items, bom, warehouses, jobCards, entries, salesOrder, project] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: [wo.itemId, ...wo.items.map((i) => i.itemId)] } }, select: { id: true, code: true, name: true, uom: true } }),
    prisma.erpBom.findUnique({ where: { id: wo.bomId }, select: { id: true, number: true, operatingCost: true, qty: true } }),
    prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
    prisma.erpJobCard.findMany({ where: { workOrderId: id }, orderBy: { sequence: 'asc' } }),
    prisma.erpStockEntry.findMany({ where: { workOrderId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, number: true, purpose: true, status: true, postingDate: true, totalValue: true } }),
    wo.salesOrderId ? prisma.erpSalesOrder.findUnique({ where: { id: wo.salesOrderId }, select: { id: true, number: true } }) : null,
    wo.projectId ? prisma.project.findUnique({ where: { id: wo.projectId }, select: { id: true, code: true, name: true } }) : null,
  ]);
  const workstations = await prisma.erpWorkstation.findMany({ where: { id: { in: jobCards.map((j) => j.workstationId) } }, select: { id: true, name: true } });
  return { wo, bom, salesOrder, project, items: new Map(items.map((i) => [i.id, i])), warehouses: new Map(warehouses.map((w) => [w.id, w.name])), workstations: new Map(workstations.map((w) => [w.id, w.name])), jobCards, entries, state: woState(wo) };
}

async function warehouses(tx: Tx, companyId: string) {
  return {
    stores: await systemWarehouseId(companyId, 'STORES', tx),
    wip: await systemWarehouseId(companyId, 'WIP', tx),
    fg: await systemWarehouseId(companyId, 'FINISHED_GOODS', tx),
  };
}

async function newWorkOrder(tx: Tx, p: Principal, data: { itemId: string; bomId: string; qty: Dec; plannedStart?: Date | null; expectedEnd?: Date | null; projectId?: string | null; salesOrderId?: string | null; salesOrderLineId?: string | null; productionPlanId?: string | null; remarks?: string | null; fgWarehouseId?: string | null }) {
  const wh = await warehouses(tx, p.companyId);
  return tx.erpWorkOrder.create({
    data: {
      companyId: p.companyId,
      number: await nextNumber(tx, p.companyId, SERIES.workOrder),
      itemId: data.itemId,
      bomId: data.bomId,
      qty: data.qty,
      plannedStart: data.plannedStart ?? null,
      expectedEnd: data.expectedEnd ?? null,
      sourceWarehouseId: wh.stores,
      wipWarehouseId: wh.wip,
      fgWarehouseId: data.fgWarehouseId ?? wh.fg,
      salesOrderId: data.salesOrderId ?? null,
      salesOrderLineId: data.salesOrderLineId ?? null,
      productionPlanId: data.productionPlanId ?? null,
      projectId: data.projectId ?? null,
      remarks: data.remarks ?? null,
      createdById: p.userId,
    },
  });
}

export async function createWorkOrder(p: Principal, input: Raw<WorkOrderInput>) {
  await manageArea(p, 'manufacturing');
  const data = workOrderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (!item.isStockItem) throw new DomainError(`${item.code} is not a stock item, so it can't be manufactured.`);
    const bom = data.bomId ? await tx.erpBom.findFirst({ where: { id: data.bomId, companyId: p.companyId, itemId: item.id, status: 'SUBMITTED', isActive: true } }) : await defaultBom(p.companyId, item.id, tx);
    if (!bom) throw new DomainError(`${item.code} has no submitted BOM. Make one first.`);
    const wo = await newWorkOrder(tx, p, { itemId: item.id, bomId: bom.id, qty: data.qty, plannedStart: data.plannedStart, expectedEnd: data.expectedEnd, projectId: await assertProject(p.companyId, data.projectId), remarks: data.remarks });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.work_order.created', entityType: 'ErpWorkOrder', entityId: wo.id, diff: { number: wo.number } }, tx);
    return wo;
  });
}

/** Sales order → one draft work order per panel line not yet covered by work orders. */
export async function makeWorkOrdersFromSalesOrder(p: Principal, salesOrderId: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const so = await tx.erpSalesOrder.findFirst({ where: { id: salesOrderId, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!so || so.status !== 'SUBMITTED' || so.isClosed) throw new DomainError('Only a submitted, open sales order can be planned.');
    const items = await tx.erpItem.findMany({ where: { id: { in: so.lines.map((l) => l.itemId) }, isStockItem: true } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const covered = await tx.erpWorkOrder.groupBy({ by: ['salesOrderLineId'], where: { salesOrderLineId: { in: so.lines.map((l) => l.id) }, status: { not: 'CANCELLED' } }, _sum: { qty: true } });
    const done = new Map(covered.map((c) => [c.salesOrderLineId!, D(c._sum.qty)]));
    const made = [];
    const missing: string[] = [];
    for (const line of so.lines) {
      const item = byId.get(line.itemId);
      if (!item) continue;
      const qty = D(line.qty).minus(D(line.deliveredQty)).minus(done.get(line.id) ?? ZERO);
      if (qty.lessThanOrEqualTo(0)) continue;
      const bom = await defaultBom(p.companyId, item.id, tx);
      if (!bom) {
        missing.push(item.code);
        continue;
      }
      made.push(await newWorkOrder(tx, p, { itemId: item.id, bomId: bom.id, qty, expectedEnd: line.deliveryDate ?? so.deliveryDate, projectId: so.projectId, salesOrderId: so.id, salesOrderLineId: line.id, remarks: `For ${so.number}${so.woNumber ? `, WO ${so.woNumber}` : ''}`, fgWarehouseId: line.warehouseId }));
    }
    if (made.length === 0) throw new DomainError(missing.length ? `Make a BOM first for ${missing.join(', ')}.` : 'Every line on this order already has work orders.');
    return { made, missing };
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const wo = await tx.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId } });
  if (!wo) throw new NotFoundError('Work order not found.');
  if (wo.status !== 'DRAFT') throw new DomainError(`${wo.number} is ${wo.status.toLowerCase()} and can't be changed.`);
  return wo;
}

export async function updateWorkOrderQty(p: Principal, id: string, input: { qty: string }) {
  await manageArea(p, 'manufacturing');
  const { qty } = qtySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    return tx.erpWorkOrder.update({ where: { id }, data: { qty } });
  });
}

export async function deleteWorkOrder(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpWorkOrder.delete({ where: { id } });
  });
}

const toProduce = (wo: { qty: Prisma.Decimal.Value; producedQty: Prisma.Decimal.Value; isStopped: boolean }) => (wo.isStopped ? ZERO : Dec.max(ZERO, D(wo.qty).minus(D(wo.producedQty))));

export async function submitWorkOrder(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const wo = await tx.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId } });
    if (!wo) throw new NotFoundError('Work order not found.');
    const { count } = await tx.erpWorkOrder.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${wo.number} was already submitted or cancelled.`);
    const bom = await tx.erpBom.findUniqueOrThrow({ where: { id: wo.bomId }, include: { operations: { orderBy: { sequence: 'asc' } } } });
    if (bom.status !== 'SUBMITTED') throw new DomainError(`${bom.number} is no longer submitted.`);
    const lines = await explodeBom(bom.id, D(wo.qty), false, tx);
    await tx.erpWorkOrderItem.createMany({ data: lines.map((l, n) => ({ workOrderId: id, itemId: l.itemId, requiredQty: l.qty, sourceWarehouseId: wo.sourceWarehouseId, sortOrder: n })) });
    const factor = D(wo.qty).dividedBy(D(bom.qty));
    for (const [n, op] of bom.operations.entries()) {
      await tx.erpJobCard.create({
        data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.jobCard), workOrderId: id, operation: op.operation, workstationId: op.workstationId, sequence: n, forQty: wo.qty, plannedMinutes: D(op.timeMinutes).times(factor).toDecimalPlaces(2), hourRate: op.hourRate },
      });
    }
    await adjustBin(tx, p.companyId, wo.itemId, wo.fgWarehouseId, 'plannedQty', toProduce(wo));
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.work_order.submitted', entityType: 'ErpWorkOrder', entityId: id, diff: { number: wo.number, qty: wo.qty.toString() } }, tx);
  });
}

export async function setWorkOrderStopped(p: Principal, id: string, stopped: boolean) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const wo = await tx.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId } });
    if (!wo || wo.status !== 'SUBMITTED') throw new DomainError('Only a submitted work order can be stopped or resumed.');
    if (wo.isStopped === stopped) return;
    await adjustBin(tx, p.companyId, wo.itemId, wo.fgWarehouseId, 'plannedQty', toProduce({ ...wo, isStopped: false }).times(stopped ? -1 : 1));
    await tx.erpWorkOrder.update({ where: { id }, data: { isStopped: stopped } });
  });
}

export async function cancelWorkOrder(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const wo = await tx.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId } });
    if (!wo) throw new NotFoundError('Work order not found.');
    const live = await tx.erpStockEntry.count({ where: { workOrderId: id, status: 'SUBMITTED' } });
    if (live > 0) throw new DomainError(`${wo.number} has stock entries. Cancel them from this page first.`);
    const { count } = await tx.erpWorkOrder.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError('Only a submitted work order can be cancelled.');
    await adjustBin(tx, p.companyId, wo.itemId, wo.fgWarehouseId, 'plannedQty', toProduce(wo).negated());
    await tx.erpJobCard.updateMany({ where: { workOrderId: id, status: { not: 'COMPLETED' } }, data: { status: 'CANCELLED' } });
    await tx.erpStockEntry.deleteMany({ where: { workOrderId: id, status: 'DRAFT' } });
  });
}

function assertRunning(wo: ErpWorkOrder) {
  if (wo.status !== 'SUBMITTED') throw new DomainError(`${wo.number} is not submitted.`);
  if (wo.isStopped) throw new DomainError(`${wo.number} is stopped. Resume it first.`);
}

/** Moves the materials for `qty` (default: the rest) of the finished item into Work In Progress. */
export async function transferMaterials(p: Principal, id: string, input: { qty?: string | null }, postingDate: Date) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const wo = await tx.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!wo) throw new NotFoundError('Work order not found.');
    assertRunning(wo);
    const left = D(wo.qty).minus(D(wo.materialTransferredQty));
    if (left.lessThanOrEqualTo(0)) throw new DomainError('All materials are already in Work In Progress.');
    const qty = input.qty ? qtySchema.parse({ qty: input.qty }).qty : left;
    if (qty.greaterThan(left)) throw new DomainError(`Only ${formatQty(left)} is left to transfer.`);
    const target = D(wo.materialTransferredQty).plus(qty);
    const lines = wo.items
      .map((i) => ({ i, move: D(i.requiredQty).times(target).dividedBy(D(wo.qty)).toDecimalPlaces(3, Dec.ROUND_UP).minus(D(i.transferredQty)) }))
      .filter((x) => x.move.greaterThan(0));
    const entry = await tx.erpStockEntry.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.stockEntry), purpose: 'TRANSFER_FOR_MANUFACTURE', postingDate, fromWarehouseId: wo.sourceWarehouseId, toWarehouseId: wo.wipWarehouseId, projectId: wo.projectId, workOrderId: id, remarks: `Materials for ${wo.number}`, createdById: p.userId },
    });
    await tx.erpStockEntryLine.createMany({ data: lines.map(({ i, move }, n) => ({ entryId: entry.id, itemId: i.itemId, qty: move, fromWarehouseId: i.sourceWarehouseId, toWarehouseId: wo.wipWarehouseId, sortOrder: n })) });
    if (lines.length) await submitStockEntryTx(tx, p, entry.id);
    else await tx.erpStockEntry.update({ where: { id: entry.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedById: p.userId } });
    for (const { i, move } of lines) await tx.erpWorkOrderItem.update({ where: { id: i.id }, data: { transferredQty: { increment: move } } });
    await tx.erpWorkOrder.update({ where: { id }, data: { materialTransferredQty: target } });
    return entry;
  });
}

/** Operating cost for `qty`: job-card time × rate if any was logged, else the BOM's operation cost. */
async function operatingCost(tx: Tx, wo: ErpWorkOrder, qty: Dec) {
  const cards = await tx.erpJobCard.findMany({ where: { workOrderId: wo.id, status: { not: 'CANCELLED' } } });
  const logged = cards.filter((c) => D(c.totalMinutes).greaterThan(0));
  if (logged.length) {
    const total = sum(logged, (c) => D(c.totalMinutes).times(D(c.hourRate)).dividedBy(60));
    return money(total.times(qty).dividedBy(D(wo.qty)));
  }
  const bom = await tx.erpBom.findUniqueOrThrow({ where: { id: wo.bomId } });
  return money(D(bom.operatingCost).times(qty).dividedBy(D(bom.qty)));
}

/** Finishes `qty`: consumes its materials from WIP and puts the finished item into stock. */
export async function manufacture(p: Principal, id: string, input: { qty: string }, postingDate: Date) {
  await manageArea(p, 'manufacturing');
  const { qty } = qtySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const wo = await tx.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!wo) throw new NotFoundError('Work order not found.');
    assertRunning(wo);
    const ready = D(wo.materialTransferredQty).minus(D(wo.producedQty));
    if (qty.greaterThan(D(wo.qty).minus(D(wo.producedQty)))) throw new DomainError(`Only ${formatQty(D(wo.qty).minus(D(wo.producedQty)))} is left to make.`);
    if (qty.greaterThan(ready)) throw new DomainError(`Materials are in WIP for ${formatQty(ready)} only. Transfer materials first.`);
    const last = D(wo.producedQty).plus(qty).greaterThanOrEqualTo(D(wo.qty));
    const consume = wo.items
      .map((i) => {
        const open = D(i.transferredQty).minus(D(i.consumedQty));
        const share = last ? open : Dec.min(open, D(i.requiredQty).times(qty).dividedBy(D(wo.qty)).toDecimalPlaces(3, Dec.ROUND_UP));
        return { i, q: share };
      })
      .filter((x) => x.q.greaterThan(0));
    const entry = await tx.erpStockEntry.create({
      data: {
        companyId: p.companyId,
        number: await nextNumber(tx, p.companyId, SERIES.stockEntry),
        purpose: 'MANUFACTURE',
        postingDate,
        fromWarehouseId: wo.wipWarehouseId,
        toWarehouseId: wo.fgWarehouseId,
        projectId: wo.projectId,
        workOrderId: id,
        additionalCost: await operatingCost(tx, wo, qty),
        remarks: `Production of ${wo.number}`,
        createdById: p.userId,
      },
    });
    await tx.erpStockEntryLine.createMany({
      data: [
        ...consume.map(({ i, q }, n) => ({ entryId: entry.id, itemId: i.itemId, qty: q, fromWarehouseId: wo.wipWarehouseId, sortOrder: n })),
        { entryId: entry.id, itemId: wo.itemId, qty, toWarehouseId: wo.fgWarehouseId, isFinishedGood: true, sortOrder: consume.length },
      ],
    });
    await submitStockEntryTx(tx, p, entry.id);
    for (const { i, q } of consume) await tx.erpWorkOrderItem.update({ where: { id: i.id }, data: { consumedQty: { increment: q } } });
    await tx.erpWorkOrder.update({ where: { id }, data: { producedQty: { increment: qty } } });
    await adjustBin(tx, p.companyId, wo.itemId, wo.fgWarehouseId, 'plannedQty', Dec.min(qty, toProduce(wo)).negated());
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.work_order.manufactured', entityType: 'ErpWorkOrder', entityId: id, diff: { number: wo.number, qty: qty.toString(), entry: entry.number } }, tx);
    return entry;
  });
}

/** Cancels the latest stock entry of a work order, undoing its progress (ERPNext cancels entries one by one, newest first). */
export async function cancelWorkOrderEntry(p: Principal, id: string, entryId: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const wo = await tx.erpWorkOrder.findFirst({ where: { id, companyId: p.companyId }, include: { items: true } });
    if (!wo) throw new NotFoundError('Work order not found.');
    const latest = await tx.erpStockEntry.findFirst({ where: { workOrderId: id, status: 'SUBMITTED' }, orderBy: { createdAt: 'desc' }, include: { lines: true } });
    if (!latest || latest.id !== entryId) throw new DomainError('Cancel the newest entry of this work order first.');
    await cancelStockEntryTx(tx, p, entryId);
    const byItem = new Map(wo.items.map((i) => [i.itemId, i]));
    if (latest.purpose === 'TRANSFER_FOR_MANUFACTURE') {
      for (const l of latest.lines) {
        const i = byItem.get(l.itemId);
        if (i) await tx.erpWorkOrderItem.update({ where: { id: i.id }, data: { transferredQty: { decrement: l.qty } } });
      }
      // Transferred FG qty is what every line can still cover.
      const items = await tx.erpWorkOrderItem.findMany({ where: { workOrderId: id } });
      const covered = items.length ? Dec.min(...items.map((i) => D(i.transferredQty).times(D(wo.qty)).dividedBy(D(i.requiredQty)))) : ZERO;
      await tx.erpWorkOrder.update({ where: { id }, data: { materialTransferredQty: Dec.max(D(wo.producedQty), Dec.min(D(wo.qty), covered)).toDecimalPlaces(3) } });
    } else if (latest.purpose === 'MANUFACTURE') {
      const fg = latest.lines.find((l) => l.isFinishedGood)!;
      for (const l of latest.lines.filter((x) => !x.isFinishedGood)) {
        const i = byItem.get(l.itemId);
        if (i) await tx.erpWorkOrderItem.update({ where: { id: i.id }, data: { consumedQty: { decrement: l.qty } } });
      }
      const before = toProduce(wo);
      await tx.erpWorkOrder.update({ where: { id }, data: { producedQty: { decrement: fg.qty } } });
      const after = toProduce({ ...wo, producedQty: D(wo.producedQty).minus(D(fg.qty)) });
      await adjustBin(tx, p.companyId, wo.itemId, wo.fgWarehouseId, 'plannedQty', after.minus(before));
    }
  });
}
