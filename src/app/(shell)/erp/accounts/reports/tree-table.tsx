import Link from 'next/link';
import type { TreeRow } from '@/modules/erp/services/reports.service';
import { Money } from '../../_components/parts';

/** Accounts in tree order with rolled-up values; leaf accounts open their ledger. */
export function TreeTable({ rows, headers, ledger }: { rows: TreeRow[]; headers: string[]; ledger?: { from: string; to: string } }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Account</th>{headers.map((h) => <th key={h} className="text-right">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.account.id} className={r.account.isGroup ? 'font-medium' : ''}>
            <td style={{ paddingLeft: `${0.75 + r.depth * 1.25}rem` }}>
              {r.account.isGroup || !ledger ? <><span className="code mr-xs">{r.account.code}</span>{r.account.name}</> : <Link href={`/erp/accounts/reports/general-ledger?account=${r.account.id}&from=${ledger.from}&to=${ledger.to}`} className="hover:underline"><span className="code mr-xs">{r.account.code}</span>{r.account.name}</Link>}
            </td>
            {r.values.map((v, i) => <td key={i} className="text-right">{v.isZero() ? '' : <Money value={v} />}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
