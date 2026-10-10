import { Prisma, type SalesQuote, type SalesQuoteLine } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { notify } from '@/core/notifications/notify';
import { DomainError, NotFoundError, ValidationError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import { can } from '@/core/rbac/engine';
import type { Principal } from '@/core/rbac/types';
import { addDays, todayInIndia } from '@/core/utils/dates';
import { marginFromPrice, panelTotals, priceFromMargin, quoteTotals, round2, type QuoteTotals } from '../domain/pricing';
import { lineSchema, lineUpdateSchema, quoteTermsSchema } from '../validation';
import { assertCanEditDeal, loadVisibleDeal, loadVisibleQuote, num } from './access';
import { latestPrices } from './catalog.service';
import { nextNumber } from './deal.service';
import { loadSalesConfig } from './settings.service';

type LineRow = Pick<SalesQuoteLine, 'qty' | 'unitCost' | 'marginPct'>;
type QuoteRow = Pick<SalesQuote, 'discountPct' | 'freight' | 'gstPct'>;

export function totalsOf(quote: QuoteRow, lines: LineRow[]): QuoteTotals {
  return quoteTotals(
    lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost), marginPct: num(l.marginPct) })),
    { discountPct: num(quote.discountPct), freight: num(quote.freight), gstPct: num(quote.gstPct) },
  );
}

/** The deal's value follows its newest live quote. */
async function syncDealValue(tx: Tx, quoteId: string) {
  const quote = await tx.salesQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
  if (quote.status === 'SUPERSEDED' || quote.status === 'DECLINED') return;
  await tx.salesDeal.update({ where: { id: quote.dealId }, data: { value: totalsOf(quote, quote.lines).net } });
}

async function loadEditableQuote(principal: Principal, quoteId: string, tx: Tx = prisma) {
  const quote = await loadVisibleQuote(principal, quoteId, tx);
  assertCanEditDeal(principal, quote.deal);
  if (quote.status !== 'DRAFT') throw new DomainError('Only a draft quote can be changed. Use "Revise" to change a submitted quote.');
  return quote;
}

/**
 * One click: a new quote for the deal with the company's terms, validity and GST. Lines come
 * from `copyFromQuoteId` (any quote the person can see), else from the deal's newest quote,
 * re-priced at today's latest prices; the margins carry over. Otherwise the BOM starts empty.
 */
export async function createQuote(principal: Principal, dealId: string, opts: { copyFromQuoteId?: string | null } = {}) {
  const deal = await loadVisibleDeal(principal, dealId);
  assertCanEditDeal(principal, deal);
  if (deal.stage === 'WON' || deal.stage === 'LOST') throw new DomainError('This deal is closed.');
  const config = await loadSalesConfig(principal.companyId);

  const source = opts.copyFromQuoteId
    ? await loadVisibleQuote(principal, opts.copyFromQuoteId)
    : await prisma.salesQuote.findFirst({ where: { dealId: deal.id }, orderBy: [{ createdAt: 'desc' }] });
  const sourceLines = source ? await prisma.salesQuoteLine.findMany({ where: { quoteId: source.id }, orderBy: { sortOrder: 'asc' } }) : [];
  const prices = await latestPrices([...new Set(sourceLines.map((l) => l.itemId).filter((id): id is string => !!id))], config);

  const today = todayInIndia();
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const number = await nextNumber(tx, 'quote', principal.companyId, `Q-${today.getUTCFullYear()}-`);
        const quote = await tx.salesQuote.create({
          data: {
            companyId: principal.companyId,
            dealId: deal.id,
            number,
            gstPct: config.gstPct,
            discountPct: source?.discountPct ?? 0,
            freight: source?.freight ?? 0,
            validUntil: addDays(today, config.quoteValidityDays),
            terms: config.terms,
            createdById: principal.userId,
          },
        });
        if (sourceLines.length) {
          await tx.salesQuoteLine.createMany({
            data: sourceLines.map((l, i) => {
              const latest = l.itemId ? prices.get(l.itemId) : null;
              return {
                quoteId: quote.id,
                panel: l.panel,
                itemId: l.itemId,
                itemCode: l.itemCode,
                description: l.description,
                uom: l.uom,
                qty: l.qty,
                unitCost: latest ? latest.rate : l.unitCost,
                costSource: latest ? latest.source : l.costSource,
                costDate: latest ? latest.effectiveDate : l.costDate,
                marginPct: l.marginPct,
                sortOrder: i,
              };
            }),
          });
        }
        await syncDealValue(tx, quote.id);
        await audit({ actorId: principal.userId, module: 'sales', action: 'sales.quote.created', entityType: 'SalesQuote', entityId: quote.id, diff: { number, dealId: deal.id, copiedFrom: source?.id ?? null } }, tx);
        return quote;
      });
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
  }
}

