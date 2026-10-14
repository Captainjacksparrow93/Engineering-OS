import Link from 'next/link';
import { requirePrincipal } from '@/core/auth/session';
import { canManage } from '@/modules/erp/services/access';
import { CUSTOMER_APPROVAL_LABEL, DOC_CATEGORY_LABEL, getDocument } from '@/modules/erp/services/quality-doc.service';
import { customerApprovalAction, decideRevisionAction, documentActiveAction, uploadRevisionAction } from '@/app/actions/erp-quality';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, orNotFound, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

const REV_LABEL = { DRAFT: 'Draft', PENDING_APPROVAL: 'For approval', RELEASED: 'Released', REJECTED: 'Rejected', SUPERSEDED: 'Superseded' } as const;

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  const { id } = await params;
  const { doc, project, item, people } = await orNotFound(getDocument(p, id));
  const manage = canManage(p, 'quality');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={`${doc.code} · ${doc.title}`}
        subtitle={<span>{DOC_CATEGORY_LABEL[doc.category]}{project ? <> · <Link href={`/pm/projects/${project.id}`} className="hover:underline">{project.code} {project.name}</Link></> : null}{item ? ` · ${item.code}` : ''}{doc.needsCustomerApproval ? ' · customer approves each revision' : ''}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Documents', href: '/erp/quality/documents' }, { label: doc.code }]}
        actions={manage ? <DocButton action={documentActiveAction} fields={{ id, active: String(!doc.isActive) }} label={doc.isActive ? 'Retire' : 'Bring back'} /> : null}
      />
      <Card title="Revisions">
        {doc.revisions.length === 0 ? <EmptyState title="No revisions yet" hint={manage ? 'Upload the first issue below.' : undefined} /> : (
          <table className="table">
            <thead><tr><th>Rev</th><th>Change</th><th>File</th><th>Status</th><th>Author</th><th>Approval</th>{doc.needsCustomerApproval ? <th>Customer</th> : null}</tr></thead>
            <tbody>
              {doc.revisions.map((r) => (
                <tr key={r.id} className={r.status === 'SUPERSEDED' ? 'text-muted' : ''}>
                  <td className="font-medium">{r.revision}</td>
                  <td>{r.changeNote}</td>
                  <td><a href={`/api/erp/quality-docs/${r.id}`} target="_blank" rel="noopener" className="hover:underline">{r.fileName}</a></td>
                  <td><DocStatus status={r.status === 'RELEASED' ? 'COMPLETED' : r.status === 'REJECTED' ? 'REJECTED' : r.status} label={REV_LABEL[r.status]} /></td>
                  <td>{people.get(r.authorId)}<span className="block text-caption text-muted">{showDate(r.createdAt)}</span></td>
                  <td>
                    {r.status === 'PENDING_APPROVAL' && manage && r.authorId !== p.userId ? (
                      <ActionForm action={decideRevisionAction} quiet className="flex flex-wrap gap-xxs">
                        <input type="hidden" name="revisionId" value={r.id} />
                        <input name="note" placeholder="Note (needed to reject)" className="input w-44" aria-label="Note" />
                        <button name="approve" value="true" className="btn btn-primary btn-sm">Release</button>
                        <button name="approve" value="false" className="btn btn-danger btn-sm">Reject</button>
                      </ActionForm>
                    ) : r.approverId ? <span className="text-caption">{people.get(r.approverId)}, {showDate(r.approvedAt)}{r.approvalNote ? `: ${r.approvalNote}` : ''}</span> : r.status === 'PENDING_APPROVAL' ? <span className="text-caption text-muted">Waiting for another approver</span> : '—'}
                  </td>
                  {doc.needsCustomerApproval ? (
                    <td>
                      {r.status === 'RELEASED' && r.customerApproval === 'PENDING' && manage ? (
                        <ActionForm action={customerApprovalAction} quiet className="flex flex-wrap gap-xxs">
                          <input type="hidden" name="revisionId" value={r.id} />
                          <select name="decision" className="select" aria-label="Decision"><option value="APPROVED">Approved</option><option value="APPROVED_WITH_COMMENTS">With comments</option><option value="REJECTED">Rejected</option></select>
                          <input name="customerRef" placeholder="Their ref." className="input w-28" aria-label="Customer reference" />
                          <input name="customerNote" placeholder="Comments" className="input w-36" aria-label="Customer comments" />
                          <SubmitButton size="sm">Record</SubmitButton>
                        </ActionForm>
                      ) : <span className="text-caption">{CUSTOMER_APPROVAL_LABEL[r.customerApproval]}{r.customerRef ? ` · ${r.customerRef}` : ''}{r.customerNote ? ` · ${r.customerNote}` : ''}</span>}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {manage ? (
          <ActionForm action={uploadRevisionAction} resetOnSuccess className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <Field label="What changed" name="changeNote" required className="min-w-[18rem] flex-1" />
            <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required className="text-body-sm" aria-label="File" />
            <SubmitButton pendingLabel="Uploading…">Upload revision</SubmitButton>
          </ActionForm>
        ) : null}
        <p className="mt-sm text-caption text-muted">PDF, JPG or PNG, up to 3 MB.</p>
      </Card>
    </div>
  );
}
