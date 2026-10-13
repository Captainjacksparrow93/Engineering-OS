import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, money, sum, ZERO } from '../domain/money';
import { bomItemSchema, bomOperationSchema, bomSchema, workstationSchema, type BomInput, type BomItemInput, type BomOperationInput, type Raw, type WorkstationInput } from '../validation';
import { assertProject, manageArea, readArea } from './access';
import { itemByCode } from './item.service';

/**
 * Workstations and Bills of Materials (ERPNext Workstation, BOM). A BOM lists the materials
 * and operations to make `qty` of an item; its cost rolls up from material rates (stock
 * valuation, else last purchase rate, else the sub-assembly's own BOM) and operation time ×
 * workstation rate. A submitted BOM can be the item's default; it adds a BOM_COST price to the
 * Sales catalogue so quotes see what a panel really costs to build.
 */

// ---------------------------------------------------------------- workstations

export async function listWorkstations(p: Principal) {
  await readArea(p, 'manufacturing');
  return prisma.erpWorkstation.findMany({ where: { companyId: p.companyId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
}

export async function workstationOptions(companyId: string) {
  return prisma.erpWorkstation.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, hourRate: true }, orderBy: { name: 'asc' } });
}

export async function createWorkstation(p: Principal, input: Raw<WorkstationInput>) {
  await manageArea(p, 'manufacturing');
  const data = workstationSchema.parse(input);
  const clash = await prisma.erpWorkstation.findUnique({ where: { companyId_name: { companyId: p.companyId, name: data.name } } });
  if (clash) throw new DomainError(`A workstation called ${data.name} already exists.`);
  return prisma.erpWorkstation.create({ data: { companyId: p.companyId, ...data } });
}

export async function updateWorkstation(p: Principal, id: string, input: Raw<WorkstationInput>) {
  await manageArea(p, 'manufacturing');
  const data = workstationSchema.parse(input);
  const ws = await prisma.erpWorkstation.findFirst({ where: { id, companyId: p.companyId } });
  if (!ws) throw new NotFoundError('Workstation not found.');
  const clash = await prisma.erpWorkstation.findUnique({ where: { companyId_name: { companyId: p.companyId, name: data.name } } });
  if (clash && clash.id !== id) throw new DomainError(`A workstation called ${data.name} already exists.`);
  return prisma.erpWorkstation.update({ where: { id }, data });
}

export async function setWorkstationActive(p: Principal, id: string, isActive: boolean) {
  await manageArea(p, 'manufacturing');
  const ws = await prisma.erpWorkstation.findFirst({ where: { id, companyId: p.companyId } });
  if (!ws) throw new NotFoundError('Workstation not found.');
  return prisma.erpWorkstation.update({ where: { id }, data: { isActive } });
}

// ---------------------------------------------------------------- BOMs

