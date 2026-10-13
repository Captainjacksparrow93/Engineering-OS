import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { compareQuotations } from '@/modules/erp/services/supplier-quotation.service';
import { EmptyState, PageHeader } from '@/components/ui';
import { Money, Qty, showDate } from '../../../_components/parts';
import { BuyingTabs } from '../../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compare supplier prices' };

/** ERPNext Supplier Quotation Comparison: valid quotes per item, cheapest first. */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ mr?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const { mr } = await searchParams;
  const rows = await compareQuotations(p, { materialRequestId: mr, today: new Date() });
  return (
    <div className="space-y-lg">
      <PageHeader title="Compare supplier prices" subtitle={mr ? 'Quotes received against one material request.' : 'Every submitted quotation that is still valid.'} breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Supplier quotations', href: '/erp/buying/quotations' }, { label: 'Compare' }]} />
      <BuyingTabs current="/erp/buying/quotations" />
      {rows.length === 0 ? <EmptyState title="No quotations to compare" hint="Submit supplier quotations first." /> : rows.map(({ item, quotes }) => (
        <section key={item.id} className="card">
          <header className="card-header"><h2 className="card-title"><span className="code mr-xs">{item.code}</span>{item.name}</h2></header>
          <div className="card-body">
            <table className="table">
              <thead><tr><th>Supplier</th><th>Quotation</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th>Lead time</th><th>Valid till</th></tr></thead>
              <tbody>
                {quotes.map((q, i) => (
                  <tr key={q.id} className={i === 0 ? 'font-medium text-ink' : ''}>
                    <td>{q.supplierName}{i === 0 ? <span className="badge badge-success ml-xs">Lowest</span> : null}</td>
                    <td><Link href={`/erp/buying/quotations/${q.quotation.id}`} className="code hover:underline">{q.quotation.number}</Link></td>
                    <td className="text-right"><Qty value={q.qty} uom={item.uom} /></td>
                    <td className="text-right"><Money value={q.rate} /></td>
                    <td>{q.leadTimeDays ? `${q.leadTimeDays} days` : '—'}</td>
                    <td>{showDate(q.quotation.validTill)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
