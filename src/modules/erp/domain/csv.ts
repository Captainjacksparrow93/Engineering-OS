import { Prisma } from '@prisma/client';

export type Cell = string | number | Date | Prisma.Decimal | null | undefined | boolean;

/**
 * RFC 4180 CSV. Text that a spreadsheet would run as a formula (= + - @, tab, CR) gets a
 * leading apostrophe; numbers and decimals are written as plain numbers; dates as YYYY-MM-DD.
 */
export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v instanceof Prisma.Decimal || typeof v === 'number') return v.toString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
