import type { ErpJournalType } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import type { Principal } from '@/core/rbac/types';
import { D, money, sum } from '../domain/money';
import { journalLineSchema, journalSchema, type JournalInput, type JournalLineInput, type Raw } from '../validation';
import { assertProject, manageArea, readArea } from './access';
import { adjustOutstanding, assertSettles, invoiceByNumber, type InvoiceType } from './outstanding';
import { cancelPostings, postGl, type GlRow } from './posting';
import { nextNumber, SERIES } from './series';

/**
 * Journal Entry (ERPNext): any balanced set of debits and credits — accruals, bank charges,
 * TDS, write-offs, opening balances. Lines on Debtors or Creditors carry the party, and a
 * credit to Debtors (or a debit to Creditors) can settle a named invoice.
 */

export const VOUCHER = 'Journal Entry';
export const JOURNAL_TYPE_LABEL: Record<ErpJournalType, string> = { JOURNAL: 'Journal', OPENING: 'Opening balances' };

export async function postingAccounts(companyId: string) {
  return prisma.erpAccount.findMany({ where: { companyId, isGroup: false, isActive: true }, select: { id: true, code: true, name: true, accountType: true, rootType: true }, orderBy: { code: 'asc' } });
}

export async function listJournals(p: Principal, f: { status?: string | null; entryType?: string | null } = {}) {
  await readArea(p, 'accounts');
  return prisma.erpJournalEntry.findMany({
    where: { companyId: p.companyId, ...(f.status === 'DRAFT' || f.status === 'SUBMITTED' || f.status === 'CANCELLED' ? { status: f.status } : {}), ...(f.entryType ? { entryType: f.entryType as ErpJournalType } : {}) },
    orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  });
}

export async function getJournal(p: Principal, id: string) {
  await readArea(p, 'accounts');
  const je = await prisma.erpJournalEntry.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!je) throw new NotFoundError('Journal entry not found.');
  const [accounts, parties, si, pi, gl] = await Promise.all([
    prisma.erpAccount.findMany({ where: { id: { in: je.lines.map((l) => l.accountId) } }, select: { id: true, code: true, name: true } }),
    prisma.erpParty.findMany({ where: { id: { in: je.lines.map((l) => l.partyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    prisma.erpSalesInvoice.findMany({ where: { id: { in: je.lines.filter((l) => l.againstType === 'Sales Invoice').map((l) => l.againstId!) } }, select: { id: true, number: true } }),
    prisma.erpPurchaseInvoice.findMany({ where: { id: { in: je.lines.filter((l) => l.againstType === 'Purchase Invoice').map((l) => l.againstId!) } }, select: { id: true, number: true } }),
    prisma.erpGlEntry.findMany({ where: { voucherType: VOUCHER, voucherId: id }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    je,
    accounts: new Map(accounts.map((a) => [a.id, a])),
    parties: new Map(parties.map((x) => [x.id, x.name])),
    invoices: new Map([...si, ...pi].map((i) => [i.id, i.number])),
    gl,
  };
}

export async function createJournal(p: Principal, input: Raw<JournalInput>) {
  await manageArea(p, 'accounts');
  const data = journalSchema.parse(input);
  return prisma.$transaction(async (tx) => tx.erpJournalEntry.create({ data: { ...data, companyId: p.companyId, number: await nextNumber(tx, p.companyId, SERIES.journal, data.postingDate), createdById: p.userId } }));
}

async function loadDraft(tx: Tx, p: Principal, id: string) {
  const je = await tx.erpJournalEntry.findFirst({ where: { id, companyId: p.companyId } });
  if (!je) throw new NotFoundError('Journal entry not found.');
  if (je.status !== 'DRAFT') throw new DomainError(`${je.number} is ${je.status.toLowerCase()} and can't be changed.`);
  return je;
}

async function retotal(tx: Tx, id: string) {
  const lines = await tx.erpJournalLine.findMany({ where: { entryId: id } });
  await tx.erpJournalEntry.update({ where: { id }, data: { totalDebit: money(sum(lines, (l) => l.debit)), totalCredit: money(sum(lines, (l) => l.credit)) } });
}

export async function updateJournal(p: Principal, id: string, input: Raw<JournalInput>) {
  await manageArea(p, 'accounts');
  const data = journalSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    return tx.erpJournalEntry.update({ where: { id }, data });
  });
}

export async function addJournalLine(p: Principal, id: string, input: Raw<JournalLineInput>) {
  await manageArea(p, 'accounts');
  const data = journalLineSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    const account = await tx.erpAccount.findFirst({ where: { id: data.accountId, companyId: p.companyId, isGroup: false, isActive: true } });
    if (!account) throw new DomainError('Pick an active account (not a group).');
    const partyKind = account.accountType === 'RECEIVABLE' ? 'CUSTOMER' : account.accountType === 'PAYABLE' ? 'SUPPLIER' : null;
    if (partyKind && (!data.partyId || data.partyType !== partyKind)) throw new DomainError(`${account.name} needs a ${partyKind === 'CUSTOMER' ? 'customer' : 'supplier'} on the line.`);
    if (!partyKind && data.partyId) throw new DomainError(`Only Debtors or Creditors lines carry a party; ${account.name} doesn't.`);
    if (data.partyId && !(await tx.erpParty.findFirst({ where: { id: data.partyId, companyId: p.companyId, kind: data.partyType! } }))) throw new DomainError('Pick a customer or supplier from your list.');
    const debit = money(D(data.debit));
    const credit = money(D(data.credit));
    let againstType: InvoiceType | null = null;
    let againstId: string | null = null;
    if (data.againstInvoiceNo) {
      if (!partyKind) throw new DomainError('Only a Debtors or Creditors line can settle an invoice.');
      const inv = await invoiceByNumber(tx, p.companyId, data.againstInvoiceNo);
      const settles = partyKind === 'CUSTOMER' ? credit.greaterThan(0) : debit.greaterThan(0);
      if (!settles) throw new DomainError(partyKind === 'CUSTOMER' ? 'Credit Debtors to settle a sales invoice.' : 'Debit Creditors to settle a purchase invoice.');
      assertSettles(inv, { partyType: partyKind, partyId: data.partyId! }, false, credit.plus(debit));
      againstType = inv.type;
      againstId = inv.id;
    }
    const count = await tx.erpJournalLine.count({ where: { entryId: id } });
    await tx.erpJournalLine.create({
      data: { entryId: id, accountId: account.id, partyType: data.partyType ?? null, partyId: data.partyId, projectId: await assertProject(p.companyId, data.projectId), debit, credit, againstType, againstId, remarks: data.remarks, sortOrder: count },
    });
    await retotal(tx, id);
  });
}

export async function removeJournalLine(p: Principal, id: string, lineId: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpJournalLine.deleteMany({ where: { id: lineId, entryId: id } });
    await retotal(tx, id);
  });
}

export async function deleteJournal(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, p, id);
    await tx.erpJournalEntry.delete({ where: { id } });
  });
}

