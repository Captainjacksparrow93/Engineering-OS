/**
 * Sales pricing maths. Pure functions only: no Prisma, no dates from the clock unless passed in.
 *
 * Margin is always on the selling price: price = cost / (1 - margin).
 */

export const PRICE_SOURCES = ['PURCHASE', 'PRICE_LIST', 'BOM_COST'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  PURCHASE: 'Last purchase rate',
  PRICE_LIST: 'Price list (net)',
  BOM_COST: 'Last BOM cost',
};

export interface PricePoint {
  source: PriceSource;
  rate: number;
  effectiveDate: Date;
}

export interface ResolvedPrice extends PricePoint {
  ageDays: number;
  stale: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The price a BOM line should use: the newest price of the highest-priority source that is
 * still fresh. When every source is stale, the newest price overall, flagged stale.
 */
export function resolveLatestPrice(
  prices: PricePoint[],
  priority: readonly PriceSource[],
  staleDays: number,
  now: Date = new Date(),
): ResolvedPrice | null {
  if (prices.length === 0) return null;
  const withAge = prices.map((p) => {
    const ageDays = Math.max(0, Math.floor((now.getTime() - p.effectiveDate.getTime()) / DAY_MS));
    return { ...p, ageDays, stale: ageDays > staleDays };
  });
  const newestFirst = (a: ResolvedPrice, b: ResolvedPrice) => b.effectiveDate.getTime() - a.effectiveDate.getTime();

  for (const source of priority) {
    const fresh = withAge.filter((p) => p.source === source && !p.stale).sort(newestFirst);
    if (fresh[0]) return fresh[0];
  }
  return withAge.sort(newestFirst)[0]!;
}

export function priceFromMargin(cost: number, marginPct: number): number {
  const m = Math.min(Math.max(marginPct, -100), 95) / 100;
  return round2(cost / (1 - m));
}

export function marginFromPrice(cost: number, price: number): number {
  if (price <= 0) return 0;
  return round2(((price - cost) / price) * 100);
}

export interface CostedLine {
  panel?: string;
  qty: number;
  unitCost: number;
  marginPct: number;
}

export interface QuoteTerms {
  discountPct: number;
  freight: number;
  gstPct: number;
}

export interface QuoteTotals {
  cost: number;
  subtotal: number;
  discount: number;
  /** Subtotal after discount, before freight and GST. The deal value. */
  net: number;
  freight: number;
  taxable: number;
  gst: number;
  grandTotal: number;
  /** Margin after discount, freight excluded. */
  marginPct: number;
}

export function lineTotals(line: CostedLine) {
  const unitPrice = priceFromMargin(line.unitCost, line.marginPct);
  return { unitPrice, amount: round2(unitPrice * line.qty), cost: round2(line.unitCost * line.qty) };
}

export function quoteTotals(lines: CostedLine[], terms: QuoteTerms): QuoteTotals {
  let cost = 0;
  let subtotal = 0;
  for (const line of lines) {
    const t = lineTotals(line);
    cost += t.cost;
    subtotal += t.amount;
  }
  cost = round2(cost);
  subtotal = round2(subtotal);
  const discount = round2((subtotal * terms.discountPct) / 100);
  const net = round2(subtotal - discount);
  const freight = round2(terms.freight);
  const taxable = round2(net + freight);
  const gst = round2((taxable * terms.gstPct) / 100);
  return {
    cost,
    subtotal,
    discount,
    net,
    freight,
    taxable,
    gst,
    grandTotal: round2(taxable + gst),
    marginPct: net > 0 ? marginFromPrice(cost, net) : 0,
  };
}

/** Per-panel subtotals in first-seen order, for the quote and the print page. */
export function panelTotals(lines: Array<CostedLine & { panel: string }>) {
  const byPanel = new Map<string, { panel: string; cost: number; amount: number; lines: number }>();
  for (const line of lines) {
    const t = lineTotals(line);
    const row = byPanel.get(line.panel) ?? { panel: line.panel, cost: 0, amount: 0, lines: 0 };
    row.cost = round2(row.cost + t.cost);
    row.amount = round2(row.amount + t.amount);
    row.lines += 1;
    byPanel.set(line.panel, row);
  }
  return [...byPanel.values()];
}

/** Indian grouping: 12,34,567.89 */
export function formatINR(n: number, decimals = 2): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
