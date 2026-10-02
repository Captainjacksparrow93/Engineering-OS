'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate } from '@/core/utils/dates';
import { getSalesOrderAction, listWaitingOrdersAction } from '@/app/actions/erp-orders';
import type { ProjectOrderInput, WaitingOrder } from '@/modules/erp/order.service';

/** New project, step 0 (ERP on): pick a confirmed sales order that has no project yet. */
export function SalesOrderStep({
  onPick,
  onServiceCall,
}: {
  onPick: (order: ProjectOrderInput) => void;
  onServiceCall: () => void;
}) {
  const [orders, setOrders] = useState<WaitingOrder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setOrders(null);
    setLoadError(null);
    const res = await listWaitingOrdersAction();
    if (res.success) setOrders(res.data);
    else setLoadError(res.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!orders || !q) return orders ?? [];
    return orders.filter((o) =>
      [o.customerName, o.orderName, o.workOrderNo, o.clientPoNumber ?? '', o.panelsSummary]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [orders, search]);

  const pick = async (orderName: string) => {
    setPickError(null);
    setPicking(orderName);
    const res = await getSalesOrderAction(orderName);
    setPicking(null);
    if (res.success) onPick(res.data);
    else setPickError(`${orderName}: ${res.error}`);
  };

  return (
    <section className="card p-5 space-y-5 bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title-sm font-semibold text-ink">Pick a sales order</h2>
          <p className="text-caption text-muted">
            Work orders start from a confirmed sales order in ERP. Client, WO, panels and dates come from the order.
          </p>
        </div>
        <button type="button" onClick={onServiceCall} className="btn btn-secondary btn-sm text-xs">
          Create a service call instead
        </button>
      </div>

      {loadError ? (
        <div role="alert" className="rounded-md border border-error/30 bg-error/[0.04] p-4 space-y-3">
          <p className="text-body-sm text-error">{loadError}</p>
          <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm text-xs">
            Try again
          </button>
        </div>
      ) : orders === null ? (
        <p className="text-caption text-muted" aria-live="polite">Loading sales orders…</p>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline p-6 text-center space-y-2">
          <p className="text-body-sm text-ink">No confirmed sales orders are waiting for a project.</p>
          <p className="text-caption text-muted">Create and submit the order in ERP first.</p>
          <a href="/erp/open" target="_blank" rel="noopener" className="btn btn-secondary btn-sm text-xs inline-flex">
            Open ERP
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="order-search" className="sr-only">
              Search sales orders
            </label>
            <input
              id="order-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, order, WO or PO"
              className="input text-sm w-full sm:w-80"
            />
            <button type="button" onClick={() => void load()} className="text-xs text-primary font-semibold hover:underline">
              Refresh
            </button>
          </div>

          {pickError ? (
            <div role="alert" className="rounded-md border border-error/30 bg-error/[0.04] p-3 text-caption text-error">
              {pickError}
            </div>
          ) : null}

          {visible.length === 0 ? (
            <p className="text-caption text-muted">No sales orders match “{search.trim()}”.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-hairline bg-surface-strong/30 text-caption font-semibold text-muted">
                  <tr>
                    <th scope="col" className="py-2 px-3">Customer</th>
                    <th scope="col" className="py-2 px-3">Order</th>
                    <th scope="col" className="py-2 px-3">WO</th>
                    <th scope="col" className="py-2 px-3">Panels</th>
                    <th scope="col" className="py-2 px-3">Delivery</th>
                    <th scope="col" className="py-2 px-3"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {visible.map((o) => (
                    <tr key={o.orderName} className="hover:bg-canvas/50">
                      <td className="py-2 px-3 font-medium text-ink">{o.customerName}</td>
                      <td className="py-2 px-3 font-mono text-muted">
                        {o.orderName}
                        {o.clientPoNumber ? <span className="block text-[11px]">PO {o.clientPoNumber}</span> : null}
                      </td>
                      <td className="py-2 px-3 font-mono text-ink">{o.workOrderNo || '—'}</td>
                      <td className="py-2 px-3 font-mono text-muted">{o.panelsSummary || '—'}</td>
                      <td className="py-2 px-3 font-mono text-muted">
                        {o.deliveryDate ? formatDate(o.deliveryDate) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => void pick(o.orderName)}
                          disabled={picking !== null}
                          className="btn btn-primary btn-sm text-xs"
                        >
                          {picking === o.orderName ? 'Opening…' : 'Use this order'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
