import { describe, it, expect } from 'vitest';
import { marginFromPrice, panelTotals, priceFromMargin, quoteTotals, resolveLatestPrice, type PricePoint } from './pricing';

const now = new Date('2026-10-09T00:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const PRIORITY = ['PURCHASE', 'PRICE_LIST', 'BOM_COST'] as const;

describe('resolveLatestPrice', () => {
  it('returns null without prices', () => {
    expect(resolveLatestPrice([], PRIORITY, 90, now)).toBeNull();
  });

  it('takes the newest price of the highest-priority fresh source', () => {
    const prices: PricePoint[] = [
      { source: 'PRICE_LIST', rate: 900, effectiveDate: daysAgo(2) },
      { source: 'PURCHASE', rate: 1000, effectiveDate: daysAgo(40) },
      { source: 'PURCHASE', rate: 950, effectiveDate: daysAgo(80) },
    ];
    const r = resolveLatestPrice(prices, PRIORITY, 90, now)!;
    expect(r).toMatchObject({ source: 'PURCHASE', rate: 1000, stale: false, ageDays: 40 });
  });

  it('skips a stale higher-priority source for a fresh lower one', () => {
    const prices: PricePoint[] = [
      { source: 'PURCHASE', rate: 1000, effectiveDate: daysAgo(200) },
      { source: 'BOM_COST', rate: 1100, effectiveDate: daysAgo(10) },
    ];
    expect(resolveLatestPrice(prices, PRIORITY, 90, now)).toMatchObject({ source: 'BOM_COST', rate: 1100, stale: false });
  });

  it('follows a custom priority', () => {
    const prices: PricePoint[] = [
      { source: 'PURCHASE', rate: 1000, effectiveDate: daysAgo(5) },
      { source: 'PRICE_LIST', rate: 900, effectiveDate: daysAgo(5) },
    ];
    expect(resolveLatestPrice(prices, ['PRICE_LIST', 'PURCHASE'], 90, now)!.source).toBe('PRICE_LIST');
  });

  it('falls back to the newest price overall, flagged stale, when every source is stale', () => {
    const prices: PricePoint[] = [
      { source: 'PURCHASE', rate: 1000, effectiveDate: daysAgo(300) },
      { source: 'BOM_COST', rate: 1200, effectiveDate: daysAgo(120) },
    ];
    expect(resolveLatestPrice(prices, PRIORITY, 90, now)).toMatchObject({ source: 'BOM_COST', rate: 1200, stale: true, ageDays: 120 });
  });
});

describe('margin maths', () => {
  it('prices on margin over selling price, and back', () => {
    expect(priceFromMargin(80, 20)).toBe(100);
    expect(marginFromPrice(80, 100)).toBe(20);
    expect(marginFromPrice(80, 0)).toBe(0);
  });

  it('totals a quote with discount, freight and GST', () => {
    const t = quoteTotals(
      [
        { qty: 2, unitCost: 80, marginPct: 20 }, // 2 × 100
        { qty: 1, unitCost: 300, marginPct: 25 }, // 400
      ],
      { discountPct: 5, freight: 50, gstPct: 18 },
    );
    expect(t).toMatchObject({ cost: 460, subtotal: 600, discount: 30, net: 570, freight: 50, taxable: 620, gst: 111.6, grandTotal: 731.6 });
    expect(t.marginPct).toBe(marginFromPrice(460, 570));
  });

  it('reports zero margin for an empty quote', () => {
    expect(quoteTotals([], { discountPct: 0, freight: 0, gstPct: 18 }).marginPct).toBe(0);
  });

  it('groups panel subtotals in first-seen order', () => {
    const rows = panelTotals([
      { panel: 'MCC', qty: 1, unitCost: 80, marginPct: 20 },
      { panel: 'PLC', qty: 1, unitCost: 160, marginPct: 20 },
      { panel: 'MCC', qty: 1, unitCost: 80, marginPct: 20 },
    ]);
    expect(rows.map((r) => [r.panel, r.amount, r.lines])).toEqual([['MCC', 200, 2], ['PLC', 200, 1]]);
  });
});
