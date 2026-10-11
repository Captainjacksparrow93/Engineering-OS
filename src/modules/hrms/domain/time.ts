/**
 * Leave and attendance maths (plan 020, phase 2). Pure functions, no database.
 *
 * Calendar days are `YYYY-MM-DD` strings or UTC-midnight Dates (the `@db.Date` convention).
 * Clock times are minutes after midnight, India time. The plant works Monday to Saturday.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const dayDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const isSunday = (d: Date) => d.getUTCDay() === 0;

/** Minutes after midnight IST of an instant. */
export function istMinutes(at: Date): number {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** The instant at `minutes` past midnight IST on calendar day `key`. */
export function istInstant(key: string, minutes: number): Date {
  return new Date(dayDate(key).getTime() + minutes * 60_000 - IST_OFFSET_MS);
}

/** `9:05 am` from minutes after midnight. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** `7h 45m` */
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** Every calendar day from `from` to `to`, inclusive. */
export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) out.push(new Date(t));
  return out;
}

/** Leave days a request uses: Monday to Saturday, holidays excluded; a half day is 0.5. */
export function leaveDays(start: Date, end: Date, halfDay: boolean, holidays: ReadonlySet<string>): number {
  const working = eachDay(start, end).filter((d) => !isSunday(d) && !holidays.has(dayKey(d))).length;
  return halfDay ? Math.min(working, 1) / 2 : working;
}

// ---------------------------------------------------------------- daily status

export interface ShiftSettings {
  shiftStartMinutes: number;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
}

export type DayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'NO_DATA' | 'MISSED_PUNCH';

export interface DayInput {
  date: Date;
  today: Date;
  holiday: boolean;
  /** Approved leave on this day: full or half. */
  leave: 'FULL' | 'HALF' | null;
  /** Attendance has been imported for this day (anyone's). Without it a day is not absent, just unknown. */
  recorded: boolean;
  inMinutes: number | null;
  outMinutes: number | null;
}

export interface DayResult {
  status: DayStatus;
  workedMinutes: number;
  late: boolean;
  lateMinutes: number;
  overtimeMinutes: number;
}

/**
 * What one day counts as. Approved leave and holidays win over punches; a single punch is a
 * missed punch (the employee should ask for a correction); work on a Sunday or holiday all
 * counts as overtime.
 */
export function dayStatus(input: DayInput, s: ShiftSettings): DayResult {
  const worked = input.inMinutes != null && input.outMinutes != null && input.outMinutes > input.inMinutes ? input.outMinutes - input.inMinutes : 0;
  const lateMinutes = input.inMinutes != null ? Math.max(0, input.inMinutes - (s.shiftStartMinutes + s.graceMinutes)) : 0;
  const offDay = input.holiday || isSunday(input.date);
  const base = { workedMinutes: worked, late: false, lateMinutes: 0, overtimeMinutes: 0 };

  if (input.leave === 'FULL') return { ...base, status: 'LEAVE' };
  if (offDay) return { ...base, status: input.holiday ? 'HOLIDAY' : 'WEEKLY_OFF', overtimeMinutes: worked };
  if (input.inMinutes == null && input.outMinutes == null) {
    if (input.leave === 'HALF') return { ...base, status: 'HALF_LEAVE' };
    return { ...base, status: input.date >= input.today || !input.recorded ? 'NO_DATA' : 'ABSENT' };
  }
  const late = lateMinutes > 0 && input.leave !== 'HALF';
  const punchedOnce = input.inMinutes == null || input.outMinutes == null;
  // Today's single punch is just someone still at work.
  if (punchedOnce) return { ...base, status: input.date >= input.today ? 'NO_DATA' : 'MISSED_PUNCH', late, lateMinutes: late ? lateMinutes : 0 };
  if (input.leave === 'HALF') return { ...base, status: 'HALF_LEAVE', overtimeMinutes: Math.max(0, worked - s.halfDayMinutes) };
  const status: DayStatus = worked >= s.fullDayMinutes ? 'PRESENT' : worked >= s.halfDayMinutes ? 'HALF_DAY' : 'ABSENT';
  return { ...base, status, late, lateMinutes: late ? lateMinutes : 0, overtimeMinutes: Math.max(0, worked - s.fullDayMinutes) };
}

/** Days present for payroll: present 1, half day or half leave 0.5. */
export function presentValue(status: DayStatus): number {
  return status === 'PRESENT' ? 1 : status === 'HALF_DAY' || status === 'HALF_LEAVE' ? 0.5 : 0;
}

// ---------------------------------------------------------------- biometric CSV

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas or semicolons or tabs. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field.trim());
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** A date as Indian machines export it (day first), or ISO. Returns `YYYY-MM-DD` or null. */
export function parseDay(raw: string): string | null {
  const v = raw.trim();
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,4})[-/ ,]+(\d{2,4})$/))) {
    const month = MONTHS[match[2]!.toLowerCase()];
    if (!month) return null;
    [d, m, y] = [Number(match[1]), month, Number(match[3])];
  } else return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return dayKey(date);
}

