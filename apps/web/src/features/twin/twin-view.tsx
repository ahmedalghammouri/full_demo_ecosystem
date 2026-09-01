'use client';

/**
 * Digital Twin.
 *
 * The plant floor drawn as it is actually laid out, with each cell carrying its
 * live state. The point is that the screen reads as the facility rather than as
 * a chart: an operator who knows the hall can find the stopped machine without
 * reading a single label, which no table of machine names achieves.
 *
 * Only a factory whose classification declares DIGITAL_TWIN has surveyed
 * footprints, so this is the one screen that cannot be faked for a site that
 * has not been walked. The API refuses rather than drawing an empty floor.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Ban, Activity, AlertTriangle } from 'lucide-react';
import { api } from '@/services/api.client';
import { useFactoryStore } from '@/store/factory-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { PlantTwin, TwinLegend, type TwinAsset } from '@/components/plant/plant-twin';
import { STATE_META, stateColor, stateLabel, fmtNumber } from '@/lib/machine-state';

interface PlantLayout {
  factory: { code: string; name: string; nameAr: string | null };
  assets: (TwinAsset & { line: string | null; area: string | null })[];
  byState: Record<string, number>;
  producing: number;
  total: number;
}

function Tile({ label, value, hint, icon: Icon }: {
  label: string; value: React.ReactNode; hint?: string; icon?: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {Icon ? <Icon size={13} /> : null}
          {label}
        </div>
        <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

export function TwinView() {
  const { selectedFactory } = useFactoryStore();
  const factoryId = selectedFactory?.id;
  const [selected, setSelected] = React.useState<string | null>(null);

  const layoutQ = useQuery({
    queryKey: ['plant-layout', factoryId],
    queryFn: () => api.get<PlantLayout>('/dashboard/plant-layout', { params: { factoryId } }),
    enabled: !!factoryId,
    retry: false,
    // The floor is live. Thirty seconds is fast enough to watch a line change
    // state and slow enough not to hammer the API from a wall-mounted screen.
    refetchInterval: 30_000,
  });

  // Every hook runs before any conditional return.
  //
  // These derivations used to sit below the guards, so a factory that came back
  // 403 rendered a different number of hooks than one that came back 200 —
  // React error #300, which blanks the page and reports nothing useful in a
  // production build. The Rules of Hooks are not a style preference: a hook
  // after an early return is a crash waiting for the branch to be taken.
  const data = layoutQ.data;
  const assets = data?.assets ?? [];
  const active = assets.find((a) => a.code === selected) ?? null;

  const legendStates = React.useMemo(
    () =>
      Object.entries(data?.byState ?? {})
        .sort((a, b) => (STATE_META[b[0]]?.attention ?? 0) - (STATE_META[a[0]]?.attention ?? 0))
        .map(([key, count]) => ({ key, label: stateLabel(key), count })),
    [data?.byState],
  );

  const alarmed = assets.reduce((n, a) => n + (a.alarms > 0 ? 1 : 0), 0);
  const todayGood = assets.reduce((n, a) => n + (a.goodCount ?? 0), 0);

  if (!factoryId) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Boxes className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">Choose a factory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The twin draws one plant floor. Pick a factory from the map to see it.
        </p>
      </div>
    );
  }

  const denied = (layoutQ.error as { response?: { status?: number; data?: { message?: string } } } | null)
    ?.response?.status === 403;
  if (denied) {
    const msg = (layoutQ.error as { response?: { data?: { message?: string } } }).response?.data?.message;
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <Ban className="mx-auto mb-4 text-muted-foreground" size={32} />
        <h1 className="text-lg font-semibold">No digital twin for this site</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {msg ?? 'This factory’s classification does not include a surveyed floor plan.'}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          A twin needs every cell's position on the floor. Switch to a site classified as discrete
          assembly to see one.
        </p>
      </div>
    );
  }

  return (
    <PageShell loading={layoutQ.isLoading} kpiCount={4} showChart>
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Digital Twin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The plant floor as it is laid out, with live cell state
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

      <div className="grid gap-4 px-6 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Cells producing" icon={Activity}
          value={data ? `${data.producing}/${data.total}` : '—'}
          hint="in a RUNNING state right now" />
        <Tile label="Cells with alarms" icon={AlertTriangle}
          value={alarmed}
          hint={alarmed ? 'unresolved on the floor' : 'nothing outstanding'} />
        <Tile label="Good today" icon={Boxes}
          value={fmtNumber(todayGood)}
          hint="from the measured-minute store" />
        <Tile label="States seen" icon={Activity}
          value={legendStates.length}
          hint="distinct across the floor" />
      </div>

      <div className="grid gap-4 px-6 py-6 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Plant floor</CardTitle>
            <CardDescription>
              Each cell is drawn in its surveyed position and extruded to its footprint. Colour
              carries state and every box shows its code, so state is never colour alone. Click a
              cell for its detail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assets.length === 0 && !layoutQ.isLoading ? (
              <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
                No cells have a surveyed position on this floor.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <PlantTwin assets={assets} selected={selected} onSelect={setSelected} />
              </div>
            )}
            {legendStates.length ? (
              <div className="mt-4 border-t border-border pt-4">
                <TwinLegend states={legendStates} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{active ? active.name : 'Select a cell'}</CardTitle>
            <CardDescription>
              {active
                ? `${active.kind} · ${active.area ?? '—'}${active.line ? ` · line ${active.line}` : ''}`
                : 'Click a cell on the floor to read its live values.'}
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
                <Row label="Sequence" value={active.sequence} mono />
                <Row label="Alarms" value={active.alarms} mono />
                <Row label="Good today" value={fmtNumber(active.goodCount)} mono />
                {active.headline ? (
                  <Row
                    label={active.headline.label}
                    value={`${fmtNumber(active.headline.value)} ${active.headline.unit}`}
                    mono
                  />
                ) : (
                  // Null, not zero: a cell that has not run today has nothing to
                  // report, and 0 would read as "running and producing nothing".
                  <Row label="Today" value="not run today" />
                )}
              </dl>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing selected.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
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
