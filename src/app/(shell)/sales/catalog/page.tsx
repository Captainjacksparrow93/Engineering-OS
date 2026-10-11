import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { hasPermissionAnywhere } from '@/core/rbac/engine';
import { listItems } from '@/modules/sales/services/catalog.service';
import { loadSalesConfig } from '@/modules/sales/services/settings.service';
import { PRICE_SOURCE_LABELS, PRICE_SOURCES } from '@/modules/sales/domain/pricing';
import { createItemAction, importPricesAction } from '@/app/actions/sales';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/form';
import { ActionForm } from '@/components/action-form';
import { formatINR, isoDay, shortDate } from '../_components/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Price catalogue' };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const principal = await requirePrincipal();
  if (!hasPermissionAnywhere(principal, 'sales.deal.read')) notFound();
  const { q, filter } = await searchParams;
  const [all, config] = await Promise.all([listItems(principal, { q }), loadSalesConfig(principal.companyId)]);
  const items = filter === 'stale' ? all.filter((i) => !i.price || i.price.stale) : all;
  const canManage = hasPermissionAnywhere(principal, 'sales.catalog.manage');

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Price catalogue"
        subtitle={`Latest price = newest ${config.pricePriority.map((s) => PRICE_SOURCE_LABELS[s].toLowerCase()).join(', then ')}, skipping prices older than ${config.priceStaleDays} days.`}
      />

      <form method="get" className="flex flex-wrap gap-sm">
        <input name="q" defaultValue={q ?? ''} placeholder="Code, name, make or part number" className="input w-80" aria-label="Search items" />
        <select name="filter" defaultValue={filter ?? ''} className="select" aria-label="Filter">
          <option value="">All items</option>
          <option value="stale">No price or old price</option>
        </select>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>

      {items.length === 0 ? (
        <EmptyState title={all.length ? 'No items match' : 'The catalogue is empty'} hint={canManage ? 'Add items one by one, or import a price list below.' : 'Ask the Sales Head to load the price list.'} />
      ) : (
        <table className="table">
          <thead><tr><th>Item</th><th>Make</th><th>Category</th><th className="text-right">Latest price</th><th>Source</th><th>Since</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/sales/catalog/${i.id}`} className="hover:underline"><span className="code mr-xs">{i.code}</span>{i.name}</Link>
                  {i.makerPartNo ? <span className="text-caption text-muted"> · {i.makerPartNo}</span> : null}
                </td>
                <td>{i.make ?? '—'}</td>
                <td>{i.category ?? '—'}</td>
                <td className={`text-right ${!i.price || i.price.stale ? 'text-error' : ''}`}>{i.price ? `${formatINR(i.price.rate)} / ${i.uom}` : 'No price'}</td>
                <td>{i.price ? PRICE_SOURCE_LABELS[i.price.source] : '—'}</td>
                <td className={i.price?.stale ? 'text-error' : ''}>{i.price ? `${shortDate(i.price.effectiveDate)}${i.price.stale ? ' (old)' : ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage ? (
        <div className="grid gap-lg lg:grid-cols-2">
          <Card title="Add an item">
            <ActionForm action={createItemAction} resetOnSuccess className="space-y-sm">
              <div className="grid grid-cols-2 gap-sm">
                <input name="code" required placeholder="Item code" className="input w-full" aria-label="Item code" />
                <input name="name" required placeholder="Name" className="input w-full" aria-label="Name" />
                <input name="make" placeholder="Make (Siemens…)" className="input w-full" aria-label="Make" />
                <input name="makerPartNo" placeholder="Maker part no." className="input w-full" aria-label="Maker part number" />
                <input name="category" placeholder="Category (PLC, switchgear…)" className="input w-full" aria-label="Category" />
                <input name="uom" defaultValue="Nos" className="input w-full" aria-label="Unit" />
              </div>
              <div className="grid grid-cols-3 gap-sm">
                <select name="source" defaultValue="PURCHASE" className="select w-full" aria-label="Price source">
                  {PRICE_SOURCES.map((s) => <option key={s} value={s}>{PRICE_SOURCE_LABELS[s]}</option>)}
                </select>
                <input name="rate" type="number" min={0} step="any" placeholder="Net cost (₹)" className="input w-full" aria-label="Net cost" />
                <input name="effectiveDate" type="date" defaultValue={isoDay(new Date())} className="input w-full" aria-label="Price date" />
              </div>
              <SubmitButton>Add item</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Import a price list (CSV)">
            <ActionForm action={importPricesAction} className="space-y-sm">
              <p className="text-caption text-muted">
                Save the sheet as CSV. Columns: <span className="code">item_code</span>, <span className="code">item_name</span> (for new items), <span className="code">make</span>,{' '}
                <span className="code">maker_part_no</span>, <span className="code">category</span>, <span className="code">uom</span>, <span className="code">source</span> (purchase / price_list / bom_cost),{' '}
                <span className="code">rate</span> or <span className="code">list_price</span> + <span className="code">discount_pct</span>, <span className="code">supplier</span>, <span className="code">reference</span>, <span className="code">date</span>.
                Prices are added, never overwritten; nothing is saved if any row is wrong.
              </p>
              <div className="flex flex-wrap items-center gap-sm">
                <input type="file" name="file" accept=".csv,text/csv" required className="text-body-sm" aria-label="CSV file" />
                <select name="source" defaultValue="PRICE_LIST" className="select" aria-label="Source when the column is empty">
                  {PRICE_SOURCES.map((s) => <option key={s} value={s}>{PRICE_SOURCE_LABELS[s]}</option>)}
                </select>
              </div>
              <SubmitButton pendingLabel="Importing…">Import</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
