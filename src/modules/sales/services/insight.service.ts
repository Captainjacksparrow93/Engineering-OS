import { prisma } from '@/core/db/prisma';
import type { Principal } from '@/core/rbac/types';
import { lineAdvice, marginBandStats, suggestBomItems, suggestMargin, TIER_LABELS } from '../domain/intelligence';
import { loadVisibleQuote, num } from './access';
import { loadAccountRelationship } from './account.service';
import { latestPrices } from './catalog.service';
import { companyMarginRecords, historyBaskets, itemHistory } from './history.service';
import { totalsOf } from './quote.service';
import { loadSalesConfig } from './settings.service';

/**
 * Everything the quote builder's advice panel shows: the client relationship, a suggested
 * margin with its reasons, per-line raise/lower advice and items past BOMs usually held.
 */
export async function getQuoteInsights(principal: Principal, quoteId: string) {
  const quote = await loadVisibleQuote(principal, quoteId);
  const companyId = principal.companyId;
  const [config, lines, { account, relationship }, bandRecords] = await Promise.all([
    loadSalesConfig(companyId),
    prisma.salesQuoteLine.findMany({ where: { quoteId: quote.id } }),
    loadAccountRelationship(companyId, quote.deal.accountId),
    companyMarginRecords(companyId),
  ]);
  const totals = totalsOf(quote, lines);

  const margin = suggestMargin({
    targetMarginPct: config.targetMarginPct,
    minMarginPct: config.minMarginPct,
    relationship: relationship.profile,
    accountWonMargins: relationship.stats.wonMargins,
    accountLostMargins: relationship.stats.lostMargins,
    bands: marginBandStats(bandRecords),
    dealCost: totals.cost,
  });

  const codes = [...new Set(lines.map((l) => l.itemCode).filter((c): c is string => !!c))];
  const history = await itemHistory(companyId, codes);
  const advice = lineAdvice(
    lines.map((l) => {
      const cost = num(l.unitCost);
      const marginPct = num(l.marginPct);
      return { key: l.id, itemCode: l.itemCode, unitCost: cost, marginPct, unitPrice: cost / (1 - marginPct / 100) };
    }),
    history,
  );

  let baskets = codes.length === 0 ? await historyBaskets(companyId, { accountId: account.id }) : [];
  if (baskets.length < 2) baskets = await historyBaskets(companyId);
  const suggestions = suggestBomItems(codes, baskets);
  const catalog = await prisma.salesItem.findMany({
    where: { companyId, code: { in: suggestions.map((s) => s.code) }, isActive: true },
    select: { id: true, code: true, name: true },
  });
  const prices = await latestPrices(catalog.map((c) => c.id), config);
  const catalogByCode = new Map(catalog.map((c) => [c.code, c]));

  return {
    account: { id: account.id, name: account.name, strategic: account.strategic, paymentDelayDays: account.paymentDelayDays },
    relationship: {
      tier: relationship.profile.tier,
      tierLabel: TIER_LABELS[relationship.profile.tier],
      yearsWithUs: Math.floor(relationship.yearsWithUs * 10) / 10,
      totalWonValue: relationship.stats.totalWonValue,
      wonOrders: relationship.stats.wonOrders,
      repeatOrders: relationship.profile.repeatOrders,
      lostQuotes: relationship.stats.lostMargins.length,
    },
    margin: { ...margin, currentPct: totals.marginPct },
    lineAdvice: advice,
    bomSuggestions: suggestions.map((s) => {
      const item = catalogByCode.get(s.code);
      return { ...s, itemId: item?.id ?? null, name: item?.name ?? s.description, latestCost: item ? prices.get(item.id)?.rate ?? null : null };
    }),
    historySize: { companyQuotesWithMargin: bandRecords.length, baskets: baskets.length },
  };
}
