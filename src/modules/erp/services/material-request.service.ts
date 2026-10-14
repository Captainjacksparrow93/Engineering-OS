import type { ErpMaterialRequestPurpose, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { canManage } from './access';
import { D, Dec, sum, ZERO } from '../domain/money';
import { percent } from '../domain/totals';
import { materialRequestLineSchema, materialRequestSchema, type MaterialRequestInput, type MaterialRequestLineInput, type Raw } from '../validation';
import { assertProject, manageArea, readArea } from './access';
import { assertWarehouse, itemByCode } from './item.service';
import { adjustBin } from './posting';
import { reorderList } from './stock-report.service';
import { nextNumber, SERIES } from './series';
import { systemWarehouseId } from './setup';

/**
 * Material Request (ERPNext): ask for material to be bought (Purchase), moved (Transfer) or
 * issued (Issue), usually for a project. Purchase requests raise the bins' requested qty
 * until purchase orders cover them; transfers and issues are fulfilled by stock entries.
 *
 * Anyone with stock or buying access can raise one (stores and production ask, buying buys).
 */

export const MR_PURPOSE_LABEL: Record<ErpMaterialRequestPurpose, string> = { PURCHASE: 'Purchase', TRANSFER: 'Transfer', ISSUE: 'Issue' };

async function guardRead(p: Principal) {
  await readArea(p, 'buying').catch(() => readArea(p, 'stock'));
}
async function guardManage(p: Principal) {
  if (canManage(p, 'buying')) return manageArea(p, 'buying');
  return manageArea(p, 'stock');
}

/** Open (still wanted) quantity of a line. */
export const pendingQty = (line: { qty: Prisma.Decimal.Value; orderedQty: Prisma.Decimal.Value }, stopped = false): Dec =>
  stopped ? ZERO : Dec.max(ZERO, D(line.qty).minus(D(line.orderedQty)));

export function mrStatus(mr: { status: string; isStopped: boolean; purpose: ErpMaterialRequestPurpose }, lines: Array<{ qty: Prisma.Decimal.Value; orderedQty: Prisma.Decimal.Value }>) {
  if (mr.status !== 'SUBMITTED') return { key: mr.status, label: mr.status === 'DRAFT' ? 'Draft' : 'Cancelled' };
  const pct = percent(sum(lines, (l) => Dec.min(D(l.qty), D(l.orderedQty))), sum(lines, (l) => l.qty));
  const done = mr.purpose === 'PURCHASE' ? 'Ordered' : mr.purpose === 'TRANSFER' ? 'Transferred' : 'Issued';
  if (pct >= 100) return { key: 'COMPLETED', label: done };
  if (mr.isStopped) return { key: 'CLOSED', label: 'Stopped' };
  if (pct > 0) return { key: 'PARTLY', label: `Partly ${done.toLowerCase()} (${pct}%)` };
  return { key: 'PENDING', label: 'Pending' };
}

export async function listMaterialRequests(p: Principal, f: { status?: string | null; projectId?: string | null; open?: boolean } = {}) {
  await guardRead(p);
  const rows = await prisma.erpMaterialRequest.findMany({
    where: {
      companyId: p.companyId,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.open ? { status: 'SUBMITTED', isStopped: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { lines: { select: { qty: true, orderedQty: true } } },
  });
  return rows.map(({ lines, ...mr }) => ({ ...mr, lineCount: lines.length, state: mrStatus(mr, lines) }));
}

export async function getMaterialRequest(p: Principal, id: string) {
  await guardRead(p);
  const mr = await prisma.erpMaterialRequest.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!mr) throw new NotFoundError('Material request not found.');
  const items = await prisma.erpItem.findMany({ where: { id: { in: mr.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true } });
  return { mr, items: new Map(items.map((i) => [i.id, i])), state: mrStatus(mr, mr.lines) };
}

export async function createMaterialRequest(p: Principal, input: Raw<MaterialRequestInput>) {
  await guardManage(p);
  const data = materialRequestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const mr = await tx.erpMaterialRequest.create({
      data: {
        companyId: p.companyId,
        number: await nextNumber(tx, p.companyId, SERIES.materialRequest),
        purpose: data.purpose,
        requestDate: data.requestDate,
        requiredBy: data.requiredBy,
        warehouseId: (await assertWarehouse(p.companyId, data.warehouseId, tx)) ?? (await systemWarehouseId(p.companyId, 'STORES', tx)),
        projectId: await assertProject(p.companyId, data.projectId),
        remarks: data.remarks,
        createdById: p.userId,
      },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.material_request.created', entityType: 'ErpMaterialRequest', entityId: mr.id, diff: { number: mr.number } }, tx);
    return mr;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const mr = await tx.erpMaterialRequest.findFirst({ where: { id, companyId: p.companyId } });
  if (!mr) throw new NotFoundError('Material request not found.');
  if (mr.status !== 'DRAFT') throw new DomainError(`${mr.number} is ${mr.status.toLowerCase()} and can't be changed.`);
  return mr;
}

export async function updateMaterialRequest(p: Principal, id: string, input: Raw<MaterialRequestInput>) {
  await guardManage(p);
  const data = materialRequestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const mr = await loadDraft(tx, p, id);
    if (data.purpose !== mr.purpose) throw new DomainError("A request's purpose can't change. Delete the draft and start again.");
    return tx.erpMaterialRequest.update({
      where: { id },
      data: { requestDate: data.requestDate, requiredBy: data.requiredBy, warehouseId: (await assertWarehouse(p.companyId, data.warehouseId, tx)) ?? mr.warehouseId, projectId: await assertProject(p.companyId, data.projectId), remarks: data.remarks },
    });
  });
}

export async function addMaterialRequestLine(p: Principal, id: string, input: Raw<MaterialRequestLineInput>) {
  await guardManage(p);
  const data = materialRequestLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const mr = await loadDraft(tx, p, id);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (mr.purpose !== 'PURCHASE' && !item.isStockItem) throw new DomainError(`${item.code} is not a stock item, so it can't be moved or issued.`);
    if (mr.purpose === 'PURCHASE' && !item.isPurchaseItem) throw new DomainError(`${item.code} is not bought from suppliers.`);
    const count = await tx.erpMaterialRequestLine.count({ where: { requestId: id } });
    return tx.erpMaterialRequestLine.create({
      data: { requestId: id, itemId: item.id, qty: data.qty, warehouseId: (await assertWarehouse(p.companyId, data.warehouseId, tx)) ?? mr.warehouseId!, requiredBy: data.requiredBy ?? mr.requiredBy, sortOrder: count },
    });
  });
}

export async function removeMaterialRequestLine(p: Principal, id: string, lineId: string) {
  await guardManage(p);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const { count } = await tx.erpMaterialRequestLine.deleteMany({ where: { id: lineId, requestId: id } });
    if (count === 0) throw new NotFoundError('Line not found.');
  });
}

