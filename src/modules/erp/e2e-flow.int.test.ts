import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/core/db/prisma';
import type { Principal } from '@/core/rbac/types';
import { createAutomationProject } from '@/modules/project-management/services/automation-project.service';
import { closeDeal, createDeal } from '@/modules/sales/services/deal.service';
import { addLine, createQuote, submitQuote } from '@/modules/sales/services/quote.service';
import { D } from './domain/money';
import { makeErpCompany } from './test-fixture';
import { getOrderForProject } from './order.service';
import { createItem, warehouseOptions } from './services/item.service';
import { createParty } from './services/party.service';
import { ensurePanelItems } from './services/selling-bridge';
import { submitSalesOrder, updateSalesOrderLine } from './services/sales-order.service';
import { addBomItem, createBom, submitBom } from './services/bom.service';
import { makeWorkOrdersFromSalesOrder, manufacture, submitWorkOrder, transferMaterials } from './services/work-order.service';
import { addMaterialRequestLine, createMaterialRequest, submitMaterialRequest } from './services/material-request.service';
import { makePurchaseOrderFromRequest, submitPurchaseOrder } from './services/purchase-order.service';
import { makeReceiptFromOrder, submitPurchaseReceipt } from './services/purchase-receipt.service';
import { addReading, createInspection, submitInspection } from './services/quality.service';
import { makeInvoiceFromReceipt, submitPurchaseInvoice } from './services/purchase-invoice.service';
import { makeDeliveryFromOrder, submitDeliveryNote } from './services/delivery-note.service';
import { makeInvoiceFromDelivery, submitSalesInvoice } from './services/sales-invoice.service';
import { createPaymentForInvoice, submitPayment } from './services/payment.service';
import { projectProfitability, trialBalance } from './services/reports.service';
import { projectMaterials } from './services/project-erp.service';

const todayIso = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const today = new Date(`${todayIso}T00:00:00.000Z`);
const later = new Date(today.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);

/**
 * Plan 022 acceptance: won deal → sales order → project → material request → purchase order →
 * receipt (with incoming inspection) → bill → work order → delivery → invoice → payments, with
 * the books balanced and the GL stock value equal to the stock ledger at the end.
 */
