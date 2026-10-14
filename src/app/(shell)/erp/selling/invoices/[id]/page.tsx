import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, userNames } from '@/modules/erp/services/access';
import { getSalesInvoice, incomeAccounts, invoiceState } from '@/modules/erp/services/sales-invoice.service';
import {
  addIncomeLineAction,
  cancelSalesInvoiceAction,
  deleteSalesInvoiceAction,
  removeSalesInvoiceLineAction,
  submitSalesInvoiceAction,
  updateSalesInvoiceAction,
  updateSalesInvoiceLineAction,
} from '@/app/actions/erp-selling';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { GlTable } from '../../../_components/gl-table';
import { InvoiceSettlement } from '../../../_components/settlement';
import { LineEdit } from '../../../_components/line-edit';
import { TotalsBlock } from '../../../_components/totals';
import { DocStatus, DocTrail, Field, isoDay, Money, orNotFound, Qty, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

export default async function SalesInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling') && !canRead(p, 'accounts')) notFound();
  const { id } = await params;
  const { inv, customer, project, accounts, gl } = await orNotFound(getSalesInvoice(p, id));
  const [income, names] = await Promise.all([incomeAccounts(p.companyId), userNames([inv.createdById, inv.submittedById, inv.cancelledById])]);
  const state = invoiceState(inv, new Date());
  const draft = inv.status === 'DRAFT';
  const manage = canManage(p, 'selling') || canManage(p, 'accounts');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={inv.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={state.key} label={state.label} /> {customer?.name} · {showDate(inv.postingDate)} · due {showDate(inv.dueDate)}{inv.poNo ? ` · PO ${inv.poNo}` : ''}{project ? <> · <Link href={`/pm/projects/${project.id}`} className="hover:underline">{project.code}</Link></> : null}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Sales invoices', href: '/erp/selling/invoices' }, { label: inv.number }]}
        actions={
          <>
            <Link href={`/print/erp/sales-invoice/${inv.id}`} target="_blank" className="btn btn-secondary btn-sm">Print</Link>
            {manage && draft ? (
              <>
                <DocButton action={submitSalesInvoiceAction} fields={{ id }} label="Submit" variant="primary" confirm="Submit this invoice? It posts to the customer's account." />
                <DocButton action={deleteSalesInvoiceAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : null}
            {manage && inv.status === 'SUBMITTED' ? <DocButton action={cancelSalesInvoiceAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this invoice? Its accounting entries are reversed." /> : null}
          </>
        }
      />
      <Card title="Lines">
        {inv.lines.length === 0 ? <EmptyState title="No lines yet" /> : (
          <table className="table">
            <thead><tr><th>Description</th><th>Posts to</th><th className="text-right">GST</th>{draft && manage ? <th className="text-right">Qty · rate</th> : <><th className="text-right">Qty</th><th className="text-right">Rate</th></>}<th className="text-right">Amount</th>{draft && manage ? <th /> : null}</tr></thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="text-caption text-muted">{l.incomeAccountId ? accounts.get(l.incomeAccountId)?.name : 'Sales'}</td>
                  <td className="text-right">{l.gstRate.toString()}%</td>
                  {draft && manage ? <td><LineEdit action={updateSalesInvoiceLineAction} docId={id} lineId={l.id} qty={l.qty.toString()} rate={l.rate.toString()} /></td> : <><td className="text-right"><Qty value={l.qty} /></td><td className="text-right"><Money value={l.rate} /></td></>}
                  <td className="text-right"><Money value={l.amount} /></td>
                  {draft && manage ? <td className="text-right"><DocButton action={removeSalesInvoiceLineAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <TotalsBlock t={inv} outstanding={inv.status === 'SUBMITTED' ? inv.outstandingAmount : null} />
        {draft && manage ? (
          <ActionForm action={addIncomeLineAction} resetOnSuccess className="mt-base border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-sm sm:grid-cols-5">
              <Field label="Description" name="description" required className="sm:col-span-2" />
              <div>
                <label className="label" htmlFor="accountId">Income account</label>
                <select id="accountId" name="accountId" className="select w-full">{income.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
              </div>
              <Field label="Qty" name="qty" type="number" defaultValue="1" required />
              <Field label="Rate (₹)" name="rate" type="number" required />
              <Field label="GST %" name="gstRate" type="number" defaultValue="18" required />
            </div>
            <div className="mt-sm"><SubmitButton pendingLabel="Adding…">Add line</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Card>
      {draft && manage ? (
        <Card title="Invoice details">
          <ActionForm action={updateSalesInvoiceAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-sm sm:grid-cols-4">
              <Field label="Invoice date" name="postingDate" type="date" defaultValue={isoDay(inv.postingDate)} required />
              <Field label="Due date" name="dueDate" type="date" defaultValue={isoDay(inv.dueDate)} />
              <Field label="Client PO number" name="poNo" defaultValue={inv.poNo} />
              <Field label="Remarks" name="remarks" defaultValue={inv.remarks} />
            </div>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <InvoiceSettlement p={p} type="Sales Invoice" inv={inv} partyId={inv.customerId} returnsArea="selling" />
      <GlTable rows={gl} />
      <DocTrail created={{ by: names.get(inv.createdById), at: inv.createdAt }} submitted={{ by: names.get(inv.submittedById ?? ''), at: inv.submittedAt }} cancelled={{ by: names.get(inv.cancelledById ?? ''), at: inv.cancelledAt }} />
    </div>
  );
}
