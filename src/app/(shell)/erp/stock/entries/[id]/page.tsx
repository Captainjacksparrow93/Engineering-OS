import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { NotFoundError } from '@/core/rbac/errors';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead, projectOptions, userNames } from '@/modules/erp/services/access';
import { itemOptions, warehouseOptions } from '@/modules/erp/services/item.service';
import { getStockEntry, PURPOSE_LABEL } from '@/modules/erp/services/stock-entry.service';
import {
  addStockEntryLineAction,
  cancelStockEntryAction,
  deleteStockEntryAction,
  removeStockEntryLineAction,
  submitStockEntryAction,
  updateStockEntryAction,
} from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { GlTable } from '../../../_components/gl-table';
import { DocStatus, DocTrail, Field, isoDay, ItemDatalist, Money, ProjectSelect, Qty, showDate, WarehouseSelect } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function StockEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'stock')) notFound();
  const { id } = await params;
  const data = await getStockEntry(p, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { entry, items, gl } = data;
  const [warehouses, projects, names, itemList] = await Promise.all([
    warehouseOptions(p.companyId),
    projectOptions(p.companyId),
    userNames([entry.createdById, entry.submittedById, entry.cancelledById]),
    itemOptions(p.companyId, 'stock'),
  ]);
  const project = entry.projectId ? await prisma.project.findUnique({ where: { id: entry.projectId }, select: { code: true, name: true } }) : null;
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const draft = entry.status === 'DRAFT';
  const manage = canManage(p, 'stock') && !entry.workOrderId;
  const showFrom = entry.purpose !== 'MATERIAL_RECEIPT';
  const showTo = entry.purpose !== 'MATERIAL_ISSUE';

  return (
    <div className="space-y-lg">
      <PageHeader
        title={entry.number}
        subtitle={<span className="inline-flex items-center gap-xs"><DocStatus status={entry.status} /> {PURPOSE_LABEL[entry.purpose]} · {showDate(entry.postingDate)}{project ? ` · ${project.code} ${project.name}` : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Stock entries', href: '/erp/stock/entries' }, { label: entry.number }]}
        actions={
          manage ? (
            draft ? (
              <>
                <DocButton action={submitStockEntryAction} fields={{ entryId: entry.id }} label="Submit" variant="primary" pendingLabel="Submitting…" confirm="Submit this entry? Stock and the books update now." />
                <DocButton action={deleteStockEntryAction} fields={{ entryId: entry.id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : entry.status === 'SUBMITTED' ? (
              <DocButton action={cancelStockEntryAction} fields={{ entryId: entry.id }} label="Cancel entry" variant="danger" confirm="Cancel this entry? Its stock and accounting entries are reversed." />
            ) : null
          ) : null
        }
      />

      <Card title="Items">
        {entry.lines.length === 0 ? (
          <EmptyState title="No items yet" hint={draft && manage ? 'Add items below, then submit.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  {showFrom ? <th>From</th> : null}
                  {showTo ? <th>To</th> : null}
                  <th className="text-right">Qty</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Amount</th>
                  {draft && manage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((l) => {
                  const item = items.get(l.itemId);
                  return (
                    <tr key={l.id}>
                      <td><span className="code mr-xs">{item?.code}</span>{item?.name}{l.isFinishedGood ? <span className="badge badge-ink ml-xs">Finished good</span> : null}</td>
                      {showFrom ? <td>{l.fromWarehouseId ? whName.get(l.fromWarehouseId) : '—'}</td> : null}
                      {showTo ? <td>{l.toWarehouseId ? whName.get(l.toWarehouseId) : '—'}</td> : null}
                      <td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td>
                      <td className="text-right">{draft && entry.purpose !== 'MATERIAL_RECEIPT' ? <span className="text-caption text-muted">at average</span> : <Money value={l.rate} />}</td>
                      <td className="text-right">{draft && entry.purpose !== 'MATERIAL_RECEIPT' ? '—' : <Money value={l.amount} />}</td>
                      {draft && manage ? <td className="text-right"><DocButton action={removeStockEntryLineAction} fields={{ entryId: entry.id, lineId: l.id }} label="Remove" /></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!draft ? <p className="mt-sm text-right text-body-sm">Total value <Money value={entry.totalValue} className="font-medium" /></p> : null}

        {draft && manage ? (
          <ActionForm action={addStockEntryLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="entryId" value={entry.id} />
            <ItemDatalist id="stock-items" items={itemList} />
            <div className="grid gap-sm sm:grid-cols-5">
              <Field label="Item code" name="itemCode" required list="stock-items" />
              <Field label="Quantity" name="qty" type="number" required />
              {entry.purpose === 'MATERIAL_RECEIPT' ? <Field label="Rate (₹)" name="rate" type="number" placeholder="Last purchase rate" /> : null}
              {showFrom ? <WarehouseSelect name="fromWarehouseId" label="From" warehouses={warehouses} defaultValue={entry.fromWarehouseId} optional /> : null}
              {showTo ? <WarehouseSelect name="toWarehouseId" label="To" warehouses={warehouses} defaultValue={entry.toWarehouseId} optional /> : null}
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Card>

      {draft && manage ? (
        <Card title="Entry details">
          <ActionForm action={updateStockEntryAction} className="space-y-base">
            <input type="hidden" name="entryId" value={entry.id} />
            <input type="hidden" name="purpose" value={entry.purpose} />
            <div className="grid gap-sm sm:grid-cols-3">
              <Field label="Posting date" name="postingDate" type="date" defaultValue={isoDay(entry.postingDate)} required />
              <ProjectSelect projects={projects} defaultValue={entry.projectId} />
              <Field label="Remarks" name="remarks" defaultValue={entry.remarks} />
              {showFrom ? <WarehouseSelect name="fromWarehouseId" label="Default from" warehouses={warehouses} defaultValue={entry.fromWarehouseId} optional /> : null}
              {showTo ? <WarehouseSelect name="toWarehouseId" label="Default to" warehouses={warehouses} defaultValue={entry.toWarehouseId} optional /> : null}
            </div>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : entry.remarks ? (
        <Card title="Remarks"><p className="text-body-sm">{entry.remarks}</p></Card>
      ) : null}

      <GlTable rows={gl} />
      <DocTrail
        created={{ by: names.get(entry.createdById), at: entry.createdAt }}
        submitted={{ by: names.get(entry.submittedById ?? ''), at: entry.submittedAt }}
        cancelled={{ by: names.get(entry.cancelledById ?? ''), at: entry.cancelledAt }}
      />
    </div>
  );
}
