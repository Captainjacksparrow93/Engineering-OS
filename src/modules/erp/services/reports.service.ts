import type { ErpAccount, ErpPartyType, Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { fiscalYear } from '../domain/chart';
import { D, type Dec, money, sum, ZERO } from '../domain/money';
import { readArea } from './access';
import { CLOSING } from './ledger.service';
import type { Principal } from '@/core/rbac/types';

/**
 * Financial reports (ERPNext Accounts reports), all read from the general ledger with
 * cancelled rows skipped: General Ledger, Trial Balance, Profit and Loss, Balance Sheet,
 * receivable/payable ageing, GST summary and project profitability.
 */

type Range = { from: Date; to: Date };
const live = { isCancelled: false } as const;

async function chart(companyId: string) {
  return prisma.erpAccount.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
}

async function sums(companyId: string, where: Prisma.ErpGlEntryWhereInput) {
  const rows = await prisma.erpGlEntry.groupBy({ by: ['accountId'], where: { companyId, ...live, ...where }, _sum: { debit: true, credit: true } });
  return new Map(rows.map((r) => [r.accountId, { debit: D(r._sum.debit), credit: D(r._sum.credit) }]));
}

export interface TreeRow {
  account: ErpAccount;
  depth: number;
  values: Dec[];
}

/** Accounts in tree order with each value rolled up into its groups; empty branches dropped. */
function rollUp(accounts: ErpAccount[], leaf: (a: ErpAccount) => Dec[], width: number, keep: (a: ErpAccount) => boolean): TreeRow[] {
  const children = new Map<string | null, ErpAccount[]>();
  for (const a of accounts) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const out: TreeRow[] = [];
  const walk = (a: ErpAccount, depth: number): Dec[] => {
    const at = out.length;
    out.push({ account: a, depth, values: [] });
    let values = a.isGroup ? Array.from({ length: width }, () => ZERO) : leaf(a);
    for (const c of children.get(a.id) ?? []) {
      if (!keep(c)) continue;
      const v = walk(c, depth + 1);
      if (a.isGroup) values = values.map((x, i) => x.plus(v[i]!));
    }
    out[at]!.values = values;
    return values;
  };
  for (const root of children.get(null) ?? []) if (keep(root)) walk(root, 0);
  return out.filter((r) => r.values.some((v) => !v.isZero()));
}

// ---------------------------------------------------------------- trial balance

export async function trialBalance(p: Principal, r: Range) {
  await readArea(p, 'accounts');
  const [accounts, opening, period] = await Promise.all([chart(p.companyId), sums(p.companyId, { postingDate: { lt: r.from } }), sums(p.companyId, { postingDate: { gte: r.from, lte: r.to } })]);
  const rows = rollUp(
    accounts,
    (a) => {
      const o = opening.get(a.id);
      const m = period.get(a.id);
      const ob = o ? o.debit.minus(o.credit) : ZERO;
      const dr = m?.debit ?? ZERO;
      const cr = m?.credit ?? ZERO;
      const cb = ob.plus(dr).minus(cr);
      return [ob.greaterThan(0) ? ob : ZERO, ob.lessThan(0) ? ob.negated() : ZERO, dr, cr, cb.greaterThan(0) ? cb : ZERO, cb.lessThan(0) ? cb.negated() : ZERO];
    },
    6,
    () => true,
  );
  const leaves = rows.filter((x) => !x.account.isGroup);
  const totals = [0, 1, 2, 3, 4, 5].map((i) => sum(leaves, (x) => x.values[i]));
  return { rows, totals };
}

// ---------------------------------------------------------------- P&L and balance sheet

export async function profitAndLoss(p: Principal, r: Range) {
  await readArea(p, 'accounts');
  const [accounts, period] = await Promise.all([chart(p.companyId), sums(p.companyId, { postingDate: { gte: r.from, lte: r.to }, voucherType: { not: CLOSING } })]);
  const leaf = (a: ErpAccount) => {
    const m = period.get(a.id);
    const net = m ? m.credit.minus(m.debit) : ZERO;
    return [a.rootType === 'INCOME' ? net : net.negated()];
  };
  const income = rollUp(accounts, leaf, 1, (a) => a.rootType === 'INCOME');
  const expense = rollUp(accounts, leaf, 1, (a) => a.rootType === 'EXPENSE');
  const totalIncome = income.find((x) => x.depth === 0)?.values[0] ?? ZERO;
  const totalExpense = expense.find((x) => x.depth === 0)?.values[0] ?? ZERO;
  return { income, expense, totalIncome, totalExpense, netProfit: totalIncome.minus(totalExpense) };
}

export async function balanceSheet(p: Principal, asOf: Date) {
  await readArea(p, 'accounts');
  const [accounts, upTo] = await Promise.all([chart(p.companyId), sums(p.companyId, { postingDate: { lte: asOf } })]);
  const leaf = (a: ErpAccount) => {
    const m = upTo.get(a.id);
    const net = m ? m.debit.minus(m.credit) : ZERO;
    return [a.rootType === 'ASSET' ? net : net.negated()];
  };
  const assets = rollUp(accounts, leaf, 1, (a) => a.rootType === 'ASSET');
  const liabilities = rollUp(accounts, leaf, 1, (a) => a.rootType === 'LIABILITY');
  const equity = rollUp(accounts, leaf, 1, (a) => a.rootType === 'EQUITY');
  // Profit not yet closed into Retained Earnings: income − expense to date (closed years net to nil).
  const pl = sum(
    accounts.filter((a) => a.rootType === 'INCOME' || a.rootType === 'EXPENSE'),
    (a) => {
      const m = upTo.get(a.id);
      return m ? m.credit.minus(m.debit) : ZERO;
    },
  );
  const top = (rows: TreeRow[]) => rows.find((x) => x.depth === 0)?.values[0] ?? ZERO;
  const totalAssets = top(assets);
  const totalLiabilities = top(liabilities);
  const totalEquity = top(equity).plus(pl);
  return { assets, liabilities, equity, unclosedProfit: pl, totalAssets, totalLiabilities, totalEquity, difference: totalAssets.minus(totalLiabilities).minus(totalEquity) };
}

// ---------------------------------------------------------------- general ledger

export async function generalLedger(p: Principal, f: Range & { accountId?: string | null; partyType?: ErpPartyType | null; partyId?: string | null; projectId?: string | null; voucherNo?: string | null }) {
  await readArea(p, 'accounts');
  const where: Prisma.ErpGlEntryWhereInput = {
    companyId: p.companyId,
    ...live,
    ...(f.accountId ? { accountId: f.accountId } : {}),
    ...(f.partyId ? { partyId: f.partyId, ...(f.partyType ? { partyType: f.partyType } : {}) } : {}),
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.voucherNo ? { voucherNo: { contains: f.voucherNo.trim().toUpperCase() } } : {}),
  };
  const [before, rows] = await Promise.all([
    prisma.erpGlEntry.aggregate({ where: { ...where, postingDate: { lt: f.from } }, _sum: { debit: true, credit: true } }),
    prisma.erpGlEntry.findMany({ where: { ...where, postingDate: { gte: f.from, lte: f.to } }, include: { account: { select: { code: true, name: true } } }, orderBy: [{ postingDate: 'asc' }, { createdAt: 'asc' }], take: 3000 }),
  ]);
  const parties = await prisma.erpParty.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.partyId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const party = new Map(parties.map((x) => [x.id, x.name]));
  const opening = D(before._sum.debit).minus(D(before._sum.credit));
  let running = opening;
  const lines = rows.map((r) => {
    running = running.plus(D(r.debit)).minus(D(r.credit));
    return { ...r, partyName: r.partyId ? party.get(r.partyId) ?? null : null, balance: running };
  });
  return { opening, lines, closing: running, debit: sum(rows, (r) => r.debit), credit: sum(rows, (r) => r.credit), truncated: rows.length === 3000 };
}