export async function submitJournal(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    const je = await tx.erpJournalEntry.findFirst({ where: { id, companyId: p.companyId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!je) throw new NotFoundError('Journal entry not found.');
    const { count } = await tx.erpJournalEntry.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SUBMITTED', submittedById: p.userId, submittedAt: new Date() } });
    if (count === 0) throw new DomainError(`${je.number} was already submitted or cancelled.`);
    if (je.lines.length < 2) throw new DomainError('A journal entry needs at least two lines.');
    const dr = sum(je.lines, (l) => l.debit);
    const cr = sum(je.lines, (l) => l.credit);
    if (!dr.equals(cr)) throw new DomainError(`Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal.`);
    const gl: GlRow[] = [];
    for (const l of je.lines) {
      if (l.againstType && l.againstId) {
        const amount = D(l.debit).plus(D(l.credit));
        await adjustOutstanding(tx, l.againstType as InvoiceType, l.againstId, amount.negated());
      }
      gl.push({
        account: { id: l.accountId },
        debit: l.debit,
        credit: l.credit,
        partyType: l.partyType,
        partyId: l.partyId,
        projectId: l.projectId,
        againstType: l.againstType ?? (l.partyId ? VOUCHER : null),
        againstId: l.againstId ?? (l.partyId ? id : null),
        remarks: l.remarks ?? je.remarks,
      });
    }
    await postGl(tx, { companyId: p.companyId, type: VOUCHER, id, no: je.number, postingDate: je.postingDate }, gl);
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.journal.submitted', entityType: 'ErpJournalEntry', entityId: id, diff: { number: je.number, total: dr.toFixed(2) } }, tx);
  });
}

export async function cancelJournal(p: Principal, id: string) {
  await manageArea(p, 'accounts');
  return prisma.$transaction(async (tx) => {
    const je = await tx.erpJournalEntry.findFirst({ where: { id, companyId: p.companyId }, include: { lines: true } });
    if (!je) throw new NotFoundError('Journal entry not found.');
    const { count } = await tx.erpJournalEntry.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'CANCELLED', cancelledById: p.userId, cancelledAt: new Date() } });
    if (count === 0) throw new DomainError(`Only a submitted entry can be cancelled; ${je.number} is ${je.status.toLowerCase()}.`);
    for (const l of je.lines) if (l.againstType && l.againstId) await adjustOutstanding(tx, l.againstType as InvoiceType, l.againstId, D(l.debit).plus(D(l.credit)));
    await cancelPostings(tx, { companyId: p.companyId, type: VOUCHER, id, no: je.number, postingDate: je.postingDate });
    await audit({ actorId: p.userId, module: 'erp', action: 'erp.journal.cancelled', entityType: 'ErpJournalEntry', entityId: id, diff: { number: je.number } }, tx);
  });
}
