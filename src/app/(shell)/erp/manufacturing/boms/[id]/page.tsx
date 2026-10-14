import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getBom, workstationOptions } from '@/modules/erp/services/bom.service';
import { itemOptions } from '@/modules/erp/services/item.service';
import {
  addBomItemAction,
  addBomOperationAction,
  bomActiveAction,
  cancelBomAction,
  copyBomAction,
  defaultBomAction,
  deleteBomAction,
  removeBomItemAction,
  removeBomOperationAction,
  submitBomAction,
  updateBomCostAction,
  updateBomItemAction,
} from '@/app/actions/erp-manufacturing';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { LineEdit } from '../../../_components/line-edit';
import { DocStatus, Field, ItemDatalist, Money, orNotFound, Qty } from '../../../_components/parts';
import { formatMoney } from '@/modules/erp/domain/money';

export const dynamic = 'force-dynamic';

export default async function BomPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'manufacturing')) notFound();
  const { id } = await params;
  const { bom, items, workstations, children } = await orNotFound(getBom(p, id));
  const [itemList, wsList] = await Promise.all([itemOptions(p.companyId, 'stock'), workstationOptions(p.companyId)]);
  const product = items.get(bom.itemId);
  const draft = bom.status === 'DRAFT';
  const manage = canManage(p, 'manufacturing');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={bom.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={bom.status} /> Makes {bom.qty.toString()} × {product?.code} {product?.name}{bom.isDefault ? <span className="badge badge-ink">Default</span> : null}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'BOMs', href: '/erp/manufacturing/boms' }, { label: bom.number }]}
        actions={
          manage ? (
            <>
              {draft ? <DocButton action={submitBomAction} fields={{ id }} label="Submit" variant="primary" /> : null}
              {draft ? <DocButton action={deleteBomAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" /> : null}
              <DocButton action={updateBomCostAction} fields={{ id }} label="Update cost" />
              {bom.status === 'SUBMITTED' && !bom.isDefault ? <DocButton action={defaultBomAction} fields={{ id }} label="Make default" /> : null}
              {bom.status === 'SUBMITTED' ? <DocButton action={bomActiveAction} fields={{ id, active: String(!bom.isActive) }} label={bom.isActive ? 'Switch off' : 'Switch on'} /> : null}
              <DocButton action={copyBomAction} fields={{ id }} label="Copy as new revision" />
              {bom.status === 'SUBMITTED' ? <DocButton action={cancelBomAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this BOM?" /> : null}
            </>
          ) : null
        }
      />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Materials" value={formatMoney(bom.rawMaterialCost)} />
        <Stat label="Operations" value={formatMoney(bom.operatingCost)} />
        <Stat label="Total" value={formatMoney(bom.totalCost)} />
        <Stat label="Per unit" value={formatMoney(bom.totalCost.dividedBy(bom.qty))} />
      </div>
      <Card title="Materials">
        {bom.items.length === 0 ? <EmptyState title="No materials yet" /> : (
          <table className="table">
            <thead><tr><th>Item</th><th>Sub-assembly BOM</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th>{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {bom.items.map((l) => {
                const item = items.get(l.itemId);
                return (
                  <tr key={l.id}>
                    <td><span className="code mr-xs">{item?.code}</span>{item?.name}</td>
                    <td className="code">{l.childBomId ? children.get(l.childBomId) : '—'}</td>
                    <td className="text-right">{draft && manage ? <LineEdit action={updateBomItemAction} docId={id} lineId={l.id} qty={l.qty.toString()} /> : <Qty value={l.qty} uom={item?.uom} />}</td>
                    <td className="text-right"><Money value={l.rate} /></td>
                    <td className="text-right"><Money value={l.amount} /></td>
                    {draft && manage ? <td className="text-right"><DocButton action={removeBomItemAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {draft && manage ? (
          <ActionForm action={addBomItemAction} resetOnSuccess className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <ItemDatalist id="bomline-items" items={itemList} />
            <Field label="Item code" name="itemCode" required list="bomline-items" />
            <Field label="Quantity" name="qty" type="number" required />
            <SubmitButton pendingLabel="Adding…">Add material</SubmitButton>
          </ActionForm>
        ) : null}
        <p className="mt-sm text-caption text-muted">Rates: stock valuation, else last purchase rate, else the sub-assembly's own BOM cost.</p>
      </Card>
      <Card title="Operations">
        {bom.operations.length === 0 ? <EmptyState title="No operations" hint="Add the steps (fabrication, busbar, wiring, testing) and the minutes each takes." /> : (
          <table className="table">
            <thead><tr><th>#</th><th>Operation</th><th>Workstation</th><th className="text-right">Minutes</th><th className="text-right">Rate / h</th><th className="text-right">Cost</th>{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {bom.operations.map((o, n) => (
                <tr key={o.id}>
                  <td>{n + 1}</td>
                  <td>{o.operation}</td>
                  <td>{workstations.get(o.workstationId)}</td>
                  <td className="text-right">{o.timeMinutes.toString()}</td>
                  <td className="text-right"><Money value={o.hourRate} /></td>
                  <td className="text-right"><Money value={o.cost} /></td>
                  {draft && manage ? <td className="text-right"><DocButton action={removeBomOperationAction} fields={{ id, lineId: o.id }} label="Remove" /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {draft && manage ? (
          wsList.length === 0 ? <p className="mt-sm text-caption text-muted">Add a workstation first.</p> : (
            <ActionForm action={addBomOperationAction} resetOnSuccess className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
              <input type="hidden" name="id" value={id} />
              <Field label="Operation" name="operation" required list="ops" placeholder="Wiring" />
              <datalist id="ops">{['Fabrication', 'Powder coating', 'Busbar', 'Assembly', 'Wiring', 'Testing', 'Packing'].map((o) => <option key={o} value={o} />)}</datalist>
              <div>
                <label className="label" htmlFor="workstationId">Workstation</label>
                <select id="workstationId" name="workstationId" className="select">{wsList.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              </div>
              <Field label="Minutes" name="timeMinutes" type="number" required />
              <SubmitButton pendingLabel="Adding…">Add operation</SubmitButton>
            </ActionForm>
          )
        ) : null}
      </Card>
      {bom.remarks ? <Card title="Remarks"><p className="text-body-sm">{bom.remarks}</p></Card> : null}
    </div>
  );
}
