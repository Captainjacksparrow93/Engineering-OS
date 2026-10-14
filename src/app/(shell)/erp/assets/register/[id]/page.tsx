import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, staffOptions } from '@/modules/erp/services/access';
import { ASSET_STATUS_LABEL, canPostDepreciation, categoryOptions, getAsset } from '@/modules/erp/services/asset.service';
import { MAINT_KIND_LABEL, MAINT_STATUS_LABEL } from '@/modules/erp/services/maintenance.service';
import { partyOptions } from '@/modules/erp/services/party.service';
import { workstationOptions } from '@/modules/erp/services/bom.service';
import { FREQUENCY_LABEL } from '@/modules/erp/domain/assets';
import { formatQty } from '@/modules/erp/domain/money';
import {
  cancelAssetAction,
  createScheduleAction,
  deleteAssetAction,
  moveAssetAction,
  postDepreciationAction,
  reportBreakdownAction,
  scrapAssetAction,
  submitAssetAction,
  updateAssetAction,
} from '@/app/actions/erp-assets';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DocButton } from '../../../_components/doc-button';
import { DocStatus, Field, Money, orNotFound, showDate, todayIso } from '../../../_components/parts';
import { AssetFields } from '../asset-form';

export const dynamic = 'force-dynamic';

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const { id } = await params;
  const { asset, category, item, supplier, invoice, workstation, logs, schedules, people, accumulated, bookValue } = await orNotFound(getAsset(p, id));
  const manage = canManage(p, 'assets');
  const draft = asset.status === 'DRAFT';
  const inUse = asset.status === 'SUBMITTED';
  const [categories, staff, workstations, suppliers] = manage ? await Promise.all([categoryOptions(p.companyId), staffOptions(p.companyId), workstationOptions(p.companyId), partyOptions(p.companyId, 'SUPPLIER')]) : [[], [], [], []];
  const due = asset.depreciation.filter((d) => !d.postedAt && d.scheduleDate <= new Date());
  const openBreakdown = logs.find((l) => l.kind === 'BREAKDOWN' && (l.status === 'OPEN' || l.status === 'IN_PROGRESS'));
  const row = (label: string, value: React.ReactNode) => (
    <div><dt className="text-caption uppercase text-muted">{label}</dt><dd className="mt-xxs text-body-sm">{value || '—'}</dd></div>
  );
  return (
    <div className="space-y-lg">
      <PageHeader
        title={`${asset.number} · ${asset.name}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-xs"><DocStatus status={inUse ? 'IN_USE' : asset.status} label={ASSET_STATUS_LABEL[asset.status]} /> {category?.name}{openBreakdown ? <Link href={`/erp/assets/maintenance/${openBreakdown.id}`} className="badge badge-error">Down: {openBreakdown.number}</Link> : null}</span>}
        breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Assets', href: '/erp/assets/register' }, { label: asset.number }]}
        actions={manage ? (
          draft ? (
            <>
              <DocButton action={submitAssetAction} fields={{ id }} label="Submit" variant="primary" />
              <DocButton action={deleteAssetAction} fields={{ id }} label="Delete draft" confirm="Delete this draft asset?" />
            </>
          ) : inUse || asset.status === 'SCRAPPED' ? <DocButton action={cancelAssetAction} fields={{ id }} label="Cancel" variant="danger" confirm="Cancel this asset? Its depreciation and any scrapping are reversed in the books." /> : null
        ) : null}
      />
      <div className="grid gap-base sm:grid-cols-4">
        <Stat label="Purchase value" value={<Money value={asset.grossValue} />} />
        <Stat label="Depreciated" value={<Money value={accumulated} />} />
        <Stat label="Book value" value={<Money value={bookValue} />} />
        <Stat label="Useful life" value={`${asset.usefulLifeMonths} months`} hint={asset.salvageValue.isZero() ? undefined : `Salvage ₹ ${asset.salvageValue.toFixed(2)}`} />
      </div>
      {draft && manage ? (
        <Card title="Details">
          <ActionForm action={updateAssetAction} className="space-y-base">
            <input type="hidden" name="id" value={id} />
            <AssetFields asset={asset} categories={categories} staff={staff} workstations={workstations} suppliers={suppliers} invoiceNo={invoice?.number} itemCode={item?.code} />
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </ActionForm>
        </Card>
      ) : (
        <Card title="Details">
          <dl className="grid gap-base sm:grid-cols-4">
            {row('Location', asset.location)}
            {row('Custodian', asset.custodianId ? people.get(asset.custodianId) : null)}
            {row('Serial no.', asset.serialNo)}
            {row('Workstation', workstation?.name)}
            {row('Purchased', showDate(asset.purchaseDate))}
            {row('In use from', showDate(asset.availableForUseDate))}
            {row('Supplier', supplier?.name)}
            {row('Purchase invoice', invoice ? <Link href={`/erp/buying/invoices/${invoice.id}`} className="code hover:underline">{invoice.number}</Link> : asset.isExisting ? 'Existing asset (opening balances)' : null)}
            {row('Item', item ? `${item.code} ${item.name}` : null)}
            {row('Scrapped', asset.disposalDate ? `${showDate(asset.disposalDate)}${asset.disposalNote ? ` · ${asset.disposalNote}` : ''}` : null)}
            {row('Notes', asset.notes)}
          </dl>
        </Card>
      )}
      {!draft ? (
        <Card title="Depreciation schedule" action={inUse && due.length && canPostDepreciation(p) ? <DocButton action={postDepreciationAction} fields={{ assetId: id, upTo: todayIso() }} label={`Post ${due.length} due`} variant="primary" /> : null}>
          {asset.depreciation.length === 0 ? <EmptyState title="Nothing to depreciate" /> : (
            <div className="max-h-96 overflow-y-auto">
              <table className="table">
                <thead><tr><th>#</th><th>Date</th><th className="text-right">Amount</th><th className="text-right">Accumulated</th><th>Posted</th></tr></thead>
                <tbody>{asset.depreciation.map((d) => (
                  <tr key={d.id}><td>{d.seq}</td><td>{showDate(d.scheduleDate)}</td><td className="text-right"><Money value={d.amount} /></td><td className="text-right"><Money value={d.accumulated} /></td><td>{d.postedAt ? <span className="badge badge-success">Posted</span> : <span className="text-caption text-muted">—</span>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
      {!draft ? (
        <div className="grid gap-lg lg:grid-cols-2">
          <Card title="Maintenance tasks">
            {schedules.length === 0 ? <EmptyState title="No planned maintenance" /> : (
              <table className="table"><tbody>{schedules.map((s) => (
                <tr key={s.id} className={s.isActive ? '' : 'text-muted'}><td>{s.task}<div className="text-caption text-muted">{FREQUENCY_LABEL[s.frequency]}{s.assignedToId ? ` · ${people.get(s.assignedToId)}` : ''}</div></td><td>{s.isActive ? `Due ${showDate(s.nextDueDate)}` : 'Switched off'}</td></tr>
              ))}</tbody></table>
            )}
            {inUse && manage ? (
              <ActionForm action={createScheduleAction} resetOnSuccess className="mt-base space-y-sm border-t border-hairline pt-base">
                <input type="hidden" name="assetId" value={id} />
                <div className="grid gap-sm sm:grid-cols-2">
                  <Field label="Task" name="task" required placeholder="Check oil level" />
                  <div>
                    <label className="label" htmlFor="frequency">How often</label>
                    <select id="frequency" name="frequency" className="select w-full" defaultValue="MONTHLY">{Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  </div>
                  <Field label="First due" name="nextDueDate" type="date" defaultValue={todayIso()} required />
                  <div>
                    <label className="label" htmlFor="assignedToId">Done by</label>
                    <select id="assignedToId" name="assignedToId" className="select w-full" defaultValue=""><option value="">Anyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select>
                  </div>
                </div>
                <SubmitButton size="sm">Add task</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>
          <Card title="Maintenance history">
            {logs.length === 0 ? <EmptyState title="No maintenance yet" /> : (
              <table className="table"><tbody>{logs.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/erp/assets/maintenance/${l.id}`} className="code hover:underline">{l.number}</Link><div className="text-caption text-muted">{MAINT_KIND_LABEL[l.kind]}</div></td>
                  <td>{l.description.slice(0, 80)}</td>
                  <td>{showDate(l.completedAt ?? l.reportedAt)}{l.downtimeHours ? <div className="text-caption text-muted">{formatQty(l.downtimeHours)} h down</div> : null}</td>
                  <td><DocStatus status={l.status === 'DONE' ? 'COMPLETED' : l.status} label={MAINT_STATUS_LABEL[l.status]} /></td>
                </tr>
              ))}</tbody></table>
            )}
            {inUse && manage && !openBreakdown ? (
              <ActionForm action={reportBreakdownAction} className="mt-base space-y-sm border-t border-hairline pt-base">
                <input type="hidden" name="assetId" value={id} />
                <div>
                  <label className="label" htmlFor="description">Report a breakdown</label>
                  <textarea id="description" name="description" rows={2} required className="input w-full" placeholder="What stopped working?" />
                </div>
                <SubmitButton size="sm" variant="danger">Report breakdown</SubmitButton>
              </ActionForm>
            ) : null}
          </Card>
        </div>
      ) : null}
      {!draft ? (
        <Card title="Moves">
          {asset.movements.length === 0 ? <EmptyState title="Not moved since it was added" /> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Location</th><th>Custodian</th><th>Note</th></tr></thead>
              <tbody>{asset.movements.map((m) => (
                <tr key={m.id}><td>{showDate(m.movedAt)}</td><td>{m.fromLocation ?? '—'} → {m.toLocation ?? '—'}</td><td>{m.fromCustodian ?? '—'} → {m.toCustodian ?? '—'}</td><td>{m.note ?? ''}</td></tr>
              ))}</tbody>
            </table>
          )}
          {inUse && manage ? (
            <ActionForm action={moveAssetAction} resetOnSuccess className="mt-base flex flex-wrap items-end gap-sm border-t border-hairline pt-base">
              <input type="hidden" name="id" value={id} />
              <Field label="Date" name="movedAt" type="date" defaultValue={todayIso()} required />
              <Field label="New location" name="location" defaultValue={asset.location} />
              <div>
                <label className="label" htmlFor="custodianId">Custodian</label>
                <select id="custodianId" name="custodianId" className="select" defaultValue={asset.custodianId ?? ''}><option value="">None</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select>
              </div>
              <Field label="Note" name="note" />
              <SubmitButton size="sm">Record move</SubmitButton>
            </ActionForm>
          ) : null}
        </Card>
      ) : null}
      {inUse && manage ? (
        <Card title="Scrap this asset">
          <p className="mb-sm text-body-sm text-muted">Depreciation up to the scrap date is posted first; the book value left goes to Gain/Loss on Asset Disposal.</p>
          <ActionForm action={scrapAssetAction} className="flex flex-wrap items-end gap-sm">
            <input type="hidden" name="id" value={id} />
            <Field label="Scrap date" name="date" type="date" defaultValue={todayIso()} required />
            <Field label="Reason" name="note" />
            <SubmitButton size="sm" variant="danger" confirm="Scrap this asset? It leaves the books.">Scrap</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
