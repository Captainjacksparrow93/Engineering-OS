import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D } from './domain/money';
import { makeErpCompany } from './test-fixture';
import { createItem } from './services/item.service';
import { createParty, listParties, partyBalance } from './services/party.service';
import { updateSettings } from './services/settings.service';
import {
  addMaterialRequestLine,
  createMaterialRequest,
  createReorderRequest,
  getMaterialRequest,
  makeStockEntryFromRequest,
  submitMaterialRequest,
} from './services/material-request.service';
import { addSupplierQuotationLine, compareQuotations, createSupplierQuotation, submitSupplierQuotation, updateSupplierQuotationLine } from './services/supplier-quotation.service';
import { getPurchaseOrder, makePurchaseOrderFromQuotation, setPurchaseOrderClosed, submitPurchaseOrder, addPurchaseOrderLine, createPurchaseOrder } from './services/purchase-order.service';
import { cancelPurchaseReceipt, makeReceiptFromOrder, submitPurchaseReceipt, updatePurchaseReceiptLine, getPurchaseReceipt } from './services/purchase-receipt.service';
import { addExpenseLine, cancelPurchaseInvoice, createPurchaseInvoice, expenseAccounts, getPurchaseInvoice, makeInvoiceFromOrder, makeInvoiceFromReceipt, submitPurchaseInvoice, updatePurchaseInvoiceLine } from './services/purchase-invoice.service';
import { addStockEntryLine, createStockEntry, submitStockEntry } from './services/stock-entry.service';
import { systemWarehouseId } from './services/setup';

const today = new Date().toISOString().slice(0, 10);
const day = new Date(`${today}T00:00:00Z`);

