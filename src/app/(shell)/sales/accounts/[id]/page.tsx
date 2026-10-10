import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { getAccount } from '@/modules/sales/services/account.service';
import { TIER_LABELS } from '@/modules/sales/domain/intelligence';
import { addContactAction, removeContactAction, updateAccountAction, updateRelationshipAction } from '@/app/actions/sales';
import { Card, PageHeader, Stat } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '../../_components/action-form';
import { DealStageBadge } from '../../_components/badges';
import { inrShort, isoDay, pct, shortDate } from '../../_components/format';
import { median } from '@/modules/sales/domain/intelligence';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Client' };

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  let data;
  try {
    data = await getAccount(principal, id);
  } catch {
    notFound();
  }
  const { account, relationship: rel, contacts, deals, recentHistory } = data;
  const canManage = hasPermissionAnywhere(principal, 'sales.deal.manage');
  const canRelate = hasPermissionAnywhere(principal, 'sales.account.manage');
  const wonMedian = median(rel.stats.wonMargins);
  const lostMedian = median(rel.stats.lostMargins);

  return (
    <div className="space-y-lg">
      <PageHeader
        title={account.name}
        breadcrumb={[{ label: 'Accounts', href: '/sales/accounts' }, { label: account.name }]}
        subtitle={[account.city, account.industry, account.clientRef].filter(Boolean).join(' · ') || undefined}
        actions={canManage ? <Link href={`/sales/deals/new?account=${account.id}`} className="btn btn-primary">New deal</Link> : null}
      />

      <div className="grid grid-cols-2 gap-base md:grid-cols-5">
        <Stat label="Relationship" value={TIER_LABELS[rel.profile.tier]} tone={rel.profile.tier === 'WATCH' ? 'danger' : 'default'} />
        <Stat label="Client for" value={rel.customerSince ? `${Math.floor(rel.yearsWithUs * 10) / 10} yrs` : '—'} hint={rel.customerSince ? `since ${shortDate(rel.customerSince)}` : 'No order yet'} />
        <Stat label="Orders" value={rel.stats.wonOrders} hint={`${rel.profile.repeatOrders} repeat`} />
        <Stat label="Ordered in total" value={inrShort(rel.stats.totalWonValue)} />
        <Stat label="Margin won / lost at" value={`${wonMedian === null ? '—' : pct(wonMedian)} / ${lostMedian === null ? '—' : pct(lostMedian)}`} hint="Median, past quotes with cost" />
      </div>

      <div className="grid gap-lg lg:grid-cols-3">
        <div className="space-y-lg lg:col-span-2">
          <Card title="Deals" bodyClassName="p-0">
            {deals.length === 0 ? (
              <p className="p-base text-body-sm text-muted">No deals you can see.</p>
            ) : (
              <table className="table">
                <thead><tr><th>Deal</th><th>Stage</th><th>Owner</th><th className="text-right">Value</th><th>Updated</th></tr></thead>
                <tbody>
                  {deals.map((d) => (
                    <tr key={d.id}>
                      <td><Link href={`/sales/deals/${d.id}`} className="hover:underline"><span className="code mr-xs">{d.code}</span>{d.title}</Link></td>
                      <td><DealStageBadge stage={d.stage} /></td>
                      <td>{d.owner.fullName}</td>
                      <td className="text-right">{d.value ? inrShort(d.value) : '—'}</td>
                      <td>{shortDate(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="History" bodyClassName="p-0">
            {recentHistory.length === 0 ? (
              <p className="p-base text-body-sm text-muted">No past quotes or orders yet. Import them under Past quotes.</p>
            ) : (
              <table className="table">
                <thead><tr><th>Ref</th><th>Result</th><th>From</th><th className="text-right">Lines</th><th>Date</th></tr></thead>
                <tbody>
                  {recentHistory.map((h) => (
                    <tr key={`${h.ref}-${h.source}`}>
                      <td className="code">{h.ref}</td>
                      <td><span className={`badge ${h.outcome === 'WON' ? 'badge-success' : h.outcome === 'LOST' ? 'badge-error' : 'badge-outline'}`}>{h.outcome === 'WON' ? 'Won' : h.outcome === 'LOST' ? 'Lost' : 'Open'}</span></td>
                      <td>{h.source === 'IMPORT' ? 'Imported' : 'This app'}</td>
                      <td className="text-right">{h.lines}</td>
                      <td>{shortDate(h.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-lg">
          <Card title="What drives the price advice">
            {rel.profile.reasons.length ? (
              <ul className="space-y-xxs text-caption">
                {rel.profile.reasons.map((r) => (
                  <li key={r.label} className="flex justify-between gap-sm">
                    <span>{r.label}</span>
                    <span className={r.deltaPct > 0 ? 'text-success' : 'text-error'}>{r.deltaPct > 0 ? '+' : ''}{r.deltaPct} pts</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted">No relationship adjustment yet: quotes start from the company target margin.</p>
            )}
            {canRelate ? (
              <ActionForm action={updateRelationshipAction} className="mt-base space-y-sm border-t border-hairline pt-base">
                <input type="hidden" name="accountId" value={account.id} />
                <label className="flex items-center gap-xs text-body-sm"><input type="checkbox" name="strategic" defaultChecked={account.strategic} /> Strategic account</label>
                <div className="grid grid-cols-2 gap-sm">
                  <div>
                    <label className="label" htmlFor="paymentDelayDays">Pays late by (days)</label>
                    <input id="paymentDelayDays" name="paymentDelayDays" type="number" min={0} defaultValue={account.paymentDelayDays ?? ''} className="input w-full" />
                  </div>
                  <div>
                    <label className="label" htmlFor="customerSince">Client since</label>
                    <input id="customerSince" name="customerSince" type="date" defaultValue={isoDay(account.customerSince)} className="input w-full" />
                  </div>
                </div>
                <SubmitButton size="sm">Save relationship</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>

          <Card title="Contacts">
            {contacts.length === 0 ? <p className="text-body-sm text-muted">No contacts yet.</p> : null}
            <ul className="space-y-sm">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-sm text-body-sm">
                  <div>
                    <p className="text-ink">{c.name}{c.designation ? `, ${c.designation}` : ''}</p>
                    <p className="text-caption text-muted">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>
                  </div>
                  {canManage ? (
                    <ActionForm action={removeContactAction} quiet>
                      <input type="hidden" name="contactId" value={c.id} />
                      <input type="hidden" name="accountId" value={account.id} />
                      <SubmitButton size="sm" variant="secondary" confirm={`Remove ${c.name}?`}>Remove</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {canManage ? (
              <ActionForm action={addContactAction} resetOnSuccess className="mt-base space-y-xs border-t border-hairline pt-base">
                <input type="hidden" name="accountId" value={account.id} />
                <input name="name" required placeholder="Name" className="input w-full" aria-label="Name" />
                <input name="designation" placeholder="Designation" className="input w-full" aria-label="Designation" />
                <input name="email" type="email" placeholder="Email" className="input w-full" aria-label="Email" />
                <input name="phone" placeholder="Phone" className="input w-full" aria-label="Phone" />
                <SubmitButton size="sm">Add contact</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>

          {canManage ? (
            <Card title="Details">
              <ActionForm action={updateAccountAction} className="space-y-xs">
                <input type="hidden" name="accountId" value={account.id} />
                <input name="name" defaultValue={account.name} required className="input w-full" aria-label="Client name" />
                <input name="city" defaultValue={account.city ?? ''} placeholder="City" className="input w-full" aria-label="City" />
                <input name="industry" defaultValue={account.industry ?? ''} placeholder="Industry" className="input w-full" aria-label="Industry" />
                <input name="clientRef" defaultValue={account.clientRef ?? ''} placeholder="ACS reference" className="input w-full" aria-label="ACS reference" />
                <textarea name="notes" defaultValue={account.notes ?? ''} rows={3} placeholder="Notes" className="textarea w-full" aria-label="Notes" />
                <SubmitButton size="sm">Save details</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
