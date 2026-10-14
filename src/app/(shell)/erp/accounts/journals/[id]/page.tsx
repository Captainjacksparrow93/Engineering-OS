import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, projectOptions, userNames } from '@/modules/erp/services/access';
import { getJournal, JOURNAL_TYPE_LABEL, postingAccounts } from '@/modules/erp/services/journal.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { invoiceHref } from '@/modules/erp/services/outstanding';
import { addJournalLineAction, cancelJournalAction, deleteJournalAction, removeJournalLineAction, submitJournalAction, updateJournalAction } from '@/app/actions/erp-accounts';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { GlTable } from '../../../_components/gl-table';
import { DocStatus, DocTrail, Field, isoDay, Money, orNotFound, ProjectSelect, showDate } from '../../../_components/parts';
import { PartySelect } from '../../payments/party-select';

export const dynamic = 'force-dynamic';

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'accounts')) notFound();
  const { id } = await params;
  const { je, accounts, parties, invoices, gl } = await orNotFound(getJournal(p, id));
  const manage = canManage(p, 'accounts');
  const draft = je.status === 'DRAFT';
  const [names, all, customers, suppliers, projects] = await Promise.all([
    userNames([je.createdById, je.submittedById, je.cancelledById]),
    draft && manage ? postingAccounts(p.companyId) : [],
    draft && manage ? partyOptions(p.companyId, 'CUSTOMER') : [],
    draft && manage ? partyOptions(p.companyId, 'SUPPLIER') : [],
    draft && manage ? projectOptions(p.companyId) : [],
  ]);
  const diff = je.totalDebit.minus(je.totalCredit);
  return (
    <div className="space-y-lg">
      <PageHeader
        title={je.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={je.status} /> {JOURNAL_TYPE_LABEL[je.entryType]} · {showDate(je.postingDate)}{je.referenceNo ? ` · ref ${je.referenceNo}` : ''}{je.remarks ? ` · ${je.remarks}` : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Journal entries', href: '/erp/accounts/journals' }, { label: je.number }]}
        actions={manage ? (
          draft ? (
            <>
              <DocButton action={submitJournalAction} fields={{ id }} label="Submit" variant="primary" confirm="Submit this journal entry? It posts to the books." />
              <DocButton action={deleteJournalAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
            </>
          ) : je.status === 'SUBMITTED' ? <DocButton action={cancelJournalAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this journal entry? Its postings are reversed." /> : null
        ) : null}
      />
      <Card title="Lines">
        {je.lines.length === 0 ? <EmptyState title="No lines yet" /> : (
          <table className="table">
            <thead><tr><th>Account</th><th>Party</th><th>Settles</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Remarks</th>{draft && manage ? <th /> : null}</tr></thead>
            <tbody>{je.lines.map((l) => {
              const a = accounts.get(l.accountId);
              return (
                <tr key={l.id}>
                  <td><span className="code mr-xs">{a?.code}</span>{a?.name}</td>
                  <td>{l.partyId ? parties.get(l.partyId) : ''}</td>
                  <td>{l.againstType && l.againstId && l.againstType !== 'Journal Entry' ? <Link href={invoiceHref(l.againstType, l.againstId)} className="code hover:underline">{invoices.get(l.againstId)}</Link> : ''}</td>
                  <td className="text-right">{l.debit.isZero() ? '' : <Money value={l.debit} />}</td>
                  <td className="text-right">{l.credit.isZero() ? '' : <Money value={l.credit} />}</td>
                  <td className="text-caption text-muted">{l.remarks ?? ''}</td>
                  {draft && manage ? <td className="text-right"><DocButton action={removeJournalLineAction} fields={{ id, lineId: l.id }} label="Remove" /></td> : null}
                </tr>
              );
            })}</tbody>
            <tfoot><tr><td colSpan={3} className="font-medium">Total{!diff.isZero() ? <span className="ml-xs text-error">Out by ₹ {diff.abs().toFixed(2)}</span> : null}</td><td className="text-right font-medium"><Money value={je.totalDebit} /></td><td className="text-right font-medium"><Money value={je.totalCredit} /></td><td colSpan={draft && manage ? 2 : 1} /></tr></tfoot>
          </table>
        )}
        {draft && manage ? (
          <ActionForm action={addJournalLineAction} resetOnSuccess className="mt-base space-y-sm border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-sm sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="accountId">Account</label>
                <select id="accountId" name="accountId" className="select w-full" required defaultValue=""><option value="" disabled>Pick one</option>{all.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
              </div>
              <Field label="Debit (₹)" name="debit" type="number" step="0.01" />
              <Field label="Credit (₹)" name="credit" type="number" step="0.01" />
              <PartySelect customers={customers} suppliers={suppliers} label="Party (Debtors/Creditors only)" optional />
              <Field label="Settles invoice no." name="againstInvoiceNo" placeholder="ACC-SINV-2026-00001" />
              <ProjectSelect projects={projects} />
              <Field label="Remarks" name="remarks" />
            </div>
            <SubmitButton size="sm">Add line</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>
      {draft && manage ? (
        <Card title="Entry details">
          <ActionForm action={updateJournalAction} className="flex flex-wrap items-end gap-sm">
            <input type="hidden" name="id" value={id} />
            <div>
              <label className="label" htmlFor="entryType">Type</label>
              <select id="entryType" name="entryType" className="select" defaultValue={je.entryType}>{Object.entries(JOURNAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <Field label="Posting date" name="postingDate" type="date" defaultValue={isoDay(je.postingDate)} required />
            <Field label="Reference no." name="referenceNo" defaultValue={je.referenceNo} />
            <Field label="Reference date" name="referenceDate" type="date" defaultValue={isoDay(je.referenceDate)} />
            <Field label="Remarks" name="remarks" defaultValue={je.remarks} />
            <SubmitButton size="sm">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <GlTable rows={gl} />
      <DocTrail created={{ by: names.get(je.createdById), at: je.createdAt }} submitted={{ by: names.get(je.submittedById ?? ''), at: je.submittedAt }} cancelled={{ by: names.get(je.cancelledById ?? ''), at: je.cancelledAt }} />
    </div>
  );
}
