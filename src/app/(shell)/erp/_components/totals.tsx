import type { Prisma } from '@prisma/client';
import { Money } from './parts';

/** Net, GST split and grand total, ERPNext's totals block. */
export function TotalsBlock({ t, outstanding }: { t: { netTotal: Prisma.Decimal; cgst: Prisma.Decimal; sgst: Prisma.Decimal; igst: Prisma.Decimal; grandTotal: Prisma.Decimal }; outstanding?: Prisma.Decimal | null }) {
  const row = (label: string, v: Prisma.Decimal, strong = false) => (
    <div className={`flex justify-between gap-lg ${strong ? 'font-medium text-ink' : ''}`}><dt>{label}</dt><dd><Money value={v} /></dd></div>
  );
  return (
    <dl className="ml-auto mt-base w-full max-w-xs space-y-xxs text-body-sm">
      {row('Net total', t.netTotal)}
      {!t.cgst.isZero() ? row('CGST', t.cgst) : null}
      {!t.sgst.isZero() ? row('SGST', t.sgst) : null}
      {!t.igst.isZero() ? row('IGST', t.igst) : null}
      {row('Grand total', t.grandTotal, true)}
      {outstanding ? row('Outstanding', outstanding, true) : null}
    </dl>
  );
}
