'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unexpected errors securely in the browser console
    console.error('Unhandled page error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="w-full max-w-md rounded-xl border border-hairline bg-surface p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-pill border border-error/30 bg-error/[0.08] text-error font-medium">
          !
        </div>
        <h2 className="text-title-md font-medium text-ink">Something went wrong</h2>
        <p className="mt-2 text-body-sm text-muted">
          We encountered an unexpected error while loading this page. Please try again.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="btn btn-primary px-4 py-2 text-body-sm font-medium"
          >
            Try again
          </button>
          <Link
            href="/pm/my-work"
            className="btn btn-secondary px-4 py-2 text-body-sm font-medium"
          >
            Go to My work
          </Link>
        </div>
      </div>
    </div>
  );
}
