import { randomUUID } from 'node:crypto';
import type { Prisma, SalesOutcome } from '@prisma/client';
import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { ValidationError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { csvRecords, parseAmount, parseDate } from '../domain/csv';
import type { Basket, ItemHistory } from '../domain/intelligence';
import { marginFromPrice, priceFromMargin, round2 } from '../domain/pricing';
import { num, numOrNull } from './access';

/**
 * Past quotes and orders. Everything the pricing advice knows comes from this table:
 * imports of old Excel/Tally data, plus every deal closed in the app.
 */

const outcomeAliases: Record<string, SalesOutcome> = {
  won: 'WON',
  order: 'WON',
  ordered: 'WON',
  po: 'WON',
  converted: 'WON',
  lost: 'LOST',
  regret: 'LOST',
  rejected: 'LOST',
  open: 'OPEN',
  pending: 'OPEN',
  quoted: 'OPEN',
};

export interface HistoryImportResult {
  lines: number;
  refs: number;
  accountsCreated: number;
  batchId: string | null;
  errors: Array<{ row: number; message: string }>;
}

/**
 * Imports past quotes/orders from CSV, one row per line. Columns: ref, date, client, outcome
 * (won / lost / open), item_code, description, qty, unit_cost, unit_price (or amount). A quote
 * without line detail is one row with its total as amount. Checked in full before writing.
 */
export async function importHistory(principal: Principal, csv: string): Promise<HistoryImportResult> {
  assertCan(principal, 'sales.catalog.manage');
  const records = csvRecords(csv);
  if (records.length === 0) throw new ValidationError('The file has no rows. The first row must be the column names.');
  if (records.length > 20000) throw new ValidationError('Import at most 20,000 rows at a time.');

  const errors: HistoryImportResult['errors'] = [];
  const rows: Array<{ ref: string; date: Date; client: string; outcome: SalesOutcome; itemCode: string | null; description: string | null; qty: number; unitCost: number | null; unitPrice: number }> = [];

  records.forEach((r, i) => {
    const row = i + 2;
    const ref = r.ref ?? r.quote_no ?? r.order_no ?? '';
    const client = r.client ?? r.client_name ?? r.customer ?? r.account ?? '';
    if (!ref) return errors.push({ row, message: 'ref is empty.' });
    if (!client) return errors.push({ row, message: 'client is empty.' });
    const date = parseDate(r.date);
    if (!date) return errors.push({ row, message: `Date "${r.date ?? ''}" is not a date. Use 2026-04-01 or 01-04-2026.` });
    const outcome = outcomeAliases[(r.outcome ?? r.status ?? '').toLowerCase()];
    if (!outcome) return errors.push({ row, message: `Outcome "${r.outcome ?? ''}" is unknown. Use won, lost or open.` });
    const qty = parseAmount(r.qty) ?? 1;
    const unitCost = parseAmount(r.unit_cost ?? r.cost);
    let unitPrice = parseAmount(r.unit_price ?? r.rate);
    const amount = parseAmount(r.amount ?? r.value);
    if (unitPrice === null && amount !== null) unitPrice = qty > 0 ? amount / qty : NaN;
    if ([qty, unitCost, unitPrice].some((n) => n !== null && (Number.isNaN(n) || n < 0)) || !(qty > 0)) {
      return errors.push({ row, message: 'qty, unit_cost and unit_price must be positive numbers.' });
    }
    if (unitPrice === null) return errors.push({ row, message: 'Give unit_price, or amount.' });
    rows.push({
      ref,
      date,
      client,
      outcome,
      itemCode: r.item_code ? r.item_code.toUpperCase() : null,
      description: r.description || null,
      qty,
      unitCost: unitCost === null ? null : round2(unitCost),
      unitPrice: round2(unitPrice),
    });
  });

  const refs = [...new Set(rows.map((r) => r.ref))];
  const already = await prisma.salesHistoryLine.findMany({
    where: { companyId: principal.companyId, source: 'IMPORT', ref: { in: refs } },
    distinct: ['ref'],
    select: { ref: true },
  });
  for (const a of already.slice(0, 20)) errors.push({ row: 0, message: `Ref ${a.ref} was imported before. Delete that import first to load it again.` });
  if (errors.length) return { lines: 0, refs: 0, accountsCreated: 0, batchId: null, errors: errors.slice(0, 50) };

  const batchId = randomUUID();
  let accountsCreated = 0;
  await prisma.$transaction(
    async (tx) => {
      const accounts = await tx.salesAccount.findMany({ where: { companyId: principal.companyId }, select: { id: true, name: true } });
      const idByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a.id]));
      for (const name of new Set(rows.map((r) => r.client))) {
        if (idByName.has(name.toLowerCase())) continue;
        const acc = await tx.salesAccount.create({ data: { companyId: principal.companyId, name } });
        idByName.set(name.toLowerCase(), acc.id);
        accountsCreated += 1;
      }
      await tx.salesHistoryLine.createMany({
        data: rows.map((r) => ({
          companyId: principal.companyId,
          source: 'IMPORT' as const,
          batchId,
          ref: r.ref,
          date: r.date,
          accountId: idByName.get(r.client.toLowerCase())!,
          accountName: r.client,
          outcome: r.outcome,
          itemCode: r.itemCode,
          description: r.description,
          qty: r.qty,
          unitCost: r.unitCost,
          unitPrice: r.unitPrice,
        })),
      });
      await audit({ actorId: principal.userId, module: 'sales', action: 'sales.history.imported', entityType: 'SalesHistoryImport', entityId: batchId, diff: { lines: rows.length, refs: refs.length, accountsCreated } }, tx);
    },
    { timeout: 120_000 },
  );
  return { lines: rows.length, refs: refs.length, accountsCreated, batchId, errors: [] };
}

