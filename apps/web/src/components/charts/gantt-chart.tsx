'use client';

import React, { useMemo, useRef, useState } from 'react';
import { getFactoryTimeZone } from '@/lib/datetime';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface GanttItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  status?: string;
  resourceId: string;
  resourceName: string;
  start: string;
  end: string;
  progress?: number;
  color: string;
}

export type GanttZoom = 'day' | 'week' | 'month';

interface GanttProps {
  items: GanttItem[];
  rangeFrom: string | Date;
  rangeTo: string | Date;
  groupBy?: 'type' | 'resource';
  zoom?: GanttZoom;
  typeLabels?: Record<string, string>;
  onItemClick?: (item: GanttItem) => void;
}

const PX_PER_DAY: Record<GanttZoom, number> = { day: 220, week: 64, month: 26 };
const DAY = 86_400_000;
const ROW_H = 30;
const LABEL_W = 200;

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Greedy lane packing so overlapping items in a group stack instead of colliding. */
function packLanes(items: GanttItem[]): { item: GanttItem; lane: number }[] {
  const sorted = [...items].sort((a, b) => +new Date(a.start) - +new Date(b.start));
  const laneEnds: number[] = [];
  return sorted.map((item) => {
    const s = +new Date(item.start);
    const e = +new Date(item.end);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); }
    else laneEnds[lane] = e;
    return { item, lane };
  });
}

