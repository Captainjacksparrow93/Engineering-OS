import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listParties } from '@/modules/erp/services/party.service';
import { createCustomerAction } from '@/app/actions/erp-selling';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { PartyFields } from '../../_components/party-fields';
import { SellingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customers' };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling')) notFound();
  const { q } = await searchParams;
  const rows = await listParties(p, 'CUSTOMER', { q, includeInactive: true });
  const clients = await prisma.client.findMany({ where: { id: { in: rows.map((r) => r.clientId).filter((x): x is string => !!x) } }, select: { id: true, refNumber: true } });
  const ref = new Map(clients.map((c) => [c.id, c.refNumber]));
  return (
    <div className="space-y-lg">
      <PageHeader title="Customers" subtitle="A customer gets its ACS reference the first time one of its orders becomes a project." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Selling', href: '/erp/selling' }, { label: 'Customers' }]} />
      <SellingTabs current="/erp/selling/customers" />
      <form method="get" className="flex gap-sm">
        <input name="q" defaultValue={q ?? ''} placeholder="Name, code, GSTIN or city" className="input w-80" aria-label="Search customers" />
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title={q ? 'No customers match' : 'No customers yet'} hint="Customers are also added when a Sales deal is won." /> : (
        <table className="table">
          <thead><tr><th>Customer</th><th>ACS ref.</th><th>City</th><th>State</th><th>GSTIN</th><th>Terms</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.isActive ? '' : 'text-muted'}>
                <td><Link href={`/erp/selling/customers/${c.id}`} className="hover:underline"><span className="code mr-xs">{c.code}</span>{c.name}</Link>{c.isActive ? null : <span className="badge badge-outline ml-xs">Off</span>}</td>
                <td className="code">{c.clientId ? ref.get(c.clientId) : '—'}</td>
                <td>{c.city ?? '—'}</td>
                <td>{c.state ?? '—'}</td>
                <td className="code">{c.gstin ?? '—'}</td>
                <td>{c.paymentTermsDays} days</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManage(p, 'selling') ? (
        <Card title="Add a customer">
          <ActionForm action={createCustomerAction} className="space-y-base">
            <PartyFields customer />
            <SubmitButton variant="primary" pendingLabel="Adding…">Add customer</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
