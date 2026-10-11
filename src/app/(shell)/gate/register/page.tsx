import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { SOURCE_LABEL, visitorLabel } from '@/modules/gate/domain/labels';
import { formatTime, formatWhen, istDateString, istDayRange } from '@/modules/gate/domain/time';
import { listRegister, seesRegister } from '@/modules/gate/services/visit.service';
import { Alert, EmptyState, PageHeader } from '@/components/ui';
import { ReplyBadge, StatusBadge } from '../_components/parts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Visitor register' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every visit for a date range. The front desk and Directors only. */
export default async function VisitorRegisterPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string }> }) {
  const principal = await requirePrincipal();
  if (!seesRegister(principal)) notFound();

  const now = new Date();
  const today = istDateString(now);
  const params = await searchParams;
  const to = params.to && DATE.test(params.to) ? params.to : today;
  const from = params.from && DATE.test(params.from) ? params.from : istDateString(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const q = params.q?.trim().slice(0, 80) || null;
  const valid = from <= to;
  const visits = valid ? await listRegister(principal, { from, to, q }) : [];
  const todayStart = istDayRange(today).start;

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Visitor register"
        subtitle="Every visitor: who came, whom they saw, and when they came in and left."
        breadcrumb={[{ label: 'Gate & Visitors', href: '/gate' }, { label: 'Visitor register' }]}
      />

      <form method="get" className="flex flex-wrap items-end gap-base">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} className="input" />
        </div>
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q ?? ''} className="input w-full" placeholder="Visitor, company, phone, purpose or employee" />
        </div>
        <button type="submit" className="btn btn-secondary">Show</button>
      </form>

      {!valid ? <Alert tone="warning">The start date is after the end date.</Alert> : null}

      {visits.length === 0 ? (
        <EmptyState title="No visitors in this period" hint={q ? 'Try a different search or a wider date range.' : 'Try a wider date range.'} />
      ) : (
        <>
          <p className="text-body-sm text-muted">
            {visits.length === 500 ? 'Showing the latest 500 visits. Narrow the dates to see the rest.' : `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`}
          </p>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Expected</th><th>Visitor</th><th>Phone</th><th>Purpose</th><th>Here to see</th><th>Type</th><th>Status</th><th>In</th><th>Out</th><th>Host reply</th></tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">{formatWhen(v.expectedAt, now)}</td>
                    <td className="font-medium text-ink">{visitorLabel(v)}</td>
                    <td className="whitespace-nowrap">{v.visitorPhone}</td>
                    <td>{v.purpose}</td>
                    <td>{v.host.fullName}</td>
                    <td>{SOURCE_LABEL[v.source]}</td>
                    <td><StatusBadge status={v.status} missed={v.status === 'EXPECTED' && v.expectedAt < todayStart} /></td>
                    <td className="whitespace-nowrap">{formatTime(v.checkedInAt)}</td>
                    <td className="whitespace-nowrap">{formatTime(v.checkedOutAt)}</td>
                    <td>{v.checkedInAt ? <ReplyBadge reply={v.hostReply} note={v.hostReplyNote} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
