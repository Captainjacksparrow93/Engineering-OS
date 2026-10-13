import { describe, expect, it } from 'vitest';
import { computeTotals, orderStatus } from './totals';

describe('document totals', () => {
  it('works GST out per rate on the taxable total, intra and inter state', () => {
    const lines = [
      { amount: '333.33', gstRate: 18 },
      { amount: '333.33', gstRate: 18 },
      { amount: '100', gstRate: 5 },
    ];
    const intra = computeTotals(lines, 'Gujarat', 'Gujarat');
    expect(intra.netTotal.toFixed(2)).toBe('766.66');
    expect(intra.cgst.toFixed(2)).toBe('62.50'); // 60.00 + 2.50
    expect(intra.sgst.toFixed(2)).toBe('62.50');
    expect(intra.grandTotal.toFixed(2)).toBe('891.66');
    const inter = computeTotals(lines, 'Gujarat', 'Maharashtra');
    expect(inter.igst.toFixed(2)).toBe('125.00');
    expect(inter.cgst.toFixed(2)).toBe('0.00');
  });

  it('derives order status from fulfilment', () => {
    const o = { status: 'SUBMITTED' as const, isClosed: false };
    expect(orderStatus(o, 0, 0).label).toBe('To receive and bill');
    expect(orderStatus(o, 100, 40).label).toBe('To bill');
    expect(orderStatus(o, 50, 100, { fulfil: 'Deliver' }).label).toBe('To deliver');
    expect(orderStatus(o, 100, 100).key).toBe('COMPLETED');
    expect(orderStatus({ ...o, isClosed: true }, 10, 0).key).toBe('CLOSED');
  });
});
