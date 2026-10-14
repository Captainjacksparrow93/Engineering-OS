import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, staffOptions } from '@/modules/erp/services/access';
import { assetOptions } from '@/modules/erp/services/asset.service';
import { listLogs, MAINT_STATUS_LABEL } from '@/modules/erp/services/maintenance.service';
import { formatQty } from '@/modules/erp/domain/money';
import { reportBreakdownAction } from '@/app/actions/erp-assets';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Money, showDate } from '../../_components/parts';
import { AssetTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Breakdowns' };

export default async function BreakdownsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const sp = await searchParams;
  const manage = canManage(p, 'assets');
  const rows = await listLogs(p, { kind: 'BREAKDOWN', status: sp.status ?? 'OPEN_ALL' });
  const [assets, staff] = manage ? await Promise.all([assetOptions(p.companyId), staffOptions(p.companyId)]) : [[], []];
  return (
    <div className="space-y-lg">
      <PageHeader title="Breakdowns" subtitle="Machines that stopped, who is on it, and how long they were down." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Assets', href: '/erp/assets' }, { label: 'Breakdowns' }]} />
      <AssetTabs current="/erp/assets/breakdowns" />
      <form method="get" className="flex flex-wrap gap-sm">
        <select name="status" defaultValue={sp.status ?? 'OPEN_ALL'} className="select" aria-label="Status"><option value="OPEN_ALL">Open</option><option value="DONE">Repaired</option><option value="CANCELLED">Cancelled</option></select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="No breakdowns here" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Record</th><th>Asset</th><th>What went wrong</th><th>Reported</th><th>Assigned to</th><th className="text-right">Downtime</th><th className="text-right">Cost</th><th>Status</th></tr></thead>
              <tbody>{rows.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/erp/assets/maintenance/${l.id}`} className="code hover:underline">{l.number}</Link></td>
                  <td>{l.asset?.name}</td>
                  <td>{l.description.slice(0, 100)}</td>
                  <td>{showDate(l.reportedAt)}</td>
                  <td>{l.assignedTo}</td>
                  <td className="text-right">{l.downtimeHours ? `${formatQty(l.downtimeHours)} h` : '—'}</td>
                  <td className="text-right">{l.cost.isZero() ? '—' : <Money value={l.cost} />}</td>
                  <td><DocStatus status={l.status === 'DONE' ? 'COMPLETED' : l.status === 'OPEN' ? 'OVERDUE' : l.status} label={MAINT_STATUS_LABEL[l.status]} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      {manage && assets.length ? (
        <Card title="Report a breakdown">
          <ActionForm action={reportBreakdownAction} className="space-y-sm">
            <div className="grid gap-sm sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="assetId">Asset</label>
                <select id="assetId" name="assetId" className="select w-full" required defaultValue=""><option value="" disabled>Pick one</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="assignedToId">Assign to</label>
                <select id="assignedToId" name="assignedToId" className="select w-full" defaultValue=""><option value="">Maintenance managers</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="description">What went wrong</label>
              <textarea id="description" name="description" rows={3} required className="input w-full" />
            </div>
            <SubmitButton variant="danger">Report breakdown</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
