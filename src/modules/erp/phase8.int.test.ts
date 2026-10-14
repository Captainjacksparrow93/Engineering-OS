import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import { loadPrincipal } from '@/core/rbac/principal';
import type { Principal } from '@/core/rbac/types';
import { makeErpCompany } from './test-fixture';
import { createItem, warehouseOptions } from './services/item.service';
import { createParty } from './services/party.service';
import { addMaterialRequestLine, createMaterialRequest, submitMaterialRequest } from './services/material-request.service';
import { makePurchaseOrderFromRequest, submitPurchaseOrder } from './services/purchase-order.service';
import { makeReceiptFromOrder, submitPurchaseReceipt } from './services/purchase-receipt.service';
import { addStockEntryLine, createStockEntry, submitStockEntry } from './services/stock-entry.service';
import { projectMaterials } from './services/project-erp.service';
import { erpHomeKpis, monthlyTrend, topParties } from './services/analytics.service';
import { exportCsv } from './services/export.service';
import { addIncomeLine, createSalesInvoice, incomeAccounts, submitSalesInvoice } from './services/sales-invoice.service';
import { runBackfill } from './backfill';
import { syncOrderChanges } from './sync';

const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('Plan 022 phase 8: dashboards, project materials, exports, backfill', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let director: Principal;
  let store: Principal;
  let buyer: Principal;
  let engineer: Principal;
  let projectId: string;

  beforeAll(async () => {
    fx = await makeErpCompany('P8');
    director = await fx.user('DIRECTOR', 'Director');
    store = await fx.user('STORE_KEEPER', 'Store');
    buyer = await fx.user('PURCHASE_MANAGER', 'Buyer');
    engineer = await fx.user('JUNIOR_ENGINEER', 'Engineer');
    const project = await prisma.project.create({ data: { companyId: fx.companyId, code: `P8-${fx.run}`, name: 'Kiln panels', clientName: 'UltraTech', managerId: director.userId, members: { create: { userId: engineer.userId } } } });
    projectId = project.id;
    engineer = (await loadPrincipal(engineer.userId))!;
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('project materials: requested → ordered → received → issued; money only for ERP readers', async () => {
    await createItem(store, { code: 'MCCB-63', name: 'MCCB 63A', isStockItem: 'on', isPurchaseItem: 'on' });
    const stores = (await warehouseOptions(fx.companyId)).find((w) => w.name === 'Stores')!.id;
    const supplier = await createParty(buyer, 'SUPPLIER', { name: `ABB ${fx.run}` });
    const mr = await createMaterialRequest(store, { purpose: 'PURCHASE', requestDate: today, warehouseId: stores, projectId });
    await addMaterialRequestLine(store, mr.id, { itemCode: 'MCCB-63', qty: '10' });
    await submitMaterialRequest(store, mr.id);
    const po = await makePurchaseOrderFromRequest(buyer, mr.id, supplier.id, day(today));
    await prisma.erpPurchaseOrderLine.updateMany({ where: { orderId: po.id }, data: { rate: 1500, amount: 15000 } });
    await submitPurchaseOrder(buyer, po.id);
    const pr = await makeReceiptFromOrder(store, po.id, day(today));
    await prisma.erpPurchaseReceiptLine.updateMany({ where: { receiptId: pr.id }, data: { qty: 6, amount: 9000 } });
    await submitPurchaseReceipt(store, pr.id);
    const issue = await createStockEntry(store, { purpose: 'MATERIAL_ISSUE', postingDate: today, fromWarehouseId: stores, projectId });
    await addStockEntryLine(store, issue.id, { itemCode: 'MCCB-63', qty: '4' });
    await submitStockEntry(store, issue.id);

    const m = (await projectMaterials(director, projectId))!;
    const row = m.items.find((r) => r.item?.code === 'MCCB-63')!;
    expect([row.requested, row.ordered, row.received, row.issued].map((d) => d.toString())).toEqual(['10', '10', '6', '4']);
    expect(m.issuedValue?.toFixed(2)).toBe('6000.00');
    const seen = (await projectMaterials(engineer, projectId))!;
    expect(seen.items[0]!.issued.toString()).toBe('4');
    expect(seen.issuedValue).toBeNull();
    expect(seen.billed).toBeNull();
  });

  it('home figures follow what the person can read; trends and top lists', async () => {
    const customer = await createParty(director, 'CUSTOMER', { name: `UltraTech ${fx.run}` });
    const income = (await incomeAccounts(fx.companyId)).find((a) => a.name === 'Service Income')!.id;
    const si = await createSalesInvoice(director, customer.id, { postingDate: today });
    await addIncomeLine(director, si.id, { description: 'Retrofit', accountId: income, qty: '1', rate: '50000', gstRate: '18' });
    await submitSalesInvoice(director, si.id);

    const kpis = await erpHomeKpis(director);
    expect(kpis.find((k) => k.label.startsWith('Sales'))?.value.toString()).toBe('50000');
    expect(kpis.find((k) => k.label === 'Receivable')?.value.toString()).toBe('59000');
    expect(await erpHomeKpis(engineer)).toEqual([]);
    expect((await erpHomeKpis(store)).some((k) => k.label === 'Receivable')).toBe(false);
    const trend = await monthlyTrend(director, 'sales');
    expect(trend).toHaveLength(12);
    expect(trend.at(-1)!.value.toString()).toBe('50000');
    await expect(monthlyTrend(engineer, 'sales')).rejects.toThrow(ForbiddenError);
    expect((await topParties(director, 'CUSTOMER'))[0]?.name).toBe(`UltraTech ${fx.run}`);
  });

  it('CSV exports reuse the screens’ access rules', async () => {
    const tb = await exportCsv(director, 'trial-balance', new URLSearchParams());
    expect(tb.body.split('\r\n')[0]).toBe('Code,Account,Group,Opening Dr,Opening Cr,Debit,Credit,Closing Dr,Closing Cr');
    const items = await exportCsv(store, 'items', new URLSearchParams());
    expect(items.body).toContain('MCCB-63');
    await expect(exportCsv(engineer, 'trial-balance', new URLSearchParams())).rejects.toThrow(ForbiddenError);
    await expect(exportCsv(store, 'receivables', new URLSearchParams())).rejects.toThrow(ForbiddenError);
    await expect(exportCsv(director, 'nope', new URLSearchParams())).rejects.toThrow(DomainError);
  });

  it('backfill: dry run writes nothing; apply creates an imported order tied to the panels; re-run skips', async () => {
    const template = await prisma.checklistTemplate.findFirst({ where: { isActive: true }, select: { code: true } });
    expect(template, 'checklist templates come from npm run db:seed').not.toBeNull();
    const code = template!.code;
    const client = await prisma.client.create({ data: { companyId: fx.companyId, name: `Hindalco ${fx.run}`, refNumber: `ACS-${fx.run}` } });
    const old = await prisma.project.create({
      data: { companyId: fx.companyId, code: `OLD-${fx.run}`, name: 'Old project', clientId: client.id, clientName: client.name, managerId: director.userId, workOrderNo: `9${fx.run}`, status: 'IN_PROGRESS', targetEndDate: day('2026-12-31') },
    });
    const t1 = await prisma.task.create({ data: { projectId: old.id, code: '1', title: `${code} Panel 1`, type: 'PHASE', plannedEnd: day('2026-11-30'), createdById: director.userId } });
    const t2 = await prisma.task.create({ data: { projectId: old.id, code: '2', title: `${code} Panel 2`, type: 'PHASE', plannedEnd: day('2026-11-30'), createdById: director.userId } });
    const lines: string[] = [];
    const dry = await runBackfill({ companyId: fx.companyId, actorId: director.userId, apply: false, log: (l) => lines.push(l) });
    expect(dry.created).toBeGreaterThanOrEqual(1);
    expect(await prisma.erpSalesOrder.count({ where: { companyId: fx.companyId, isImported: true } })).toBe(0);

    const report = await runBackfill({ companyId: fx.companyId, actorId: director.userId, apply: true, log: () => undefined });
    expect(report.failed).toBe(0);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: old.id } });
    const so = await prisma.erpSalesOrder.findFirstOrThrow({ where: { companyId: fx.companyId, number: project.erpSalesOrder! }, include: { lines: true } });
    expect(so).toMatchObject({ isImported: true, status: 'SUBMITTED', projectId: old.id, woNumber: `9${fx.run}` });
    expect(so.lines).toHaveLength(1);
    expect(so.lines[0]!.qty.toString()).toBe('2');
    const tasks = await prisma.task.findMany({ where: { id: { in: [t1.id, t2.id] } }, orderBy: { code: 'asc' } });
    expect(tasks.map((t) => t.erpOrderItem)).toEqual([`${so.lines[0]!.id}#1`, `${so.lines[0]!.id}#2`]);
    expect((await prisma.erpParty.findFirstOrThrow({ where: { companyId: fx.companyId, kind: 'CUSTOMER', clientId: client.id } })).name).toBe(client.name);

    const again = await runBackfill({ companyId: fx.companyId, actorId: director.userId, apply: true, log: () => undefined });
    expect(again.created).toBe(0);
    await syncOrderChanges(fx.companyId, { projectId: old.id });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: old.id } })).erpOrderAlert).toBeNull();
  });
});