export async function listHistoryImports(principal: Principal) {
  assertCan(principal, 'sales.catalog.manage');
  const groups = await prisma.salesHistoryLine.groupBy({
    by: ['batchId'],
    where: { companyId: principal.companyId, source: 'IMPORT' },
    _count: { _all: true },
    _min: { date: true, createdAt: true },
    _max: { date: true },
  });
  const totals = await prisma.salesHistoryLine.groupBy({
    by: ['source', 'outcome'],
    where: { companyId: principal.companyId },
    _count: { _all: true },
  });
  return {
    imports: groups
      .filter((g) => g.batchId)
      .map((g) => ({ batchId: g.batchId!, lines: g._count._all, from: g._min.date, to: g._max.date, importedAt: g._min.createdAt }))
      .sort((a, b) => (b.importedAt?.getTime() ?? 0) - (a.importedAt?.getTime() ?? 0)),
    totals: totals.map((t) => ({ source: t.source, outcome: t.outcome, lines: t._count._all })),
  };
}

export async function deleteHistoryImport(principal: Principal, batchId: string) {
  assertCan(principal, 'sales.catalog.manage');
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.salesHistoryLine.deleteMany({ where: { companyId: principal.companyId, source: 'IMPORT', batchId } });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.history.import_deleted', entityType: 'SalesHistoryImport', entityId: batchId, diff: { lines: count } }, tx);
    return count;
  });
}

/** Writes a closed deal's quote into history, so the advice learns from it. */
export async function writeDealHistory(
  tx: Tx,
  input: {
    companyId: string;
    ref: string;
    date: Date;
    accountId: string;
    accountName: string;
    outcome: 'WON' | 'LOST';
    discountPct: number;
    lines: Array<{ itemCode: string | null; description: string; qty: number; unitCost: number; marginPct: number }>;
  },
) {
  if (input.lines.length === 0) return;
  const factor = 1 - input.discountPct / 100;
  await tx.salesHistoryLine.createMany({
    data: input.lines.map((l) => ({
      companyId: input.companyId,
      source: 'DEAL' as const,
      ref: input.ref,
      date: input.date,
      accountId: input.accountId,
      accountName: input.accountName,
      outcome: input.outcome,
      itemCode: l.itemCode,
      description: l.description,
      qty: l.qty,
      unitCost: l.unitCost,
      unitPrice: round2(priceFromMargin(l.unitCost, l.marginPct) * factor),
    })),
  });
}

// ------------------------------------------------------------------ analytics

interface RefSummary {
  ref: string;
  accountId: string | null;
  date: Date;
  outcome: SalesOutcome;
  value: number;
  /** Null when any line lacks a cost. */
  marginPct: number | null;
}

