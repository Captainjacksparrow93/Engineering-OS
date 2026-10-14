import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, projectOptions } from '@/modules/erp/services/access';
import { warehouseOptions } from '@/modules/erp/services/item.service';
import { listMaterialRequests, MR_PURPOSE_LABEL } from '@/modules/erp/services/material-request.service';
import { createMaterialRequestAction, reorderRequestAction } from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../_components/doc-button';
import { DocStatus, Field, ProjectSelect, showDate, todayIso, WarehouseSelect } from '../../_components/parts';
import { BuyingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Material requests' };

export default async function MaterialRequestsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying') && !canRead(p, 'stock')) notFound();
  const sp = await searchParams;
  const [rows, warehouses, projects] = await Promise.all([listMaterialRequests(p, { open: sp.open === '1' }), warehouseOptions(p.companyId), projectOptions(p.companyId)]);
  const manage = canManage(p, 'buying') || canManage(p, 'stock');
  return (
    <div className="space-y-lg">
      <PageHeader
        title="Material requests"
        subtitle="Ask for material to be bought, moved or issued, usually for a project."
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Buying', href: '/erp/buying' }, { label: 'Material requests' }]}
        actions={manage ? <DocButton action={reorderRequestAction} fields={{}} label="Request what's below reorder level" /> : null}
      />
      <BuyingTabs current="/erp/buying/requests" />
      {manage ? (
        <Card title="New material request">
          <ActionForm action={createMaterialRequestAction} className="space-y-base">
            <div className="grid gap-sm sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="purpose">For</label>
                <select id="purpose" name="purpose" className="select w-full">{Object.entries(MR_PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <Field label="Request date" name="requestDate" type="date" defaultValue={todayIso()} required />
              <Field label="Required by" name="requiredBy" type="date" />
              <WarehouseSelect name="warehouseId" label="Deliver to warehouse" warehouses={warehouses} defaultValue={warehouses.find((w) => w.systemKey === 'STORES')?.id} />
              <ProjectSelect projects={projects} />
              <Field label="Remarks" name="remarks" />
            </div>
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <div className="flex gap-sm text-body-sm">
        <Link href="/erp/buying/requests" className={sp.open === '1' ? 'link-muted' : 'font-medium text-ink'}>All</Link>
        <Link href="/erp/buying/requests?open=1" className={sp.open === '1' ? 'font-medium text-ink' : 'link-muted'}>Open only</Link>
      </div>
      {rows.length === 0 ? <EmptyState title="No material requests" /> : (
        <table className="table">
          <thead><tr><th>Request</th><th>For</th><th>Date</th><th>Required by</th><th>Lines</th><th>Status</th><th>Remarks</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/erp/buying/requests/${r.id}`} className="code hover:underline">{r.number}</Link></td>
                <td>{MR_PURPOSE_LABEL[r.purpose]}</td>
                <td>{showDate(r.requestDate)}</td>
                <td>{showDate(r.requiredBy)}</td>
                <td>{r.lineCount}</td>
                <td><DocStatus status={r.state.key} label={r.state.label} /></td>
                <td className="text-caption text-muted">{r.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
