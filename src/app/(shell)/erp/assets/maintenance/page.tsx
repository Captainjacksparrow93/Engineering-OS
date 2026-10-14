import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { canManage, canRead, staffOptions } from '@/modules/erp/services/access';
import { assetOptions } from '@/modules/erp/services/asset.service';
import { listLogs, listSchedules, MAINT_KIND_LABEL, MAINT_STATUS_LABEL } from '@/modules/erp/services/maintenance.service';
import { FREQUENCY_LABEL } from '@/modules/erp/domain/assets';
import { formatQty } from '@/modules/erp/domain/money';
import { createScheduleAction, logScheduleDoneAction, setScheduleActiveAction } from '@/app/actions/erp-assets';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DocButton } from '../../_components/doc-button';
import { DocStatus, Field, Money, showDate, todayIso } from '../../_components/parts';
import { AssetTabs } from '../tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Maintenance' };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ due?: string }> }) {
  const p = await requirePrincipal();
  if (!canRead(p, 'assets')) notFound();
  const sp = await searchParams;
  const manage = canManage(p, 'assets');
  const [schedules, logs] = await Promise.all([listSchedules(p, { due: sp.due === '1' }), listLogs(p)]);
  const [assets, staff] = manage ? await Promise.all([assetOptions(p.companyId), staffOptions(p.companyId)]) : [[], []];
  return (
    <div className="space-y-lg">
      <PageHeader title="Maintenance" subtitle="Preventive tasks that repeat, and everything done on the machines." breadcrumb={[{ label: 'ERP', href: '/erp' }, { label: 'Assets', href: '/erp/assets' }, { label: 'Maintenance' }]} />
      <AssetTabs current="/erp/assets/maintenance" />
      <div className="flex gap-sm">
        <Link href="/erp/assets/maintenance" className={sp.due === '1' ? 'btn btn-secondary btn-sm' : 'btn btn-ink btn-sm'}>All tasks</Link>
        <Link href="/erp/assets/maintenance?due=1" className={sp.due === '1' ? 'btn btn-ink btn-sm' : 'btn btn-secondary btn-sm'}>Due this week</Link>
      </div>
      <Card title="Preventive tasks">
        {schedules.length === 0 ? <EmptyState title={sp.due === '1' ? 'Nothing due this week' : 'No maintenance tasks yet'} hint={manage ? 'Add a task below, or from an asset’s page.' : undefined} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Asset</th><th>Task</th><th>How often</th><th>Done by</th><th>Due</th>{manage ? <th>Log it done</th> : null}</tr></thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/erp/assets/register/${s.assetId}`} className="hover:underline">{s.asset?.name}</Link><div className="text-caption text-muted">{s.asset?.location ?? ''}</div></td>
                    <td>{s.task}{s.checklist ? <div className="whitespace-pre-line text-caption text-muted">{s.checklist}</div> : null}</td>
                    <td>{FREQUENCY_LABEL[s.frequency]}</td>
                    <td>{s.assignedTo}</td>
                    <td className={s.overdue ? 'font-medium text-error' : ''}>{showDate(s.nextDueDate)}{s.lastDoneDate ? <div className="text-caption text-muted">Last {showDate(s.lastDoneDate)}</div> : null}</td>
                    {manage ? (
                      <td>
                        <ActionForm action={logScheduleDoneAction} className="flex flex-wrap items-end gap-xs">
                          <input type="hidden" name="id" value={s.id} />
                          <input type="date" name="doneOn" defaultValue={todayIso()} className="input w-36" aria-label="Done on" required />
                          <input name="actionTaken" placeholder="Notes" className="input w-40" aria-label="Notes" />
                          <input name="cost" type="number" step="0.01" placeholder="Cost ₹" className="input w-24" aria-label="Cost" />
                          <SubmitButton size="sm">Done</SubmitButton>
                        </ActionForm>
                        <div className="mt-xxs"><DocButton action={setScheduleActiveAction} fields={{ id: s.id, active: '0' }} label="Switch off" confirm="Stop this maintenance task?" /></div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {manage ? (
        <Card title="New maintenance task">
          {assets.length === 0 ? <EmptyState title="No assets in use" hint="Submit an asset first." /> : (
            <ActionForm action={createScheduleAction} resetOnSuccess className="space-y-base">
              <div className="grid gap-sm sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="assetId">Asset</label>
                  <select id="assetId" name="assetId" className="select w-full" required defaultValue=""><option value="" disabled>Pick one</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select>
                </div>
                <Field label="Task" name="task" required placeholder="Clean filters and check belts" />
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
              <div>
                <label className="label" htmlFor="checklist">Checklist</label>
                <textarea id="checklist" name="checklist" rows={3} className="input w-full" placeholder="One check per line" />
              </div>
              <SubmitButton variant="primary">Add task</SubmitButton>
            </ActionForm>
          )}
        </Card>
      ) : null}
      <Card title="Recent maintenance">
        {logs.length === 0 ? <EmptyState title="Nothing logged yet" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Record</th><th>Asset</th><th>What</th><th>Date</th><th className="text-right">Downtime</th><th className="text-right">Cost</th><th>Status</th></tr></thead>
              <tbody>{logs.slice(0, 50).map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/erp/assets/maintenance/${l.id}`} className="code hover:underline">{l.number}</Link><div className="text-caption text-muted">{MAINT_KIND_LABEL[l.kind]}</div></td>
                  <td>{l.asset?.name}</td>
                  <td>{l.description.slice(0, 80)}</td>
                  <td>{showDate(l.completedAt ?? l.reportedAt)}</td>
                  <td className="text-right">{l.downtimeHours ? `${formatQty(l.downtimeHours)} h` : '—'}</td>
                  <td className="text-right">{l.cost.isZero() ? '—' : <Money value={l.cost} />}</td>
                  <td><DocStatus status={l.status === 'DONE' ? 'COMPLETED' : l.status} label={MAINT_STATUS_LABEL[l.status]} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