async function refSummaries(where: Prisma.SalesHistoryLineWhereInput, tx: Tx = prisma): Promise<RefSummary[]> {
  const lines = await tx.salesHistoryLine.findMany({
    where,
    select: { ref: true, accountId: true, date: true, outcome: true, qty: true, unitCost: true, unitPrice: true },
  });
  const byRef = new Map<string, RefSummary & { cost: number | null }>();
  for (const l of lines) {
    const key = `${l.ref}|${l.accountId ?? ''}`;
    const qty = num(l.qty);
    const cost = numOrNull(l.unitCost);
    const row = byRef.get(key) ?? { ref: l.ref, accountId: l.accountId, date: l.date, outcome: l.outcome, value: 0, cost: 0, marginPct: null };
    row.value += qty * num(l.unitPrice);
    row.cost = row.cost === null || cost === null ? null : row.cost + qty * cost;
    byRef.set(key, row);
  }
  return [...byRef.values()].map(({ cost, ...r }) => ({ ...r, value: round2(r.value), marginPct: cost !== null && r.value > 0 ? marginFromPrice(cost, r.value) : null }));
}

export interface AccountStats {
  firstWon: Date | null;
  totalWonValue: number;
  wonOrders: number;
  wonMargins: number[];
  lostMargins: number[];
  lastQuoteDate: Date | null;
}

const emptyStats = (): AccountStats => ({ firstWon: null, totalWonValue: 0, wonOrders: 0, wonMargins: [], lostMargins: [], lastQuoteDate: null });

export async function accountStats(companyId: string, accountIds?: string[], tx: Tx = prisma): Promise<Map<string, AccountStats>> {
  const summaries = await refSummaries({ companyId, accountId: accountIds ? { in: accountIds } : { not: null } }, tx);
  const out = new Map<string, AccountStats>();
  for (const s of summaries) {
    const stats = out.get(s.accountId!) ?? emptyStats();
    if (!stats.lastQuoteDate || s.date > stats.lastQuoteDate) stats.lastQuoteDate = s.date;
    if (s.outcome === 'WON') {
      stats.wonOrders += 1;
      stats.totalWonValue = round2(stats.totalWonValue + s.value);
      if (!stats.firstWon || s.date < stats.firstWon) stats.firstWon = s.date;
      if (s.marginPct !== null) stats.wonMargins.push(s.marginPct);
    } else if (s.outcome === 'LOST' && s.marginPct !== null) {
      stats.lostMargins.push(s.marginPct);
    }
    out.set(s.accountId!, stats);
  }
  return out;
}

export async function companyMarginRecords(companyId: string, tx: Tx = prisma) {
  const summaries = await refSummaries({ companyId, outcome: { in: ['WON', 'LOST'] }, unitCost: { not: null } }, tx);
  return summaries.filter((s) => s.marginPct !== null).map((s) => ({ marginPct: s.marginPct!, outcome: s.outcome as 'WON' | 'LOST' }));
}

export async function itemHistory(companyId: string, codes: string[], tx: Tx = prisma): Promise<Map<string, ItemHistory>> {
  const out = new Map<string, ItemHistory>();
  if (codes.length === 0) return out;
  const lines = await tx.salesHistoryLine.findMany({
    where: { companyId, itemCode: { in: codes }, outcome: { in: ['WON', 'LOST'] } },
    select: { itemCode: true, outcome: true, unitCost: true, unitPrice: true },
  });
  for (const l of lines) {
    const h = out.get(l.itemCode!) ?? { wonMargins: [], lostMargins: [], wonPrices: [] };
    const price = num(l.unitPrice);
    const cost = numOrNull(l.unitCost);
    if (l.outcome === 'WON') h.wonPrices.push(price);
    if (cost !== null && price > 0) (l.outcome === 'WON' ? h.wonMargins : h.lostMargins).push(marginFromPrice(cost, price));
    out.set(l.itemCode!, h);
  }
  return out;
}

/** Past BOMs (one basket per ref) with item codes, newest first. */
export async function historyBaskets(companyId: string, opts: { accountId?: string; limit?: number } = {}, tx: Tx = prisma): Promise<Basket[]> {
  const lines = await tx.salesHistoryLine.findMany({
    where: { companyId, itemCode: { not: null }, ...(opts.accountId ? { accountId: opts.accountId } : {}) },
    select: { ref: true, accountId: true, itemCode: true, qty: true, description: true, date: true },
    orderBy: { date: 'desc' },
    take: 50_000,
  });
  const baskets = new Map<string, Basket>();
  for (const l of lines) {
    const key = `${l.ref}|${l.accountId ?? ''}`;
    if (!baskets.has(key) && baskets.size >= (opts.limit ?? 3000)) continue;
    const b = baskets.get(key) ?? { ref: l.ref, items: [] };
    b.items.push({ code: l.itemCode!, qty: num(l.qty), description: l.description ?? l.itemCode! });
    baskets.set(key, b);
  }
  return [...baskets.values()];
}
