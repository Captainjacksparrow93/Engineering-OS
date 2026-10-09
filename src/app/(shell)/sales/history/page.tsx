import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listHistoryImports } from '@/modules/sales/services/history.service';
import { deleteHistoryImportAction, importHistoryAction } from '@/app/actions/sales';
import { Card, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '../_components/action-form';
import { shortDate } from '../_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Past quotes' };

const SAMPLE = `ref,date,client,outcome,item_code,description,qty,unit_cost,unit_price
Q-2024-0112,15-03-2024,Acme Pharma,won,6ES7214-1AG40,CPU 1214C,1,28500,35600
Q-2024-0112,15-03-2024,Acme Pharma,won,6EP1333-2BA20,PSU 24V 5A,1,7200,9000
Q-2024-0140,02-05-2024,Beta Foods,lost,,MCC panel (lump sum),1,,485000`;

export default async function HistoryPage() {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.catalog.manage')) notFound();
  const { imports, totals } = await listHistoryImports(principal);
  const count = (source: string, outcome: string) => totals.find((t) => t.source === source && t.outcome === outcome)?.lines ?? 0;

  return (
    <div className="space-y-lg">
      <PageHeader title="Past quotes and orders" subtitle="The pricing advice learns from these, plus every deal closed in the app." />
      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Import from Excel or Tally (CSV)">
          <ActionForm action={importHistoryAction} className="space-y-sm">
            <p className="text-caption text-muted">
              One row per quote line. Required: <span className="code">ref</span>, <span className="code">date</span>, <span className="code">client</span>, <span className="code">outcome</span> (won / lost / open), and{' '}
              <span className="code">unit_price</span> or <span className="code">amount</span>. Optional: <span className="code">item_code</span>, <span className="code">description</span>, <span className="code">qty</span>,{' '}
              <span className="code">unit_cost</span>. With unit cost the advice learns margins; with item codes it learns which items go together. A quote without lines is one row with its total as amount. Clients are matched by name and created when new.
            </p>
            <pre className="code-block overflow-x-auto text-caption">{SAMPLE}</pre>
            <input type="file" name="file" accept=".csv,text/csv" required className="text-body-sm" aria-label="CSV file" />
            <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="What the advice knows">
          <dl className="grid grid-cols-3 gap-y-xxs text-body-sm">
            <dt />
            <dt className="text-right text-muted">Won</dt>
            <dt className="text-right text-muted">Lost</dt>
            <dt className="text-muted">Imported lines</dt><dd className="text-right">{count('IMPORT', 'WON')}</dd><dd className="text-right">{count('IMPORT', 'LOST')}</dd>
            <dt className="text-muted">Closed in the app</dt><dd className="text-right">{count('DEAL', 'WON')}</dd><dd className="text-right">{count('DEAL', 'LOST')}</dd>
          </dl>
          <h3 className="mt-lg text-title-sm text-ink">Imports</h3>
          {imports.length === 0 ? (
            <p className="text-body-sm text-muted">Nothing imported yet.</p>
          ) : (
            <ul className="mt-xs space-y-xs">
              {imports.map((b) => (
                <li key={b.batchId} className="flex items-center justify-between gap-sm text-body-sm">
                  <span>{b.lines} lines · {shortDate(b.from)} to {shortDate(b.to)} · imported {shortDate(b.importedAt)}</span>
                  <ActionForm action={deleteHistoryImportAction} quiet>
                    <input type="hidden" name="batchId" value={b.batchId} />
                    <SubmitButton size="sm" variant="danger" confirm="Delete every line of this import?">Delete</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
