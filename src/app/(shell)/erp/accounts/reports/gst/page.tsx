import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { gstSummary } from '@/modules/erp/services/reports.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { Money } from '../../../_components/parts';
import { AccountsTabs, RangeForm, rangeOf } from '../../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'GST summary' };

export default async function GstPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const r = rangeOf(await searchParams);
  const g = await gstSummary(p, { from: r.fromDate, to: r.toDate });
  const side = (title: string, s: typeof g.output) => (
    <Card title={`${title} (${s.count} documents)`}>
      <table className="table">
        <tbody>
          <tr><td>Taxable value</td><td className="text-right"><Money value={s.taxable} /></td></tr>
          <tr><td>CGST</td><td className="text-right"><Money value={s.cgst} /></td></tr>
          <tr><td>SGST</td><td className="text-right"><Money value={s.sgst} /></td></tr>
          <tr><td>IGST</td><td className="text-right"><Money value={s.igst} /></td></tr>
        </tbody>
      </table>
      <p className="mb-xs mt-base text-caption uppercase text-muted">Taxable value by rate</p>
      <table className="table"><tbody>{s.byRate.map((b) => <tr key={b.rate}><td>{Number(b.rate)}%</td><td className="text-right"><Money value={b.taxable} /></td></tr>)}</tbody></table>
    </Card>
  );
  return (
    <div className="space-y-lg">
      <PageHeader title="GST summary" subtitle="From submitted invoices; credit and debit notes are netted. For the CA's filing, not a GSTR return." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Reports', href: '/erp/accounts/reports' }, { label: 'GST summary' }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <RangeForm from={r.from} to={r.to} />
      <Stat label={g.netPayable.lessThan(0) ? 'Input credit carried forward' : 'Net GST payable'} value={formatMoney(g.netPayable.abs())} />
      <div className="grid gap-lg lg:grid-cols-2">
        {side('Output tax on sales', g.output)}
        {side('Input tax on purchases', g.input)}
      </div>
    </div>
  );
}
