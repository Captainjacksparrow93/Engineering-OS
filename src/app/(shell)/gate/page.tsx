import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/core/auth/session';
import { visitorLabel } from '@/modules/gate/domain/labels';
import { formatTime, formatWhen, istDateString } from '@/modules/gate/domain/time';
import { getDesk, isDesk, listHosts, seesRegister } from '@/modules/gate/services/visit.service';
import { cancelVisitAction, checkInAction, checkOutAction, scheduleVisitAction, walkInAction } from '@/app/actions/gate';
import { ActionForm } from '@/components/action-form';
import { SubmitButton } from '@/components/form';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DateTimeFields, HostSelect, ReplyBadge, VisitorFields } from './_components/parts';
import { VisitButton } from './_components/visit-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reception desk' };

/** The front desk. Everyone else who opens Gate lands on what they can use. */
export default async function ReceptionDeskPage() {
  const principal = await requirePrincipal();
  if (!isDesk(principal)) redirect(seesRegister(principal) ? '/gate/register' : '/gate/my-visitors');

  const now = new Date();
  const today = istDateString(now);
  const [desk, hosts] = await Promise.all([getDesk(principal, now), listHosts(principal)]);

  return (
    <div className="space-y-lg">
      <PageHeader
        title="Reception desk"
        subtitle="Check visitors in and out. The person they are visiting is alerted on their screen and can reply."
        actions={<Link href="/gate/register" className="btn btn-secondary">Visitor register</Link>}
      />

      <div className="grid gap-base sm:grid-cols-3">
        <Stat label="Expected today" value={desk.expected.length} />
        <Stat label="Inside now" value={desk.inside.length} />
        <Stat label="Left today" value={desk.left.length} />
      </div>

      <Card title="Inside now">
        {desk.inside.length === 0 ? (
          <EmptyState title="Nobody is inside" hint="Visitors you check in show here until they leave." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Visitor</th><th>Phone</th><th>Here to see</th><th>Purpose</th><th>In at</th><th>Host reply</th><th /></tr></thead>
              <tbody>
                {desk.inside.map((v) => (
                  <tr key={v.id}>
                    <td className="font-medium text-ink">{visitorLabel(v)}</td>
                    <td className="whitespace-nowrap">{v.visitorPhone}</td>
                    <td>{v.host.fullName}</td>
                    <td>{v.purpose}</td>
                    <td className="whitespace-nowrap">{formatWhen(v.checkedInAt, now)}</td>
                    <td><ReplyBadge reply={v.hostReply} note={v.hostReplyNote} /></td>
                    <td className="text-right"><VisitButton action={checkOutAction} visitId={v.id} label="Check out" pendingLabel="Checking out…" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Expected today">
        {desk.expected.length === 0 ? (
          <EmptyState title="No more visitors expected today" hint="Visits scheduled by you or by employees show here on the day." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Time</th><th>Visitor</th><th>Phone</th><th>Here to see</th><th>Purpose</th><th /></tr></thead>
              <tbody>
                {desk.expected.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">{formatTime(v.expectedAt)}</td>
                    <td className="font-medium text-ink">{visitorLabel(v)}</td>
                    <td className="whitespace-nowrap">{v.visitorPhone}</td>
                    <td>{v.host.fullName}</td>
                    <td>{v.purpose}</td>
                    <td className="text-right whitespace-nowrap">
                      <span className="inline-flex gap-xs">
                        <VisitButton action={checkInAction} visitId={v.id} label="Check in" pendingLabel="Checking in…" variant="primary" />
                        <VisitButton action={cancelVisitAction} visitId={v.id} label="Cancel" confirm={`Cancel the visit by ${v.visitorName}? ${v.host.fullName} will be told.`} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-lg lg:grid-cols-2">
        <Card title="Walk-in visitor">
          <ActionForm action={walkInAction} resetOnSuccess className="space-y-base">
            <p className="text-body-sm text-muted">Someone who arrived without a scheduled visit. They are checked in now and the person they came to see is alerted.</p>
            <VisitorFields idPrefix="walkin" />
            <HostSelect id="walkin-host" hosts={hosts} />
            <SubmitButton variant="primary" pendingLabel="Checking in…">Check in walk-in</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Schedule a visit">
          <ActionForm action={scheduleVisitAction} resetOnSuccess className="space-y-base">
            <VisitorFields idPrefix="sched" />
            <HostSelect id="sched-host" hosts={hosts} />
            <DateTimeFields idPrefix="sched" today={today} />
            <SubmitButton pendingLabel="Scheduling…">Schedule visit</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card title="Coming up">
        {desk.upcoming.length === 0 ? (
          <EmptyState title="Nothing scheduled after today" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>Visitor</th><th>Phone</th><th>Here to see</th><th>Purpose</th><th /></tr></thead>
              <tbody>
                {desk.upcoming.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">{formatWhen(v.expectedAt, now)}</td>
                    <td className="font-medium text-ink">{visitorLabel(v)}</td>
                    <td className="whitespace-nowrap">{v.visitorPhone}</td>
                    <td>{v.host.fullName}</td>
                    <td>{v.purpose}</td>
                    <td className="text-right"><VisitButton action={cancelVisitAction} visitId={v.id} label="Cancel" confirm={`Cancel the visit by ${v.visitorName}? ${v.host.fullName} will be told.`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {desk.left.length > 0 ? (
        <Card title="Left today">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Visitor</th><th>Here to see</th><th>In</th><th>Out</th></tr></thead>
              <tbody>
                {desk.left.map((v) => (
                  <tr key={v.id}>
                    <td>{visitorLabel(v)}</td>
                    <td>{v.host.fullName}</td>
                    <td className="whitespace-nowrap">{formatTime(v.checkedInAt)}</td>
                    <td className="whitespace-nowrap">{formatTime(v.checkedOutAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
