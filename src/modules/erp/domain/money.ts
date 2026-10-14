import { Prisma } from '@prisma/client';

/**
 * Exact decimal maths for quantities, rates and money. Never use JS numbers for these:
 * a 0.1 + 0.2 drift becomes an unbalanced voucher.
 */
export type Dec = Prisma.Decimal;
export const Dec = Prisma.Decimal;

export const ZERO = new Dec(0);

export function D(value: Prisma.Decimal.Value | null | undefined): Dec {
  return value === null || value === undefined || value === '' ? ZERO : new Dec(value);
}

/** Money: two places, half up (as ERPNext's default rounding). */
export const money = (v: Prisma.Decimal.Value) => D(v).toDecimalPlaces(2, Dec.ROUND_HALF_UP);
/** Quantities: three places. */
export const qty3 = (v: Prisma.Decimal.Value) => D(v).toDecimalPlaces(3, Dec.ROUND_HALF_UP);
/** Valuation rates: four places. */
export const rate4 = (v: Prisma.Decimal.Value) => D(v).toDecimalPlaces(4, Dec.ROUND_HALF_UP);

export function sum<T>(rows: T[], pick: (row: T) => Prisma.Decimal.Value | null | undefined): Dec {
  return rows.reduce<Dec>((acc, row) => acc.plus(D(pick(row))), ZERO);
}

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

/** ₹ 1,23,456.00 */
export function formatMoney(v: Prisma.Decimal.Value | null | undefined): string {
  return `₹ ${INR.format(D(v).toNumber())}`;
}

export function formatQty(v: Prisma.Decimal.Value | null | undefined): string {
  return QTY.format(D(v).toNumber());
}
