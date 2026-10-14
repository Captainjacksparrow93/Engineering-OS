import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, staffOptions } from '@/modules/erp/services/access';
import { ASSET_STATUS_LABEL, categoryOptions, listAssets } from '@/modules/erp/services/asset.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { workstationOptions } from '@/modules/erp/services/bom.service';
import { createAssetAction } from '@/app/actions/erp-assets';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocStatus, Money, showDate } from '../../_components/parts';
import { AssetTabs } from '../tabs';
import { AssetFields } from './asset-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assets' };

export default async function AssetRegisterPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const sp = await searchParams;
  const manage = canManage(p, 'assets');
  const [rows, categories] = await Promise.all([listAssets(p, { q: sp.q, status: sp.status, categoryId: sp.category }), categoryOptions(p.companyId)]);
  const [staff, workstations, suppliers] = manage ? await Promise.all([staffOptions(p.companyId), workstationOptions(p.companyId), partyOptions(p.companyId, 'SUPPLIER')]) : [[], [], []];
  return (
    <div className="space-y-lg">
      <PageHeader title="Assets" subtitle="Plant, tools, test equipment, vehicles and computers, with their depreciation." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Assets', href: '/erp/assets' }, { label: 'Register' }]} />
      <AssetTabs current="/erp/assets/register" />
      <form method="get" className="flex flex-wrap gap-sm">
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Name, number, serial or location" className="input w-64" aria-label="Search" />
        <select name="category" defaultValue={sp.category ?? ''} className="select" aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ''} className="select" aria-label="Status"><option value="">Not cancelled</option>{Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="No assets yet" hint={manage ? 'Add your first asset below. Set up a category first.' : undefined} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Asset</th><th>Category</th><th>Location</th><th>Bought</th><th className="text-right">Value</th><th className="text-right">Book value</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/erp/assets/register/${r.id}`} className="code mr-xs hover:underline">{r.number}</Link>{r.name}</td>
                    <td>{r.categoryName}</td>
                    <td>{r.location ?? '—'}</td>
                    <td>{showDate(r.purchaseDate)}</td>
                    <td className="text-right"><Money value={r.grossValue} /></td>
                    <td className="text-right"><Money value={r.bookValue} /></td>
                    <td><DocStatus status={r.status === 'SUBMITTED' ? 'IN_USE' : r.status} label={ASSET_STATUS_LABEL[r.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {manage ? (
        <Card title="New asset">
          {categories.length === 0 ? <EmptyState title="Add a category first" hint="Categories set the useful life and the fixed-asset account." /> : (
            <ActionForm action={createAssetAction} className="space-y-base">
              <AssetFields categories={categories} staff={staff} workstations={workstations} suppliers={suppliers} />
              <SubmitButton variant="primary" pendingLabel="Saving…">Save draft</SubmitButton>
            </ActionForm>
          )}
        </Card>
      ) : null}
    </div>
  );
}
