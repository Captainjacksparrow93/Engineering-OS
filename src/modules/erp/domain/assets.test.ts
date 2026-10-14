import { describe, expect, it } from 'vitest';
import { hoursBetween, monthEnd, nextDue, straightLineSchedule } from './assets';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('straightLineSchedule', () => {
  it('spreads gross − salvage evenly over the life, last row takes the rounding', () => {
    const rows = straightLineSchedule({ grossValue: 100000, salvageValue: 0, usefulLifeMonths: 3, availableForUseDate: d('2026-04-15') });
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual(['33333.33', '33333.33', '33333.34']);
    expect(rows.map((r) => iso(r.scheduleDate))).toEqual(['2026-04-30', '2026-05-31', '2026-06-30']);
    expect(rows.at(-1)!.accumulated.toFixed(2)).toBe('100000.00');
  });

  it('existing assets continue after the months already booked', () => {
    const rows = straightLineSchedule({ grossValue: 120000, salvageValue: 12000, usefulLifeMonths: 12, availableForUseDate: d('2026-01-10'), openingAccumulated: 54000, openingMonths: 6 });
    expect(rows).toHaveLength(6);
    expect(rows[0]!.amount.toFixed(2)).toBe('9000.00');
    expect(iso(rows[0]!.scheduleDate)).toBe('2026-07-31');
    expect(rows.at(-1)!.accumulated.toFixed(2)).toBe('108000.00');
  });

  it('nothing to depreciate gives no rows', () => {
    expect(straightLineSchedule({ grossValue: 1000, salvageValue: 1000, usefulLifeMonths: 12, availableForUseDate: d('2026-01-01') })).toEqual([]);
    expect(straightLineSchedule({ grossValue: 1000, salvageValue: 0, usefulLifeMonths: 6, availableForUseDate: d('2026-01-01'), openingMonths: 6 })).toEqual([]);
  });
});

describe('dates', () => {
  it('monthEnd handles February and year ends', () => {
    expect(iso(monthEnd(d('2028-02-10')))).toBe('2028-02-29');
    expect(iso(monthEnd(d('2026-12-10'), 1))).toBe('2027-01-31');
  });
  it('nextDue steps by the frequency and clamps month ends', () => {
    expect(iso(nextDue(d('2026-01-31'), 'MONTHLY'))).toBe('2026-02-28');
    expect(iso(nextDue(d('2026-01-01'), 'WEEKLY'))).toBe('2026-01-08');
    expect(iso(nextDue(d('2026-11-15'), 'QUARTERLY'))).toBe('2027-02-15');
    expect(iso(nextDue(d('2026-08-31'), 'HALF_YEARLY'))).toBe('2027-02-28');
    expect(iso(nextDue(d('2026-04-01'), 'YEARLY'))).toBe('2027-04-01');
  });
  it('hoursBetween never goes negative', () => {
    expect(hoursBetween(new Date('2026-01-01T08:00:00Z'), new Date('2026-01-01T17:30:00Z')).toFixed(2)).toBe('9.50');
    expect(hoursBetween(new Date('2026-01-02T00:00:00Z'), new Date('2026-01-01T00:00:00Z')).toFixed(2)).toBe('0.00');
  });
});
