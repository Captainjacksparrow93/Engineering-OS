import { describe, expect, it } from 'vitest';
import { addWorkingDays, isWorkingDay, overlapDays, workingDaysBetween } from './dates';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('working-day arithmetic', () => {
  it('treats Sunday as a non-working day and Saturday as a working one', () => {
    expect(isWorkingDay(d('2026-01-11'))).toBe(false); // Sunday
    expect(isWorkingDay(d('2026-01-10'))).toBe(true); // Saturday
  });

  it('skips Sunday when adding days', () => {
    // Saturday + 1 working day is Monday.
    expect(addWorkingDays(d('2026-01-10'), 1).toISOString().slice(0, 10)).toBe('2026-01-12');
  });

  it('walks backwards too', () => {
    expect(addWorkingDays(d('2026-01-12'), -1).toISOString().slice(0, 10)).toBe('2026-01-10');
  });

  it('counts inclusively, excluding Sundays', () => {
    expect(workingDaysBetween(d('2026-01-05'), d('2026-01-11'))).toBe(6);
  });

  it('returns zero overlap for disjoint ranges', () => {
    expect(overlapDays(d('2026-01-05'), d('2026-01-06'), d('2026-01-08'), d('2026-01-09'))).toBe(0);
  });

  it('counts the intersection of overlapping ranges', () => {
    expect(overlapDays(d('2026-01-05'), d('2026-01-09'), d('2026-01-07'), d('2026-01-12'))).toBe(3);
  });
});
