import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { canPostDepreciation, depreciationDue } from '@/modules/erp/services/asset.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { postDepreciationAction } from '@/app/actions/erp-assets';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Money, isoDay, showDate } from '../../_components/parts';
import { AssetTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Depreciation' };

export default async function DepreciationPage({ searchParams }: { searchParams: Promise<{ upTo?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const sp = await searchParams;
  const now = new Date();
  const fallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const upTo = sp.upTo && /^\d{4}-\d{2}-\d{2}$/.test(sp.upTo) ? new Date(`${sp.upTo}T00:00:00.000Z`) : fallback;
  const due = await depreciationDue(p, upTo);
  return (
    <div className="space-y-lg">
      <PageHeader title="Depreciation" subtitle="Straight-line, monthly. Posting books Dr Depreciation, Cr Accumulated Depreciation at each month end." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Assets', href: '/erp/assets' }, { label: 'Depreciation' }]} />
      <AssetTabs current="/erp/assets/depreciation" />
      <form method="get" className="flex flex-wrap items-end gap-sm">
        <div><label className="label" htmlFor="upTo">Due up to</label><input id="upTo" type="date" name="upTo" defaultValue={isoDay(upTo)} className="input" /></div>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      <Card title={`Not yet posted, up to ${showDate(upTo)}`} action={due.rows && canPostDepreciation(p) ? (
        <ActionForm action={postDepreciationAction} className="inline-block">
          <input type="hidden" name="upTo" value={isoDay(upTo)} />
          <SubmitButton size="sm" variant="primary" confirm={`Post ${formatMoney(due.amount)} of depreciation?`}>Post {due.rows} {due.rows === 1 ? 'entry' : 'entries'}</SubmitButton>
        </ActionForm>
      ) : null}>
        {due.rows === 0 ? <EmptyState title="Everything due is posted" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Asset</th><th>#</th><th>Date</th><th className="text-right">Amount</th><th className="text-right">Accumulated after</th></tr></thead>
              <tbody>{due.list.map((r) => (
                <tr key={r.id}><td><Link href={`/erp/assets/register/${r.asset.id}`} className="code mr-xs hover:underline">{r.asset.number}</Link>{r.asset.name}</td><td>{r.seq}</td><td>{showDate(r.scheduleDate)}</td><td className="text-right"><Money value={r.amount} /></td><td className="text-right"><Money value={r.accumulated} /></td></tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={3} className="font-medium">Total</td><td className="text-right font-medium"><Money value={due.amount} /></td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
