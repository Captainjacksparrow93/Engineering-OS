import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D } from './domain/money';
import { makeErpCompany } from './test-fixture';
import { createItem, listItems, setWarehouseActive, updateItem, warehouseOptions } from './services/item.service';
import {
  addStockEntryLine,
  cancelStockEntry,
  createStockEntry,
  deleteStockEntry,
  getStockEntry,
  submitStockEntry,
} from './services/stock-entry.service';
import { addReconciliationLine, cancelReconciliation, createReconciliation, submitReconciliation } from './services/reconciliation.service';
import { reorderList, stockBalance, stockSummary } from './services/stock-report.service';
import { systemWarehouseId } from './services/setup';

const today = new Date().toISOString().slice(0, 10);

describe('Plan 022 phase 1: foundation + stock', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let store: Principal;
  let director: Principal;
  let engineer: Principal;
  let sales: Principal;
  let stores: string;
  let wip: string;

  async function trialBalance() {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId }, _sum: { debit: true, credit: true } });
    return D(agg._sum.debit).minus(D(agg._sum.credit));
  }

  beforeAll(async () => {
    fx = await makeErpCompany('STK');
    store = await fx.user('STORE_KEEPER', 'Store');
    director = await fx.user('DIRECTOR', 'Director');
    engineer = await fx.user('JUNIOR_ENGINEER', 'Engineer');
    sales = await fx.user('SALES_HEAD', 'Sales Head');
    await listItems(store); // first use seeds the company
    stores = await systemWarehouseId(fx.companyId, 'STORES');
    wip = await systemWarehouseId(fx.companyId, 'WIP');
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('seeds the chart of accounts and default warehouses once', async () => {
    const accounts = await prisma.erpAccount.count({ where: { companyId: fx.companyId } });
    expect(accounts).toBeGreaterThan(60);
    const whs = await warehouseOptions(fx.companyId);
    expect(whs.map((w) => w.systemKey).sort()).toEqual(['FINISHED_GOODS', 'REJECTED', 'STORES', 'WIP']);
  });

  it('denies people without stock access and lets the Sales Head read but not write', async () => {
    await expect(listItems(engineer)).rejects.toThrow(ForbiddenError);
    await expect(listItems(sales)).resolves.toBeDefined();
    await expect(createItem(sales, { code: 'X', name: 'X' })).rejects.toThrow(ForbiddenError);
  });

  it('creates items, keeps the Sales catalogue in step and refuses duplicates and bad input', async () => {
    const item = await createItem(store, { code: 'plc-cpu', name: 'PLC CPU 1214C', make: 'Siemens', isStockItem: 'on', isPurchaseItem: 'on', isSalesItem: 'on', reorderLevel: '5', reorderQty: '10' });
    expect(item.code).toBe('PLC-CPU');
    expect(item.gstRate.toFixed(2)).toBe('18.00');
    const sales = await prisma.salesItem.findUnique({ where: { companyId_code: { companyId: fx.companyId, code: 'PLC-CPU' } } });
    expect(sales?.erpItemCode).toBe('PLC-CPU');
    await expect(createItem(store, { code: 'PLC-CPU', name: 'Again' })).rejects.toThrow(DomainError);
    await expect(createItem(store, { code: '', name: 'No code' })).rejects.toThrow(ZodError);
    await updateItem(store, item.id, { code: 'PLC-CPU', name: 'PLC CPU 1214C DC/DC/DC', make: 'Siemens', isStockItem: 'on', isPurchaseItem: 'on', isSalesItem: 'on', reorderLevel: '5', reorderQty: '10' });
    const synced = await prisma.salesItem.findUnique({ where: { companyId_code: { companyId: fx.companyId, code: 'PLC-CPU' } } });
    expect(synced?.name).toBe('PLC CPU 1214C DC/DC/DC');
    await createItem(store, { code: 'MCB-6A', name: 'MCB 6A', isStockItem: 'on', isPurchaseItem: 'on' });
    await createItem(store, { code: 'INSTALL', name: 'Installation service', isSalesItem: 'on' });
  });

  it('receives stock at a moving average and posts a balanced GL', async () => {
    const se = await createStockEntry(store, { purpose: 'MATERIAL_RECEIPT', postingDate: today, toWarehouseId: stores });
    expect(se.number).toMatch(/^MAT-STE-\d{4}-00001$/);
    await addStockEntryLine(store, se.id, { itemCode: 'PLC-CPU', qty: '10', rate: '100' });
    await addStockEntryLine(store, se.id, { itemCode: 'PLC-CPU', qty: '10', rate: '130' });
    await addStockEntryLine(store, se.id, { itemCode: 'MCB-6A', qty: '50', rate: '85.5' });
    await expect(addStockEntryLine(store, se.id, { itemCode: 'INSTALL', qty: '1' })).rejects.toThrow(/not a stock item/);
    await expect(addStockEntryLine(store, se.id, { itemCode: 'NOPE', qty: '1' })).rejects.toThrow(/No item/);
    await submitStockEntry(store, se.id);
    const { entry, gl } = await getStockEntry(store, se.id);
    expect(entry.status).toBe('SUBMITTED');
    expect(entry.totalValue.toFixed(2)).toBe('6575.00');
    expect(gl).toHaveLength(2);
    const bin = await prisma.erpBin.findFirstOrThrow({ where: { warehouseId: stores, item: { code: 'PLC-CPU' } } });
    expect(bin.actualQty.toString()).toBe('20');
    expect(bin.valuationRate.toFixed(2)).toBe('115.00');
    expect((await trialBalance()).isZero()).toBe(true);
    await expect(submitStockEntry(store, se.id)).rejects.toThrow(DomainError);
    await expect(addStockEntryLine(store, se.id, { itemCode: 'MCB-6A', qty: '1' })).rejects.toThrow(/can't be changed/);
  });

  it('issues to a project at the average, refuses negative stock, and transfers at value', async () => {
    const issue = await createStockEntry(store, { purpose: 'MATERIAL_ISSUE', postingDate: today, fromWarehouseId: stores });
    await addStockEntryLine(store, issue.id, { itemCode: 'PLC-CPU', qty: '25' });
    await expect(submitStockEntry(store, issue.id)).rejects.toThrow(/Not enough PLC-CPU in Stores: 20 available, 25 needed/);
    // A failed submit rolls back: the draft is still a draft.
    expect((await prisma.erpStockEntry.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('DRAFT');
    await deleteStockEntry(store, issue.id);

    const ok = await createStockEntry(store, { purpose: 'MATERIAL_ISSUE', postingDate: today, fromWarehouseId: stores });
    await addStockEntryLine(store, ok.id, { itemCode: 'PLC-CPU', qty: '5' });
    await submitStockEntry(store, ok.id);
    expect((await getStockEntry(store, ok.id)).entry.totalValue.toFixed(2)).toBe('575.00');

    const move = await createStockEntry(store, { purpose: 'MATERIAL_TRANSFER', postingDate: today, fromWarehouseId: stores, toWarehouseId: wip });
    await addStockEntryLine(store, move.id, { itemCode: 'MCB-6A', qty: '20' });
    await submitStockEntry(store, move.id);
    const wipBin = await prisma.erpBin.findFirstOrThrow({ where: { warehouseId: wip, item: { code: 'MCB-6A' } } });
    expect(wipBin.stockValue.toFixed(2)).toBe('1710.00');
    expect((await getStockEntry(store, move.id)).gl).toHaveLength(0);
    expect((await trialBalance()).isZero()).toBe(true);
  });

  it('cancels a receipt only while its stock is unused, reversing stock and GL', async () => {
    const se = await createStockEntry(store, { purpose: 'MATERIAL_RECEIPT', postingDate: today, toWarehouseId: wip });
    await addStockEntryLine(store, se.id, { itemCode: 'PLC-CPU', qty: '2', rate: '120' });
    await submitStockEntry(store, se.id);
    const used = await createStockEntry(store, { purpose: 'MATERIAL_ISSUE', postingDate: today, fromWarehouseId: wip });
    await addStockEntryLine(store, used.id, { itemCode: 'PLC-CPU', qty: '2' });
    await submitStockEntry(store, used.id);
    await expect(cancelStockEntry(store, se.id)).rejects.toThrow(/Not enough PLC-CPU in Work In Progress/);
    await cancelStockEntry(store, used.id);
    await cancelStockEntry(store, se.id);
    const bin = await prisma.erpBin.findFirstOrThrow({ where: { warehouseId: wip, item: { code: 'PLC-CPU' } } });
    expect(bin.actualQty.toString()).toBe('0');
    expect(bin.stockValue.toFixed(2)).toBe('0.00');
    const live = await prisma.erpGlEntry.count({ where: { voucherId: se.id, isCancelled: false } });
    expect(live).toBe(0);
    expect((await trialBalance()).isZero()).toBe(true);
  });

  it('posts opening stock against Opening Balance Equity, and the GL equals the stock value', async () => {
    await createItem(store, { code: 'CABLE-2.5', name: 'Cable 2.5 sq mm', uom: 'Mtr', isStockItem: 'on', isPurchaseItem: 'on' });
    const recon = await createReconciliation(store, { purpose: 'OPENING', postingDate: today });
    await addReconciliationLine(store, recon.id, { itemCode: 'CABLE-2.5', warehouseId: stores, qty: '500', valuationRate: '18.4' });
    await expect(addReconciliationLine(store, recon.id, { itemCode: 'CABLE-2.5', warehouseId: stores, qty: '1', valuationRate: '1' })).rejects.toThrow(/already on this count/);
    await submitReconciliation(store, recon.id);
    const opening = await prisma.erpGlEntry.findFirstOrThrow({ where: { voucherId: recon.id, account: { systemKey: 'OPENING' } } });
    expect(opening.credit.toFixed(2)).toBe('9200.00');

    const count = await createReconciliation(store, { purpose: 'ADJUSTMENT', postingDate: today });
    await addReconciliationLine(store, count.id, { itemCode: 'CABLE-2.5', warehouseId: stores, qty: '480', valuationRate: '18.4' });
    await submitReconciliation(store, count.id);
    const adj = await prisma.erpStockReconciliation.findUniqueOrThrow({ where: { id: count.id } });
    expect(adj.differenceValue.toFixed(2)).toBe('-368.00');
    await cancelReconciliation(store, count.id);

    const summary = await stockSummary(director);
    expect(summary.stockValue.toFixed(2)).toBe(summary.glValue.toFixed(2));
    const balance = await stockBalance(store, { warehouseId: stores });
    expect(balance.rows.find((r) => r.item.code === 'CABLE-2.5')?.actualQty.toString()).toBe('500');
  });

  it('lists items at or below their reorder level', async () => {
    const list = await reorderList(store);
    // PLC-CPU: 15 in Stores, level 5 → not listed; drop it to 4 and it shows.
    expect(list.find((r) => r.code === 'PLC-CPU')).toBeUndefined();
    const issue = await createStockEntry(store, { purpose: 'MATERIAL_ISSUE', postingDate: today, fromWarehouseId: stores });
    await addStockEntryLine(store, issue.id, { itemCode: 'PLC-CPU', qty: '11' });
    await submitStockEntry(store, issue.id);
    const after = await reorderList(store);
    expect(after.find((r) => r.code === 'PLC-CPU')?.suggestedQty.toString()).toBe('10');
  });

  it('refuses to switch off a default warehouse', async () => {
    await expect(setWarehouseActive(store, stores, false)).rejects.toThrow(/default warehouse/);
  });
});
