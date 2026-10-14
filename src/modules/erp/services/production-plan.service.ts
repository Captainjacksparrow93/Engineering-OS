import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, ZERO } from '../domain/money';
import { planItemSchema, productionPlanSchema, type PlanItemInput, type ProductionPlanInput, type Raw } from '../validation';
import { manageArea, readArea } from './access';
import { defaultBom, explodeBom } from './bom.service';
import { assertWarehouse, itemByCode } from './item.service';
import { nextNumber, SERIES } from './series';
import { systemWarehouseId } from './setup';
import { projected } from './stock-report.service';

/**
 * Production Plan (ERPNext): what to make (pulled from open sales orders, or typed in), the
 * materials that needs across every BOM level, what is short after stock and open orders, and
 * one click to raise the work orders and a purchase request for the shortages.
 */

export async function listProductionPlans(p: Principal) {
  await readArea(p, 'manufacturing');
  return prisma.erpProductionPlan.findMany({ where: { companyId: p.companyId }, orderBy: { createdAt: 'desc' }, take: 200, include: { _count: { select: { items: true } } } });
}

export async function getProductionPlan(p: Principal, id: string) {
  await readArea(p, 'manufacturing');
  const plan = await prisma.erpProductionPlan.findFirst({ where: { id, companyId: p.companyId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  if (!plan) throw new NotFoundError('Production plan not found.');
  const [items, boms, workOrders, soLines] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: plan.items.map((i) => i.itemId) } }, select: { id: true, code: true, name: true, uom: true } }),
    prisma.erpBom.findMany({ where: { id: { in: plan.items.map((i) => i.bomId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
    prisma.erpWorkOrder.findMany({ where: { productionPlanId: id }, select: { id: true, number: true, status: true, itemId: true, qty: true } }),
    prisma.erpSalesOrderLine.findMany({ where: { id: { in: plan.items.map((i) => i.salesOrderLineId).filter((x): x is string => !!x) } }, include: { order: { select: { id: true, number: true } } } }),
  ]);
  return { plan, items: new Map(items.map((i) => [i.id, i])), boms: new Map(boms.map((b) => [b.id, b.number])), workOrders, soLines: new Map(soLines.map((l) => [l.id, l.order])) };
}

export async function createProductionPlan(p: Principal, input: Raw<ProductionPlanInput>) {
  await manageArea(p, 'manufacturing');
  const data = productionPlanSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const plan = await tx.erpProductionPlan.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.productionPlan), postingDate: data.postingDate, warehouseId: (await assertWarehouse(p.companyId, data.warehouseId, tx)) ?? (await systemWarehouseId(p.companyId, 'STORES', tx)), remarks: data.remarks, createdById: p.userId },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.production_plan.created', entityType: 'ErpProductionPlan', entityId: plan.id, diff: { number: plan.number } }, tx);
    return plan;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const plan = await tx.erpProductionPlan.findFirst({ where: { id, companyId: p.companyId } });
  if (!plan) throw new NotFoundError('Production plan not found.');
  if (plan.status !== 'DRAFT') throw new DomainError(`${plan.number} is ${plan.status.toLowerCase()} and can't be changed.`);
  return plan;
}

/** Pulls every open sales-order line of a manufactured item not yet covered by work orders or this plan. */
export async function getItemsFromSalesOrders(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const lines = await tx.erpSalesOrderLine.findMany({ where: { order: { companyId: p.companyId, status: 'SUBMITTED', isClosed: false, isOnHold: false } }, include: { order: true }, orderBy: [{ deliveryDate: 'asc' }] });
    const covered = await tx.erpWorkOrder.groupBy({ by: ['salesOrderLineId'], where: { salesOrderLineId: { in: lines.map((l) => l.id) }, status: { not: 'CANCELLED' } }, _sum: { qty: true } });
    const onPlans = await tx.erpProductionPlanItem.groupBy({ by: ['salesOrderLineId'], where: { salesOrderLineId: { in: lines.map((l) => l.id) }, plan: { status: { not: 'CANCELLED' } } }, _sum: { qty: true } });
    const done = new Map([...covered, ...onPlans].map((c) => [c.salesOrderLineId!, D(c._sum.qty)]));
    let n = await tx.erpProductionPlanItem.count({ where: { planId: id } });
    let added = 0;
    for (const l of lines) {
      const bom = await defaultBom(p.companyId, l.itemId, tx);
      if (!bom) continue;
      const qty = D(l.qty).minus(D(l.deliveredQty)).minus(done.get(l.id) ?? ZERO);
      if (qty.lessThanOrEqualTo(0)) continue;
      await tx.erpProductionPlanItem.create({ data: { planId: id, itemId: l.itemId, bomId: bom.id, qty, plannedStart: null, salesOrderLineId: l.id, sortOrder: n++ } });
      added++;
    }
    if (added === 0) throw new DomainError('No open sales-order lines need making (lines need an item with a default BOM).');
    return added;
  });
}

export async function addPlanItem(p: Principal, id: string, input: Raw<PlanItemInput>) {
  await manageArea(p, 'manufacturing');
  const data = planItemSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    const bom = await defaultBom(p.companyId, item.id, tx);
    if (!bom) throw new DomainError(`${item.code} has no default BOM.`);
    const n = await tx.erpProductionPlanItem.count({ where: { planId: id } });
    return tx.erpProductionPlanItem.create({ data: { planId: id, itemId: item.id, bomId: bom.id, qty: data.qty, plannedStart: data.plannedStart, sortOrder: n } });
  });
}

export async function removePlanItem(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpProductionPlanItem.deleteMany({ where: { id: lineId, planId: id } });
  });
}

