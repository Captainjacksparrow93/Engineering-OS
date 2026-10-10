import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SalesDealStage } from '@prisma/client';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listDeals, listSalespeople } from '@/modules/sales/services/deal.service';
import { seesAllDeals } from '@/modules/sales/services/access';
import { OPEN_STAGES } from '@/modules/sales/validation';
import { EmptyState, PageHeader } from '@/components/ui';
import { DealStageBadge, STAGE_NAMES } from '../_components/badges';
import { inrShort, shortDate } from '../_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deals' };

const STAGES: SalesDealStage[] = ['LEAD', 'QUALIFIED', 'QUOTED', 'NEGOTIATION', 'WON', 'LOST'];

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ stage?: string; owner?: string; q?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.deal.read')) notFound();
  const sp = await searchParams;
  const stage = STAGES.find((s) => s === sp.stage);
  const team = seesAllDeals(principal);
  const [deals, people] = await Promise.all([
    listDeals(principal, { stage, ownerId: sp.owner, q: sp.q }),
    team ? listSalespeople(principal) : Promise.resolve([]),
  ]);
  const canManage = hasPermissionAnywhere(principal, 'sales.deal.manage');
  const open = deals.filter((d) => (OPEN_STAGES as readonly string[]).includes(d.stage));
  const closed = deals.filter((d) => d.stage === 'WON' || d.stage === 'LOST').slice(0, 30);
  const columns = stage ? [stage] : [...OPEN_STAGES];

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Deals"
        subtitle={team ? 'Every salesperson’s deals' : 'Your deals'}
        actions={canManage ? <Link href="/sales/deals/new" className="btn btn-primary">New deal</Link> : null}
      />

      <form className="flex flex-wrap items-end gap-sm" method="get">
        <div>
          <label className="label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="Deal, code or client" className="input w-64" />
        </div>
        <div>
          <label className="label" htmlFor="stage">Stage</label>
          <select id="stage" name="stage" defaultValue={stage ?? ''} className="select">
            <option value="">Open stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_NAMES[s]}</option>)}
          </select>
        </div>
        {team ? (
          <div>
            <label className="label" htmlFor="owner">Salesperson</label>
            <select id="owner" name="owner" defaultValue={sp.owner ?? ''} className="select">
              <option value="">Everyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </div>
        ) : null}
        <button type="submit" className="btn btn-secondary">Show</button>
        {sp.q || sp.stage || sp.owner ? <Link href="/sales/deals" className="btn btn-text">Clear</Link> : null}
      </form>

      {deals.length === 0 ? (
        <EmptyState title="No deals match" hint={canManage ? 'Create a deal for each enquiry. It keeps the follow-ups, the BOM and every quote revision together.' : undefined} />
      ) : (
        <div className={`grid gap-base ${columns.length > 1 ? 'md:grid-cols-2 xl:grid-cols-4' : ''}`}>
          {columns.map((col) => {
            const items = (col === 'WON' || col === 'LOST' ? deals : open).filter((d) => d.stage === col);
            const total = items.reduce((s, d) => s + d.value, 0);
            return (
              <section key={col} className="rounded-lg border border-hairline bg-canvas-soft p-sm">
                <header className="mb-sm flex items-center justify-between">
                  <DealStageBadge stage={col} />
                  <span className="text-caption text-muted">{items.length} · {inrShort(total)}</span>
                </header>
                <ul className="space-y-xs">
                  {items.map((d) => (
                    <li key={d.id}>
                      <Link href={`/sales/deals/${d.id}`} className="block rounded-md border border-hairline bg-surface p-sm hover:border-hairline-strong">
                        <p className="text-body-sm font-medium text-ink">{d.title}</p>
                        <p className="text-caption text-muted">{d.account.name}</p>
                        <div className="mt-xxs flex items-center justify-between text-caption">
                          <span className="code">{d.code}</span>
                          <span className="text-ink">{d.value ? inrShort(d.value) : '—'}</span>
                        </div>
                        {team ? <p className="mt-xxs text-caption text-muted">{d.owner.fullName}</p> : null}
                        {d.nextFollowUp?.dueAt ? <p className="mt-xxs text-caption text-muted">Follow up {shortDate(d.nextFollowUp.dueAt)}</p> : null}
                      </Link>
                    </li>
                  ))}
                  {items.length === 0 ? <li className="text-caption text-muted-soft">No deals</li> : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {!stage && closed.length ? (
        <section>
          <h2 className="section-title mb-sm">Recently closed</h2>
          <table className="table">
            <thead><tr><th>Deal</th><th>Client</th>{team ? <th>Owner</th> : null}<th>Result</th><th className="text-right">Value</th><th>Closed</th></tr></thead>
            <tbody>
              {closed.map((d) => (
                <tr key={d.id}>
                  <td><Link href={`/sales/deals/${d.id}`} className="hover:underline"><span className="code mr-xs">{d.code}</span>{d.title}</Link></td>
                  <td>{d.account.name}</td>
                  {team ? <td>{d.owner.fullName}</td> : null}
                  <td><DealStageBadge stage={d.stage} /></td>
                  <td className="text-right">{inrShort(d.value)}</td>
                  <td>{shortDate(d.closedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
