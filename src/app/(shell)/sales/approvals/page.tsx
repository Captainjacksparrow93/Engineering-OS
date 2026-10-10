import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listPendingApprovals } from '@/modules/sales/services/quote.service';
import { loadSalesConfig } from '@/modules/sales/services/settings.service';
import { EmptyState, PageHeader } from '@/components/ui';
import { inrShort, pct, shortDate } from '../_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quote approvals' };

export default async function ApprovalsPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.quote.approve')) notFound();
  const [quotes, config] = await Promise.all([listPendingApprovals(principal), loadSalesConfig(principal.companyId)]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Quote approvals" subtitle={`Quotes below the ${pct(config.minMarginPct)} minimum margin wait here for a Director.`} />
      {quotes.length === 0 ? (
        <EmptyState title="Nothing to approve" hint="You are notified when a quote needs you." />
      ) : (
        <table className="table">
          <thead><tr><th>Quote</th><th>Client and deal</th><th>Salesperson</th><th className="text-right">Value</th><th className="text-right">Margin</th><th>Waiting since</th></tr></thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td><Link href={`/sales/quotes/${q.id}`} className="code-chip whitespace-nowrap hover:underline">{q.number} R{q.revision}</Link></td>
                <td>{q.deal.account.name}: {q.deal.title}</td>
                <td>{q.deal.owner.fullName}</td>
                <td className="text-right">{inrShort(q.totals.net)}</td>
                <td className="text-right text-error">{pct(q.totals.marginPct)}</td>
                <td>{shortDate(q.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
