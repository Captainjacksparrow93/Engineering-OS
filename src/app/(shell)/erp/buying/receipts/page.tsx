import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { partyOptions } from '@/modules/erp/services/party.service';
import { listPurchaseReceipts } from '@/modules/erp/services/purchase-receipt.service';
import { createPurchaseReceiptAction } from '@/app/actions/erp-buying';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { BuyingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Purchase receipts' };

export default async function ReceiptsPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'buying') && !canRead(p, 'stock')) notFound();
  const [rows, suppliers] = await Promise.all([listPurchaseReceipts(p), partyOptions(p.companyId, 'SUPPLIER')]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Purchase receipts" subtitle="Goods in from suppliers. Most receipts start from a purchase order (Receive)." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Buying', href: '/erp/buying' }, { label: 'Receipts' }]} />
      <BuyingTabs current="/erp/buying/receipts" />
      {canManage(p, 'stock') || canManage(p, 'buying') ? (
        <Card title="Receipt without an order">
          <ActionForm action={createPurchaseReceiptAction} className="flex flex-wrap items-end gap-sm">
            <div className="min-w-[14rem]">
              <label className="label" htmlFor="supplierId">Supplier</label>
              <select id="supplierId" name="supplierId" className="select w-full" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>
            <Field label="Receipt date" name="postingDate" type="date" defaultValue={todayIso()} required />
            <Field label="Supplier's delivery note" name="supplierDeliveryNote" />
            <SubmitButton pendingLabel="Creating…">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      {rows.length === 0 ? <EmptyState title="No receipts yet" /> : (
        <table className="table">
          <thead><tr><th>Receipt</th><th>Supplier</th><th>Date</th><th>Delivery note</th><th>Status</th><th className="text-right">Value</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/erp/buying/receipts/${r.id}`} className="code hover:underline">{r.number}</Link></td>
                <td>{r.supplierName}</td>
                <td>{showDate(r.postingDate)}</td>
                <td>{r.supplierDeliveryNote ?? '—'}</td>
                <td>{r.toBill ? <DocStatus status="TO_BILL" label="To bill" /> : <DocStatus status={r.status === 'SUBMITTED' ? 'COMPLETED' : r.status} label={r.status === 'SUBMITTED' ? 'Billed' : undefined} />}</td>
                <td className="text-right"><Money value={r.netTotal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
