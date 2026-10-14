import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { Card, PageHeader } from '@/components/ui';
import { AccountsTabs } from '../tabs';

export const metadata = { title: 'Financial reports' };

const REPORTS = [
  { href: 'general-ledger', name: 'General ledger', about: 'Every posting to an account, party or project, with a running balance.' },
  { href: 'trial-balance', name: 'Trial balance', about: 'Opening, movement and closing for every account. Debits equal credits.' },
  { href: 'profit-and-loss', name: 'Profit and loss', about: 'Income less expenses for a period.' },
  { href: 'balance-sheet', name: 'Balance sheet', about: 'Assets, liabilities and equity on a date.' },
  { href: 'receivables', name: 'Accounts receivable', about: 'What customers owe, by days past due.' },
  { href: 'payables', name: 'Accounts payable', about: 'What we owe suppliers, by days past due.' },
  { href: 'gst', name: 'GST summary', about: 'Output and input GST for a period, and taxable value by rate.' },
  { href: 'projects', name: 'Project profitability', about: 'Income and cost booked to each PM project.' },
];

export default async function ReportsPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  return (
    <div className="space-y-lg">
      <PageHeader title="Financial reports" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Accounts', href: '/erp/accounts' }, { label: 'Reports' }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-4">
        {REPORTS.map((r) => (
          <Link key={r.href} href={`/erp/accounts/reports/${r.href}`} className="block">
            <Card title={r.name}><p className="text-body-sm text-muted">{r.about}</p></Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
