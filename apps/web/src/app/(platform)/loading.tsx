/**
 * Platform route suspense fallback.
 *
 * Professional skeleton that mirrors the typical module layout
 * (header → KPI row → chart + side panel → table) so a route
 * transition feels like content arriving, not the app stalling.
 * Far better perceived performance than a centered spinner.
 */

function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-muted/60 ${className}`}
    >
      <div
        className="absolute inset-0 -translate-x-full"
        style={{
          background:
            'linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.06), transparent)',
          animation: 'mes-skeleton-sweep 1.4s ease-in-out infinite',
        }}
      />
    </div>
  );
}

export default function PlatformLoading() {
  return (
    <div className="h-full w-full p-6">
      {/* Local keyframes (scoped, no global CSS needed) */}
      <style>{`
        @keyframes mes-skeleton-sweep {
          100% { transform: translateX(100%); }
        }
      `}</style>

      {/* Header: title + subtitle + action button */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Shimmer className="h-7 w-56" />
          <Shimmer className="h-4 w-80" />
        </div>
        <Shimmer className="h-9 w-32 rounded-lg" />
      </div>

      {/* KPI card row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/60 bg-card p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-8 w-8 rounded-lg" />
            </div>
            <Shimmer className="mb-2 h-8 w-28" />
            <Shimmer className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Chart + side panel */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card p-5 lg:col-span-2">
          <Shimmer className="mb-4 h-5 w-40" />
          <Shimmer className="h-64 w-full rounded-lg" />
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <Shimmer className="mb-4 h-5 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Shimmer className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Shimmer className="h-3.5 w-full" />
                  <Shimmer className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <Shimmer className="mb-4 h-5 w-44" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Shimmer className="h-4 flex-[2]" />
              <Shimmer className="h-4 flex-1" />
              <Shimmer className="h-4 flex-1" />
              <Shimmer className="h-4 flex-1" />
              <Shimmer className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
