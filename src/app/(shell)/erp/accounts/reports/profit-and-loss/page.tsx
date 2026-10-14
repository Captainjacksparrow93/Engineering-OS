import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { profitAndLoss } from '@/modules/erp/services/reports.service';
import { formatMoney } from '@/modules/erp/domain/money';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { AccountsTabs, RangeForm, rangeOf } from '../../tabs';
import { TreeTable } from '../tree-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profit and loss' };

export default async function ProfitAndLossPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const r = rangeOf(await searchParams);
  const pl = await profitAndLoss(p, { from: r.fromDate, to: r.toDate });
  return (
    <div className="space-y-lg">
      <PageHeader title="Profit and loss" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Reports', href: '/erp/accounts/reports' }, { label: 'Profit and loss' }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <RangeForm from={r.from} to={r.to} />
      <div className="grid gap-base sm:grid-cols-3">
        <Stat label="Income" value={formatMoney(pl.totalIncome)} />
        <Stat label="Expenses" value={formatMoney(pl.totalExpense)} />
        <Stat label={pl.netProfit.lessThan(0) ? 'Net loss' : 'Net profit'} value={formatMoney(pl.netProfit.abs())} tone={pl.netProfit.lessThan(0) ? 'warning' : 'default'} />
      </div>
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Income">{pl.income.length ? <TreeTable rows={pl.income} headers={['Amount']} ledger={r} /> : <EmptyState title="No income in this period" />}</Card>
        <Card title="Expenses">{pl.expense.length ? <TreeTable rows={pl.expense} headers={['Amount']} ledger={r} /> : <EmptyState title="No expenses in this period" />}</Card>
      </div>
    </div>
  );
}
