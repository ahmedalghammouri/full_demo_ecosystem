'use client';

/**
 * Power Factor.
 *
 * The page exists to correct one expensive misconception. Everyone quotes the
 * reactive-energy surcharge, because it is the line item with "kVArh" written
 * next to it. But the capacity charge is billed on **apparent** power, so a poor
 * power factor inflates it directly — and on most industrial sites that is by
 * far the larger cost. A business case built only on the surcharge understates
 * the return several times over, which is why the split is the headline here
 * rather than a footnote.
 *
 * The second thing it shows is why the compensation that is already installed
 * is not working: a bank with no detuning reactor draws harmonic current on top
 * of its own and runs above nameplate until it fails.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';
import { Gauge, Ban, TrendingDown, Wallet, AlertTriangle } from 'lucide-react';
import { api } from '@/services/api.client';
import { useFactoryStore } from '@/store/factory-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';

interface MeterRow {
  meterId: string; meterNumber: string; name: string;
  avgPf: number; minPf: number; kwh: number; kvarh: number;
  peakKw: number; billedKva: number; compliant: boolean;
  cost: { reactiveSurcharge: number; capacityPenalty: number };
}
interface Step { stepNo: number; kvar: number; state: string; currentA: number | null; healthPct: number }
interface Bank {
  id: string; code: string; name: string; totalKvar: number; stepCount: number;
  detunedFilter: boolean; ratedStepCurrent: number | null; measuredStepCurrent: number | null;
  currentOverloadPct: number | null; healthIndex: number; verdict: string; steps: Step[];
}
interface Overview {
  periodDays: number;
  tariff: { currency: string; pfThreshold: number; capacityPerKvaMonth: number; reactivePerKvarh: number; note: string };
  meters: MeterRow[];
  worst: MeterRow | null;
  exposure: { reactiveSurcharge: number; capacityPenalty: number; total: number; capacityShareOfTotal: number | null };
  trend: { day: string; pf: number; kvar: number }[];
  banks: Bank[];
}
interface Sizing {
  target: number; formula: string;
  assumptions: { capexPerKvar: number; note: string };
  perMeter: { meterNumber: string; name: string; currentPf: number; kvarNeeded: number; recommendedBankKvar: number; annualSaving: number }[];
  totalKvar: number; capex: number; annualSaving: number; paybackYears: number | null;
}

const money = (n: number, cur = 'SAR') =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${cur}`;

const VERDICT: Record<string, { label: string; cls: string }> = {
  OK:         { label: 'Healthy',    cls: 'var(--pq-ok)' },
  OVERLOADED: { label: 'Overloaded', cls: 'var(--pq-warn)' },
  FAILED:     { label: 'Failed',     cls: 'var(--pq-crit)' },
};

export function PowerFactorView() {
  const { selectedFactory } = useFactoryStore();
  const factoryId = selectedFactory?.id;

  const ovQ = useQuery({
    queryKey: ['pf-overview', factoryId],
    queryFn: () => api.get<Overview>('/power-quality/power-factor/overview', { params: { factoryId, days: 14 } }),
    enabled: !!factoryId, retry: false,
  });
  const sizeQ = useQuery({
    queryKey: ['pf-sizing', factoryId],
    queryFn: () => api.get<Sizing>('/power-quality/power-factor/sizing', { params: { factoryId, days: 14 } }),
    enabled: !!factoryId, retry: false,
  });

  const o = ovQ.data;
  const s = sizeQ.data;
  const cur = o?.tariff.currency ?? 'SAR';

  const costSplit = React.useMemo(
    () =>
      o
        ? [
            { name: 'Capacity charge', value: o.exposure.capacityPenalty, key: 'cap' },
            { name: 'Reactive surcharge', value: o.exposure.reactiveSurcharge, key: 'rea' },
          ]
        : [],
    [o],
  );

  if (!factoryId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Gauge className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">Choose a factory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Power factor is billed per site. Pick a factory from the map.
        </p>
      </div>
    );
  }

  const denied = (ovQ.error as { response?: { status?: number; data?: { message?: string } } } | null)
    ?.response?.status === 403;
  if (denied) {
    const msg = (ovQ.error as { response?: { data?: { message?: string } } }).response?.data?.message;
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Ban className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">No reactive-power metering at this site</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {msg ?? 'This factory’s classification does not include reactive-power metering.'}
        </p>
      </div>
    );
  }

  return (
    <PageShell loading={ovQ.isLoading} kpiCount={4} showChart showTable>
      <div className="px-6 pt-6">
        <h1 className="text-xl font-semibold tracking-tight">Power Factor</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          What a poor power factor costs, and why the compensation already installed is not fixing it
          {selectedFactory ? ` · ${selectedFactory.name}` : ''}
        </p>
      </div>

      <div className="grid gap-4 px-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Worst board" icon={TrendingDown}
          value={o?.worst ? o.worst.avgPf.toFixed(3) : '—'}
          hint={o?.worst ? `${o.worst.meterNumber} · threshold ${o.tariff.pfThreshold}` : undefined}
          tone={o?.worst && o.worst.avgPf < (o.tariff.pfThreshold ?? 0.9) ? 'crit' : 'good'}
        />
        <Tile
          label="Total exposure" icon={Wallet}
          value={o ? money(o.exposure.total, cur) : '—'}
          hint={`over ${o?.periodDays ?? 14} days`}
          tone="crit"
        />
        <Tile
          label="Of which capacity" icon={Wallet}
          value={o?.exposure.capacityShareOfTotal != null ? `${o.exposure.capacityShareOfTotal}%` : '—'}
          hint="billed on apparent power, not on kVArh"
          tone="warn"
        />
        <Tile
          label="Payback" icon={Gauge}
          value={s?.paybackYears != null ? `${s.paybackYears} yr` : '—'}
          hint={s ? `${s.totalKvar} kVAr · ${money(s.capex, cur)}` : undefined}
          tone="good"
        />
      </div>

      {/* ── Where the money actually goes ────────────────────────────────── */}
      <div className="grid gap-4 px-6 pt-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where the cost is</CardTitle>
            <CardDescription>
              The surcharge is the line everyone quotes. The capacity charge is the one that
              actually hurts, because it is billed on apparent power.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costSplit} layout="vertical" margin={{ left: 8, right: 40 }}>
                  <CartesianGrid strokeDasharray="2 4" opacity={0.25} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => money(Number(v), cur)} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {costSplit.map((d) => (
                      <Cell key={d.key} fill={d.key === 'cap' ? 'var(--pq-crit)' : 'var(--pq-warn)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {o ? (
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                {o.tariff.note}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Power factor over the window</CardTitle>
            <CardDescription>
              Daily mean across the site's boards. The line is the tariff threshold — below it,
              reactive energy attracts a surcharge on top of the capacity effect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(o?.trend?.length ?? 0) === 0 ? (
              <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                {ovQ.isLoading ? 'Loading…' : 'No readings in this window.'}
              </div>
            ) : (
              <div className="h-[180px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={o!.trend} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" opacity={0.25} />
                    <XAxis
                      dataKey="day" tick={{ fontSize: 10 }} minTickGap={30}
                      tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                    />
                    <YAxis domain={[0.7, 1]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(2)} />
                    <Tooltip
                      labelFormatter={(v) => new Date(v as string).toLocaleDateString()}
                      formatter={(v: number) => [Number(v).toFixed(3), 'Power factor']}
                    />
                    <ReferenceLine
                      y={o!.tariff.pfThreshold} stroke="var(--pq-crit)" strokeDasharray="4 3"
                      label={{ value: `threshold ${o!.tariff.pfThreshold}`, position: 'insideTopRight', fontSize: 10 }}
                    />
                    <Line type="monotone" dataKey="pf" stroke="var(--pq-warn)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── The banks ────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capacitor banks</CardTitle>
            <CardDescription>
              A bank without a detuning reactor lets harmonic current amplify through the
              capacitors, so it runs above its nameplate current until it fails. Both banks here
              are undetuned, and one has already gone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {(o?.banks ?? []).map((b) => {
                const v = VERDICT[b.verdict] ?? VERDICT.OK;
                return (
                  <div key={b.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{b.code}</span>
                          <Badge variant="outline" className="gap-1.5">
                            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: v.cls }} />
                            {v.label}
                          </Badge>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">{b.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg font-semibold tabular-nums">{b.totalKvar}</div>
                        <div className="text-xs text-muted-foreground">kVAr · {b.stepCount} steps</div>
                      </div>
                    </div>

                    <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
                      <Row label="Detuning reactor" value={b.detunedFilter ? 'Fitted' : 'None'} warn={!b.detunedFilter} />
                      <Row label="Rated step current" value={b.ratedStepCurrent != null ? `${b.ratedStepCurrent} A` : '—'} />
                      <Row
                        label="Measured step current"
                        value={b.measuredStepCurrent != null ? `${b.measuredStepCurrent} A` : '—'}
                        warn={(b.currentOverloadPct ?? 0) > 10 || b.measuredStepCurrent === 0}
                      />
                      <Row
                        label="Against nameplate"
                        value={b.currentOverloadPct != null ? `${b.currentOverloadPct > 0 ? '+' : ''}${b.currentOverloadPct}%` : '—'}
                        warn={(b.currentOverloadPct ?? 0) !== 0}
                      />
                      <Row label="Health" value={`${b.healthIndex}/100`} warn={b.healthIndex < 60} />
                    </dl>

                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                      {b.steps.map((st) => (
                        <span
                          key={st.stepNo}
                          title={`Step ${st.stepNo} · ${st.state} · ${st.currentA ?? 0} A · health ${st.healthPct}%`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded border font-mono text-[10px]"
                          style={{
                            borderColor: st.state === 'FAULT' ? 'var(--pq-crit)' : 'var(--border)',
                            background: st.state === 'ON' ? 'var(--pq-ok)' : st.state === 'FAULT' ? 'var(--pq-crit)' : 'transparent',
                            color: st.state === 'OFF' ? 'inherit' : '#fff',
                          }}
                        >
                          {st.stepNo}
                        </span>
                      ))}
                      <span className="ms-2 self-center text-[11px] text-muted-foreground">
                        steps — filled is switched in, red is faulted
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── The case ─────────────────────────────────────────────────────── */}
      <div className="px-6 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Correction to {s ? s.target : 0.98} power factor
            </CardTitle>
            <CardDescription>
              {s ? `${s.formula} — ` : ''}sized per board from measured demand. {s?.assumptions.note}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pe-4 font-medium">Board</th>
                    <th className="pb-2 pe-4 text-right font-medium">Now</th>
                    <th className="pb-2 pe-4 text-right font-medium">kVAr needed</th>
                    <th className="pb-2 pe-4 text-right font-medium">Bank size</th>
                    <th className="pb-2 text-right font-medium">Annual saving</th>
                  </tr>
                </thead>
                <tbody>
                  {(s?.perMeter ?? []).map((r) => (
                    <tr key={r.meterNumber} className="border-b border-border/60">
                      <td className="py-2.5 pe-4">
                        <div className="font-mono text-xs text-muted-foreground">{r.meterNumber}</div>
                        <div>{r.name}</div>
                      </td>
                      <td className="py-2.5 pe-4 text-right font-mono tabular-nums">{r.currentPf.toFixed(3)}</td>
                      <td className="py-2.5 pe-4 text-right font-mono tabular-nums">{r.kvarNeeded}</td>
                      <td className="py-2.5 pe-4 text-right font-mono tabular-nums">{r.recommendedBankKvar}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{money(r.annualSaving, cur)}</td>
                    </tr>
                  ))}
                  {s ? (
                    <tr className="font-medium">
                      <td className="py-2.5 pe-4">Total</td>
                      <td />
                      <td />
                      <td className="py-2.5 pe-4 text-right font-mono tabular-nums">{s.totalKvar}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums">{money(s.annualSaving, cur)}</td>
                    </tr>
                  ) : null}
                  {!s?.perMeter.length && !sizeQ.isLoading ? (
                    <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Every board is already at target.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-mono text-xs tabular-nums ${warn ? 'text-destructive' : ''}`}>{value}</dd>
    </div>
  );
}

function Tile({ label, value, hint, tone = 'default', icon: Icon }: {
  label: string; value: React.ReactNode; hint?: string;
  tone?: 'default' | 'crit' | 'warn' | 'good'; icon?: React.ElementType;
}) {
  const cls = tone === 'crit' ? 'text-destructive'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
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
