import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  formatDate,
  formatDateRange,
  formatRelativeDate,
  isWorkingDay,
  overlapDays,
  workingDaysBetween,
} from './dates';

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

describe('formatDate and formatRelativeDate', () => {
  const currentYear = new Date().getUTCFullYear();

  it('formats dates consistently', () => {
    expect(formatDate(d(`${currentYear}-09-15`))).toBe('15 Sept');
    expect(formatDate(d('2030-01-05'))).toBe('5 Jan 2030');
    expect(formatDate(null)).toBe('-');
  });

  it('formats relative dates accurately in plain English', () => {
    const base = d('2026-09-16');
    expect(formatRelativeDate(d('2026-09-16'), base)).toBe('today');
    expect(formatRelativeDate(d('2026-09-17'), base)).toBe('tomorrow');
    expect(formatRelativeDate(d('2026-09-15'), base)).toBe('yesterday');
    expect(formatRelativeDate(d('2026-09-21'), base)).toBe('in 5 days');
    expect(formatRelativeDate(d('2026-09-14'), base)).toBe('2 days late');
  });

  it('formats date ranges', () => {
    expect(formatDateRange(d(`${currentYear}-09-15`), d(`${currentYear}-09-20`))).toBe('15–20 Sept');
    expect(formatDateRange(d(`${currentYear}-09-28`), d(`${currentYear}-10-02`))).toBe('28 Sept – 2 Oct');
  });
});