// ---------------------------------------------------------------- ageing

interface AgeDoc {
  id: string;
  number: string;
  partyId: string;
  postingDate: Date;
  dueDate: Date | null;
  outstandingAmount: Prisma.Decimal;
  isReturn: boolean;
}

export const AGEING_BUCKETS = ['Not due', '0–30', '31–60', '61–90', '90+'] as const;

/** Open invoices by party and days past due, with unused advances and credit notes. */
export async function ageing(p: Principal, kind: 'RECEIVABLE' | 'PAYABLE', today: Date) {
  await readArea(p, 'accounts');
  const where = { companyId: p.companyId, status: 'SUBMITTED' as const, outstandingAmount: { gt: 0 } };
  const docs: AgeDoc[] =
    kind === 'RECEIVABLE'
      ? (await prisma.erpSalesInvoice.findMany({ where, select: { id: true, number: true, customerId: true, postingDate: true, dueDate: true, outstandingAmount: true, isReturn: true } })).map(({ customerId, ...d }): AgeDoc => ({ ...d, partyId: customerId }))
      : (await prisma.erpPurchaseInvoice.findMany({ where, select: { id: true, number: true, supplierId: true, postingDate: true, dueDate: true, outstandingAmount: true, isReturn: true } })).map(({ supplierId, ...d }): AgeDoc => ({ ...d, partyId: supplierId }));
  const advances = await prisma.erpPayment.findMany({ where: { companyId: p.companyId, status: 'SUBMITTED', unallocatedAmount: { gt: 0 }, partyType: kind === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER', paymentType: kind === 'RECEIVABLE' ? 'RECEIVE' : 'PAY' }, select: { partyId: true, unallocatedAmount: true } });
  const parties = await prisma.erpParty.findMany({ where: { id: { in: [...new Set([...docs.map((d) => d.partyId), ...advances.map((a) => a.partyId!)])] } }, select: { id: true, name: true } });
  const byParty = new Map<string, { partyId: string; name: string; buckets: Dec[]; credit: Dec; invoices: AgeDoc[] }>();
  const row = (id: string) => {
    let r = byParty.get(id);
    if (!r) byParty.set(id, (r = { partyId: id, name: parties.find((x) => x.id === id)?.name ?? '—', buckets: AGEING_BUCKETS.map(() => ZERO), credit: ZERO, invoices: [] }));
    return r;
  };
  for (const d of docs) {
    const r = row(d.partyId);
    if (d.isReturn) {
      r.credit = r.credit.plus(D(d.outstandingAmount));
      continue;
    }
    const days = Math.floor((today.getTime() - (d.dueDate ?? d.postingDate).getTime()) / 86_400_000);
    const b = days < 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    r.buckets[b] = r.buckets[b]!.plus(D(d.outstandingAmount));
    r.invoices.push(d);
  }
  for (const a of advances) row(a.partyId!).credit = row(a.partyId!).credit.plus(D(a.unallocatedAmount));
  const rows = [...byParty.values()].map((r) => ({ ...r, total: sum(r.buckets, (b) => b), net: sum(r.buckets, (b) => b).minus(r.credit) })).sort((a, b) => b.total.comparedTo(a.total));
  return { rows, totals: AGEING_BUCKETS.map((_, i) => sum(rows, (r) => r.buckets[i])), credit: sum(rows, (r) => r.credit), total: sum(rows, (r) => r.total) };
}

// ---------------------------------------------------------------- GST

/** Output tax on sales, input tax on purchases (returns netted), and taxable value by rate. */
export async function gstSummary(p: Principal, r: Range) {
  await readArea(p, 'accounts');
  const where = { companyId: p.companyId, status: 'SUBMITTED' as const, postingDate: { gte: r.from, lte: r.to } };
  const [si, pi] = await Promise.all([
    prisma.erpSalesInvoice.findMany({ where, select: { isReturn: true, netTotal: true, cgst: true, sgst: true, igst: true, lines: { select: { gstRate: true, amount: true } } } }),
    prisma.erpPurchaseInvoice.findMany({ where, select: { isReturn: true, netTotal: true, cgst: true, sgst: true, igst: true, lines: { select: { gstRate: true, amount: true } } } }),
  ]);
  const side = (docs: typeof si) => {
    const sign = (d: (typeof docs)[number]) => (d.isReturn ? -1 : 1);
    const byRate = new Map<string, Dec>();
    for (const d of docs) for (const l of d.lines) byRate.set(D(l.gstRate).toFixed(2), (byRate.get(D(l.gstRate).toFixed(2)) ?? ZERO).plus(D(l.amount).times(sign(d))));
    return {
      count: docs.length,
      taxable: sum(docs, (d) => D(d.netTotal).times(sign(d))),
      cgst: sum(docs, (d) => D(d.cgst).times(sign(d))),
      sgst: sum(docs, (d) => D(d.sgst).times(sign(d))),
      igst: sum(docs, (d) => D(d.igst).times(sign(d))),
      byRate: [...byRate.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([rate, taxable]) => ({ rate, taxable: money(taxable) })),
    };
  };
  const output = side(si);
  const input = side(pi);
  const tax = (s: typeof output) => s.cgst.plus(s.sgst).plus(s.igst);
  return { output, input, netPayable: money(tax(output).minus(tax(input))) };
}

// ---------------------------------------------------------------- projects

/** Income and cost booked to each PM project (GL rows carry the project). */
export async function projectProfitability(p: Principal, r: Range) {
  await readArea(p, 'accounts');
  const rows = await prisma.erpGlEntry.groupBy({
    by: ['projectId', 'accountId'],
    where: { companyId: p.companyId, ...live, projectId: { not: null }, postingDate: { gte: r.from, lte: r.to }, voucherType: { not: CLOSING }, account: { rootType: { in: ['INCOME', 'EXPENSE'] } } },
    _sum: { debit: true, credit: true },
  });
  const [accounts, projects] = await Promise.all([
    prisma.erpAccount.findMany({ where: { id: { in: [...new Set(rows.map((x) => x.accountId))] } }, select: { id: true, rootType: true } }),
    prisma.project.findMany({ where: { id: { in: [...new Set(rows.map((x) => x.projectId!))] } }, select: { id: true, code: true, name: true, clientName: true } }),
  ]);
  const root = new Map(accounts.map((a) => [a.id, a.rootType]));
  const out = new Map<string, { income: Dec; cost: Dec }>();
  for (const x of rows) {
    const o = out.get(x.projectId!) ?? { income: ZERO, cost: ZERO };
    const net = D(x._sum.credit).minus(D(x._sum.debit));
    if (root.get(x.accountId) === 'INCOME') o.income = o.income.plus(net);
    else o.cost = o.cost.minus(net);
    out.set(x.projectId!, o);
  }
  return projects
    .map((pr) => {
      const o = out.get(pr.id)!;
      const profit = o.income.minus(o.cost);
      return { project: pr, income: o.income, cost: o.cost, profit, margin: o.income.isZero() ? null : profit.dividedBy(o.income).times(100).toDecimalPlaces(1) };
    })
    .sort((a, b) => b.income.comparedTo(a.income));
}

// ---------------------------------------------------------------- overview

export async function accountsOverview(p: Principal, today: Date) {
  await readArea(p, 'accounts');
  const fy = fiscalYear(today);
  const [recv, pay, overdue, banks, pl, drafts] = await Promise.all([
    prisma.erpSalesInvoice.aggregate({ where: { companyId: p.companyId, status: 'SUBMITTED', isReturn: false }, _sum: { outstandingAmount: true } }),
    prisma.erpPurchaseInvoice.aggregate({ where: { companyId: p.companyId, status: 'SUBMITTED', isReturn: false }, _sum: { outstandingAmount: true } }),
    prisma.erpSalesInvoice.aggregate({ where: { companyId: p.companyId, status: 'SUBMITTED', isReturn: false, outstandingAmount: { gt: 0 }, dueDate: { lt: today } }, _sum: { outstandingAmount: true }, _count: true }),
    prisma.erpAccount.findMany({ where: { companyId: p.companyId, accountType: { in: ['BANK', 'CASH'] }, isGroup: false, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
    profitAndLoss(p, { from: fy.start, to: today }),
    Promise.all([prisma.erpPayment.count({ where: { companyId: p.companyId, status: 'DRAFT' } }), prisma.erpJournalEntry.count({ where: { companyId: p.companyId, status: 'DRAFT' } })]),
  ]);
  const bal = await sums(p.companyId, { accountId: { in: banks.map((b) => b.id) } });
  return {
    fy,
    receivable: D(recv._sum.outstandingAmount),
    payable: D(pay._sum.outstandingAmount),
    overdue: D(overdue._sum.outstandingAmount),
    overdueCount: overdue._count,
    banks: banks.map((b) => ({ ...b, balance: (bal.get(b.id)?.debit ?? ZERO).minus(bal.get(b.id)?.credit ?? ZERO) })),
    income: pl.totalIncome,
    expense: pl.totalExpense,
    profit: pl.netProfit,
    draftPayments: drafts[0],
    draftJournals: drafts[1],
  };
}
