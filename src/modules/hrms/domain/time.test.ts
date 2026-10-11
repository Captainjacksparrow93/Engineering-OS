import { describe, expect, it } from 'vitest';
import { dayDate, dayStatus, formatDuration, formatMinutes, istInstant, istMinutes, leaveDays, parseAttendanceCsv, parseClock, parseCsv, parseDay, presentValue } from './time';

const S = { shiftStartMinutes: 570, graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240 };
const today = dayDate('2026-10-14'); // Wednesday
const day = (key: string, rest: Partial<Parameters<typeof dayStatus>[0]> = {}) =>
  dayStatus({ date: dayDate(key), today, holiday: false, leave: null, recorded: true, inMinutes: null, outMinutes: null, ...rest }, S);

describe('leave days', () => {
  it('counts Monday to Saturday and skips holidays', () => {
    // Fri 9 Oct to Tue 13 Oct 2026: Fri, Sat, (Sun), Mon, Tue = 4; minus a Monday holiday = 3.
    expect(leaveDays(dayDate('2026-10-09'), dayDate('2026-10-13'), false, new Set())).toBe(4);
    expect(leaveDays(dayDate('2026-10-09'), dayDate('2026-10-13'), false, new Set(['2026-10-12']))).toBe(3);
    expect(leaveDays(dayDate('2026-10-12'), dayDate('2026-10-12'), true, new Set())).toBe(0.5);
    expect(leaveDays(dayDate('2026-10-11'), dayDate('2026-10-11'), false, new Set())).toBe(0);
  });
});

describe('day status', () => {
  it('reads full, half, short and late days', () => {
    expect(day('2026-10-12', { inMinutes: 570, outMinutes: 1080 })).toMatchObject({ status: 'PRESENT', workedMinutes: 510, late: false, overtimeMinutes: 30 });
    expect(day('2026-10-12', { inMinutes: 600, outMinutes: 1080 })).toMatchObject({ status: 'PRESENT', late: true, lateMinutes: 15 });
    expect(day('2026-10-12', { inMinutes: 570, outMinutes: 900 })).toMatchObject({ status: 'HALF_DAY' });
    expect(day('2026-10-12', { inMinutes: 570, outMinutes: 700 })).toMatchObject({ status: 'ABSENT' });
    expect(day('2026-10-12')).toMatchObject({ status: 'ABSENT' });
    expect(day('2026-10-12', { inMinutes: 570 })).toMatchObject({ status: 'MISSED_PUNCH' });
    expect(day('2026-10-14', { inMinutes: 570 })).toMatchObject({ status: 'NO_DATA' });
    expect(day('2026-10-15')).toMatchObject({ status: 'NO_DATA' });
    expect(day('2026-10-12', { recorded: false })).toMatchObject({ status: 'NO_DATA' });
  });

  it('lets leave and holidays win, and counts off-day work as overtime', () => {
    expect(day('2026-10-12', { leave: 'FULL', inMinutes: 570, outMinutes: 1080 })).toMatchObject({ status: 'LEAVE' });
    expect(day('2026-10-12', { leave: 'HALF' })).toMatchObject({ status: 'HALF_LEAVE' });
    expect(day('2026-10-12', { leave: 'HALF', inMinutes: 840, outMinutes: 1080 })).toMatchObject({ status: 'HALF_LEAVE', late: false });
    expect(day('2026-10-11')).toMatchObject({ status: 'WEEKLY_OFF' });
    expect(day('2026-10-11', { inMinutes: 600, outMinutes: 780 })).toMatchObject({ status: 'WEEKLY_OFF', overtimeMinutes: 180 });
    expect(day('2026-10-12', { holiday: true })).toMatchObject({ status: 'HOLIDAY' });
    expect([presentValue('PRESENT'), presentValue('HALF_DAY'), presentValue('HALF_LEAVE'), presentValue('ABSENT')]).toEqual([1, 0.5, 0.5, 0]);
  });
});

describe('clock and dates', () => {
  it('converts IST minutes both ways and formats them', () => {
    const at = istInstant('2026-10-12', 570);
    expect(at.toISOString()).toBe('2026-10-12T04:00:00.000Z');
    expect(istMinutes(at)).toBe(570);
    expect(formatMinutes(570)).toBe('9:30 am');
    expect(formatMinutes(0)).toBe('12:00 am');
    expect(formatMinutes(780)).toBe('1:00 pm');
    expect(formatDuration(465)).toBe('7h 45m');
  });

  it('reads Indian and ISO dates, day first', () => {
    expect(parseDay('12-10-2026')).toBe('2026-10-12');
    expect(parseDay('12/10/26')).toBe('2026-10-12');
    expect(parseDay('2026-10-12')).toBe('2026-10-12');
    expect(parseDay('12-Oct-2026')).toBe('2026-10-12');
    expect(parseDay('12 Sept 2026')).toBe('2026-09-12');
    expect(parseDay('31-02-2026')).toBeNull();
    expect(parseDay('hello')).toBeNull();
  });

  it('reads clock times', () => {
    expect(parseClock('09:05')).toBe(545);
    expect(parseClock('9:05:59')).toBe(545);
    expect(parseClock('6:10 PM')).toBe(1090);
    expect(parseClock('12:15 am')).toBe(15);
    expect(parseClock('--:--')).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock('25:00')).toBe('invalid');
  });
});

describe('biometric CSV', () => {
  it('parses quoted CSV with any of three delimiters', () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('reads one row per day with In and Out columns', () => {
    const r = parseAttendanceCsv('Emp Code,Name,Date,In Time,Out Time,Status\n5,Asha,12-10-2026,09:31,18:40,P\n5,Asha,13-10-2026,09:50,,MIS\n7,Ravi,32-10-2026,09:00,18:00,P\n');
    expect(r.rows).toBe(3);
    expect(r.days).toEqual([
      { code: '5', date: '2026-10-12', inMinutes: 571, outMinutes: 1120 },
      { code: '5', date: '2026-10-13', inMinutes: 590, outMinutes: null },
    ]);
    expect(r.problems).toEqual(['Row 4: cannot read the date "32-10-2026".']);
  });

  it('reads one row per punch: first is in, last is out', () => {
    const r = parseAttendanceCsv('EnrollNo,Punch Time\n5,12/10/2026 09:31:10\n5,12/10/2026 13:02\n5,12/10/2026 18:40\n7,12/10/2026 10:00\n');
    expect(r.days).toEqual([
      { code: '5', date: '2026-10-12', inMinutes: 571, outMinutes: 1120 },
      { code: '7', date: '2026-10-12', inMinutes: 600, outMinutes: null },
    ]);
    const split = parseAttendanceCsv('Employee Code,Date,Time\nACS-0008,2026-10-12,9:40 AM\nACS-0008,2026-10-12,6:30 PM\n');
    expect(split.days).toEqual([{ code: 'ACS-0008', date: '2026-10-12', inMinutes: 580, outMinutes: 1110 }]);
  });

  it('explains a file it cannot read', () => {
    expect(parseAttendanceCsv('Name,Date\nAsha,12-10-2026').problems[0]).toContain('No employee code column');
    expect(parseAttendanceCsv('Emp Code,Name\n5,Asha').problems[0]).toContain('No time columns');
  });
});
