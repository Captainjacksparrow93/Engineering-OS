import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { createAutomationProject } from '@/modules/project-management/services/automation-project.service';
import { closeDeal } from '@/modules/sales/services/deal.service';
import { D } from './domain/money';
import { makeErpCompany } from './test-fixture';
import { getOrderForProject, listWaitingOrders, resolveClientForCustomer } from './order.service';
import { resetSyncThrottle, syncOrderChanges } from './sync';
import { createParty, partyBalance, updateParty } from './services/party.service';
import { updateSettings } from './services/settings.service';
import { addStockEntryLine, createStockEntry, submitStockEntry } from './services/stock-entry.service';
import {
  addSalesOrderLine,
  cancelSalesOrder,
  createSalesOrder,
  getSalesOrder,
  setSalesOrderOnHold,
  submitSalesOrder,
  updateSalesOrderLine,
  updateSubmittedSalesOrder,
} from './services/sales-order.service';
import { cancelDeliveryNote, getDeliveryNote, makeDeliveryFromOrder, submitDeliveryNote, updateDeliveryLine } from './services/delivery-note.service';
import { cancelSalesInvoice, getSalesInvoice, makeInvoiceFromDelivery, makeInvoiceFromSalesOrder, submitSalesInvoice } from './services/sales-invoice.service';
import { ensurePanelItems } from './services/selling-bridge';
import { systemWarehouseId } from './services/setup';

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const day = (days: number) => new Date(`${iso(days)}T00:00:00Z`);

