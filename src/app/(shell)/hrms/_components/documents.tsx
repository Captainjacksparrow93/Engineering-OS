import { formatDate } from '@/core/utils/dates';
import { DOCUMENT_CATEGORY_LABEL, formatBytes } from '@/modules/hrms/domain/labels';
import { DOCUMENT_CATEGORIES } from '@/modules/hrms/validation';
import { removeDocumentAction, uploadDocumentAction } from '@/app/actions/hrms';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { EmptyState } from '@/components/ui';
import { RowButton } from './row-button';

export interface DocumentRow {
  id: string;
  category: keyof typeof DOCUMENT_CATEGORY_LABEL;
  title: string;
  fileName: string;
  sizeBytes: number;
  version: number;
  supersededAt: Date | null;
  visibleToEmployee: boolean;
  createdAt: Date;
  uploadedBy: { fullName: string };
}

/**
 * Current documents in a table; older versions folded under each one. `manage` adds the
 * remove button and the HR-only marker.
 */
export function DocumentTable({ documents, manage, showCategory = true, emptyHint }: { documents: DocumentRow[]; manage: boolean; showCategory?: boolean; emptyHint?: string }) {
  const current = documents.filter((d) => !d.supersededAt);
  if (current.length === 0) return <EmptyState title="No documents yet" hint={emptyHint} />;
  const olderOf = (doc: DocumentRow) => documents.filter((d) => d.supersededAt && d.category === doc.category && d.title.toLowerCase() === doc.title.toLowerCase());
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Document</th>
            {showCategory ? <th>Type</th> : null}
            <th>Version</th>
            <th>Added</th>
            {manage ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {current.map((doc) => {
            const older = olderOf(doc);
            return (
              <tr key={doc.id}>
                <td>
                  <a className="link font-medium" href={`/api/hrms/documents/${doc.id}`} target="_blank" rel="noopener">{doc.title}</a>
                  <span className="ml-xs text-caption text-muted">{doc.fileName} · {formatBytes(doc.sizeBytes)}</span>
                  {manage && !doc.visibleToEmployee ? <span className="badge badge-outline ml-xs">HR only</span> : null}
                  {older.length > 0 ? (
                    <details className="mt-xxs">
                      <summary className="cursor-pointer text-caption text-muted">Older versions ({older.length})</summary>
                      <ul className="mt-xxs space-y-xxs">
                        {older.map((o) => (
                          <li key={o.id} className="flex flex-wrap items-center gap-xs text-caption">
                            <a className="link" href={`/api/hrms/documents/${o.id}`} target="_blank" rel="noopener">Version {o.version}</a>
                            <span className="text-muted">{formatDate(o.createdAt, { forceYear: true })} by {o.uploadedBy.fullName}</span>
                            {manage ? <RowButton action={removeDocumentAction} name="documentId" value={o.id} label="Remove" confirm={`Remove version ${o.version} of ${o.title}?`} /> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </td>
                {showCategory ? <td>{DOCUMENT_CATEGORY_LABEL[doc.category]}</td> : null}
                <td>{doc.version}</td>
                <td className="whitespace-nowrap">{formatDate(doc.createdAt, { forceYear: true })}<span className="block text-caption text-muted">{doc.uploadedBy.fullName}</span></td>
                {manage ? (
                  <td className="text-right">
                    <RowButton action={removeDocumentAction} name="documentId" value={doc.id} label="Remove" confirm={older.length ? `Remove version ${doc.version}? Version ${older[0]!.version} becomes current again.` : `Remove ${doc.title}?`} />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** HR upload form. Without `userId` it publishes a company policy. */
export function UploadForm({ userId }: { userId?: string }) {
  const prefix = userId ? 'doc' : 'policy';
  return (
    <ActionForm action={uploadDocumentAction} resetOnSuccess className="space-y-base">
      {userId ? <input type="hidden" name="userId" value={userId} /> : <input type="hidden" name="category" value="POLICY" />}
      <div className="grid gap-base sm:grid-cols-2">
        {userId ? (
          <div>
            <label className="label" htmlFor={`${prefix}-category`}>Type</label>
            <select id={`${prefix}-category`} name="category" required defaultValue="" className="select w-full">
              <option value="" disabled>Pick a type</option>
              {DOCUMENT_CATEGORIES.filter((c) => c !== 'POLICY').map((c) => (
                <option key={c} value={c}>{DOCUMENT_CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={userId ? undefined : 'sm:col-span-2'}>
          <label className="label" htmlFor={`${prefix}-title`}>Title</label>
          <input id={`${prefix}-title`} name="title" required minLength={2} maxLength={120} className="input w-full" placeholder={userId ? 'e.g. Offer letter' : 'e.g. Leave policy'} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${prefix}-file`}>File</label>
        <input id={`${prefix}-file`} name="file" type="file" required accept="application/pdf,image/jpeg,image/png" className="input w-full" />
        <p className="hint">PDF, JPG or PNG, up to 3 MB. Use the same type and title to upload a new version; the old one is kept.</p>
      </div>
      {userId ? (
        <label className="flex items-center gap-xs text-body-sm">
          <input type="checkbox" name="hrOnly" /> HR only (the employee cannot see it)
        </label>
      ) : null}
      <SubmitButton pendingLabel="Uploading…">{userId ? 'Upload document' : 'Publish policy'}</SubmitButton>
    </ActionForm>
  );
}
