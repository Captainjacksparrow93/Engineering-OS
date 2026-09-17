import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  eachWorkingDay,
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

  it('calculates inclusive working-day task end dates (1-day step starts and ends on same day)', () => {
    // Mon 5 Oct 2026: 1-day step
    const start = d('2026-10-05');
    const end1Day = addWorkingDays(start, 1 - 1);
    expect(end1Day.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(workingDaysBetween(start, end1Day)).toBe(1);

    // 2-day step: Mon 5 Oct -> Tue 6 Oct
    const end2Days = addWorkingDays(start, 2 - 1);
    expect(end2Days.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(workingDaysBetween(start, end2Days)).toBe(2);
  });

  it('correctly calculates 13 sequential 1-day steps starting Monday 5 Oct (finishes Mon 19 Oct, skipping Sunday)', () => {
    const start = d('2026-10-05'); // Mon 5 Oct 2026
    let cursor = start;
    for (let step = 1; step <= 13; step++) {
      const stepStart = cursor;
      const stepEnd = addWorkingDays(stepStart, 1 - 1);
      cursor = addWorkingDays(stepEnd, 1);
      if (step === 13) {
        expect(stepEnd.toISOString().slice(0, 10)).toBe('2026-10-19');
        expect(workingDaysBetween(start, stepEnd)).toBe(13);
      }
    }
  });

  it('correctly calculates 13 sequential 2-day steps for PLC × 2 (26 working days)', () => {
    const start = d('2026-10-05'); // Mon 5 Oct 2026
    let cursor = start;
    let finalEnd = start;
    for (let step = 1; step <= 13; step++) {
      const stepStart = cursor;
      const stepEnd = addWorkingDays(stepStart, 2 - 1);
      cursor = addWorkingDays(stepEnd, 1);
      if (step === 13) {
        finalEnd = stepEnd;
      }
    }
    expect(workingDaysBetween(start, finalEnd)).toBe(26);
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

describe('Timeline ticks and working day generations', () => {
  it('generates exact 13 daily ticks for a standard 13-working-day project', () => {
    const start = d('2026-10-05'); // Mon 5 Oct
    const targetEnd = d('2026-10-19'); // Mon 19 Oct
    const workingDays = workingDaysBetween(start, targetEnd);
    expect(workingDays).toBe(13);

    const dayTicks = eachWorkingDay(start, targetEnd);
    expect(dayTicks.length).toBe(13);
    expect(dayTicks[0].toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(dayTicks[12].toISOString().slice(0, 10)).toBe('2026-10-19');
    // Ensure Sunday 11 Oct is excluded
    expect(dayTicks.some((dt: Date) => dt.toISOString().slice(0, 10) === '2026-10-11')).toBe(false);
  });

  it('generates exact 26 daily ticks for PLC x 2 (26 working days)', () => {
    const start = d('2026-10-05');
    const end = addWorkingDays(start, 26 - 1);
    const dayTicks = eachWorkingDay(start, end);
    expect(dayTicks.length).toBe(26);
  });
});


