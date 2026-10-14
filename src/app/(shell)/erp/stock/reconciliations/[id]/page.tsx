import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { NotFoundError } from '@/core/rbac/errors';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead, userNames } from '@/modules/erp/services/access';
import { itemOptions, warehouseOptions } from '@/modules/erp/services/item.service';
import { getReconciliation, VOUCHER } from '@/modules/erp/services/reconciliation.service';
import {
  addReconciliationLineAction,
  cancelReconciliationAction,
  deleteReconciliationAction,
  removeReconciliationLineAction,
  submitReconciliationAction,
} from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { GlTable } from '../../../_components/gl-table';
import { DocStatus, DocTrail, Field, ItemDatalist, Money, Qty, showDate, WarehouseSelect } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const { id } = await params;
  const data = await getReconciliation(p, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { recon, items, warehouses } = data;
  const [whs, itemList, names, gl] = await Promise.all([
    warehouseOptions(p.companyId),
    itemOptions(p.companyId, 'stock'),
    userNames([recon.createdById, recon.submittedById, recon.cancelledById]),
    prisma.erpGlEntry.findMany({ where: { voucherType: VOUCHER, voucherId: recon.id }, include: { account: { select: { code: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
  ]);
  const draft = recon.status === 'DRAFT';
  const manage = canManage(p, 'stock');

  return (
    <div className="space-y-lg">
      <PageHeader
        title={recon.number}
        subtitle={<span className="inline-flex items-center gap-xs"><DocStatus status={recon.status} /> {recon.purpose === 'OPENING' ? 'Opening stock' : 'Stock count'} · {showDate(recon.postingDate)}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock counts', href: '/erp/stock/reconciliations' }, { label: recon.number }]}
        actions={
          manage ? (
            draft ? (
              <>
                <DocButton action={submitReconciliationAction} fields={{ reconId: recon.id }} label="Submit" variant="primary" confirm="Submit this count? Stock is set to the counted figures." />
                <DocButton action={deleteReconciliationAction} fields={{ reconId: recon.id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : recon.status === 'SUBMITTED' ? (
              <DocButton action={cancelReconciliationAction} fields={{ reconId: recon.id }} label="Cancel count" variant="danger" confirm="Cancel this count? Stock goes back to what it was." />
            ) : null
          ) : null
        }
      />
      <Card title="Counted items">
        {recon.lines.length === 0 ? (
          <EmptyState title="No items yet" hint={draft && manage ? 'Add each item with the counted quantity and its rate.' : undefined} />
        ) : (
          <table className="table">
            <thead><tr><th>Item</th><th>Warehouse</th>{!draft ? <th className="text-right">Was</th> : null}<th className="text-right">Counted</th><th className="text-right">Rate</th><th className="text-right">Value</th>{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {recon.lines.map((l) => {
                const item = items.get(l.itemId);
                return (
                  <tr key={l.id}>
                    <td><span className="code mr-xs">{item?.code}</span>{item?.name}</td>
                    <td>{warehouses.get(l.warehouseId)}</td>
                    {!draft ? <td className="text-right text-muted"><Qty value={l.currentQty} /></td> : null}
                    <td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td>
                    <td className="text-right"><Money value={l.valuationRate} /></td>
                    <td className="text-right"><Money value={l.qty.times(l.valuationRate)} /></td>
                    {draft && manage ? <td className="text-right"><DocButton action={removeReconciliationLineAction} fields={{ reconId: recon.id, lineId: l.id }} label="Remove" /></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!draft ? <p className="mt-sm text-right text-body-sm">Difference posted <Money value={recon.differenceValue} className="font-medium" /></p> : null}
        {draft && manage ? (
          <ActionForm action={addReconciliationLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="reconId" value={recon.id} />
            <ItemDatalist id="recon-items" items={itemList} />
            <div className="grid gap-sm sm:grid-cols-4">
              <Field label="Item code" name="itemCode" required list="recon-items" />
              <WarehouseSelect name="warehouseId" label="Warehouse" warehouses={whs} defaultValue={whs.find((w) => w.systemKey === 'STORES')?.id} />
              <Field label="Counted quantity" name="qty" type="number" required />
              <Field label="Valuation rate (₹)" name="valuationRate" type="number" required />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Card>
      <GlTable rows={gl} />
      <DocTrail created={{ by: names.get(recon.createdById), at: recon.createdAt }} submitted={{ by: names.get(recon.submittedById ?? ''), at: recon.submittedAt }} cancelled={{ by: names.get(recon.cancelledById ?? ''), at: recon.cancelledAt }} />
    </div>
  );
}
