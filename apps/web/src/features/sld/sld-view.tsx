'use client';

/**
 * Single Line Diagram.
 *
 * The electrical distribution drawn as electricians draw it — supply at the
 * top, distribution beneath, loads at the bottom — with the live measurement
 * riding on each node. The point of putting values on the drawing rather than
 * in a table beside it is that "which board is loaded" and "where that board
 * sits" are one question, and splitting them across two panels makes the reader
 * do the join.
 *
 * Drawn as inline SVG rather than with a chart library: this is a schematic,
 * not a plot. Nothing here is a scale or an axis, and a charting package would
 * bring a coordinate system that fights the layout.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Network, Zap, Gauge } from 'lucide-react';
import { api } from '@/services/api.client';
import { useFactoryStore } from '@/store/factory-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { stateColor, stateLabel } from '@/lib/machine-state';

interface Live {
  powerKw: number | null; powerFactor: number | null; reactiveKvar: number | null;
  apparentKva: number | null; loadingPct: number | null; at: string;
}
interface Node {
  code: string; name: string; nameAr: string | null; kind: string;
  manufacturer: string | null; model: string | null; criticality: string;
  state: string; voltageLevel: 'MV' | 'LV'; parent: string | null;
  ratedKva: number | null; ratedKw: number | null;
  live: Live | null; note: string | null;
  depth: number; children: string[];
}
interface Sld {
  factory: { code: string; name: string };
  root: string | null;
  nodes: Node[];
  totals: { siteKw: number | null; meteredNodes: number; totalNodes: number };
}

// Geometry. Fixed rather than responsive because a schematic has a correct
// shape: letting boxes reflow would put a transformer beside its own board.
const BOX_W = 148;
const BOX_H = 62;
const GAP_X = 22;
const GAP_Y = 78;
const PAD = 28;

/** Loading is a magnitude, so it gets one hue and darkens — not a rainbow. */
function loadingColour(pct: number | null): string {
  if (pct == null) return 'var(--sld-unmetered)';
  if (pct >= 90) return 'var(--pq-crit)';
  if (pct >= 75) return 'var(--pq-warn)';
  return 'var(--pq-ok)';
}

