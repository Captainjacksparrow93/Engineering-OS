import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listAccounts } from '@/modules/sales/services/account.service';
import { listSalespeople } from '@/modules/sales/services/deal.service';
import { seesAllDeals } from '@/modules/sales/services/access';
import { createDealAction } from '@/app/actions/sales';
import { Card, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '@/components/action-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New deal' };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.deal.manage')) notFound();
  const { account } = await searchParams;
  const team = seesAllDeals(principal);
  const [accounts, people] = await Promise.all([listAccounts(principal), team ? listSalespeople(principal) : Promise.resolve([])]);

  return (
    <div className="max-w-2xl space-y-lg">
      <PageHeader title="New deal" breadcrumb={[{ label: 'Deals', href: '/sales/deals' }, { label: 'New deal' }]} />
      <Card>
        <ActionForm action={createDealAction} className="space-y-base">
          <div>
            <label className="label" htmlFor="title">What is the enquiry?</label>
            <input id="title" name="title" required minLength={3} className="input w-full" placeholder="e.g. MCC and PLC panels for the new tablet line" />
          </div>
          <div className="grid gap-base sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="accountId">Client</label>
              <select id="accountId" name="accountId" defaultValue={account ?? ''} className="select w-full">
                <option value="">New client (type below)</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.city ? `, ${a.city}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="newAccountName">Or a new client</label>
              <input id="newAccountName" name="newAccountName" className="input w-full" placeholder="Client name" />
            </div>
          </div>
          <div className="grid gap-base sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="value">Estimated value (₹)</label>
              <input id="value" name="value" type="number" min={0} step="any" className="input w-full" placeholder="Optional" />
            </div>
            <div>
              <label className="label" htmlFor="expectedCloseDate">Expected order date</label>
              <input id="expectedCloseDate" name="expectedCloseDate" type="date" className="input w-full" />
            </div>
            <div>
              <label className="label" htmlFor="source">Source</label>
              <input id="source" name="source" className="input w-full" placeholder="Referral, tender, repeat…" list="deal-sources" />
              <datalist id="deal-sources">
                {['Repeat client', 'Referral', 'Tender', 'Website', 'Exhibition', 'Cold call', 'Consultant'].map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>
          {team ? (
            <div>
              <label className="label" htmlFor="ownerId">Owner</label>
              <select id="ownerId" name="ownerId" defaultValue={principal.userId} className="select w-full">
                {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                {people.some((p) => p.id === principal.userId) ? null : <option value={principal.userId}>{principal.fullName}</option>}
              </select>
            </div>
          ) : null}
          <div>
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={3} className="textarea w-full" placeholder="Scope, site, decision makers, competition" />
          </div>
          <SubmitButton variant="primary" pendingLabel="Creating…">Create deal</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
