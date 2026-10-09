import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ZodError } from 'zod';
import { prisma } from '@/core/db/prisma';
import { loadPrincipal } from '@/core/rbac/principal';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '@/core/rbac/errors';
import { addDays, todayInIndia } from '@/core/utils/dates';
import type { Principal } from '@/core/rbac/types';
import { addPrice, createItem, importPrices, listItems } from './services/catalog.service';
import { createAccount, getAccount, listAccounts, updateRelationship } from './services/account.service';
import { addActivity, closeDeal, createDeal, getDeal, listDeals, moveStage, updateDeal } from './services/deal.service';
import {
  addLine,
  applyMargin,
  createQuote,
  getQuote,
  markQuoteSent,
  refreshPrices,
  reviseQuote,
  sendBackQuote,
  approveQuote,
  submitQuote,
  updateLine,
  updateQuoteTerms,
} from './services/quote.service';
import { deleteHistoryImport, importHistory, listHistoryImports } from './services/history.service';
import { getQuoteInsights } from './services/insight.service';
import { getSalesSettings, updateSalesSettings, DEFAULT_CONFIG } from './services/settings.service';
import { getSalesDashboard } from './services/dashboard.service';

const run = `${Date.now()}`.slice(-6);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('Plan 018: Sales module', () => {
  let execA: Principal;
  let execB: Principal;
  let head: Principal;
  let director: Principal;
  let engineer: Principal;
  let companyId: string;
  const userIds: string[] = [];
  let hadSettings = false;

  async function makeExec(tag: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SALES_EXECUTIVE' } });
    const user = await prisma.user.create({
      data: {
        companyId,
        employeeCode: `T018-${tag}-${run}`,
        email: `t018-${tag}-${run}@example.test`,
        passwordHash: 'not-a-real-hash',
        fullName: `Test Seller ${tag}`,
        roleAssignments: { create: { roleId: role.id, scopeType: 'GLOBAL' } },
      },
    });
    userIds.push(user.id);
    return (await loadPrincipal(user.id))!;
  }

  beforeAll(async () => {
    const acs = await prisma.company.findFirstOrThrow({ where: { code: 'ACS' } });
    companyId = acs.id;
    hadSettings = !!(await prisma.salesSettings.findUnique({ where: { companyId } }));
    const directorUser = await prisma.user.findFirstOrThrow({ where: { companyId, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'DIRECTOR' } } } } });
    const headUser = await prisma.user.findFirstOrThrow({ where: { companyId, status: 'ACTIVE', roleAssignments: { some: { role: { key: 'SALES_HEAD' } } } } });
    const engineerUser = await prisma.user.findFirstOrThrow({ where: { employeeCode: 'ACS-0065' } });
    director = (await loadPrincipal(directorUser.id))!;
    head = (await loadPrincipal(headUser.id))!;
    engineer = (await loadPrincipal(engineerUser.id))!;
    execA = await makeExec('A');
    execB = await makeExec('B');
  });

  afterAll(async () => {
    await prisma.salesDeal.deleteMany({ where: { companyId, title: { contains: run } } });
    await prisma.salesHistoryLine.deleteMany({ where: { companyId, OR: [{ ref: { contains: run } }, { accountName: { contains: run } }] } });
    await prisma.salesAccount.deleteMany({ where: { companyId, name: { contains: run } } });
    await prisma.salesItem.deleteMany({ where: { companyId, code: { contains: run } } });
    await prisma.notification.deleteMany({ where: { body: { contains: 'Test Seller' } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    if (!hadSettings) await prisma.salesSettings.deleteMany({ where: { companyId } });
    await prisma.salesActivity.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  // ---------------------------------------------------------------- roles

  it('gives the right people the right Sales permissions', () => {
    expect(execA.grants.map((g) => g.permission).sort()).toEqual(['sales.deal.manage', 'sales.deal.read']);
    expect(head.grants.map((g) => g.permission)).toContain('sales.deal.read.all');
    expect(head.grants.map((g) => g.permission)).not.toContain('sales.quote.approve');
    expect(director.grants.map((g) => g.permission)).toContain('sales.quote.approve');
  });

  it('keeps people without Sales out', async () => {
    await expect(listDeals(engineer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSalesDashboard(engineer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createDeal(engineer, { title: 'Nope', newAccountName: `X ${run}` })).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------------------------------------------------------------- settings

  it('lets only Directors change settings, and validates them', async () => {
    const valid = { ...DEFAULT_CONFIG, minMarginPct: 12, targetMarginPct: 20 };
    await expect(updateSalesSettings(head, valid)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSalesSettings(director, { ...valid, minMarginPct: 30 })).rejects.toBeInstanceOf(ZodError);
    await expect(updateSalesSettings(director, { ...valid, pricePriority: ['PURCHASE', 'PURCHASE'] })).rejects.toBeInstanceOf(ZodError);
    const saved = await updateSalesSettings(director, valid);
    expect(saved).toMatchObject({ minMarginPct: 12, targetMarginPct: 20, pricePriority: ['PURCHASE', 'PRICE_LIST', 'BOM_COST'] });
    expect((await getSalesSettings(execA)).gstPct).toBe(18);
  });

  // ---------------------------------------------------------------- catalogue

  let cpu: { id: string };
  let psu: { id: string };

  it('lets the Sales Head maintain the catalogue, not salespeople', async () => {
    await expect(createItem(execA, { code: `CPU-${run}`, name: 'PLC CPU' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createItem(head, { code: '', name: 'x' })).rejects.toBeInstanceOf(ZodError);
    cpu = await createItem(head, { code: `cpu-${run}`, name: 'PLC CPU 1214C', make: 'Siemens', category: 'PLC' });
    await expect(createItem(head, { code: `CPU-${run}`, name: 'Dup' })).rejects.toBeInstanceOf(DomainError);
    await expect(addPrice(execA, { itemId: cpu.id, source: 'PURCHASE', rate: 10, effectiveDate: iso(todayInIndia()) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addPrice(head, { itemId: cpu.id, source: 'PURCHASE', effectiveDate: iso(todayInIndia()) })).rejects.toBeInstanceOf(ZodError);
  });

  it('prices an item by source priority and freshness', async () => {
    const today = todayInIndia();
    await addPrice(head, { itemId: cpu.id, source: 'PRICE_LIST', listPrice: 40000, discountPct: 25, effectiveDate: iso(addDays(today, -5)) });
    await addPrice(head, { itemId: cpu.id, source: 'PURCHASE', rate: 28000, effectiveDate: iso(addDays(today, -200)) });
    let [row] = await listItems(execA, { q: `CPU-${run}` });
    expect(row!.price).toMatchObject({ source: 'PRICE_LIST', rate: 30000, stale: false });
    await addPrice(head, { itemId: cpu.id, source: 'PURCHASE', rate: 29000, effectiveDate: iso(addDays(today, -10)) });
    [row] = await listItems(execA, { q: `CPU-${run}` });
    expect(row!.price).toMatchObject({ source: 'PURCHASE', rate: 29000 });
  });

  it('imports a price list all-or-nothing', async () => {
    const bad = `item_code,item_name,source,rate\nPSU-${run},Power supply,purchase,abc\nNEW-${run},,purchase,100\n`;
    const failed = await importPrices(head, bad);
    expect(failed.imported).toBe(0);
    expect(failed.errors.map((e) => e.row)).toEqual([2, 3]);
    expect(await prisma.salesItem.count({ where: { companyId, code: `PSU-${run}` } })).toBe(0);

    const good = `Item Code,Item Name,Make,Source,List Price,Discount %,Date\nPSU-${run},"Power supply 24V, 5A",Siemens,price_list,"8,000",10,${iso(todayInIndia())}\nCPU-${run},,,bom,31000,,\n`;
    const ok = await importPrices(head, good.replace('Discount %', 'discount_pct'));
    expect(ok).toMatchObject({ imported: 2, itemsCreated: 1, errors: [] });
    psu = await prisma.salesItem.findUniqueOrThrow({ where: { companyId_code: { companyId, code: `PSU-${run}` } } });
    const [p] = await listItems(execA, { q: `PSU-${run}` });
    expect(p!.price).toMatchObject({ source: 'PRICE_LIST', rate: 7200 });
  });

  // ---------------------------------------------------------------- deals

  let dealA: { id: string; code: string; accountId: string };

  it('creates a deal with a new client and keeps it private to its owner', async () => {
    await expect(createDeal(execA, { title: 'x', newAccountName: `Acme ${run}` })).rejects.toBeInstanceOf(ZodError);
    await expect(createDeal(execA, { title: `Panel job ${run}` })).rejects.toBeInstanceOf(ZodError);
    dealA = await createDeal(execA, { title: `MCC + PLC panels ${run}`, newAccountName: `Acme Pharma ${run}`, value: 500000 });
    expect(dealA.code).toMatch(/^DL-\d{4,}$/);

    expect((await listDeals(execA)).map((d) => d.id)).toContain(dealA.id);
    expect((await listDeals(execB)).map((d) => d.id)).not.toContain(dealA.id);
    await expect(getDeal(execB, dealA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateDeal(execB, dealA.id, { title: 'Hijack' })).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDeal(head, dealA.id)).canEdit).toBe(true);
    expect((await listDeals(director)).map((d) => d.id)).toContain(dealA.id);
  });

  it('reuses an existing client by name and lets only the Head reassign deals', async () => {
    const second = await createDeal(execB, { title: `Spare PLC ${run}`, newAccountName: `ACME PHARMA ${run}` });
    expect(second.accountId).toBe(dealA.accountId);
    await expect(createDeal(execB, { title: `Gift ${run}`, accountId: dealA.accountId, ownerId: execA.userId })).rejects.toBeInstanceOf(DomainError);
    const given = await createDeal(head, { title: `Assigned ${run}`, accountId: dealA.accountId, ownerId: execB.userId });
    expect(given.ownerId).toBe(execB.userId);
  });

  it('moves stages and logs follow-ups', async () => {
    await moveStage(execA, dealA.id, 'QUALIFIED');
    await expect(moveStage(execA, dealA.id, 'WON')).rejects.toBeInstanceOf(ValidationError);
    await addActivity(execA, dealA.id, { type: 'CALL', note: 'Discussed panel count', dueAt: iso(todayInIndia()) });
    await expect(addActivity(execA, dealA.id, { type: 'CALL', note: '' })).rejects.toBeInstanceOf(ZodError);
    const deal = await getDeal(execA, dealA.id);
    expect(deal.stage).toBe('QUALIFIED');
    expect(deal.activities.map((a) => a.type)).toEqual(expect.arrayContaining(['STAGE', 'CALL']));
    const dash = await getSalesDashboard(execA);
    expect(dash.scope).toBe('mine');
    expect(dash.followUps.some((f) => f.deal.id === dealA.id)).toBe(true);
  });

  // ---------------------------------------------------------------- quotes

  let quoteId: string;

  it('builds a quote with lines at the latest price', async () => {
    await expect(createQuote(execB, dealA.id)).rejects.toBeInstanceOf(NotFoundError);
    const quote = await createQuote(execA, dealA.id);
    quoteId = quote.id;
    expect(quote.number).toMatch(/^Q-\d{4}-\d{4,}$/);
    expect(quote.status).toBe('DRAFT');

    const line = await addLine(execA, quoteId, { panel: 'PLC Panel', itemId: cpu.id, qty: 2, marginPct: 20 });
    expect(Number(line.unitCost)).toBe(29000);
    expect(line.costSource).toBe('PURCHASE');
    await addLine(execA, quoteId, { panel: 'PLC Panel', itemId: psu.id, qty: 1 });
    await addLine(execA, quoteId, { panel: 'MCC', description: 'Sheet-metal enclosure', unitCost: 40000, qty: 1, marginPct: 25 });
    await expect(addLine(execA, quoteId, { panel: 'MCC', qty: 1 })).rejects.toBeInstanceOf(ZodError);
    await expect(addLine(execB, quoteId, { panel: 'MCC', description: 'x', unitCost: 1, qty: 1 })).rejects.toBeInstanceOf(NotFoundError);

    const q = await getQuote(execA, quoteId);
    expect(q.lines).toHaveLength(3);
    expect(q.panels.map((p) => p.panel)).toEqual(['PLC Panel', 'MCC']);
    expect(q.totals.cost).toBe(29000 * 2 + 7200 + 40000);
    expect(q.flags.editable).toBe(true);
    expect((await getDeal(execA, dealA.id)).value).toBe(q.totals.net);
  });

  it('refreshes draft prices when the catalogue moves', async () => {
    await addPrice(head, { itemId: cpu.id, source: 'PURCHASE', rate: 31000, effectiveDate: iso(todayInIndia()) });
    expect((await getQuote(execA, quoteId)).flags.priceChanges).toBe(1);
    expect(await refreshPrices(execA, quoteId)).toBe(1);
    const q = await getQuote(execA, quoteId);
    expect(q.lines.find((l) => l.itemId === cpu.id)!.unitCost).toBe(31000);
    expect(q.flags.priceChanges).toBe(0);
  });

  it('sends a below-margin quote to a Director', async () => {
    await applyMargin(execA, quoteId, 8);
    await updateQuoteTerms(execA, quoteId, { discountPct: 2, freight: 5000, validUntil: iso(addDays(todayInIndia(), 30)), terms: 'Test terms', showLineItems: true });
    const submitted = await submitQuote(execA, quoteId);
    expect(submitted.status).toBe('PENDING_APPROVAL');
    expect(await prisma.notification.count({ where: { userId: director.userId, link: `/sales/quotes/${quoteId}` } })).toBeGreaterThan(0);

    await expect(updateLine(execA, (await getQuote(execA, quoteId)).lines[0]!.id, { qty: 3 })).rejects.toBeInstanceOf(DomainError);
    await expect(markQuoteSent(execA, quoteId)).rejects.toBeInstanceOf(DomainError);
    await expect(approveQuote(execA, quoteId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveQuote(head, quoteId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendBackQuote(director, quoteId, '')).rejects.toBeInstanceOf(ValidationError);

    const back = await sendBackQuote(director, quoteId, 'Hold 12% on the CPU');
    expect(back).toMatchObject({ status: 'DRAFT', approvalNote: 'Hold 12% on the CPU' });
    await submitQuote(execA, quoteId);
    const approved = await approveQuote(director, quoteId, 'OK for this client');
    expect(approved).toMatchObject({ status: 'APPROVED', approvedById: director.userId });
  });

  it('marks a quote sent, moves the deal to Quoted and schedules a follow-up', async () => {
    await markQuoteSent(execA, quoteId);
    const deal = await getDeal(execA, dealA.id);
    expect(deal.stage).toBe('QUOTED');
    expect(deal.quotes[0]!.status).toBe('SENT');
    expect(deal.activities.some((a) => a.type === 'FOLLOW_UP' && a.dueAt && !a.doneAt)).toBe(true);
  });

  it('revises a sent quote into a new draft revision', async () => {
    const r2 = await reviseQuote(execA, quoteId);
    expect(r2).toMatchObject({ revision: 2, status: 'DRAFT' });
    expect((await getQuote(execA, quoteId)).status).toBe('SUPERSEDED');
    await expect(reviseQuote(execA, quoteId)).rejects.toBeInstanceOf(DomainError);
    await applyMargin(execA, r2.id, 22);
    expect((await submitQuote(execA, r2.id)).status).toBe('APPROVED');
    quoteId = r2.id;
  });

  it('closes a won deal: quote accepted, final prices into history', async () => {
    await expect(closeDeal(execA, dealA.id, { outcome: 'LOST' })).rejects.toBeInstanceOf(ZodError);
    await closeDeal(execA, dealA.id, { outcome: 'WON', erpSalesOrder: `SO-${run}`, woNumber: `WO-${run}` });
    const deal = await getDeal(execA, dealA.id);
    expect(deal).toMatchObject({ stage: 'WON', erpSalesOrder: `SO-${run}` });
    expect(deal.quotes.find((q) => q.id === quoteId)!.status).toBe('ACCEPTED');
    const history = await prisma.salesHistoryLine.findMany({ where: { companyId, source: 'DEAL', accountId: dealA.accountId } });
    expect(history).toHaveLength(3);
    const cpuLine = history.find((h) => h.itemCode === `CPU-${run}`)!;
    expect(Number(cpuLine.unitPrice)).toBeCloseTo((31000 / 0.78) * 0.98, 0);
    await expect(closeDeal(execA, dealA.id, { outcome: 'WON' })).rejects.toBeInstanceOf(DomainError);
  });

  // ---------------------------------------------------------------- accounts

  it('lets the Head, not salespeople, set relationship factors', async () => {
    await expect(updateRelationship(execA, dealA.accountId, { strategic: true })).rejects.toBeInstanceOf(ForbiddenError);
    await updateRelationship(head, dealA.accountId, { strategic: true, paymentDelayDays: 10, customerSince: '2019-04-01' });
    const acc = await getAccount(execA, dealA.accountId);
    expect(acc.relationship.profile.tier).toBe('STRATEGIC');
    expect(acc.relationship.stats.wonOrders).toBe(1);
    expect(acc.deals.every((d) => d.ownerId === execA.userId)).toBe(true);
    const list = await listAccounts(execB, { q: run });
    expect(list.find((a) => a.id === dealA.accountId)).toMatchObject({ strategic: true, wonOrders: 1 });
    await expect(createAccount(execA, { name: `acme pharma ${run}` })).rejects.toBeInstanceOf(DomainError);
  });

  // ---------------------------------------------------------------- history + advice

  it('imports past quotes all-or-nothing, refuses duplicates and can be undone', async () => {
    await expect(importHistory(execA, 'ref\n1')).rejects.toBeInstanceOf(ForbiddenError);
    const bad = await importHistory(head, `ref,date,client,outcome,amount\nH1-${run},2025-13-01,Old Co ${run},won,100\nH2-${run},2025-01-01,Old Co ${run},maybe,100\n`);
    expect(bad.errors.map((e) => e.row)).toEqual([2, 3]);

    const lines: string[] = ['ref,date,client,outcome,item_code,description,qty,unit_cost,unit_price'];
    for (let i = 1; i <= 4; i++) {
      lines.push(`H${i}-${run},2025-0${i}-10,Beta Foods ${run},won,CPU-${run},CPU,1,30000,37500`);
      lines.push(`H${i}-${run},2025-0${i}-10,Beta Foods ${run},won,PSU-${run},PSU,1,7000,8750`);
      lines.push(`H${i}-${run},2025-0${i}-10,Beta Foods ${run},won,HMI-${run},HMI 7in,1,20000,25000`);
    }
    const ok = await importHistory(head, lines.join('\n'));
    expect(ok).toMatchObject({ lines: 12, refs: 4, accountsCreated: 1, errors: [] });
    expect((await importHistory(head, lines.join('\n'))).errors[0]!.message).toContain('imported before');
    const imports = await listHistoryImports(head);
    expect(imports.imports.some((b) => b.batchId === ok.batchId)).toBe(true);

    const scratch = await importHistory(head, `ref,date,client,outcome,amount\nTMP-${run},2025-01-01,Temp ${run},lost,100\n`);
    expect(await deleteHistoryImport(head, scratch.batchId!)).toBe(1);
  });

  it('advises margin, per-line price moves and items to add', async () => {
    const beta = await prisma.salesAccount.findFirstOrThrow({ where: { companyId, name: `Beta Foods ${run}` } });
    const deal = await createDeal(execB, { title: `Beta line 2 ${run}`, accountId: beta.id });
    const quote = await createQuote(execB, deal.id);
    await addLine(execB, quote.id, { panel: 'PLC', itemId: cpu.id, qty: 1, marginPct: 5 });

    const insights = await getQuoteInsights(execB, quote.id);
    expect(insights.relationship.wonOrders).toBe(4);
    expect(insights.margin.reasons).toContainEqual({ label: '3 repeat orders', deltaPct: -0.5 });
    expect(insights.lineAdvice).toHaveLength(1);
    expect(insights.lineAdvice[0]).toMatchObject({ direction: 'RAISE', toMarginPct: 20 });
    const codes = insights.bomSuggestions.map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining([`PSU-${run}`, `HMI-${run}`]));
    expect(insights.bomSuggestions.find((s) => s.code === `PSU-${run}`)!.itemId).toBe(psu.id);
    expect(insights.bomSuggestions.find((s) => s.code === `HMI-${run}`)!.itemId).toBeNull();

    await expect(getQuoteInsights(execA, quote.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('gives the Head a team dashboard', async () => {
    const dash = await getSalesDashboard(head);
    expect(dash.scope).toBe('team');
    expect(dash.team.some((t) => t.ownerId === execB.userId)).toBe(true);
    expect(dash.kpis.openDeals).toBeGreaterThan(0);
  });
});
