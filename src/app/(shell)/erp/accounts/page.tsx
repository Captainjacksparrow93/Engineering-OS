import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { accountsOverview } from '@/modules/erp/services/reports.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { Money } from '../_components/parts';
import { AccountsTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accounts' };

export default async function AccountsPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const today = new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const o = await accountsOverview(p, today);
  return (
    <div className="space-y-lg">
      <PageHeader title="Accounts" subtitle={`Fiscal year ${o.fy.label}`} breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Accounts' }]} />
      <AccountsTabs current="/erp/accounts" />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Customers owe us" value={formatMoney(o.receivable)} hint={o.overdueCount ? `${formatMoney(o.overdue)} overdue on ${o.overdueCount} invoices` : 'Nothing overdue'} tone={o.overdueCount ? 'warning' : 'default'} />
        <Stat label="We owe suppliers" value={formatMoney(o.payable)} />
        <Stat label={`Income, ${o.fy.label}`} value={formatMoney(o.income)} hint={`Expenses ${formatMoney(o.expense)}`} />
        <Stat label={`Profit, ${o.fy.label}`} value={formatMoney(o.profit)} tone={o.profit.lessThan(0) ? 'warning' : 'default'} />
      </div>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Bank and cash">
          <table className="table"><tbody>{o.banks.map((b) => (
            <tr key={b.id}><td><Link href={`/erp/accounts/reports/general-ledger?account=${b.id}`} className="hover:underline"><span className="code mr-xs">{b.code}</span>{b.name}</Link></td><td className="text-right"><Money value={b.balance} /></td></tr>
          ))}</tbody></table>
        </Card>
        <Card title="To do">
          <ul className="space-y-xs text-body-sm">
            <li><Link href="/erp/accounts/payments?status=DRAFT" className="hover:underline">{o.draftPayments} draft payments</Link></li>
            <li><Link href="/erp/accounts/journals?status=DRAFT" className="hover:underline">{o.draftJournals} draft journal entries</Link></li>
            <li><Link href="/erp/accounts/reports/receivables" className="hover:underline">Receivable ageing</Link> · <Link href="/erp/accounts/reports/payables" className="hover:underline">Payable ageing</Link></li>
            <li><Link href="/erp/accounts/bank" className="hover:underline">Reconcile the bank</Link></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
