import { notFound, redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { salesOrderIdByNumber } from '@/modules/erp/services/sales-order.service';

export const dynamic = 'force-dynamic';

/** PM links a project's order by number (`erpSalesOrder`); this opens it. */
export default async function SalesOrderByNumber({ params }: { params: Promise<{ number: string }> }) {
  const p = await requirePrincipal();
  const { number } = await params;
  const id = await salesOrderIdByNumber(p.companyId, decodeURIComponent(number));
  if (!id) notFound();
  redirect(`/erp/selling/orders/${id}`);
}
