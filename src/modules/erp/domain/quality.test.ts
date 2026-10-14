import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { acceptanceText, evaluateReading } from './quality';

const d = (n: number) => new Prisma.Decimal(n);

describe('quality readings', () => {
  it('checks numbers against their bounds', () => {
    const spec = { kind: 'NUMERIC' as const, minValue: d(1.5), maxValue: d(2.5), acceptanceValue: null };
    expect(evaluateReading(spec, '2')).toBe(true);
    expect(evaluateReading(spec, '2.6')).toBe(false);
    expect(evaluateReading(spec, '1.49')).toBe(false);
    expect(evaluateReading(spec, 'abc')).toBeNull();
    expect(evaluateReading(spec, '')).toBeNull();
    expect(acceptanceText(spec)).toBe('1.5 to 2.5');
    expect(evaluateReading({ ...spec, maxValue: null }, '100')).toBe(true);
  });

  it('checks text and pass/fail', () => {
    expect(evaluateReading({ kind: 'TEXT', minValue: null, maxValue: null, acceptanceValue: 'RAL 7035' }, 'ral 7035')).toBe(true);
    expect(evaluateReading({ kind: 'TEXT', minValue: null, maxValue: null, acceptanceValue: 'RAL 7035' }, 'RAL 7032')).toBe(false);
    expect(evaluateReading({ kind: 'CHECK', minValue: null, maxValue: null, acceptanceValue: null }, 'OK')).toBe(true);
    expect(evaluateReading({ kind: 'CHECK', minValue: null, maxValue: null, acceptanceValue: null }, 'fail')).toBe(false);
    expect(evaluateReading({ kind: 'CHECK', minValue: null, maxValue: null, acceptanceValue: null }, 'maybe')).toBeNull();
  });
});
