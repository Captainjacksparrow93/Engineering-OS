import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { getInspection, INSPECTION_LABEL } from '@/modules/erp/services/quality.service';
import { addReadingAction, cancelInspectionAction, deleteInspectionAction, recordReadingsAction, submitInspectionAction } from '@/app/actions/erp-quality';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, orNotFound, showDate } from '../../../_components/parts';

export const dynamic = 'force-dynamic';

const REF_LINK: Record<string, string> = { 'Purchase Receipt': '/erp/buying/receipts/', 'Delivery Note': '/erp/selling/deliveries/', 'Work Order': '/erp/manufacturing/work-orders/' };

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'quality')) notFound();
  const { id } = await params;
  const { qi, item, nc, acceptance } = await orNotFound(getInspection(p, id));
  const draft = qi.status === 'DRAFT';
  const manage = canManage(p, 'quality');
  return (
    <div className="space-y-lg">
      <PageHeader
        title={qi.number}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs">{qi.status === 'SUBMITTED' && qi.result ? <DocStatus status={qi.result} label={qi.result === 'ACCEPTED' ? 'Accepted' : 'Rejected'} /> : <DocStatus status={qi.status} />} {INSPECTION_LABEL[qi.type]} · {item.code} {item.name} · {showDate(qi.inspectionDate)} · sample {qi.sampleSize.toString()}{qi.referenceType && qi.referenceId ? <> · <Link href={`${REF_LINK[qi.referenceType]}${qi.referenceId}`} className="hover:underline">{qi.referenceType}</Link></> : null}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Inspections', href: '/erp/quality/inspections' }, { label: qi.number }]}
        actions={
          manage ? (
            draft ? (
              <>
                <DocButton action={submitInspectionAction} fields={{ id }} label="Submit result" variant="primary" confirm="Submit? The result follows from the readings." />
                <DocButton action={deleteInspectionAction} fields={{ id }} label="Delete draft" confirm="Delete this draft?" />
              </>
            ) : qi.status === 'SUBMITTED' ? <DocButton action={cancelInspectionAction} fields={{ id }} label="Cancel" variant="danger" /> : null
          ) : null
        }
      />
      {nc ? <Alert tone="warning">Rejected: <Link href={`/erp/quality/non-conformances/${nc.id}`} className="font-medium underline">{nc.number}</Link> was raised.</Alert> : null}
      <Card title="Readings">
        {qi.readings.length === 0 ? <EmptyState title="No checks yet" hint="Give the item an inspection template, or add checks below." /> : draft && manage ? (
          <ActionForm action={recordReadingsAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <table className="table">
              <thead><tr><th>Check</th><th>Passes when</th><th>Recorded</th><th>Result</th></tr></thead>
              <tbody>
                {qi.readings.map((r) => (
                  <tr key={r.id}>
                    <td>{r.parameter}</td>
                    <td className="text-caption text-muted">{acceptance.get(r.id)}</td>
                    <td>{r.kind === 'CHECK' ? (
                      <select name={`r_${r.id}`} defaultValue={r.value ?? ''} className="select" aria-label={r.parameter}><option value="">—</option><option value="pass">Pass</option><option value="fail">Fail</option></select>
                    ) : <input name={`r_${r.id}`} defaultValue={r.value ?? ''} className="input w-40" aria-label={r.parameter} />}</td>
                    <td>{r.ok === null ? <span className="text-caption text-muted">—</span> : r.ok ? <span className="badge badge-success">Pass</span> : <span className="badge badge-error">Fail</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <SubmitButton pendingLabel="Saving…">Save readings</SubmitButton>
          </ActionForm>
        ) : (
          <table className="table">
            <thead><tr><th>Check</th><th>Passes when</th><th>Recorded</th><th>Result</th></tr></thead>
            <tbody>{qi.readings.map((r) => <tr key={r.id}><td>{r.parameter}</td><td className="text-caption text-muted">{acceptance.get(r.id)}</td><td>{r.kind === 'CHECK' && r.value ? (r.value === 'pass' ? 'Pass' : 'Fail') : r.value ?? '—'}</td><td>{r.ok === null ? '—' : r.ok ? <span className="badge badge-success">Pass</span> : <span className="badge badge-error">Fail</span>}</td></tr>)}</tbody>
          </table>
        )}
        {draft && manage ? (
          <ActionForm action={addReadingAction} resetOnSuccess className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
            <input type="hidden" name="id" value={id} />
            <Field label="Extra check" name="parameter" required />
            <div>
              <label className="label" htmlFor="value">Result</label>
              <select id="value" name="value" className="select"><option value="pass">Pass</option><option value="fail">Fail</option></select>
            </div>
            <SubmitButton size="sm">Add check</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>
    </div>
  );
}
