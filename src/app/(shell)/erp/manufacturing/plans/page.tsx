import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listProductionPlans } from '@/modules/erp/services/production-plan.service';
import { createProductionPlanAction } from '@/app/actions/erp-manufacturing';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, showDate, todayIso } from '../../_components/parts';
import { ManufacturingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Production plans' };

export default async function PlansPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const rows = await listProductionPlans(p);
  return (
    <div className="space-y-lg">
      <PageHeader title="Production plans" subtitle="Pull open sales orders, see what materials are short, then raise work orders and a purchase request in one go." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Manufacturing', href: '/erp/manufacturing' }, { label: 'Production plans' }]} />
      <ManufacturingTabs current="/erp/manufacturing/plans" />
      {canManage(p, 'manufacturing') ? (
        <Card title="New production plan">
          <ActionForm action={createProductionPlanAction} className="flex flex-wrap items-end gap-sm">
            <Field label="Plan date" name="postingDate" type="date" defaultValue={todayIso()} required />
            <Field label="Remarks" name="remarks" className="min-w-[16rem] flex-1" />
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      {rows.length === 0 ? <EmptyState title="No production plans" /> : (
        <table className="table">
          <thead><tr><th>Plan</th><th>Date</th><th>Items</th><th>Status</th><th>Remarks</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link href={`/erp/manufacturing/plans/${r.id}`} className="code hover:underline">{r.number}</Link></td><td>{showDate(r.postingDate)}</td><td>{r._count.items}</td><td><DocStatus status={r.status} /></td><td className="text-caption text-muted">{r.remarks}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}
