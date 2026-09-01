'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/* ── KPI skeleton row ─────────────────────────────────── */
function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid gap-4 grid-cols-2 lg:grid-cols-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl bg-muted/30 h-28 shimmer" />
      ))}
    </div>
  );
}

/* ── Table skeleton ──────────────────────────────────── */
function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-border/30 overflow-hidden">
      <div className="h-11 bg-muted/40 border-b border-border/20" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-border/10 last:border-0">
          <div className="h-4 w-4 rounded-full bg-muted/40 shrink-0 mt-0.5 shimmer" />
          <div className="flex-1 h-4 rounded bg-muted/35 shimmer" />
          <div className="h-4 w-20 rounded bg-muted/25 shimmer" />
          <div className="h-4 w-16 rounded bg-muted/20 shimmer" />
        </div>
      ))}
    </div>
  );
}

/* ── Chart skeleton ──────────────────────────────────── */
function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl bg-muted/30 shimmer', className)} />
  );
}

/* ── Full page loading skeleton ──────────────────────── */
export function PageSkeleton({
  kpiCount = 4,
  showChart = true,
  showTable = true,
}: {
  kpiCount?: number;
  showChart?: boolean;
  showTable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 p-5 h-full">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-40 rounded-lg bg-muted/35 shimmer" />
          <div className="h-3.5 w-64 rounded bg-muted/25 shimmer" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-lg bg-muted/30 shimmer" />
          <div className="h-9 w-28 rounded-lg bg-muted/30 shimmer" />
        </div>
      </div>

      {/* KPI cards */}
      <KpiSkeleton count={kpiCount} />

      {/* Chart */}
      {showChart && <ChartSkeleton className="h-56" />}

      {/* Table */}
      {showTable && <TableSkeleton />}
    </div>
  );
}

/* ── PageShell — wraps a view, shows skeleton while loading ─ */
export function PageShell({
  children,
  loading,
  kpiCount,
  showChart,
  showTable,
  className,
}: {
  children: React.ReactNode;
  loading?: boolean;
  kpiCount?: number;
  showChart?: boolean;
  showTable?: boolean;
  className?: string;
}) {
  if (loading) {
    return <PageSkeleton kpiCount={kpiCount} showChart={showChart} showTable={showTable} />;
  }

  return (
    <div
      className={cn('h-full', className)}
      style={{ animation: 'mes-fade-up 0.25s ease forwards' }}
    >
      {children}
    </div>
  );
}
