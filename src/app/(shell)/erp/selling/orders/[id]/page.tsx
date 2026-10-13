import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { canManage, canRead, userNames } from '@/modules/erp/services/access';
import { itemOptions, warehouseOptions } from '@/modules/erp/services/item.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { getSalesOrder } from '@/modules/erp/services/sales-order.service';
import {
  addSalesOrderLineAction,
  cancelSalesOrderAction,
  closeSalesOrderAction,
  deleteSalesOrderAction,
  deliveryFromOrderAction,
  holdSalesOrderAction,
  invoiceFromSalesOrderAction,
  removeSalesOrderLineAction,
  submitSalesOrderAction,
  updateSalesOrderAction,
  updateSalesOrderLineAction,
  updateSubmittedSalesOrderAction,
} from '@/app/actions/erp-selling';
import { workOrdersFromSalesOrderAction } from '@/app/actions/erp-manufacturing';
import { D } from '@/modules/erp/domain/money';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { LineEdit } from '../../../_components/line-edit';
import { TotalsBlock } from '../../../_components/totals';
import { DocStatus, DocTrail, Field, isoDay, ItemDatalist, Money, orNotFound, Qty, showDate, WarehouseSelect } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling')) notFound();
  const { id } = await params;
  const { so, customer, project, items, warehouses, state, deliveries, invoices } = await orNotFound(getSalesOrder(p, id));
  const [itemList, whs, customers, names, deal] = await Promise.all([
    itemOptions(p.companyId, 'sales'),
    warehouseOptions(p.companyId),
    partyOptions(p.companyId, 'CUSTOMER'),
    userNames([so.createdById, so.submittedById, so.cancelledById]),
    so.dealId ? prisma.salesDeal.findUnique({ where: { id: so.dealId }, select: { id: true, code: true } }) : null,
  ]);
  const draft = so.status === 'DRAFT';
  const open = so.status === 'SUBMITTED' && !so.isClosed;
  const manage = canManage(p, 'selling');
  const editable = manage && (draft || open);
  return (
    <div className="space-y-lg">
      <PageHeader
        title={so.number}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-xs">
            <DocStatus status={state.key} label={state.label} /> {customer?.name} · {showDate(so.orderDate)}
            {so.woNumber ? ` · WO ${so.woNumber}` : ''}{so.poNo ? ` · PO ${so.poNo}` : ''}
            {so.status === 'SUBMITTED' ? ` · ${state.delivered}% delivered · ${state.billed}% billed` : ''}
          </span>
        }
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Sales orders', href: '/erp/selling/orders' }, { label: so.number }]}
        actions={
          <>
            <Link href={`/print/erp/sales-order/${so.id}`} target="_blank" className="btn btn-secondary btn-sm">Print</Link>
            {manage && draft ? (
              <>
                <DocButton action={submitSalesOrderAction} fields={{ id }} label="Submit" variant="primary" confirm="Submit this order? It reserves stock and becomes available to New project." />
                <DocButton action={deleteSalesOrderAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : null}
            {open && !so.isOnHold && (manage || canManage(p, 'stock')) && state.delivered < 100 ? <DocButton action={deliveryFromOrderAction} fields={{ id }} label="Deliver" variant="primary" /> : null}
            {so.status === 'SUBMITTED' && (manage || canManage(p, 'accounts')) && state.billed < 100 ? <DocButton action={invoiceFromSalesOrderAction} fields={{ id }} label="Make invoice" /> : null}
            {open && canManage(p, 'manufacturing') && state.delivered < 100 ? <DocButton action={workOrdersFromSalesOrderAction} fields={{ id }} label="Make work orders" /> : null}
            {open && manage ? <DocButton action={holdSalesOrderAction} fields={{ id, hold: String(!so.isOnHold) }} label={so.isOnHold ? 'Release hold' : 'Hold'} /> : null}
            {so.status === 'SUBMITTED' && manage ? <DocButton action={closeSalesOrderAction} fields={{ id, close: String(!so.isClosed) }} label={so.isClosed ? 'Re-open' : 'Close'} /> : null}
            {so.status === 'SUBMITTED' && manage ? <DocButton action={cancelSalesOrderAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this order? A linked project is alerted, not deleted." /> : null}
          </>
        }
      />
      {project ? (
        <Alert tone="info">Project <Link href={`/pm/projects/${project.id}`} className="font-medium underline">{project.code} {project.name}</Link> was made from this order. Changes to PO, dates, WO and panels reach it on its next sync; removed panels only raise an alert.</Alert>
      ) : so.status === 'SUBMITTED' && !so.isClosed ? (
        <Alert tone="info">Waiting for a project. A Director picks it in Projects → New project.</Alert>
      ) : null}
      {deal ? <p className="text-caption text-muted">From won deal <Link href={`/sales/deals/${deal.id}`} className="code hover:underline">{deal.code}</Link>{so.quotationRef ? `, quote ${so.quotationRef}` : ''}.</p> : null}

      <Card title="Items">
        {so.lines.length === 0 ? <EmptyState title="No items yet" hint="Panel lines use the checklist template code (PLC, SCADA, HMI…) as the item, one quantity per panel." /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Item</th><th>Warehouse</th><th className="text-right">GST</th>{editable ? <th className="text-right">Qty · rate · delivery</th> : <><th className="text-right">Qty</th><th className="text-right">Rate</th><th>Delivery</th></>}<th className="text-right">Amount</th>{!draft ? <><th className="text-right">Delivered</th><th className="text-right">Billed</th></> : null}{editable ? <th /> : null}</tr></thead>
              <tbody>
                {so.lines.map((l) => {
                  const item = items.get(l.itemId);
                  const touched = !D(l.deliveredQty).isZero() || !D(l.billedQty).isZero();
                  return (
                    <tr key={l.id}>
                      <td><span className="code mr-xs">{item?.code}</span>{l.description ?? item?.name}</td>
                      <td>{item?.isStockItem ? warehouses.get(l.warehouseId) : '—'}</td>
                      <td className="text-right">{l.gstRate.toString()}%</td>
                      {editable ? <td><LineEdit action={updateSalesOrderLineAction} docId={id} lineId={l.id} qty={l.qty.toString()} rate={l.rate.toString()} date={isoDay(l.deliveryDate)} /></td> : <><td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td><td className="text-right"><Money value={l.rate} /></td><td>{showDate(l.deliveryDate)}</td></>}
                      <td className="text-right"><Money value={l.amount} /></td>
                      {!draft ? <><td className="text-right">{item?.isStockItem ? <Qty value={l.deliveredQty} /> : '—'}</td><td className="text-right"><Qty value={l.billedQty} /></td></> : null}
                      {editable ? <td className="text-right">{touched ? null : <DocButton action={removeSalesOrderLineAction} fields={{ id, lineId: l.id }} label="Remove" />}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <TotalsBlock t={so} />
        {editable ? (
          <ActionForm action={addSalesOrderLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <ItemDatalist id="so-items" items={itemList} />
            <div className="grid gap-sm sm:grid-cols-5">
              <Field label="Item code" name="itemCode" required list="so-items" />
              <Field label="Quantity" name="qty" type="number" required />
              <Field label="Rate (₹)" name="rate" type="number" placeholder="Item's selling rate" />
              <Field label="Delivery date" name="deliveryDate" type="date" />
              <WarehouseSelect name="warehouseId" label="Deliver from" warehouses={whs} optional />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
            {open ? <p className="mt-xs text-caption text-muted">Adding a panel line to an order with a project adds the panel to the project on its next sync.</p> : null}
          </ActionForm>
        ) : null}
      </Card>

      {manage && draft ? (
        <Card title="Order details">
          <ActionForm action={updateSalesOrderAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-sm sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="customerId">Customer</label>
                <select id="customerId" name="customerId" defaultValue={so.customerId} className="select w-full">{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </div>
              <Field label="Order date" name="orderDate" type="date" defaultValue={isoDay(so.orderDate)} required />
              <Field label="Delivery date" name="deliveryDate" type="date" defaultValue={isoDay(so.deliveryDate)} />
              <Field label="WO number" name="woNumber" defaultValue={so.woNumber} />
              <Field label="Client PO number" name="poNo" defaultValue={so.poNo} />
              <Field label="Remarks" name="remarks" defaultValue={so.remarks} />
            </div>
            <div>
              <label className="label" htmlFor="terms">Terms and conditions</label>
              <textarea id="terms" name="terms" defaultValue={so.terms ?? ''} rows={4} className="input w-full" />
            </div>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : open && manage ? (
        <Card title="Change after submit">
          <ActionForm action={updateSubmittedSalesOrderAction} className="flex flex-wrap items-end gap-sm">
            <input type="hidden" name="id" value={id} />
            <Field label="Delivery date" name="deliveryDate" type="date" defaultValue={isoDay(so.deliveryDate)} />
            <Field label="WO number" name="woNumber" defaultValue={so.woNumber} />
            <Field label="Client PO number" name="poNo" defaultValue={so.poNo} />
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {deliveries.length || invoices.length ? (
        <Card title="Deliveries and invoices">
          <ul className="space-y-xxs text-body-sm">
            {deliveries.map((d) => <li key={d.id}><Link href={`/erp/selling/deliveries/${d.id}`} className="code hover:underline">{d.number}</Link> delivery · {showDate(d.postingDate)} <DocStatus status={d.status} /></li>)}
            {invoices.map((d) => <li key={d.id}><Link href={`/erp/selling/invoices/${d.id}`} className="code hover:underline">{d.number}</Link> invoice · {showDate(d.postingDate)} <DocStatus status={d.status} /></li>)}
          </ul>
        </Card>
      ) : null}
      <DocTrail created={{ by: names.get(so.createdById), at: so.createdAt }} submitted={{ by: names.get(so.submittedById ?? ''), at: so.submittedAt }} cancelled={{ by: names.get(so.cancelledById ?? ''), at: so.cancelledAt }} />
    </div>
  );
}
