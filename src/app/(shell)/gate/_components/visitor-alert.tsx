import Link from 'next/link';
import { visitorLabel } from '@/modules/gate/domain/labels';
import { formatTime } from '@/modules/gate/domain/time';
import { ReplyForm } from './reply-form';

/**
 * "Your visitor is at reception", shown on top of every page until the host answers.
 * The shell refreshes every minute, so a new arrival shows up without a reload.
 */
export function VisitorAlert({
  visits,
}: {
  visits: Array<{ id: string; visitorName: string; visitorCompany: string | null; purpose: string; checkedInAt: Date | null }>;
}) {
  if (visits.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="mb-lg space-y-sm">
      {visits.map((v) => (
        <div key={v.id} className="rounded-lg border border-primary/40 bg-primary/[0.06] px-base py-sm">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="text-body-md text-ink">
              <strong>{visitorLabel(v)}</strong> is at reception to see you
              <span className="text-muted"> · since {formatTime(v.checkedInAt)} · {v.purpose}</span>
            </p>
            <ReplyForm visitId={v.id} />
          </div>
        </div>
      ))}
      {visits.length > 1 ? (
        <p className="text-caption text-muted">
          <Link href="/gate/my-visitors" className="link-muted">See all your visitors</Link>
        </p>
      ) : null}
    </div>
  );
}
