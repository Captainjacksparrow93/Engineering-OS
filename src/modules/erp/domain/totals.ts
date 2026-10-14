import type { Prisma } from '@prisma/client';
import { D, Dec, money, ZERO } from './money';
import { splitGst } from './gst';

export interface TaxLine {
  amount: Prisma.Decimal.Value;
  gstRate: Prisma.Decimal.Value;
}

export interface Totals {
  netTotal: Dec;
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
  grandTotal: Dec;
}

/**
 * Document totals with GST, ERPNext style: tax is worked out once per GST rate on the
 * taxable total at that rate (not per line), so lines never accumulate rounding.
 */
export function computeTotals(lines: TaxLine[], companyState: string | null | undefined, partyState: string | null | undefined): Totals {
  const byRate = new Map<string, Dec>();
  for (const l of lines) {
    const key = D(l.gstRate).toFixed(2);
    byRate.set(key, (byRate.get(key) ?? ZERO).plus(money(l.amount)));
  }
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;
  let netTotal = ZERO;
  for (const [rate, taxable] of byRate) {
    netTotal = netTotal.plus(taxable);
    const g = splitGst(taxable, D(rate), companyState, partyState);
    cgst = cgst.plus(g.cgst);
    sgst = sgst.plus(g.sgst);
    igst = igst.plus(g.igst);
  }
  return { netTotal, cgst, sgst, igst, grandTotal: netTotal.plus(cgst).plus(sgst).plus(igst) };
}

/** Billing/receipt progress of an order, ERPNext's "% received" / "% billed". */
export function percent(done: Dec, total: Dec): number {
  if (total.isZero()) return 100;
  return Math.min(100, Math.round(done.dividedBy(total).times(100).toNumber()));
}

/**
 * The status ERPNext derives for a submitted order from its fulfilment:
 * To Receive and Bill → To Bill / To Receive → Completed (or Closed / Cancelled / Draft).
 */
export function orderStatus(
  o: { status: 'DRAFT' | 'SUBMITTED' | 'CANCELLED'; isClosed: boolean },
  fulfilled: number,
  billed: number,
  words: { fulfil: string } = { fulfil: 'Receive' },
): { key: string; label: string } {
  if (o.status === 'DRAFT') return { key: 'DRAFT', label: 'Draft' };
  if (o.status === 'CANCELLED') return { key: 'CANCELLED', label: 'Cancelled' };
  if (o.isClosed) return { key: 'CLOSED', label: 'Closed' };
  if (fulfilled >= 100 && billed >= 100) return { key: 'COMPLETED', label: 'Completed' };
  if (fulfilled >= 100) return { key: 'TO_BILL', label: 'To bill' };
  if (billed >= 100) return { key: 'TO_FULFIL', label: `To ${words.fulfil.toLowerCase()}` };
  return { key: 'TO_FULFIL_AND_BILL', label: `To ${words.fulfil.toLowerCase()} and bill` };
}

/** Due date from posting date and payment terms. */
export function dueDate(postingDate: Date, termsDays: number): Date {
  return new Date(postingDate.getTime() + Math.max(0, termsDays) * 86_400_000);
}
