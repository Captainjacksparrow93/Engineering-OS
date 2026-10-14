import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { partyOptions } from '@/modules/erp/services/party.service';
import { listSupplierQuotations } from '@/modules/erp/services/supplier-quotation.service';
import { createSupplierQuotationAction } from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { BuyingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Supplier quotations' };

export default async function QuotationsPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying')) notFound();
  const [rows, suppliers] = await Promise.all([listSupplierQuotations(p), partyOptions(p.companyId, 'SUPPLIER')]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  return (
    <div className="space-y-lg">
      <PageHeader title="Supplier quotations" breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Buying', href: '/erp/buying' }, { label: 'Supplier quotations' }]} actions={<Link href="/erp/buying/quotations/compare" className="btn btn-secondary">Compare prices</Link>} />
      <BuyingTabs current="/erp/buying/quotations" />
      {canManage(p, 'buying') ? (
        <Card title="New supplier quotation">
          <ActionForm action={createSupplierQuotationAction} className="flex flex-wrap items-end gap-sm">
            <div className="min-w-[14rem]">
              <label className="label" htmlFor="supplierId">Supplier</label>
              <select id="supplierId" name="supplierId" className="select w-full" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>
            <Field label="Quotation date" name="quoteDate" type="date" defaultValue={todayIso()} required />
            <Field label="Valid till" name="validTill" type="date" />
            <Field label="Supplier's ref." name="supplierRef" />
            <SubmitButton variant="primary" pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      {rows.length === 0 ? <EmptyState title="No supplier quotations" hint="Open a submitted purchase request and choose Request quotation, or start one here." /> : (
        <table className="table">
          <thead><tr><th>Quotation</th><th>Supplier</th><th>Date</th><th>Valid till</th><th>Status</th><th className="text-right">Net total</th></tr></thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td><Link href={`/erp/buying/quotations/${q.id}`} className="code hover:underline">{q.number}</Link></td>
                <td>{name.get(q.supplierId) ?? '—'}</td>
                <td>{showDate(q.quoteDate)}</td>
                <td>{showDate(q.validTill)}</td>
                <td><DocStatus status={q.status} /></td>
                <td className="text-right"><Money value={q.netTotal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
