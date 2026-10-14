import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/core/db/prisma';
import { ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { makeErpCompany } from './test-fixture';
import { createParty } from './services/party.service';
import { addIncomeLine, createSalesInvoice, incomeAccounts, makeCreditNote, submitSalesInvoice } from './services/sales-invoice.service';
import { addExpenseLine, createPurchaseInvoice, expenseAccounts, submitPurchaseInvoice } from './services/purchase-invoice.service';
import { createPayment, paymentAccounts, submitPayment } from './services/payment.service';
import { accountsOverview, ageing, balanceSheet, generalLedger, gstSummary, profitAndLoss, projectProfitability, trialBalance } from './services/reports.service';
import { closeFiscalYear } from './services/ledger.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const range = { from: day('2025-04-01'), to: day('2026-09-30') };

describe('Plan 022 phase 7b: financial reports', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let acc: Principal;
  let engineer: Principal;
  let customerId: string;
  let projectId: string;

  beforeAll(async () => {
    fx = await makeErpCompany('RPT');
    acc = await fx.user('ACCOUNTS_MANAGER', 'Accounts');
    engineer = await fx.user('JUNIOR_ENGINEER', 'Engineer');
    await accountsOverview(acc, day('2026-06-01')); // sets the company's ERP up
    await prisma.erpSettings.update({ where: { companyId: fx.companyId }, data: { companyState: 'Gujarat' } });
    customerId = (await createParty(await fx.user('SALES_HEAD', 'Sales'), 'CUSTOMER', { name: `Adani ${fx.run}`, state: 'Gujarat' })).id;
    const buyer = await fx.user('PURCHASE_MANAGER', 'Buyer');
    const supplierId = (await createParty(buyer, 'SUPPLIER', { name: `Siemens ${fx.run}`, state: 'Maharashtra' })).id;
    projectId = (await prisma.project.create({ data: { companyId: fx.companyId, code: `R-${fx.run}`, name: 'Boiler panels', clientName: 'Adani', managerId: acc.userId } })).id;
    const income = (await incomeAccounts(fx.companyId)).find((a) => a.name === 'Service Income')!.id;
    const expense = (await expenseAccounts(fx.companyId)).find((a) => a.name === 'Professional Fees')!.id;
    const bank = (await paymentAccounts(fx.companyId)).find((a) => a.name === 'Bank')!.id;

    // FY 2025-26: one invoice of 1,000 (closed into retained earnings).
    const old = await createSalesInvoice(acc, customerId, { postingDate: '2026-02-10' });
    await addIncomeLine(acc, old.id, { description: 'AMC', accountId: income, qty: '1', rate: '1000', gstRate: '18' });
    await submitSalesInvoice(acc, old.id);
    await closeFiscalYear(acc, day('2025-12-01'));

    // FY 2026-27: invoice 10,000 (intra-state, project), credit note 2,000, bill 4,000 (inter-state, project), receipt 5,000.
    const si = await createSalesInvoice(acc, customerId, { postingDate: '2026-05-01', dueDate: '2026-05-15' });
    await prisma.erpSalesInvoice.update({ where: { id: si.id }, data: { projectId } });
    await addIncomeLine(acc, si.id, { description: 'Commissioning', accountId: income, qty: '1', rate: '10000', gstRate: '18' });
    await submitSalesInvoice(acc, si.id);
    const cn = await makeCreditNote(acc, si.id, day('2026-05-20'));
    await prisma.erpSalesInvoiceLine.updateMany({ where: { invoiceId: cn.id }, data: { rate: 2000, amount: 2000 } });
    await submitSalesInvoice(acc, cn.id);
    const pi = await createPurchaseInvoice(buyer, supplierId, { postingDate: '2026-05-05', billNo: 'SIE-1' });
    await prisma.erpPurchaseInvoice.update({ where: { id: pi.id }, data: { projectId } });
    await addExpenseLine(buyer, pi.id, { description: 'Programming support', accountId: expense, qty: '1', rate: '4000', gstRate: '18' });
    await submitPurchaseInvoice(buyer, pi.id);
    const pay = await createPayment(acc, { paymentType: 'RECEIVE', postingDate: '2026-06-01', partyType: 'CUSTOMER', partyId: customerId, accountId: bank, amount: '5000' });
    await submitPayment(acc, pay.id);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('denies people without accounts access', async () => {
    await expect(trialBalance(engineer, range)).rejects.toThrow(ForbiddenError);
    await expect(profitAndLoss(engineer, range)).rejects.toThrow(ForbiddenError);
  });

  it('trial balance balances', async () => {
    const tb = await trialBalance(acc, { from: day('2026-04-01'), to: day('2026-09-30') });
    expect(tb.totals[0]!.toFixed(2)).toBe(tb.totals[1]!.toFixed(2));
    expect(tb.totals[2]!.toFixed(2)).toBe(tb.totals[3]!.toFixed(2));
    expect(tb.totals[4]!.toFixed(2)).toBe(tb.totals[5]!.toFixed(2));
  });

  it('profit and loss for the year nets returns and ignores the closing voucher', async () => {
    const pl = await profitAndLoss(acc, { from: day('2026-04-01'), to: day('2027-03-31') });
    expect(pl.totalIncome.toFixed(2)).toBe('8000.00');
    expect(pl.totalExpense.toFixed(2)).toBe('4000.00');
    expect(pl.netProfit.toFixed(2)).toBe('4000.00');
    const last = await profitAndLoss(acc, { from: day('2025-04-01'), to: day('2026-03-31') });
    expect(last.netProfit.toFixed(2)).toBe('1000.00');
  });

  it('balance sheet balances, with last year in retained earnings and this year unclosed', async () => {
    const bs = await balanceSheet(acc, day('2026-09-30'));
    expect(bs.difference.toFixed(2)).toBe('0.00');
    expect(bs.unclosedProfit.toFixed(2)).toBe('4000.00');
    expect(bs.equity.find((r) => r.account.systemKey === 'RETAINED_EARNINGS')?.values[0]?.toFixed(2)).toBe('1000.00');
  });

  it('general ledger runs a balance per party', async () => {
    const gl = await generalLedger(acc, { ...range, partyType: 'CUSTOMER', partyId: customerId });
    // 1,180 + 11,800 − 2,360 − 5,000
    expect(gl.closing.toFixed(2)).toBe('5620.00');
    expect(gl.lines.at(-1)!.balance.toFixed(2)).toBe('5620.00');
  });

  it('receivable ageing shows open invoices and unused advances', async () => {
    const ar = await ageing(acc, 'RECEIVABLE', day('2026-07-01'));
    const row = ar.rows.find((r) => r.partyId === customerId)!;
    // 1,180 (last year) + 11,800 − 2,360 credit note; the 5,000 receipt was not allocated, so it is an advance.
    expect(row.total.toFixed(2)).toBe('10620.00');
    expect(row.credit.toFixed(2)).toBe('5000.00');
    expect(row.net.toFixed(2)).toBe('5620.00');
    expect(row.buckets[2]!.toFixed(2)).toBe('9440.00');
    const ap = await ageing(acc, 'PAYABLE', day('2026-07-01'));
    expect(ap.total.toFixed(2)).toBe('4720.00');
  });

  it('GST summary nets credit notes; intra-state is CGST+SGST, inter-state IGST', async () => {
    const g = await gstSummary(acc, { from: day('2026-04-01'), to: day('2026-09-30') });
    expect(g.output.taxable.toFixed(2)).toBe('8000.00');
    expect(g.output.cgst.toFixed(2)).toBe('720.00');
    expect(g.output.igst.toFixed(2)).toBe('0.00');
    expect(g.input.igst.toFixed(2)).toBe('720.00');
    expect(g.netPayable.toFixed(2)).toBe('720.00');
    expect(g.output.byRate).toEqual([{ rate: '18.00', taxable: expect.anything() }]);
  });

  it('project profitability from GL rows tagged with the project', async () => {
    const rows = await projectProfitability(acc, { from: day('2026-04-01'), to: day('2026-09-30') });
    const r = rows.find((x) => x.project.id === projectId)!;
    expect(r.income.toFixed(2)).toBe('8000.00');
    expect(r.cost.toFixed(2)).toBe('4000.00');
    expect(r.margin?.toFixed(1)).toBe('50.0');
  });

  it('overview figures', async () => {
    const o = await accountsOverview(acc, day('2026-07-01'));
    expect(o.receivable.toFixed(2)).toBe('10620.00');
    expect(o.payable.toFixed(2)).toBe('4720.00');
    expect(o.banks.find((b) => b.name === 'Bank')?.balance.toFixed(2)).toBe('5000.00');
  });
});
