import type { Prisma } from '@prisma/client';
import { Card } from '@/components/ui';
import { Money } from './parts';

/** The ledger rows a document posted (ERPNext "View → Accounting Ledger"). */
export function GlTable({ rows }: { rows: Array<{ id: string; debit: Prisma.Decimal; credit: Prisma.Decimal; remarks: string | null; isCancelled: boolean; account: { code: string; name: string } }> }) {
  if (rows.length === 0) return null;
  return (
    <Card title="Accounting entries">
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Remarks</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className={g.isCancelled ? 'text-muted line-through' : ''}>
                <td><span className="code mr-xs">{g.account.code}</span>{g.account.name}</td>
                <td className="text-right">{g.debit.isZero() ? '' : <Money value={g.debit} />}</td>
                <td className="text-right">{g.credit.isZero() ? '' : <Money value={g.credit} />}</td>
                <td className="text-caption text-muted">{g.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
