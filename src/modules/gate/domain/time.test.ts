import { describe, expect, it } from 'vitest';
import { formatTime, formatWhen, istDateString, istDateTime, istDayRange } from './time';

describe('gate IST time helpers', () => {
  it('reads a typed date and time as India time', () => {
    expect(istDateTime('2026-10-12', '10:30').toISOString()).toBe('2026-10-12T05:00:00.000Z');
  });

  it('puts 01:00 IST on the IST date, not the UTC date', () => {
    expect(istDateString(new Date('2026-10-11T19:30:00Z'))).toBe('2026-10-12');
    expect(istDateString(new Date('2026-10-11T18:29:00Z'))).toBe('2026-10-11');
  });

  it('gives a 24-hour IST day range', () => {
    const { start, end } = istDayRange('2026-10-12');
    expect(start.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-12T18:30:00.000Z');
  });

  it('formats times in IST and drops the date for today', () => {
    const at = istDateTime('2026-10-12', '14:05');
    expect(formatTime(at)).toBe('2:05 pm');
    expect(formatWhen(at, istDateTime('2026-10-12', '09:00'))).toBe('2:05 pm');
    expect(formatWhen(at, istDateTime('2026-10-13', '09:00'))).toBe('12 Oct 2026, 2:05 pm');
    expect(formatWhen(null)).toBe('-');
  });
});
