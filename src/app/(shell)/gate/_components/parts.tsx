import type { GateHostReply, GateVisitStatus } from '@prisma/client';
import { REPLY_LABEL, STATUS_LABEL } from '@/modules/gate/domain/labels';

/** Visitor name, phone, company and purpose: the same four fields on every visit form. */
export function VisitorFields({ idPrefix }: { idPrefix: string }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <>
      <div className="grid gap-base sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id('visitorName')}>Visitor name</label>
          <input id={id('visitorName')} name="visitorName" required minLength={2} maxLength={120} className="input w-full" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor={id('visitorPhone')}>Phone</label>
          <input id={id('visitorPhone')} name="visitorPhone" type="tel" required className="input w-full" placeholder="98250 12345" autoComplete="off" />
        </div>
      </div>
      <div className="grid gap-base sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id('visitorCompany')}>Company</label>
          <input id={id('visitorCompany')} name="visitorCompany" maxLength={120} className="input w-full" placeholder="Optional" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor={id('purpose')}>Purpose</label>
          <input id={id('purpose')} name="purpose" required minLength={2} maxLength={300} className="input w-full" placeholder="e.g. Panel inspection" />
        </div>
      </div>
    </>
  );
}

export function HostSelect({ id, hosts }: { id: string; hosts: Array<{ id: string; fullName: string; designation: string | null }> }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Here to see</label>
      <select id={id} name="hostId" required defaultValue="" className="select w-full">
        <option value="" disabled>Pick an employee</option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id}>{h.fullName}{h.designation ? `, ${h.designation}` : ''}</option>
        ))}
      </select>
    </div>
  );
}

export function DateTimeFields({ idPrefix, today }: { idPrefix: string; today: string }) {
  return (
    <div className="grid gap-base grid-cols-2">
      <div>
        <label className="label" htmlFor={`${idPrefix}-date`}>Date</label>
        <input id={`${idPrefix}-date`} name="date" type="date" required min={today} defaultValue={today} className="input w-full" />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-time`}>Time</label>
        <input id={`${idPrefix}-time`} name="time" type="time" required className="input w-full" />
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<GateVisitStatus, string> = {
  EXPECTED: 'badge-outline',
  CHECKED_IN: 'badge-ink',
  CHECKED_OUT: 'badge-neutral',
  CANCELLED: 'badge-neutral',
};

/** An expected visit from an earlier day reads "Did not arrive". */
export function StatusBadge({ status, missed = false }: { status: GateVisitStatus; missed?: boolean }) {
  if (missed) return <span className="badge badge-error">Did not arrive</span>;
  return <span className={`badge ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function ReplyBadge({ reply, note }: { reply: GateHostReply | null; note?: string | null }) {
  if (!reply) return <span className="text-body-sm text-muted">No reply yet</span>;
  return (
    <span className="text-body-sm">
      <span className={`badge ${reply === 'UNAVAILABLE' ? 'badge-error' : 'badge-success'}`}>{REPLY_LABEL[reply]}</span>
      {note ? <span className="ml-xs text-muted">“{note}”</span> : null}
    </span>
  );
}
