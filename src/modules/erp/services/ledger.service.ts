import type { Prisma } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { fiscalYear } from '../domain/chart';
import { D, money, sum, ZERO } from '../domain/money';
import { accountSchema, type AccountInput, type Raw } from '../validation';
import { canManage, manageArea, readArea } from './access';
import { cancelPostings, postGl, type GlRow } from './posting';
import { canManageSettings } from './settings.service';

/**
 * Books upkeep: the chart of accounts, bank reconciliation (clearance dates on payments and
 * journals), the books lock date and the year-end Period Closing Voucher.
 */

export const CLOSING = 'Period Closing';

// ---------------------------------------------------------------- chart of accounts

const canEditChart = (p: Principal) => canManage(p, 'accounts') || canManageSettings(p);

export async function createAccount(p: Principal, input: Raw<AccountInput>) {
  if (!canEditChart(p)) throw new ForbiddenError("You can't change the chart of accounts.");
  const data = accountSchema.parse(input);
  const parent = await prisma.erpAccount.findFirst({ where: { id: data.parentId, companyId: p.companyId, isGroup: true } });
  if (!parent) throw new DomainError('Pick a group account to put it under.');
  if (await prisma.erpAccount.findUnique({ where: { companyId_code: { companyId: p.companyId, code: data.code } } })) throw new DomainError(`Account code ${data.code} is taken.`);
  if (data.accountType === 'BANK' || data.accountType === 'CASH') {
    if (parent.rootType !== 'ASSET') throw new DomainError('Bank and cash accounts sit under assets.');
  }
  const row = await prisma.erpAccount.create({ data: { companyId: p.companyId, code: data.code, name: data.name, rootType: parent.rootType, parentId: parent.id, isGroup: data.isGroup, accountType: data.isGroup ? null : data.accountType ?? null } });
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.account.created', entityType: 'ErpAccount', entityId: row.id, diff: { code: row.code, name: row.name } });
  return row;
}

export async function renameAccount(p: Principal, id: string, name: string) {
  if (!canEditChart(p)) throw new ForbiddenError("You can't change the chart of accounts.");
  const clean = name?.trim();
  if (!clean) throw new DomainError('Enter the account name.');
  const row = await prisma.erpAccount.findFirst({ where: { id, companyId: p.companyId } });
  if (!row) throw new NotFoundError('Account not found.');
  await prisma.erpAccount.update({ where: { id }, data: { name: clean.slice(0, 120) } });
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.account.renamed', entityType: 'ErpAccount', entityId: id, diff: { from: row.name, to: clean } });
}

export async function setAccountActive(p: Principal, id: string, isActive: boolean) {
  if (!canEditChart(p)) throw new ForbiddenError("You can't change the chart of accounts.");
  const row = await prisma.erpAccount.findFirst({ where: { id, companyId: p.companyId } });
  if (!row) throw new NotFoundError('Account not found.');
  if (!isActive) {
    if (row.systemKey) throw new DomainError(`${row.name} is used by the posting engine and can't be switched off.`);
    if (await prisma.erpAccount.count({ where: { parentId: id, isActive: true } })) throw new DomainError('Switch off the accounts under it first.');
    const bal = await prisma.erpGlEntry.aggregate({ where: { accountId: id, isCancelled: false }, _sum: { debit: true, credit: true } });
    if (!D(bal._sum.debit).equals(D(bal._sum.credit))) throw new DomainError(`${row.name} still has a balance. Move it out with a journal entry first.`);
  }
  await prisma.erpAccount.update({ where: { id }, data: { isActive } });
}

// ---------------------------------------------------------------- bank reconciliation

export interface BankLine {
  kind: 'payment' | 'journal';
  id: string;
  number: string;
  postingDate: Date;
  referenceNo: string | null;
  party: string | null;
  deposit: Prisma.Decimal;
  withdrawal: Prisma.Decimal;
  clearanceDate: Date | null;
}

/**
 * Payments and journals that touched a bank/cash account in a period, with clearance dates,
 * and the reconciliation: balance as per books, less what the bank hasn't cleared yet.
 */
