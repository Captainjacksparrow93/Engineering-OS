import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead, userNames } from '@/modules/erp/services/access';
import { itemOptions, warehouseOptions } from '@/modules/erp/services/item.service';
import { getMaterialRequest, MR_PURPOSE_LABEL, pendingQty } from '@/modules/erp/services/material-request.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import {
  addMaterialRequestLineAction,
  cancelMaterialRequestAction,
  deleteMaterialRequestAction,
  orderFromRequestAction,
  quotationFromRequestAction,
  removeMaterialRequestLineAction,
  stockEntryFromRequestAction,
  stopMaterialRequestAction,
  submitMaterialRequestAction,
} from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, DocTrail, Field, ItemDatalist, orNotFound, Qty, showDate, WarehouseSelect } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function MaterialRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying') && !canRead(p, 'stock')) notFound();
  const { id } = await params;
  const { mr, items, state } = await orNotFound(getMaterialRequest(p, id));
  const [warehouses, itemList, suppliers, names, project, entries, orders] = await Promise.all([
    warehouseOptions(p.companyId),
    itemOptions(p.companyId, mr.purpose === 'PURCHASE' ? 'purchase' : 'stock'),
    partyOptions(p.companyId, 'SUPPLIER'),
    userNames([mr.createdById, mr.submittedById, mr.cancelledById]),
    mr.projectId ? prisma.project.findUnique({ where: { id: mr.projectId }, select: { id: true, code: true, name: true } }) : null,
    prisma.erpStockEntry.findMany({ where: { materialRequestId: id }, select: { id: true, number: true, status: true } }),
    prisma.erpPurchaseOrder.findMany({ where: { lines: { some: { materialRequestLineId: { in: mr.lines.map((l) => l.id) } } } }, select: { id: true, number: true, status: true } }),
  ]);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const draft = mr.status === 'DRAFT';
  const manage = canManage(p, 'buying') || canManage(p, 'stock');
  const open = mr.status === 'SUBMITTED' && !mr.isStopped && mr.lines.some((l) => pendingQty(l).greaterThan(0));

  return (
    <div className="space-y-lg">
      <PageHeader
        title={mr.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={state.key} label={state.label} /> {MR_PURPOSE_LABEL[mr.purpose]} · {showDate(mr.requestDate)}{mr.requiredBy ? ` · needed by ${showDate(mr.requiredBy)}` : ''}{project ? <> · <Link href={`/pm/projects/${project.id}`} className="hover:underline">{project.code} {project.name}</Link></> : null}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Material requests', href: '/erp/buying/requests' }, { label: mr.number }]}
        actions={
          manage ? (
            draft ? (
              <>
                <DocButton action={submitMaterialRequestAction} fields={{ id }} label="Submit" variant="primary" />
                <DocButton action={deleteMaterialRequestAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : mr.status === 'SUBMITTED' ? (
              <>
                {open && mr.purpose !== 'PURCHASE' && canManage(p, 'stock') ? <DocButton action={stockEntryFromRequestAction} fields={{ id }} label={mr.purpose === 'TRANSFER' ? 'Make transfer entry' : 'Make issue entry'} variant="primary" /> : null}
                <DocButton action={stopMaterialRequestAction} fields={{ id, stop: String(!mr.isStopped) }} label={mr.isStopped ? 'Re-open' : 'Stop'} />
                <DocButton action={cancelMaterialRequestAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this request?" />
              </>
            ) : null
          ) : null
        }
      />

      <Card title="Items">
        {mr.lines.length === 0 ? <EmptyState title="No items yet" /> : (
          <table className="table">
            <thead><tr><th>Item</th><th>Warehouse</th><th>Needed by</th><th className="text-right">Qty</th>{!draft ? <th className="text-right">{mr.purpose === 'PURCHASE' ? 'Ordered' : 'Moved'}</th> : null}{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {mr.lines.map((l) => {
                const item = items.get(l.itemId);
                return (
                  <tr key={l.id}>
                    <td><span className="code mr-xs">{item?.code}</span>{item?.name}</td>
                    <td>{whName.get(l.warehouseId)}</td>
                    <td>{showDate(l.requiredBy)}</td>
                    <td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td>
                    {!draft ? <td className="text-right"><Qty value={l.orderedQty} /></td> : null}
                    {draft && manage ? <td className="text-right"><DocButton action={removeMaterialRequestLineAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {draft && manage ? (
          <ActionForm action={addMaterialRequestLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <ItemDatalist id="mr-items" items={itemList} />
            <div className="grid gap-sm sm:grid-cols-4">
              <Field label="Item code" name="itemCode" required list="mr-items" />
              <Field label="Quantity" name="qty" type="number" required />
              <WarehouseSelect name="warehouseId" label="Warehouse" warehouses={warehouses} defaultValue={mr.warehouseId} />
              <Field label="Needed by" name="requiredBy" type="date" />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Card>

      {open && mr.purpose === 'PURCHASE' && canManage(p, 'buying') ? (
        <Card title="Buy it">
          <div className="grid gap-lg md:grid-cols-2">
            <ActionForm action={quotationFromRequestAction} className="space-y-sm">
              <p className="text-body-sm text-muted">Ask a supplier for prices. Make one quotation per supplier, then compare them.</p>
              <input type="hidden" name="id" value={id} />
              <select name="supplierId" className="select w-full" aria-label="Supplier" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <SubmitButton pendingLabel="Creating…">Request quotation</SubmitButton>
              <Link href={`/erp/buying/quotations/compare?mr=${id}`} className="link-muted ml-sm text-body-sm">Compare quotations</Link>
            </ActionForm>
            <ActionForm action={orderFromRequestAction} className="space-y-sm">
              <p className="text-body-sm text-muted">Order straight away at the last purchase rate.</p>
              <input type="hidden" name="id" value={id} />
              <select name="supplierId" className="select w-full" aria-label="Supplier" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <SubmitButton variant="primary" pendingLabel="Creating…">Make purchase order</SubmitButton>
            </ActionForm>
          </div>
          {suppliers.length === 0 ? <p className="mt-sm text-caption text-error">Add a supplier first.</p> : null}
        </Card>
      ) : null}

      {entries.length || orders.length ? (
        <Card title="Fulfilled by">
          <ul className="space-y-xxs text-body-sm">
            {orders.map((o) => <li key={o.id}><Link href={`/erp/buying/orders/${o.id}`} className="code hover:underline">{o.number}</Link> <DocStatus status={o.status} /></li>)}
            {entries.map((e) => <li key={e.id}><Link href={`/erp/stock/entries/${e.id}`} className="code hover:underline">{e.number}</Link> <DocStatus status={e.status} /></li>)}
          </ul>
        </Card>
      ) : null}
      {mr.remarks ? <Card title="Remarks"><p className="text-body-sm">{mr.remarks}</p></Card> : null}
      <DocTrail created={{ by: names.get(mr.createdById), at: mr.createdAt }} submitted={{ by: names.get(mr.submittedById ?? ''), at: mr.submittedAt }} cancelled={{ by: names.get(mr.cancelledById ?? ''), at: mr.cancelledAt }} />
    </div>
  );
}
