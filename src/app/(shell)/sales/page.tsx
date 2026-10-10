import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { getSalesDashboard } from '@/modules/sales/services/dashboard.service';
import { completeActivityAction } from '@/app/actions/sales';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { ActionForm } from './_components/action-form';
import { DealStageBadge } from './_components/badges';
import { inrShort, pct, shortDate } from './_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales' };

export default async function SalesOverviewPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.deal.read')) notFound();
  const d = await getSalesDashboard(principal);
  const canManage = hasPermissionAnywhere(principal, 'sales.deal.manage');
  const maxStageValue = Math.max(1, ...d.byStage.map((s) => s.value));

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Sales"
        subtitle={d.scope === 'team' ? 'Whole team, last 90 days for won and win rate' : 'Your deals, last 90 days for won and win rate'}
        actions={canManage ? <Link href="/sales/deals/new" className="btn btn-primary">New deal</Link> : null}
      />

      <div className="grid grid-cols-2 gap-base md:grid-cols-4">
        <Stat label="Open pipeline" value={inrShort(d.kpis.pipeline)} hint={`${d.kpis.openDeals} open deal${d.kpis.openDeals === 1 ? '' : 's'}`} />
        <Stat label="Weighted pipeline" value={inrShort(d.kpis.weighted)} hint="Value × chance of winning per stage" />
        <Stat label="Won, 90 days" value={inrShort(d.kpis.wonValue90)} tone={d.kpis.wonValue90 > 0 ? 'success' : 'default'} />
        <Stat label="Win rate, 90 days" value={d.kpis.winRate90 === null ? '—' : pct(d.kpis.winRate90)} hint={`${d.kpis.closed90} closed`} />
      </div>

      {d.pendingApprovals.length > 0 ? (
        <Card title={`Quotes waiting for your approval (${d.pendingApprovals.length})`} action={<Link href="/sales/approvals" className="link-muted text-body-sm">Open approvals</Link>}>
          <ul className="divide-y divide-hairline-soft">
            {d.pendingApprovals.slice(0, 5).map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-base py-xs">
                <Link href={`/sales/quotes/${q.id}`} className="text-body-sm text-ink hover:underline">
                  <span className="code-chip mr-xs">{q.number} R{q.revision}</span>
                  {q.deal.account.name}: {q.deal.title}
                </Link>
                <span className="text-body-sm text-error">{pct(q.totals.marginPct)} margin</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-lg lg:grid-cols-3">
        <Card title="Pipeline by stage" className="lg:col-span-2">
          {d.kpis.openDeals === 0 ? (
            <EmptyState title="No open deals" hint="Start with a new deal. Its quote builds the BOM at today's prices." action={canManage ? <Link href="/sales/deals/new" className="btn btn-secondary">New deal</Link> : undefined} />
          ) : (
            <ul className="space-y-sm">
              {d.byStage.map((s) => (
                <li key={s.stage}>
                  <Link href={`/sales/deals?stage=${s.stage}`} className="flex items-center gap-base">
                    <span className="w-28 shrink-0"><DealStageBadge stage={s.stage} /></span>
                    <span className="h-2 flex-1 rounded-full bg-surface-strong">
                      <span className="block h-2 rounded-full bg-ink" style={{ width: `${Math.max(2, (s.value / maxStageValue) * 100)}%` }} />
                    </span>
                    <span className="w-32 text-right text-body-sm text-ink">{inrShort(s.value)}</span>
                    <span className="w-16 text-right text-caption text-muted">{s.count} deal{s.count === 1 ? '' : 's'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Follow-ups due">
          {d.followUps.length === 0 ? (
            <p className="text-body-sm text-muted">Nothing due today.</p>
          ) : (
            <ul className="space-y-sm">
              {d.followUps.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-sm">
                  <div className="min-w-0">
                    <Link href={`/sales/deals/${f.deal.id}`} className="block truncate text-body-sm text-ink hover:underline">{f.note}</Link>
                    <p className="truncate text-caption text-muted">
                      {f.deal.account.name} · <span className={f.overdue ? 'text-error' : ''}>{f.overdue ? 'overdue since ' : 'due '}{shortDate(f.dueAt)}</span>
                      {d.scope === 'team' ? ` · ${f.deal.owner.fullName}` : ''}
                    </p>
                  </div>
                  <ActionForm action={completeActivityAction} quiet>
                    <input type="hidden" name="activityId" value={f.id} />
                    <input type="hidden" name="dealId" value={f.deal.id} />
                    <button type="submit" className="btn btn-sm btn-secondary">Done</button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Approved, not yet sent">
          {d.readyToSend.length === 0 ? (
            <p className="text-body-sm text-muted">No approved quotes waiting to go out.</p>
          ) : (
            <ul className="space-y-xs">
              {d.readyToSend.map((q) => (
                <li key={q.id}>
                  <Link href={`/sales/quotes/${q.id}`} className="text-body-sm text-ink hover:underline">
                    <span className="code-chip mr-xs">{q.number} R{q.revision}</span>
                    {q.deal.account.name}: {q.deal.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Gone quiet (no activity in ${d.config.followUpDays} days)`}>
          {d.quiet.length === 0 ? (
            <p className="text-body-sm text-muted">Every open deal has recent activity or a follow-up.</p>
          ) : (
            <ul className="space-y-xs">
              {d.quiet.map((q) => (
                <li key={q.id} className="flex justify-between gap-sm text-body-sm">
                  <Link href={`/sales/deals/${q.id}`} className="truncate text-ink hover:underline">
                    <span className="code-chip mr-xs">{q.code}</span>
                    {q.account}: {q.title}
                  </Link>
                  <span className="shrink-0 text-caption text-muted">{shortDate(q.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {d.scope === 'team' ? (
        <Card title="Team" bodyClassName="p-0">
          {d.team.length === 0 ? (
            <p className="p-base text-body-sm text-muted">No open deals yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Salesperson</th>
                  <th className="text-right">Open deals</th>
                  <th className="text-right">Open value</th>
                  <th className="text-right">Won, 90 days</th>
                  <th className="text-right">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {d.team.map((t) => (
                  <tr key={t.ownerId}>
                    <td><Link href={`/sales/deals?owner=${t.ownerId}`} className="hover:underline">{t.name}</Link></td>
                    <td className="text-right">{t.openDeals}</td>
                    <td className="text-right">{inrShort(t.openValue)}</td>
                    <td className="text-right">{inrShort(t.wonValue)}</td>
                    <td className="text-right">{t.winRate === null ? '—' : pct(t.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {d.staleItems > 0 ? (
        <p className="text-body-sm text-muted">
          {d.staleItems} catalogue item{d.staleItems === 1 ? ' has' : 's have'} no price or a price older than {d.config.priceStaleDays} days.{' '}
          <Link href="/sales/catalog?filter=stale" className="link-muted">Review prices</Link>
        </p>
      ) : null}
    </div>
  );
}
