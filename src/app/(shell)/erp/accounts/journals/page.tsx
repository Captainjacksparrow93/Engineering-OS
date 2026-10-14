import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { JOURNAL_TYPE_LABEL, listJournals } from '@/modules/erp/services/journal.service';
import { createJournalAction } from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { AccountsTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Journal entries' };

export default async function JournalsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const sp = await searchParams;
  const rows = await listJournals(p, { status: sp.status, entryType: sp.type });
  return (
    <div className="space-y-lg">
      <PageHeader title="Journal entries" subtitle="Accruals, bank charges, TDS, write-offs and opening balances." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Accounts', href: '/erp/accounts' }, { label: 'Journal entries' }]} />
      <AccountsTabs current="/erp/accounts/journals" />
      <form method="get" className="flex flex-wrap gap-sm">
        <select name="type" defaultValue={sp.type ?? ''} className="select" aria-label="Type"><option value="">All types</option>{Object.entries(JOURNAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status"><option value="">All</option><option value="DRAFT">Draft</option><option value="SUBMITTED">Submitted</option><option value="CANCELLED">Cancelled</option></select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="No journal entries here" /> : (
          <table className="table">
            <thead><tr><th>Entry</th><th>Date</th><th>Type</th><th>Remarks</th><th className="text-right">Total</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/erp/accounts/journals/${r.id}`} className="code hover:underline">{r.number}</Link></td>
                <td>{showDate(r.postingDate)}</td>
                <td>{JOURNAL_TYPE_LABEL[r.entryType]}</td>
                <td>{r.remarks ?? ''}</td>
                <td className="text-right"><Money value={r.totalDebit} /></td>
                <td><DocStatus status={r.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {canManage(p, 'accounts') ? (
        <Card title="New journal entry">
          <ActionForm action={createJournalAction} className="flex flex-wrap items-end gap-sm">
            <div>
              <label className="label" htmlFor="entryType">Type</label>
              <select id="entryType" name="entryType" className="select" defaultValue="JOURNAL">{Object.entries(JOURNAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <Field label="Posting date" name="postingDate" type="date" defaultValue={todayIso()} required />
            <Field label="Reference no." name="referenceNo" />
            <Field label="Remarks" name="remarks" className="min-w-[16rem]" />
            <SubmitButton variant="primary">Create draft</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
