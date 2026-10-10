/**
 * Rule-based sales advice. Pure functions; every number they return carries the reason for it,
 * so a salesperson can see why the system suggests a price. An AI model can later replace or
 * extend these behind the same shapes.
 */
import { marginFromPrice, round2 } from './pricing';

export interface Reason {
  label: string;
  /** Margin points this reason adds (+) or removes (−). 0 for information only. */
  deltaPct: number;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : round2((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// ------------------------------------------------------------------ relationship

export interface RelationshipInput {
  yearsWithUs: number;
  totalOrderValue: number;
  wonOrders: number;
  paymentDelayDays: number | null;
  strategic: boolean;
}

export type RelationshipTier = 'STRATEGIC' | 'KEY' | 'REGULAR' | 'NEW' | 'WATCH';

export const TIER_LABELS: Record<RelationshipTier, string> = {
  STRATEGIC: 'Strategic',
  KEY: 'Key account',
  REGULAR: 'Regular',
  NEW: 'New client',
  WATCH: 'Watch payments',
};

export interface RelationshipProfile {
  tier: RelationshipTier;
  repeatOrders: number;
  reasons: Reason[];
  /** Sum of the reasons' deltas. */
  adjustmentPct: number;
}

const lakh = (n: number) => (n >= 1e7 ? `₹${round2(n / 1e7)} Cr` : `₹${round2(n / 1e5)} L`);

export function relationshipProfile(input: RelationshipInput): RelationshipProfile {
  const reasons: Reason[] = [];
  const repeatOrders = Math.max(0, input.wonOrders - 1);
  const years = Math.floor(input.yearsWithUs);

  if (input.strategic) reasons.push({ label: 'Strategic account', deltaPct: -2 });
  if (years >= 5) reasons.push({ label: `Client for ${years} years`, deltaPct: -1 });
  else if (years >= 2) reasons.push({ label: `Client for ${years} years`, deltaPct: -0.5 });
  if (input.totalOrderValue >= 1e7) reasons.push({ label: `${lakh(input.totalOrderValue)} ordered in total`, deltaPct: -1.5 });
  else if (input.totalOrderValue >= 2.5e6) reasons.push({ label: `${lakh(input.totalOrderValue)} ordered in total`, deltaPct: -0.75 });
  if (repeatOrders >= 5) reasons.push({ label: `${repeatOrders} repeat orders`, deltaPct: -1 });
  else if (repeatOrders >= 2) reasons.push({ label: `${repeatOrders} repeat orders`, deltaPct: -0.5 });

  const delay = input.paymentDelayDays ?? 0;
  if (delay > 60) reasons.push({ label: `Pays ${delay} days late on average`, deltaPct: 3 });
  else if (delay > 30) reasons.push({ label: `Pays ${delay} days late on average`, deltaPct: 1.5 });

  const adjustmentPct = round2(reasons.reduce((sum, r) => sum + r.deltaPct, 0));
  let tier: RelationshipTier;
  if (delay > 60) tier = 'WATCH';
  else if (input.strategic) tier = 'STRATEGIC';
  else if (input.wonOrders === 0) tier = 'NEW';
  else if (adjustmentPct <= -1.5) tier = 'KEY';
  else tier = 'REGULAR';

  return { tier, repeatOrders, reasons, adjustmentPct };
}

// ------------------------------------------------------------------ margin bands

export const MARGIN_BANDS: ReadonlyArray<readonly [number, number]> = [
  [-100, 10],
  [10, 15],
  [15, 20],
  [20, 25],
  [25, 30],
  [30, 101],
];

export interface BandStat {
  from: number;
  to: number;
  won: number;
  lost: number;
}

export const bandIndex = (marginPct: number) =>
  Math.max(0, MARGIN_BANDS.findIndex(([from, to]) => marginPct >= from && marginPct < to));

export function marginBandStats(records: Array<{ marginPct: number; outcome: 'WON' | 'LOST' }>): BandStat[] {
  const stats = MARGIN_BANDS.map(([from, to]) => ({ from, to, won: 0, lost: 0 }));
  for (const r of records) {
    const band = stats[bandIndex(r.marginPct)]!;
    if (r.outcome === 'WON') band.won += 1;
    else band.lost += 1;
  }
  return stats;
}

const MIN_BAND_SAMPLES = 5;
const winRate = (b: BandStat) => b.won / (b.won + b.lost);
const bandLabel = (b: BandStat) => (b.from < 0 ? `under ${b.to}%` : b.to > 100 ? `${b.from}%+` : `${b.from}–${b.to}%`);

// ------------------------------------------------------------------ margin suggestion

export interface MarginSuggestionInput {
  targetMarginPct: number;
  minMarginPct: number;
  relationship: RelationshipProfile;
  /** This client's past quotes, margin after discount. */
  accountWonMargins: number[];
  accountLostMargins: number[];
  /** Company-wide win/loss by margin band. */
  bands: BandStat[];
  /** Total BOM cost of this quote. */
  dealCost: number;
}

export interface MarginSuggestion {
  suggestedPct: number;
  basePct: number;
  reasons: Reason[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export const MAX_SUGGESTED_MARGIN = 45;

export function suggestMargin(input: MarginSuggestionInput): MarginSuggestion {
  const reasons: Reason[] = [...input.relationship.reasons];
  let pct = input.targetMarginPct + input.relationship.adjustmentPct;

  const wonMedian = input.accountWonMargins.length >= 3 ? median(input.accountWonMargins) : null;
  if (wonMedian !== null) {
    const shift = round2((wonMedian - pct) / 2);
    if (Math.abs(shift) >= 0.5) {
      reasons.push({
        label: `Won ${input.accountWonMargins.length} past orders from this client at a median ${wonMedian}% margin`,
        deltaPct: shift,
      });
      pct += shift;
    }
  }

  const lostMedian = input.accountLostMargins.length >= 2 ? median(input.accountLostMargins) : null;
  if (lostMedian !== null && (wonMedian === null || wonMedian < lostMedian) && pct >= lostMedian - 0.5) {
    const shift = round2(lostMedian - 1 - pct);
    reasons.push({
      label: `Lost ${input.accountLostMargins.length} quotes to this client at around ${lostMedian}%`,
      deltaPct: shift,
    });
    pct += shift;
  }

  const i = bandIndex(pct);
  const current = input.bands[i];
  const lower = input.bands[i - 1];
  const higher = input.bands[i + 1];
  const enough = (b: BandStat | undefined): b is BandStat => !!b && b.won + b.lost >= MIN_BAND_SAMPLES;
  if (enough(current)) {
    if (enough(lower) && winRate(lower) - winRate(current) >= 0.15) {
      reasons.push({
        label: `Company-wide, quotes at ${bandLabel(current)} win ${Math.round(winRate(current) * 100)}% vs ${Math.round(winRate(lower) * 100)}% at ${bandLabel(lower)}`,
        deltaPct: -2.5,
      });
      pct -= 2.5;
    } else if (enough(higher) && winRate(current) - winRate(higher) <= 0.05) {
      reasons.push({
        label: `Company-wide, quotes at ${bandLabel(higher)} win about as often (${Math.round(winRate(higher) * 100)}%) as at ${bandLabel(current)}`,
        deltaPct: 2.5,
      });
      pct += 2.5;
    }
  }

  if (input.dealCost >= 5e6) {
    reasons.push({ label: `Large order (BOM cost ${lakh(input.dealCost)})`, deltaPct: -1 });
    pct -= 1;
  } else if (input.dealCost > 0 && input.dealCost < 2e5) {
    reasons.push({ label: 'Small order: fixed costs weigh more', deltaPct: 2 });
    pct += 2;
  }

  pct = round2(pct);
  if (pct < input.minMarginPct) {
    reasons.push({ label: `Held at the ${input.minMarginPct}% minimum margin`, deltaPct: round2(input.minMarginPct - pct) });
    pct = input.minMarginPct;
  } else if (pct > MAX_SUGGESTED_MARGIN) {
    reasons.push({ label: `Capped at ${MAX_SUGGESTED_MARGIN}%`, deltaPct: round2(MAX_SUGGESTED_MARGIN - pct) });
    pct = MAX_SUGGESTED_MARGIN;
  }

  const accountSamples = input.accountWonMargins.length + input.accountLostMargins.length;
  const bandSamples = input.bands.reduce((s, b) => s + b.won + b.lost, 0);
  const confidence = accountSamples >= 5 && bandSamples >= 20 ? 'HIGH' : accountSamples + bandSamples >= 5 ? 'MEDIUM' : 'LOW';

  return { suggestedPct: pct, basePct: input.targetMarginPct, reasons, confidence };
}

// ------------------------------------------------------------------ per-line advice

export interface ItemHistory {
  wonMargins: number[];
  lostMargins: number[];
  wonPrices: number[];
}

export interface LineAdviceInput {
  key: string;
  itemCode: string | null;
  unitCost: number;
  marginPct: number;
  unitPrice: number;
}

export interface LineAdvice {
  key: string;
  direction: 'RAISE' | 'LOWER';
  toMarginPct: number;
  reason: string;
}

const ADVICE_GAP_PCT = 4;

/** Where an item's margin sits far from what this item has historically won at. */
export function lineAdvice(lines: LineAdviceInput[], history: Map<string, ItemHistory>): LineAdvice[] {
  const advice: LineAdvice[] = [];
  for (const line of lines) {
    if (!line.itemCode) continue;
    const h = history.get(line.itemCode);
    if (!h) continue;

    const wonMedian = h.wonMargins.length >= 3 ? median(h.wonMargins) : null;
    if (wonMedian !== null) {
      const lostNote = h.lostMargins.length ? `; lost ${h.lostMargins.length} times at a median ${median(h.lostMargins)}%` : '';
      if (line.marginPct < wonMedian - ADVICE_GAP_PCT) {
        advice.push({ key: line.key, direction: 'RAISE', toMarginPct: wonMedian, reason: `Won ${h.wonMargins.length} times at a median ${wonMedian}% margin${lostNote}` });
      } else if (line.marginPct > wonMedian + ADVICE_GAP_PCT) {
        advice.push({ key: line.key, direction: 'LOWER', toMarginPct: wonMedian, reason: `Won ${h.wonMargins.length} times at a median ${wonMedian}% margin${lostNote}` });
      }
      continue;
    }

    // No cost in the history (e.g. a Tally sales export): compare selling prices instead.
    const wonPrice = h.wonPrices.length >= 3 ? median(h.wonPrices) : null;
    if (wonPrice === null || line.unitCost <= 0) continue;
    const toMarginPct = marginFromPrice(line.unitCost, wonPrice);
    const reason = `Sold ${h.wonPrices.length} times at a median ₹${wonPrice.toLocaleString('en-IN')} per unit`;
    if (line.unitPrice < wonPrice * 0.9) advice.push({ key: line.key, direction: 'RAISE', toMarginPct, reason });
    else if (line.unitPrice > wonPrice * 1.1) advice.push({ key: line.key, direction: 'LOWER', toMarginPct, reason });
  }
  return advice;
}

// ------------------------------------------------------------------ BOM suggestions

export interface Basket {
  ref: string;
  items: Array<{ code: string; qty: number; description: string }>;
}

export interface BomSuggestion {
  code: string;
  description: string;
  typicalQty: number;
  reason: string;
  score: number;
}

/**
 * Items that past BOMs contained together with what is already in this BOM. With an empty BOM,
 * the items that appear most often in the given baskets.
 */
export function suggestBomItems(current: string[], baskets: Basket[], limit = 8): BomSuggestion[] {
  const have = new Set(current);
  const count = new Map<string, number>();
  const qtys = new Map<string, number[]>();
  const descriptions = new Map<string, string>();
  const sets = baskets.map((b) => {
    const codes = new Set(b.items.map((i) => i.code));
    for (const code of codes) count.set(code, (count.get(code) ?? 0) + 1);
    for (const i of b.items) {
      qtys.set(i.code, [...(qtys.get(i.code) ?? []), i.qty]);
      if (!descriptions.has(i.code)) descriptions.set(i.code, i.description);
    }
    return codes;
  });
  const typicalQty = (code: string) => median(qtys.get(code) ?? []) ?? 1;
  const out: BomSuggestion[] = [];

  if (have.size === 0) {
    for (const [code, n] of count) {
      if (n < 2) continue;
      out.push({ code, description: descriptions.get(code) ?? code, typicalQty: typicalQty(code), reason: `In ${n} of ${baskets.length} past BOMs`, score: n / baskets.length });
    }
  } else {
    const anchors = [...have].filter((code) => (count.get(code) ?? 0) >= 2);
    for (const [candidate] of count) {
      if (have.has(candidate)) continue;
      let best: { score: number; together: number; anchor: string } | null = null;
      for (const anchor of anchors) {
        let together = 0;
        for (const s of sets) if (s.has(anchor) && s.has(candidate)) together += 1;
        const score = together / count.get(anchor)!;
        if (together >= 2 && score >= 0.5 && (!best || score > best.score || (score === best.score && together > best.together))) {
          best = { score, together, anchor };
        }
      }
      if (best) {
        out.push({
          code: candidate,
          description: descriptions.get(candidate) ?? candidate,
          typicalQty: typicalQty(candidate),
          reason: `In ${best.together} of ${count.get(best.anchor)} past BOMs with ${best.anchor}`,
          score: best.score,
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit);
}
