import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { itemOptions } from '@/modules/erp/services/item.service';
import { getSupplierQuotation } from '@/modules/erp/services/supplier-quotation.service';
import {
  addSupplierQuotationLineAction,
  cancelSupplierQuotationAction,
  deleteSupplierQuotationAction,
  orderFromQuotationAction,
  removeSupplierQuotationLineAction,
  submitSupplierQuotationAction,
  updateSupplierQuotationLineAction,
} from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { LineEdit } from '../../../_components/line-edit';
import { DocStatus, Field, ItemDatalist, Money, orNotFound, Qty, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const { id } = await params;
  const { sq, supplier, items } = await orNotFound(getSupplierQuotation(p, id));
  const itemList = await itemOptions(p.companyId, 'purchase');
  const draft = sq.status === 'DRAFT';
  const manage = canManage(p, 'buying');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={sq.number}
        subtitle={<span className="inline-flex items-center gap-xs"><DocStatus status={sq.status} /> {supplier?.name} · {showDate(sq.quoteDate)}{sq.validTill ? ` · valid till ${showDate(sq.validTill)}` : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Supplier quotations', href: '/erp/buying/quotations' }, { label: sq.number }]}
        actions={
          manage ? (
            draft ? (
              <>
                <DocButton action={submitSupplierQuotationAction} fields={{ id }} label="Submit" variant="primary" />
                <DocButton action={deleteSupplierQuotationAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : sq.status === 'SUBMITTED' ? (
              <>
                <DocButton action={orderFromQuotationAction} fields={{ id }} label="Make purchase order" variant="primary" />
                {sq.materialRequestId ? <Link href={`/erp/buying/quotations/compare?mr=${sq.materialRequestId}`} className="btn btn-secondary btn-sm">Compare</Link> : null}
                <DocButton action={cancelSupplierQuotationAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this quotation?" />
              </>
            ) : null
          ) : null
        }
      />
      <Card title="Quoted items">
        {sq.lines.length === 0 ? <EmptyState title="No items yet" /> : (
          <table className="table">
            <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th>Lead time</th>{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {sq.lines.map((l) => {
                const item = items.get(l.itemId);
                return (
                  <tr key={l.id}>
                    <td><span className="code mr-xs">{item?.code}</span>{item?.name}</td>
                    {draft && manage ? (
                      <td colSpan={3}><LineEdit action={updateSupplierQuotationLineAction} docId={id} lineId={l.id} qty={l.qty.toString()} rate={l.rate.toString()} /></td>
                    ) : (
                      <>
                        <td className="text-right"><Qty value={l.qty} uom={item?.uom} /></td>
                        <td className="text-right"><Money value={l.rate} /></td>
                        <td className="text-right"><Money value={l.amount} /></td>
                      </>
                    )}
                    <td>{l.leadTimeDays ? `${l.leadTimeDays} days` : '—'}</td>
                    {draft && manage ? <td className="text-right"><DocButton action={removeSupplierQuotationLineAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-sm text-right text-body-sm">Net total <Money value={sq.netTotal} className="font-medium" /></p>
        {draft && manage ? (
          <ActionForm action={addSupplierQuotationLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <ItemDatalist id="sq-items" items={itemList} />
            <div className="grid gap-sm sm:grid-cols-4">
              <Field label="Item code" name="itemCode" required list="sq-items" />
              <Field label="Quantity" name="qty" type="number" required />
              <Field label="Rate (₹)" name="rate" type="number" required />
              <Field label="Lead time (days)" name="leadTimeDays" type="number" />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Card>
    </div>
  );
}
