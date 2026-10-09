import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { relationshipProfile, type RelationshipProfile } from '../domain/intelligence';
import { accountSchema, contactSchema, relationshipSchema } from '../validation';
import { assertSalesRead, dealVisibilityWhere, num } from './access';
import { accountStats, type AccountStats } from './history.service';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export interface AccountRelationship {
  stats: AccountStats;
  yearsWithUs: number;
  customerSince: Date | null;
  profile: RelationshipProfile;
}

export function buildRelationship(
  account: { strategic: boolean; paymentDelayDays: number | null; customerSince: Date | null },
  stats: AccountStats | undefined,
  now = new Date(),
): AccountRelationship {
  const s = stats ?? { firstWon: null, totalWonValue: 0, wonOrders: 0, wonMargins: [], lostMargins: [], lastQuoteDate: null };
  const customerSince = account.customerSince ?? s.firstWon;
  const yearsWithUs = customerSince ? Math.max(0, (now.getTime() - customerSince.getTime()) / YEAR_MS) : 0;
  return {
    stats: s,
    yearsWithUs,
    customerSince,
    profile: relationshipProfile({
      yearsWithUs,
      totalOrderValue: s.totalWonValue,
      wonOrders: s.wonOrders,
      paymentDelayDays: account.paymentDelayDays,
      strategic: account.strategic,
    }),
  };
}

export async function loadAccountRelationship(companyId: string, accountId: string, tx: Tx = prisma) {
  const account = await tx.salesAccount.findFirst({ where: { id: accountId, companyId } });
  if (!account) throw new NotFoundError('Client not found.');
  const stats = (await accountStats(companyId, [accountId], tx)).get(accountId);
  return { account, relationship: buildRelationship(account, stats) };
}

export async function listAccounts(principal: Principal, opts: { q?: string } = {}) {
  assertSalesRead(principal);
  const q = opts.q?.trim();
  const accounts = await prisma.salesAccount.findMany({
    where: { companyId: principal.companyId, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { contacts: true } } },
  });
  const [stats, openDeals] = await Promise.all([
    accountStats(principal.companyId),
    prisma.salesDeal.groupBy({
      by: ['accountId'],
      where: { ...dealVisibilityWhere(principal), stage: { notIn: ['WON', 'LOST'] } },
      _count: { _all: true },
      _sum: { value: true },
    }),
  ]);
  const openByAccount = new Map(openDeals.map((d) => [d.accountId, { count: d._count._all, value: num(d._sum.value) }]));
  return accounts.map((a) => {
    const rel = buildRelationship(a, stats.get(a.id));
    return {
      id: a.id,
      name: a.name,
      city: a.city,
      industry: a.industry,
      clientRef: a.clientRef,
      strategic: a.strategic,
      contacts: a._count.contacts,
      tier: rel.profile.tier,
      wonOrders: rel.stats.wonOrders,
      totalWonValue: rel.stats.totalWonValue,
      yearsWithUs: rel.yearsWithUs,
      lastQuoteDate: rel.stats.lastQuoteDate,
      openDeals: openByAccount.get(a.id)?.count ?? 0,
      openValue: openByAccount.get(a.id)?.value ?? 0,
    };
  });
}

export async function getAccount(principal: Principal, accountId: string) {
  assertSalesRead(principal);
  const { account, relationship } = await loadAccountRelationship(principal.companyId, accountId);
  const [contacts, deals, recentHistory] = await Promise.all([
    prisma.salesContact.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
    prisma.salesDeal.findMany({
      where: { ...dealVisibilityWhere(principal), accountId },
      orderBy: { updatedAt: 'desc' },
      include: { owner: { select: { id: true, fullName: true } } },
    }),
    prisma.salesHistoryLine.groupBy({
      by: ['ref', 'outcome', 'source'],
      where: { companyId: principal.companyId, accountId },
      _max: { date: true },
      _count: { _all: true },
      orderBy: { _max: { date: 'desc' } },
      take: 15,
    }),
  ]);
  return {
    account,
    relationship,
    contacts,
    deals: deals.map((d) => ({ ...d, value: num(d.value) })),
    recentHistory: recentHistory.map((h) => ({ ref: h.ref, outcome: h.outcome, source: h.source, date: h._max.date, lines: h._count._all })),
  };
}

export async function createAccount(principal: Principal, input: unknown, tx?: Tx) {
  assertCan(principal, 'sales.deal.manage');
  const data = accountSchema.parse(input);
  const run = async (t: Tx) => {
    const clash = await t.salesAccount.findFirst({ where: { companyId: principal.companyId, name: { equals: data.name, mode: 'insensitive' } } });
    if (clash) throw new DomainError(`A client called ${clash.name} already exists.`);
    const account = await t.salesAccount.create({ data: { ...data, companyId: principal.companyId } });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.account.created', entityType: 'SalesAccount', entityId: account.id, diff: { name: data.name } }, t);
    return account;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function updateAccount(principal: Principal, accountId: string, input: unknown) {
  assertCan(principal, 'sales.deal.manage');
  const data = accountSchema.parse(input);
  const account = await prisma.salesAccount.findFirst({ where: { id: accountId, companyId: principal.companyId } });
  if (!account) throw new NotFoundError('Client not found.');
  const clash = await prisma.salesAccount.findFirst({ where: { companyId: principal.companyId, id: { not: accountId }, name: { equals: data.name, mode: 'insensitive' } } });
  if (clash) throw new DomainError(`A client called ${clash.name} already exists.`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesAccount.update({ where: { id: accountId }, data });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.account.updated', entityType: 'SalesAccount', entityId: accountId, diff: data }, tx);
    return updated;
  });
}

/** Strategic flag, payment delay and "customer since": the Sales Head's and Directors' call. */
export async function updateRelationship(principal: Principal, accountId: string, input: unknown) {
  assertCan(principal, 'sales.account.manage');
  const data = relationshipSchema.parse(input);
  const account = await prisma.salesAccount.findFirst({ where: { id: accountId, companyId: principal.companyId } });
  if (!account) throw new NotFoundError('Client not found.');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesAccount.update({
      where: { id: accountId },
      data: { strategic: data.strategic, paymentDelayDays: data.paymentDelayDays ?? null, customerSince: data.customerSince },
    });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.account.relationship_updated', entityType: 'SalesAccount', entityId: accountId, diff: data }, tx);
    return updated;
  });
}

export async function addContact(principal: Principal, accountId: string, input: unknown) {
  assertCan(principal, 'sales.deal.manage');
  const data = contactSchema.parse(input);
  const account = await prisma.salesAccount.findFirst({ where: { id: accountId, companyId: principal.companyId } });
  if (!account) throw new NotFoundError('Client not found.');
  return prisma.salesContact.create({ data: { ...data, accountId } });
}

export async function removeContact(principal: Principal, contactId: string) {
  assertCan(principal, 'sales.deal.manage');
  const contact = await prisma.salesContact.findFirst({ where: { id: contactId, account: { companyId: principal.companyId } } });
  if (!contact) throw new NotFoundError('Contact not found.');
  await prisma.salesContact.delete({ where: { id: contactId } });
}
