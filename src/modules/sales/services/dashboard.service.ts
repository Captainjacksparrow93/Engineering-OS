import type { SalesDealStage } from '@prisma/client';
import { prisma } from '@/core/db/prisma';
import { can, hasPermissionAnywhere } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { addDays, todayInIndia } from '@/core/utils/dates';
import { round2 } from '../domain/pricing';
import { OPEN_STAGES } from '../validation';
import { assertSalesRead, dealVisibilityWhere, num, seesAllDeals } from './access';
import { latestPrices } from './catalog.service';
import { STAGE_PROBABILITY } from './deal.service';
import { listPendingApprovals } from './quote.service';
import { loadSalesConfig } from './settings.service';

export async function getSalesDashboard(principal: Principal, now = new Date()) {
  assertSalesRead(principal);
  const config = await loadSalesConfig(principal.companyId);
  const today = todayInIndia(now);
  const since = addDays(today, -90);
  const visible = dealVisibilityWhere(principal);
  const team = seesAllDeals(principal);

  const [openDeals, closed, followUps, readyToSend] = await Promise.all([
    prisma.salesDeal.findMany({
      where: { ...visible, stage: { in: [...OPEN_STAGES] } },
      include: {
        account: { select: { name: true } },
        owner: { select: { id: true, fullName: true } },
        activities: { where: { doneAt: null, dueAt: { not: null } }, select: { id: true } },
      },
    }),
    prisma.salesDeal.findMany({
      where: { ...visible, stage: { in: ['WON', 'LOST'] }, closedAt: { gte: since } },
      select: { stage: true, value: true, ownerId: true },
    }),
    prisma.salesActivity.findMany({
      where: { doneAt: null, dueAt: { lte: addDays(today, 1) }, deal: { ...visible, stage: { in: [...OPEN_STAGES] }, ...(team ? {} : { ownerId: principal.userId }) } },
      orderBy: { dueAt: 'asc' },
      take: 30,
      include: { deal: { select: { id: true, code: true, title: true, account: { select: { name: true } }, owner: { select: { fullName: true } } } } },
    }),
    prisma.salesQuote.findMany({
      where: { companyId: principal.companyId, status: 'APPROVED', deal: { ...visible, stage: { in: [...OPEN_STAGES] } } },
      orderBy: { updatedAt: 'asc' },
      take: 20,
      include: { deal: { select: { code: true, title: true, account: { select: { name: true } } } } },
    }),
  ]);

  const byStage = OPEN_STAGES.map((stage) => {
    const deals = openDeals.filter((d) => d.stage === stage);
    return { stage, count: deals.length, value: round2(deals.reduce((s, d) => s + num(d.value), 0)) };
  });
  const pipeline = round2(openDeals.reduce((s, d) => s + num(d.value), 0));
  const weighted = round2(openDeals.reduce((s, d) => s + num(d.value) * STAGE_PROBABILITY[d.stage as SalesDealStage], 0));
  const won = closed.filter((d) => d.stage === 'WON');
  const quietBefore = addDays(today, -config.followUpDays);
  const quiet = openDeals
    .filter((d) => d.activities.length === 0 && d.updatedAt < quietBefore)
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .slice(0, 10)
    .map((d) => ({ id: d.id, code: d.code, title: d.title, account: d.account.name, owner: d.owner.fullName, updatedAt: d.updatedAt, value: num(d.value) }));

  const teamRows = team
    ? [...new Map([...openDeals.map((d) => [d.owner.id, d.owner.fullName] as const)]).entries()]
        .map(([ownerId, name]) => {
          const mine = openDeals.filter((d) => d.ownerId === ownerId);
          const closedMine = closed.filter((d) => d.ownerId === ownerId);
          const wonMine = closedMine.filter((d) => d.stage === 'WON');
          return {
            ownerId,
            name,
            openDeals: mine.length,
            openValue: round2(mine.reduce((s, d) => s + num(d.value), 0)),
            wonValue: round2(wonMine.reduce((s, d) => s + num(d.value), 0)),
            winRate: closedMine.length ? Math.round((wonMine.length / closedMine.length) * 100) : null,
          };
        })
        .sort((a, b) => b.openValue - a.openValue)
    : [];

  let staleItems = 0;
  if (hasPermissionAnywhere(principal, 'sales.catalog.manage')) {
    const items = await prisma.salesItem.findMany({ where: { companyId: principal.companyId, isActive: true }, select: { id: true } });
    const prices = await latestPrices(items.map((i) => i.id), config, prisma, now);
    staleItems = [...prices.values()].filter((p) => !p || p.stale).length;
  }

  return {
    scope: team ? ('team' as const) : ('mine' as const),
    kpis: {
      openDeals: openDeals.length,
      pipeline,
      weighted,
      wonValue90: round2(won.reduce((s, d) => s + num(d.value), 0)),
      winRate90: closed.length ? Math.round((won.length / closed.length) * 100) : null,
      closed90: closed.length,
    },
    byStage,
    followUps: followUps.map((a) => ({ id: a.id, note: a.note, dueAt: a.dueAt!, overdue: a.dueAt! < today, deal: a.deal })),
    quiet,
    readyToSend: readyToSend.map((q) => ({ id: q.id, number: q.number, revision: q.revision, deal: q.deal })),
    pendingApprovals: can(principal, 'sales.quote.approve') ? await listPendingApprovals(principal) : [],
    team: teamRows,
    staleItems,
    config,
  };
}
