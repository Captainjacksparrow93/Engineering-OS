'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addLineAction, searchItemsAction } from '@/app/actions/sales';
import { formatINR } from '@/modules/sales/domain/pricing';

type Hit = Awaited<ReturnType<typeof searchItemsAction>>[number];

/** Search the catalogue and add an item at its latest price, or type a custom line. */
export function AddItem({ quoteId, panels, defaultMargin }: { quoteId: string; panels: string[]; defaultMargin: number }) {
  const router = useRouter();
  const [panel, setPanel] = useState(panels[0] ?? 'Panel 1');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [qty, setQty] = useState('1');
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      searchItemsAction(q).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const add = (fields: Record<string, string>) =>
    start(async () => {
      const fd = new FormData();
      fd.set('quoteId', quoteId);
      fd.set('panel', panel.trim() || 'Panel 1');
      fd.set('qty', qty || '1');
      fd.set('marginPct', String(defaultMargin));
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const res = await addLineAction({}, fd);
      setError(res.error ?? null);
      if (!res.error) {
        setQ('');
        setHits([]);
        setQty('1');
        router.refresh();
      }
    });

  return (
    <div className="space-y-sm border-t border-hairline p-base">
      <div className="grid items-end gap-sm md:grid-cols-[160px_72px_minmax(0,1fr)_auto]">
        <div>
          <label className="label" htmlFor="add-panel">Panel</label>
          <input id="add-panel" list="panel-names" value={panel} onChange={(e) => setPanel(e.target.value)} className="input w-full" />
          <datalist id="panel-names">{panels.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div>
          <label className="label" htmlFor="add-qty">Qty</label>
          <input id="add-qty" type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="input w-full" />
        </div>
        {custom ? (
          <form
            className="grid items-end gap-sm sm:grid-cols-[minmax(0,1fr)_120px_72px_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              add({ description: String(f.get('description') ?? ''), unitCost: String(f.get('unitCost') ?? ''), uom: String(f.get('uom') ?? 'Nos') });
            }}
          >
            <div>
              <label className="label" htmlFor="add-desc">Description</label>
              <input id="add-desc" name="description" required className="input w-full" placeholder="e.g. Panel fabrication, wiring, testing" />
            </div>
            <div>
              <label className="label" htmlFor="add-cost">Unit cost (₹)</label>
              <input id="add-cost" name="unitCost" type="number" min={0} step="any" required className="input w-full" />
            </div>
            <div>
              <label className="label" htmlFor="add-uom">Unit</label>
              <input id="add-uom" name="uom" defaultValue="Nos" className="input w-full" />
            </div>
            <button type="submit" disabled={pending} className="btn btn-secondary">Add line</button>
          </form>
        ) : (
          <div className="relative">
            <label className="label" htmlFor="add-search">Add from the catalogue</label>
            <input id="add-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item code, name, make or part number" className="input w-full" autoComplete="off" />
            {hits.length ? (
              <ul className="absolute z-20 mt-xxs max-h-80 w-full overflow-y-auto rounded-md border border-hairline bg-surface">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" disabled={pending} onClick={() => add({ itemId: h.id })} className="flex w-full items-center justify-between gap-sm px-sm py-xs text-left hover:bg-canvas-soft">
                      <span className="min-w-0">
                        <span className="code mr-xs">{h.code}</span>
                        <span className="text-body-sm text-ink">{h.name}</span>
                        {h.make ? <span className="text-caption text-muted"> · {h.make}</span> : null}
                      </span>
                      <span className={`shrink-0 text-body-sm ${h.rate === null || h.stale ? 'text-error' : 'text-ink'}`}>
                        {h.rate === null ? 'No price' : `${formatINR(h.rate)}${h.stale ? ' (old)' : ''}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        <button type="button" onClick={() => setCustom((c) => !c)} className="btn btn-text whitespace-nowrap text-body-sm">
          {custom ? 'Search the catalogue' : 'Custom line'}
        </button>
      </div>
      {error ? <p role="alert" className="rounded-md border border-error/30 bg-error/[0.06] px-base py-xs text-body-sm">{error}</p> : null}
    </div>
  );
}