describe('Plan 022 phase 2: buying', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let buyer: Principal;
  let store: Principal;
  let director: Principal;
  let engineer: Principal;
  let siemens: string;
  let local: string;
  let stores: string;
  let mrId: string;
  let poId: string;
  let prId: string;
  let piId: string;

  const bin = (code: string, warehouseId: string) => prisma.erpBin.findFirst({ where: { warehouseId, item: { code, companyId: fx.companyId } } });
  async function balanced() {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId }, _sum: { debit: true, credit: true } });
    return D(agg._sum.debit).equals(D(agg._sum.credit));
  }
  async function accountBalance(key: string) {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId, isCancelled: false, account: { systemKey: key } }, _sum: { debit: true, credit: true } });
    return D(agg._sum.debit).minus(D(agg._sum.credit));
  }

  beforeAll(async () => {
    fx = await makeErpCompany('BUY');
    buyer = await fx.user('PURCHASE_MANAGER', 'Buyer');
    store = await fx.user('STORE_KEEPER', 'Store');
    director = await fx.user('DIRECTOR', 'Director');
    engineer = await fx.user('JUNIOR_ENGINEER', 'Engineer');
    await updateSettings(director, { companyState: 'Gujarat', defaultGstRate: '18' });
    await createItem(store, { code: 'PLC', name: 'PLC CPU', isStockItem: 'on', isPurchaseItem: 'on', reorderLevel: '2', reorderQty: '5' });
    await createItem(store, { code: 'HMI', name: 'HMI 7 inch', isStockItem: 'on', isPurchaseItem: 'on' });
    await createItem(store, { code: 'CAL', name: 'Calibration service', isPurchaseItem: 'on' });
    stores = await systemWarehouseId(fx.companyId, 'STORES');
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('creates suppliers for Buying only, with validated GSTIN', async () => {
    await expect(createParty(store, 'SUPPLIER', { name: 'Nope' })).rejects.toThrow(ForbiddenError);
    await expect(createParty(buyer, 'SUPPLIER', { name: 'Bad', gstin: '123' })).rejects.toThrow(ZodError);
    siemens = (await createParty(buyer, 'SUPPLIER', { name: 'Siemens Ltd', state: 'Maharashtra', gstin: '27AAACS0764L1ZK', paymentTermsDays: '45' })).id;
    local = (await createParty(buyer, 'SUPPLIER', { name: 'Local Traders', state: 'Gujarat' })).id;
    await expect(createParty(buyer, 'SUPPLIER', { name: 'Siemens Ltd' })).rejects.toThrow(/already exists/);
    expect((await listParties(store, 'SUPPLIER')).map((s) => s.name)).toEqual(['Local Traders', 'Siemens Ltd']);
    await expect(listParties(engineer, 'SUPPLIER')).rejects.toThrow(ForbiddenError);
  });

  it('raises a purchase request that shows as requested stock', async () => {
    const mr = await createMaterialRequest(store, { purpose: 'PURCHASE', requestDate: today, warehouseId: stores });
    mrId = mr.id;
    await addMaterialRequestLine(store, mr.id, { itemCode: 'PLC', qty: '10' });
    await addMaterialRequestLine(store, mr.id, { itemCode: 'HMI', qty: '4' });
    await submitMaterialRequest(store, mr.id);
    expect((await bin('PLC', stores))?.requestedQty.toString()).toBe('10');
    expect((await getMaterialRequest(store, mr.id)).state.label).toBe('Pending');
  });

  it('collects quotations and compares them, cheapest first', async () => {
    const a = await createSupplierQuotation(buyer, { supplierId: siemens, quoteDate: today, materialRequestId: mrId });
    const b = await createSupplierQuotation(buyer, { supplierId: local, quoteDate: today, materialRequestId: mrId });
    for (const [sq, plc, hmi] of [[a.id, '1000', '5000'], [b.id, '1100', '4800']] as const) {
      const { lines } = await prisma.erpSupplierQuotation.findUniqueOrThrow({ where: { id: sq }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
      await updateSupplierQuotationLine(buyer, sq, lines[0]!.id, { qty: lines[0]!.qty.toString(), rate: plc });
      await updateSupplierQuotationLine(buyer, sq, lines[1]!.id, { qty: lines[1]!.qty.toString(), rate: hmi });
      await submitSupplierQuotation(buyer, sq);
    }
    const cmp = await compareQuotations(buyer, { materialRequestId: mrId, today: day });
    expect(cmp.find((r) => r.item.code === 'PLC')?.quotes[0]?.supplierName).toBe('Siemens Ltd');
    expect(cmp.find((r) => r.item.code === 'HMI')?.quotes[0]?.supplierName).toBe('Local Traders');
    await expect(addSupplierQuotationLine(buyer, a.id, { itemCode: 'PLC', qty: '1', rate: '1' })).rejects.toThrow(/can't be changed/);
    const po = await makePurchaseOrderFromQuotation(buyer, a.id, day);
    poId = po.id;
  });

  it('submits the order with inter-state IGST, moving requested qty to ordered', async () => {
    await submitPurchaseOrder(buyer, poId);
    const { po, state } = await getPurchaseOrder(buyer, poId);
    expect(po.netTotal.toFixed(2)).toBe('30000.00');
    expect(po.igst.toFixed(2)).toBe('5400.00');
    expect(po.cgst.toFixed(2)).toBe('0.00');
    expect(state.label).toBe('To receive and bill');
    const plc = await bin('PLC', stores);
    expect(plc?.orderedQty.toString()).toBe('10');
    expect(plc?.requestedQty.toString()).toBe('0');
    expect((await getMaterialRequest(store, mrId)).state.label).toBe('Ordered');
  });

  it('receives part of the order, rejects some, and refuses over-receipt', async () => {
    const pr = await makeReceiptFromOrder(store, poId, day);
    prId = pr.id;
    const { pr: draft } = await getPurchaseReceipt(store, pr.id);
    const plcLine = draft.lines.find((l) => l.qty.toString() === '10')!;
    await updatePurchaseReceiptLine(store, pr.id, plcLine.id, { qty: '12' });
    await expect(submitPurchaseReceipt(store, pr.id)).rejects.toThrow(/only 10 left to receive/);
    await updatePurchaseReceiptLine(store, pr.id, plcLine.id, { qty: '6', rejectedQty: '1' });
    await submitPurchaseReceipt(store, pr.id);

    const plc = await bin('PLC', stores);
    expect(plc?.actualQty.toString()).toBe('6');
    expect(plc?.orderedQty.toString()).toBe('4');
    const rejected = await bin('PLC', await systemWarehouseId(fx.companyId, 'REJECTED'));
    expect(rejected?.actualQty.toString()).toBe('1');
    expect(rejected?.stockValue.toFixed(2)).toBe('0.00');
    expect((await accountBalance('SRBNB')).toFixed(2)).toBe('-26000.00'); // 6×1000 + 4×5000
    expect((await getPurchaseOrder(buyer, poId)).state.received).toBe(71);
    const price = await prisma.salesItemPrice.findFirst({ where: { reference: (await getPurchaseReceipt(store, pr.id)).pr.number } });
    expect(price?.rate.toFixed(2)).toBe('1000.00');
    expect((await prisma.erpItem.findFirstOrThrow({ where: { companyId: fx.companyId, code: 'PLC' } })).lastPurchaseRate?.toFixed(2)).toBe('1000.00');
  });

  it('bills the receipt with a price difference and clears SRBNB exactly', async () => {
    const inv = await makeInvoiceFromReceipt(buyer, prId, day);
    piId = inv.id;
    const { inv: draft } = await getPurchaseInvoice(buyer, inv.id);
    const plcLine = draft.lines.find((l) => l.qty.toString() === '6')!;
    await updatePurchaseInvoiceLine(buyer, inv.id, plcLine.id, { qty: '6', rate: '1010' });
    await submitPurchaseInvoice(buyer, inv.id);
    const { inv: billed, gl } = await getPurchaseInvoice(buyer, inv.id);
    expect(billed.netTotal.toFixed(2)).toBe('26060.00');
    expect(billed.grandTotal.toFixed(2)).toBe('30750.80');
    expect(billed.outstandingAmount.toFixed(2)).toBe('30750.80');
    expect(gl.find((g) => g.account.name === 'Stock Adjustment')?.debit.toFixed(2)).toBe('60.00');
    expect((await accountBalance('SRBNB')).toFixed(2)).toBe('0.00');
    expect((await partyBalance(fx.companyId, 'SUPPLIER', siemens)).toFixed(2)).toBe('30750.80');
    expect(await balanced()).toBe(true);
    await expect(cancelPurchaseReceipt(store, prId)).rejects.toThrow(/billed/);
    await expect(makeInvoiceFromReceipt(buyer, prId, day)).rejects.toThrow(/billed/);
  });

  it('cancels invoice then receipt, putting every figure back', async () => {
    await cancelPurchaseInvoice(buyer, piId);
    await cancelPurchaseReceipt(store, prId);
    const plc = await bin('PLC', stores);
    expect(plc?.actualQty.toString()).toBe('0');
    expect(plc?.orderedQty.toString()).toBe('10');
    expect((await accountBalance('SRBNB')).toFixed(2)).toBe('0.00');
    expect((await partyBalance(fx.companyId, 'SUPPLIER', siemens)).toFixed(2)).toBe('0.00');
    expect(await balanced()).toBe(true);
  });

  it('closing the order releases the ordered qty', async () => {
    await setPurchaseOrderClosed(buyer, poId, true);
    expect((await bin('PLC', stores))?.orderedQty.toString()).toBe('0');
    expect((await getPurchaseOrder(buyer, poId)).state.label).toBe('Closed');
    await expect(makeReceiptFromOrder(store, poId, day)).rejects.toThrow(DomainError);
    await setPurchaseOrderClosed(buyer, poId, false);
    expect((await bin('PLC', stores))?.orderedQty.toString()).toBe('10');
  });

  it('bills a service straight from the order and a typed-in freight charge, intra-state', async () => {
    const po = await createPurchaseOrder(buyer, { supplierId: local, orderDate: today });
    await addPurchaseOrderLine(buyer, po.id, { itemCode: 'CAL', qty: '1', rate: '2500' });
    await submitPurchaseOrder(buyer, po.id);
    const inv = await makeInvoiceFromOrder(buyer, po.id, day);
    const freight = (await expenseAccounts(fx.companyId)).find((a) => a.name === 'Freight and Forwarding')!;
    await addExpenseLine(buyer, inv.id, { description: 'Freight', accountId: freight.id, qty: '1', rate: '500', gstRate: '18' });
    await submitPurchaseInvoice(buyer, inv.id);
    const { inv: billed, gl } = await getPurchaseInvoice(buyer, inv.id);
    expect(billed.cgst.toFixed(2)).toBe('270.00');
    expect(billed.sgst.toFixed(2)).toBe('270.00');
    expect(gl.find((g) => g.account.name === 'Purchase Expenses')?.debit.toFixed(2)).toBe('2500.00');
    expect(gl.find((g) => g.account.name === 'Freight and Forwarding')?.debit.toFixed(2)).toBe('500.00');
    expect((await getPurchaseOrder(buyer, po.id)).state.label).toBe('Completed');
    const bill = await createPurchaseInvoice(buyer, local, { postingDate: today, billNo: 'LT-1' });
    await addExpenseLine(buyer, bill.id, { description: 'Rent', accountId: freight.id, qty: '1', rate: '100', gstRate: '0' });
    await submitPurchaseInvoice(buyer, bill.id);
    const again = await createPurchaseInvoice(buyer, local, { postingDate: today, billNo: 'LT-1' });
    await addExpenseLine(buyer, again.id, { description: 'Rent', accountId: freight.id, qty: '1', rate: '100', gstRate: '0' });
    await expect(submitPurchaseInvoice(buyer, again.id)).rejects.toThrow(/already entered/);
    expect(await balanced()).toBe(true);
  });

  it('raises a reorder request only for items at or below their level (ordered stock counts)', async () => {
    // PLC has 10 on order, above its level of 2, so it is left out.
    await createItem(store, { code: 'FUSE', name: 'Fuse 2A', isStockItem: 'on', isPurchaseItem: 'on', reorderLevel: '20', reorderQty: '50', leadTimeDays: '7' });
    const reorder = await createReorderRequest(store, day);
    const { mr, items } = await getMaterialRequest(store, reorder.id);
    expect(mr.lines.map((l) => `${items.get(l.itemId)?.code} ${l.qty.toString()}`)).toEqual(['FUSE 50']);
    await submitMaterialRequest(store, reorder.id);
    await expect(createReorderRequest(store, day)).rejects.toThrow(/Nothing is at or below/);
  });

  it('fulfils a transfer request with a stock entry and marks it transferred', async () => {
    const wip = await systemWarehouseId(fx.companyId, 'WIP');
    const se = await createStockEntry(store, { purpose: 'MATERIAL_RECEIPT', postingDate: today, toWarehouseId: stores });
    await addStockEntryLine(store, se.id, { itemCode: 'HMI', qty: '3', rate: '4800' });
    await submitStockEntry(store, se.id);

    const mr = await createMaterialRequest(engineer, { purpose: 'TRANSFER', requestDate: today, warehouseId: wip }).catch((e) => e);
    expect(mr).toBeInstanceOf(ForbiddenError);
    const transfer = await createMaterialRequest(store, { purpose: 'TRANSFER', requestDate: today, warehouseId: wip });
    await addMaterialRequestLine(store, transfer.id, { itemCode: 'HMI', qty: '2' });
    await expect(addMaterialRequestLine(store, transfer.id, { itemCode: 'CAL', qty: '1' })).rejects.toThrow(/not a stock item/);
    await submitMaterialRequest(store, transfer.id);
    const entry = await makeStockEntryFromRequest(store, transfer.id, day);
    await submitStockEntry(store, entry.id);
    expect((await getMaterialRequest(store, transfer.id)).state.label).toBe('Transferred');
    expect((await bin('HMI', wip))?.actualQty.toString()).toBe('2');
    await expect(makeStockEntryFromRequest(store, transfer.id, day)).rejects.toThrow(/moved already/);
    expect(await balanced()).toBe(true);
  });
});