export async function getQuote(principal: Principal, quoteId: string) {
  const visible = await loadVisibleQuote(principal, quoteId);
  const quote = await prisma.salesQuote.findUniqueOrThrow({
    where: { id: visible.id },
    include: {
      lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      deal: { include: { account: true, contact: true, owner: { select: { id: true, fullName: true, email: true, phone: true, designation: true } } } },
      createdBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  });
  const config = await loadSalesConfig(principal.companyId);
  const prices = await latestPrices([...new Set(quote.lines.map((l) => l.itemId).filter((id): id is string => !!id))], config);
  const lines = quote.lines.map((l) => {
    const cost = num(l.unitCost);
    const margin = num(l.marginPct);
    const latest = l.itemId ? prices.get(l.itemId) ?? null : null;
    return {
      id: l.id,
      panel: l.panel,
      itemId: l.itemId,
      itemCode: l.itemCode,
      description: l.description,
      uom: l.uom,
      qty: num(l.qty),
      unitCost: cost,
      costSource: l.costSource,
      costDate: l.costDate,
      marginPct: margin,
      unitPrice: priceFromMargin(cost, margin),
      amount: round2(priceFromMargin(cost, margin) * num(l.qty)),
      latestCost: latest?.rate ?? null,
      priceChanged: !!latest && latest.rate !== cost,
      priceStale: !!latest?.stale,
      noPrice: !!l.itemId && !latest,
    };
  });
  const totals = totalsOf(quote, quote.lines);
  const editable = quote.status === 'DRAFT' && canEdit(principal, quote.deal);
  return {
    ...quote,
    discountPct: num(quote.discountPct),
    freight: num(quote.freight),
    gstPct: num(quote.gstPct),
    lines,
    totals,
    panels: panelTotals(lines),
    config,
    belowMinimum: totals.net > 0 && totals.marginPct < config.minMarginPct,
    flags: {
      editable,
      canEditDeal: canEdit(principal, quote.deal),
      canApprove: can(principal, 'sales.quote.approve') && quote.status === 'PENDING_APPROVAL',
      priceChanges: lines.filter((l) => l.priceChanged).length,
      stalePrices: lines.filter((l) => l.priceStale).length,
    },
  };
}

function canEdit(principal: Principal, deal: { ownerId: string }) {
  try {
    assertCanEditDeal(principal, deal);
    return true;
  } catch {
    return false;
  }
}

export async function addLine(principal: Principal, quoteId: string, input: unknown) {
  const quote = await loadEditableQuote(principal, quoteId);
  const data = lineSchema.parse(input);
  const config = await loadSalesConfig(principal.companyId);
  return prisma.$transaction(async (tx) => {
    let line: Prisma.SalesQuoteLineUncheckedCreateInput;
    const sortOrder = (await tx.salesQuoteLine.count({ where: { quoteId } })) + 1;
    const marginPct = data.marginPct ?? config.targetMarginPct;
    if (data.itemId) {
      const item = await tx.salesItem.findFirst({ where: { id: data.itemId, companyId: principal.companyId } });
      if (!item) throw new ValidationError('Pick an item from the catalogue.');
      const latest = (await latestPrices([item.id], config, tx)).get(item.id) ?? null;
      if (!latest && data.unitCost == null) throw new DomainError(`${item.code} has no price yet. Add one in the price catalogue, or type a unit cost.`);
      line = {
        quoteId,
        panel: data.panel,
        itemId: item.id,
        itemCode: item.code,
        description: data.description ?? item.name,
        uom: item.uom,
        qty: data.qty,
        unitCost: latest?.rate ?? data.unitCost!,
        costSource: latest?.source ?? null,
        costDate: latest?.effectiveDate ?? null,
        marginPct,
        sortOrder,
      };
    } else {
      line = { quoteId, panel: data.panel, description: data.description!, uom: data.uom ?? 'Nos', qty: data.qty, unitCost: data.unitCost!, marginPct, sortOrder };
    }
    const created = await tx.salesQuoteLine.create({ data: line });
    await syncDealValue(tx, quote.id);
    return created;
  });
}

export async function updateLine(principal: Principal, lineId: string, input: unknown) {
  const line = await prisma.salesQuoteLine.findFirst({ where: { id: lineId, quote: { companyId: principal.companyId } } });
  if (!line) throw new NotFoundError('Line not found.');
  await loadEditableQuote(principal, line.quoteId);
  const data = lineUpdateSchema.parse(input);
  if (data.unitCost !== undefined && line.itemId) throw new DomainError('A catalogue item takes its cost from the price catalogue. Use "Refresh prices".');
  const cost = data.unitCost ?? num(line.unitCost);
  const marginPct = data.unitPrice !== undefined ? marginFromPrice(cost, data.unitPrice) : data.marginPct;
  if (marginPct !== undefined && (marginPct < -100 || marginPct > 95)) throw new ValidationError('That price gives a margin outside −100% to 95%.');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesQuoteLine.update({
      where: { id: lineId },
      data: { panel: data.panel, description: data.description, qty: data.qty, unitCost: data.unitCost, marginPct },
    });
    await syncDealValue(tx, line.quoteId);
    return updated;
  });
}

