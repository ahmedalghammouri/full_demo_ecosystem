'use client';
/**
 * The breakdown table: sortable, paginated, and the same for all three groupings.
 *
 * Sorting and paging happen in the BROWSER, not the server, and deliberately:
 * the whole breakdown already arrived in the page's single request — it is what
 * the charts above are drawn from — so a round trip per page would fetch data
 * the client is holding, and could return a page computed from a window that
 * had moved on. The count under the table is therefore always the count the
 * charts used.
 */
import React from 'react';

import { cn } from '@/lib/utils';
import { SortableHeader } from '@/components/ui/sortable-header';
import { TablePagination } from '@/components/ui/table-pagination';
import { STATUS, bandOf, dur, pctText } from '@/features/oee-analysis/chart-kit';
import type { Slice } from './breakdown-charts';

const PAGE_SIZE = 10;

type Col =
  | 'label' | 'oee' | 'availability' | 'performance' | 'quality'
  | 'slot' | 'operational' | 'net' | 'good';

const valueOf = (r: Slice, col: Col, isSchedule: boolean): number | string => {
  switch (col) {
    case 'label': return r.label.toLowerCase();
    case 'slot': return r.slotElapsedPct ?? -1;
    case 'operational': return (isSchedule ? r.time?.committedMin : r.time?.operationalMin) ?? -1;
    case 'net': return r.time?.netProductionMin ?? -1;
    case 'good': return r.counts?.good ?? -1;
    // A null factor sorts BELOW zero rather than as zero: "not measured" is not
    // "measured at nothing", and letting them share a rank hides the difference
    // the engines work hard to preserve.
    default: return r[col] ?? -1;
  }
};

/** A reading, coloured by its band, with the band never carried by colour alone. */
function Pct({ label, value, strong }: { label: string; value: number | null; strong?: boolean }) {
  const band = bandOf(label, value);
  return (
    <span
      className={cn('font-mono tabular-nums', strong && 'font-semibold')}
      style={band === 'none' ? undefined : { color: STATUS[band] }}
      title={value == null ? 'Not measured in this window' : `${label} ${value.toFixed(1)}%`}
    >
      {pctText(value)}
    </span>
  );
}

export function BreakdownTable({
  rows, isSchedule, nameHeader,
}: { rows: Slice[]; isSchedule: boolean; nameHeader: string }) {
  const [sortCol, setSortCol] = React.useState<Col>('oee');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [page, setPage] = React.useState(1);

  const onSort = (col: string) => {
    const c = col as Col;
    if (c === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(c); setSortDir(c === 'label' ? 'asc' : 'asc'); }
    setPage(1);
  };

  const sorted = React.useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = valueOf(a, sortCol, isSchedule);
      const y = valueOf(b, sortCol, isSchedule);
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * dir;
      return (x - y) * dir;
    });
  }, [rows, sortCol, sortDir, isSchedule]);

  // A filter or a narrower window can leave fewer pages than the one being
  // viewed; without this the table would render empty and look broken.
  const lastPage = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, lastPage);
  const slice = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const head = (column: Col, label: string, className?: string) => (
    <SortableHeader
      column={column} label={label} sortCol={sortCol} sortDir={sortDir}
      onSort={onSort} className={className}
    />
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border/60 bg-card px-4 py-6 text-center text-xs text-muted-foreground">
        Nothing in this window matches the current scope and filters.
      </p>
    );
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs text-muted-foreground">
              {head('label', nameHeader, 'text-start ps-4')}
              {head('oee', 'OEE', 'text-end')}
              {head('availability', 'A', 'text-end')}
              {head('performance', 'P', 'text-end')}
              {head('quality', 'Q', 'text-end')}
              {isSchedule && head('slot', 'Slot', 'text-end')}
              {head('operational', isSchedule ? 'Committed' : 'Operational', 'text-end')}
              {head('net', 'Net production', 'text-end')}
              {head('good', 'Good / total', 'text-end pe-4')}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.key} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2">
                  <div className="font-medium text-foreground">{r.label}</div>
                  {r.sublabel && <div className="text-xs text-muted-foreground">{r.sublabel}</div>}
                </td>
                <td className="px-3 py-2 text-end"><Pct label="OEE" value={r.oee} strong /></td>
                <td className="px-3 py-2 text-end"><Pct label="Availability" value={r.availability} /></td>
                <td className="px-3 py-2 text-end"><Pct label="Performance" value={r.performance} /></td>
                <td className="px-3 py-2 text-end"><Pct label="Quality" value={r.quality} /></td>
                {isSchedule && (
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                    {pctText(r.slotElapsedPct ?? null)}
                  </td>
                )}
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                  {dur(isSchedule ? r.time?.committedMin : r.time?.operationalMin)}
                </td>
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                  {dur(r.time?.netProductionMin)}
                </td>
                <td className="px-4 py-2 text-end font-mono tabular-nums">
                  {/* 'en-US' pinned — see chart-kit's num() for why a bare
                      toLocaleString() here is a hydration mismatch (#418). */}
                  <span className="text-foreground">{Math.round(r.counts?.good ?? 0).toLocaleString('en-US')}</span>
                  <span className="text-muted-foreground"> / {Math.round(r.counts?.total ?? 0).toLocaleString('en-US')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE_SIZE && (
        <TablePagination
          page={current} total={sorted.length} limit={PAGE_SIZE}
          onPageChange={setPage} className="border-t border-border/60 px-3 py-2"
        />
      )}
    </section>
  );
}
