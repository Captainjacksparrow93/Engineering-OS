import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead, projectOptions } from '@/modules/erp/services/access';
import { generalLedger } from '@/modules/erp/services/reports.service';
import { postingAccounts } from '@/modules/erp/services/journal.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Money, ProjectSelect, showDate } from '../../../_components/parts';
import { PartySelect } from '../../payments/party-select';
import { AccountsTabs, RangeForm, rangeOf } from '../../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'General ledger' };

const VOUCHER_HREF: Record<string, string> = {
  'Sales Invoice': '/erp/selling/invoices/',
  'Purchase Invoice': '/erp/buying/invoices/',
  'Payment Entry': '/erp/accounts/payments/',
  'Journal Entry': '/erp/accounts/journals/',
  'Delivery Note': '/erp/selling/deliveries/',
  'Purchase Receipt': '/erp/buying/receipts/',
  'Stock Entry': '/erp/stock/entries/',
  'Stock Reconciliation': '/erp/stock/reconciliations/',
};

export default async function GeneralLedgerPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; party?: string; projectId?: string; voucher?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const sp = await searchParams;
  const r = rangeOf(sp);
  const [partyType, partyId] = (sp.party ?? '').split('|');
  const [accounts, customers, suppliers, projects] = await Promise.all([postingAccounts(p.companyId), partyOptions(p.companyId, 'CUSTOMER'), partyOptions(p.companyId, 'SUPPLIER'), projectOptions(p.companyId)]);
  const filtered = Boolean(sp.account || partyId || sp.projectId || sp.voucher);
  const gl = filtered
    ? await generalLedger(p, { from: r.fromDate, to: r.toDate, accountId: sp.account || null, partyType: partyType === 'CUSTOMER' || partyType === 'SUPPLIER' ? partyType : null, partyId: partyId || null, projectId: sp.projectId || null, voucherNo: sp.voucher || null })
    : null;
  return (
    <div className="space-y-lg">
      <PageHeader title="General ledger" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Reports', href: '/erp/accounts/reports' }, { label: 'General ledger' }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <RangeForm from={r.from} to={r.to}>
        <div>
          <label className="label" htmlFor="account">Account</label>
          <select id="account" name="account" defaultValue={sp.account ?? ''} className="select"><option value="">Any</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
        </div>
        <PartySelect customers={customers} suppliers={suppliers} value={sp.party} optional />
        <ProjectSelect projects={projects} defaultValue={sp.projectId} label="Project" />
        <div><label className="label" htmlFor="voucher">Voucher no.</label><input id="voucher" name="voucher" defaultValue={sp.voucher ?? ''} className="input w-44" /></div>
      </RangeForm>
      <Card>
        {!gl ? <EmptyState title="Pick an account, party, project or voucher" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Voucher</th><th>Account</th><th>Party</th><th>Remarks</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                <tr className="font-medium"><td colSpan={7}>Opening</td><td className="text-right"><Money value={gl.opening} /></td></tr>
                {gl.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{showDate(l.postingDate)}</td>
                    <td>{VOUCHER_HREF[l.voucherType] ? <Link href={`${VOUCHER_HREF[l.voucherType]}${l.voucherId}`} className="code hover:underline">{l.voucherNo}</Link> : <span className="code">{l.voucherNo}</span>}<div className="text-caption text-muted">{l.voucherType}</div></td>
                    <td><span className="code mr-xs">{l.account.code}</span>{l.account.name}</td>
                    <td>{l.partyName ?? ''}</td>
                    <td className="text-caption text-muted">{l.remarks ?? ''}</td>
                    <td className="text-right">{l.debit.isZero() ? '' : <Money value={l.debit} />}</td>
                    <td className="text-right">{l.credit.isZero() ? '' : <Money value={l.credit} />}</td>
                    <td className="text-right"><Money value={l.balance} /></td>
                  </tr>
                ))}
                <tr className="font-medium"><td colSpan={5}>Closing</td><td className="text-right"><Money value={gl.debit} /></td><td className="text-right"><Money value={gl.credit} /></td><td className="text-right"><Money value={gl.closing} /></td></tr>
              </tbody>
            </table>
            {gl.truncated ? <p className="mt-sm text-caption text-muted">Showing the first 3,000 rows. Narrow the dates to see the rest.</p> : null}
          </div>
        )}
      </Card>
    </div>
  );
}