export async function removeLine(principal: Principal, lineId: string) {
  const line = await prisma.salesQuoteLine.findFirst({ where: { id: lineId, quote: { companyId: principal.companyId } } });
  if (!line) throw new NotFoundError('Line not found.');
  await loadEditableQuote(principal, line.quoteId);
  await prisma.$transaction(async (tx) => {
    await tx.salesQuoteLine.delete({ where: { id: lineId } });
    await syncDealValue(tx, line.quoteId);
  });
}

/** Sets one margin on every line, or on one panel's lines. */
export async function applyMargin(principal: Principal, quoteId: string, marginPct: number, panel?: string | null) {
  await loadEditableQuote(principal, quoteId);
  if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 95) throw new ValidationError('Margin must be between 0% and 95%.');
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.salesQuoteLine.updateMany({ where: { quoteId, ...(panel ? { panel } : {}) }, data: { marginPct: round2(marginPct) } });
    await syncDealValue(tx, quoteId);
    return count;
  });
}

export async function applyLineMargins(principal: Principal, quoteId: string, margins: Array<{ lineId: string; marginPct: number }>) {
  await loadEditableQuote(principal, quoteId);
  if (margins.some((m) => !Number.isFinite(m.marginPct) || m.marginPct < 0 || m.marginPct > 95)) throw new ValidationError('Margin must be between 0% and 95%.');
  return prisma.$transaction(async (tx) => {
    for (const m of margins) await tx.salesQuoteLine.updateMany({ where: { id: m.lineId, quoteId }, data: { marginPct: round2(m.marginPct) } });
    await syncDealValue(tx, quoteId);
    return margins.length;
  });
}

/** Re-prices every catalogue line at today's latest price. Margins stay, so selling prices move with cost. */
export async function refreshPrices(principal: Principal, quoteId: string) {
  await loadEditableQuote(principal, quoteId);
  const config = await loadSalesConfig(principal.companyId);
  return prisma.$transaction(async (tx) => {
    const lines = await tx.salesQuoteLine.findMany({ where: { quoteId, itemId: { not: null } } });
    const prices = await latestPrices([...new Set(lines.map((l) => l.itemId!))], config, tx);
    let changed = 0;
    for (const l of lines) {
      const latest = prices.get(l.itemId!);
      if (!latest) continue;
      if (latest.rate === num(l.unitCost) && latest.source === l.costSource) continue;
      await tx.salesQuoteLine.update({ where: { id: l.id }, data: { unitCost: latest.rate, costSource: latest.source, costDate: latest.effectiveDate } });
      changed += 1;
    }
    await syncDealValue(tx, quoteId);
    return changed;
  });
}

