import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { canManageSettings, chartOfAccounts, readSettings } from '@/modules/erp/services/settings.service';
import { INDIAN_STATES } from '@/modules/erp/domain/gst';
import { updateErpSettingsAction } from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, PageHeader } from '@/components/ui';
import { Field } from '../_components/parts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ERP settings' };

const ROOT_LABEL = { ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expense' } as const;

export default async function ErpSettingsPage() {
  const p = await requirePrincipal();
  if (!hasPermissionAnywhere(p, 'erp.access')) notFound();
  const [settings, chart] = await Promise.all([readSettings(p), chartOfAccounts(p.companyId)]);
  const manage = canManageSettings(p);
  return (
    <div className="space-y-lg">
      <PageHeader title="ERP settings" subtitle="Company-wide defaults for stock, GST and the books." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Settings' }]} />
      <Card title="Defaults">
        <ActionForm action={updateErpSettingsAction} className="space-y-base">
          <fieldset disabled={!manage} className="grid gap-sm sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="companyState">Company state (for GST)</label>
              <select id="companyState" name="companyState" defaultValue={settings.companyState ?? ''} className="select w-full">
                <option value="">Not set: CGST + SGST on every invoice</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Field label="Default GST rate (%)" name="defaultGstRate" type="number" defaultValue={settings.defaultGstRate.toString()} required />
            <label className="flex items-center gap-xs self-end pb-xs text-body-sm">
              <input type="checkbox" name="allowNegativeStock" defaultChecked={settings.allowNegativeStock} /> Allow stock to go below zero
            </label>
          </fieldset>
          {manage ? <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton> : <p className="text-caption text-muted">Only Directors can change these.</p>}
        </ActionForm>
      </Card>
      <Card title="Chart of accounts">
        <p className="mb-sm text-caption text-muted">Fiscal year April to March, in rupees. Accounts marked “Used by the system” are where stock, GST and party balances post.</p>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Account</th><th>Type</th><th /></tr></thead>
            <tbody>
              {chart.map((a) => (
                <tr key={a.id}>
                  <td style={{ paddingLeft: `${0.75 + a.depth * 1.25}rem` }} className={a.isGroup ? 'font-medium text-ink' : ''}><span className="code mr-xs">{a.code}</span>{a.name}</td>
                  <td className="text-caption text-muted">{ROOT_LABEL[a.rootType]}{a.isGroup ? ' · group' : ''}</td>
                  <td className="text-caption text-muted">{a.systemKey ? 'Used by the system' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