describe('Plan 022: end-to-end order to cash and procure to pay', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let director: Principal;
  let pm: Principal;

  beforeAll(async () => {
    fx = await makeErpCompany('E2E');
    director = await fx.user('DIRECTOR', 'Director');
    pm = await fx.user('PROJECT_MANAGER', 'PM', { tech: true });
    await ensurePanelItems(fx.companyId);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('runs the whole chain with balanced books', async () => {
    // Sales: deal → quote → won → draft sales order.
    const deal = await createDeal(director, { title: `Kiln PLC ${fx.run}`, newAccountName: `JSW ${fx.run}`, value: 150000 });
    const quote = await createQuote(director, deal.id);
    await addLine(director, quote.id, { panel: 'PLC Panel', description: 'PLC panel, assembled and tested', unitCost: 100000, qty: 1, marginPct: 30 });
    expect((await submitQuote(director, quote.id)).status).toBe('APPROVED');
    const wo = `8${fx.run}`.slice(0, 8);
    await closeDeal(director, deal.id, { outcome: 'WON', woNumber: wo });
    const so = await prisma.erpSalesOrder.findFirstOrThrow({ where: { companyId: fx.companyId, dealId: deal.id }, include: { lines: true } });
    for (const l of so.lines) await updateSalesOrderLine(director, so.id, l.id, { qty: l.qty.toString(), deliveryDate: later });
    await submitSalesOrder(director, so.id);

    // PM: the project starts from the order.
    await getOrderForProject(director, so.number);
    const project = await createAutomationProject(director, { kind: 'WORK_ORDER', salesOrder: so.number, managerId: pm.userId, workOrderNo: wo, scopes: [] } as never);
    expect((await prisma.erpSalesOrder.findUniqueOrThrow({ where: { id: so.id } })).projectId).toBe(project.id);

    // Buying: the CPU the panel needs, inspected on arrival, billed.
    await createItem(director, { code: `CPU-${fx.run}`, name: 'S7-1500 CPU', isStockItem: 'on', isPurchaseItem: 'on', inspectionBeforePurchase: 'on' });
    const stores = (await warehouseOptions(fx.companyId)).find((w) => w.name === 'Stores')!.id;
    const supplier = await createParty(director, 'SUPPLIER', { name: `Siemens ${fx.run}` });
    const mr = await createMaterialRequest(director, { purpose: 'PURCHASE', requestDate: todayIso, warehouseId: stores, projectId: project.id });
    await addMaterialRequestLine(director, mr.id, { itemCode: `CPU-${fx.run}`, qty: '2' });
    await submitMaterialRequest(director, mr.id);
    const po = await makePurchaseOrderFromRequest(director, mr.id, supplier.id, today);
    await prisma.erpPurchaseOrderLine.updateMany({ where: { orderId: po.id }, data: { rate: 30000, amount: 60000 } });
    await submitPurchaseOrder(director, po.id);
    const pr = await makeReceiptFromOrder(director, po.id, today);
    const prLine = await prisma.erpPurchaseReceiptLine.findFirstOrThrow({ where: { receiptId: pr.id } });
    await expect(submitPurchaseReceipt(director, pr.id)).rejects.toThrow(/quality inspection/);
    const qi = await createInspection(director, { type: 'INCOMING', itemCode: `CPU-${fx.run}`, inspectionDate: todayIso, referenceType: 'Purchase Receipt', referenceId: pr.id, referenceLineId: prLine.id });
    await addReading(director, qi.id, { parameter: 'Seal intact', value: 'pass' });
    expect(await submitInspection(director, qi.id)).toBe('ACCEPTED');
    await submitPurchaseReceipt(director, pr.id);
    const bill = await makeInvoiceFromReceipt(director, pr.id, today);
    await submitPurchaseInvoice(director, bill.id);
    await submitPayment(director, (await createPaymentForInvoice(director, 'Purchase Invoice', bill.id, today)).id);

    // Manufacturing: BOM, work order from the sales order, materials to WIP, finish.
    const plc = so.lines[0]!;
    const plcCode = (await prisma.erpItem.findUniqueOrThrow({ where: { id: plc.itemId } })).code;
    const bom = await createBom(director, { itemCode: plcCode, qty: '1' });
    await addBomItem(director, bom.id, { itemCode: `CPU-${fx.run}`, qty: '2' });
    await submitBom(director, bom.id, today);
    await makeWorkOrdersFromSalesOrder(director, so.id);
    const wos = await prisma.erpWorkOrder.findMany({ where: { companyId: fx.companyId, salesOrderId: so.id } });
    expect(wos).toHaveLength(1);
    expect(wos[0]!.projectId).toBe(project.id);
    await submitWorkOrder(director, wos[0]!.id);
    await transferMaterials(director, wos[0]!.id, {}, today);
    await manufacture(director, wos[0]!.id, { qty: plc.qty.toString() }, today);

    // Selling: deliver, invoice, collect.
    const dn = await makeDeliveryFromOrder(director, so.id, today);
    await submitDeliveryNote(director, dn.id);
    const inv = await makeInvoiceFromDelivery(director, dn.id, today);
    await submitSalesInvoice(director, inv.id);
    await submitPayment(director, (await createPaymentForInvoice(director, 'Sales Invoice', inv.id, today)).id);
    expect((await prisma.erpSalesInvoice.findUniqueOrThrow({ where: { id: inv.id } })).outstandingAmount.toFixed(2)).toBe('0.00');
    expect((await prisma.erpPurchaseInvoice.findUniqueOrThrow({ where: { id: bill.id } })).outstandingAmount.toFixed(2)).toBe('0.00');

    // Books: balanced, trial balance ties, GL stock = stock ledger.
    const gl = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId }, _sum: { debit: true, credit: true } });
    expect(gl._sum.debit?.toFixed(2)).toBe(gl._sum.credit?.toFixed(2));
    const tb = await trialBalance(director, { from: new Date(Date.UTC(2020, 0, 1)), to: today });
    expect(tb.totals[4]!.toFixed(2)).toBe(tb.totals[5]!.toFixed(2));
    const stockGl = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId, isCancelled: false, account: { accountType: 'STOCK' } }, _sum: { debit: true, credit: true } });
    const ledger = await prisma.erpStockLedger.aggregate({ where: { companyId: fx.companyId, isCancelled: false }, _sum: { valueChange: true } });
    const bins = await prisma.erpBin.aggregate({ where: { companyId: fx.companyId }, _sum: { stockValue: true } });
    expect(D(stockGl._sum.debit).minus(D(stockGl._sum.credit)).toFixed(2)).toBe(D(ledger._sum.valueChange).toFixed(2));
    expect(D(bins._sum.stockValue).toFixed(2)).toBe(D(ledger._sum.valueChange).toFixed(2));

    // The project sees its materials and its profit.
    const m = (await projectMaterials(director, project.id))!;
    const cpu = m.items.find((r) => r.item?.code === `CPU-${fx.run}`)!;
    expect([cpu.requested, cpu.ordered, cpu.received].map((x) => x.toString())).toEqual(['2', '2', '2']);
    const profit = (await projectProfitability(director, { from: new Date(Date.UTC(2020, 0, 1)), to: today })).find((r) => r.project.id === project.id)!;
    expect(profit.income.greaterThan(0)).toBe(true);
    expect(profit.cost.greaterThan(0)).toBe(true);
  });
});