export function SldView() {
  const { selectedFactory } = useFactoryStore();
  const factoryId = selectedFactory?.id;
  const [selected, setSelected] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: ['sld', factoryId],
    queryFn: () => api.get<Sld>('/power-quality/sld', { params: { factoryId } }),
    enabled: !!factoryId,
    retry: false,
    refetchInterval: 30_000,
  });

  const data = q.data;
  const nodes = React.useMemo(() => data?.nodes ?? [], [data]);
  const byCode = React.useMemo(() => new Map(nodes.map((n) => [n.code, n])), [nodes]);

  // Lay the tree out by depth. Each level is centred on the widest one, so the
  // drawing stays symmetrical however many boards a transformer feeds.
  const layout = React.useMemo(() => {
    const levels = new Map<number, Node[]>();
    for (const n of nodes) levels.set(n.depth, [...(levels.get(n.depth) ?? []), n]);
    const maxPerLevel = Math.max(1, ...[...levels.values()].map((l) => l.length));
    const width = maxPerLevel * BOX_W + (maxPerLevel - 1) * GAP_X + PAD * 2;

    const pos = new Map<string, { x: number; y: number }>();
    for (const [depth, list] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
      const rowW = list.length * BOX_W + (list.length - 1) * GAP_X;
      const startX = (width - rowW) / 2;
      list.forEach((n, i) => {
        pos.set(n.code, { x: startX + i * (BOX_W + GAP_X), y: PAD + depth * (BOX_H + GAP_Y) });
      });
    }
    const height = PAD * 2 + (levels.size || 1) * BOX_H + Math.max(0, levels.size - 1) * GAP_Y;
    return { pos, width, height };
  }, [nodes]);

  const active = selected ? byCode.get(selected) ?? null : null;

  if (!factoryId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Network className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">Choose a factory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The diagram draws one site's distribution. Pick a factory from the map.
        </p>
      </div>
    );
  }

  const denied = (q.error as { response?: { status?: number; data?: { message?: string } } } | null)
    ?.response?.status === 403;
  if (denied) {
    const msg = (q.error as { response?: { data?: { message?: string } } }).response?.data?.message;
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Ban className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">No single line diagram for this site</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {msg ?? 'This factory’s classification does not include an electrical distribution model.'}
        </p>
      </div>
    );
  }

  return (
    <PageShell loading={q.isLoading} kpiCount={3} showChart>
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Single Line Diagram</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Supply, distribution and loads, with the live measurement on each node
            {data ? ` · ${data.factory.name}` : ''}
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live · 30 s
        </Badge>
      </div>

      <div className="grid gap-4 px-6 pt-5 sm:grid-cols-3">
        <Tile label="Site demand" icon={Zap}
          value={data?.totals.siteKw != null ? `${data.totals.siteKw.toLocaleString()}` : '—'}
          unit="kW" hint="sum of the metered boards" />
        <Tile label="Metered nodes" icon={Gauge}
          value={data ? `${data.totals.meteredNodes}/${data.totals.totalNodes}` : '—'}
          hint="the rest carry no meter" />
        <Tile label="Highest loading" icon={Gauge}
          value={(() => {
            const l = nodes.map((n) => n.live?.loadingPct).filter((v): v is number => v != null);
            return l.length ? `${Math.max(...l)}%` : '—';
          })()}
          hint="against the node's own rating" />
      </div>

      <div className="grid gap-4 px-6 py-6 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Distribution</CardTitle>
            <CardDescription>
              Medium voltage at the top, low-voltage boards beneath, loads at the bottom. A node's
              edge carries its loading against its own rating; an unmetered node is drawn dashed
              rather than shown as zero. Click a node for its detail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {nodes.length === 0 ? (
              <div className="flex h-[380px] items-center justify-center text-sm text-muted-foreground">
                {q.isLoading ? 'Loading diagram…' : 'No assets on this diagram.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <svg
                  width={layout.width}
                  height={layout.height}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                  className="min-w-full"
                  role="img"
                  aria-label="Single line diagram of the electrical distribution"
                >
                  {/* Busbars first, so boxes sit on top of them. */}
                  {nodes.map((n) => {
                    if (!n.parent) return null;
                    const a = layout.pos.get(n.parent);
                    const b = layout.pos.get(n.code);
                    if (!a || !b) return null;
                    const x1 = a.x + BOX_W / 2;
                    const y1 = a.y + BOX_H;
                    const x2 = b.x + BOX_W / 2;
                    const y2 = b.y;
                    const mid = y1 + (y2 - y1) / 2;
                    return (
                      <path
                        key={`${n.parent}-${n.code}`}
                        d={`M ${x1} ${y1} V ${mid} H ${x2} V ${y2}`}
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity={0.32}
                        strokeWidth={1.5}
                      />
                    );
                  })}

                  {nodes.map((n) => {
                    const p = layout.pos.get(n.code);
                    if (!p) return null;
                    const edge = loadingColour(n.live?.loadingPct ?? null);
                    const isSel = n.code === selected;
                    return (
                      <g
                        key={n.code}
                        transform={`translate(${p.x}, ${p.y})`}
                        onClick={() => setSelected(n.code)}
                        style={{ cursor: 'pointer' }}
                      >
                        <rect
                          width={BOX_W} height={BOX_H} rx={6}
                          className="fill-card"
                          stroke={edge}
                          strokeWidth={isSel ? 2.5 : 1.5}
                          strokeDasharray={n.live ? undefined : '4 3'}
                        />
                        {/* Voltage level as a rail, so MV and LV separate at a glance. */}
                        <rect
                          width={3} height={BOX_H} rx={1.5}
                          fill={n.voltageLevel === 'MV' ? 'var(--sld-mv)' : 'var(--sld-lv)'}
                        />
                        <text x={12} y={18} className="fill-foreground" fontSize={11} fontWeight={600}>
                          {n.code}
                        </text>
                        <text x={12} y={32} className="fill-muted-foreground" fontSize={9}>
                          {n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name}
                        </text>
                        <text
                          x={12} y={49}
                          fontSize={11}
                          fontFamily="ui-monospace, monospace"
                          fill={edge}
                        >
                          {n.live?.powerKw != null ? `${n.live.powerKw} kW` : 'unmetered'}
                        </text>
                        {n.live?.loadingPct != null ? (
                          <text
                            x={BOX_W - 12} y={49} textAnchor="end"
                            fontSize={10} fontFamily="ui-monospace, monospace"
                            fill={edge}
                          >
                            {n.live.loadingPct}%
                          </text>
                        ) : null}
                        {/* A finding on the asset is flagged, never silently dropped. */}
                        {n.note ? (
                          <circle cx={BOX_W - 10} cy={12} r={4} fill="var(--pq-crit)" />
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <Key colour="var(--sld-mv)" label="Medium voltage" />
              <Key colour="var(--sld-lv)" label="Low voltage" />
              <Key colour="var(--pq-ok)" label="under 75% loaded" />
              <Key colour="var(--pq-warn)" label="75–90%" />
              <Key colour="var(--pq-crit)" label="over 90%, or a flagged asset" />
              <span className="flex items-center gap-1.5">
                <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="currentColor" strokeDasharray="4 3" /></svg>
                unmetered
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{active ? active.name : 'Select a node'}</CardTitle>
            <CardDescription>
              {active
                ? `${active.voltageLevel === 'MV' ? 'Medium voltage' : 'Low voltage'} · ${active.kind}`
                : 'Click any node on the diagram.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {active ? (
              <dl className="divide-y divide-border">
                <Row label="Code" value={active.code} mono />
                <Row
                  label="State"
                  value={
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="inline-block h-2 w-2 rounded-full"
                        style={{ background: stateColor(active.state) }} />
                      {stateLabel(active.state)}
                    </span>
                  }
                />
                <Row label="Fed from" value={active.parent ?? 'utility'} mono />
                {active.ratedKva ? <Row label="Rating" value={`${active.ratedKva} kVA`} mono /> : null}
                {active.ratedKw ? <Row label="Rated load" value={`${active.ratedKw} kW`} mono /> : null}
                {active.live ? (
                  <>
                    <Row label="Active power" value={`${active.live.powerKw ?? '—'} kW`} mono />
                    <Row label="Reactive" value={`${active.live.reactiveKvar ?? '—'} kVAr`} mono />
                    <Row label="Apparent" value={`${active.live.apparentKva ?? '—'} kVA`} mono />
                    <Row label="Power factor" value={active.live.powerFactor ?? '—'} mono />
                    <Row
                      label="Loading"
                      value={active.live.loadingPct != null ? `${active.live.loadingPct}%` : '—'}
                      mono
                    />
                  </>
                ) : (
                  <Row label="Measurement" value="no meter on this node" />
                )}
                {active.manufacturer ? (
                  <Row label="Make" value={`${active.manufacturer}${active.model ? ` ${active.model}` : ''}`} />
                ) : null}
                {active.note ? (
                  <div className="pt-3">
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
                      {active.note}
                    </div>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing selected.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i aria-hidden className="inline-block h-2 w-3 rounded-sm" style={{ background: colour }} />
      {label}
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</dd>
    </div>
  );
}

function Tile({ label, value, unit, hint, icon: Icon }: {
  label: string; value: React.ReactNode; unit?: string; hint?: string; icon?: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {Icon ? <Icon size={13} /> : null}
          {label}
        </div>
        <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
          {value}
          {unit ? <span className="ms-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
        </div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
