import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canRead } from '@/modules/erp/services/access';
import { listDeliveryNotes } from '@/modules/erp/services/delivery-note.service';
import { EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Money, showDate } from '../../_components/parts';
import { SellingTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Deliveries' };

export default async function DeliveriesPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'selling') && !canRead(p, 'stock')) notFound();
  const rows = await listDeliveryNotes(p);
  return (
    <div className="space-y-lg">
      <PageHeader title="Deliveries" subtitle="Goods out to customers. Start a delivery from its sales order (Deliver)." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Selling', href: '/erp/selling' }, { label: 'Deliveries' }]} />
      <SellingTabs current="/erp/selling/deliveries" />
      {rows.length === 0 ? <EmptyState title="No deliveries yet" /> : (
        <table className="table">
          <thead><tr><th>Delivery</th><th>Customer</th><th>Date</th><th>Vehicle · LR</th><th>Status</th><th className="text-right">Value</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/erp/selling/deliveries/${d.id}`} className="code hover:underline">{d.number}</Link></td>
                <td>{d.customerName}</td>
                <td>{showDate(d.postingDate)}</td>
                <td>{[d.vehicleNo, d.lrNo].filter(Boolean).join(' · ') || '—'}</td>
                <td>{d.toBill ? <DocStatus status="TO_BILL" label="To bill" /> : <DocStatus status={d.status === 'SUBMITTED' ? 'COMPLETED' : d.status} label={d.status === 'SUBMITTED' ? 'Billed' : undefined} />}</td>
                <td className="text-right"><Money value={d.netTotal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
