import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes, escapes and formats', () => {
    expect(toCsv([['Item', 'Qty'], ['Relay, 24V "DIN"', new Prisma.Decimal('12.500')], [null, -3]])).toBe('Item,Qty\r\n"Relay, 24V ""DIN""",12.5\r\n,-3\r\n');
  });
  it('neutralises spreadsheet formulas in text but not in numbers', () => {
    expect(toCsv([['=HYPERLINK("x")', '-cmd', 5]])).toBe(`"'=HYPERLINK(""x"")",'-cmd,5\r\n`);
  });
  it('writes dates as ISO days', () => {
    expect(toCsv([[new Date('2026-04-01T00:00:00Z'), true]])).toBe('2026-04-01,Yes\r\n');
  });
});