export async function deleteProductionPlan(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpProductionPlan.delete({ where: { id } });
  });
}

export async function submitProductionPlan(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  const plan = await prisma.erpProductionPlan.findFirst({ where: { id, companyId: p.companyId }, include: { _count: { select: { items: true } } } });
  if (!plan) throw new NotFoundError('Production plan not found.');
  if (plan._count.items === 0) throw new DomainError('Add at least one item before submitting.');
  const { count } = await prisma.erpProductionPlan.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
  if (count === 0) throw new DomainError(`${plan.number} was already submitted or cancelled.`);
}

export async function cancelProductionPlan(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  const live = await prisma.erpWorkOrder.count({ where: { productionPlanId: id, status: { not: 'CANCELLED' } } });
  if (live > 0) throw new DomainError('Work orders were made from this plan. Cancel them first.');
  const { count } = await prisma.erpProductionPlan.updateMany({ where: { id, companyId: p.companyId, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
  if (count === 0) throw new DomainError('Only a submitted plan can be cancelled.');
}

export interface MaterialNeed {
  itemId: string;
  code: string;
  name: string;
  uom: string;
  required: Dec;
  projected: Dec;
  shortage: Dec;
  isPurchaseItem: boolean;
}

/** Materials across every BOM level, against stock + incoming − already promised (projected qty). */
export async function materialRequirement(p: Principal, id: string): Promise<MaterialNeed[]> {
  await readArea(p, 'manufacturing');
  const plan = await prisma.erpProductionPlan.findFirst({ where: { id, companyId: p.companyId }, include: { items: true } });
  if (!plan) throw new NotFoundError('Production plan not found.');
  const need = new Map<string, Dec>();
  for (const line of plan.items) {
    if (!line.bomId) continue;
    for (const m of await explodeBom(line.bomId, D(line.qty), true)) need.set(m.itemId, (need.get(m.itemId) ?? ZERO).plus(m.qty));
  }
  const [items, bins] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: [...need.keys()] } } }),
    prisma.erpBin.findMany({ where: { itemId: { in: [...need.keys()] } } }),
  ]);
  const proj = new Map<string, Dec>();
  for (const b of bins) proj.set(b.itemId, (proj.get(b.itemId) ?? ZERO).plus(projected(b)));
  return items
    .map((i) => {
      const required = need.get(i.id)!;
      const available = proj.get(i.id) ?? ZERO;
      return { itemId: i.id, code: i.code, name: i.name, uom: i.uom, required, projected: available, shortage: Dec.max(ZERO, required.minus(Dec.max(ZERO, available))), isPurchaseItem: i.isPurchaseItem };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Draft work orders for every plan line that has none yet. */
export async function makeWorkOrdersFromPlan(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
      const plan = await tx.erpProductionPlan.findFirst({ where: { id, companyId: p.companyId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
      if (!plan || plan.status !== 'SUBMITTED') throw new DomainError('Submit the plan first.');
      const existing = await tx.erpWorkOrder.groupBy({ by: ['itemId'], where: { productionPlanId: id, status: { not: 'CANCELLED' } }, _sum: { qty: true } });
      if (existing.length) throw new DomainError('Work orders were already made from this plan.');
      const [stores, wip, fg] = [await systemWarehouseId(p.companyId, 'STORES', tx), await systemWarehouseId(p.companyId, 'WIP', tx), await systemWarehouseId(p.companyId, 'FINISHED_GOODS', tx)];
      const made = [];
      for (const line of plan.items) {
        if (!line.bomId || D(line.qty).lessThanOrEqualTo(ZERO)) continue;
        const so = line.salesOrderLineId ? await tx.erpSalesOrderLine.findUnique({ where: { id: line.salesOrderLineId }, include: { order: true } }) : null;
        made.push(
          await tx.erpWorkOrder.create({
            data: {
              companyId: p.companyId,
              number: await nextNumber(tx, p.companyId, SERIES.workOrder),
              itemId: line.itemId,
              bomId: line.bomId,
              qty: line.qty,
              plannedStart: line.plannedStart,
              expectedEnd: so?.deliveryDate ?? so?.order.deliveryDate ?? null,
              sourceWarehouseId: stores,
              wipWarehouseId: wip,
              fgWarehouseId: so?.warehouseId ?? fg,
              salesOrderId: so?.orderId ?? null,
              salesOrderLineId: so?.id ?? null,
              productionPlanId: id,
              projectId: so?.order.projectId ?? null,
              remarks: `From ${plan.number}`,
              createdById: p.userId,
            },
          }),
        );
      }
      return made;
    });
}

/** One draft purchase request for the shortages of bought items. */
export async function makeMaterialRequestFromPlan(p: Principal, id: string, today: Date) {
  await manageArea(p, 'manufacturing');
  const plan = await prisma.erpProductionPlan.findFirst({ where: { id, companyId: p.companyId } });
  if (!plan || plan.status !== 'SUBMITTED') throw new DomainError('Submit the plan first.');
  const short = (await materialRequirement(p, id)).filter((m) => m.isPurchaseItem && m.shortage.greaterThan(0));
  if (short.length === 0) throw new DomainError('Nothing is short: stock and open orders cover the plan.');
  return prisma.$transaction(async (tx) => {
    const mr = await tx.erpMaterialRequest.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.materialRequest), purpose: 'PURCHASE', requestDate: today, warehouseId: plan.warehouseId, remarks: `Shortages for ${plan.number}`, createdById: p.userId },
    });
    await tx.erpMaterialRequestLine.createMany({ data: short.map((m, n) => ({ requestId: mr.id, itemId: m.itemId, qty: m.shortage, warehouseId: plan.warehouseId, sortOrder: n })) });
    return mr;
  });
}
