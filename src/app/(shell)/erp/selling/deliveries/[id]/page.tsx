import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, userNames } from '@/modules/erp/services/access';
import { getDeliveryNote } from '@/modules/erp/services/delivery-note.service';
import {
  cancelDeliveryNoteAction,
  deleteDeliveryNoteAction,
  invoiceFromDeliveryAction,
  removeDeliveryLineAction,
  submitDeliveryNoteAction,
  updateDeliveryLineAction,
  updateDeliveryNoteAction,
} from '@/app/actions/erp-selling';
import { D } from '@/modules/erp/domain/money';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { GlTable } from '../../../_components/gl-table';
import { LineEdit } from '../../../_components/line-edit';
import { DocStatus, DocTrail, Field, isoDay, Money, orNotFound, Qty, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling') && !canRead(p, 'stock')) notFound();
  const { id } = await params;
  const { dn, customer, items, warehouses, orders, gl } = await orNotFound(getDeliveryNote(p, id));
  const names = await userNames([dn.createdById, dn.submittedById, dn.cancelledById]);
  const draft = dn.status === 'DRAFT';
  const manage = canManage(p, 'selling') || canManage(p, 'stock');
  const unbilled = dn.status === 'SUBMITTED' && dn.lines.some((l) => D(l.qty).greaterThan(D(l.billedQty)));
  return (
    <div className="space-y-lg">
      <PageHeader
        title={dn.number}
        subtitle={<span className="inline-flex items-center gap-xs"><DocStatus status={dn.status} /> {customer?.name} · {showDate(dn.postingDate)}{dn.vehicleNo ? ` · ${dn.vehicleNo}` : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Deliveries', href: '/erp/selling/deliveries' }, { label: dn.number }]}
        actions={
          <>
            <Link href={`/print/erp/delivery-note/${dn.id}`} target="_blank" className="btn btn-secondary btn-sm">Print</Link>
            {manage && draft ? (
              <>
                <DocButton action={submitDeliveryNoteAction} fields={{ id }} label="Submit" variant="primary" confirm="Submit this delivery? Stock leaves and its cost is booked." />
                <DocButton action={deleteDeliveryNoteAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : null}
            {unbilled && (canManage(p, 'selling') || canManage(p, 'accounts')) ? <DocButton action={invoiceFromDeliveryAction} fields={{ id }} label="Make invoice" variant="primary" /> : null}
            {manage && dn.status === 'SUBMITTED' ? <DocButton action={cancelDeliveryNoteAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this delivery? Stock comes back." /> : null}
          </>
        }
      />
      <Card title="Items">
        {dn.lines.length === 0 ? <EmptyState title="No items" /> : (
          <table className="table">
            <thead><tr><th>Item</th><th>Order</th><th>From</th>{draft && manage ? <th className="text-right">Qty</th> : <th className="text-right">Qty</th>}<th className="text-right">Rate</th><th className="text-right">Amount</th>{!draft ? <th className="text-right">Cost</th> : null}{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {dn.lines.map((l) => {
                const item = items.get(l.itemId);
                const order = l.orderLineId ? orders.get(l.orderLineId) : null;
                return (
                  <tr key={l.id}>
                    <td><span className="code mr-xs">{item?.code}</span>{item?.name}{item?.inspectionBeforeDelivery ? (l.qualityInspectionId ? <Link href={`/erp/quality/inspections/${l.qualityInspectionId}`} className="ml-xs text-caption hover:underline">Inspected</Link> : draft ? <Link href={`/erp/quality/inspections?item=${encodeURIComponent(item.code)}&referenceType=Delivery%20Note&referenceId=${id}&referenceLineId=${l.id}`} className="ml-xs text-caption text-accent hover:underline">Inspect</Link> : null) : null}</td>
                    <td>{order ? <Link href={`/erp/selling/orders/${order.id}`} className="code hover:underline">{order.number}</Link> : '—'}</td>
                    <td>{warehouses.get(l.warehouseId)}</td>
                    <td className="text-right">{draft && manage ? <LineEdit action={updateDeliveryLineAction} docId={id} lineId={l.id} qty={l.qty.toString()} /> : <Qty value={l.qty} uom={item?.uom} />}</td>
                    <td className="text-right"><Money value={l.rate} /></td>
                    <td className="text-right"><Money value={l.amount} /></td>
                    {!draft ? <td className="text-right"><Money value={l.costAmount} /></td> : null}
                    {draft && manage ? <td className="text-right"><DocButton action={removeDeliveryLineAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {draft && manage ? (
        <Card title="Transport">
          <ActionForm action={updateDeliveryNoteAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-sm sm:grid-cols-5">
              <Field label="Delivery date" name="postingDate" type="date" defaultValue={isoDay(dn.postingDate)} required />
              <Field label="Transporter" name="transporter" defaultValue={dn.transporter} />
              <Field label="Vehicle no." name="vehicleNo" defaultValue={dn.vehicleNo} />
              <Field label="LR no." name="lrNo" defaultValue={dn.lrNo} />
              <Field label="Remarks" name="remarks" defaultValue={dn.remarks} />
            </div>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : dn.transporter || dn.lrNo ? <Card title="Transport"><p className="text-body-sm">{[dn.transporter, dn.vehicleNo, dn.lrNo ? `LR ${dn.lrNo}` : null].filter(Boolean).join(' · ')}</p></Card> : null}
      <GlTable rows={gl} />
      <DocTrail created={{ by: names.get(dn.createdById), at: dn.createdAt }} submitted={{ by: names.get(dn.submittedById ?? ''), at: dn.submittedAt }} cancelled={{ by: names.get(dn.cancelledById ?? ''), at: dn.cancelledAt }} />
    </div>
  );
}
