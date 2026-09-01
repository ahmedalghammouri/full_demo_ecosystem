'use client';

/**
 * WidgetCard — renders one dashboard widget by type. Pure presentational: it takes
 * the widget config + an optional resolved live value/rows and draws the card. Used
 * by both the builder canvas and the read-only Live View, so the two always match.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { Widget } from './use-plant-dashboard';

const STATE_COLOR: Record<string, string> = {
  RUNNING: '#22c55e', IDLE: '#64748b', WARNING: '#f59e0b', STOPPED: '#ef4444',
  BREAKDOWN: '#ef4444', DISCONNECTED: '#475569', OFFLINE: '#475569', MAINTENANCE: '#a855f7',
  PLANNED_STOP: '#3b82f6', SETUP: '#f59e0b', CHANGEOVER: '#f59e0b',
};

export type LiveValue = { value?: number; error?: string; at?: string; quality?: string };

function evalThreshold(rules: any[] | undefined, value: number | undefined): string | null {
  if (!rules?.length || value == null) return null;
  for (const r of rules) {
    const a = Number(r.value), b = Number(r.value2);
    const ok = (() => {
      switch (r.op) {
        case 'gte': return value >= a; case 'gt': return value > a;
        case 'lte': return value <= a; case 'lt': return value < a;
        case 'eq': return value === a; case 'ne': return value !== a;
        case 'between': return value >= a && value <= b;
        default: return false;
      }
    })();
    if (ok) return r.color ?? null;
  }
  return null;
}

const fmt = (v: number | undefined, decimals = 0, unit = '') =>
  v == null ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: decimals })}${unit ? ` ${unit}` : ''}`;

export function WidgetCard({
  widget, live, className, style,
}: {
  widget: Widget;
  live?: LiveValue;
  className?: string;
  style?: React.CSSProperties;
}) {
  const d = widget.displayConfig ?? {};
  const data = widget.dataConfig ?? {};
  const showTitle = d.showTitle !== false;
  const thresholdColor = evalThreshold(widget.thresholdConfig?.rules, live?.value);

  const cardStyle: React.CSSProperties = {
    background: d.backgroundColor ?? 'rgba(15,23,42,0.86)',
    color: d.textColor ?? '#e2e8f0',
    borderColor: thresholdColor ?? d.borderColor ?? 'rgba(148,163,184,0.25)',
    borderWidth: d.showBorder === false ? 0 : 1,
    borderStyle: 'solid',
    borderRadius: d.borderRadius ?? 12,
    opacity: d.opacity ?? 1,
    padding: d.padding ?? 10,
    ...style,
  };

  return (
    <div className={cn('w-full h-full overflow-hidden backdrop-blur-sm flex flex-col', className)} style={cardStyle}>
      {showTitle && (widget.title || data.label) && (
        <div className="flex items-center gap-1.5 mb-1 shrink-0">
          {d.showStatusIndicator !== false && (
            <span className="w-2 h-2 rounded-full" style={{ background: thresholdColor ?? '#22c55e' }} />
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70 truncate">{widget.title || data.label}</span>
        </div>
      )}
      <div className="flex-1 min-h-0">{body(widget, live, thresholdColor)}</div>
    </div>
  );
}

function body(widget: Widget, live: LiveValue | undefined, thresholdColor: string | null) {
  const data = widget.dataConfig ?? {};
  const decimals = data.decimals ?? 0;
  const unit = data.unit ?? '';
  switch (widget.widgetType) {
    case 'kpiValue':
      return (
        <div className="h-full flex flex-col justify-center">
          <div className="text-2xl font-bold tabular-nums leading-tight" style={{ color: thresholdColor ?? undefined }}>
            {live?.error ? '—' : fmt(live?.value, decimals, unit)}
          </div>
          {data.kpiLabel && <div className="text-[10px] opacity-60 mt-0.5">{data.kpiLabel}</div>}
        </div>
      );
    case 'multiKpi': {
      const rows: any[] = data.kpis ?? [];
      const values: Record<string, number> = (live as any)?.values ?? {};
      return (
        <div className="flex flex-col gap-0.5 text-[11px]">
          {rows.length === 0 && <span className="opacity-50">Add KPI rows…</span>}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="opacity-60 truncate">{r.label ?? r.kpiCode}</span>
              <span className="font-semibold tabular-nums">{fmt(values[r.kpiCode], r.decimals ?? 0, r.unit ?? '')}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'equipmentStatus':
    case 'lineStatus':
      return (
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOR[(live as any)?.state ?? 'IDLE'] ?? '#64748b' }} />
            <span className="font-semibold">{(live as any)?.state ?? 'IDLE'}</span>
          </div>
          <div className="flex justify-between opacity-70"><span>Speed</span><span>{fmt((live as any)?.speed, 0, '/hr')}</span></div>
          <div className="flex justify-between opacity-70"><span>OEE</span><span>{fmt((live as any)?.oee, 1, '%')}</span></div>
        </div>
      );
    case 'oeeSummary': {
      const v: any = (live as any)?.values ?? {};
      /**
       * Both bases on one card.
       *
       * The two are not meant to agree: OEE divides by the slot each order was
       * COMMITTED to, so it climbs as the period runs; OEE-TB divides by the
       * time that actually went by, so it is complete at every instant. The gap
       * between them IS the schedule adherence, and putting them side by side is
       * the only place a reader can see it without switching pages.
       *
       * Performance and Quality appear once because neither depends on the time
       * basis — the parts made and the minutes spent running are the same either
       * way.
       */
      /**
       * The builder passes no `live` at all — it subscribes only in preview — so
       * a card being designed has an empty value bag. Hiding the second row on
       * "no TB value" therefore hid it in the one place it most needs to show:
       * the canvas where somebody is sizing and placing the card.
       *
       * So the row is drawn whenever there is nothing live to contradict it, and
       * hidden only when values DID arrive and genuinely carried no time-based
       * pair — a scope that cannot answer on both bases.
       */
      const hasLive = Object.keys(v).length > 0;
      const showTb = !hasLive || v.OEE_TB != null || v.AVAILABILITY_TB != null;
      return (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-1.5 text-center">
            {[['OEE', v.OEE], ['Avail', v.AVAILABILITY], ['Perf', v.PERFORMANCE], ['Qual', v.QUALITY]].map(([k, val]) => (
              <div key={k as string} className="rounded bg-white/5 py-1">
                <div className="text-sm font-bold tabular-nums">{fmt(val as number, 1, '%')}</div>
                <div className="text-[9px] opacity-60 uppercase">{k}</div>
              </div>
            ))}
          </div>
          {showTb && (
            <div className="grid grid-cols-2 gap-1.5 text-center">
              {[['OEE-TB', v.OEE_TB], ['Avail-TB', v.AVAILABILITY_TB]].map(([k, val]) => (
                <div key={k as string} className="rounded border border-white/10 bg-white/[0.02] py-1">
                  <div className="text-xs font-semibold tabular-nums opacity-90">{fmt(val as number, 1, '%')}</div>
                  <div className="text-[9px] opacity-50 uppercase">{k}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    case 'productionSummary': {
      const v: any = (live as any)?.values ?? {};
      return (
        <div className="flex flex-col gap-0.5 text-[11px]">
          <Row label="Total" value={fmt(v.TOTAL_PRODUCTION, 0)} />
          <Row label="Good" value={fmt(v.GOOD_COUNT, 0)} className="text-emerald-400" />
          <Row label="Rejects" value={fmt(v.REJECT_COUNT, 0)} className="text-red-400" />
          <Row label="Downtime" value={fmt(v.DOWNTIME, 0, 'min')} />
        </div>
      );
    }
    case 'trendChart':
      return <Sparkline points={(live as any)?.trend ?? []} color={thresholdColor ?? '#38bdf8'} unit={unit} />;
    case 'activeAlarms':
      return <AlarmsList alarms={(live as any)?.alarms ?? []} />;
    case 'text':
      return <div className="text-sm" style={{ textAlign: (widget.displayConfig?.align as any) ?? 'left' }}>{widget.displayConfig?.text ?? widget.title ?? 'Text'}</div>;
    case 'image':
      return <div className="h-full flex items-center justify-center text-[10px] opacity-50">Image</div>;
    case 'navButton':
      return <div className="h-full flex items-center justify-center text-xs font-semibold rounded bg-brand-500/20 text-brand-300">{widget.title ?? 'Open'}</div>;
    default:
      return <div className="text-[10px] opacity-50">{widget.widgetType}</div>;
  }
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="opacity-60">{label}</span>
      <span className={cn('font-semibold tabular-nums', className)}>{value}</span>
    </div>
  );
}

// Lightweight inline SVG sparkline — fast even with many cards (no chart library).
function Sparkline({ points, color, unit }: { points: Array<{ x: string; y: number }>; color: string; unit?: string }) {
  if (!points.length) return <div className="h-full flex items-center justify-center text-[10px] opacity-40">No data</div>;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys, min + 1);
  const W = 100, H = 100;
  const path = points.map((p, i) => {
    const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * W;
    const y = H - ((p.y - min) / (max - min || 1)) * H;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = points[points.length - 1]?.y ?? 0;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="opacity-60">latest</span>
        <span className="font-bold tabular-nums" style={{ color }}>{last}{unit ? ` ${unit}` : ''}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="flex-1 w-full mt-1">
        <path d={`${path} L${W},${H} L0,${H} Z`} fill={color} opacity={0.12} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

const ALARM_SEV: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#38bdf8', INFO: '#64748b' };
function AlarmsList({ alarms }: { alarms: Array<{ id: string; severity: string; message: string; machine: string; at: string }> }) {
  if (!alarms.length) return <div className="h-full flex items-center justify-center text-[10px] opacity-40">No active alarms</div>;
  return (
    <ul className="flex flex-col gap-1 text-[11px] overflow-hidden">
      {alarms.slice(0, 5).map((a) => (
        <li key={a.id} className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ALARM_SEV[a.severity] ?? '#64748b' }} />
          {a.machine && <span className="opacity-60 shrink-0">{a.machine}</span>}
          <span className="truncate">{a.message}</span>
        </li>
      ))}
    </ul>
  );
}
