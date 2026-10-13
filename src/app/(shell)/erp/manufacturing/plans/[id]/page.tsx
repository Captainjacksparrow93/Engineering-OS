import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { itemOptions } from '@/modules/erp/services/item.service';
import { getProductionPlan, materialRequirement } from '@/modules/erp/services/production-plan.service';
import {
  addPlanItemAction,
  cancelPlanAction,
  deletePlanAction,
  planFromOrdersAction,
  planMaterialRequestAction,
  planWorkOrdersAction,
  removePlanItemAction,
  submitPlanAction,
} from '@/app/actions/erp-manufacturing';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, ItemDatalist, orNotFound, Qty, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const { id } = await params;
  const { plan, items, boms, workOrders, soLines } = await orNotFound(getProductionPlan(p, id));
  const [need, itemList] = await Promise.all([materialRequirement(p, id), itemOptions(p.companyId, 'stock')]);
  const draft = plan.status === 'DRAFT';
  const manage = canManage(p, 'manufacturing');
  const short = need.filter((n) => n.shortage.greaterThan(0));
  return (
    <div className="space-y-lg">
      <PageHeader
        title={plan.number}
        subtitle={<span className="inline-flex items-center gap-xs"><DocStatus status={plan.status} /> {showDate(plan.postingDate)}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Production plans', href: '/erp/manufacturing/plans' }, { label: plan.number }]}
        actions={
          manage ? (
            <>
              {draft ? <DocButton action={planFromOrdersAction} fields={{ id }} label="Get items from sales orders" /> : null}
              {draft ? <DocButton action={submitPlanAction} fields={{ id }} label="Submit" variant="primary" /> : null}
              {draft ? <DocButton action={deletePlanAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" /> : null}
              {plan.status === 'SUBMITTED' && workOrders.length === 0 ? <DocButton action={planWorkOrdersAction} fields={{ id }} label="Make work orders" variant="primary" /> : null}
              {plan.status === 'SUBMITTED' && short.some((s) => s.isPurchaseItem) ? <DocButton action={planMaterialRequestAction} fields={{ id }} label="Request shortages" /> : null}
              {plan.status === 'SUBMITTED' ? <DocButton action={cancelPlanAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this plan?" /> : null}
            </>
          ) : null
        }
      />
      <Card title="To make">
        {plan.items.length === 0 ? <EmptyState title="Nothing planned yet" hint="Get items from open sales orders, or add them one by one." /> : (
          <table className="table">
            <thead><tr><th>Item</th><th>BOM</th><th>Sales order</th><th className="text-right">Qty</th>{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {plan.items.map((l) => {
                const item = items.get(l.itemId);
                const so = l.salesOrderLineId ? soLines.get(l.salesOrderLineId) : null;
                return (
                  <tr key={l.id}>
                    <td><span className="code mr-xs">{item?.code}</span>{item?.name}</td>
                    <td className="code">{l.bomId ? boms.get(l.bomId) : '—'}</td>
                    <td>{so ? <Link href={`/erp/selling/orders/${so.id}`} className="code hover:underline">{so.number}</Link> : '—'}</td>
                    <td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td>
                    {draft && manage ? <td className="text-right"><DocButton action={removePlanItemAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {draft && manage ? (
          <ActionForm action={addPlanItemAction} resetOnSuccess className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <ItemDatalist id="plan-items" items={itemList} />
            <Field label="Item code" name="itemCode" required list="plan-items" />
            <Field label="Quantity" name="qty" type="number" required />
            <Field label="Planned start" name="plannedStart" type="date" />
            <SubmitButton pendingLabel="Adding…">Add item</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>
      <Card title="Materials needed (all BOM levels)">
        {need.length === 0 ? <EmptyState title="Add items to see their materials" /> : (
          <table className="table">
            <thead><tr><th>Material</th><th className="text-right">Required</th><th className="text-right">Projected stock</th><th className="text-right">Short</th></tr></thead>
            <tbody>
              {need.map((n) => (
                <tr key={n.itemId}>
                  <td><span className="code mr-xs">{n.code}</span>{n.name}</td>
                  <td className="text-right"><Qty value={n.required} uom={n.uom} /></td>
                  <td className="text-right"><Qty value={n.projected} /></td>
                  <td className={`text-right ${n.shortage.greaterThan(0) ? 'font-medium text-error' : 'text-muted'}`}><Qty value={n.shortage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-sm text-caption text-muted">Projected stock = in stock + on order + requested + planned − promised to customers.</p>
      </Card>
      {workOrders.length ? (
        <Card title="Work orders">
          <ul className="space-y-xxs text-body-sm">{workOrders.map((w) => <li key={w.id}><Link href={`/erp/manufacturing/work-orders/${w.id}`} className="code hover:underline">{w.number}</Link> <DocStatus status={w.status} /></li>)}</ul>
        </Card>
      ) : null}
    </div>
  );
}
