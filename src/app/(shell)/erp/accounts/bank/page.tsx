import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { bankReconciliation } from '@/modules/erp/services/ledger.service';
import { paymentAccounts } from '@/modules/erp/services/payment.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { setClearanceAction } from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { isoDay, Money, showDate } from '../../_components/parts';
import { AccountsTabs, RangeForm, rangeOf } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bank reconciliation' };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ account?: string; from?: string; to?: string; cleared?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const sp = await searchParams;
  const r = rangeOf(sp);
  const banks = await paymentAccounts(p.companyId);
  const accountId = sp.account && banks.some((b) => b.id === sp.account) ? sp.account : banks.find((b) => b.accountType === 'BANK')?.id ?? banks[0]?.id;
  const rec = accountId ? await bankReconciliation(p, accountId, r.fromDate, r.toDate, sp.cleared === '1') : null;
  const manage = canManage(p, 'accounts');
  return (
    <div className="space-y-lg">
      <PageHeader title="Bank reconciliation" subtitle="Set the date each payment shows on the bank statement; what is left explains the difference." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Accounts', href: '/erp/accounts' }, { label: 'Bank reconciliation' }]} />
      <AccountsTabs current="/erp/accounts/bank" />
      <RangeForm from={r.from} to={r.to}>
        <div>
          <label className="label" htmlFor="account">Account</label>
          <select id="account" name="account" defaultValue={accountId} className="select">{banks.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</select>
        </div>
        <label className="flex items-center gap-xs pb-xs text-body-sm"><input type="checkbox" name="cleared" value="1" defaultChecked={sp.cleared === '1'} /> Show cleared</label>
      </RangeForm>
      {!rec ? <EmptyState title="No bank or cash accounts" /> : (
        <>
          <div className="grid gap-base sm:grid-cols-4">
            <Stat label={`Books, ${showDate(r.toDate)}`} value={formatMoney(rec.booksBalance)} />
            <Stat label="Deposits not cleared" value={formatMoney(rec.unclearedDeposits)} />
            <Stat label="Payments not cleared" value={formatMoney(rec.unclearedWithdrawals)} />
            <Stat label="Should match the bank" value={formatMoney(rec.bankBalance)} />
          </div>
          <Card>
            {rec.lines.length === 0 ? <EmptyState title="Everything is cleared" /> : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Voucher</th><th>Date</th><th>Party / remarks</th><th>Reference</th><th className="text-right">Deposit</th><th className="text-right">Withdrawal</th><th>Cleared on</th></tr></thead>
                  <tbody>{rec.lines.map((l) => (
                    <tr key={`${l.kind}-${l.id}`}>
                      <td><Link href={l.kind === 'payment' ? `/erp/accounts/payments/${l.id}` : `/erp/accounts/journals/${l.id}`} className="code hover:underline">{l.number}</Link></td>
                      <td>{showDate(l.postingDate)}</td>
                      <td>{l.party ?? ''}</td>
                      <td className="text-caption text-muted">{l.referenceNo ?? ''}</td>
                      <td className="text-right">{l.deposit.isZero() ? '' : <Money value={l.deposit} />}</td>
                      <td className="text-right">{l.withdrawal.isZero() ? '' : <Money value={l.withdrawal} />}</td>
                      <td>
                        {manage ? (
                          <ActionForm action={setClearanceAction} className="flex items-center gap-xs">
                            <input type="hidden" name="kind" value={l.kind} />
                            <input type="hidden" name="id" value={l.id} />
                            <input type="date" name="clearanceDate" defaultValue={isoDay(l.clearanceDate)} className="input w-40" aria-label={`Clearance date for ${l.number}`} />
                            <SubmitButton size="sm">Save</SubmitButton>
                          </ActionForm>
                        ) : l.clearanceDate ? showDate(l.clearanceDate) : '—'}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
