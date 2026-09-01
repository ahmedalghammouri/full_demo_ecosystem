'use client';
/**
 * What the LINE scored — as opposed to what its machines did.
 *
 * ── Why this is a separate card and not a swapped headline ──────────────────
 * The machine table below it is unchanged and stays unchanged: a reader
 * comparing "the line ran at 24%" with "every machine ran above 80%" is not
 * looking at a contradiction, they are looking at the whole point. Three
 * machines idling because the fourth is down did not each have a bad day, and a
 * page that replaced the machine figures with the line figure would hide the
 * only evidence that explains it.
 *
 * So the card states the line number, names the method, and says in words which
 * machine supplied which factor — because an unexplained line OEE is exactly
 * what made this control necessary.
 */
import React from 'react';
import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Gauge, dur, pctText } from './chart-kit';

export interface LineRow {
  lineId: string;
  lineName: string;
  lineCode: string;
  method: 'ROLLUP' | 'BOTTLENECK';
  configured: 'ROLLUP' | 'BOTTLENECK';
  bottleneckName: string | null;
  outfeedNames: string[];
  outfeedResolvedBy: 'CONFIGURED' | 'ALL_MACHINES_ON_LINE';
  machineCount: number;
  fallbackReason: string | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
  weightMin: number;
}

export interface LineOee {
  applies: boolean;
  level: 'MACHINE' | 'LINE' | 'AREA' | 'FACTORY';
  requested: 'ROLLUP' | 'BOTTLENECK' | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
  lines: LineRow[];
  formula: string;
  note: string;
}

const LEVEL_TITLE: Record<LineOee['level'], string> = {
  MACHINE: 'Machine',
  LINE: 'Line performance',
  AREA: 'Area performance',
  FACTORY: 'Factory performance',
};

// 'en-US' pinned, not the runtime default: `.toLocaleString()` with no locale
// follows Node's ICU default on the server and the visitor's OWN BROWSER
// LANGUAGE on the client — a hydration text mismatch (React error #418) on
// every number this formats.
const num = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function LineOeeCard({ data, className }: { data: LineOee | null | undefined; className?: string }) {
  if (!data?.applies) return null;
  const multi = data.lines.length > 1;

  return (
    <section className={cn('rounded-lg border border-border/60 bg-card', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {LEVEL_TITLE[data.level]}
            {data.lines.length === 1 && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {data.lines[0].lineCode} · {data.lines[0].lineName}
              </span>
            )}
          </h3>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{data.formula}</p>
        </div>
        {data.lines.length === 1 && <MethodChip row={data.lines[0]} />}
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(220px,1.4fr)]">
        <Gauge label="OEE" value={data.oee} />
        <Gauge label="Availability" value={data.availability} />
        <Gauge label="Performance" value={data.performance} />
        <Gauge label="Quality" value={data.quality} />

        <div className="flex flex-col justify-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
            <span>{data.note}</span>
          </p>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <Fact k="Good" v={`${num(data.counts.good)} pc`} />
            <Fact k="Rejected" v={`${num(data.counts.rejected)} pc`} />
            <Fact k="Theoretical" v={`${num(data.counts.theoretical)} pc`} />
            <Fact k="Running" v={dur(data.time?.netProductionMin)} />
          </dl>
        </div>
      </div>

      {data.lines.some((l) => l.fallbackReason) && (
        <div className="border-t border-border/50 px-3 py-2">
          {data.lines.filter((l) => l.fallbackReason).map((l) => (
            <p key={l.lineId} className="text-[11px] text-amber-700 dark:text-amber-400">
              <b>{l.lineCode}</b> — {l.fallbackReason}
            </p>
          ))}
        </div>
      )}

      {multi && (
        <div className="overflow-x-auto border-t border-border/50">
          <table className="w-full min-w-[720px] text-xs">
            <caption className="px-3 pb-1 pt-2 text-start text-[11px] text-muted-foreground">
              Each line scored on its own method, before the average above.
            </caption>
            <thead>
              <tr className="border-b border-border/60 text-start text-[10px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 text-start font-medium">Line</th>
                <th scope="col" className="px-3 py-1.5 text-start font-medium">Method</th>
                <th scope="col" className="px-3 py-1.5 text-start font-medium">Constraint</th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">Avail.</th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">Perf.</th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">Qual.</th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">OEE</th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.lineId} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-foreground">{l.lineCode}</span>
                    <span className="block text-[10px] text-muted-foreground">{l.lineName}</span>
                  </td>
                  <td className="px-3 py-1.5"><MethodChip row={l} compact /></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{l.bottleneckName ?? '—'}</td>
                  <td className="px-3 py-1.5 text-end tabular-nums">{pctText(l.availability)}</td>
                  <td className="px-3 py-1.5 text-end tabular-nums">{pctText(l.performance)}</td>
                  <td className="px-3 py-1.5 text-end tabular-nums">{pctText(l.quality)}</td>
                  <td className="px-3 py-1.5 text-end font-medium tabular-nums">{pctText(l.oee)}</td>
                  {/* The weight behind the average, printed so it is checkable
                      rather than asserted. */}
                  <td className="px-3 py-1.5 text-end tabular-nums text-muted-foreground">{dur(l.weightMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MethodChip({ row, compact }: { row: LineRow; compact?: boolean }) {
  const overridden = row.method !== row.configured;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold',
          row.method === 'BOTTLENECK'
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-slate-500/15 text-slate-700 dark:text-slate-300')}
        title={row.method === 'BOTTLENECK'
          ? `Availability, Performance and all of the time come from ${row.bottleneckName} alone. Good and theoretical are counted at the line's last station${row.outfeedResolvedBy === 'ALL_MACHINES_ON_LINE' ? ' (no outfeed configured, so every machine is treated as one)' : ` among ${row.outfeedNames.join(' + ')}`}, and scrap at all ${row.machineCount} machines. Both in pieces.`
          : `Re-derived from the summed minutes and counts of all ${row.machineCount} machines.`}
      >
        {row.method === 'BOTTLENECK' ? 'Bottleneck' : 'Roll-up'}
      </span>
      {overridden && !compact && (
        <span className="text-[10px] text-muted-foreground"
          title={`This line is configured as ${row.configured}. The filter panel is overriding the method for this view only — the constraint and the outfeed points still come from the line.`}>
          overriding {row.configured === 'BOTTLENECK' ? 'Bottleneck' : 'Roll-up'}
        </span>
      )}
    </span>
  );
}

const Fact = ({ k, v }: { k: string; v: string }) => (
  <>
    <dt className="text-muted-foreground">{k}</dt>
    <dd className="text-end font-medium tabular-nums text-foreground">{v}</dd>
  </>
);
