import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D } from './domain/money';
import { makeErpCompany } from './test-fixture';
import { createItem } from './services/item.service';
import { createParty } from './services/party.service';
import { addStockEntryLine, createStockEntry, submitStockEntry } from './services/stock-entry.service';
import { addSalesOrderLine, createSalesOrder, submitSalesOrder } from './services/sales-order.service';
import { ensurePanelItems } from './services/selling-bridge';
import { addBomItem, addBomOperation, createBom, createWorkstation, getBom, submitBom } from './services/bom.service';
import { cancelWorkOrderEntry, getWorkOrder, makeWorkOrdersFromSalesOrder, manufacture, submitWorkOrder, transferMaterials } from './services/work-order.service';
import { addJobCardLog } from './services/job-card.service';
import { createProductionPlan, getItemsFromSalesOrders, makeMaterialRequestFromPlan, makeWorkOrdersFromPlan, materialRequirement, submitProductionPlan } from './services/production-plan.service';
import { systemWarehouseId } from './services/setup';

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const day = (days: number) => new Date(`${iso(days)}T00:00:00Z`);

describe('Plan 022 phase 4: manufacturing', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let prod: Principal;
  let store: Principal;
  let sales: Principal;
  let wiringId: string;
  let woId: string;
  let customerId: string;
  let wo = 0;

  async function balanced() {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId }, _sum: { debit: true, credit: true } });
    return D(agg._sum.debit).equals(D(agg._sum.credit));
  }
  const bin = (code: string, warehouseId: string) => prisma.erpBin.findFirst({ where: { warehouseId, item: { code, companyId: fx.companyId } } });
  async function order(qty: string) {
    const so = await createSalesOrder(sales, { customerId, orderDate: iso(0), deliveryDate: iso(30), woNumber: `5${fx.run.slice(-5)}${++wo}` });
    await addSalesOrderLine(sales, so.id, { itemCode: 'PLC', qty, rate: '50000' });
    await submitSalesOrder(sales, so.id);
    return so;
  }

  beforeAll(async () => {
    fx = await makeErpCompany('MFG');
    prod = await fx.user('PRODUCTION_MANAGER', 'Production');
    store = await fx.user('STORE_KEEPER', 'Store');
    sales = await fx.user('SALES_HEAD', 'Sales');
    await ensurePanelItems(fx.companyId);
    await createItem(store, { code: 'CPU', name: 'PLC CPU', isStockItem: 'on', isPurchaseItem: 'on' });
    await createItem(store, { code: 'CABLE', name: 'Cable', uom: 'Mtr', isStockItem: 'on', isPurchaseItem: 'on' });
    await createItem(store, { code: 'HARNESS', name: 'Wiring harness', isStockItem: 'on', isPurchaseItem: 'off' });
    customerId = (await createParty(sales, 'CUSTOMER', { name: `Mfg Customer ${fx.run}` })).id;
    // A Sales catalogue entry for the panel, so the BOM cost reaches quotes.
    await prisma.salesItem.create({ data: { companyId: fx.companyId, code: 'PLC', name: 'PLC panel' } });
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('keeps workstations for production', async () => {
    await expect(createWorkstation(store, { name: 'Wiring bay', hourRate: '600' })).rejects.toThrow(ForbiddenError);
    wiringId = (await createWorkstation(prod, { name: 'Wiring bay', hourRate: '600' })).id;
    await expect(createWorkstation(prod, { name: 'Wiring bay', hourRate: '1' })).rejects.toThrow(/already exists/);
  });

  it('builds a multi-level BOM, rolls its cost up and publishes it to Sales', async () => {
    const stores = await systemWarehouseId(fx.companyId, 'STORES');
    const se = await createStockEntry(store, { purpose: 'MATERIAL_RECEIPT', postingDate: iso(0), toWarehouseId: stores });
    await addStockEntryLine(store, se.id, { itemCode: 'CPU', qty: '10', rate: '1000' });
    await addStockEntryLine(store, se.id, { itemCode: 'CABLE', qty: '15', rate: '30' });
    await submitStockEntry(store, se.id);

    const harness = await createBom(prod, { itemCode: 'HARNESS', qty: '1' });
    await addBomItem(prod, harness.id, { itemCode: 'CABLE', qty: '10' });
    await submitBom(prod, harness.id, day(0));

    const plc = await createBom(prod, { itemCode: 'PLC', qty: '1' });

    await expect(addBomItem(prod, plc.id, { itemCode: 'PLC', qty: '1' })).rejects.toThrow(/item it makes/);
    await addBomItem(prod, plc.id, { itemCode: 'CPU', qty: '1' });
    await addBomItem(prod, plc.id, { itemCode: 'HARNESS', qty: '1' });
    await addBomOperation(prod, plc.id, { operation: 'Wiring', workstationId: wiringId, timeMinutes: '120' });
    await submitBom(prod, plc.id, day(0));
    const { bom } = await getBom(prod, plc.id);
    expect(bom.rawMaterialCost.toFixed(2)).toBe('1300.00'); // CPU 1000 + harness (10 m × 30)
    expect(bom.operatingCost.toFixed(2)).toBe('1200.00'); // 2 h × 600
    expect(bom.isDefault).toBe(true);
    const price = await prisma.salesItemPrice.findFirst({ where: { item: { companyId: fx.companyId, code: 'PLC' }, source: 'BOM_COST' } });
    expect(price?.rate.toFixed(2)).toBe('2500.00');
    // A loop is refused: the harness can't use the panel that uses it.
    const loop = await createBom(prod, { itemCode: 'HARNESS', qty: '1' });
    await expect(addBomItem(prod, loop.id, { itemCode: 'PLC', qty: '1' })).rejects.toThrow(/loop/);
  });

  it('makes work orders from a sales order and plans production', async () => {
    const so = await order('2');
    const { made } = await makeWorkOrdersFromSalesOrder(prod, so.id);
    expect(made).toHaveLength(1);
    woId = made[0]!.id;
    await expect(makeWorkOrdersFromSalesOrder(prod, so.id)).rejects.toThrow(/already has work orders/);
    await submitWorkOrder(prod, woId);
    const { wo: w, jobCards, state } = await getWorkOrder(prod, woId);
    expect(w.items.map((i) => i.requiredQty.toString()).sort()).toEqual(['2', '2']);
    expect(jobCards).toHaveLength(1);
    expect(jobCards[0]!.plannedMinutes.toString()).toBe('240');
    expect(state.label).toBe('Not started');
    const fg = await systemWarehouseId(fx.companyId, 'FINISHED_GOODS');
    expect((await bin('PLC', fg))?.plannedQty.toString()).toBe('2');
  });

  it('transfers to WIP, prices production with logged time, and completes the order', async () => {
    // Make the two harnesses first: a sub-assembly work order.
    const harnessWo = await prisma.erpWorkOrder.create({ data: { companyId: fx.companyId, number: `WO-H-${fx.run}`, itemId: (await prisma.erpItem.findUniqueOrThrow({ where: { companyId_code: { companyId: fx.companyId, code: 'HARNESS' } } })).id, bomId: (await prisma.erpBom.findFirstOrThrow({ where: { companyId: fx.companyId, number: { startsWith: 'BOM-HARNESS' }, status: 'SUBMITTED' } })).id, qty: 1, sourceWarehouseId: await systemWarehouseId(fx.companyId, 'STORES'), wipWarehouseId: await systemWarehouseId(fx.companyId, 'WIP'), fgWarehouseId: await systemWarehouseId(fx.companyId, 'STORES'), createdById: prod.userId } });
    await submitWorkOrder(prod, harnessWo.id);
    await transferMaterials(prod, harnessWo.id, {}, day(0));
    await manufacture(prod, harnessWo.id, { qty: '1' }, day(0));
    const se = await createStockEntry(store, { purpose: 'MATERIAL_RECEIPT', postingDate: iso(0), toWarehouseId: await systemWarehouseId(fx.companyId, 'STORES') });
    await addStockEntryLine(store, se.id, { itemCode: 'HARNESS', qty: '1', rate: '300' });
    await submitStockEntry(store, se.id);

    await transferMaterials(prod, woId, { qty: '1' }, day(0));
    await expect(manufacture(prod, woId, { qty: '2' }, day(0))).rejects.toThrow(/in WIP for 1 only/);
    const { jobCards } = await getWorkOrder(prod, woId);
    await addJobCardLog(prod, jobCards[0]!.id, { fromTime: `${iso(0)}T09:00`, toTime: `${iso(0)}T12:00`, completedQty: '1' });
    await expect(addJobCardLog(prod, jobCards[0]!.id, { fromTime: `${iso(0)}T11:00`, toTime: `${iso(0)}T12:30` })).rejects.toThrow(/already has time logged/);
    await manufacture(prod, woId, { qty: '1' }, day(0));

    const fg = await systemWarehouseId(fx.companyId, 'FINISHED_GOODS');
    const plc = await bin('PLC', fg);
    // CPU 1000 + harness 300 + logged 3 h × 600 = 1800 for 2 units → 900 for one.
    expect(plc?.stockValue.toFixed(2)).toBe('2200.00');
    expect((await getWorkOrder(prod, woId)).state.label).toBe('In process');

    await transferMaterials(prod, woId, {}, day(0));
    await manufacture(prod, woId, { qty: '1' }, day(0));
    const done = await getWorkOrder(prod, woId);
    expect(done.state.label).toBe('Completed');
    expect(done.wo.items.every((i) => D(i.consumedQty).equals(D(i.requiredQty)))).toBe(true);
    expect((await bin('PLC', fg))?.actualQty.toString()).toBe('2');
    expect((await bin('PLC', fg))?.plannedQty.toString()).toBe('0');
    expect((await bin('CPU', await systemWarehouseId(fx.companyId, 'WIP')))?.actualQty.toString()).toBe('0');
    expect(await balanced()).toBe(true);
  });

  it('undoes production newest entry first', async () => {
    const { entries } = await getWorkOrder(prod, woId);
    const first = entries.find((e) => e.purpose === 'TRANSFER_FOR_MANUFACTURE')!;
    await expect(cancelWorkOrderEntry(prod, woId, first.id)).rejects.toThrow(/newest entry/);
    const last = entries.at(-1)!;
    await cancelWorkOrderEntry(prod, woId, last.id);
    const after = await getWorkOrder(prod, woId);
    expect(after.wo.producedQty.toString()).toBe('1');
    expect(after.state.label).toBe('In process');
    const fg = await systemWarehouseId(fx.companyId, 'FINISHED_GOODS');
    expect((await bin('PLC', fg))?.plannedQty.toString()).toBe('1');
    expect(await balanced()).toBe(true);
  });

  it('plans production from open orders: multi-level shortages become a purchase request', async () => {
    await order('3');
    const plan = await createProductionPlan(prod, { postingDate: iso(0) });
    expect(await getItemsFromSalesOrders(prod, plan.id)).toBe(1);
    await submitProductionPlan(prod, plan.id);
    const need = await materialRequirement(prod, plan.id);
    const cpu = need.find((n) => n.code === 'CPU')!;
    const cable = need.find((n) => n.code === 'CABLE')!;
    expect(cpu.required.toString()).toBe('3');
    expect(cable.required.toString()).toBe('30'); // the harness exploded into cable
    expect(cable.shortage.greaterThan(0)).toBe(true);
    const mr = await makeMaterialRequestFromPlan(prod, plan.id, day(0));
    const lines = await prisma.erpMaterialRequestLine.findMany({ where: { requestId: mr.id } });
    expect(lines.length).toBeGreaterThan(0);
    const made = await makeWorkOrdersFromPlan(prod, plan.id);
    expect(made).toHaveLength(1);
    expect(made[0]!.qty.toString()).toBe('3');
    await expect(makeWorkOrdersFromPlan(prod, plan.id)).rejects.toThrow(DomainError);
  });
});
