import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getWorkOrder } from '@/modules/erp/services/work-order.service';
import { JOB_STATUS_LABEL } from '@/modules/erp/services/job-card.service';
import { PURPOSE_LABEL } from '@/modules/erp/services/stock-entry.service';
import {
  cancelWorkOrderAction,
  cancelWorkOrderEntryAction,
  deleteWorkOrderAction,
  manufactureAction,
  stopWorkOrderAction,
  submitWorkOrderAction,
  transferMaterialsAction,
  updateWorkOrderQtyAction,
} from '@/app/actions/erp-manufacturing';
import { D } from '@/modules/erp/domain/money';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader, ProgressBar } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, Money, orNotFound, Qty, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const { id } = await params;
  const { wo, bom, salesOrder, project, items, warehouses, workstations, jobCards, entries, state } = await orNotFound(getWorkOrder(p, id));
  const product = items.get(wo.itemId);
  const manage = canManage(p, 'manufacturing');
  const running = wo.status === 'SUBMITTED' && !wo.isStopped && state.key !== 'COMPLETED';
  const toTransfer = D(wo.qty).minus(D(wo.materialTransferredQty));
  const ready = D(wo.materialTransferredQty).minus(D(wo.producedQty));
  const latest = [...entries].reverse().find((e) => e.status === 'SUBMITTED');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={wo.number}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-xs">
            <DocStatus status={state.key} label={state.label} /> {D(wo.qty).toString()} × {product?.code} {product?.name}
            {bom ? <> · <Link href={`/erp/manufacturing/boms/${bom.id}`} className="code hover:underline">{bom.number}</Link></> : null}
            {salesOrder ? <> · <Link href={`/erp/selling/orders/${salesOrder.id}`} className="code hover:underline">{salesOrder.number}</Link></> : null}
            {project ? <> · <Link href={`/pm/projects/${project.id}`} className="hover:underline">{project.code}</Link></> : null}
            {wo.expectedEnd ? ` · needed by ${showDate(wo.expectedEnd)}` : ''}
          </span>
        }
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Work orders', href: '/erp/manufacturing/work-orders' }, { label: wo.number }]}
        actions={
          manage ? (
            <>
              {wo.status === 'DRAFT' ? <DocButton action={submitWorkOrderAction} fields={{ id }} label="Submit" variant="primary" /> : null}
              {wo.status === 'DRAFT' ? <DocButton action={deleteWorkOrderAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" /> : null}
              {wo.status === 'SUBMITTED' && state.key !== 'COMPLETED' ? <DocButton action={stopWorkOrderAction} fields={{ id, stop: String(!wo.isStopped) }} label={wo.isStopped ? 'Resume' : 'Stop'} /> : null}
              {wo.status === 'SUBMITTED' && !latest ? <DocButton action={cancelWorkOrderAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this work order?" /> : null}
            </>
          ) : null
        }
      />
      {wo.status === 'SUBMITTED' ? (
        <div className="space-y-xs">
          <ProgressBar value={state.produced} tone={state.produced >= 100 ? 'success' : 'default'} />
          <p className="text-caption text-muted">{D(wo.producedQty).toString()} of {D(wo.qty).toString()} made · materials in WIP for {D(wo.materialTransferredQty).toString()}</p>
        </div>
      ) : null}
      {manage && wo.status === 'DRAFT' ? (
        <Card title="Quantity">
          <ActionForm action={updateWorkOrderQtyAction} className="flex items-end gap-sm">
            <input type="hidden" name="id" value={id} />
            <Field label="Quantity" name="qty" type="number" defaultValue={wo.qty.toString()} required />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      {manage && running ? (
        <div className="grid gap-lg md:grid-cols-2">
          <Card title="1. Transfer materials">
            {toTransfer.greaterThan(0) ? (
              <ActionForm action={transferMaterialsAction} className="flex flex-wrap items-end gap-sm">
                <input type="hidden" name="id" value={id} />
                <Field label={`For how many (up to ${toTransfer.toString()})`} name="qty" type="number" defaultValue={toTransfer.toString()} />
                <SubmitButton variant="primary" pendingLabel="Moving…">Move to WIP</SubmitButton>
              </ActionForm>
            ) : <p className="text-body-sm text-muted">All materials are in Work In Progress.</p>}
          </Card>
          <Card title="2. Finish">
            {ready.greaterThan(0) ? (
              <ActionForm action={manufactureAction} className="flex flex-wrap items-end gap-sm">
                <input type="hidden" name="id" value={id} />
                <Field label={`How many are finished (up to ${ready.toString()})`} name="qty" type="number" defaultValue={ready.toString()} required />
                <SubmitButton variant="primary" pendingLabel="Posting…">Finish</SubmitButton>
              </ActionForm>
            ) : <p className="text-body-sm text-muted">Transfer materials first.</p>}
          </Card>
        </div>
      ) : null}
      <Card title="Materials">
        {wo.items.length === 0 ? <EmptyState title="Materials are listed from the BOM on submit" /> : (
          <table className="table">
            <thead><tr><th>Item</th><th>From</th><th className="text-right">Required</th><th className="text-right">In WIP</th><th className="text-right">Consumed</th></tr></thead>
            <tbody>
              {wo.items.map((i) => {
                const item = items.get(i.itemId);
                return (
                  <tr key={i.id}>
                    <td><span className="code mr-xs">{item?.code}</span>{item?.name}</td>
                    <td>{warehouses.get(i.sourceWarehouseId)}</td>
                    <td className="text-right"><Qty value={i.requiredQty} uom={item?.uom} /></td>
                    <td className="text-right"><Qty value={i.transferredQty} /></td>
                    <td className="text-right"><Qty value={i.consumedQty} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {jobCards.length ? (
        <Card title="Job cards">
          <table className="table">
            <thead><tr><th>Job card</th><th>Operation</th><th>Workstation</th><th className="text-right">Done</th><th className="text-right">Minutes (plan / actual)</th><th>Status</th></tr></thead>
            <tbody>
              {jobCards.map((j) => (
                <tr key={j.id}>
                  <td><Link href={`/erp/manufacturing/job-cards/${j.id}`} className="code hover:underline">{j.number}</Link></td>
                  <td>{j.operation}</td>
                  <td>{workstations.get(j.workstationId)}</td>
                  <td className="text-right"><Qty value={j.completedQty} /> / <Qty value={j.forQty} /></td>
                  <td className="text-right">{j.plannedMinutes.toString()} / {j.totalMinutes.toString()}</td>
                  <td><DocStatus status={j.status === 'COMPLETED' ? 'COMPLETED' : j.status} label={JOB_STATUS_LABEL[j.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {entries.length ? (
        <Card title="Stock entries">
          <table className="table">
            <thead><tr><th>Entry</th><th>Purpose</th><th>Date</th><th>Status</th><th className="text-right">Value</th><th /></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/erp/stock/entries/${e.id}`} className="code hover:underline">{e.number}</Link></td>
                  <td>{PURPOSE_LABEL[e.purpose]}</td>
                  <td>{showDate(e.postingDate)}</td>
                  <td><DocStatus status={e.status} /></td>
                  <td className="text-right"><Money value={e.totalValue} /></td>
                  <td className="text-right">{manage && latest?.id === e.id ? <DocButton action={cancelWorkOrderEntryAction} fields={{ id, entryId: e.id }} label="Cancel" variant="danger" confirm="Cancel this entry? Its stock and progress are reversed." /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
