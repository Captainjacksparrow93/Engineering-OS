import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { ageing, AGEING_BUCKETS } from '@/modules/erp/services/reports.service';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Money } from '../../_components/parts';
import { AccountsTabs } from '../tabs';

/** Receivable or payable ageing by party, as of today. */
export async function AgeingReport({ kind }: { kind: 'RECEIVABLE' | 'PAYABLE' }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const today = new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const a = await ageing(p, kind, today);
  const title = kind === 'RECEIVABLE' ? 'Accounts receivable' : 'Accounts payable';
  const partyType = kind === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER';
  return (
    <div className="space-y-lg">
      <PageHeader title={title} subtitle="Open invoices by days past their due date, as of today. Credit is unused advances and credit/debit notes." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Reports', href: '/erp/accounts/reports' }, { label: title }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <Card>
        {a.rows.length === 0 ? <EmptyState title="Nothing outstanding" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>{kind === 'RECEIVABLE' ? 'Customer' : 'Supplier'}</th>{AGEING_BUCKETS.map((b) => <th key={b} className="text-right">{b}</th>)}<th className="text-right">Total</th><th className="text-right">Credit</th><th className="text-right">Net</th></tr></thead>
              <tbody>{a.rows.map((r) => (
                <tr key={r.partyId}>
                  <td><Link href={`/erp/accounts/reports/general-ledger?party=${partyType}|${r.partyId}&from=2000-01-01`} className="hover:underline">{r.name}</Link></td>
                  {r.buckets.map((b, i) => <td key={i} className={`text-right ${i >= 3 && !b.isZero() ? 'text-error' : ''}`}>{b.isZero() ? '' : <Money value={b} />}</td>)}
                  <td className="text-right font-medium"><Money value={r.total} /></td>
                  <td className="text-right">{r.credit.isZero() ? '' : <Money value={r.credit} />}</td>
                  <td className="text-right"><Money value={r.net} /></td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="font-medium"><td>Total</td>{a.totals.map((t, i) => <td key={i} className="text-right"><Money value={t} /></td>)}<td className="text-right"><Money value={a.total} /></td><td className="text-right"><Money value={a.credit} /></td><td className="text-right"><Money value={a.total.minus(a.credit)} /></td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