export async function bankReconciliation(p: Principal, accountId: string, from: Date, to: Date, includeCleared: boolean) {
  await readArea(p, 'accounts');
  const account = await prisma.erpAccount.findFirst({ where: { id: accountId, companyId: p.companyId, accountType: { in: ['BANK', 'CASH'] } } });
  if (!account) throw new NotFoundError('Bank account not found.');
  const [payments, journals, books] = await Promise.all([
    prisma.erpPayment.findMany({ where: { companyId: p.companyId, status: 'SUBMITTED', postingDate: { lte: to }, OR: [{ accountId }, { transferToAccountId: accountId }] }, orderBy: { postingDate: 'asc' } }),
    prisma.erpJournalEntry.findMany({ where: { companyId: p.companyId, status: 'SUBMITTED', postingDate: { lte: to }, lines: { some: { accountId } } }, include: { lines: { where: { accountId } } }, orderBy: { postingDate: 'asc' } }),
    prisma.erpGlEntry.aggregate({ where: { accountId, isCancelled: false, postingDate: { lte: to } }, _sum: { debit: true, credit: true } }),
  ]);
  const parties = await prisma.erpParty.findMany({ where: { id: { in: payments.map((x) => x.partyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const partyName = new Map(parties.map((x) => [x.id, x.name]));
  const lines: BankLine[] = [
    ...payments.map((x) => {
      const into = x.paymentType === 'RECEIVE' || (x.paymentType === 'INTERNAL_TRANSFER' && x.transferToAccountId === accountId);
      return { kind: 'payment' as const, id: x.id, number: x.number, postingDate: x.postingDate, referenceNo: x.referenceNo, party: x.partyId ? partyName.get(x.partyId) ?? null : null, deposit: into ? D(x.amount) : ZERO, withdrawal: into ? ZERO : D(x.amount), clearanceDate: x.clearanceDate };
    }),
    ...journals.map((j) => ({ kind: 'journal' as const, id: j.id, number: j.number, postingDate: j.postingDate, referenceNo: j.referenceNo, party: j.remarks, deposit: sum(j.lines, (l) => l.debit), withdrawal: sum(j.lines, (l) => l.credit), clearanceDate: j.clearanceDate })),
  ].sort((a, b) => a.postingDate.getTime() - b.postingDate.getTime());
  const uncleared = lines.filter((l) => !l.clearanceDate || l.clearanceDate > to);
  const booksBalance = D(books._sum.debit).minus(D(books._sum.credit));
  const unclearedNet = sum(uncleared, (l) => l.deposit).minus(sum(uncleared, (l) => l.withdrawal));
  const shown = lines.filter((l) => l.postingDate >= from || !l.clearanceDate || l.clearanceDate > to).filter((l) => includeCleared || !l.clearanceDate);
  return { account, lines: shown, booksBalance: money(booksBalance), unclearedDeposits: money(sum(uncleared, (l) => l.deposit)), unclearedWithdrawals: money(sum(uncleared, (l) => l.withdrawal)), bankBalance: money(booksBalance.minus(unclearedNet)) };
}

export async function setClearance(p: Principal, kind: 'payment' | 'journal', id: string, date: string | null) {
  await manageArea(p, 'accounts');
  const clearance = date ? new Date(`${date}T00:00:00.000Z`) : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('Pick a valid clearance date.');
  const doc = kind === 'payment' ? await prisma.erpPayment.findFirst({ where: { id, companyId: p.companyId, status: 'SUBMITTED' } }) : await prisma.erpJournalEntry.findFirst({ where: { id, companyId: p.companyId, status: 'SUBMITTED' } });
  if (!doc) throw new NotFoundError('Voucher not found.');
  if (clearance && clearance < doc.postingDate) throw new DomainError(`${doc.number} can't clear before it was posted.`);
  if (kind === 'payment') await prisma.erpPayment.update({ where: { id }, data: { clearanceDate: clearance } });
  else await prisma.erpJournalEntry.update({ where: { id }, data: { clearanceDate: clearance } });
}

// ---------------------------------------------------------------- closing

export async function listClosings(p: Principal) {
  await readArea(p, 'accounts');
  return prisma.erpPeriodClosing.findMany({ where: { companyId: p.companyId }, orderBy: { yearEnd: 'desc' } });
}

/** Lock the books up to a date: nothing can be posted on or before it. */
export async function setBooksLock(p: Principal, date: string | null) {
  await manageArea(p, 'accounts');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('Pick a valid date.');
  const lock = date ? new Date(`${date}T00:00:00.000Z`) : null;
  const lastClosed = await prisma.erpPeriodClosing.findFirst({ where: { companyId: p.companyId, status: 'SUBMITTED' }, orderBy: { yearEnd: 'desc' } });
  if (lastClosed && (!lock || lock < lastClosed.yearEnd)) throw new DomainError(`Fiscal year ${lastClosed.fiscalYear} is closed. The lock can't be earlier than ${lastClosed.yearEnd.toISOString().slice(0, 10)}.`);
  await prisma.erpSettings.update({ where: { companyId: p.companyId }, data: { booksClosedUpTo: lock } });
  await audit({ actorId: p.userId, module: 'erp', action: 'erp.books.locked', entityType: 'ErpSettings', entityId: p.companyId, diff: { upTo: date } });
}

/**
 * Period Closing Voucher: every income and expense account's balance for the fiscal year is
 * moved to Retained Earnings at the year end, then the books are locked up to that day.
 */
export async function closeFiscalYear(p: Principal, anyDateInYear: Date, remarks?: string | null) {
  await manageArea(p, 'accounts');
  const fy = fiscalYear(anyDateInYear);
  if (fy.end > new Date()) throw new DomainError(`Fiscal year ${fy.label} hasn't ended yet.`);
  return prisma.$transaction(
    async (tx) => {
      if (await tx.erpPeriodClosing.findFirst({ where: { companyId: p.companyId, fiscalYear: fy.label, status: 'SUBMITTED' } })) throw new DomainError(`Fiscal year ${fy.label} is already closed.`);
      const later = await tx.erpPeriodClosing.findFirst({ where: { companyId: p.companyId, status: 'SUBMITTED', yearEnd: { gt: fy.end } } });
      if (later) throw new DomainError(`A later year (${later.fiscalYear}) is closed. Re-open it first.`);
      const balances = await tx.erpGlEntry.groupBy({
        by: ['accountId'],
        where: { companyId: p.companyId, isCancelled: false, postingDate: { gte: fy.start, lte: fy.end }, account: { rootType: { in: ['INCOME', 'EXPENSE'] } } },
        _sum: { debit: true, credit: true },
      });
      const rows: GlRow[] = [];
      let profit = ZERO;
      for (const b of balances) {
        const net = D(b._sum.debit).minus(D(b._sum.credit));
        if (net.isZero()) continue;
        profit = profit.minus(net);
        rows.push(net.greaterThan(0) ? { account: { id: b.accountId }, credit: net, remarks: `Closing ${fy.label}` } : { account: { id: b.accountId }, debit: net.negated(), remarks: `Closing ${fy.label}` });
      }
      const pcv = await tx.erpPeriodClosing.create({ data: { companyId: p.companyId, fiscalYear: fy.label, yearStart: fy.start, yearEnd: fy.end, netProfit: money(profit), remarks: remarks?.trim() || null, createdById: p.userId } });
      if (rows.length) {
        rows.push(profit.greaterThanOrEqualTo(0) ? { account: 'RETAINED_EARNINGS', credit: profit, remarks: `Profit ${fy.label}` } : { account: 'RETAINED_EARNINGS', debit: profit.negated(), remarks: `Loss ${fy.label}` });
        await postGl(tx, { companyId: p.companyId, type: CLOSING, id: pcv.id, no: `PCV ${fy.label}`, postingDate: fy.end }, rows);
      }
      const settings = await tx.erpSettings.findUniqueOrThrow({ where: { companyId: p.companyId } });
      if (!settings.booksClosedUpTo || settings.booksClosedUpTo < fy.end) await tx.erpSettings.update({ where: { companyId: p.companyId }, data: { booksClosedUpTo: fy.end } });
      await audit({ actorId: p.userId, module: 'erp', action: 'erp.period.closed', entityType: 'ErpPeriodClosing', entityId: pcv.id, diff: { fiscalYear: fy.label, netProfit: profit.toFixed(2) } }, tx);
      return pcv;
    },
    { timeout: 60_000 },
  );
}

/** Re-open the latest closed year: its closing entries are reversed and the lock moves back. */
export async function reopenFiscalYear(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    const pcv = await tx.erpPeriodClosing.findFirst({ where: { id, companyId: p.companyId, status: 'SUBMITTED' } });
    if (!pcv) throw new NotFoundError('Closing not found.');
    const later = await tx.erpPeriodClosing.findFirst({ where: { companyId: p.companyId, status: 'SUBMITTED', yearEnd: { gt: pcv.yearEnd } } });
    if (later) throw new DomainError(`Re-open ${later.fiscalYear} first.`);
    const previous = await tx.erpPeriodClosing.findFirst({ where: { companyId: p.companyId, status: 'SUBMITTED', yearEnd: { lt: pcv.yearEnd } }, orderBy: { yearEnd: 'desc' } });
    await tx.erpSettings.update({ where: { companyId: p.companyId }, data: { booksClosedUpTo: previous?.yearEnd ?? null } });
    await cancelPostings(tx, { companyId: p.companyId, type: CLOSING, id: pcv.id, no: `PCV ${pcv.fiscalYear}`, postingDate: pcv.yearEnd });
    await tx.erpPeriodClosing.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.period.reopened', entityType: 'ErpPeriodClosing', entityId: id, diff: { fiscalYear: pcv.fiscalYear } }, tx);
  });
}

