import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, projectOptions } from '@/modules/erp/services/access';
import { itemOptions } from '@/modules/erp/services/item.service';
import { listNonConformances, NC_SOURCE_LABEL, NC_STATUS_LABEL } from '@/modules/erp/services/nc.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { raiseNcAction } from '@/app/actions/erp-quality';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, ItemDatalist, ProjectSelect, showDate } from '../../_components/parts';
import { QualityTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Non-conformances' };

const SEVERITY = { MINOR: 'Minor', MAJOR: 'Major', CRITICAL: 'Critical' } as const;

export default async function NonConformancesPage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'quality')) notFound();
  const sp = await searchParams;
  const status = sp.status ?? 'OPEN_ALL';
  const [rows, items, projects, suppliers, customers, staff] = await Promise.all([
    listNonConformances(p, { status: status === 'ALL' ? null : status, mine: sp.mine === '1' }),
    itemOptions(p.companyId),
    projectOptions(p.companyId),
    partyOptions(p.companyId, 'SUPPLIER'),
    partyOptions(p.companyId, 'CUSTOMER'),
    import('@/core/db/prisma').then(({ prisma }) => prisma.user.findMany({ where: { companyId: p.companyId, status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })),
  ]);
  const today = new Date();
  return (
    <div className="space-y-lg">
      <PageHeader title="Non-conformances" subtitle="Problems found in material, production, at the customer or in an audit, with root cause and corrective and preventive action." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Quality', href: '/erp/quality' }, { label: 'Non-conformances' }]} />
      <QualityTabs current="/erp/quality/non-conformances" />
      {canManage(p, 'quality') ? (
        <Card title="Raise a non-conformance">
          <ActionForm action={raiseNcAction} className="space-y-base">
            <ItemDatalist id="nc-items" items={items} />
            <div className="grid gap-sm sm:grid-cols-4">
              <Field label="Title" name="title" required className="sm:col-span-2" />
              <div>
                <label className="label" htmlFor="source">Found at</label>
                <select id="source" name="source" className="select w-full">{Object.entries(NC_SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="severity">Severity</label>
                <select id="severity" name="severity" className="select w-full">{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <Field label="Item (optional)" name="itemCode" list="nc-items" />
              <ProjectSelect projects={projects} />
              <div>
                <label className="label" htmlFor="supplierId">Supplier (optional)</label>
                <select id="supplierId" name="supplierId" className="select w-full"><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="customerId">Customer (optional)</label>
                <select id="customerId" name="customerId" className="select w-full"><option value="">—</option>{customers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="ownerId">Owner</label>
                <select id="ownerId" name="ownerId" defaultValue={p.userId} className="select w-full">{staff.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
              </div>
              <Field label="Due by" name="dueDate" type="date" />
            </div>
            <div>
              <label className="label" htmlFor="description">What went wrong</label>
              <textarea id="description" name="description" required rows={3} className="input w-full" />
            </div>
            <SubmitButton variant="primary" pendingLabel="Raising…">Raise</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <form method="get" className="flex flex-wrap gap-sm">
        <select name="status" defaultValue={status} className="select" aria-label="Status">
          <option value="OPEN_ALL">Not closed</option>
          {Object.entries(NC_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          <option value="ALL">All</option>
        </select>
        <label className="flex items-center gap-xs text-body-sm"><input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === '1'} /> Mine only</label>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No non-conformances" /> : (
        <table className="table">
          <thead><tr><th>Number</th><th>Title</th><th>Found at</th><th>Severity</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td><Link href={`/erp/quality/non-conformances/${n.id}`} className="code hover:underline">{n.number}</Link></td>
                <td>{n.title}</td>
                <td>{NC_SOURCE_LABEL[n.source]}</td>
                <td>{n.severity === 'CRITICAL' ? <span className="badge badge-error">Critical</span> : SEVERITY[n.severity]}</td>
                <td>{n.ownerName}</td>
                <td className={n.dueDate && n.dueDate < today && n.status !== 'CLOSED' ? 'text-error' : ''}>{showDate(n.dueDate)}</td>
                <td><DocStatus status={n.status === 'CLOSED' ? 'COMPLETED' : n.status} label={NC_STATUS_LABEL[n.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
