import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listAccounts } from '@/modules/sales/services/account.service';
import { TIER_LABELS } from '@/modules/sales/domain/intelligence';
import { createAccountAction } from '@/app/actions/sales';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '../_components/action-form';
import { inrShort, shortDate } from '../_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accounts' };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.deal.read')) notFound();
  const { q } = await searchParams;
  const accounts = await listAccounts(principal, { q });
  const canManage = hasPermissionAnywhere(principal, 'sales.deal.manage');

  return (
    <div className="space-y-lg">
      <PageHeader title="Accounts" subtitle="Every client and prospect, with the relationship the pricing advice uses." />

      <div className="grid gap-lg lg:grid-cols-[1fr_320px]">
        <div className="space-y-sm">
          <form method="get" className="flex gap-sm">
            <input name="q" defaultValue={q ?? ''} placeholder="Search clients" className="input w-72" aria-label="Search clients" />
            <button type="submit" className="btn btn-secondary">Search</button>
          </form>
          {accounts.length === 0 ? (
            <EmptyState title="No clients yet" hint="Clients are added with a new deal, here, or by importing past quotes." />
          ) : (
            <table className="table">
              <thead><tr><th>Client</th><th>Relationship</th><th className="text-right">Orders</th><th className="text-right">Ordered in total</th><th className="text-right">Open deals</th><th>Last quote</th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/sales/accounts/${a.id}`} className="text-ink hover:underline">{a.name}</Link>
                      {a.city ? <span className="text-caption text-muted"> · {a.city}</span> : null}
                    </td>
                    <td><span className={`badge ${a.tier === 'WATCH' ? 'badge-error' : a.tier === 'STRATEGIC' || a.tier === 'KEY' ? 'badge-ink' : 'badge-outline'}`}>{TIER_LABELS[a.tier]}</span></td>
                    <td className="text-right">{a.wonOrders}</td>
                    <td className="text-right">{a.totalWonValue ? inrShort(a.totalWonValue) : '—'}</td>
                    <td className="text-right">{a.openDeals ? `${a.openDeals} · ${inrShort(a.openValue)}` : '—'}</td>
                    <td>{shortDate(a.lastQuoteDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {canManage ? (
          <Card title="Add a client">
            <ActionForm action={createAccountAction} className="space-y-sm">
              <input name="name" required minLength={2} placeholder="Client name" className="input w-full" aria-label="Client name" />
              <input name="city" placeholder="City" className="input w-full" aria-label="City" />
              <input name="industry" placeholder="Industry (pharma, water, cement…)" className="input w-full" aria-label="Industry" />
              <input name="clientRef" placeholder="ACS reference, if any" className="input w-full" aria-label="ACS reference" />
              <SubmitButton>Add client</SubmitButton>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
