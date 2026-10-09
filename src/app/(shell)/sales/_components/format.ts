import { formatINR } from '@/modules/sales/domain/pricing';

export { formatINR };

/** ₹ in lakh / crore for tiles and cards. */
export function inrShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatINR(n, 0);
}

export const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const isoDay = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');
