import { requirePrincipal } from '@/core/auth/session';
import { SOURCE_LABEL, visitorLabel } from '@/modules/gate/domain/labels';
import { formatTime, formatWhen, istDateString } from '@/modules/gate/domain/time';
import { listMyVisits } from '@/modules/gate/services/visit.service';
import { cancelVisitAction, scheduleVisitAction } from '@/app/actions/gate';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { DateTimeFields, ReplyBadge, StatusBadge, VisitorFields } from '../_components/parts';
import { ReplyForm } from '../_components/reply-form';
import { VisitButton } from '../_components/visit-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My visitors' };

/** Every employee: schedule visitors coming to see you, answer arrivals, see your history. */
export default async function MyVisitorsPage() {
  const principal = await requirePrincipal();
  const now = new Date();
  const today = istDateString(now);
  const { atReception, upcoming, recent } = await listMyVisits(principal, now);

  return (
    <div className="space-y-lg">
      <PageHeader title="My visitors" subtitle="Tell the front desk who is coming to see you. When a visitor arrives you are alerted here and on every page." />

      {atReception.length > 0 ? (
        <Card title="At reception now">
          <ul className="divide-y divide-hairline-soft">
            {atReception.map((v) => (
              <li key={v.id} className="space-y-sm py-sm first:pt-0 last:pb-0">
                <p className="text-body-md text-ink">
                  <strong>{visitorLabel(v)}</strong>
                  <span className="text-muted"> · since {formatTime(v.checkedInAt)} · {v.purpose} · {v.visitorPhone}</span>
                </p>
                {v.hostReply ? (
                  <p className="text-body-sm">You replied: <ReplyBadge reply={v.hostReply} note={v.hostReplyNote} /> <span className="text-muted">You can change it below.</span></p>
                ) : null}
                <ReplyForm visitId={v.id} withNote />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card title="Schedule a visitor">
          <ActionForm action={scheduleVisitAction} resetOnSuccess className="space-y-base">
            <VisitorFields idPrefix="mine" />
            <DateTimeFields idPrefix="mine" today={today} />
            <SubmitButton variant="primary" pendingLabel="Scheduling…">Schedule visit</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Coming up">
          {upcoming.length === 0 ? (
            <EmptyState title="No visitors scheduled" hint="Visits you or the front desk schedule for you show here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>When</th><th>Visitor</th><th>Purpose</th><th>Scheduled by</th><th /></tr></thead>
                <tbody>
                  {upcoming.map((v) => (
                    <tr key={v.id}>
                      <td className="whitespace-nowrap">{formatWhen(v.expectedAt, now)}</td>
                      <td className="font-medium text-ink">{visitorLabel(v)}</td>
                      <td>{v.purpose}</td>
                      <td>{v.createdBy.id === principal.userId ? 'You' : v.createdBy.fullName}</td>
                      <td className="text-right"><VisitButton action={cancelVisitAction} visitId={v.id} label="Cancel" confirm={`Cancel the visit by ${v.visitorName}?`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Last 30 days">
        {recent.length === 0 ? (
          <EmptyState title="No past visitors" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Expected</th><th>Visitor</th><th>Purpose</th><th>Type</th><th>Status</th><th>In</th><th>Out</th></tr></thead>
              <tbody>
                {recent.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">{formatWhen(v.expectedAt, now)}</td>
                    <td>{visitorLabel(v)}</td>
                    <td>{v.purpose}</td>
                    <td>{SOURCE_LABEL[v.source]}</td>
                    <td><StatusBadge status={v.status} missed={v.status === 'EXPECTED'} /></td>
                    <td className="whitespace-nowrap">{formatTime(v.checkedInAt)}</td>
                    <td className="whitespace-nowrap">{formatTime(v.checkedOutAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
