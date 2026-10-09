import { prisma, type Tx } from '@/core/db/prisma';
import { audit } from '@/core/audit/audit';
import { DomainError, NotFoundError, ValidationError } from '@/core/rbac/errors';
import { assertCan } from '@/core/rbac/guard';
import type { Principal } from '@/core/rbac/types';
import { todayInIndia } from '@/core/utils/dates';
import { csvRecords, parseAmount, parseDate } from '../domain/csv';
import { PRICE_SOURCES, resolveLatestPrice, round2, type PriceSource, type ResolvedPrice } from '../domain/pricing';
import { itemSchema, priceSchema } from '../validation';
import { assertSalesRead, num, numOrNull } from './access';
import { loadSalesConfig, type SalesConfig } from './settings.service';

/** Latest price per item, by the company's source priority and staleness rule. */
export async function latestPrices(itemIds: string[], config: SalesConfig, tx: Tx = prisma, now = new Date()) {
  const out = new Map<string, ResolvedPrice | null>();
  if (itemIds.length === 0) return out;
  const rows = await tx.salesItemPrice.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, source: true, rate: true, effectiveDate: true },
  });
  const byItem = new Map<string, typeof rows>();
  for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  for (const id of itemIds) {
    const prices = (byItem.get(id) ?? []).map((p) => ({ source: p.source, rate: num(p.rate), effectiveDate: p.effectiveDate }));
    out.set(id, resolveLatestPrice(prices, config.pricePriority, config.priceStaleDays, now));
  }
  return out;
}

export async function listItems(principal: Principal, opts: { q?: string; take?: number } = {}) {
  assertSalesRead(principal);
  const q = opts.q?.trim();
  const items = await prisma.salesItem.findMany({
    where: {
      companyId: principal.companyId,
      isActive: true,
      ...(q
        ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { makerPartNo: { contains: q, mode: 'insensitive' } }, { make: { contains: q, mode: 'insensitive' } }] }
        : {}),
    },
    orderBy: { code: 'asc' },
    take: opts.take ?? 500,
  });
  const config = await loadSalesConfig(principal.companyId);
  const prices = await latestPrices(items.map((i) => i.id), config);
  return items.map((i) => ({ ...i, price: prices.get(i.id) ?? null }));
}

export async function getItem(principal: Principal, itemId: string) {
  assertSalesRead(principal);
  const item = await prisma.salesItem.findFirst({
    where: { id: itemId, companyId: principal.companyId },
    include: { prices: { orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }], take: 100 } },
  });
  if (!item) throw new NotFoundError('Item not found.');
  const config = await loadSalesConfig(principal.companyId);
  const latest = (await latestPrices([item.id], config)).get(item.id) ?? null;
  return {
    ...item,
    prices: item.prices.map((p) => ({ ...p, rate: num(p.rate), listPrice: numOrNull(p.listPrice), discountPct: numOrNull(p.discountPct) })),
    latest,
  };
}

export async function createItem(principal: Principal, input: unknown) {
  assertCan(principal, 'sales.catalog.manage');
  const data = itemSchema.parse(input);
  const clash = await prisma.salesItem.findUnique({ where: { companyId_code: { companyId: principal.companyId, code: data.code } } });
  if (clash) throw new DomainError(`Item code ${data.code} already exists.`);
  return prisma.$transaction(async (tx) => {
    const item = await tx.salesItem.create({ data: { ...data, companyId: principal.companyId } });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.item.created', entityType: 'SalesItem', entityId: item.id, diff: data }, tx);
    return item;
  });
}

export async function updateItem(principal: Principal, itemId: string, input: unknown) {
  assertCan(principal, 'sales.catalog.manage');
  const data = itemSchema.parse(input);
  const item = await prisma.salesItem.findFirst({ where: { id: itemId, companyId: principal.companyId } });
  if (!item) throw new NotFoundError('Item not found.');
  if (data.code !== item.code) {
    const clash = await prisma.salesItem.findUnique({ where: { companyId_code: { companyId: principal.companyId, code: data.code } } });
    if (clash) throw new DomainError(`Item code ${data.code} already exists.`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesItem.update({ where: { id: itemId }, data });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.item.updated', entityType: 'SalesItem', entityId: itemId, diff: data }, tx);
    return updated;
  });
}

function netRate(p: { rate?: number | null; listPrice?: number | null; discountPct?: number | null }): number {
  if (p.rate && p.rate > 0) return round2(p.rate);
  return round2((p.listPrice ?? 0) * (1 - (p.discountPct ?? 0) / 100));
}

export async function addPrice(principal: Principal, input: unknown) {
  assertCan(principal, 'sales.catalog.manage');
  const data = priceSchema.parse(input);
  const item = await prisma.salesItem.findFirst({ where: { id: data.itemId, companyId: principal.companyId } });
  if (!item) throw new NotFoundError('Item not found.');
  return prisma.$transaction(async (tx) => {
    const price = await tx.salesItemPrice.create({
      data: {
        itemId: item.id,
        source: data.source,
        rate: netRate(data),
        listPrice: data.listPrice ?? null,
        discountPct: data.discountPct ?? null,
        supplier: data.supplier,
        reference: data.reference,
        effectiveDate: data.effectiveDate,
        createdById: principal.userId,
      },
    });
    await audit({ actorId: principal.userId, module: 'sales', action: 'sales.price.added', entityType: 'SalesItem', entityId: item.id, diff: { source: data.source, rate: num(price.rate) } }, tx);
    return price;
  });
}

