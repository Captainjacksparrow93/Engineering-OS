import type { ErpStockPurpose, Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, Dec, money, rate4, sum, ZERO } from '../domain/money';
import { stockEntrySchema, stockLineSchema, type StockEntryInput, type StockLineInput, type Raw } from '../validation';
import { assertProject, manageArea, readArea } from './access';
import { assertWarehouse, itemByCode } from './item.service';
import { cancelPostings, postGl, postStock, type GlRow, type StockMoveInput, type Voucher } from './posting';
import { nextNumber, SERIES } from './series';
import { applyMaterialRequestProgress } from './material-request.service';

/**
 * Stock Entry (ERPNext): Material Receipt, Material Issue, Material Transfer, and the two
 * manufacturing purposes driven by work orders (transfer to WIP, manufacture).
 *
 * GL (perpetual inventory, one Stock In Hand account):
 *   receipt     Dr Stock In Hand          Cr Stock Adjustment
 *   issue       Dr Materials Consumed     Cr Stock In Hand   (tagged with the project)
 *   transfer    nothing (value moves between warehouses of the same account)
 *   manufacture Dr Stock (finished good)  Cr Stock (materials) + Expenses Included In Valuation
 */

export const VOUCHER = 'Stock Entry';

export const PURPOSE_LABEL: Record<ErpStockPurpose, string> = {
  MATERIAL_RECEIPT: 'Material receipt',
  MATERIAL_ISSUE: 'Material issue',
  MATERIAL_TRANSFER: 'Material transfer',
  TRANSFER_FOR_MANUFACTURE: 'Transfer for manufacture',
  MANUFACTURE: 'Manufacture',
};

const lineInclude = { lines: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.ErpStockEntryInclude;

export async function listStockEntries(p: Principal, f: { status?: string | null; purpose?: string | null; q?: string | null } = {}) {
  await readArea(p, 'stock');
  return prisma.erpStockEntry.findMany({
    where: {
      companyId: p.companyId,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.purpose ? { purpose: f.purpose as never } : {}),
      ...(f.q ? { OR: [{ number: { contains: f.q, mode: 'insensitive' } }, { remarks: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { _count: { select: { lines: true } } },
  });
}

export async function getStockEntry(p: Principal, entryId: string) {
  await readArea(p, 'stock');
  const entry = await prisma.erpStockEntry.findFirst({ where: { id: entryId, companyId: p.companyId }, include: lineInclude });
  if (!entry) throw new NotFoundError('Stock entry not found.');
  const items = await prisma.erpItem.findMany({ where: { id: { in: entry.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, uom: true } });
  const gl = await prisma.erpGlEntry.findMany({ where: { voucherType: VOUCHER, voucherId: entryId }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  return { entry, items: new Map(items.map((i) => [i.id, i])), gl };
}

function checkWarehouses(purpose: ErpStockPurpose, from: string | null, to: string | null) {
  if ((purpose === 'MATERIAL_RECEIPT') && !to) throw new DomainError('Pick the warehouse the stock goes into.');
  if (purpose === 'MATERIAL_ISSUE' && !from) throw new DomainError('Pick the warehouse the stock comes out of.');
  if (purpose === 'MATERIAL_TRANSFER' || purpose === 'TRANSFER_FOR_MANUFACTURE') {
    if (!from || !to) throw new DomainError('Pick both the source and the target warehouse.');
    if (from === to) throw new DomainError('The source and target warehouse must be different.');
  }
}

export async function createStockEntry(p: Principal, input: Raw<StockEntryInput>) {
  await manageArea(p, 'stock');
  const data = stockEntrySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const entry = await tx.erpStockEntry.create({
      data: {
        companyId: p.companyId,
        number: await nextNumber(tx, p.companyId, SERIES.stockEntry),
        purpose: data.purpose,
        postingDate: data.postingDate,
        fromWarehouseId: data.purpose === 'MATERIAL_RECEIPT' ? null : await assertWarehouse(p.companyId, data.fromWarehouseId, tx),
        toWarehouseId: data.purpose === 'MATERIAL_ISSUE' ? null : await assertWarehouse(p.companyId, data.toWarehouseId, tx),
        projectId: await assertProject(p.companyId, data.projectId),
        remarks: data.remarks,
        createdById: p.userId,
      },
    });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.stock_entry.created', entityType: 'ErpStockEntry', entityId: entry.id, diff: { number: entry.number, purpose: entry.purpose } }, tx);
    return entry;
  });
}

async function loadDraft(tx: Tx, p: Principal, entryId: string) {
  const entry = await tx.erpStockEntry.findFirst({ where: { id: entryId, companyId: p.companyId } });
  if (!entry) throw new NotFoundError('Stock entry not found.');
  if (entry.status !== 'DRAFT') throw new DomainError(`${entry.number} is ${entry.status.toLowerCase()} and can't be changed.`);
  return entry;
}

export async function updateStockEntry(p: Principal, entryId: string, input: Raw<StockEntryInput>) {
  await manageArea(p, 'stock');
  const data = stockEntrySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const entry = await loadDraft(tx, p, entryId);
    if (data.purpose !== entry.purpose) throw new DomainError("A stock entry's purpose can't change. Delete the draft and start again.");
    return tx.erpStockEntry.update({
      where: { id: entryId },
      data: {
        postingDate: data.postingDate,
        fromWarehouseId: entry.purpose === 'MATERIAL_RECEIPT' ? null : await assertWarehouse(p.companyId, data.fromWarehouseId, tx),
        toWarehouseId: entry.purpose === 'MATERIAL_ISSUE' ? null : await assertWarehouse(p.companyId, data.toWarehouseId, tx),
        projectId: await assertProject(p.companyId, data.projectId),
        remarks: data.remarks,
      },
    });
  });
}

export async function addStockEntryLine(p: Principal, entryId: string, input: Raw<StockLineInput>) {
  await manageArea(p, 'stock');
  const data = stockLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const entry = await loadDraft(tx, p, entryId);
    const item = await itemByCode(p.companyId, data.itemCode, tx);
    if (!item.isStockItem) throw new DomainError(`${item.code} is not a stock item, so it can't be moved.`);
    const from = entry.purpose === 'MATERIAL_RECEIPT' ? null : (await assertWarehouse(p.companyId, data.fromWarehouseId, tx)) ?? entry.fromWarehouseId;
    const to = entry.purpose === 'MATERIAL_ISSUE' ? null : (await assertWarehouse(p.companyId, data.toWarehouseId, tx)) ?? entry.toWarehouseId;
    checkWarehouses(entry.purpose, from, to);
    const rate = entry.purpose === 'MATERIAL_RECEIPT' ? (data.rate ?? D(item.lastPurchaseRate ?? item.standardRate)) : ZERO;
    const count = await tx.erpStockEntryLine.count({ where: { entryId } });
    return tx.erpStockEntryLine.create({
      data: { entryId, itemId: item.id, qty: data.qty, fromWarehouseId: from, toWarehouseId: to, rate, amount: money(data.qty.times(rate)), sortOrder: count },
    });
  });
}

export async function removeStockEntryLine(p: Principal, entryId: string, lineId: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, entryId);
    const { count } = await tx.erpStockEntryLine.deleteMany({ where: { id: lineId, entryId } });
    if (count === 0) throw new NotFoundError('Line not found.');
  });
}

