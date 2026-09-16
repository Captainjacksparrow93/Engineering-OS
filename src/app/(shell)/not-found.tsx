import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="w-full max-w-md rounded-xl border border-hairline bg-surface p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-pill border border-hairline bg-surface-strong text-muted text-title-sm font-medium">
          404
        </div>
        <h2 className="text-title-md font-medium text-ink">Page not found</h2>
        <p className="mt-2 text-body-sm text-muted">
          You don&apos;t have access to this page, or it no longer exists.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/pm/my-work"
            className="btn btn-primary px-4 py-2 text-body-sm font-medium"
          >
            Go to My work
          </Link>
          <Link
            href="/dashboard"
            className="btn btn-secondary px-4 py-2 text-body-sm font-medium"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