export async function listBoms(p: Principal, f: { itemId?: string | null; q?: string | null } = {}) {
  await readArea(p, 'manufacturing');
  const rows = await prisma.erpBom.findMany({
    where: { companyId: p.companyId, ...(f.itemId ? { itemId: f.itemId } : {}), ...(f.q ? { number: { contains: f.q, mode: 'insensitive' } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { _count: { select: { items: true, operations: true } } },
  });
  const items = await prisma.erpItem.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } }, select: { id: true, code: true, name: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => ({ ...r, item: byId.get(r.itemId) }));
}

export async function bomOptions(companyId: string, itemId?: string) {
  return prisma.erpBom.findMany({ where: { companyId, status: 'SUBMITTED', isActive: true, ...(itemId ? { itemId } : {}) }, select: { id: true, number: true, itemId: true, isDefault: true, qty: true }, orderBy: { number: 'asc' } });
}

export async function getBom(p: Principal, id: string) {
  await readArea(p, 'manufacturing');
  const bom = await prisma.erpBom.findFirst({ where: { id, companyId: p.companyId }, include: { items: { orderBy: { sortOrder: 'asc' } }, operations: { orderBy: { sequence: 'asc' } } } });
  if (!bom) throw new NotFoundError('BOM not found.');
  const [items, workstations, children] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: [bom.itemId, ...bom.items.map((i) => i.itemId)] } }, select: { id: true, code: true, name: true, uom: true } }),
    prisma.erpWorkstation.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
    prisma.erpBom.findMany({ where: { id: { in: bom.items.map((i) => i.childBomId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
  ]);
  return { bom, items: new Map(items.map((i) => [i.id, i])), workstations: new Map(workstations.map((w) => [w.id, w.name])), children: new Map(children.map((c) => [c.id, c.number])) };
}

/** The item's default submitted BOM, if any. */
export async function defaultBom(companyId: string, itemId: string, tx: Tx = prisma) {
  return tx.erpBom.findFirst({ where: { companyId, itemId, status: 'SUBMITTED', isActive: true, isDefault: true } });
}

/** A material's cost per unit: stock valuation, else last purchase rate, else its own BOM. */
async function materialRate(tx: Tx, companyId: string, itemId: string, childBomId: string | null): Promise<Dec> {
  const bins = await tx.erpBin.aggregate({ where: { itemId, actualQty: { gt: 0 } }, _sum: { actualQty: true, stockValue: true } });
  const qty = D(bins._sum.actualQty);
  if (qty.greaterThan(0)) return D(bins._sum.stockValue).dividedBy(qty).toDecimalPlaces(2);
  const item = await tx.erpItem.findUniqueOrThrow({ where: { id: itemId }, select: { lastPurchaseRate: true } });
  if (item.lastPurchaseRate && D(item.lastPurchaseRate).greaterThan(0)) return D(item.lastPurchaseRate);
  const child = childBomId ? await tx.erpBom.findUnique({ where: { id: childBomId } }) : await defaultBom(companyId, itemId, tx);
  return child ? D(child.totalCost).dividedBy(D(child.qty)).toDecimalPlaces(2) : ZERO;
}

/** Re-prices every line and rolls the cost up. Drafts always; submitted BOMs on "Update cost". */
export async function recomputeBomCost(tx: Tx, bomId: string) {
  const bom = await tx.erpBom.findUniqueOrThrow({ where: { id: bomId }, include: { items: true, operations: true } });
  for (const line of bom.items) {
    const rate = await materialRate(tx, bom.companyId, line.itemId, line.childBomId);
    await tx.erpBomItem.update({ where: { id: line.id }, data: { rate, amount: money(D(line.qty).times(rate)) } });
  }
  const workstations = await tx.erpWorkstation.findMany({ where: { id: { in: bom.operations.map((o) => o.workstationId) } } });
  const rate = new Map(workstations.map((w) => [w.id, D(w.hourRate)]));
  for (const op of bom.operations) {
    const hourRate = rate.get(op.workstationId) ?? D(op.hourRate);
    await tx.erpBomOperation.update({ where: { id: op.id }, data: { hourRate, cost: money(D(op.timeMinutes).times(hourRate).dividedBy(60)) } });
  }
  const [items, ops] = await Promise.all([tx.erpBomItem.findMany({ where: { bomId } }), tx.erpBomOperation.findMany({ where: { bomId } })]);
  const rawMaterialCost = sum(items, (i) => i.amount);
  const operatingCost = sum(ops, (o) => o.cost);
  return tx.erpBom.update({ where: { id: bomId }, data: { rawMaterialCost, operatingCost, totalCost: rawMaterialCost.plus(operatingCost) } });
}

export async function createBom(p: Principal, input: Raw<BomInput>) {
  await manageArea(p, 'manufacturing');
  const data = bomSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    const count = await tx.erpBom.count({ where: { companyId: p.companyId, itemId: item.id } });
    const bom = await tx.erpBom.create({
      data: { companyId: p.companyId, number: `BOM-${item.code}-${String(count + 1).padStart(3, '0')}`, itemId: item.id, qty: data.qty, projectId: await assertProject(p.companyId, data.projectId), remarks: data.remarks, createdById: p.userId },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.bom.created', entityType: 'ErpBom', entityId: bom.id, diff: { number: bom.number } }, tx);
    return bom;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const bom = await tx.erpBom.findFirst({ where: { id, companyId: p.companyId } });
  if (!bom) throw new NotFoundError('BOM not found.');
  if (bom.status !== 'DRAFT') throw new DomainError(`${bom.number} is ${bom.status.toLowerCase()}. Copy it to make a new revision.`);
  return bom;
}

export async function addBomItem(p: Principal, id: string, input: Raw<BomItemInput>) {
  await manageArea(p, 'manufacturing');
  const data = bomItemSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const bom = await loadDraft(tx, p, id);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (item.id === bom.itemId) throw new DomainError("A BOM can't use the item it makes.");
    const child = await defaultBom(p.companyId, item.id, tx);
    if (child && (await explodesTo(tx, child.id, bom.itemId))) throw new DomainError(`${item.code}'s own BOM uses this item: that would loop.`);
    const count = await tx.erpBomItem.count({ where: { bomId: id } });
    await tx.erpBomItem.create({ data: { bomId: id, itemId: item.id, qty: data.qty, childBomId: child?.id ?? null, sortOrder: count } });
    await recomputeBomCost(tx, id);
  });
}

/** True when `bomId` (at any depth) consumes `itemId`. */
async function explodesTo(tx: Tx, bomId: string, itemId: string, seen = new Set<string>()): Promise<boolean> {
  if (seen.has(bomId)) return false;
  seen.add(bomId);
  const lines = await tx.erpBomItem.findMany({ where: { bomId } });
  for (const l of lines) {
    if (l.itemId === itemId) return true;
    if (l.childBomId && (await explodesTo(tx, l.childBomId, itemId, seen))) return true;
  }
  return false;
}

export async function updateBomItem(p: Principal, id: string, lineId: string, input: { qty: string }) {
  await manageArea(p, 'manufacturing');
  const data = bomItemSchema.pick({ qty: true }).parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const { count } = await tx.erpBomItem.updateMany({ where: { id: lineId, bomId: id }, data: { qty: data.qty } });
    if (count === 0) throw new NotFoundError('Line not found.');
    await recomputeBomCost(tx, id);
  });
}

