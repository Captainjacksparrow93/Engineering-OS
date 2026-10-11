import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { prisma } from '@/core/db/prisma';
import { formatDate, todayInIndia } from '@/core/utils/dates';
import { formatMinutes } from '@/modules/hrms/domain/time';
import { getSettings } from '@/modules/hrms/services/attendance.service';
import { listHolidays, listLeaveTypes, managesTime } from '@/modules/hrms/services/leave.service';
import { addHolidayAction, removeHolidayAction, saveLeaveTypeAction, saveShiftAction, setAllocationAction } from '@/app/actions/hrms';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { RowButton } from '../_components/row-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leave and attendance settings' };

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function LeaveTypeFields({ t, prefix }: { t?: { id: string; code: string; name: string; annualDays: unknown; paid: boolean; allowHalfDay: boolean; active: boolean }; prefix: string }) {
  return (
    <>
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      <div className="grid gap-base sm:grid-cols-[6rem_minmax(0,1fr)_8rem]">
        <div>
          <label className="label" htmlFor={`${prefix}-code`}>Code</label>
          <input id={`${prefix}-code`} name="code" required maxLength={10} defaultValue={t?.code} className="input w-full" placeholder="CL" />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-name`}>Name</label>
          <input id={`${prefix}-name`} name="name" required maxLength={60} defaultValue={t?.name} className="input w-full" placeholder="Casual leave" />
        </div>
        <div>
          <label className="label" htmlFor={`${prefix}-days`}>Days a year</label>
          <input id={`${prefix}-days`} name="annualDays" type="number" step="0.5" min="0" max="365" defaultValue={t?.annualDays == null ? '' : String(t.annualDays)} className="input w-full" placeholder="No limit" />
        </div>
      </div>
      <div className="flex flex-wrap gap-base text-body-sm">
        <label className="flex items-center gap-xs"><input type="checkbox" name="paid" defaultChecked={t?.paid ?? true} /> Paid</label>
        <label className="flex items-center gap-xs"><input type="checkbox" name="allowHalfDay" defaultChecked={t?.allowHalfDay ?? true} /> Half days allowed</label>
        <label className="flex items-center gap-xs"><input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> In use</label>
      </div>
    </>
  );
}

/** HR: shift timings, leave types, one employee's days, and the holiday calendar. */
export default async function HrSettingsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const principal = await requirePrincipal();
  if (!managesTime(principal)) notFound();
  const sp = await searchParams;
  const thisYear = todayInIndia().getUTCFullYear();
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const [settings, types, holidays, people] = await Promise.all([
    getSettings(principal.companyId),
    listLeaveTypes(principal),
    listHolidays(principal, year),
    prisma.user.findMany({ where: { companyId: principal.companyId, status: 'ACTIVE' }, select: { id: true, fullName: true, employeeCode: true }, orderBy: { fullName: 'asc' } }),
  ]);

  return (
    <div className="space-y-lg">
      <PageHeader title="Leave and attendance settings" subtitle="Shift timings, leave types and holidays for everyone at ACS Engitech." breadcrumb={[{ label: 'HR', href: '/hrms' }, { label: 'Settings' }]} />

      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Shift">
          <p className="mb-base text-body-sm text-muted">Now: starts {formatMinutes(settings.shiftStartMinutes)}, {settings.graceMinutes} minutes' grace, full day {settings.fullDayMinutes / 60} hours, half day {settings.halfDayMinutes / 60} hours.</p>
          <ActionForm action={saveShiftAction} className="space-y-base">
            <div className="grid gap-base grid-cols-2">
              <div><label className="label" htmlFor="sh-start">Shift starts</label><input id="sh-start" name="shiftStart" type="time" required defaultValue={hhmm(settings.shiftStartMinutes)} className="input w-full" /></div>
              <div><label className="label" htmlFor="sh-grace">Grace (minutes)</label><input id="sh-grace" name="graceMinutes" type="number" min="0" max="120" required defaultValue={settings.graceMinutes} className="input w-full" /></div>
              <div><label className="label" htmlFor="sh-full">Full day (hours)</label><input id="sh-full" name="fullDayHours" type="number" step="0.25" min="1" max="16" required defaultValue={settings.fullDayMinutes / 60} className="input w-full" /></div>
              <div><label className="label" htmlFor="sh-half">Half day (hours)</label><input id="sh-half" name="halfDayHours" type="number" step="0.25" min="0.5" max="12" required defaultValue={settings.halfDayMinutes / 60} className="input w-full" /></div>
            </div>
            <p className="hint">Coming in after start + grace counts as late. Less than a half day counts as absent.</p>
            <SubmitButton pendingLabel="Saving…">Save shift</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="One employee's leave days">
          <ActionForm action={setAllocationAction} resetOnSuccess className="space-y-base">
            <div>
              <label className="label" htmlFor="al-user">Employee</label>
              <select id="al-user" name="userId" required defaultValue="" className="select w-full">
                <option value="" disabled>Pick an employee</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.employeeCode})</option>)}
              </select>
            </div>
            <div className="grid gap-base grid-cols-3">
              <div>
                <label className="label" htmlFor="al-type">Leave type</label>
                <select id="al-type" name="leaveTypeId" required defaultValue="" className="select w-full">
                  <option value="" disabled>Pick</option>
                  {types.filter((t) => t.active && t.annualDays !== null).map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
                </select>
              </div>
              <div><label className="label" htmlFor="al-year">Year</label><input id="al-year" name="year" type="number" required defaultValue={thisYear} className="input w-full" /></div>
              <div><label className="label" htmlFor="al-days">Days</label><input id="al-days" name="days" type="number" step="0.5" min="0" required className="input w-full" /></div>
            </div>
            <div><label className="label" htmlFor="al-note">Note</label><input id="al-note" name="note" maxLength={300} className="input w-full" placeholder="e.g. Joined in July, pro-rated" /></div>
            <p className="hint">Replaces the leave type's usual days for this person and year: someone who joined mid-year, or days carried forward.</p>
            <SubmitButton pendingLabel="Saving…">Set days</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title="Leave types">
        <ul className="divide-y divide-hairline-soft">
          {types.map((t) => (
            <li key={t.id} className="py-sm first:pt-0">
              <details>
                <summary className="cursor-pointer text-body-md">
                  <strong className="text-ink">{t.code}</strong> {t.name} <span className="text-body-sm text-muted">· {t.annualDays === null ? 'no limit' : `${Number(t.annualDays)} days a year`} · {t.paid ? 'paid' : 'unpaid'}{t.active ? '' : ' · not in use'}</span>
                </summary>
                <ActionForm action={saveLeaveTypeAction} className="mt-sm space-y-base"><LeaveTypeFields t={t} prefix={`lt-${t.id}`} /><SubmitButton size="sm" pendingLabel="Saving…">Save</SubmitButton></ActionForm>
              </details>
            </li>
          ))}
          <li className="pt-sm">
            <details>
              <summary className="cursor-pointer text-body-sm font-medium text-ink">Add a leave type</summary>
              <ActionForm action={saveLeaveTypeAction} resetOnSuccess className="mt-sm space-y-base"><LeaveTypeFields prefix="lt-new" /><SubmitButton size="sm" pendingLabel="Adding…">Add leave type</SubmitButton></ActionForm>
            </details>
          </li>
        </ul>
      </Card>

      <Card title={`Holidays in ${year}`} action={<span className="flex gap-xs"><a className="link text-body-sm" href={`?year=${year - 1}`}>{year - 1}</a><a className="link text-body-sm" href={`?year=${year + 1}`}>{year + 1}</a></span>}>
        <div className="grid gap-lg lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {holidays.length === 0 ? (
            <EmptyState title={`No holidays for ${year} yet`} hint="Add the company's holiday list. Leave does not count holidays." />
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {holidays.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-base py-xs">
                  <span><span className="text-ink">{h.name}</span> <span className="text-body-sm text-muted">{formatDate(h.date, { forceYear: true })}</span></span>
                  <RowButton action={removeHolidayAction} name="id" value={h.id} label="Remove" confirm={`Remove ${h.name}?`} />
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addHolidayAction} resetOnSuccess className="space-y-base">
            <div><label className="label" htmlFor="hd-date">Date</label><input id="hd-date" name="date" type="date" required className="input w-full" /></div>
            <div><label className="label" htmlFor="hd-name">Name</label><input id="hd-name" name="name" required maxLength={80} className="input w-full" placeholder="e.g. Diwali" /></div>
            <SubmitButton pendingLabel="Adding…">Add holiday</SubmitButton>
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}
