import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, sum } from '../domain/money';
import { reconciliationSchema, reconLineSchema, type ReconciliationInput, type ReconLineInput, type Raw } from '../validation';
import { manageArea, readArea } from './access';
import { assertWarehouse, itemByCode } from './item.service';
import { cancelPostings, postGl, postStock, type Voucher } from './posting';
import { nextNumber, SERIES } from './series';

/**
 * Stock Reconciliation (ERPNext): sets counted quantities and rates. Opening stock posts
 * the difference against Opening Balance Equity; a stock count against Stock Adjustment.
 */

export const VOUCHER = 'Stock Reconciliation';

export async function listReconciliations(p: Principal) {
  await readArea(p, 'stock');
  return prisma.erpStockReconciliation.findMany({ where: { companyId: p.companyId }, orderBy: { createdAt: 'desc' }, take: 200, include: { _count: { select: { lines: true } } } });
}

export async function getReconciliation(p: Principal, id: string) {
  await readArea(p, 'stock');
  const recon = await prisma.erpStockReconciliation.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!recon) throw new NotFoundError('Stock reconciliation not found.');
  const [items, warehouses] = await Promise.all([
    prisma.erpItem.findMany({ where: { id: { in: recon.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true } }),
    prisma.erpWarehouse.findMany({ where: { companyId: p.companyId }, select: { id: true, name: true } }),
  ]);
  return { recon, items: new Map(items.map((i) => [i.id, i])), warehouses: new Map(warehouses.map((w) => [w.id, w.name])) };
}

export async function createReconciliation(p: Principal, input: Raw<ReconciliationInput>) {
  await manageArea(p, 'stock');
  const data = reconciliationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const recon = await tx.erpStockReconciliation.create({
      data: { companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.reconciliation), ...data, createdById: p.userId },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.reconciliation.created', entityType: 'ErpStockReconciliation', entityId: recon.id, diff: { number: recon.number } }, tx);
    return recon;
  });
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const recon = await tx.erpStockReconciliation.findFirst({ where: { id, companyId: p.companyId } });
  if (!recon) throw new NotFoundError('Stock reconciliation not found.');
  if (recon.status !== 'DRAFT') throw new DomainError(`${recon.number} is ${recon.status.toLowerCase()} and can't be changed.`);
  return recon;
}

export async function addReconciliationLine(p: Principal, id: string, input: Raw<ReconLineInput>) {
  await manageArea(p, 'stock');
  const data = reconLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (!item.isStockItem) throw new DomainError(`${item.code} is not a stock item.`);
    const warehouseId = (await assertWarehouse(p.companyId, data.warehouseId, tx))!;
    const dup = await tx.erpStockReconciliationLine.findFirst({ where: { reconciliationId: id, itemId: item.id, warehouseId } });
    if (dup) throw new DomainError(`${item.code} is already on this count for that warehouse.`);
    const count = await tx.erpStockReconciliationLine.count({ where: { reconciliationId: id } });
    return tx.erpStockReconciliationLine.create({ data: { reconciliationId: id, itemId: item.id, warehouseId, qty: data.qty, valuationRate: data.valuationRate, sortOrder: count } });
  });
}

export async function removeReconciliationLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const { count } = await tx.erpStockReconciliationLine.deleteMany({ where: { id: lineId, reconciliationId: id } });
    if (count === 0) throw new NotFoundError('Line not found.');
  });
}

export async function deleteReconciliation(p: Principal, id: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpStockReconciliation.delete({ where: { id } });
  });
}

export async function submitReconciliation(p: Principal, id: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    const recon = await tx.erpStockReconciliation.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!recon) throw new NotFoundError('Stock reconciliation not found.');
    const { count } = await tx.erpStockReconciliation.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${recon.number} was already submitted or cancelled.`);
    if (recon.lines.length === 0) throw new DomainError('Add at least one item before submitting.');

    for (const l of recon.lines) {
      const bin = await tx.erpBin.findUnique({ where: { itemId_warehouseId: { itemId: l.itemId, warehouseId: l.warehouseId } } });
      await tx.erpStockReconciliationLine.update({ where: { id: l.id }, data: { currentQty: bin?.actualQty ?? 0, currentRate: bin?.valuationRate ?? 0 } });
    }
    const v: Voucher = { companyId: p.companyId, type: VOUCHER, id: recon.id, no: recon.number, postingDate: recon.postingDate };
    const moves = await postStock(tx, v, recon.lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId, qty: D(l.qty), rate: D(l.valuationRate), set: true, lineId: l.id })));
    const diff = sum(moves, (m) => m.valueChange);
    const counter = recon.purpose === 'OPENING' ? 'OPENING' : 'STOCK_ADJUSTMENT';
    await postGl(tx, v, [
      { account: 'STOCK_IN_HAND', debit: diff },
      { account: counter, credit: diff, remarks: recon.purpose === 'OPENING' ? 'Opening stock' : 'Stock count difference' },
    ]);
    await tx.erpStockReconciliation.update({ where: { id }, data: { differenceValue: diff } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.reconciliation.submitted', entityType: 'ErpStockReconciliation', entityId: id, diff: { number: recon.number, difference: diff.toFixed(2) } }, tx);
    return recon;
  });
}

export async function cancelReconciliation(p: Principal, id: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    const recon = await tx.erpStockReconciliation.findFirst({ where: { id, companyId: p.companyId } });
    if (!recon) throw new NotFoundError('Stock reconciliation not found.');
    const { count } = await tx.erpStockReconciliation.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted reconciliation can be cancelled; ${recon.number} is ${recon.status.toLowerCase()}.`);
    await cancelPostings(tx, { companyId: p.companyId, type: VOUCHER, id, no: recon.number, postingDate: recon.postingDate });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.reconciliation.cancelled', entityType: 'ErpStockReconciliation', entityId: id }, tx);
  });
}