export async function deleteStockEntry(p: Principal, entryId: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    const entry = await loadDraft(tx, p, entryId);
    if (entry.workOrderId) throw new DomainError('This entry belongs to a work order. Delete it from there.');
    await tx.erpStockEntry.delete({ where: { id: entryId } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.stock_entry.deleted', entityType: 'ErpStockEntry', entityId: entryId, diff: { number: entry.number } }, tx);
  });
}

/**
 * Posts a draft stock entry. Exported for work orders and material requests, which build
 * entries and submit them inside their own transaction.
 */
export async function submitStockEntryTx(tx: Tx, p: Principal, entryId: string) {
  const entry = await tx.erpStockEntry.findFirst({ where: { id: entryId, companyId: p.companyId }, include: lineInclude });
  if (!entry) throw new NotFoundError('Stock entry not found.');
  const { count } = await tx.erpStockEntry.updateMany({ where: { id: entryId, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
  if (count === 0) throw new DomainError(`${entry.number} was already submitted or cancelled.`);
  if (entry.lines.length === 0) throw new DomainError('Add at least one item before submitting.');
  for (const l of entry.lines) {
    if (entry.purpose !== 'MANUFACTURE') checkWarehouses(entry.purpose, l.fromWarehouseId, l.toWarehouseId);
  }

  const v: Voucher = { companyId: p.companyId, type: VOUCHER, id: entry.id, no: entry.number, postingDate: entry.postingDate, projectId: entry.projectId };
  const lineValue = new Map<string, { rate: Dec; amount: Dec }>();
  const gl: GlRow[] = [];

  if (entry.purpose === 'MATERIAL_RECEIPT') {
    const moves = await postStock(tx, v, entry.lines.map((l) => ({ itemId: l.itemId, warehouseId: l.toWarehouseId!, qty: D(l.qty), rate: D(l.rate), lineId: l.id })));
    entry.lines.forEach((l, i) => lineValue.set(l.id, { rate: D(l.rate), amount: moves[i]!.valueChange }));
    const total = sum(moves, (m) => m.valueChange);
    gl.push({ account: 'STOCK_IN_HAND', debit: total }, { account: 'STOCK_ADJUSTMENT', credit: total, remarks: 'Material receipt' });
  } else if (entry.purpose === 'MATERIAL_ISSUE') {
    const moves = await postStock(tx, v, entry.lines.map((l) => ({ itemId: l.itemId, warehouseId: l.fromWarehouseId!, qty: D(l.qty).negated(), lineId: l.id })));
    entry.lines.forEach((l, i) => lineValue.set(l.id, { rate: moves[i]!.rate, amount: moves[i]!.valueChange.negated() }));
    const total = sum(moves, (m) => m.valueChange).negated();
    gl.push({ account: 'MATERIALS_CONSUMED', debit: total, remarks: 'Material issue' }, { account: 'STOCK_IN_HAND', credit: total });
  } else if (entry.purpose === 'MATERIAL_TRANSFER' || entry.purpose === 'TRANSFER_FOR_MANUFACTURE') {
    for (const l of entry.lines) {
      const [out] = await postStock(tx, v, [{ itemId: l.itemId, warehouseId: l.fromWarehouseId!, qty: D(l.qty).negated(), lineId: l.id }]);
      await postStock(tx, v, [{ itemId: l.itemId, warehouseId: l.toWarehouseId!, qty: D(l.qty), value: out!.valueChange.negated(), lineId: l.id }]);
      lineValue.set(l.id, { rate: out!.rate, amount: out!.valueChange.negated() });
    }
  } else {
    // MANUFACTURE: materials leave WIP at their average; finished goods take that cost plus operating cost.
    const raw = entry.lines.filter((l) => !l.isFinishedGood);
    const fg = entry.lines.filter((l) => l.isFinishedGood);
    if (fg.length === 0) throw new DomainError('A manufacture entry needs the finished item.');
    const out = await postStock(tx, v, raw.map((l) => ({ itemId: l.itemId, warehouseId: l.fromWarehouseId!, qty: D(l.qty).negated(), lineId: l.id })));
    raw.forEach((l, i) => lineValue.set(l.id, { rate: out[i]!.rate, amount: out[i]!.valueChange.negated() }));
    const consumed = sum(out, (m) => m.valueChange).negated();
    const additional = money(entry.additionalCost);
    const fgQty = sum(fg, (l) => l.qty);
    let remaining = consumed.plus(additional);
    const moves: StockMoveInput[] = fg.map((l, i) => {
      const value = i === fg.length - 1 ? remaining : money(consumed.plus(additional).times(l.qty).dividedBy(fgQty));
      remaining = remaining.minus(value);
      lineValue.set(l.id, { rate: rate4(value.dividedBy(l.qty)), amount: value });
      return { itemId: l.itemId, warehouseId: l.toWarehouseId!, qty: D(l.qty), value, lineId: l.id };
    });
    await postStock(tx, v, moves);
    if (!additional.isZero()) gl.push({ account: 'STOCK_IN_HAND', debit: additional }, { account: 'EXPENSES_IN_VALUATION', credit: additional, remarks: 'Operating cost' });
  }

  for (const [lineId, val] of lineValue) await tx.erpStockEntryLine.update({ where: { id: lineId }, data: { rate: val.rate, amount: val.amount } });
  const totalValue = [...lineValue.entries()].filter(([id]) => entry.lines.find((l) => l.id === id && (entry.purpose !== 'MANUFACTURE' || l.isFinishedGood))).reduce((a, [, val]) => a.plus(val.amount), ZERO);
  await tx.erpStockEntry.update({ where: { id: entry.id }, data: { totalValue } });
  for (const l of entry.lines) if (l.materialRequestLineId) await applyMaterialRequestProgress(tx, l.materialRequestLineId, D(l.qty));
  await postGl(tx, v, gl);
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.stock_entry.submitted', entityType: 'ErpStockEntry', entityId: entry.id, diff: { number: entry.number, totalValue: totalValue.toFixed(2) } }, tx);
  return entry;
}

export async function submitStockEntry(p: Principal, entryId: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction((tx) => submitStockEntryTx(tx, p, entryId));
}

export async function cancelStockEntryTx(tx: Tx, p: Principal, entryId: string) {
  const entry = await tx.erpStockEntry.findFirst({ where: { id: entryId, companyId: p.companyId } });
  if (!entry) throw new NotFoundError('Stock entry not found.');
  const { count } = await tx.erpStockEntry.updateMany({ where: { id: entryId, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
  if (count === 0) throw new DomainError(`Only a submitted entry can be cancelled; ${entry.number} is ${entry.status.toLowerCase()}.`);
  await cancelPostings(tx, { companyId: p.companyId, type: VOUCHER, id: entry.id, no: entry.number, postingDate: entry.postingDate, projectId: entry.projectId });
  const lines = await tx.erpStockEntryLine.findMany({ where: { entryId, materialRequestLineId: { not: null } } });
  for (const l of lines) await applyMaterialRequestProgress(tx, l.materialRequestLineId!, D(l.qty).negated());
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.stock_entry.cancelled', entityType: 'ErpStockEntry', entityId: entry.id, diff: { number: entry.number } }, tx);
  return entry;
}

export async function cancelStockEntry(p: Principal, entryId: string) {
  await manageArea(p, 'stock');
  return prisma.$transaction(async (tx) => {
    const entry = await tx.erpStockEntry.findFirst({ where: { id: entryId, companyId: p.companyId }, select: { workOrderId: true } });
    if (entry?.workOrderId) throw new DomainError('This entry belongs to a work order. Cancel it from there.');
    return cancelStockEntryTx(tx, p, entryId);
  });
}
