import { Dec, money, ZERO } from './money';

export interface GstSplit {
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
}

/**
 * Indian GST on a taxable amount. Same state (or either state unknown) → CGST + SGST,
 * half the rate each; different states → IGST at the full rate.
 */
export function splitGst(taxable: Dec, ratePct: Dec, companyState: string | null | undefined, partyState: string | null | undefined): GstSplit {
  const interState = !!companyState && !!partyState && norm(companyState) !== norm(partyState);
  if (interState) return { cgst: ZERO, sgst: ZERO, igst: money(taxable.times(ratePct).dividedBy(100)) };
  const half = money(taxable.times(ratePct).dividedBy(200));
  return { cgst: half, sgst: half, igst: ZERO };
}

const norm = (s: string) => s.trim().toLowerCase();

export const gstTotal = (g: GstSplit) => g.cgst.plus(g.sgst).plus(g.igst);

/** Indian states and union territories, for the party and company state pickers. */
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

