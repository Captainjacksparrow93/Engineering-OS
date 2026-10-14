import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, userNames } from '@/modules/erp/services/access';
import { itemOptions, warehouseOptions } from '@/modules/erp/services/item.service';
import { getPurchaseReceipt } from '@/modules/erp/services/purchase-receipt.service';
import {
  addPurchaseReceiptLineAction,
  cancelPurchaseReceiptAction,
  deletePurchaseReceiptAction,
  invoiceFromReceiptAction,
  removePurchaseReceiptLineAction,
  submitPurchaseReceiptAction,
  updatePurchaseReceiptLineAction,
} from '@/app/actions/erp-buying';
import { D } from '@/modules/erp/domain/money';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { GlTable } from '../../../_components/gl-table';
import { LineEdit } from '../../../_components/line-edit';
import { DocStatus, DocTrail, Field, ItemDatalist, Money, orNotFound, Qty, showDate, WarehouseSelect } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying') && !canRead(p, 'stock')) notFound();
  const { id } = await params;
  const { pr, supplier, items, warehouses, orders, gl } = await orNotFound(getPurchaseReceipt(p, id));
  const [itemList, whs, names] = await Promise.all([itemOptions(p.companyId, 'stock'), warehouseOptions(p.companyId), userNames([pr.createdById, pr.submittedById, pr.cancelledById])]);
  const draft = pr.status === 'DRAFT';
  const manage = canManage(p, 'stock') || canManage(p, 'buying');
  const unbilled = pr.status === 'SUBMITTED' && pr.lines.some((l) => D(l.qty).greaterThan(D(l.billedQty)));
  return (
    <div className="space-y-lg">
      <PageHeader
        title={pr.number}
        subtitle={<span className="inline-flex items-center gap-xs"><DocStatus status={pr.status} /> {supplier?.name} · {showDate(pr.postingDate)}{pr.supplierDeliveryNote ? ` · DN ${pr.supplierDeliveryNote}` : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Receipts', href: '/erp/buying/receipts' }, { label: pr.number }]}
        actions={
          manage ? (
            draft ? (
              <>
                <DocButton action={submitPurchaseReceiptAction} fields={{ id }} label="Submit" variant="primary" confirm="Submit this receipt? Stock and accounts update now." />
                <DocButton action={deletePurchaseReceiptAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : pr.status === 'SUBMITTED' ? (
              <>
                {unbilled && canManage(p, 'buying') ? <DocButton action={invoiceFromReceiptAction} fields={{ id }} label="Make invoice" variant="primary" /> : null}
                <DocButton action={cancelPurchaseReceiptAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this receipt? Its stock and accounting entries are reversed." />
              </>
            ) : null
          ) : null
        }
      />
      <Card title="Items">
        {pr.lines.length === 0 ? <EmptyState title="No items yet" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Item</th><th>Order</th><th>Warehouse</th>{draft && manage ? <th className="text-right">Accepted · rejected{' '}· rate</th> : <><th className="text-right">Accepted</th><th className="text-right">Rejected</th><th className="text-right">Rate</th></>}<th className="text-right">Amount</th>{!draft ? <th className="text-right">Billed</th> : null}{draft && manage ? <th /> : null}</tr></thead>
              <tbody>
                {pr.lines.map((l) => {
                  const item = items.get(l.itemId);
                  const order = l.orderLineId ? orders.get(l.orderLineId) : null;
                  return (
                    <tr key={l.id}>
                      <td><span className="code mr-xs">{item?.code}</span>{item?.name}{item?.inspectionBeforePurchase ? (l.qualityInspectionId ? <Link href={`/erp/quality/inspections/${l.qualityInspectionId}`} className="ml-xs text-caption hover:underline">Inspected</Link> : draft ? <Link href={`/erp/quality/inspections?item=${encodeURIComponent(item.code)}&referenceType=Purchase%20Receipt&referenceId=${id}&referenceLineId=${l.id}`} className="ml-xs text-caption text-accent hover:underline">Inspect</Link> : null) : null}</td>
                      <td>{order ? <Link href={`/erp/buying/orders/${order.id}`} className="code hover:underline">{order.number}</Link> : '—'}</td>
                      <td>{warehouses.get(l.warehouseId)}</td>
                      {draft && manage ? <td><LineEdit action={updatePurchaseReceiptLineAction} docId={id} lineId={l.id} qty={l.qty.toString()} rejectedQty={l.rejectedQty.toString()} rate={l.orderLineId ? undefined : l.rate.toString()} /></td> : <><td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td><td className="text-right">{D(l.rejectedQty).isZero() ? '—' : <Qty value={l.rejectedQty} />}</td><td className="text-right"><Money value={l.rate} /></td></>}
                      <td className="text-right"><Money value={l.amount} /></td>
                      {!draft ? <td className="text-right"><Qty value={l.billedQty} /></td> : null}
                      {draft && manage ? <td className="text-right"><DocButton action={removePurchaseReceiptLineAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-sm text-right text-body-sm">Value received <Money value={pr.netTotal} className="font-medium" /></p>
        {draft && manage ? (
          <ActionForm action={addPurchaseReceiptLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <ItemDatalist id="pr-items" items={itemList} />
            <div className="grid gap-sm sm:grid-cols-4">
              <Field label="Item code" name="itemCode" required list="pr-items" />
              <Field label="Quantity" name="qty" type="number" required />
              <Field label="Rate (₹)" name="rate" type="number" required />
              <WarehouseSelect name="warehouseId" label="Warehouse" warehouses={whs} optional />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
          </ActionForm>
        ) : null}
        {draft ? <p className="mt-sm text-caption text-muted">Rejected quantity is held in the Rejected warehouse at no value until it goes back to the supplier. Only accepted quantity is billed.</p> : null}
      </Card>
      <GlTable rows={gl} />
      <DocTrail created={{ by: names.get(pr.createdById), at: pr.createdAt }} submitted={{ by: names.get(pr.submittedById ?? ''), at: pr.submittedAt }} cancelled={{ by: names.get(pr.cancelledById ?? ''), at: pr.cancelledAt }} />
    </div>
  );
}