/** `09:05`, `9:05:30`, `6:10 PM` → minutes after midnight; blank or `--:--` → null. */
export function parseClock(raw: string): number | null | 'invalid' {
  const v = raw.trim().toLowerCase();
  // No digits at all (blank, `--:--`, `NA`) means no punch.
  if (!/\d/.test(v)) return null;
  const match = v.match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return 'invalid';
  let h = Number(match[1]);
  const m = Number(match[2]);
  const meridiem = match[4];
  if (meridiem) {
    if (h < 1 || h > 12) return 'invalid';
    h = (h % 12) + (meridiem === 'pm' ? 12 : 0);
  }
  if (h > 23 || m > 59) return 'invalid';
  return h * 60 + m;
}

const HEADERS = {
  code: ['emp code', 'employee code', 'empcode', 'emp id', 'employee id', 'emp no', 'employee no', 'user id', 'userid', 'enroll no', 'enrollment no', 'card no', 'code', 'id'],
  date: ['date', 'att date', 'attendance date', 'punch date', 'log date'],
  in: ['in time', 'intime', 'in', 'first in', 'check in', 'checkin', 'punch in', 'in punch'],
  out: ['out time', 'outtime', 'out', 'last out', 'check out', 'checkout', 'punch out', 'out punch'],
  punch: ['punch time', 'time', 'log time', 'datetime', 'date time', 'punch', 'timestamp'],
} as const;

/** Header names compare without case, spaces or punctuation: `Emp_Code`, `EmpCode` and `emp code` match. */
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface AttendanceDay {
  code: string;
  date: string;
  inMinutes: number | null;
  outMinutes: number | null;
}

export interface ParsedAttendance {
  days: AttendanceDay[];
  rows: number;
  problems: string[];
}

/**
 * Reads a biometric export in either common shape:
 * - one row per employee per day with In and Out columns, or
 * - one row per punch (a date and a time column, or one date-time column); the first punch of
 *   the day is the in, the last is the out.
 * Columns are found by their header names; extra columns are ignored.
 */
export function parseAttendanceCsv(text: string): ParsedAttendance {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map(norm);
  const find = (names: readonly string[]) => {
    for (const name of names) {
      const i = header.indexOf(norm(name));
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = { code: find(HEADERS.code), date: find(HEADERS.date), in: find(HEADERS.in), out: find(HEADERS.out), punch: find(HEADERS.punch) };
  if (col.code < 0) return { days: [], rows: 0, problems: ['No employee code column. Name it "Emp Code" (or Employee Code, Enroll No, Card No).'] };
  const perPunch = col.in < 0 && col.out < 0;
  if (perPunch && col.punch < 0) return { days: [], rows: 0, problems: ['No time columns. Use "In Time" and "Out Time", or one "Punch Time" per row.'] };
  if (!perPunch && col.date < 0) return { days: [], rows: 0, problems: ['No "Date" column next to the In and Out times.'] };

  const problems: string[] = [];
  const byKey = new Map<string, AttendanceDay>();
  const body = table.slice(1);
  body.forEach((cells, i) => {
    const line = i + 2;
    const code = (cells[col.code] ?? '').trim();
    if (!code) return problems.push(`Row ${line}: no employee code.`);
    let date: string | null;
    let inMin: number | null;
    let outMin: number | null;
    if (perPunch) {
      const raw = (cells[col.punch] ?? '').trim();
      const datePart = col.date >= 0 ? cells[col.date] ?? '' : raw.split(/\s+/)[0] ?? '';
      const timePart = col.date >= 0 ? raw : raw.split(/\s+/).slice(1).join(' ');
      date = parseDay(datePart);
      const t = parseClock(timePart);
      if (!date) return problems.push(`Row ${line}: cannot read the date "${datePart}".`);
      if (t === 'invalid' || t === null) return problems.push(`Row ${line}: cannot read the time "${timePart}".`);
      inMin = t;
      outMin = t;
    } else {
      date = parseDay(cells[col.date] ?? '');
      if (!date) return problems.push(`Row ${line}: cannot read the date "${cells[col.date] ?? ''}".`);
      const a = col.in >= 0 ? parseClock(cells[col.in] ?? '') : null;
      const b = col.out >= 0 ? parseClock(cells[col.out] ?? '') : null;
      if (a === 'invalid' || b === 'invalid') return problems.push(`Row ${line}: cannot read the in or out time.`);
      inMin = a;
      outMin = b;
    }
    const key = `${code}|${date}`;
    const day = byKey.get(key);
    if (!day) {
      byKey.set(key, { code, date, inMinutes: inMin, outMinutes: perPunch ? null : outMin });
      return;
    }
    // More punches the same day: earliest in, latest out.
    const times = [day.inMinutes, day.outMinutes, inMin, outMin].filter((t): t is number => t != null);
    day.inMinutes = Math.min(...times);
    const last = Math.max(...times);
    day.outMinutes = last > day.inMinutes ? last : null;
  });
  return { days: [...byKey.values()], rows: body.length, problems };
}
