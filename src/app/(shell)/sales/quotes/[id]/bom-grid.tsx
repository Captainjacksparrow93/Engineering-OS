'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { removeLineAction, updateLineAction } from '@/app/actions/sales';
import { PRICE_SOURCE_LABELS, formatINR, type PriceSource } from '@/modules/sales/domain/pricing';

export interface GridLine {
  id: string;
  panel: string;
  itemId: string | null;
  itemCode: string | null;
  description: string;
  uom: string;
  qty: number;
  unitCost: number;
  costSource: PriceSource | null;
  costDate: string | null;
  marginPct: number;
  unitPrice: number;
  amount: number;
  latestCost: number | null;
  priceChanged: boolean;
  priceStale: boolean;
}

type Field = 'qty' | 'marginPct' | 'unitPrice' | 'unitCost' | 'description' | 'panel';

/**
 * The BOM. Cost comes from the catalogue; the salesperson edits quantity and either the margin
 * or the selling price (the other follows). Changes save when a cell loses focus.
 */
export function BomGrid({ quoteId, lines, editable, advice }: { quoteId: string; lines: GridLine[]; editable: boolean; advice: Record<string, { direction: 'RAISE' | 'LOWER'; toMarginPct: number; reason: string }> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const panels = [...new Set(lines.map((l) => l.panel))];

  const save = (line: GridLine, field: Field, raw: string) => {
    const current = String(line[field]);
    if (raw.trim() === '' || raw === current) return;
    start(async () => {
      const res = await updateLineAction(quoteId, line.id, field, raw);
      setError(res.error ?? null);
      router.refresh();
    });
  };

  const remove = (lineId: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set('quoteId', quoteId);
      fd.set('lineId', lineId);
      const res = await removeLineAction({}, fd);
      setError(res.error ?? null);
      router.refresh();
    });

  const cell = (line: GridLine, field: Field, props: { width: string; step?: string; align?: 'right' }) => (
    <input
      key={`${line.id}-${field}-${line[field]}`}
      defaultValue={field === 'unitPrice' ? line.unitPrice.toFixed(2) : String(line[field])}
      type={field === 'description' || field === 'panel' ? 'text' : 'number'}
      step={props.step ?? 'any'}
      aria-label={field}
      disabled={!editable || pending}
      onBlur={(e) => save(line, field, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={clsx('input h-8 px-xs py-0 text-body-sm', props.width, props.align === 'right' && 'text-right')}
    />
  );

  if (lines.length === 0) {
    return <p className="p-base text-body-sm text-muted">The BOM is empty. Search the catalogue below, or add a suggested item from the right.</p>;
  }

  return (
    <div className="overflow-x-auto">
      {error ? <p role="alert" className="m-sm rounded-md border border-error/30 bg-error/[0.06] px-base py-xs text-body-sm">{error}</p> : null}
      <table className="table [&_td]:px-xs [&_th]:px-xs">
        <thead>
          <tr>
            <th>Item</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Unit cost</th>
            <th className="text-right">Margin %</th>
            <th className="text-right">Price · amount</th>
            {editable ? <th aria-label="Remove" /> : null}
          </tr>
        </thead>
        <tbody>
          {panels.map((panel) => {
            const rows = lines.filter((l) => l.panel === panel);
            const total = rows.reduce((s, l) => s + l.amount, 0);
            return [
              <tr key={`p-${panel}`} className="bg-canvas-soft">
                <td colSpan={editable ? 6 : 5} className="text-body-sm font-semibold text-ink">
                  {panel} <span className="ml-xs font-normal text-muted">{formatINR(total)}</span>
                </td>
              </tr>,
              ...rows.map((l) => {
                const a = advice[l.id];
                return (
                  <tr key={l.id}>
                    <td className="min-w-48">
                      {editable && !l.itemId ? cell(l, 'description', { width: 'w-full' }) : <p className="text-body-sm text-ink">{l.description}</p>}
                      <p className="text-caption text-muted">
                        {l.itemCode ? <span className="code mr-xs">{l.itemCode}</span> : 'Custom line'}
                        {editable ? (
                          <select
                            aria-label="Panel"
                            className="ml-xs rounded border-0 bg-transparent p-0 text-caption text-muted"
                            defaultValue={l.panel}
                            disabled={pending}
                            onChange={(e) => save(l, 'panel', e.currentTarget.value)}
                          >
                            {panels.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        ) : null}
                      </p>
                      {a ? (
                        <p title={a.reason} className={clsx('text-caption', a.direction === 'RAISE' ? 'text-success' : 'text-error')}>
                          {a.direction === 'RAISE' ? '↑ Raise' : '↓ Lower'} to {a.toMarginPct}%
                        </p>
                      ) : null}
                    </td>
                    <td className="text-right">{cell(l, 'qty', { width: 'w-16', align: 'right' })}</td>
                    <td className="text-right">
                      {editable && !l.itemId ? cell(l, 'unitCost', { width: 'w-28', align: 'right' }) : <span className="text-body-sm">{formatINR(l.unitCost)}</span>}
                      <p className={clsx('whitespace-nowrap text-caption', l.priceStale || l.priceChanged ? 'text-error' : 'text-muted')}>
                        {l.costSource ? PRICE_SOURCE_LABELS[l.costSource] : l.itemId ? 'No catalogue price' : 'Typed cost'}
                        {l.priceStale ? ' · old price' : ''}
                        {l.priceChanged && l.latestCost !== null ? ` · now ${formatINR(l.latestCost)}` : ''}
                      </p>
                    </td>
                    <td className="text-right">{cell(l, 'marginPct', { width: 'w-16', align: 'right' })}</td>
                    <td className="text-right">
                      {cell(l, 'unitPrice', { width: 'w-28', align: 'right' })}
                      <p className="whitespace-nowrap text-caption text-ink">{formatINR(l.amount)}</p>
                    </td>
                    {editable ? (
                      <td>
                        <button type="button" onClick={() => remove(l.id)} disabled={pending} className="btn btn-sm btn-text" aria-label={`Remove ${l.description}`}>
                          ✕
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
