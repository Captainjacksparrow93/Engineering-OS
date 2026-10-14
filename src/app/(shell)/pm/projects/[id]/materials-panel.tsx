import Link from 'next/link';
import type { Principal } from '@/core/rbac/types';
import { projectMaterials } from '@/modules/erp/services/project-erp.service';
import { formatMoney, formatQty } from '@/modules/erp/domain/money';
import { Card } from '@/components/ui';

/** Read-only ERP view for a project: materials from request to issue, orders and billing. */
export async function MaterialsPanel({ principal, projectId }: { principal: Principal; projectId: string }) {
  const m = await projectMaterials(principal, projectId);
  if (!m || (m.items.length === 0 && m.orders.length === 0 && m.workOrders.length === 0)) return null;
  const q = (v: { isZero(): boolean } & Parameters<typeof formatQty>[0]) => (v.isZero() ? '—' : formatQty(v));
  return (
    <Card title="Materials and orders (ERP)" className="mb-5">
      <div className="flex flex-wrap gap-x-lg gap-y-xs text-body-sm">
        {m.orders.map((o) => (
          <span key={o.id}>
            Sales order {m.canOpenErp.selling ? <Link href={`/erp/selling/orders/${o.id}`} className="code hover:underline">{o.number}</Link> : <span className="code">{o.number}</span>}
            {o.woNumber ? ` · WO ${o.woNumber}` : ''}{o.grandTotal && !o.grandTotal.isZero() ? ` · ${formatMoney(o.grandTotal)}` : ''}
          </span>
        ))}
        {m.billed !== null && !m.billed.isZero() ? <span>Billed {formatMoney(m.billed)}{m.outstanding && !m.outstanding.isZero() ? ` · ${formatMoney(m.outstanding)} to collect` : ''}</span> : null}
        {m.receivedValue !== null ? <span>Material received {formatMoney(m.receivedValue)} · issued {formatMoney(m.issuedValue ?? 0)}</span> : null}
        {m.canOpenErp.accounts ? <Link href={`/erp/accounts/reports/general-ledger?projectId=${projectId}&from=2000-01-01`} className="link-muted">Project ledger</Link> : null}
      </div>
      {m.workOrders.length ? (
        <p className="mt-sm text-body-sm">
          Work orders:{' '}
          {m.workOrders.map((w, i) => (
            <span key={w.id}>{i ? ', ' : ''}{m.canOpenErp.manufacturing ? <Link href={`/erp/manufacturing/work-orders/${w.id}`} className="code hover:underline">{w.number}</Link> : <span className="code">{w.number}</span>} ({formatQty(w.producedQty)}/{formatQty(w.qty)})</span>
          ))}
        </p>
      ) : null}
      {m.items.length ? (
        <div className="mt-sm overflow-x-auto">
          <table className="table">
            <thead><tr><th>Item</th><th className="text-right">Requested</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Issued</th></tr></thead>
            <tbody>{m.items.map((r) => (
              <tr key={r.itemId}>
                <td><span className="code mr-xs">{r.item?.code}</span>{r.item?.name}</td>
                <td className="text-right">{q(r.requested)}</td>
                <td className="text-right">{q(r.ordered)}</td>
                <td className={`text-right ${r.ordered.greaterThan(r.received) ? 'text-warning' : ''}`}>{q(r.received)}</td>
                <td className="text-right">{q(r.issued)} <span className="text-caption text-muted">{r.item?.uom}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
