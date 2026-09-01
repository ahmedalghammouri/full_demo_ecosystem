'use client';

/**
 * Power Quality.
 *
 * The centrepiece is the ITIC/CBEMA plot, because it is the one view that turns
 * a list of voltage dips into an engineering finding: the same 70% residual is
 * a non-event at 20 ms and a stoppage at two seconds, and only the curve says
 * which. Everything else on the page supports reading that plot — what happened,
 * where, and whether it cost product.
 *
 * The page is reachable only for a factory whose classification grants
 * POWER_QUALITY. The API refuses otherwise, and that refusal is rendered as an
 * explanation rather than an empty chart.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, BarChart, Bar, Cell, Legend,
} from 'recharts';
import { AlertTriangle, Zap, TrendingDown, ShieldAlert, Ban } from 'lucide-react';
import { api } from '@/services/api.client';
import { useFactoryStore } from '@/store/factory-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';

// ── Types ───────────────────────────────────────────────────────────────────

interface PqSummary {
  periodDays: number;
  total: number;
  previousTotal: number;
  changePct: number | null;
  withScrap: number;
  byType: { type: string; count: number }[];
  bySeverity: { severity: string; count: number }[];
  byZone: { zone: string; count: number }[];
  byMeter: { meterId: string; meterNumber: string; name: string; count: number }[];
  worstSag: { magnitudePct: number; durationMs: number; startedAt: string; meter: string | null } | null;
}

interface IticPoint {
  id: string;
  type: string;
  severity: string;
  iticZone: string | null;
  magnitudePct: number;
  durationMs: number;
  startedAt: string;
  causedScrap: boolean;
  meter: { meterNumber: string; name: string } | null;
}

// ── Encoding ────────────────────────────────────────────────────────────────
//
// The three ITIC zones are a status scale, not a categorical palette: they are
// ordered, and they always ship with their label. Shape carries the same
// distinction as colour so the plot survives a colour-blind reader and a
// black-and-white print, which is how these reports are usually circulated.

const ZONE = {
  NO_INTERRUPTION: { label: 'Ride-through', colour: 'var(--pq-ok)', shape: 'circle' as const },
  NO_DAMAGE: { label: 'No damage', colour: 'var(--pq-warn)', shape: 'triangle' as const },
  PROHIBITED: { label: 'Prohibited', colour: 'var(--pq-crit)', shape: 'diamond' as const },
};

const TYPE_LABEL: Record<string, string> = {
  SAG: 'Voltage sag',
  SWELL: 'Voltage swell',
  INTERRUPTION: 'Interruption',
  TRANSIENT: 'Transient',
  HARMONIC_EXCURSION: 'Harmonic excursion',
  UNBALANCE: 'Unbalance',
  FREQUENCY_DEVIATION: 'Frequency deviation',
  FLICKER: 'Flicker',
};

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

// ── KPI tile ────────────────────────────────────────────────────────────────

function Tile({
  label, value, unit, hint, tone = 'default', icon: Icon,
}: {
  label: string; value: React.ReactNode; unit?: string; hint?: string;
  tone?: 'default' | 'warn' | 'crit' | 'good'; icon?: React.ElementType;
}) {
  const toneClass =
    tone === 'crit' ? 'text-destructive'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {Icon ? <Icon size={13} /> : null}
          {label}
        </div>
        <div className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${toneClass}`}>
          {value}
          {unit ? <span className="ms-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
        </div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function PowerQualityView() {
  const { selectedFactory } = useFactoryStore();
  const [days, setDays] = React.useState(30);
  const factoryId = selectedFactory?.id;

  const summaryQ = useQuery({
    queryKey: ['pq-summary', factoryId, days],
    queryFn: () => api.get<PqSummary>('/power-quality/summary', { params: { days, factoryId } }),
    enabled: !!factoryId,
    retry: false,
  });

  const iticQ = useQuery({
    queryKey: ['pq-itic', factoryId, days],
    queryFn: () => api.get<{ periodDays: number; points: IticPoint[] }>('/power-quality/itic', {
      params: { days, factoryId },
    }),
    enabled: !!factoryId,
    retry: false,
  });

  // No factory in scope. The queries are disabled, so without this the page
  // would render its full furniture around an empty chart — which reads as
  // "no events here" when the truth is "you have not said where to look".
  if (!factoryId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Zap className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">Choose a factory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Power quality is measured per site. Pick a factory from the map to see its voltage
          events, harmonics and compliance record.
        </p>
      </div>
    );
  }

  // A 403 here is not a failure — it is the platform correctly saying this
  // factory has no power-quality metering. Say so, rather than drawing an empty
  // chart that reads as "nothing wrong here".
  const denied = (summaryQ.error as { response?: { status?: number; data?: { message?: string } } } | null)
    ?.response?.status === 403;
  if (denied) {
    const msg = (summaryQ.error as { response?: { data?: { message?: string } } }).response?.data?.message;
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Ban className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">Power quality is not part of this site</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {msg ?? 'This factory’s classification does not include power-quality metering.'}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Switch to a site classified as a continuous process to see harmonics, voltage events and
          the compliance record.
        </p>
      </div>
    );
  }

  const s = summaryQ.data;
  const points = iticQ.data?.points ?? [];

  const byZone = React.useMemo(() => {
    const g: Record<string, IticPoint[]> = { NO_INTERRUPTION: [], NO_DAMAGE: [], PROHIBITED: [] };
    for (const p of points) if (p.iticZone && g[p.iticZone]) g[p.iticZone].push(p);
    return g;
  }, [points]);

  const outsideRideThrough = points.filter((p) => p.iticZone && p.iticZone !== 'NO_INTERRUPTION').length;

  return (
    <PageShell loading={summaryQ.isLoading} kpiCount={4} showChart showTable>
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Power Quality</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Voltage events judged against the ITIC ride-through envelope
            {selectedFactory ? ` · ${selectedFactory.name}` : ''}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {d} d
            </button>
          ))}
        </div>
      </div>

      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 px-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Events" icon={Zap}
          value={s?.total ?? '—'}
          hint={
            s?.changePct == null
              ? 'no comparable previous period'
              : `${s.changePct > 0 ? '+' : ''}${s.changePct}% vs previous ${days} d`
          }
          tone={s && s.changePct != null && s.changePct > 0 ? 'warn' : 'default'}
        />
        <Tile
          label="Outside ride-through" icon={ShieldAlert}
          value={outsideRideThrough}
          hint="equipment was not obliged to survive these"
          tone={outsideRideThrough > 0 ? 'warn' : 'good'}
        />
        <Tile
          label="Linked to scrap" icon={AlertTriangle}
          value={s?.withScrap ?? '—'}
          hint="event coincided with a running line"
          tone={s && s.withScrap > 0 ? 'crit' : 'good'}
        />
        <Tile
          label="Deepest sag" icon={TrendingDown}
          value={s?.worstSag ? `${s.worstSag.magnitudePct}` : '—'}
          unit={s?.worstSag ? '% Un' : undefined}
          hint={s?.worstSag ? `${fmtDuration(s.worstSag.durationMs)} · ${s.worstSag.meter ?? ''}` : undefined}
          tone={s?.worstSag && s.worstSag.magnitudePct < 70 ? 'crit' : 'warn'}
        />
      </div>

      {/* ── ITIC ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ITIC / CBEMA ride-through</CardTitle>
            <CardDescription>
              Residual voltage against duration. A point inside the ride-through band is one every
              piece of equipment is expected to survive; outside it, a trip is legitimate. Duration
              is logarithmic — that is what makes a 20 ms dip and a 2 s dip comparable on one plot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/*
              The x axis is logarithmic, and a log scale handed an empty dataset
              computes log(0) and throws — which is exactly the state this page
              is in for the first render of every visit, and permanently for a
              factory whose API call is about to come back 403. Render the plot
              only once there is something to plot.
            */}
            {points.length === 0 ? (
              <div className="flex h-[380px] items-center justify-center text-sm text-muted-foreground">
                {iticQ.isLoading
                  ? 'Loading voltage events…'
                  : 'No voltage events recorded in this window.'}
              </div>
            ) : (
            <div className="h-[380px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 8 }}>
                  {/* The envelope, drawn as bands rather than as a fitted curve:
                      the boundary is what matters, and a band reads at a glance. */}
                  <ReferenceArea x1={20} x2={500} y1={80} y2={110} fill="var(--pq-ok)" fillOpacity={0.07} />
                  <ReferenceArea x1={500} x2={60000} y1={90} y2={110} fill="var(--pq-ok)" fillOpacity={0.07} />
                  <ReferenceLine y={90} stroke="var(--pq-warn)" strokeDasharray="4 3"
                    label={{ value: '90% — sag threshold', position: 'insideTopRight', fontSize: 10 }} />
                  <ReferenceLine y={110} stroke="var(--pq-warn)" strokeDasharray="4 3"
                    label={{ value: '110% — swell threshold', position: 'insideBottomRight', fontSize: 10 }} />
                  <CartesianGrid strokeDasharray="2 4" opacity={0.25} />
                  <XAxis
                    type="number" dataKey="durationMs" scale="log" domain={[10, 60000]}
                    ticks={[10, 100, 1000, 10000, 60000]}
                    tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}s` : `${v}ms`)}
                    tick={{ fontSize: 11 }}
                    label={{ value: 'Duration', position: 'insideBottom', offset: -16, fontSize: 11 }}
                  />
                  <YAxis
                    type="number" dataKey="magnitudePct" domain={[0, 140]}
                    tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`}
                    label={{ value: '% of nominal', angle: -90, position: 'insideLeft', fontSize: 11 }}
                  />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as IticPoint;
                      const z = p.iticZone ? ZONE[p.iticZone as keyof typeof ZONE] : null;
                      return (
                        <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                          <div className="font-medium">{TYPE_LABEL[p.type] ?? p.type}</div>
                          <div className="mt-1 font-mono tabular-nums">
                            {p.magnitudePct}% Un · {fmtDuration(p.durationMs)}
                          </div>
                          <div className="mt-1 text-muted-foreground">{p.meter?.name ?? '—'}</div>
                          {z ? <div className="mt-1">{z.label}</div> : null}
                          {p.causedScrap ? (
                            <div className="mt-1 text-destructive">coincided with a running line</div>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="top" height={28}
                    formatter={(v: string) => <span className="text-xs">{v}</span>}
                  />
                  {(Object.keys(ZONE) as (keyof typeof ZONE)[]).map((z) => (
                    <Scatter
                      key={z}
                      name={ZONE[z].label}
                      data={byZone[z]}
                      fill={ZONE[z].colour}
                      shape={ZONE[z].shape}
                      fillOpacity={0.85}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Where and what ───────────────────────────────────────────────── */}
      <div className="grid gap-4 px-6 py-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Events by board</CardTitle>
            <CardDescription>Where to look first.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s?.byMeter ?? []} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="2 4" opacity={0.25} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="meterNumber" width={96} tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as { name: string; count: number };
                      return (
                        <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                          <div className="font-medium">{p.name}</div>
                          <div className="mt-1 font-mono tabular-nums">{p.count} events</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="var(--pq-warn)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Composition</CardTitle>
            <CardDescription>
              Sags dominate any real survey; interruptions are rare and expensive.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {(s?.byType ?? []).map((t) => (
                <div key={t.type} className="flex items-center justify-between py-2.5">
                  <dt className="text-sm">{TYPE_LABEL[t.type] ?? t.type}</dt>
                  <dd className="font-mono text-sm tabular-nums">{t.count}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              {(s?.byZone ?? []).map((z) => {
                const meta = ZONE[z.zone as keyof typeof ZONE];
                return (
                  <Badge key={z.zone} variant="outline" className="gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: meta?.colour }}
                    />
                    {meta?.label ?? z.zone}
                    <span className="font-mono tabular-nums">{z.count}</span>
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
