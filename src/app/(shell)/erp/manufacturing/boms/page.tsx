import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listBoms } from '@/modules/erp/services/bom.service';
import { itemOptions } from '@/modules/erp/services/item.service';
import { createBomAction } from '@/app/actions/erp-manufacturing';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, ItemDatalist, Money } from '../../_components/parts';
import { ManufacturingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'BOMs' };

export default async function BomsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const { q } = await searchParams;
  const [rows, items] = await Promise.all([listBoms(p, { q }), itemOptions(p.companyId, 'stock')]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Bills of materials" subtitle="What a panel or sub-assembly is made of, and the operations to build it." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Manufacturing', href: '/erp/manufacturing' }, { label: 'BOMs' }]} />
      <ManufacturingTabs current="/erp/manufacturing/boms" />
      {canManage(p, 'manufacturing') ? (
        <Card title="New BOM">
          <ActionForm action={createBomAction} className="flex flex-wrap items-end gap-sm">
            <ItemDatalist id="bom-items" items={items} />
            <Field label="Item it makes" name="itemCode" required list="bom-items" placeholder="PLC" />
            <Field label="Quantity made" name="qty" type="number" defaultValue="1" required />
            <Field label="Remarks" name="remarks" className="min-w-[16rem] flex-1" />
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <form method="get" className="flex gap-sm">
        <input name="q" defaultValue={q ?? ''} placeholder="BOM number" className="input w-64" aria-label="Search" />
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No BOMs yet" /> : (
        <table className="table">
          <thead><tr><th>BOM</th><th>Item</th><th>Makes</th><th>Status</th><th className="text-right">Materials</th><th className="text-right">Operations</th><th className="text-right">Unit cost</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className={b.isActive ? '' : 'text-muted'}>
                <td><Link href={`/erp/manufacturing/boms/${b.id}`} className="code hover:underline">{b.number}</Link>{b.isDefault ? <span className="badge badge-ink ml-xs">Default</span> : null}{!b.isActive ? <span className="badge badge-outline ml-xs">Off</span> : null}</td>
                <td>{b.item?.code} {b.item?.name}</td>
                <td>{b.qty.toString()}</td>
                <td><DocStatus status={b.status} /></td>
                <td className="text-right">{b._count.items}</td>
                <td className="text-right">{b._count.operations}</td>
                <td className="text-right"><Money value={b.totalCost.dividedBy(b.qty)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
