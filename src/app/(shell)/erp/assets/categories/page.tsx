import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead } from '@/modules/erp/services/access';
import { createCategoryAction, updateCategoryAction } from '@/app/actions/erp-assets';
import { fixedAssetAccounts, listCategories } from '@/modules/erp/services/asset.service';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Field } from '../../_components/parts';
import { AssetTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Asset categories' };

export default async function CategoriesPage() {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const manage = canManage(p, 'assets');
  const [rows, accounts] = await Promise.all([listCategories(p), fixedAssetAccounts(p.companyId)]);
  const accountSelect = (value?: string, idSuffix = '') => (
    <div>
      <label className="label" htmlFor={`fixedAssetAccountId${idSuffix}`}>Fixed-asset account</label>
      <select id={`fixedAssetAccountId${idSuffix}`} name="fixedAssetAccountId" defaultValue={value ?? ''} required className="select w-full">
        <option value="" disabled>Pick one</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
      </select>
    </div>
  );
  return (
    <div className="space-y-lg">
      <PageHeader title="Asset categories" subtitle="Each category sets the default useful life and the account its assets sit in." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Assets', href: '/erp/assets' }, { label: 'Categories' }]} />
      <AssetTabs current="/erp/assets/categories" />
      <Card>
        {rows.length === 0 ? <EmptyState title="No categories yet" /> : (
          <table className="table">
            <thead><tr><th>Category</th><th>Useful life</th><th>Account</th><th className="text-right">Assets</th>{manage ? <th /> : null}</tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.usefulLifeMonths} months</td>
                <td>{c.accountName}</td>
                <td className="text-right">{c.assets}</td>
                {manage ? (
                  <td>
                    <details>
                      <summary className="cursor-pointer text-caption text-muted">Edit</summary>
                      <ActionForm action={updateCategoryAction} className="mt-xs grid gap-xs">
                        <input type="hidden" name="id" value={c.id} />
                        <Field label="Name" name="name" defaultValue={c.name} required />
                        <Field label="Useful life (months)" name="usefulLifeMonths" type="number" defaultValue={c.usefulLifeMonths} required />
                        {accountSelect(c.fixedAssetAccountId, `-${c.id}`)}
                        <SubmitButton size="sm">Save</SubmitButton>
                      </ActionForm>
                    </details>
                  </td>
                ) : null}
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {manage ? (
        <Card title="New category">
          <ActionForm action={createCategoryAction} resetOnSuccess className="flex flex-wrap items-end gap-sm">
            <Field label="Name" name="name" required placeholder="Test equipment" />
            <Field label="Useful life (months)" name="usefulLifeMonths" type="number" required placeholder="60" />
            {accountSelect()}
            <SubmitButton variant="primary">Add category</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
