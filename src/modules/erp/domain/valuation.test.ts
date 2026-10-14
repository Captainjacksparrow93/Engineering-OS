import { describe, expect, it } from 'vitest';
import { applyMove, emptyBin } from './valuation';
import { D } from './money';
import { splitGst } from './gst';
import { fiscalYear, STANDARD_CHART, ROOTS } from './chart';

describe('moving-average valuation', () => {
  it('averages incoming stock and issues at the average', () => {
    let bin = emptyBin();
    bin = applyMove(bin, { kind: 'move', qty: D(10), rate: D(100) }).after;
    bin = applyMove(bin, { kind: 'move', qty: D(10), rate: D(130) }).after;
    expect(bin.qty.toString()).toBe('20');
    expect(bin.value.toFixed(2)).toBe('2300.00');
    expect(bin.rate.toFixed(4)).toBe('115.0000');
    const out = applyMove(bin, { kind: 'move', qty: D(-5) });
    expect(out.valueChange.toFixed(2)).toBe('-575.00');
    expect(out.after.qty.toString()).toBe('15');
  });

  it('takes the whole value when a bin empties, leaving no residue', () => {
    let bin = emptyBin();
    bin = applyMove(bin, { kind: 'move', qty: D(3), rate: D(10) }).after;
    bin = applyMove(bin, { kind: 'move', qty: D(3), rate: D(10.01) }).after; // 60.03, rate 10.005
    const a = applyMove(bin, { kind: 'move', qty: D(-1) });
    const b = applyMove(a.after, { kind: 'move', qty: D(-5) });
    expect(a.valueChange.plus(b.valueChange).toFixed(2)).toBe('-60.03');
    expect(b.after.value.toFixed(2)).toBe('0.00');
  });

  it('reverses exactly with a value move', () => {
    let bin = applyMove(emptyBin(), { kind: 'move', qty: D(7), rate: D(33.333) }).after;
    const inMove = applyMove(bin, { kind: 'move', qty: D(2), rate: D(41.1) });
    bin = applyMove(inMove.after, { kind: 'value', qty: D(-2), value: inMove.valueChange.negated() }).after;
    expect(bin.qty.toString()).toBe('7');
    expect(bin.value.toFixed(2)).toBe(D(7).times(33.333).toDecimalPlaces(2).toFixed(2));
  });

  it('reconciliation sets qty and rate and reports the difference', () => {
    const bin = applyMove(emptyBin(), { kind: 'move', qty: D(4), rate: D(50) }).after;
    const r = applyMove(bin, { kind: 'set', qty: D(6), rate: D(55) });
    expect(r.qtyChange.toString()).toBe('2');
    expect(r.valueChange.toFixed(2)).toBe('130.00');
    expect(r.after.rate.toFixed(2)).toBe('55.00');
  });
});

describe('GST split', () => {
  it('splits CGST/SGST within a state and IGST across states', () => {
    const intra = splitGst(D(1000), D(18), 'Gujarat', 'gujarat ');
    expect([intra.cgst.toFixed(2), intra.sgst.toFixed(2), intra.igst.toFixed(2)]).toEqual(['90.00', '90.00', '0.00']);
    const inter = splitGst(D(1000), D(18), 'Gujarat', 'Maharashtra');
    expect(inter.igst.toFixed(2)).toBe('180.00');
    expect(splitGst(D(1000), D(18), null, 'Maharashtra').cgst.toFixed(2)).toBe('90.00');
  });
});

describe('chart of accounts', () => {
  it('has unique codes and keys, and every parent exists', () => {
    const codes = new Set([...ROOTS.map((r) => r.code)]);
    const keys = new Set<string>();
    for (const row of STANDARD_CHART) {
      expect(codes.has(row.code)).toBe(false);
      expect(codes.has(row.parent!)).toBe(true);
      codes.add(row.code);
      if (row.key) {
        expect(keys.has(row.key)).toBe(false);
        keys.add(row.key);
      }
    }
  });

  it('labels Apr–Mar fiscal years', () => {
    expect(fiscalYear(new Date('2026-03-31')).label).toBe('2025-26');
    expect(fiscalYear(new Date('2026-04-01')).label).toBe('2026-27');
  });
});
