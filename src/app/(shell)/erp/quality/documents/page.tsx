import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, projectOptions } from '@/modules/erp/services/access';
import { CUSTOMER_APPROVAL_LABEL, DOC_CATEGORY_LABEL, listDocuments } from '@/modules/erp/services/quality-doc.service';
import { createDocumentAction } from '@/app/actions/erp-quality';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Field, ProjectSelect } from '../../_components/parts';
import { QualityTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Controlled documents' };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'quality')) notFound();
  const sp = await searchParams;
  const [rows, projects] = await Promise.all([listDocuments(p, sp), projectOptions(p.companyId)]);
  return (
    <div className="space-y-lg">
      <PageHeader title="Controlled documents" subtitle="Drawings, procedures and test reports. Every revision is approved by someone other than its author; the newest release supersedes the one before." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Quality', href: '/erp/quality' }, { label: 'Documents' }]} />
      <QualityTabs current="/erp/quality/documents" />
      {canManage(p, 'quality') ? (
        <Card title="New document">
          <ActionForm action={createDocumentAction} className="space-y-base">
            <div className="grid gap-sm sm:grid-cols-4">
              <Field label="Code" name="code" required placeholder="DWG-GA-0042" />
              <Field label="Title" name="title" required className="sm:col-span-2" />
              <div>
                <label className="label" htmlFor="category">Type</label>
                <select id="category" name="category" className="select w-full">{Object.entries(DOC_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <ProjectSelect projects={projects} />
              <Field label="Item (optional)" name="itemCode" />
              <label className="flex items-center gap-xs self-end pb-xs text-body-sm sm:col-span-2"><input type="checkbox" name="needsCustomerApproval" /> Each revision needs the customer's approval</label>
            </div>
            <SubmitButton variant="primary" pendingLabel="Creating…">Create</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <form method="get" className="flex flex-wrap gap-sm">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Code or title" className="input w-64" aria-label="Search" />
        <select name="category" defaultValue={sp.category ?? ''} className="select" aria-label="Type"><option value="">All types</option>{Object.entries(DOC_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No documents" /> : (
        <table className="table">
          <thead><tr><th>Code</th><th>Title</th><th>Type</th><th>Released rev.</th><th>Customer</th><th>Waiting</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={d.isActive ? '' : 'text-muted'}>
                <td><Link href={`/erp/quality/documents/${d.id}`} className="code hover:underline">{d.code}</Link></td>
                <td>{d.title}</td>
                <td>{DOC_CATEGORY_LABEL[d.category]}</td>
                <td>{d.released ? `Rev ${d.released.revision}` : '—'}</td>
                <td className="text-caption">{d.released && d.released.customerApproval !== 'NOT_NEEDED' ? CUSTOMER_APPROVAL_LABEL[d.released.customerApproval] : '—'}</td>
                <td>{d.latest?.status === 'PENDING_APPROVAL' ? <span className="badge badge-outline">Rev {d.latest.revision} for approval</span> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
