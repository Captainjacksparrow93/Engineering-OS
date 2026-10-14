import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { canPostDepreciation } from '@/modules/erp/services/asset.service';
import { assetsOverview, MAINT_STATUS_LABEL } from '@/modules/erp/services/maintenance.service';
import { FREQUENCY_LABEL } from '@/modules/erp/domain/assets';
import { formatMoney, formatQty } from '@/modules/erp/domain/money';
import { postDepreciationAction } from '@/app/actions/erp-assets';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocButton } from '../_components/doc-button';
import { DocStatus, isoDay, showDate } from '../_components/parts';
import { AssetTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assets and maintenance' };

export default async function AssetsPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const o = await assetsOverview(p);
  const overdue = o.due.filter((d) => d.overdue);
  return (
    <div className="space-y-lg">
      <PageHeader title="Assets and maintenance" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Assets' }]} />
      <AssetTabs current="/erp/assets" />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Assets in use" value={o.inUse} hint={formatMoney(o.grossValue)} />
        <Stat label="Maintenance due this week" value={o.due.length} tone={overdue.length ? 'warning' : 'default'} hint={overdue.length ? `${overdue.length} overdue` : undefined} />
        <Stat label="Machines down" value={o.breakdowns.length} tone={o.breakdowns.length ? 'warning' : 'default'} />
        <Stat label="Downtime, 30 days" value={`${formatQty(o.downtime30)} h`} hint={`Repair cost ${formatMoney(o.cost30)}`} />
      </div>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Maintenance due" action={<Link href="/erp/assets/maintenance" className="link-muted text-caption">All tasks</Link>}>
          {o.due.length === 0 ? <EmptyState title="Nothing due this week" /> : (
            <table className="table"><tbody>{o.due.slice(0, 10).map((d) => (
              <tr key={d.id}>
                <td><Link href={`/erp/assets/register/${d.assetId}`} className="hover:underline">{d.asset?.name}</Link></td>
                <td>{d.task}<div className="text-caption text-muted">{FREQUENCY_LABEL[d.frequency]} · {d.assignedTo}</div></td>
                <td className={d.overdue ? 'text-error' : ''}>{showDate(d.nextDueDate)}</td>
              </tr>
            ))}</tbody></table>
          )}
        </Card>
        <Card title="Open breakdowns" action={<Link href="/erp/assets/breakdowns" className="link-muted text-caption">All</Link>}>
          {o.breakdowns.length === 0 ? <EmptyState title="Every machine is running" /> : (
            <table className="table"><tbody>{o.breakdowns.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/erp/assets/maintenance/${b.id}`} className="code hover:underline">{b.number}</Link></td>
                <td>{b.asset?.name}<div className="text-caption text-muted">{b.description.slice(0, 80)}</div></td>
                <td><DocStatus status={b.status} label={MAINT_STATUS_LABEL[b.status]} /></td>
              </tr>
            ))}</tbody></table>
          )}
        </Card>
      </div>
      <Card title={`Depreciation due by ${showDate(o.monthEnd)}`}>
        {o.depreciationDue.rows === 0 ? <EmptyState title="Nothing to post" /> : (
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="text-body-sm">{o.depreciationDue.rows} {o.depreciationDue.rows === 1 ? 'entry' : 'entries'} across {o.depreciationDue.assets} {o.depreciationDue.assets === 1 ? 'asset' : 'assets'}, {formatMoney(o.depreciationDue.amount)}.</p>
            {canPostDepreciation(p) ? <DocButton action={postDepreciationAction} fields={{ upTo: isoDay(o.monthEnd) }} label="Post depreciation" variant="primary" confirm={`Post ${formatMoney(o.depreciationDue.amount)} of depreciation up to ${showDate(o.monthEnd)}?`} /> : null}
          </div>
        )}
      </Card>
    </div>
  );
}