describe('Plan 022 phase 3: selling, and projects from sales orders', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let director: Principal;
  let salesHead: Principal;
  let store: Principal;
  let pm: Principal;
  let customerId: string;
  let soId: string;
  let soNumber: string;
  let projectId: string;
  let wo = 0;
  const nextWo = () => `7${fx.run.slice(-5)}${++wo}`;

  async function balanced() {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId }, _sum: { debit: true, credit: true } });
    return D(agg._sum.debit).equals(D(agg._sum.credit));
  }
  const bin = (code: string, warehouseId: string) => prisma.erpBin.findFirst({ where: { warehouseId, item: { code, companyId: fx.companyId } } });

  async function submittedOrder(lines: Array<[string, string, string]>, extra: Record<string, string> = {}) {
    const so = await createSalesOrder(salesHead, { customerId, orderDate: iso(0), deliveryDate: iso(60), woNumber: nextWo(), ...extra });
    for (const [itemCode, qty, rate] of lines) await addSalesOrderLine(salesHead, so.id, { itemCode, qty, rate });
    await submitSalesOrder(salesHead, so.id);
    return prisma.erpSalesOrder.findUniqueOrThrow({ where: { id: so.id } });
  }

  beforeAll(async () => {
    fx = await makeErpCompany('SEL');
    director = await fx.user('DIRECTOR', 'Director');
    salesHead = await fx.user('SALES_HEAD', 'Sales Head');
    store = await fx.user('STORE_KEEPER', 'Store');
    pm = await fx.user('PROJECT_MANAGER', 'PM', { tech: true });
    await updateSettings(director, { companyState: 'Gujarat', defaultGstRate: '18', projectsFromSalesOrders: 'on' });
    await ensurePanelItems(fx.companyId);
    resetSyncThrottle();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('makes every checklist template a sellable panel item', async () => {
    const plc = await prisma.erpItem.findUnique({ where: { companyId_code: { companyId: fx.companyId, code: 'PLC' } } });
    expect(plc?.itemGroup).toBe('Panels');
    expect(plc?.isSalesItem && plc.isStockItem).toBe(true);
  });

  it('creates customers for Selling only', async () => {
    await expect(createParty(store, 'CUSTOMER', { name: 'Nope' })).rejects.toThrow(ForbiddenError);
    customerId = (await createParty(salesHead, 'CUSTOMER', { name: `Tata Steel ${fx.run}`, state: 'Gujarat', paymentTermsDays: '30' })).id;
  });

  it('validates the order: digits-only WO, delivery date, unique WO', async () => {
    await expect(createSalesOrder(salesHead, { customerId, orderDate: iso(0), woNumber: 'WO-1' })).rejects.toThrow(ZodError);
    const so = await createSalesOrder(salesHead, { customerId, orderDate: iso(0), woNumber: nextWo() });
    await addSalesOrderLine(salesHead, so.id, { itemCode: 'PLC', qty: '2', rate: '250000' });
    await expect(submitSalesOrder(salesHead, so.id)).rejects.toThrow(/delivery date/);
    await updateSalesOrderLine(salesHead, so.id, (await prisma.erpSalesOrderLine.findFirstOrThrow({ where: { orderId: so.id } })).id, { qty: '2', deliveryDate: iso(45) });
    await addSalesOrderLine(salesHead, so.id, { itemCode: 'SCADA', qty: '1', rate: '400000', deliveryDate: iso(60) });
    await addSalesOrderLine(salesHead, so.id, { itemCode: 'FREIGHT', qty: '1', rate: '15000', deliveryDate: iso(60) });
    await submitSalesOrder(salesHead, so.id);
    soId = so.id;
    const { so: fresh, state } = await getSalesOrder(salesHead, so.id);
    soNumber = fresh.number;
    expect(fresh.grandTotal.toFixed(2)).toBe(D(915000).times(1.18).toFixed(2));
    expect(state.label).toBe('To deliver and bill');
    const fg = await systemWarehouseId(fx.companyId, 'FINISHED_GOODS');
    expect((await bin('PLC', fg))?.reservedQty.toString()).toBe('2');
    await expect(createSalesOrder(salesHead, { customerId, orderDate: iso(0), woNumber: fresh.woNumber! })).rejects.toThrow(/already on sales order/);
  });

  it('refuses an order over the credit limit', async () => {
    const tight = await createParty(salesHead, 'CUSTOMER', { name: `Small Co ${fx.run}`, creditLimit: '100000' });
    const so = await createSalesOrder(salesHead, { customerId: tight.id, orderDate: iso(0), deliveryDate: iso(30), woNumber: nextWo() });
    await addSalesOrderLine(salesHead, so.id, { itemCode: 'HMI', qty: '1', rate: '90000' });
    await expect(submitSalesOrder(salesHead, so.id)).rejects.toThrow(/credit limit/);
  });

  it('PM: with the rule on, a work order needs a sales order; a service call does not', async () => {
    await expect(createAutomationProject(director, { kind: 'WORK_ORDER', workOrderNo: nextWo(), managerId: pm.userId, scopes: [{ templateCode: 'PLC', quantity: 1 }] } as never)).rejects.toThrow(/Pick a sales order first/);
    await expect(listWaitingOrders(store)).rejects.toThrow(ForbiddenError);
  });

  it('PM: lists the waiting order and turns it into a project; the order and customer link back', async () => {
    const waiting = await listWaitingOrders(director);
    const row = waiting.find((w) => w.orderName === soNumber);
    expect(row?.panelsSummary).toBe('2 × PLC, 1 × SCADA');
    const input = await getOrderForProject(director, soNumber);
    expect(input.scopes).toEqual([{ templateCode: 'PLC', quantity: 2 }, { templateCode: 'SCADA', quantity: 1 }]);
    expect(Object.keys(input.panelOrderItems)).toEqual(['PLC_1', 'PLC_2', 'SCADA_1']);

    const project = await createAutomationProject(director, {
      kind: 'WORK_ORDER',
      salesOrder: soNumber,
      managerId: pm.userId,
      // The browser's values lose to the order's.
      workOrderNo: '1',
      scopes: [{ templateCode: 'HMI', quantity: 9 }],
    } as never);
    projectId = project.id;
    expect(project.workOrderNo).toBe(input.workOrderNo);
    expect(project.erpSalesOrder).toBe(soNumber);
    const so = await prisma.erpSalesOrder.findUniqueOrThrow({ where: { id: soId } });
    expect(so.projectId).toBe(project.id);
    const customer = await prisma.erpParty.findUniqueOrThrow({ where: { id: customerId } });
    const client = await prisma.client.findUniqueOrThrow({ where: { id: customer.clientId! } });
    expect(client.refNumber).toMatch(/^ACS-/);
    expect(client.erpCustomer).toBe(customer.code);
    expect(project.clientId).toBe(client.id);
    const phases = await prisma.task.findMany({ where: { projectId, type: 'PHASE' } });
    expect(phases).toHaveLength(3);
    expect((await listWaitingOrders(director)).find((w) => w.orderName === soNumber)).toBeUndefined();
    await expect(getOrderForProject(director, soNumber)).rejects.toThrow(/already linked/);
    // The same customer resolves to the same client.
    expect((await resolveClientForCustomer(director, customer.code)).id).toBe(client.id);
  });

  it('PM: refuses orders that are on hold or lack a WO', async () => {
    const held = await submittedOrder([['PLC', '1', '100']]);
    await setSalesOrderOnHold(salesHead, held.id, true);
    await expect(getOrderForProject(director, held.number)).rejects.toThrow(/on hold/);
    const draft = await createSalesOrder(salesHead, { customerId, orderDate: iso(0), deliveryDate: iso(30) });
    await expect(getOrderForProject(director, draft.number)).rejects.toThrow(/draft/);
  });

  it('sync: PO, delivery date and an added panel flow into the project; Directors are alerted', async () => {
    await updateSubmittedSalesOrder(salesHead, soId, { poNo: 'TS/PO/77', deliveryDate: iso(70), woNumber: (await prisma.erpSalesOrder.findUniqueOrThrow({ where: { id: soId } })).woNumber! });
    const plcLine = await prisma.erpSalesOrderLine.findFirstOrThrow({ where: { orderId: soId, sortOrder: 0 } });
    await updateSalesOrderLine(salesHead, soId, plcLine.id, { qty: '3', deliveryDate: iso(50) });
    expect((await syncOrderChanges(fx.companyId, { projectId })).synced).toBe(1);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.clientPoNumber).toBe('TS/PO/77');
    expect(project.targetEndDate?.toISOString().slice(0, 10)).toBe(iso(70));
    expect(project.erpOrderAlert).toMatch(/PLC Panel 3 added/);
    const phases = await prisma.task.findMany({ where: { projectId, type: 'PHASE' }, orderBy: { code: 'asc' } });
    expect(phases).toHaveLength(4);
    expect(phases.filter((t) => t.title.startsWith('PLC')).every((t) => t.plannedEnd?.toISOString().slice(0, 10) === iso(50))).toBe(true);
    const notified = await prisma.notification.count({ where: { userId: director.userId, title: { contains: project.code } } });
    expect(notified).toBeGreaterThan(0);
    // The same state twice: nothing new.
    expect((await syncOrderChanges(fx.companyId, { projectId })).synced).toBe(0);
  });

  it('sync: a customer rename renames the PM client and its projects', async () => {
    await updateParty(salesHead, 'CUSTOMER', customerId, { name: `Tata Steel Ltd ${fx.run}`, state: 'Gujarat' });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { client: true } });
    expect(project.client?.name).toBe(`Tata Steel Ltd ${fx.run}`);
    expect(project.clientName).toBe(`Tata Steel Ltd ${fx.run}`);
  });

  it('delivers panels at cost (COGS) only from stock, and refuses over-delivery', async () => {
    const fg = await systemWarehouseId(fx.companyId, 'FINISHED_GOODS');
    const empty = await makeDeliveryFromOrder(salesHead, soId, day(0));
    await expect(submitDeliveryNote(salesHead, empty.id)).rejects.toThrow(/Not enough PLC in Finished Goods/);
    const se = await createStockEntry(store, { purpose: 'MATERIAL_RECEIPT', postingDate: iso(0), toWarehouseId: fg });
    await addStockEntryLine(store, se.id, { itemCode: 'PLC', qty: '3', rate: '180000' });
    await addStockEntryLine(store, se.id, { itemCode: 'SCADA', qty: '1', rate: '300000' });
    await submitStockEntry(store, se.id);
    const { dn } = await getDeliveryNote(salesHead, empty.id);
    const plc = dn.lines.find((l) => l.qty.toString() === '3')!;
    await updateDeliveryLine(salesHead, empty.id, plc.id, { qty: '4' });
    await expect(submitDeliveryNote(salesHead, empty.id)).rejects.toThrow(/only 3 left to deliver/);
    await updateDeliveryLine(salesHead, empty.id, plc.id, { qty: '2' });
    await submitDeliveryNote(salesHead, empty.id);
    const { gl } = await getDeliveryNote(salesHead, empty.id);
    expect(gl.find((g) => g.account.name === 'Cost of Goods Sold')?.debit.toFixed(2)).toBe('660000.00');
    expect(gl.every((g) => g.projectId === projectId)).toBe(true);
    // 1 still to deliver here + 1 on the order put on hold earlier.
    expect((await bin('PLC', fg))?.reservedQty.toString()).toBe('2');
    expect((await getSalesOrder(salesHead, soId)).state.delivered).toBe(75);
    expect(await balanced()).toBe(true);
  });

  it('bills the order with Output GST, refuses double billing via the delivery, and reverses on cancel', async () => {
    const inv = await makeInvoiceFromSalesOrder(salesHead, soId, day(0));
    await submitSalesInvoice(salesHead, inv.id);
    const { inv: billed, gl } = await getSalesInvoice(salesHead, inv.id);
    // 3 PLC × 2,50,000 + SCADA 4,00,000 + freight 15,000.
    expect(billed.netTotal.toFixed(2)).toBe('1165000.00');
    expect(billed.cgst.toFixed(2)).toBe('104850.00');
    expect(gl.find((g) => g.account.name === 'Debtors')?.debit.toFixed(2)).toBe('1374700.00');
    expect(gl.find((g) => g.account.name === 'Service Income')?.credit.toFixed(2)).toBe('15000.00');
    expect(gl.filter((g) => g.account.name === 'Sales').every((g) => g.projectId === projectId)).toBe(true);
    expect((await partyBalance(fx.companyId, 'CUSTOMER', customerId)).toFixed(2)).toBe('1374700.00');
    const dn = await prisma.erpDeliveryNote.findFirstOrThrow({ where: { companyId: fx.companyId, status: 'SUBMITTED' } });
    const twice = await makeInvoiceFromDelivery(salesHead, dn.id, day(0));
    await expect(submitSalesInvoice(salesHead, twice.id)).rejects.toThrow(/left to bill on the order/);
    await expect(cancelSalesOrder(salesHead, soId)).rejects.toThrow(/deliveries or invoices/);
    await cancelSalesInvoice(salesHead, inv.id);
    await cancelDeliveryNote(salesHead, dn.id);
    expect((await partyBalance(fx.companyId, 'CUSTOMER', customerId)).toFixed(2)).toBe('0.00');
    expect(await balanced()).toBe(true);
  });

  it('sync: cancelling the order only alerts; nothing in PM is deleted', async () => {
    await cancelSalesOrder(salesHead, soId);
    await syncOrderChanges(fx.companyId, { projectId });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.erpOrderAlert).toMatch(/Order cancelled in ERP/);
    expect(await prisma.task.count({ where: { projectId, type: 'PHASE' } })).toBe(4);
  });

  it('a won deal becomes a draft sales order from its accepted quote', async () => {
    const account = await prisma.salesAccount.create({ data: { companyId: fx.companyId, name: `JSW ${fx.run}`, city: 'Vadodara' } });
    const deal = await prisma.salesDeal.create({ data: { companyId: fx.companyId, code: `D-${fx.run}`, title: 'Furnace panels', accountId: account.id, ownerId: salesHead.userId, stage: 'QUOTED' } });
    await prisma.salesQuote.create({
      data: {
        companyId: fx.companyId,
        dealId: deal.id,
        number: `Q-${fx.run}`,
        status: 'APPROVED',
        discountPct: 10,
        freight: 5000,
        gstPct: 18,
        validUntil: day(30),
        createdById: salesHead.userId,
        lines: {
          create: [
            { panel: 'PLC Panel 1', description: 'CPU', qty: 1, unitCost: 80000, marginPct: 20, sortOrder: 0 },
            { panel: 'PLC Panel 1', description: 'Enclosure', qty: 1, unitCost: 20000, marginPct: 20, sortOrder: 1 },
            { panel: 'HMI Panel', description: 'HMI 10 inch', qty: 1, unitCost: 40000, marginPct: 20, sortOrder: 2 },
          ],
        },
      },
    });
    const wonWo = nextWo();
    await closeDeal(salesHead, deal.id, { outcome: 'WON', woNumber: wonWo });
    const won = await prisma.salesDeal.findUniqueOrThrow({ where: { id: deal.id } });
    const so = await prisma.erpSalesOrder.findFirstOrThrow({ where: { companyId: fx.companyId, dealId: deal.id }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    expect(won.erpSalesOrder).toBe(so.number);
    expect(so.status).toBe('DRAFT');
    expect(so.woNumber).toBe(wonWo);
    const codes = await prisma.erpItem.findMany({ where: { id: { in: so.lines.map((l) => l.itemId) } }, select: { id: true, code: true } });
    const code = new Map(codes.map((c) => [c.id, c.code]));
    expect(so.lines.map((l) => `${code.get(l.itemId)} ${l.rate.toFixed(2)}`)).toEqual(['PLC 112500.00', 'HMI 45000.00', 'FREIGHT 5000.00']);
    const customer = await prisma.erpParty.findUniqueOrThrow({ where: { id: so.customerId } });
    expect(customer.name).toBe(account.name);
    await expect(submitSalesOrder(store, so.id)).rejects.toThrow(ForbiddenError);
    await expect(submitSalesOrder(salesHead, so.id)).rejects.toThrow(DomainError); // needs a delivery date
  });
});