export async function updateQuoteTerms(principal: Principal, quoteId: string, input: unknown) {
  const quote = await loadEditableQuote(principal, quoteId);
  const data = quoteTermsSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesQuote.update({ where: { id: quote.id }, data });
    await syncDealValue(tx, quote.id);
    return updated;
  });
}

async function approverIds(companyId: string, tx: Tx) {
  const users = await tx.user.findMany({
    where: { companyId, status: 'ACTIVE', roleAssignments: { some: { role: { permissions: { some: { permission: { key: 'sales.quote.approve' } } } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Submits a draft. At or above the minimum margin it is approved straight away; below it, it
 * waits for a Director, who is notified.
 */
export async function submitQuote(principal: Principal, quoteId: string) {
  const quote = await loadEditableQuote(principal, quoteId);
  const lines = await prisma.salesQuoteLine.findMany({ where: { quoteId } });
  if (lines.length === 0) throw new DomainError('Add at least one line before submitting.');
  const config = await loadSalesConfig(principal.companyId);
  const totals = totalsOf(quote, lines);
  const needsApproval = totals.marginPct < config.minMarginPct;
  const label = `${quote.number} R${quote.revision}`;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesQuote.update({
      where: { id: quote.id },
      data: needsApproval
        ? { status: 'PENDING_APPROVAL', approvalNote: null }
        : { status: 'APPROVED', approvedById: null, approvedAt: new Date(), approvalNote: `Auto-approved at ${totals.marginPct}% margin` },
    });
    if (needsApproval) {
      await notify(
        {
          userIds: (await approverIds(principal.companyId, tx)).filter((id) => id !== principal.userId),
          title: `Quote ${label} needs your approval`,
          body: `${principal.fullName} quoted ${totals.marginPct}% margin, below the ${config.minMarginPct}% minimum.`,
          link: `/sales/quotes/${quote.id}`,
        },
        tx,
      );
    }
    await audit({ actorId: principal.userId, module: 'sales', action: needsApproval ? 'sales.quote.submitted_for_approval' : 'sales.quote.auto_approved', entityType: 'SalesQuote', entityId: quote.id, diff: { marginPct: totals.marginPct, minMarginPct: config.minMarginPct } }, tx);
    return updated;
  });
}

async function decide(principal: Principal, quoteId: string, approve: boolean, note: string | null) {
  assertCan(principal, 'sales.quote.approve');
  const quote = await loadVisibleQuote(principal, quoteId);
  if (quote.status !== 'PENDING_APPROVAL') throw new DomainError('This quote is not waiting for approval.');
  if (!approve && !note) throw new ValidationError('Say what needs to change.');
  const label = `${quote.number} R${quote.revision}`;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesQuote.update({
      where: { id: quote.id },
      data: approve
        ? { status: 'APPROVED', approvedById: principal.userId, approvedAt: new Date(), approvalNote: note }
        : { status: 'DRAFT', approvedById: null, approvedAt: null, approvalNote: note },
    });
    await notify(
      {
        userIds: [quote.createdById, quote.deal.ownerId].filter((id) => id !== principal.userId),
        title: approve ? `Quote ${label} approved` : `Quote ${label} sent back`,
        body: approve ? `${principal.fullName} approved it${note ? `: ${note}` : '.'}` : `${principal.fullName}: ${note}`,
        link: `/sales/quotes/${quote.id}`,
      },
      tx,
    );
    await audit({ actorId: principal.userId, module: 'sales', action: approve ? 'sales.quote.approved' : 'sales.quote.sent_back', entityType: 'SalesQuote', entityId: quote.id, diff: { note } }, tx);
    return updated;
  });
}

export const approveQuote = (principal: Principal, quoteId: string, note?: string | null) => decide(principal, quoteId, true, note?.trim() || null);
export const sendBackQuote = (principal: Principal, quoteId: string, note: string) => decide(principal, quoteId, false, note?.trim() || null);

/** A new draft revision with the same number. The old one is superseded. */
export async function reviseQuote(principal: Principal, quoteId: string) {
  const quote = await loadVisibleQuote(principal, quoteId);
  assertCanEditDeal(principal, quote.deal);
  if (quote.deal.stage === 'WON' || quote.deal.stage === 'LOST') throw new DomainError('This deal is closed.');
  if (!['PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(quote.status)) throw new DomainError('Only a submitted quote can be revised.');
  const newer = await prisma.salesQuote.findFirst({ where: { companyId: quote.companyId, number: quote.number, revision: { gt: quote.revision } } });
  if (newer) throw new DomainError(`Revision R${newer.revision} already exists.`);
  const lines = await prisma.salesQuoteLine.findMany({ where: { quoteId: quote.id }, orderBy: { sortOrder: 'asc' } });
  return prisma.$transaction(async (tx) => {
    await tx.salesQuote.update({ where: { id: quote.id }, data: { status: 'SUPERSEDED' } });
    const next = await tx.salesQuote.create({
      data: {
        companyId: quote.companyId,
        dealId: quote.dealId,
        number: quote.number,
        revision: quote.revision + 1,
        discountPct: quote.discountPct,
        freight: quote.freight,
        gstPct: quote.gstPct,
        validUntil: quote.validUntil,
        terms: quote.terms,
        showLineItems: quote.showLineItems,
        createdById: principal.userId,
      },
    });
    if (lines.length) {
      await tx.salesQuoteLine.createMany({
        data: lines.map(({ id: _id, quoteId: _q, ...l }) => ({ ...l, quoteId: next.id })),
      });
    }
    await syncDealValue(tx, next.id);
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.quote.revised', entityType: 'SalesQuote', entityId: next.id, diff: { from: quote.id, revision: next.revision } }, tx);
    return next;
  });
}

/** Records that the quote went to the client (the Outlook draft was opened). */
export async function markQuoteSent(principal: Principal, quoteId: string) {
  const quote = await loadVisibleQuote(principal, quoteId);
  assertCanEditDeal(principal, quote.deal);
  if (quote.status === 'SENT') return quote;
  if (quote.status !== 'APPROVED') throw new DomainError(quote.status === 'PENDING_APPROVAL' ? 'A Director must approve this quote before it is sent.' : 'Submit the quote before sending it.');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesQuote.update({ where: { id: quote.id }, data: { status: 'SENT', sentAt: new Date() } });
    if (quote.deal.stage === 'LEAD' || quote.deal.stage === 'QUALIFIED') {
      await tx.salesDeal.update({ where: { id: quote.dealId }, data: { stage: 'QUOTED' } });
    }
    const config = await loadSalesConfig(quote.companyId, tx);
    await tx.salesActivity.create({
      data: { dealId: quote.dealId, userId: principal.userId, type: 'EMAIL', note: `Quote ${quote.number} R${quote.revision} sent`, doneAt: new Date() },
    });
    await tx.salesActivity.create({
      data: { dealId: quote.dealId, userId: principal.userId, type: 'FOLLOW_UP', note: `Follow up on quote ${quote.number} R${quote.revision}`, dueAt: addDays(todayInIndia(), config.followUpDays) },
    });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.quote.sent', entityType: 'SalesQuote', entityId: quote.id }, tx);
    return updated;
  });
}

/** Quotes waiting for a Director. */
export async function listPendingApprovals(principal: Principal) {
  assertCan(principal, 'sales.quote.approve');
  const quotes = await prisma.salesQuote.findMany({
    where: { companyId: principal.companyId, status: 'PENDING_APPROVAL' },
    orderBy: { updatedAt: 'asc' },
    include: { lines: true, deal: { include: { account: { select: { name: true } }, owner: { select: { fullName: true } } } } },
  });
  return quotes.map(({ lines, ...q }) => ({ ...q, totals: totalsOf(q, lines) }));
}

