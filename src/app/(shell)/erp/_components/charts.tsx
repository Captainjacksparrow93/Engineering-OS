import type { Prisma } from '@prisma/client';
import { formatMoney } from '@/modules/erp/domain/money';

const num = (v: Prisma.Decimal.Value) => Number(v.toString());
const short = (v: Prisma.Decimal.Value) => {
  const n = num(v);
  const a = Math.abs(n);
  return a >= 1e7 ? `${(n / 1e7).toFixed(1)} Cr` : a >= 1e5 ? `${(n / 1e5).toFixed(1)} L` : a >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : n.toFixed(0);
};

/** Monthly bars (no chart library): height by value, the amount on hover and below. */
export function MonthBars({ points, label }: { points: Array<{ month: string; label: string; value: Prisma.Decimal }>; label: string }) {
  const max = Math.max(1, ...points.map((x) => num(x.value)));
  return (
    <figure>
      <div className="flex h-40 items-end gap-xs" role="img" aria-label={`${label} by month`}>
        {points.map((x) => (
          <div key={x.month} className="flex h-full flex-1 flex-col justify-end" title={`${x.label}: ${formatMoney(x.value)}`}>
            <div className="rounded-t-sm bg-ink/80" style={{ height: `${Math.max(0, (num(x.value) / max) * 100)}%`, minHeight: num(x.value) > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-xxs flex gap-xs">
        {points.map((x) => (
          <div key={x.month} className="flex-1 text-center text-[11px] leading-tight text-muted">{x.label}<br />{num(x.value) ? short(x.value) : ''}</div>
        ))}
      </div>
    </figure>
  );
}

/** Horizontal ranked bars: name, bar, amount. */
export function BarList({ rows, empty }: { rows: Array<{ id: string; name: string; value: Prisma.Decimal }>; empty: string }) {
  if (rows.length === 0) return <p className="text-body-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => num(r.value)));
  return (
    <ul className="space-y-xs">
      {rows.map((r) => (
        <li key={r.id} className="text-body-sm">
          <div className="flex justify-between gap-sm"><span className="truncate">{r.name}</span><span className="whitespace-nowrap">{formatMoney(r.value)}</span></div>
          <div className="mt-xxs h-1.5 rounded-full bg-hairline"><div className="h-1.5 rounded-full bg-ink/70" style={{ width: `${Math.max(0, (num(r.value) / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
