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

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = startOfDay(typeof date === 'string' ? new Date(date) : date);
  const today = startOfDay(new Date());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}