export async function deleteMaterialRequest(p: Principal, id: string) {
  await guardManage(p);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpMaterialRequest.delete({ where: { id } });
  });
}

async function requestedDelta(tx: Tx, companyId: string, mr: { purpose: ErpMaterialRequestPurpose }, lines: Array<{ itemId: string; warehouseId: string; qty: Prisma.Decimal.Value; orderedQty: Prisma.Decimal.Value }>, sign: 1 | -1, stopped = false) {
  if (mr.purpose !== 'PURCHASE') return;
  for (const l of lines) await adjustBin(tx, companyId, l.itemId, l.warehouseId, 'requestedQty', pendingQty(l, stopped).times(sign));
}

export async function submitMaterialRequestTx(tx: Tx, p: Principal, id: string) {
  const mr = await tx.erpMaterialRequest.findFirst({ where: { id, companyId: p.companyId }, include: { lines: true } });
  if (!mr) throw new NotFoundError('Material request not found.');
  const { count } = await tx.erpMaterialRequest.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
  if (count === 0) throw new DomainError(`${mr.number} was already submitted or cancelled.`);
  if (mr.lines.length === 0) throw new DomainError('Add at least one item before submitting.');
  await requestedDelta(tx, p.companyId, mr, mr.lines, 1);
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.material_request.submitted', entityType: 'ErpMaterialRequest', entityId: id, diff: { number: mr.number } }, tx);
  return mr;
}

export async function submitMaterialRequest(p: Principal, id: string) {
  await guardManage(p);
  return prisma.$transaction((tx) => submitMaterialRequestTx(tx, p, id));
}