export async function removeBomItem(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpBomItem.deleteMany({ where: { id: lineId, bomId: id } });
    await recomputeBomCost(tx, id);
  });
}

export async function addBomOperation(p: Principal, id: string, input: Raw<BomOperationInput>) {
  await manageArea(p, 'manufacturing');
  const data = bomOperationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const ws = await tx.erpWorkstation.findFirst({ where: { id: data.workstationId, companyId: p.companyId, isActive: true } });
    if (!ws) throw new DomainError('Pick an active workstation.');
    const count = await tx.erpBomOperation.count({ where: { bomId: id } });
    await tx.erpBomOperation.create({ data: { bomId: id, operation: data.operation, workstationId: ws.id, timeMinutes: data.timeMinutes, hourRate: ws.hourRate, sequence: count } });
    await recomputeBomCost(tx, id);
  });
}

export async function removeBomOperation(p: Principal, id: string, opId: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpBomOperation.deleteMany({ where: { id: opId, bomId: id } });
    await recomputeBomCost(tx, id);
  });
}

export async function deleteBom(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpBom.delete({ where: { id } });
  });
}

/** Adds the BOM's unit cost to the Sales catalogue as a BOM_COST price (plan 018 price sources). */
async function publishCost(tx: Tx, p: Principal, bom: { itemId: string; number: string; totalCost: Dec | number | string; qty: Dec | number | string }, date: Date) {
  const item = await tx.erpItem.findUniqueOrThrow({ where: { id: bom.itemId }, select: { code: true } });
  const salesItem = await tx.salesItem.findUnique({ where: { companyId_code: { companyId: p.companyId, code: item.code } }, select: { id: true } });
  if (!salesItem) return;
  await tx.salesItemPrice.create({ data: { itemId: salesItem.id, source: 'BOM_COST', rate: money(D(bom.totalCost).dividedBy(D(bom.qty))), reference: bom.number, effectiveDate: date, createdById: p.userId } });
}

