'use client';

/**
 * Harmonics.
 *
 * Two standards, because they answer different questions and are routinely
 * confused: **EN 50160** bounds the voltage the utility delivers, **IEEE 519**
 * bounds the current the installation draws. A site can comply with one and
 * breach the other, and which one it breaches decides whose problem it is.
 *
 * The second thing this screen exists to make visible: IEEE 519 limits **TDD**,
 * referenced to maximum demand, not THD referenced to the present fundamental.
 * A lightly loaded feeder can show an alarming current THD and remain
 * compliant, which is why the ranking shows both and judges on the right one.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, LineChart, Line, Legend, Cell,
} from 'recharts';
import { Activity, Ban, TrendingUp, Zap } from 'lucide-react';
import { api } from '@/services/api.client';
import { useFactoryStore } from '@/store/factory-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';

interface RankRow {
  meterId: string; meterNumber: string; name: string;
  vThd: number; iThd: number; tdd: number; samples: number;
  voltagePass: boolean; currentPass: boolean;
}
interface Order { order: number; voltagePct: number; currentPct: number; voltageLimit: number | null }
interface Spectrum {
  meterId: string;
  at?: string;
  phases: { phase: string; vThd: number; iThd: number; tdd: number | null; orders: Order[] }[];
  trend: { hour: string; vThd: number; iThd: number }[];
  limits: Record<string, number>;
}

const EN50160_THD_LIMIT = 8;   // voltage THD, % — the figure the standard caps
const IEEE519_TDD_LIMIT = 15;  // current TDD, % — for this class of installation

export function HarmonicsView() {
  const { selectedFactory } = useFactoryStore();
  const factoryId = selectedFactory?.id;
  const [meterId, setMeterId] = React.useState<string | null>(null);

  const rankQ = useQuery({
    queryKey: ['harm-rank', factoryId],
    queryFn: () => api.get<RankRow[]>('/power-quality/harmonics/ranking', { params: { factoryId } }),
    enabled: !!factoryId,
    retry: false,
  });

  // Default to the worst offender: the first thing an engineer opens is the
  // board that is failing, not the first one alphabetically.
  const rows = React.useMemo(() => rankQ.data ?? [], [rankQ.data]);
  const activeMeter = meterId ?? rows[0]?.meterId ?? null;

  const specQ = useQuery({
    queryKey: ['harm-spectrum', factoryId, activeMeter],
    queryFn: () => api.get<Spectrum>(`/power-quality/harmonics/${activeMeter}`, { params: { factoryId } }),
    enabled: !!factoryId && !!activeMeter,
    retry: false,
  });

  const spec = specQ.data;
  const phaseA = spec?.phases?.[0];

  const spectrumData = React.useMemo(
    () =>
      (phaseA?.orders ?? []).map((o) => ({
        order: `H${o.order}`,
        voltage: o.voltagePct,
        current: o.currentPct,
        limit: o.voltageLimit,
        over: o.voltageLimit != null && o.voltagePct > o.voltageLimit,
      })),
    [phaseA],
  );

  const worst = rows[0];
  const anyFail = rows.some((r) => !r.voltagePass || !r.currentPass);

  if (!factoryId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Activity className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">Choose a factory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Harmonics are measured per board. Pick a factory from the map.
        </p>
      </div>
    );
  }

  const denied = (rankQ.error as { response?: { status?: number; data?: { message?: string } } } | null)
    ?.response?.status === 403;
  if (denied) {
    const msg = (rankQ.error as { response?: { data?: { message?: string } } }).response?.data?.message;
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Ban className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">No harmonic metering at this site</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {msg ?? 'This factory’s classification does not include power-quality metering.'}
        </p>
      </div>
    );
  }

  return (
    <PageShell loading={rankQ.isLoading} kpiCount={4} showChart showTable>
      <div className="px-6 pt-6">
        <h1 className="text-xl font-semibold tracking-tight">Harmonics</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Voltage distortion against EN 50160, current distortion against IEEE 519
          {selectedFactory ? ` · ${selectedFactory.name}` : ''}
        </p>
      </div>

      <div className="grid gap-4 px-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Boards measured" value={rows.length} icon={Zap} />
        <Tile
          label="Worst voltage THD" icon={TrendingUp}
          value={worst ? `${worst.vThd}%` : '—'}
          hint={worst ? `${worst.meterNumber} · limit ${EN50160_THD_LIMIT}%` : undefined}
          tone={worst && worst.vThd > EN50160_THD_LIMIT ? 'crit' : 'good'}
        />
        <Tile
          label="Worst current TDD" icon={TrendingUp}
          value={worst ? `${worst.tdd}%` : '—'}
          hint={worst ? `limit ${IEEE519_TDD_LIMIT}%` : undefined}
          tone={worst && worst.tdd > IEEE519_TDD_LIMIT ? 'crit' : 'good'}
        />
        <Tile
          label="Compliance" value={anyFail ? 'Breach' : 'Within limits'}
          hint={anyFail ? 'at least one board is over' : 'every board inside both standards'}
          tone={anyFail ? 'crit' : 'good'}
        />
      </div>

      {/* ── Ranking ──────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Boards by distortion</CardTitle>
            <CardDescription>
              THD is referenced to the present fundamental; TDD to maximum demand. A lightly loaded
              feeder can show an alarming THD and still comply, which is why IEEE 519 is judged on
              TDD. Select a board to see its spectrum.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pe-4 font-medium">Board</th>
                    <th className="pb-2 pe-4 text-right font-medium">V THD</th>
                    <th className="pb-2 pe-4 text-right font-medium">I THD</th>
                    <th className="pb-2 pe-4 text-right font-medium">TDD</th>
                    <th className="pb-2 pe-4 font-medium">EN 50160</th>
                    <th className="pb-2 font-medium">IEEE 519</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.meterId}
                      onClick={() => setMeterId(r.meterId)}
                      className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/40 ${
                        r.meterId === activeMeter ? 'bg-accent/60' : ''
                      }`}
                    >
                      <td className="py-2.5 pe-4">
                        <div className="font-mono text-xs text-muted-foreground">{r.meterNumber}</div>
                        <div>{r.name}</div>
                      </td>
                      <td className="py-2.5 pe-4 text-right font-mono tabular-nums">{r.vThd}%</td>
                      <td className="py-2.5 pe-4 text-right font-mono tabular-nums">{r.iThd}%</td>
                      <td className="py-2.5 pe-4 text-right font-mono tabular-nums">{r.tdd}%</td>
                      <td className="py-2.5 pe-4">
                        <Verdict pass={r.voltagePass} />
                      </td>
                      <td className="py-2.5">
                        <Verdict pass={r.currentPass} />
                      </td>
                    </tr>
                  ))}
                  {!rows.length && !rankQ.isLoading ? (
                    <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No harmonic measurements.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Spectrum ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 px-6 py-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Spectrum {phaseA ? `· phase ${phaseA.phase}` : ''}
            </CardTitle>
            <CardDescription>
              Voltage harmonics H2–H25 against their individual EN 50160 limits. Odd non-triplen
              orders dominate because six-pulse drives are what sits on these boards; a bar over its
              limit is drawn in the alert colour and labelled below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {spectrumData.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                {specQ.isLoading ? 'Loading spectrum…' : 'Select a board.'}
              </div>
            ) : (
              <>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={spectrumData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" opacity={0.25} vertical={false} />
                      <XAxis dataKey="order" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={44} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as typeof spectrumData[number];
                          return (
                            <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                              <div className="font-medium">{p.order}</div>
                              <div className="mt-1 font-mono tabular-nums">voltage {p.voltage}%</div>
                              <div className="font-mono tabular-nums">current {p.current}%</div>
                              {p.limit != null ? (
                                <div className="mt-1 text-muted-foreground">limit {p.limit}%</div>
                              ) : null}
                              {p.over ? <div className="mt-1 text-destructive">over limit</div> : null}
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="voltage" radius={[3, 3, 0, 0]}>
                        {spectrumData.map((d) => (
                          <Cell key={d.order} fill={d.over ? 'var(--pq-crit)' : 'var(--pq-ok)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <i className="inline-block h-2 w-3 rounded-sm" style={{ background: 'var(--pq-ok)' }} />
                    within its EN 50160 limit
                  </span>
                  <span className="flex items-center gap-1.5">
                    <i className="inline-block h-2 w-3 rounded-sm" style={{ background: 'var(--pq-crit)' }} />
                    over its limit
                  </span>
                  {spectrumData.some((d) => d.over) ? null : (
                    <span>no individual order is over its limit</span>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distortion over the last week</CardTitle>
            <CardDescription>
              Hourly means. Current THD rises at part load — the harmonic current a drive injects is
              roughly constant while the fundamental falls — which is the opposite of what most
              people expect and why a survey taken at full load understates it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(spec?.trend?.length ?? 0) === 0 ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                {specQ.isLoading ? 'Loading trend…' : 'No trend for this board.'}
              </div>
            ) : (
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={spec!.trend} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" opacity={0.25} />
                    <XAxis
                      dataKey="hour" tick={{ fontSize: 10 }}
                      tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                      minTickGap={40}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      labelFormatter={(v) => new Date(v as string).toLocaleString()}
                      formatter={(v: number, n: string) => [`${Number(v).toFixed(2)}%`, n === 'vThd' ? 'Voltage THD' : 'Current THD']}
                    />
                    <ReferenceLine y={EN50160_THD_LIMIT} stroke="var(--pq-crit)" strokeDasharray="4 3"
                      label={{ value: `EN 50160 ${EN50160_THD_LIMIT}%`, position: 'insideTopRight', fontSize: 10 }} />
                    <Legend formatter={(v: string) => <span className="text-xs">{v === 'vThd' ? 'Voltage THD' : 'Current THD'}</span>} />
                    <Line type="monotone" dataKey="vThd" stroke="var(--pq-ok)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="iThd" stroke="var(--pq-warn)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function Verdict({ pass }: { pass: boolean }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: pass ? 'var(--pq-ok)' : 'var(--pq-crit)' }}
      />
      {pass ? 'Within' : 'Over'}
    </Badge>
  );
}

function Tile({ label, value, hint, tone = 'default', icon: Icon }: {
  label: string; value: React.ReactNode; hint?: string;
  tone?: 'default' | 'crit' | 'good'; icon?: React.ElementType;
}) {
  const cls = tone === 'crit' ? 'text-destructive'
    : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {Icon ? <Icon size={13} /> : null}
          {label}
        </div>
        <div className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${cls}`}>{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
