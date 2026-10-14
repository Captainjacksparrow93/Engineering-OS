import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listWorkstations } from '@/modules/erp/services/bom.service';
import { downWorkstations } from '@/modules/erp/services/maintenance.service';
import { createWorkstationAction, setWorkstationActiveAction, updateWorkstationAction } from '@/app/actions/erp-manufacturing';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../_components/doc-button';
import { Field } from '../../_components/parts';
import { ManufacturingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workstations' };

export default async function WorkstationsPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const [rows, down] = await Promise.all([listWorkstations(p), downWorkstations(p.companyId)]);
  const manage = canManage(p, 'manufacturing');
  return (
    <div className="space-y-lg">
      <PageHeader title="Workstations" subtitle="Where operations run, and what an hour there costs. The rate prices BOM operations and job-card time." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Manufacturing', href: '/erp/manufacturing' }, { label: 'Workstations' }]} />
      <ManufacturingTabs current="/erp/manufacturing/workstations" />
      {rows.length === 0 ? <EmptyState title="No workstations yet" hint="Add fabrication, busbar, wiring and testing bays." /> : (
        <table className="table">
          <thead><tr><th>Workstation</th><th>Rate per hour (₹)</th><th>Capacity</th><th>Description</th><th /></tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className={w.isActive ? '' : 'text-muted'}>
                {manage ? (
                  <td colSpan={4}>
                    <ActionForm action={updateWorkstationAction} quiet className="grid items-center gap-xs sm:grid-cols-4">
                      <input type="hidden" name="id" value={w.id} />
                      <input name="name" defaultValue={w.name} className="input" aria-label="Name" />
                      <input name="hourRate" defaultValue={w.hourRate.toString()} type="number" step="any" className="input" aria-label="Rate per hour" />
                      <input name="capacity" defaultValue={w.capacity} type="number" min={1} className="input" aria-label="Capacity" />
                      <span className="flex gap-xs"><input name="description" defaultValue={w.description ?? ''} className="input flex-1" aria-label="Description" /><SubmitButton size="sm">Save</SubmitButton></span>
                    </ActionForm>
                  </td>
                ) : (
                  <><td>{w.name}{down.has(w.id) ? <span className="badge badge-error ml-xs">Down</span> : null}</td><td>{w.hourRate.toString()}</td><td>{w.capacity}</td><td>{w.description}</td></>
                )}
                <td className="text-right">{manage ? <DocButton action={setWorkstationActiveAction} fields={{ id: w.id, active: String(!w.isActive) }} label={w.isActive ? 'Switch off' : 'Switch on'} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {manage ? (
        <Card title="Add a workstation">
          <ActionForm action={createWorkstationAction} resetOnSuccess className="grid items-end gap-sm sm:grid-cols-5">
            <Field label="Name" name="name" required placeholder="Wiring bay 1" />
            <Field label="Rate per hour (₹)" name="hourRate" type="number" required />
            <Field label="Capacity" name="capacity" type="number" defaultValue="1" />
            <Field label="Description" name="description" />
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
