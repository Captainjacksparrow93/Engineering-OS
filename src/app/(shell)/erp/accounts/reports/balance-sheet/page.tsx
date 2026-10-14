import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { balanceSheet } from '@/modules/erp/services/reports.service';
import { Alert, Card, PageHeader } from '@/components/ui';
import { Money } from '../../../_components/parts';
import { AccountsTabs, rangeOf } from '../../tabs';
import { TreeTable } from '../tree-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Balance sheet' };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const r = rangeOf(await searchParams);
  const bs = await balanceSheet(p, r.toDate);
  return (
    <div className="space-y-lg">
      <PageHeader title="Balance sheet" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Reports', href: '/erp/accounts/reports' }, { label: 'Balance sheet' }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <form method="get" className="flex flex-wrap items-end gap-sm">
        <div><label className="label" htmlFor="to">As on</label><input id="to" type="date" name="to" defaultValue={r.to} className="input" /></div>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {!bs.difference.isZero() ? <Alert tone="warning">Assets and liabilities differ by ₹ {bs.difference.toFixed(2)}. Check opening balances.</Alert> : null}
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Assets">
          <TreeTable rows={bs.assets} headers={['Amount']} ledger={{ from: '2000-01-01', to: r.to }} />
          <p className="mt-sm text-right font-medium">Total assets <Money value={bs.totalAssets} /></p>
        </Card>
        <Card title="Liabilities and equity">
          <TreeTable rows={bs.liabilities} headers={['Amount']} ledger={{ from: '2000-01-01', to: r.to }} />
          <TreeTable rows={bs.equity} headers={['Amount']} ledger={{ from: '2000-01-01', to: r.to }} />
          <p className="mt-sm flex justify-between text-body-sm"><span>Profit not yet closed</span><Money value={bs.unclosedProfit} /></p>
          <p className="mt-sm text-right font-medium">Total <Money value={bs.totalLiabilities.plus(bs.totalEquity)} /></p>
        </Card>
      </div>
    </div>
  );
}
