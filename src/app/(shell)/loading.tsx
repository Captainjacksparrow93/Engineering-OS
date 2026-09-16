export default function Loading() {
  return (
    <div className="w-full animate-pulse">
      {/* Header skeleton */}
      <div className="mb-xl flex flex-wrap items-start justify-between gap-base">
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-surface-strong" />
          <div className="h-7 w-48 rounded bg-surface-strong" />
          <div className="h-4 w-72 rounded bg-surface-strong" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 rounded-md bg-surface-strong" />
        </div>
      </div>

      {/* Stat cards skeleton */}
      <div className="mb-xl grid grid-cols-2 gap-base sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-hairline bg-surface p-4 space-y-3"
          >
            <div className="h-3 w-20 rounded bg-surface-strong" />
            <div className="h-6 w-12 rounded bg-surface-strong" />
          </div>
        ))}
      </div>

      {/* Main card skeleton */}
      <div className="rounded-xl border border-hairline bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="h-5 w-36 rounded bg-surface-strong" />
          <div className="h-4 w-24 rounded bg-surface-strong" />
        </div>
        <div className="space-y-3 pt-2">
          {[1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 border-b border-hairline-soft py-3 last:border-0"
            >
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded bg-surface-strong" />
                <div className="h-4 w-44 rounded bg-surface-strong" />
              </div>
              <div className="h-4 w-20 rounded bg-surface-strong" />
              <div className="h-6 w-16 rounded-pill bg-surface-strong" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