export async function cancelMaterialRequest(p: Principal, id: string) {
  await guardManage(p);
  return prisma.$transaction(async (tx) => {
    const mr = await tx.erpMaterialRequest.findFirst({ where: { id, companyId: p.companyId }, include: { lines: true } });
    if (!mr) throw new NotFoundError('Material request not found.');
    if (mr.lines.some((l) => D(l.orderedQty).greaterThan(0))) throw new DomainError(`${mr.number} already has orders or stock entries against it. Cancel those first, or stop the request.`);
    const { count } = await tx.erpMaterialRequest.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted request can be cancelled; ${mr.number} is ${mr.status.toLowerCase()}.`);
    await requestedDelta(tx, p.companyId, mr, mr.lines, -1, mr.isStopped);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.material_request.cancelled', entityType: 'ErpMaterialRequest', entityId: id }, tx);
  });
}

/** Stop: the open quantity is no longer wanted. Re-open brings it back. */
export async function setMaterialRequestStopped(p: Principal, id: string, stopped: boolean) {
  await guardManage(p);
  return prisma.$transaction(async (tx) => {
    const mr = await tx.erpMaterialRequest.findFirst({ where: { id, companyId: p.companyId }, include: { lines: true } });
    if (!mr) throw new NotFoundError('Material request not found.');
    if (mr.status !== 'SUBMITTED') throw new DomainError('Only a submitted request can be stopped or re-opened.');
    if (mr.isStopped === stopped) return mr;
    await tx.erpMaterialRequest.update({ where: { id }, data: { isStopped: stopped } });
    await requestedDelta(tx, p.companyId, mr, mr.lines, stopped ? -1 : 1);
    await audit({ actorId: p.userId, module: 'erp', action: stopped ? 'erp.material_request.stopped' : 'erp.material_request.reopened', entityType: 'ErpMaterialRequest', entityId: id }, tx);
    return mr;
  });
}

/**
 * Called when a purchase order line or a stock entry line linked to a request line is
 * submitted (+) or cancelled (−). Keeps the request's ordered qty and the bin's requested qty right.
 */
export async function applyMaterialRequestProgress(tx: Tx, lineId: string, delta: Dec) {
  const line = await tx.erpMaterialRequestLine.findUnique({ where: { id: lineId }, include: { request: true } });
  if (!line) return;
  const before = pendingQty(line, line.request.isStopped);
  const ordered = D(line.orderedQty).plus(delta);
  await tx.erpMaterialRequestLine.update({ where: { id: lineId }, data: { orderedQty: Dec.max(ZERO, ordered) } });
  const after = pendingQty({ qty: line.qty, orderedQty: Dec.max(ZERO, ordered) }, line.request.isStopped);
  if (line.request.purpose === 'PURCHASE' && line.request.status === 'SUBMITTED') {
    await adjustBin(tx, line.request.companyId, line.itemId, line.warehouseId, 'requestedQty', after.minus(before));
  }
}

/** ERPNext auto re-order: one draft purchase request for every item at or below its reorder level. */
export async function createReorderRequest(p: Principal, today: Date) {
  await guardManage(p);
  const items = await reorderList(p);
  const wanted = items.filter((i) => i.suggestedQty.greaterThan(0));
  if (wanted.length === 0) throw new DomainError('Nothing is at or below its reorder level.');
  return prisma.$transaction(async (tx) => {
    const stores = await systemWarehouseId(p.companyId, 'STORES', tx);
    const mr = await tx.erpMaterialRequest.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.materialRequest), purpose: 'PURCHASE', requestDate: today, warehouseId: stores, remarks: 'Raised from the reorder list', createdById: p.userId },
    });
    await tx.erpMaterialRequestLine.createMany({
      data: wanted.map((i, n) => ({ requestId: mr.id, itemId: i.id, qty: i.suggestedQty, warehouseId: i.defaultWarehouseId ?? stores, requiredBy: i.leadTimeDays ? new Date(today.getTime() + i.leadTimeDays * 86_400_000) : null, sortOrder: n })),
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.material_request.reorder', entityType: 'ErpMaterialRequest', entityId: mr.id, diff: { items: wanted.length } }, tx);
    return mr;
  });
}

/** Transfer/issue request → a draft stock entry for the open quantities. */
export async function makeStockEntryFromRequest(p: Principal, id: string, postingDate: Date) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    const mr = await tx.erpMaterialRequest.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!mr) throw new NotFoundError('Material request not found.');
    if (mr.status !== 'SUBMITTED' || mr.isStopped) throw new DomainError('Only a submitted, open request can be fulfilled.');
    if (mr.purpose === 'PURCHASE') throw new DomainError('A purchase request is fulfilled by a purchase order.');
    const open = mr.lines.filter((l) => pendingQty(l).greaterThan(0));
    if (open.length === 0) throw new DomainError('Everything on this request has been moved already.');
    const stores = await systemWarehouseId(p.companyId, 'STORES', tx);
    const purpose = mr.purpose === 'TRANSFER' ? 'MATERIAL_TRANSFER' : 'MATERIAL_ISSUE';
    const entry = await tx.erpStockEntry.create({
      data: {
        companyId: p.companyId,
        number: await nextNumber(tx, p.companyId, SERIES.stockEntry),
        purpose,
        postingDate,
        fromWarehouseId: stores,
        toWarehouseId: purpose === 'MATERIAL_TRANSFER' ? mr.warehouseId : null,
        projectId: mr.projectId,
        materialRequestId: mr.id,
        remarks: `Against ${mr.number}`,
        createdById: p.userId,
      },
    });
    await tx.erpStockEntryLine.createMany({
      data: open.map((l, n) => ({
        entryId: entry.id,
        itemId: l.itemId,
        qty: pendingQty(l),
        fromWarehouseId: stores,
        toWarehouseId: purpose === 'MATERIAL_TRANSFER' ? l.warehouseId : null,
        materialRequestLineId: l.id,
        sortOrder: n,
      })),
    });
    return entry;
  });
}
