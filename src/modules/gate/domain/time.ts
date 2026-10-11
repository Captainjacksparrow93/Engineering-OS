/**
 * India-time helpers for the visitor register. The server runs in UTC but the front desk
 * thinks in IST, so "today" and the times people type are always read as IST.
 */
export const IST = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `2026-10-12` + `10:30` typed in India → the instant. */
export function istDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}

/** The IST calendar date of an instant, as `YYYY-MM-DD`. */
export function istDateString(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** [start, end) of the IST day `date` (`YYYY-MM-DD`). */
export function istDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

const timeFormat = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true });
const dateFormat = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });

/** `10:30 am` */
export function formatTime(at: Date | null | undefined): string {
  return at ? timeFormat.format(at).toLowerCase() : '-';
}

/** `12 Oct 2026, 10:30 am`; today's times show the time alone. */
export function formatWhen(at: Date | null | undefined, now: Date = new Date()): string {
  if (!at) return '-';
  if (istDateString(at) === istDateString(now)) return formatTime(at);
  return `${dateFormat.format(at)}, ${formatTime(at)}`;
}
