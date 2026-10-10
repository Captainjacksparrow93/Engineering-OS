import { describe, it, expect } from 'vitest';
import {
  lineAdvice,
  marginBandStats,
  median,
  relationshipProfile,
  suggestBomItems,
  suggestMargin,
  type ItemHistory,
  type RelationshipProfile,
} from './intelligence';

const neutral: RelationshipProfile = { tier: 'NEW', repeatOrders: 0, reasons: [], adjustmentPct: 0 };
const base = { targetMarginPct: 20, minMarginPct: 12, relationship: neutral, accountWonMargins: [], accountLostMargins: [], bands: marginBandStats([]), dealCost: 1e6 };

describe('median', () => {
  it('handles empty, odd and even lists', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('relationshipProfile', () => {
  it('gives a long, large, repeat, strategic client the biggest relationship discount', () => {
    const p = relationshipProfile({ yearsWithUs: 6.4, totalOrderValue: 2e7, wonOrders: 8, paymentDelayDays: 5, strategic: true });
    expect(p.tier).toBe('STRATEGIC');
    expect(p.repeatOrders).toBe(7);
    expect(p.adjustmentPct).toBe(-5.5);
    expect(p.reasons.map((r) => r.label)).toContain('Client for 6 years');
  });

  it('marks a new client with no adjustment', () => {
    const p = relationshipProfile({ yearsWithUs: 0, totalOrderValue: 0, wonOrders: 0, paymentDelayDays: null, strategic: false });
    expect(p).toMatchObject({ tier: 'NEW', adjustmentPct: 0, reasons: [] });
  });

  it('puts a slow payer on watch and adds margin', () => {
    const p = relationshipProfile({ yearsWithUs: 3, totalOrderValue: 3e6, wonOrders: 3, paymentDelayDays: 75, strategic: true });
    expect(p.tier).toBe('WATCH');
    expect(p.reasons).toContainEqual({ label: 'Pays 75 days late on average', deltaPct: 3 });
  });

  it('calls a mid-size repeat client a key account', () => {
    const p = relationshipProfile({ yearsWithUs: 2, totalOrderValue: 3e6, wonOrders: 3, paymentDelayDays: 10, strategic: false });
    expect(p.tier).toBe('KEY');
  });
});

describe('suggestMargin', () => {
  it('returns the target with low confidence when there is no history', () => {
    expect(suggestMargin(base)).toMatchObject({ suggestedPct: 20, basePct: 20, confidence: 'LOW', reasons: [] });
  });

  it('applies the relationship adjustment', () => {
    const relationship = relationshipProfile({ yearsWithUs: 6, totalOrderValue: 0, wonOrders: 1, paymentDelayDays: null, strategic: true });
    expect(suggestMargin({ ...base, relationship }).suggestedPct).toBe(17);
  });

  it("moves half-way to the client's median won margin", () => {
    const s = suggestMargin({ ...base, accountWonMargins: [14, 16, 15] });
    expect(s.suggestedPct).toBe(17.5);
    expect(s.reasons[0]!.label).toContain('median 15%');
  });

  it('drops below the margin this client has rejected', () => {
    const s = suggestMargin({ ...base, accountLostMargins: [19, 21] });
    expect(s.suggestedPct).toBe(19);
  });

  it('steps down a band when the company wins far more often below it', () => {
    const records = [
      ...Array(8).fill({ marginPct: 22, outcome: 'LOST' }),
      ...Array(2).fill({ marginPct: 22, outcome: 'WON' }),
      ...Array(6).fill({ marginPct: 17, outcome: 'WON' }),
      ...Array(2).fill({ marginPct: 17, outcome: 'LOST' }),
    ];
    const s = suggestMargin({ ...base, targetMarginPct: 22, bands: marginBandStats(records) });
    expect(s.suggestedPct).toBe(19.5);
    expect(s.reasons.at(-1)!.label).toMatch(/win 20% vs 75%/);
  });

  it('steps up a band when the higher band wins about as often', () => {
    const records = [
      ...Array(5).fill({ marginPct: 21, outcome: 'WON' }),
      ...Array(5).fill({ marginPct: 21, outcome: 'LOST' }),
      ...Array(5).fill({ marginPct: 27, outcome: 'WON' }),
      ...Array(5).fill({ marginPct: 27, outcome: 'LOST' }),
    ];
    expect(suggestMargin({ ...base, bands: marginBandStats(records) }).suggestedPct).toBe(22.5);
  });

  it('adjusts for deal size and holds at the minimum margin', () => {
    expect(suggestMargin({ ...base, dealCost: 1e5 }).suggestedPct).toBe(22);
    expect(suggestMargin({ ...base, dealCost: 6e6 }).suggestedPct).toBe(19);
    const s = suggestMargin({ ...base, targetMarginPct: 10 });
    expect(s.suggestedPct).toBe(12);
    expect(s.reasons.at(-1)!.label).toContain('minimum');
  });
});

describe('lineAdvice', () => {
  const history = new Map<string, ItemHistory>([
    ['CPU', { wonMargins: [18, 20, 22], lostMargins: [30], wonPrices: [] }],
    ['HMI', { wonMargins: [], lostMargins: [], wonPrices: [1000, 1000, 1100] }],
  ]);

  it('advises raising a line priced well below its won margin', () => {
    const [a] = lineAdvice([{ key: 'l1', itemCode: 'CPU', unitCost: 100, marginPct: 10, unitPrice: 111 }], history);
    expect(a).toMatchObject({ key: 'l1', direction: 'RAISE', toMarginPct: 20 });
    expect(a!.reason).toContain('lost 1 times');
  });

  it('advises lowering a line priced well above, and stays quiet near the median', () => {
    expect(lineAdvice([{ key: 'l1', itemCode: 'CPU', unitCost: 100, marginPct: 30, unitPrice: 143 }], history)[0]!.direction).toBe('LOWER');
    expect(lineAdvice([{ key: 'l1', itemCode: 'CPU', unitCost: 100, marginPct: 21, unitPrice: 127 }], history)).toEqual([]);
  });

  it('compares selling prices when the history has no cost', () => {
    const [a] = lineAdvice([{ key: 'l2', itemCode: 'HMI', unitCost: 800, marginPct: 40, unitPrice: 1333 }], history);
    expect(a).toMatchObject({ direction: 'LOWER', toMarginPct: 20 });
  });

  it('ignores lines without an item code or history', () => {
    expect(lineAdvice([{ key: 'x', itemCode: null, unitCost: 1, marginPct: 1, unitPrice: 1 }, { key: 'y', itemCode: 'NONE', unitCost: 1, marginPct: 1, unitPrice: 1 }], history)).toEqual([]);
  });
});

describe('suggestBomItems', () => {
  const basket = (ref: string, ...codes: string[]) => ({ ref, items: codes.map((code) => ({ code, qty: code === 'MCB' ? 4 : 1, description: `${code} desc` })) });
  const baskets = [
    basket('Q1', 'CPU', 'PSU', 'MCB'),
    basket('Q2', 'CPU', 'PSU', 'MCB'),
    basket('Q3', 'CPU', 'PSU'),
    basket('Q4', 'VFD', 'MCB'),
  ];

  it('suggests items that past BOMs held together with the current ones', () => {
    const s = suggestBomItems(['CPU'], baskets);
    expect(s.map((x) => x.code)).toEqual(['PSU', 'MCB']);
    expect(s[0]).toMatchObject({ reason: 'In 3 of 3 past BOMs with CPU', typicalQty: 1 });
    expect(s[1]).toMatchObject({ typicalQty: 4 });
  });

  it('suggests the most common items for an empty BOM', () => {
    expect(suggestBomItems([], baskets).map((x) => x.code)).toEqual(['CPU', 'MCB', 'PSU']);
  });

  it('never suggests what is already in the BOM', () => {
    expect(suggestBomItems(['CPU', 'PSU', 'MCB'], baskets)).toEqual([]);
  });
});
