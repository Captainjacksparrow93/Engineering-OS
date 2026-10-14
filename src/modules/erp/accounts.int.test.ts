import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { DomainError, ForbiddenError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { makeErpCompany } from './test-fixture';
import { createParty } from './services/party.service';
import { addIncomeLine, cancelSalesInvoice, createSalesInvoice, getSalesInvoice, incomeAccounts, makeCreditNote, submitSalesInvoice, updateSalesInvoiceLine } from './services/sales-invoice.service';
import { addExpenseLine, createPurchaseInvoice, expenseAccounts, getPurchaseInvoice, makeDebitNote, submitPurchaseInvoice } from './services/purchase-invoice.service';
import { addAllocation, allocateOutstanding, cancelPayment, createPayment, createPaymentForInvoice, getPayment, paymentAccounts, reconcileAdvance, submitPayment } from './services/payment.service';
import { addJournalLine, cancelJournal, createJournal, getJournal, postingAccounts, submitJournal } from './services/journal.service';
import { bankReconciliation, closeFiscalYear, createAccount, reopenFiscalYear, setAccountActive, setBooksLock, setClearance } from './services/ledger.service';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('Plan 022 phase 7a: accounts', () => {
  let fx: Awaited<ReturnType<typeof makeErpCompany>>;
  let acc: Principal;
  let sales: Principal;
  let buyer: Principal;
  let store: Principal;
  let customerId: string;
  let supplierId: string;
  let bankId: string;
  let cashId: string;
  let incomeId: string;
  let expenseId: string;

  async function balanced() {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId }, _sum: { debit: true, credit: true } });
    return agg._sum.debit?.toFixed(2) === agg._sum.credit?.toFixed(2);
  }
  async function balance(where: Prisma.ErpGlEntryWhereInput) {
    const agg = await prisma.erpGlEntry.aggregate({ where: { companyId: fx.companyId, isCancelled: false, ...where }, _sum: { debit: true, credit: true } });
    return (agg._sum.debit ?? new Prisma.Decimal(0)).minus(agg._sum.credit ?? 0).toFixed(2);
  }
  const outstandingSi = async (id: string) => (await prisma.erpSalesInvoice.findUniqueOrThrow({ where: { id } })).outstandingAmount.toFixed(2);
  const outstandingPi = async (id: string) => (await prisma.erpPurchaseInvoice.findUniqueOrThrow({ where: { id } })).outstandingAmount.toFixed(2);

  async function salesInvoice(amount: string, date = '2026-05-10') {
    const inv = await createSalesInvoice(sales, customerId, { postingDate: date });
    await addIncomeLine(sales, inv.id, { description: 'Commissioning visit', accountId: incomeId, qty: '1', rate: amount, gstRate: '18' });
    await submitSalesInvoice(sales, inv.id);
    return inv.id;
  }
  async function purchaseInvoice(amount: string, date = '2026-05-10') {
    const inv = await createPurchaseInvoice(buyer, supplierId, { postingDate: date, billNo: `B-${Math.random().toString(36).slice(2, 7)}` });
    await addExpenseLine(buyer, inv.id, { description: 'Calibration service', accountId: expenseId, qty: '1', rate: amount, gstRate: '18' });
    await submitPurchaseInvoice(buyer, inv.id);
    return inv.id;
  }

  beforeAll(async () => {
    fx = await makeErpCompany('ACC');
    acc = await fx.user('ACCOUNTS_MANAGER', 'Accounts');
    sales = await fx.user('SALES_HEAD', 'Sales');
    buyer = await fx.user('PURCHASE_MANAGER', 'Buyer');
    store = await fx.user('STORE_KEEPER', 'Store');
    customerId = (await createParty(sales, 'CUSTOMER', { name: `Tata ${fx.run}` })).id;
    supplierId = (await createParty(buyer, 'SUPPLIER', { name: `Fluke ${fx.run}` })).id;
    const banks = await paymentAccounts(fx.companyId);
    bankId = banks.find((a) => a.name === 'Bank')!.id;
    cashId = banks.find((a) => a.name === 'Cash')!.id;
    incomeId = (await incomeAccounts(fx.companyId)).find((a) => a.name === 'Service Income')!.id;
    expenseId = (await expenseAccounts(fx.companyId)).find((a) => a.name === 'Professional Fees')!.id;
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('receives a payment against an invoice; cancel restores it', async () => {
    const si = await salesInvoice('10000');
    expect(await outstandingSi(si)).toBe('11800.00');
    await expect(createPaymentForInvoice(store, 'Sales Invoice', si, day('2026-05-20'))).rejects.toThrow(ForbiddenError);
    const pay = await createPaymentForInvoice(acc, 'Sales Invoice', si, day('2026-05-20'));
    expect(pay.paymentType).toBe('RECEIVE');
    await submitPayment(acc, pay.id);
    expect(await outstandingSi(si)).toBe('0.00');
    expect(await balance({ accountId: bankId })).toBe('11800.00');
    expect(await balance({ account: { systemKey: 'DEBTORS' }, partyId: customerId })).toBe('0.00');
    await expect(cancelSalesInvoice(sales, si)).rejects.toThrow(/payments or credit notes/);
    await cancelPayment(acc, pay.id);
    expect(await outstandingSi(si)).toBe('11800.00');
    expect(await balance({ accountId: bankId })).toBe('0.00');
    expect(await balanced()).toBe(true);
  });

  it('validation and party rules on payments', async () => {
    await expect(createPayment(acc, { paymentType: 'RECEIVE', postingDate: '2026-05-21', accountId: bankId, amount: '100' })).rejects.toThrow(ZodError);
    await expect(createPayment(acc, { paymentType: 'RECEIVE', postingDate: '2026-05-21', partyType: 'CUSTOMER', partyId: customerId, accountId: incomeId, amount: '100' })).rejects.toThrow(/bank or cash/);
    await expect(createPayment(acc, { paymentType: 'INTERNAL_TRANSFER', postingDate: '2026-05-21', accountId: bankId, transferToAccountId: bankId, amount: '100' })).rejects.toThrow(ZodError);
    const pi = await purchaseInvoice('5000');
    const pay = await createPayment(acc, { paymentType: 'RECEIVE', postingDate: '2026-05-21', partyType: 'CUSTOMER', partyId: customerId, accountId: bankId, amount: '100' });
    await expect(addAllocation(acc, pay.id, { invoiceId: pi, amount: '100' })).rejects.toThrow(/not found/);
  });

  it('advances: pay a supplier ahead, reconcile against the bill later', async () => {
    const adv = await createPayment(acc, { paymentType: 'PAY', postingDate: '2026-05-01', partyType: 'SUPPLIER', partyId: supplierId, accountId: bankId, amount: '3000', referenceNo: 'UTR123' });
    await submitPayment(acc, adv.id);
    expect((await prisma.erpPayment.findUniqueOrThrow({ where: { id: adv.id } })).unallocatedAmount.toFixed(2)).toBe('3000.00');
    const pi = await purchaseInvoice('2000');
    await expect(reconcileAdvance(acc, adv.id, { invoiceId: pi, amount: '3000' }, day('2026-05-12'))).rejects.toThrow(DomainError);
    await reconcileAdvance(acc, adv.id, { invoiceId: pi, amount: '2360' }, day('2026-05-12'));
    expect(await outstandingPi(pi)).toBe('0.00');
    const { pay, gl } = await getPayment(acc, adv.id);
    expect(pay.unallocatedAmount.toFixed(2)).toBe('640.00');
    expect(gl.some((g) => g.voucherType === 'Payment Reconciliation')).toBe(true);
    expect(await balanced()).toBe(true);
    await cancelPayment(acc, adv.id);
    expect(await outstandingPi(pi)).toBe('2360.00');
    expect(await balanced()).toBe(true);
  });

  it('auto-allocates oldest first; internal transfer moves bank to cash', async () => {
    const a = await salesInvoice('1000', '2026-04-05');
    const b = await salesInvoice('2000', '2026-04-06');
    const pay = await createPayment(acc, { paymentType: 'RECEIVE', postingDate: '2026-05-25', partyType: 'CUSTOMER', partyId: customerId, accountId: bankId, amount: '2000' });
    await allocateOutstanding(acc, pay.id);
    await submitPayment(acc, pay.id);
    expect(await outstandingSi(a)).toBe('0.00');
    expect(await outstandingSi(b)).toBe('1540.00');
    const t = await createPayment(acc, { paymentType: 'INTERNAL_TRANSFER', postingDate: '2026-05-26', accountId: bankId, transferToAccountId: cashId, amount: '500' });
    await submitPayment(acc, t.id);
    expect(await balance({ accountId: cashId })).toBe('500.00');
    expect(await balanced()).toBe(true);
  });

  it('credit note settles the invoice; debit note settles the bill; both cancel cleanly', async () => {
    const si = await salesInvoice('5000');
    const cn = await makeCreditNote(sales, si, day('2026-05-28'));
    const { inv } = await getSalesInvoice(sales, cn.id);
    await updateSalesInvoiceLine(sales, cn.id, inv.lines[0]!.id, { qty: '1', rate: '1000' });
    await submitSalesInvoice(sales, cn.id);
    expect(await outstandingSi(si)).toBe('4720.00');
    expect(await balance({ voucherId: cn.id, account: { systemKey: 'OUTPUT_CGST' } })).toBe('90.00');
    await expect(cancelSalesInvoice(sales, si)).rejects.toThrow(/credit notes/);
    const big = await makeCreditNote(sales, si, day('2026-05-28'));
    const bigLines = (await getSalesInvoice(sales, big.id)).inv.lines;
    await updateSalesInvoiceLine(sales, big.id, bigLines[0]!.id, { qty: '1', rate: '4500' });
    await expect(submitSalesInvoice(sales, big.id)).rejects.toThrow(/more than the invoice/);
    await cancelSalesInvoice(sales, cn.id);
    expect(await outstandingSi(si)).toBe('5900.00');

    const pi = await purchaseInvoice('4000');
    const dn = await makeDebitNote(buyer, pi, day('2026-05-28'));
    await submitPurchaseInvoice(buyer, dn.id);
    expect(await outstandingPi(pi)).toBe('0.00');
    expect((await getPurchaseInvoice(buyer, dn.id)).inv.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(await balance({ voucherId: dn.id, accountId: expenseId })).toBe('-4000.00');
    expect(await balanced()).toBe(true);
  });

  it('journal entries: balanced, party rules, settle an invoice, cancel', async () => {
    const si = await salesInvoice('1000');
    const accounts = await postingAccounts(fx.companyId);
    const debtors = accounts.find((a) => a.name === 'Debtors')!.id;
    const writeOff = accounts.find((a) => a.name === 'Write Off')!.id;
    await expect(createJournal(store, { postingDate: '2026-05-30' })).rejects.toThrow(ForbiddenError);
    const je = await createJournal(acc, { postingDate: '2026-05-30', remarks: 'Short payment written off' });
    await expect(addJournalLine(acc, je.id, { accountId: debtors, credit: '100' })).rejects.toThrow(/needs a customer/);
    await expect(addJournalLine(acc, je.id, { accountId: writeOff, debit: '100', credit: '100' })).rejects.toThrow(ZodError);
    await addJournalLine(acc, je.id, { accountId: writeOff, debit: '180' });
    await expect(submitJournal(acc, je.id)).rejects.toThrow(/at least two lines/);
    const number = (await prisma.erpSalesInvoice.findUniqueOrThrow({ where: { id: si } })).number;
    await addJournalLine(acc, je.id, { accountId: debtors, partyType: 'CUSTOMER', partyId: customerId, credit: '100', againstInvoiceNo: number });
    await expect(submitJournal(acc, je.id)).rejects.toThrow(/must be equal/);
    await addJournalLine(acc, je.id, { accountId: debtors, partyType: 'CUSTOMER', partyId: customerId, credit: '80' });
    await submitJournal(acc, je.id);
    expect(await outstandingSi(si)).toBe('1080.00');
    expect((await getJournal(acc, je.id)).gl).toHaveLength(3);
    await cancelJournal(acc, je.id);
    expect(await outstandingSi(si)).toBe('1180.00');
    expect(await balanced()).toBe(true);
  });

  it('bank reconciliation: uncleared items explain the difference', async () => {
    const pay = await createPayment(acc, { paymentType: 'RECEIVE', postingDate: '2026-06-02', partyType: 'CUSTOMER', partyId: customerId, accountId: bankId, amount: '700' });
    await submitPayment(acc, pay.id);
    const before = await bankReconciliation(acc, bankId, day('2026-06-01'), day('2026-06-30'), false);
    expect(before.lines.some((l) => l.id === pay.id)).toBe(true);
    await expect(setClearance(acc, 'payment', pay.id, '2026-05-01')).rejects.toThrow(/before it was posted/);
    await setClearance(acc, 'payment', pay.id, '2026-06-03');
    const after = await bankReconciliation(acc, bankId, day('2026-06-01'), day('2026-06-30'), false);
    expect(after.lines.some((l) => l.id === pay.id)).toBe(false);
    expect(D(after.bankBalance).minus(D(before.bankBalance)).toFixed(2)).toBe('700.00');
  });

  it('chart of accounts: add, rename, switch off', async () => {
    const group = (await prisma.erpAccount.findFirstOrThrow({ where: { companyId: fx.companyId, code: '1120' } })).id;
    await expect(createAccount(store, { parentId: group, code: '1122', name: 'HDFC Current' })).rejects.toThrow(ForbiddenError);
    await expect(createAccount(acc, { parentId: group, code: '1121', name: 'Dup' })).rejects.toThrow(/taken/);
    const hdfc = await createAccount(acc, { parentId: group, code: '1122', name: 'HDFC Current', accountType: 'BANK' });
    expect(hdfc.rootType).toBe('ASSET');
    expect((await paymentAccounts(fx.companyId)).some((a) => a.id === hdfc.id)).toBe(true);
    await expect(setAccountActive(acc, bankId, false)).rejects.toThrow(/posting engine/);
    await setAccountActive(acc, hdfc.id, false);
  });

  it('closes a fiscal year into retained earnings and locks the books; re-open reverses', async () => {
    await expect(closeFiscalYear(acc, day('2027-01-01'))).rejects.toThrow(/hasn't ended/);
    // A 2025-26 invoice so the year has a profit.
    await salesInvoice('2500', '2026-03-15');
    const pcv = await closeFiscalYear(acc, day('2025-06-01'));
    expect(pcv.netProfit.toFixed(2)).toBe('2500.00');
    expect(await balance({ account: { systemKey: 'RETAINED_EARNINGS' } })).toBe('-2500.00');
    await expect(salesInvoice('10', '2026-03-20')).rejects.toThrow(/books are closed/);
    await expect(closeFiscalYear(acc, day('2025-06-01'))).rejects.toThrow(/already closed/);
    await expect(setBooksLock(acc, '2026-01-01')).rejects.toThrow(/can't be earlier/);
    await reopenFiscalYear(acc, pcv.id);
    expect(await balance({ account: { systemKey: 'RETAINED_EARNINGS' } })).toBe('0.00');
    expect((await prisma.erpSettings.findUniqueOrThrow({ where: { companyId: fx.companyId } })).booksClosedUpTo).toBeNull();
    expect(await balanced()).toBe(true);
  });
});

function D(v: Prisma.Decimal.Value) {
  return new Prisma.Decimal(v);
}