export async function submitBom(p: Principal, id: string, today: Date) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const bom = await tx.erpBom.findFirst({ where: { id, companyId: p.companyId }, include: { items: true } });
    if (!bom) throw new NotFoundError('BOM not found.');
    if (bom.items.length === 0) throw new DomainError('Add at least one material before submitting.');
    const { count } = await tx.erpBom.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${bom.number} was already submitted or cancelled.`);
    const priced = await recomputeBomCost(tx, id);
    const hasDefault = await defaultBom(p.companyId, bom.itemId, tx);
    if (!hasDefault) await tx.erpBom.update({ where: { id }, data: { isDefault: true } });
    await publishCost(tx, p, priced, today);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.bom.submitted', entityType: 'ErpBom', entityId: id, diff: { number: bom.number, totalCost: priced.totalCost.toFixed(2) } }, tx);
  });
}

export async function cancelBom(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const bom = await tx.erpBom.findFirst({ where: { id, companyId: p.companyId } });
    if (!bom) throw new NotFoundError('BOM not found.');
    const used = await tx.erpWorkOrder.count({ where: { bomId: id, status: { not: 'CANCELLED' } } });
    if (used > 0) throw new DomainError(`${bom.number} is used by work orders. Switch it off instead.`);
    const parents = await tx.erpBomItem.count({ where: { childBomId: id, bom: { status: { not: 'CANCELLED' } } } });
    if (parents > 0) throw new DomainError(`${bom.number} is a sub-assembly in other BOMs.`);
    const { count } = await tx.erpBom.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', isDefault: false, cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError('Only a submitted BOM can be cancelled.');
  });
}

export async function setDefaultBom(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const bom = await tx.erpBom.findFirst({ where: { id, companyId: p.companyId, status: 'SUBMITTED' } });
    if (!bom) throw new DomainError('Only a submitted BOM can be the default.');
    await tx.erpBom.updateMany({ where: { companyId: p.companyId, itemId: bom.itemId }, data: { isDefault: false } });
    await tx.erpBom.update({ where: { id }, data: { isDefault: true, isActive: true } });
  });
}

export async function setBomActive(p: Principal, id: string, isActive: boolean) {
  await manageArea(p, 'manufacturing');
  const bom = await prisma.erpBom.findFirst({ where: { id, companyId: p.companyId } });
  if (!bom) throw new NotFoundError('BOM not found.');
  if (!isActive && bom.isDefault) throw new DomainError('Make another BOM the default first.');
  return prisma.erpBom.update({ where: { id }, data: { isActive } });
}

/** Re-prices a submitted BOM at today's rates (ERPNext "Update Cost") and republishes the cost. */
export async function updateBomCost(p: Principal, id: string, today: Date) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const bom = await tx.erpBom.findFirst({ where: { id, companyId: p.companyId } });
    if (!bom) throw new NotFoundError('BOM not found.');
    const priced = await recomputeBomCost(tx, id);
    if (bom.status === 'SUBMITTED') await publishCost(tx, p, priced, today);
    return priced;
  });
}

/** New draft revision with the same materials and operations. */
export async function copyBom(p: Principal, id: string) {
  await manageArea(p, 'manufacturing');
  return prisma.$transaction(async (tx) => {
    const src = await tx.erpBom.findFirst({ where: { id, companyId: p.companyId }, include: { items: true, operations: true } });
    if (!src) throw new NotFoundError('BOM not found.');
    const item = await tx.erpItem.findUniqueOrThrow({ where: { id: src.itemId } });
    const count = await tx.erpBom.count({ where: { companyId: p.companyId, itemId: src.itemId } });
    const bom = await tx.erpBom.create({
      data: {
        companyId: p.companyId,
        number: `BOM-${item.code}-${String(count + 1).padStart(3, '0')}`,
        itemId: src.itemId,
        qty: src.qty,
        projectId: src.projectId,
        remarks: `Copied from ${src.number}`,
        createdById: p.userId,
        items: { create: src.items.map((i) => ({ itemId: i.itemId, qty: i.qty, childBomId: i.childBomId, sortOrder: i.sortOrder })) },
        operations: { create: src.operations.map((o) => ({ operation: o.operation, workstationId: o.workstationId, timeMinutes: o.timeMinutes, hourRate: o.hourRate, sequence: o.sequence })) },
      },
    });
    await recomputeBomCost(tx, bom.id);
    return bom;
  });
}

export interface ExplodedLine {
  itemId: string;
  qty: Dec;
}

/**
 * Materials needed to make `qty` with a BOM. Single level by default (what a work order
 * consumes); multi-level walks into sub-assemblies that have their own BOM (what a production
 * plan buys).
 */
export async function explodeBom(bomId: string, qty: Dec, multiLevel = false, tx: Tx = prisma, depth = 0): Promise<ExplodedLine[]> {
  if (depth > 10) throw new DomainError('The BOM nests more than 10 levels deep.');
  const bom = await tx.erpBom.findUniqueOrThrow({ where: { id: bomId }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  const factor = qty.dividedBy(D(bom.qty));
  const out = new Map<string, Dec>();
  for (const line of bom.items) {
    const need = D(line.qty).times(factor);
    if (multiLevel && line.childBomId) {
      for (const sub of await explodeBom(line.childBomId, need, true, tx, depth + 1)) out.set(sub.itemId, (out.get(sub.itemId) ?? ZERO).plus(sub.qty));
    } else {
      out.set(line.itemId, (out.get(line.itemId) ?? ZERO).plus(need));
    }
  }
  return [...out.entries()].map(([itemId, q]) => ({ itemId, qty: q.toDecimalPlaces(3, Dec.ROUND_UP) }));
}