export interface ImportResult {
  imported: number;
  itemsCreated: number;
  errors: Array<{ row: number; message: string }>;
}

const sourceAliases: Record<string, PriceSource> = {
  purchase: 'PURCHASE',
  po: 'PURCHASE',
  purchase_rate: 'PURCHASE',
  price_list: 'PRICE_LIST',
  pricelist: 'PRICE_LIST',
  list: 'PRICE_LIST',
  bom: 'BOM_COST',
  bom_cost: 'BOM_COST',
};

/**
 * Price import from CSV. Columns: item_code (required), item_name (needed for a new item), make,
 * maker_part_no, category, uom, source (purchase / price_list / bom_cost), rate, or list_price +
 * discount_pct, supplier, reference, date. All rows are checked first; nothing is written if any
 * row is wrong.
 */
export async function importPrices(principal: Principal, csv: string, defaultSource: PriceSource = 'PRICE_LIST'): Promise<ImportResult> {
  assertCan(principal, 'sales.catalog.manage');
  const records = csvRecords(csv);
  if (records.length === 0) throw new ValidationError('The file has no rows. The first row must be the column names.');
  if (records.length > 5000) throw new ValidationError('Import at most 5,000 rows at a time.');

  const existing = await prisma.salesItem.findMany({ where: { companyId: principal.companyId }, select: { id: true, code: true } });
  const idByCode = new Map(existing.map((i) => [i.code, i.id]));
  const today = todayInIndia();
  const errors: ImportResult['errors'] = [];
  const rows: Array<{ code: string; newItem: { name: string; make: string | null; makerPartNo: string | null; category: string | null; uom: string } | null; source: PriceSource; rate: number; listPrice: number | null; discountPct: number | null; supplier: string | null; reference: string | null; date: Date }> = [];
  const seenNew = new Set<string>();

  records.forEach((r, i) => {
    const row = i + 2;
    const code = (r.item_code ?? '').toUpperCase();
    if (!code) return errors.push({ row, message: 'item_code is empty.' });
    const sourceRaw = (r.source ?? '').toLowerCase().replace(/\s+/g, '_');
    const source = sourceRaw ? sourceAliases[sourceRaw] ?? (PRICE_SOURCES as readonly string[]).find((s) => s === sourceRaw.toUpperCase()) : defaultSource;
    if (!source) return errors.push({ row, message: `Unknown source "${r.source}". Use purchase, price_list or bom_cost.` });
    const rate = parseAmount(r.rate);
    const listPrice = parseAmount(r.list_price);
    const discountPct = parseAmount(r.discount_pct ?? r.discount);
    if ([rate, listPrice, discountPct].some((n) => n !== null && (Number.isNaN(n) || n < 0))) return errors.push({ row, message: 'rate, list_price and discount_pct must be numbers.' });
    if (discountPct !== null && discountPct > 100) return errors.push({ row, message: 'discount_pct must be 100 or less.' });
    const net = netRate({ rate, listPrice, discountPct });
    if (!(net > 0)) return errors.push({ row, message: 'Give a rate, or a list_price (with an optional discount_pct).' });
    const date = r.date ? parseDate(r.date) : today;
    if (!date) return errors.push({ row, message: `Date "${r.date}" is not a date. Use 2026-04-01 or 01-04-2026.` });

    let newItem = null;
    if (!idByCode.has(code) && !seenNew.has(code)) {
      if (!r.item_name || r.item_name.length < 2) return errors.push({ row, message: `Item ${code} is new: give its item_name.` });
      newItem = { name: r.item_name, make: r.make || null, makerPartNo: r.maker_part_no || null, category: r.category || null, uom: r.uom || 'Nos' };
      seenNew.add(code);
    }
    rows.push({ code, newItem, source, rate: net, listPrice, discountPct, supplier: r.supplier || null, reference: r.reference || null, date });
  });

  if (errors.length) return { imported: 0, itemsCreated: 0, errors: errors.slice(0, 50) };

  let itemsCreated = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const row of rows) {
        if (row.newItem) {
          const item = await tx.salesItem.create({ data: { companyId: principal.companyId, code: row.code, ...row.newItem } });
          idByCode.set(row.code, item.id);
          itemsCreated += 1;
        }
      }
      await tx.salesItemPrice.createMany({
        data: rows.map((row) => ({
          itemId: idByCode.get(row.code)!,
          source: row.source,
          rate: row.rate,
          listPrice: row.listPrice,
          discountPct: row.discountPct,
          supplier: row.supplier,
          reference: row.reference,
          effectiveDate: row.date,
          createdById: principal.userId,
        })),
      });
      await audit({ actorId: principal.userId, module: 'sales', action: 'sales.prices.imported', entityType: 'SalesItem', entityId: principal.companyId, diff: { prices: rows.length, itemsCreated } }, tx);
    },
    { timeout: 60_000 },
  );
  return { imported: rows.length, itemsCreated, errors: [] };
}