export function GanttChart({
  items, rangeFrom, rangeTo, groupBy = 'type', zoom = 'week', typeLabels = {}, onItemClick,
}: GanttProps) {
  const { t } = useTranslation('common');
  const from = useMemo(() => startOfDay(new Date(rangeFrom)), [rangeFrom]);
  const to = useMemo(() => startOfDay(new Date(rangeTo)), [rangeTo]);
  const pxPerDay = PX_PER_DAY[zoom];
  const [hover, setHover] = useState<{ item: GanttItem; x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let t = +from; t <= +to; t += DAY) out.push(new Date(t));
    return out;
  }, [from, to]);

  const timelineW = days.length * pxPerDay;
  const totalMs = Math.max(DAY, +to + DAY - +from);
  const xFor = (iso: string) => ((+new Date(iso) - +from) / totalMs) * timelineW;

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: GanttItem[] }>();
    for (const it of items) {
      const key = groupBy === 'type' ? it.type : it.resourceId;
      const label = groupBy === 'type' ? (typeLabels[it.type] ?? it.type) : it.resourceName;
      if (!map.has(key)) map.set(key, { key, label, items: [] });
      map.get(key)!.items.push(it);
    }
    return [...map.values()].map((g) => {
      const packed = packLanes(g.items);
      const lanes = packed.reduce((m, p) => Math.max(m, p.lane + 1), 1);
      return { ...g, packed, lanes };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [items, groupBy, typeLabels]);

  const nowX = (() => {
    const n = +new Date();
    if (n < +from || n > +to + DAY) return null;
    return ((n - +from) / totalMs) * timelineW;
  })();

  // Axis labels follow PLANT time, not UTC. Formatting these in UTC shifted every
  // bar by the factory offset — a work order planned 01 Aug 00:00 Riyadh rendered
  // at 31 Jul 21:00, which is what made the APS Gantt look three hours out.
  const tz = getFactoryTimeZone();
  const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: tz });
  const fmtDow = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: tz });
  /** Fri/Sat is the KSA weekend — evaluated in plant time for the same reason. */
  const isWeekend = (d: Date) =>
    ['Fri', 'Sat'].includes(d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz }));

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
        {t('charts.gantt.noItems')}
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-border/60 bg-card overflow-hidden">
      <div ref={scrollRef} className="overflow-x-auto">
        <div style={{ width: LABEL_W + timelineW }}>
          {/* Header */}
          <div className="flex sticky top-0 z-20 bg-card border-b border-border">
            <div className="shrink-0 sticky left-0 z-30 bg-card border-r border-border flex items-center px-3 text-xs font-semibold text-muted-foreground"
              style={{ width: LABEL_W, height: 40 }}>
              {groupBy === 'type' ? t('charts.gantt.category') : t('charts.gantt.resource')}
            </div>
            <div className="relative" style={{ width: timelineW, height: 40 }}>
              {days.map((d, i) => (
                <div key={i}
                  className={cn('absolute top-0 h-full border-r border-border/40 flex flex-col items-center justify-center',
                    isWeekend(d) && 'bg-muted/30')}
                  style={{ left: i * pxPerDay, width: pxPerDay }}>
                  <span className="text-[10px] text-muted-foreground/70 leading-none">{zoom !== 'month' ? fmtDow(d) : ''}</span>
                  <span className="text-[11px] font-medium leading-tight">{fmtDay(d)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="relative">
            {groups.map((g) => {
              const groupH = g.lanes * ROW_H + 8;
              return (
                <div key={g.key} className="flex border-b border-border/40">
                  <div className="shrink-0 sticky left-0 z-10 bg-card border-r border-border flex items-center gap-2 px-3"
                    style={{ width: LABEL_W, minHeight: groupH }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.items[0]?.color }} />
                    <span className="text-xs font-medium truncate">{g.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{g.items.length}</span>
                  </div>
                  <div className="relative" style={{ width: timelineW, height: groupH }}>
                    {/* day grid */}
                    {days.map((d, i) => (
                      <div key={i} className={cn('absolute top-0 h-full border-r border-border/20', isWeekend(d) && 'bg-muted/20')}
                        style={{ left: i * pxPerDay, width: pxPerDay }} />
                    ))}
                    {/* bars */}
                    {g.packed.map(({ item, lane }) => {
                      const left = xFor(item.start);
                      const w = Math.max(6, xFor(item.end) - left);
                      const done = item.status === 'COMPLETED';
                      return (
                        <div
                          key={item.id}
                          onMouseEnter={(e) => setHover({ item, x: e.clientX, y: e.clientY })}
                          onMouseMove={(e) => setHover({ item, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => onItemClick?.(item)}
                          className={cn('absolute rounded-md flex items-center px-1.5 overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-foreground/30 hover:ring-offset-1 hover:ring-offset-card hover:brightness-110',
                            done && 'opacity-70')}
                          style={{
                            left, width: w, top: lane * ROW_H + 4, height: ROW_H - 8,
                            background: `${item.color}26`, border: `1px solid ${item.color}`,
                          }}
                        >
                          {item.progress != null && item.progress > 0 && (
                            <div className="absolute inset-y-0 left-0 rounded-l-md" style={{ width: `${item.progress}%`, background: `${item.color}40` }} />
                          )}
                          <span className="relative text-[10px] font-medium whitespace-nowrap truncate" style={{ color: item.color }}>
                            {item.title}{item.subtitle ? ` · ${item.subtitle}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Now line spanning body */}
            {nowX != null && (
              <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: LABEL_W + nowX }}>
                <div className="w-px h-full bg-rose-500/70" />
                <div className="absolute -top-0 -left-1 w-2 h-2 rounded-full bg-rose-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {hover && (
        <div className="fixed z-50 pointer-events-none rounded-lg border border-border bg-popover shadow-lg p-2.5 text-xs max-w-xs"
          style={{ left: Math.min(hover.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 260), top: hover.y + 12 }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ background: hover.item.color }} />
            <span className="font-semibold">{hover.item.title}</span>
            {hover.item.status && <span className="ml-auto text-[10px] text-muted-foreground">{hover.item.status}</span>}
          </div>
          {hover.item.subtitle && <div className="text-muted-foreground mb-1">{hover.item.subtitle}</div>}
          <div className="text-muted-foreground">
            {new Date(hover.item.start).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' → '}
            {new Date(hover.item.end).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      )}
    </div>
  );
}
