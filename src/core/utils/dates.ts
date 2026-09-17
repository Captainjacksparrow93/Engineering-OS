/**
 * Working-day arithmetic. The plant runs Mon-Sat, so a plain `+n days` would put
 * deadlines on Sundays and quietly inflate every schedule.
 */
const SUNDAY = 0;

export function isWorkingDay(date: Date): boolean {
  return date.getUTCDay() !== SUNDAY;
}

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Adds `count` working days, skipping Sundays. Negative counts walk backwards. */
export function addWorkingDays(date: Date, count: number): Date {
  if (count === 0) return startOfDay(date);
  const step = count > 0 ? 1 : -1;
  let remaining = Math.abs(count);
  let cursor = startOfDay(date);
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isWorkingDay(cursor)) remaining -= 1;
  }
  return cursor;
}

/** Inclusive count of working days between two dates. */
export function workingDaysBetween(from: Date, to: Date): number {
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  if (cursor > end) return 0;
  let days = 0;
  while (cursor <= end) {
    if (isWorkingDay(cursor)) days += 1;
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function eachWorkingDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor <= end) {
    if (isWorkingDay(cursor)) out.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return 0;
  return workingDaysBetween(start, end);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'] as const;

export function formatDate(
  date: Date | string | null | undefined,
  options?: { forceYear?: boolean }
): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';

  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();

  if (options?.forceYear || year !== currentYear) {
    return `${day} ${month} ${year}`;
  }
  return `${day} ${month}`;
}

export function formatRelativeDate(
  date: Date | string | null | undefined,
  baseDate: Date = new Date()
): string {
  if (!date) return '-';
  const target = startOfDay(typeof date === 'string' ? new Date(date) : date);
  if (isNaN(target.getTime())) return '-';
  const base = startOfDay(baseDate);
  const days = Math.round((target.getTime() - base.getTime()) / 86_400_000);

  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days late`;
}

export function formatDateRange(
  from: Date | string | null | undefined,
  to: Date | string | null | undefined
): string {
  if (!from && !to) return '-';
  if (!from) return formatDate(to);
  if (!to) return formatDate(from);

  const f = typeof from === 'string' ? new Date(from) : from;
  const t = typeof to === 'string' ? new Date(to) : to;
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return '-';

  const fDay = f.getUTCDate();
  const fMonth = MONTHS[f.getUTCMonth()];
  const fYear = f.getUTCFullYear();

  const tDay = t.getUTCDate();
  const tMonth = MONTHS[t.getUTCMonth()];
  const tYear = t.getUTCFullYear();

  const currentYear = new Date().getUTCFullYear();

  if (fYear === tYear) {
    const showYear = fYear !== currentYear;
    if (fMonth === tMonth) {
      if (fDay === tDay) return formatDate(f);
      return showYear ? `${fDay}–${tDay} ${fMonth} ${fYear}` : `${fDay}–${tDay} ${fMonth}`;
    }
    return showYear
      ? `${fDay} ${fMonth} – ${tDay} ${tMonth} ${fYear}`
      : `${fDay} ${fMonth} – ${tDay} ${tMonth}`;
  }

  return `${fDay} ${fMonth} ${fYear} – ${tDay} ${tMonth} ${tYear}`;
}

export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = startOfDay(typeof date === 'string' ? new Date(date) : date);
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
}

/**
 * Proportionally paces step durations across an available working window.
 * Ensures each step has at least 1 working day and the sum equals totalWorkingDays.
 */
export function paceStepDurations(
  totalWorkingDays: number,
  baseDurations: number[],
): number[] {
  if (baseDurations.length === 0) return [];
  const sumBase = baseDurations.reduce((a, b) => a + b, 0);
  if (totalWorkingDays <= sumBase) return baseDurations;

  let allocated = 0;
  const result: number[] = [];
  for (let i = 0; i < baseDurations.length; i++) {
    if (i === baseDurations.length - 1) {
      result.push(Math.max(1, totalWorkingDays - allocated));
    } else {
      const share = Math.max(1, Math.floor((baseDurations[i] / sumBase) * totalWorkingDays));
      result.push(share);
      allocated += share;
    }
  }
  return result;
}
