import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { canManageSettings, readSettings } from '@/modules/erp/services/settings.service';
import { INDIAN_STATES } from '@/modules/erp/domain/gst';
import { updateErpSettingsAction } from '@/app/actions/erp-stock';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, PageHeader } from '@/components/ui';
import { Field } from '../_components/parts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ERP settings' };

export default async function ErpSettingsPage() {
  const p = await requirePrincipal();
  if (!hasPermissionAnywhere(p, 'erp.access')) notFound();
  const settings = await readSettings(p);
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
            <label className="flex items-start gap-xs text-body-sm sm:col-span-3">
              <input type="checkbox" name="projectsFromSalesOrders" defaultChecked={settings.projectsFromSalesOrders} className="mt-xxs" />
              <span>Every work-order project starts from a submitted sales order. <span className="text-muted">Off: New project still lists waiting orders but also lets a work order start without one. Service calls never need an order.</span></span>
            </label>
            <div className="sm:col-span-3">
              <label className="label" htmlFor="salesTerms">Terms on sales orders and invoices</label>
              <textarea id="salesTerms" name="salesTerms" defaultValue={settings.salesTerms} rows={4} className="input w-full" />
            </div>
          </fieldset>
          {manage ? <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton> : <p className="text-caption text-muted">Only Directors can change these.</p>}
        </ActionForm>
      </Card>
      <Card title="Chart of accounts">
        <p className="text-body-sm">Fiscal year April to March, in rupees. The chart lives under <Link href="/erp/accounts/chart" className="font-medium underline">Accounts → Chart of accounts</Link>.</p>
      </Card>
    </div>
  );
}
