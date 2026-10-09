import { describe, it, expect } from 'vitest';
import { csvRecords, parseAmount, parseCsv, parseDate } from './csv';

describe('parseCsv', () => {
  it('handles quotes, embedded commas, newlines, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'two\nlines', ''],
    ]);
  });

  it('keeps a last row without a newline', () => {
    expect(parseCsv('a\n1')).toEqual([['a'], ['1']]);
  });
});

describe('csvRecords', () => {
  it('normalises headers', () => {
    expect(csvRecords('Item Code,Unit-Price\nCPU, 1200 ')).toEqual([{ item_code: 'CPU', unit_price: '1200' }]);
  });
  it('returns nothing for empty text', () => {
    expect(csvRecords('')).toEqual([]);
  });
});

describe('parseAmount / parseDate', () => {
  it('reads Indian-formatted amounts', () => {
    expect(parseAmount('₹ 1,23,456.50')).toBe(123456.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNaN();
  });

  it('reads ISO and day-first dates and rejects impossible ones', () => {
    expect(parseDate('2026-04-01')?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(parseDate('01/04/2026')?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(parseDate('31-02-2026')).toBeNull();
    expect(parseDate('April')).toBeNull();
  });
});
