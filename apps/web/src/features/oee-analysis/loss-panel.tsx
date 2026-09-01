'use client';
/**
 * The Loss overview: TEEP, its trend, and where every minute of the clock went.
 *
 * This is the one page that reads top to bottom rather than by picking a card.
 * The waterfall is the argument — each level is the one above it minus a loss —
 * and TEEP is the number at the end of it. Putting the gauge above the model
 * rather than beside it keeps that order: the reading, then why it is what it is.
 */
import React from 'react';

import { Gauge, TimeModel, dur, pctText, type TimeModelBar, TrendChart } from './chart-kit';
import { bucketLabels } from '@/lib/datetime';

export interface LossTrendPoint { at: string; teep: number | null }

// The axis label is not a fixed HH:mm any more. `trend()` buckets by hour or
// day, so on a multi-day window every bucket is midnight and every tick on
// the axis read `00:00`. `bucketLabels` picks the format from the bucket
// spacing, and formats in FACTORY time -- the old copy called getHours(),
// which is the browser's clock, three hours out for anyone not in +03.

export function LossPanel({
  teep, oee, utilization, trend, bars, labels, machineCount, topMin,
}: {
  teep: number | null;
  oee: number | null;
  utilization: number | null;
  trend: LossTrendPoint[];
  bars: TimeModelBar[];
  labels: Record<string, string>;
  machineCount: number;
  topMin: number;
}) {
  // `tickLabels`, not `labels`: this component already takes a `labels` prop
  // (the time-model bar names), and shadowing it here would have silently
  // relabelled the bars with timestamps.
  const tickLabels = bucketLabels(trend.map((p) => p.at));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <Gauge label="TEEP" value={teep} />
        <section className="rounded-lg border border-border/60 bg-card p-4">
          {/* One series, so no legend box — the heading names it. */}
          <h2 className="mb-1 text-sm font-semibold">TEEP over time</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            OEE carried the rest of the way to the calendar. It is always the smaller number, and
            the gap between the two is capacity the plant already owns and is not using.
          </p>
          {trend.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
          ) : (
            <TrendChart
              data={trend.map((p, i) => ({ at: p.at, t: tickLabels[i], teep: p.teep }))}
              height={220}
              series={[{ key: 'teep', name: 'TEEP', colour: 'var(--viz-7)', emphasis: true }]}
              exportName="teep"
            />
          )}
        </section>
      </div>

      {/* The three numbers the waterfall reconciles, named before it is read. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="OEE" value={pctText(oee)} note="used ÷ operational time" />
        <Stat label="Utilization" value={pctText(utilization)} note="operational ÷ total time" />
        <Stat label="TEEP" value={pctText(teep)} note="OEE × utilization" />
      </div>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">
          Time model overview{machineCount > 1 ? ' — machine-minutes' : ''}
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Every bar is a share of the top level. Each grey level is the one above it minus the amber
          losses between them, and the green bar at the bottom is what survived — that ratio is TEEP.
          {machineCount > 1 && (
            <> Summed over <b>{machineCount} machines</b>, so the top bar is machine-minutes:{' '}
              <span className="font-mono tabular-nums">{dur(topMin / machineCount)}</span> per machine.</>
          )}
        </p>
        <TimeModel bars={bars} labels={labels} />
      </section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-card p-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{note}</span>
    </div>
  );
}
