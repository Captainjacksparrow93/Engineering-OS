'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clearOrderAlertAction } from '@/app/actions/pm';

/** Plan 015: the sales order changed in ERP in a way PM won't apply on its own. */
export function OrderAlertBanner({
  projectId,
  alert,
  changedAt,
  orderName,
  orderHref,
  canClear,
}: {
  projectId: string;
  alert: string;
  changedAt: string | null;
  orderName: string | null;
  orderHref: string | null;
  canClear: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const lines = alert.split('\n').filter(Boolean);

  const markReviewed = () => {
    setError(null);
    startTransition(async () => {
      const res = await clearOrderAlertAction(projectId);
      if (res.success) router.refresh();
      else setError(res.error ?? 'Couldn’t mark it reviewed. Try again.');
    });
  };

  return (
    <section
      aria-labelledby="order-alert-title"
      className="mb-5 rounded-lg border border-warning/40 bg-warning/[0.08] p-4 text-ink"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="order-alert-title" className="font-semibold text-ink">
              Order changed: review
            </h2>
            {changedAt ? <span className="text-caption text-muted">{changedAt}</span> : null}
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-body-sm text-ink/90">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {orderHref && orderName ? (
            <a href={orderHref} target="_blank" rel="noopener" className="text-caption font-semibold text-primary hover:underline">
              Open {orderName} in ERP
            </a>
          ) : null}
          {error ? (
            <p role="alert" className="text-caption text-error">
              {error}
            </p>
          ) : null}
        </div>
        {canClear ? (
          <button type="button" onClick={markReviewed} disabled={isPending} className="btn btn-secondary text-body-sm">
            {isPending ? 'Saving…' : 'Mark reviewed'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
