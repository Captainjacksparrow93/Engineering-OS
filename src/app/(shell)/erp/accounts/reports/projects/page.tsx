import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { projectProfitability } from '@/modules/erp/services/reports.service';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Money } from '../../../_components/parts';
import { AccountsTabs, RangeForm, rangeOf } from '../../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Project profitability' };

export default async function ProjectsReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const r = rangeOf(await searchParams);
  const rows = await projectProfitability(p, { from: r.fromDate, to: r.toDate });
  return (
    <div className="space-y-lg">
      <PageHeader title="Project profitability" subtitle="Income and costs posted with the PM project: invoices, bills, material issued and journals." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Reports', href: '/erp/accounts/reports' }, { label: 'Project profitability' }]} />
      <AccountsTabs current="/erp/accounts/reports" />
      <RangeForm from={r.from} to={r.to} />
      <Card>
        {rows.length === 0 ? <EmptyState title="Nothing posted to a project in this period" /> : (
          <table className="table">
            <thead><tr><th>Project</th><th>Client</th><th className="text-right">Income</th><th className="text-right">Cost</th><th className="text-right">Profit</th><th className="text-right">Margin</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.project.id}>
                <td><Link href={`/erp/accounts/reports/general-ledger?projectId=${x.project.id}&from=${r.from}&to=${r.to}`} className="hover:underline"><span className="code mr-xs">{x.project.code}</span>{x.project.name}</Link></td>
                <td>{x.project.clientName}</td>
                <td className="text-right"><Money value={x.income} /></td>
                <td className="text-right"><Money value={x.cost} /></td>
                <td className={`text-right ${x.profit.lessThan(0) ? 'text-error' : ''}`}><Money value={x.profit} /></td>
                <td className="text-right">{x.margin === null ? '—' : `${x.margin.toFixed(1)}%`}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
