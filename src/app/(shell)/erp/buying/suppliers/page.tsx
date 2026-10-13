import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listParties } from '@/modules/erp/services/party.service';
import { createSupplierAction } from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { PartyFields } from '../../_components/party-fields';
import { BuyingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Suppliers' };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const { q } = await searchParams;
  const rows = await listParties(p, 'SUPPLIER', { q, includeInactive: true });
  return (
    <div className="space-y-lg">
      <PageHeader title="Suppliers" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Buying', href: '/erp/buying' }, { label: 'Suppliers' }]} />
      <BuyingTabs current="/erp/buying/suppliers" />
      <form method="get" className="flex gap-sm">
        <input name="q" defaultValue={q ?? ''} placeholder="Name, code, GSTIN or city" className="input w-80" aria-label="Search suppliers" />
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title={q ? 'No suppliers match' : 'No suppliers yet'} /> : (
        <table className="table">
          <thead><tr><th>Supplier</th><th>City</th><th>State</th><th>GSTIN</th><th>Terms</th><th>Contact</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className={s.isActive ? '' : 'text-muted'}>
                <td><Link href={`/erp/buying/suppliers/${s.id}`} className="hover:underline"><span className="code mr-xs">{s.code}</span>{s.name}</Link>{s.isActive ? null : <span className="badge badge-outline ml-xs">Off</span>}</td>
                <td>{s.city ?? '—'}</td>
                <td>{s.state ?? '—'}</td>
                <td className="code">{s.gstin ?? '—'}</td>
                <td>{s.paymentTermsDays} days</td>
                <td>{[s.contactPerson, s.phone].filter(Boolean).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManage(p, 'buying') ? (
        <Card title="Add a supplier">
          <ActionForm action={createSupplierAction} className="space-y-base">
            <PartyFields />
            <SubmitButton variant="primary" pendingLabel="Adding…">Add supplier</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
