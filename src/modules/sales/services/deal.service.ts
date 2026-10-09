import { Prisma, type SalesDealStage } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError, ValidationError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { todayInIndia } from '@/core/utils/dates';
import { quoteTotals } from '../domain/pricing';
import { OPEN_STAGES, activitySchema, closeDealSchema, dealSchema, dealUpdateSchema } from '../validation';
import { assertCanEditDeal, assertSalesRead, dealVisibilityWhere, loadVisibleDeal, num, seesAllDeals } from './access';
import { createAccount } from './account.service';
import { writeDealHistory } from './history.service';

export const STAGE_LABELS: Record<SalesDealStage, string> = {
  LEAD: 'Lead',
  QUALIFIED: 'Qualified',
  QUOTED: 'Quoted',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
};

/** Chance of winning per open stage, for the weighted pipeline. */
export const STAGE_PROBABILITY: Record<SalesDealStage, number> = {
  LEAD: 0.1,
  QUALIFIED: 0.25,
  QUOTED: 0.5,
  NEGOTIATION: 0.75,
  WON: 1,
  LOST: 0,
};

const SEQUENCES = {
  deal: { table: 'sales_deals', column: 'code' },
  quote: { table: 'sales_quotes', column: 'number' },
} as const;

/** Next number after the highest `<prefix>NNNN` in use. Unique constraints catch a race. */
export async function nextNumber(tx: Tx, kind: keyof typeof SEQUENCES, companyId: string, prefix: string): Promise<string> {
  const { table, column } = SEQUENCES[kind];
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING(${Prisma.raw(`"${column}"`)} FROM ${prefix.length + 1}::int) AS INTEGER)) AS max
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "companyId" = ${companyId}
      AND ${Prisma.raw(`"${column}"`)} LIKE ${`${prefix}%`}
      AND SUBSTRING(${Prisma.raw(`"${column}"`)} FROM ${prefix.length + 1}::int) ~ '^[0-9]+$'`;
  return `${prefix}${String((rows[0]?.max ?? 0) + 1).padStart(4, '0')}`;
}

export async function listDeals(principal: Principal, opts: { stage?: SalesDealStage | 'OPEN'; ownerId?: string; q?: string } = {}) {
  assertSalesRead(principal);
  const q = opts.q?.trim();
  const deals = await prisma.salesDeal.findMany({
    where: {
      ...dealVisibilityWhere(principal),
      ...(opts.stage === 'OPEN' ? { stage: { in: [...OPEN_STAGES] } } : opts.stage ? { stage: opts.stage } : {}),
      ...(opts.ownerId && seesAllDeals(principal) ? { ownerId: opts.ownerId } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { account: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 1000,
    include: {
      account: { select: { id: true, name: true } },
      owner: { select: { id: true, fullName: true } },
      activities: { where: { doneAt: null, dueAt: { not: null } }, orderBy: { dueAt: 'asc' }, take: 1, select: { dueAt: true, note: true } },
    },
  });
  return deals.map((d) => ({ ...d, value: num(d.value), nextFollowUp: d.activities[0] ?? null }));
}

export async function getDeal(principal: Principal, dealId: string) {
  const visible = await loadVisibleDeal(principal, dealId);
  const deal = await prisma.salesDeal.findUniqueOrThrow({
    where: { id: visible.id },
    include: {
      account: true,
      contact: true,
      owner: { select: { id: true, fullName: true, email: true } },
      activities: { orderBy: { createdAt: 'desc' }, include: { user: { select: { fullName: true } } } },
      quotes: { orderBy: [{ number: 'desc' }, { revision: 'desc' }], include: { lines: true, createdBy: { select: { fullName: true } } } },
    },
  });
  const [contacts, accountQuotes] = await Promise.all([
    prisma.salesContact.findMany({ where: { accountId: deal.accountId }, orderBy: { name: 'asc' } }),
    prisma.salesQuote.findMany({
      where: { companyId: principal.companyId, dealId: { not: deal.id }, status: { not: 'SUPERSEDED' }, deal: { ...dealVisibilityWhere(principal), accountId: deal.accountId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, number: true, revision: true, status: true, deal: { select: { title: true } } },
    }),
  ]);
  return {
    ...deal,
    value: num(deal.value),
    contacts,
    accountQuotes,
    quotes: deal.quotes.map(({ lines, ...q }) => ({
      ...q,
      totals: quoteTotals(lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost), marginPct: num(l.marginPct) })), { discountPct: num(q.discountPct), freight: num(q.freight), gstPct: num(q.gstPct) }),
      lineCount: lines.length,
    })),
    canEdit: canEditDeal(principal, deal),
  };
}

export function canEditDeal(principal: Principal, deal: { ownerId: string }) {
  try {
    assertCanEditDeal(principal, deal);
    return true;
  } catch {
    return false;
  }
}

async function resolveOwner(principal: Principal, tx: Tx, ownerId: string | null | undefined): Promise<string> {
  if (!ownerId || ownerId === principal.userId) return principal.userId;
  if (!seesAllDeals(principal)) throw new DomainError('Only the Sales Head can give a deal to someone else.');
  const owner = await tx.user.findFirst({ where: { id: ownerId, companyId: principal.companyId, status: 'ACTIVE' } });
  if (!owner) throw new ValidationError('Pick an active salesperson as the owner.');
  return owner.id;
}

export async function createDeal(principal: Principal, input: unknown) {
  assertCan(principal, 'sales.deal.manage');
  const data = dealSchema.parse(input);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        let accountId = data.accountId ?? null;
        if (accountId) {
          const account = await tx.salesAccount.findFirst({ where: { id: accountId, companyId: principal.companyId } });
          if (!account) throw new ValidationError('Pick a client from the list.');
        } else {
          const existing = await tx.salesAccount.findFirst({ where: { companyId: principal.companyId, name: { equals: data.newAccountName!, mode: 'insensitive' } } });
          accountId = existing?.id ?? (await createAccount(principal, { name: data.newAccountName }, tx)).id;
        }
        if (data.contactId) {
          const contact = await tx.salesContact.findFirst({ where: { id: data.contactId, accountId } });
          if (!contact) throw new ValidationError('That contact belongs to another client.');
        }
        const ownerId = await resolveOwner(principal, tx, data.ownerId);
        const code = await nextNumber(tx, 'deal', principal.companyId, 'DL-');
        const deal = await tx.salesDeal.create({
          data: {
            companyId: principal.companyId,
            code,
            title: data.title,
            accountId,
            contactId: data.contactId,
            ownerId,
            value: data.value ?? null,
            expectedCloseDate: data.expectedCloseDate,
            source: data.source,
            notes: data.notes,
          },
        });
        await audit({ actorId: principal.userId, module: 'sales', action: 'sales.deal.created', entityType: 'SalesDeal', entityId: deal.id, diff: { code, title: data.title } }, tx);
        return deal;
      });
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
  }
}

export async function updateDeal(principal: Principal, dealId: string, input: unknown) {
  const deal = await loadVisibleDeal(principal, dealId);
  assertCanEditDeal(principal, deal);
  const data = dealUpdateSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    if (data.contactId) {
      const contact = await tx.salesContact.findFirst({ where: { id: data.contactId, accountId: deal.accountId } });
      if (!contact) throw new ValidationError('That contact belongs to another client.');
    }
    const ownerId = data.ownerId ? await resolveOwner(principal, tx, data.ownerId) : deal.ownerId;
    const updated = await tx.salesDeal.update({
      where: { id: deal.id },
      data: { title: data.title, contactId: data.contactId, value: data.value ?? deal.value, expectedCloseDate: data.expectedCloseDate, source: data.source, notes: data.notes, ownerId },
    });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.deal.updated', entityType: 'SalesDeal', entityId: deal.id, diff: { ...data, ownerId } }, tx);
    return updated;
  });
}

export async function moveStage(principal: Principal, dealId: string, stage: SalesDealStage) {
  const deal = await loadVisibleDeal(principal, dealId);
  assertCanEditDeal(principal, deal);
  if (!(OPEN_STAGES as readonly string[]).includes(stage)) throw new ValidationError('Use "Mark won" or "Mark lost" to close a deal.');
  if (deal.stage === 'WON' || deal.stage === 'LOST') throw new DomainError('This deal is closed.');
  if (deal.stage === stage) return deal;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesDeal.update({ where: { id: deal.id }, data: { stage } });
    await tx.salesActivity.create({ data: { dealId: deal.id, userId: principal.userId, type: 'STAGE', note: `${STAGE_LABELS[deal.stage]} → ${STAGE_LABELS[stage]}`, doneAt: new Date() } });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.deal.stage_changed', entityType: 'SalesDeal', entityId: deal.id, diff: { from: deal.stage, to: stage } }, tx);
    return updated;
  });
}

/**
 * Closes a deal. Won needs an approved, sent or accepted quote: it becomes Accepted. Lost
 * declines the open quote. Either way the final quote goes into history for the advice.
 */
export async function closeDeal(principal: Principal, dealId: string, input: unknown) {
  const deal = await loadVisibleDeal(principal, dealId);
  assertCanEditDeal(principal, deal);
  const data = closeDealSchema.parse(input);
  if (deal.stage === 'WON' || deal.stage === 'LOST') throw new DomainError('This deal is already closed.');

  return prisma.$transaction(async (tx) => {
    const quotes = await tx.salesQuote.findMany({
      where: { dealId: deal.id, status: { in: ['APPROVED', 'SENT', 'ACCEPTED', 'PENDING_APPROVAL', 'DRAFT'] } },
      orderBy: [{ updatedAt: 'desc' }],
      include: { lines: true },
    });
    const sendable = quotes.find((q) => q.status === 'ACCEPTED' || q.status === 'SENT' || q.status === 'APPROVED');
    if (data.outcome === 'WON' && !sendable) throw new DomainError('Mark the deal won after its quote is approved.');
    const final = data.outcome === 'WON' ? sendable! : quotes.find((q) => q.status !== 'DRAFT') ?? null;
    const today = todayInIndia();

    if (final) {
      await tx.salesQuote.update({ where: { id: final.id }, data: { status: data.outcome === 'WON' ? 'ACCEPTED' : 'DECLINED' } });
      const account = await tx.salesAccount.findUniqueOrThrow({ where: { id: deal.accountId } });
      await writeDealHistory(tx, {
        companyId: deal.companyId,
        ref: `${final.number} R${final.revision}`,
        date: today,
        accountId: account.id,
        accountName: account.name,
        outcome: data.outcome,
        discountPct: num(final.discountPct),
        lines: final.lines.map((l) => ({ itemCode: l.itemCode, description: l.description, qty: num(l.qty), unitCost: num(l.unitCost), marginPct: num(l.marginPct) })),
      });
    }
    const totals = final
      ? quoteTotals(final.lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost), marginPct: num(l.marginPct) })), { discountPct: num(final.discountPct), freight: num(final.freight), gstPct: num(final.gstPct) })
      : null;
    const updated = await tx.salesDeal.update({
      where: { id: deal.id },
      data: {
        stage: data.outcome,
        closedAt: new Date(),
        lostReason: data.outcome === 'LOST' ? data.lostReason : null,
        erpSalesOrder: data.erpSalesOrder,
        woNumber: data.woNumber,
        value: totals?.net ?? deal.value,
      },
    });
    await tx.salesActivity.create({
      data: { dealId: deal.id, userId: principal.userId, type: 'STAGE', note: data.outcome === 'WON' ? `Won${final ? ` on ${final.number} R${final.revision}` : ''}` : `Lost: ${data.lostReason}`, doneAt: new Date() },
    });
    await audit({ actorId: principal.userId, module: 'sales', action: `sales.deal.${data.outcome.toLowerCase()}`, entityType: 'SalesDeal', entityId: deal.id, diff: data }, tx);
    return updated;
  });
}

export async function addActivity(principal: Principal, dealId: string, input: unknown) {
  const deal = await loadVisibleDeal(principal, dealId);
  assertCanEditDeal(principal, deal);
  const data = activitySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const activity = await tx.salesActivity.create({
      data: { dealId: deal.id, userId: principal.userId, type: data.type, note: data.note, dueAt: data.dueAt, doneAt: data.dueAt ? null : new Date() },
    });
    await tx.salesDeal.update({ where: { id: deal.id }, data: { updatedAt: new Date() } });
    return activity;
  });
}

export async function completeActivity(principal: Principal, activityId: string) {
  const activity = await prisma.salesActivity.findFirst({ where: { id: activityId, deal: dealVisibilityWhere(principal) }, include: { deal: true } });
  if (!activity) throw new NotFoundError('Follow-up not found.');
  assertCanEditDeal(principal, activity.deal);
  if (activity.doneAt) return activity;
  return prisma.salesActivity.update({ where: { id: activityId }, data: { doneAt: new Date() } });
}

/** Salespeople who can own deals: active people holding `sales.deal.manage`. */
export async function listSalespeople(principal: Principal) {
  assertSalesRead(principal);
  return prisma.user.findMany({
    where: {
      companyId: principal.companyId,
      status: 'ACTIVE',
      roleAssignments: { some: { role: { permissions: { some: { permission: { key: 'sales.deal.manage' } } } } } },
    },
    select: { id: true, fullName: true, designation: true },
    orderBy: { fullName: 'asc' },
  });
}
