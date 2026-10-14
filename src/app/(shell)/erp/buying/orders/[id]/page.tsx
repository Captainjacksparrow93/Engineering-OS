import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead, projectOptions, userNames } from '@/modules/erp/services/access';
import { itemOptions, warehouseOptions } from '@/modules/erp/services/item.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { getPurchaseOrder } from '@/modules/erp/services/purchase-order.service';
import {
  addPurchaseOrderLineAction,
  cancelPurchaseOrderAction,
  closePurchaseOrderAction,
  deletePurchaseOrderAction,
  invoiceFromOrderAction,
  receiptFromOrderAction,
  removePurchaseOrderLineAction,
  submitPurchaseOrderAction,
  updatePurchaseOrderAction,
  updatePurchaseOrderLineAction,
} from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { LineEdit } from '../../../_components/line-edit';
import { TotalsBlock } from '../../../_components/totals';
import { DocStatus, DocTrail, Field, isoDay, ItemDatalist, Money, orNotFound, ProjectSelect, Qty, showDate, WarehouseSelect } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const { id } = await params;
  const { po, supplier, items, warehouses, state, receipts, invoices } = await orNotFound(getPurchaseOrder(p, id));
  const [itemList, whs, suppliers, projects, names, project] = await Promise.all([
    itemOptions(p.companyId, 'purchase'),
    warehouseOptions(p.companyId),
    partyOptions(p.companyId, 'SUPPLIER'),
    projectOptions(p.companyId),
    userNames([po.createdById, po.submittedById, po.cancelledById]),
    po.projectId ? prisma.project.findUnique({ where: { id: po.projectId }, select: { id: true, code: true, name: true } }) : null,
  ]);
  const draft = po.status === 'DRAFT';
  const manage = canManage(p, 'buying');
  const open = po.status === 'SUBMITTED' && !po.isClosed;
  return (
    <div className="space-y-lg">
      <PageHeader
        title={po.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={state.key} label={state.label} /> {supplier?.name} · {showDate(po.orderDate)}{po.scheduleDate ? ` · required by ${showDate(po.scheduleDate)}` : ''}{project ? <> · <Link href={`/pm/projects/${project.id}`} className="hover:underline">{project.code}</Link></> : null}{po.status === 'SUBMITTED' ? ` · ${state.received}% received · ${state.billed}% billed` : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Purchase orders', href: '/erp/buying/orders' }, { label: po.number }]}
        actions={
          <>
            {po.status === 'SUBMITTED' ? <Link href={`/print/erp/purchase-order/${po.id}`} target="_blank" className="btn btn-secondary btn-sm">Print</Link> : null}
            {manage && draft ? (
              <>
                <DocButton action={submitPurchaseOrderAction} fields={{ id }} label="Submit" variant="primary" />
                <DocButton action={deletePurchaseOrderAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : null}
            {open && (canManage(p, 'stock') || manage) && state.received < 100 ? <DocButton action={receiptFromOrderAction} fields={{ id }} label="Receive" variant="primary" /> : null}
            {po.status === 'SUBMITTED' && manage && state.billed < 100 ? <DocButton action={invoiceFromOrderAction} fields={{ id }} label="Make invoice" /> : null}
            {po.status === 'SUBMITTED' && manage ? <DocButton action={closePurchaseOrderAction} fields={{ id, close: String(!po.isClosed) }} label={po.isClosed ? 'Re-open' : 'Close'} confirm={po.isClosed ? undefined : 'Close this order? Nothing more will be received against it.'} /> : null}
            {po.status === 'SUBMITTED' && manage ? <DocButton action={cancelPurchaseOrderAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this order?" /> : null}
          </>
        }
      />
      <Card title="Items">
        {po.lines.length === 0 ? <EmptyState title="No items yet" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Item</th><th>Warehouse</th><th className="text-right">GST</th>{draft && manage ? <th className="text-right">Qty · rate</th> : <><th className="text-right">Qty</th><th className="text-right">Rate</th></>}<th className="text-right">Amount</th>{!draft ? <><th className="text-right">Received</th><th className="text-right">Billed</th></> : null}{draft && manage ? <th /> : null}</tr></thead>
              <tbody>
                {po.lines.map((l) => {
                  const item = items.get(l.itemId);
                  return (
                    <tr key={l.id}>
                      <td><span className="code mr-xs">{item?.code}</span>{item?.name}{item && !item.isStockItem ? <span className="badge badge-outline ml-xs">Service</span> : null}</td>
                      <td>{warehouses.get(l.warehouseId)}</td>
                      <td className="text-right">{l.gstRate.toString()}%</td>
                      {draft && manage ? <td><LineEdit action={updatePurchaseOrderLineAction} docId={id} lineId={l.id} qty={l.qty.toString()} rate={l.rate.toString()} /></td> : <><td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td><td className="text-right"><Money value={l.rate} /></td></>}
                      <td className="text-right"><Money value={l.amount} /></td>
                      {!draft ? <><td className="text-right"><Qty value={l.receivedQty} /></td><td className="text-right"><Qty value={l.billedQty} /></td></> : null}
                      {draft && manage ? <td className="text-right"><DocButton action={removePurchaseOrderLineAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <TotalsBlock t={po} />
        {draft && manage ? (
          <ActionForm action={addPurchaseOrderLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <ItemDatalist id="po-items" items={itemList} />
            <div className="grid gap-sm sm:grid-cols-5">
              <Field label="Item code" name="itemCode" required list="po-items" />
              <Field label="Quantity" name="qty" type="number" required />
              <Field label="Rate (₹)" name="rate" type="number" required />
              <WarehouseSelect name="warehouseId" label="Warehouse" warehouses={whs} optional />
              <Field label="Required by" name="scheduleDate" type="date" />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Card>
      {draft && manage ? (
        <Card title="Order details">
          <ActionForm action={updatePurchaseOrderAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-sm sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="supplierId">Supplier</label>
                <select id="supplierId" name="supplierId" defaultValue={po.supplierId} className="select w-full">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </div>
              <Field label="Order date" name="orderDate" type="date" defaultValue={isoDay(po.orderDate)} required />
              <Field label="Required by" name="scheduleDate" type="date" defaultValue={isoDay(po.scheduleDate)} />
              <ProjectSelect projects={projects} defaultValue={po.projectId} />
              <Field label="Supplier's ref." name="supplierRef" defaultValue={po.supplierRef} />
              <Field label="Remarks" name="remarks" defaultValue={po.remarks} />
            </div>
            <div>
              <label className="label" htmlFor="terms">Terms and conditions</label>
              <textarea id="terms" name="terms" defaultValue={po.terms ?? ''} rows={4} className="input w-full" />
            </div>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : po.terms ? <Card title="Terms and conditions"><p className="whitespace-pre-line text-body-sm">{po.terms}</p></Card> : null}
      {receipts.length || invoices.length ? (
        <Card title="Receipts and invoices">
          <ul className="space-y-xxs text-body-sm">
            {receipts.map((r) => <li key={r.id}><Link href={`/erp/buying/receipts/${r.id}`} className="code hover:underline">{r.number}</Link> receipt · {showDate(r.postingDate)} <DocStatus status={r.status} /></li>)}
            {invoices.map((r) => <li key={r.id}><Link href={`/erp/buying/invoices/${r.id}`} className="code hover:underline">{r.number}</Link> invoice · {showDate(r.postingDate)} <DocStatus status={r.status} /></li>)}
          </ul>
        </Card>
      ) : null}
      <DocTrail created={{ by: names.get(po.createdById), at: po.createdAt }} submitted={{ by: names.get(po.submittedById ?? ''), at: po.submittedAt }} cancelled={{ by: names.get(po.cancelledById ?? ''), at: po.cancelledAt }} />
    </div>
  );
}
