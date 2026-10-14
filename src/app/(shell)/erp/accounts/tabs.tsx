import { AreaTabs } from '../_components/parts';

export function AccountsTabs({ current }: { current: string }) {
  return (
    <AreaTabs
      current={current}
      tabs={[
        { href: '/erp/accounts', label: 'Overview' },
        { href: '/erp/accounts/payments', label: 'Payments' },
        { href: '/erp/accounts/journals', label: 'Journal entries' },
        { href: '/erp/accounts/bank', label: 'Bank reconciliation' },
        { href: '/erp/accounts/reports', label: 'Reports' },
        { href: '/erp/accounts/chart', label: 'Chart of accounts' },
        { href: '/erp/accounts/closing', label: 'Closing' },
      ]}
    />
  );
}

/** Report filter: a date range plus any extra fields, submitted as a GET form. */
export function RangeForm({ from, to, children }: { from: string; to: string; children?: React.ReactNode }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-sm">
      <div><label className="label" htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
      <div><label className="label" htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
      {children}
      <button type="submit" className="btn btn-secondary">Show</button>
    </form>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Reads ?from&to, defaulting to the current fiscal year (April to March) up to today. */
export function rangeOf(sp: { from?: string; to?: string }) {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const y = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const from = sp.from && ISO.test(sp.from) ? sp.from : `${y}-04-01`;
  const to = sp.to && ISO.test(sp.to) ? sp.to : now.toISOString().slice(0, 10);
  return { from, to, fromDate: new Date(`${from}T00:00:00.000Z`), toDate: new Date(`${to}T00:00:00.000Z`) };
}
