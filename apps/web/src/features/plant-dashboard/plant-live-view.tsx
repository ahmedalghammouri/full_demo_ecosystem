'use client';

/**
 * PlantLiveView — read-only published dashboard. Renders the saved background +
 * widgets at their logical positions, scaled to fit the screen, and batch-polls
 * live KPI values for cards that have a binding. Phase 4 upgrades the transport to
 * the shared websocket manager with connection/stale states; the polling here is
 * the functional fallback and keeps the view live today.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, Grid2x2, Loader2, WifiOff, Wifi, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { WidgetCard, type LiveValue } from './widget-card';
import { usePlantRealtime, type ConnectionState } from './use-plant-realtime';
import {
  usePublishedDashboard, useAuthedImage, fetchLiveData, buildSubscriptions, groupLive,
  DEFAULT_CANVAS, type Widget,
} from './use-plant-dashboard';

const CONN_META: Record<ConnectionState, { label: string; color: string; icon: React.ReactNode }> = {
  live: { label: 'Live', color: 'text-emerald-400', icon: <Wifi size={13} /> },
  delayed: { label: 'Data delayed', color: 'text-amber-400', icon: <RefreshCw size={13} /> },
  reconnecting: { label: 'Reconnecting', color: 'text-amber-400', icon: <RefreshCw size={13} className="animate-spin" /> },
  disconnected: { label: 'Disconnected', color: 'text-red-400', icon: <WifiOff size={13} /> },
};

export function PlantLiveView({ entityType, entityId }: { entityType: string; entityId: string }) {
  const router = useRouter();
  const { data: dash, isLoading, isError } = usePublishedDashboard(entityType, entityId);
  const widgets: Widget[] = (dash?.widgets as Widget[]) ?? [];
  const canvas = { ...DEFAULT_CANVAS, ...((dash?.canvasSettings as any) ?? {}) };
  const bgUrl = useAuthedImage((dash as any)?.backgroundImageUrl ?? null);

  // Fill the whole viewport (independent X/Y) so the plant view + widgets use the
  // entire window — no letterbox margins. The artboard is anchored top-left.
  // Robust measurement: ResizeObserver + window.resize + a short retry loop, because
  // right after a production hydration re-render the container can measure 0 and the
  // observer's first callback may fire before layout settles (seen only on the server).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState({ x: 1, y: 1 });
  useEffect(() => {
    const recalc = () => {
      const el = wrapRef.current;
      if (!el) return;
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setScale({ x: w / canvas.width, y: h / canvas.height });
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', recalc);
    // Retry for ~1.5s so a late/zero initial layout still gets a correct scale.
    let n = 0;
    const id = setInterval(() => { recalc(); if (++n > 15) clearInterval(id); }, 100);
    return () => { ro.disconnect(); window.removeEventListener('resize', recalc); clearInterval(id); };
  }, [canvas.width, canvas.height, dash]);

  // Batched live-data polling for bound cards (one request, one row per widget×kpi).
  const subs = useMemo(() => buildSubscriptions(widgets), [widgets]);

  const { data: liveData, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['plant-live-data', entityType, entityId, subs.map((s) => `${s.widgetId}:${s.scopeId}:${s.timeRange}`).join(',')],
    queryFn: () => fetchLiveData(subs),
    enabled: subs.length > 0,
    // Socket pushes drive most updates; this is the slow safety-net poll.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const liveByWidget = useMemo(() => groupLive(liveData?.data) as Map<string, LiveValue>, [liveData]);

  // Shared real-time manager: refetch on any machine/alarm event, connection + stale state.
  const { connectionState } = usePlantRealtime({
    onSignal: () => { refetch(); },
    lastUpdatedAt: subs.length ? dataUpdatedAt : Date.now(),
  });
  const conn = CONN_META[connectionState];
  const goFullscreen = () => wrapRef.current?.requestFullscreen?.();

  if (isLoading) return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="animate-spin mr-2" size={18} /> Loading live view…</div>;
  if (isError || !dash) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <Grid2x2 className="opacity-30" size={40} />
        <div className="text-lg font-bold">No published dashboard</div>
        <div className="text-sm text-foreground/50">Configure and publish a dashboard for this {entityType} first.</div>
        <button onClick={() => router.push(`/plant-hierarchy/dashboard-builder/${entityType}/${entityId}`)} className="h-9 px-4 rounded-xl bg-brand-500 text-white text-sm font-semibold">Open builder</button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-[calc(100vh-var(--header-h,4rem))] bg-[#0b1120] overflow-hidden">
      {/* Canvas — stretched to fill the whole viewport (anchored top-left) */}
      <div className="absolute top-0 left-0" style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale.x}, ${scale.y})`, transformOrigin: 'top left' }}>
        <div className="absolute inset-0" style={{ opacity: (dash.backgroundSettings as any)?.opacity ?? 1 }}>
          {bgUrl && <img src={bgUrl} alt="" className="w-full h-full" style={{ objectFit: ((dash.backgroundSettings as any)?.fit ?? 'fill') as any }} draggable={false} />}
        </div>
        {widgets.filter((w) => w.visible !== false).map((w) => (
          <div key={w.id} className="absolute" style={{ left: w.x, top: w.y, width: w.width, height: w.height, zIndex: w.zIndex ?? 1 }}>
            <WidgetCard widget={w} live={liveByWidget.get(w.id!)} />
          </div>
        ))}
      </div>

      {/* Connection + last-updated + fullscreen (top-right) */}
      <div className="absolute top-3 right-3 flex items-center gap-2 text-[11px] bg-slate-900/70 rounded-lg px-2.5 py-1.5 backdrop-blur">
        <span className={conn.color}>{conn.icon}</span>
        <span className={conn.color}>{conn.label}</span>
        {dataUpdatedAt ? <span className="text-slate-400">· {new Date(dataUpdatedAt).toLocaleTimeString()}</span> : null}
        <button onClick={goFullscreen} title="Fullscreen" className="ml-1 pl-2 border-l border-border/50 text-slate-300 hover:text-white">
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
