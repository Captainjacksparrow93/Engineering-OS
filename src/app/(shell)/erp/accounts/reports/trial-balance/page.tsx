import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { trialBalance } from '@/modules/erp/services/reports.service';
import { Card, PageHeader } from '@/components/ui';
import { Money } from '../../../_components/parts';
import { AccountsTabs, RangeForm, rangeOf } from '../../tabs';
import { TreeTable } from '../tree-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trial balance' };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const r = rangeOf(await searchParams);
  const tb = await trialBalance(p, { from: r.fromDate, to: r.toDate });
  return (
    <div className="space-y-lg">
      <PageHeader title="Trial balance" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Reports', href: '/erp/accounts/reports' }, { label: 'Trial balance' }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <RangeForm from={r.from} to={r.to} />
      <Card>
        <TreeTable rows={tb.rows} headers={['Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr']} ledger={r} />
        <div className="mt-sm flex flex-wrap justify-end gap-lg text-body-sm font-medium">{['Opening', 'Period', 'Closing'].map((label, i) => (
          <span key={label}>{label}: <Money value={tb.totals[i * 2]} /> Dr · <Money value={tb.totals[i * 2 + 1]} /> Cr</span>
        ))}</div>
      </Card>
    </div>
  );
}
