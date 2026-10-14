import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { listTemplates } from '@/modules/erp/services/quality.service';
import { acceptanceText } from '@/modules/erp/domain/quality';
import { addTemplateParameterAction, createTemplateAction, removeTemplateParameterAction } from '@/app/actions/erp-quality';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../_components/doc-button';
import { Field } from '../../_components/parts';
import { QualityTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inspection templates' };

const KIND = { NUMERIC: 'Measured value', TEXT: 'Text', CHECK: 'Pass / fail' } as const;

export default async function TemplatesPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'quality')) notFound();
  const templates = await listTemplates(p);
  const manage = canManage(p, 'quality');
  return (
    <div className="space-y-lg">
      <PageHeader title="Inspection templates" subtitle="What to check on an item. Set an item's template (and whether inspection is needed before receipt or delivery) on the item." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Quality', href: '/erp/quality' }, { label: 'Templates' }]} />
      <QualityTabs current="/erp/quality/templates" />
      {templates.length === 0 ? <EmptyState title="No templates yet" /> : templates.map((t) => (
        <Card key={t.id} title={t.name}>
          {t.parameters.length === 0 ? <p className="text-body-sm text-muted">No checks yet.</p> : (
            <table className="table">
              <thead><tr><th>Check</th><th>Kind</th><th>Passes when</th>{manage ? <th /> : null}</tr></thead>
              <tbody>{t.parameters.map((x) => <tr key={x.id}><td>{x.name}</td><td>{KIND[x.kind]}</td><td>{acceptanceText(x)}</td>{manage ? <td className="text-right"><DocButton action={removeTemplateParameterAction} fields={{ id: t.id, parameterId: x.id }} label="Remove" /></td> : null}</tr>)}</tbody>
            </table>
          )}
          {manage ? (
            <ActionForm action={addTemplateParameterAction} resetOnSuccess className="mt-base grid items-end gap-sm border-t border-hairline pt-base sm:grid-cols-6">
              <input type="hidden" name="id" value={t.id} />
              <Field label="Check" name="name" required className="sm:col-span-2" />
              <div>
                <label className="label" htmlFor={`kind-${t.id}`}>Kind</label>
                <select id={`kind-${t.id}`} name="kind" className="select w-full">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </div>
              <Field label="Min" name="minValue" type="number" />
              <Field label="Max" name="maxValue" type="number" />
              <Field label="Text that passes" name="acceptanceValue" />
              <div className="sm:col-span-6"><SubmitButton size="sm">Add check</SubmitButton></div>
            </ActionForm>
          ) : null}
        </Card>
      ))}
      {manage ? (
        <Card title="New template">
          <ActionForm action={createTemplateAction} resetOnSuccess className="flex items-end gap-sm">
            <Field label="Name" name="name" required placeholder="Incoming MCB, Panel FAT…" />
            <SubmitButton>Add template</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
