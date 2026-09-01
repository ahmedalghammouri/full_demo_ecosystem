'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CalendarRange, CalendarDays, GanttChartSquare, Layers, Boxes } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FactoryGantt, type FactoryTask, type GanttResource, type FactoryZoom } from '@/components/charts/factory-gantt';
import { ScheduleCalendar } from './schedule-calendar';
import { useUnifiedSchedule } from './use-schedule';
import { useScope } from '@/hooks/use-scope';
import { toFactoryDayKey, getFactoryTimeZone } from '@/lib/datetime';

const WINDOW_DAYS: Record<FactoryZoom, number> = { '30min': 1, hour: 2, day: 4, week: 14, month: 35 };
/** Calendar day in PLANT time. `toISOString().slice(0,10)` returned the UTC day,
 *  so anything after 21:00 Riyadh was bucketed into tomorrow and a 00:00 shift
 *  into yesterday — shifting the whole APS window. */
const iso = (d: Date) => toFactoryDayKey(d);

interface ScheduleViewProps {
  title?: string;
  subtitle?: string;
  defaultTypes?: string[];   // preset filter for domain views
  lockTypes?: boolean;       // hide the type chips (domain-locked view)
}

export function ScheduleView({
  title: titleProp,
  subtitle: subtitleProp,
  defaultTypes,
  lockTypes = false,
}: ScheduleViewProps) {
  const { t } = useTranslation('modules');
  const title = titleProp ?? t('schedule.view.title');
  const subtitle = subtitleProp ?? t('schedule.view.subtitle');
  const [zoom, setZoom] = useState<FactoryZoom>('week');
  const [groupBy, setGroupBy] = useState<'type' | 'resource'>('type');
  const [anchor, setAnchor] = useState(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  });
  const [activeTypes, setActiveTypes] = useState<Set<string> | null>(
    defaultTypes ? new Set(defaultTypes) : null,
  );
  const [view, setView] = useState<'gantt' | 'calendar'>('gantt');
  const [calAnchor, setCalAnchor] = useState(() => new Date());

  const windowDays = WINDOW_DAYS[zoom];
  const isoLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monthFrom = new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
  const monthTo = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + 1, 0);
  const dateFrom = view === 'calendar' ? isoLocal(monthFrom) : iso(anchor);
  const dateTo = view === 'calendar' ? isoLocal(monthTo) : iso(new Date(anchor.getTime() + windowDays * 86_400_000));

  const { filter: scopeFilter } = useScope();
  const { data, isLoading } = useUnifiedSchedule({ dateFrom, dateTo, ...scopeFilter });

  const typeMeta = data?.typeMeta ?? [];
  const counts = data?.counts ?? {};
  const typeLabels = useMemo(() => Object.fromEntries(typeMeta.map((t) => [t.type, t.label])), [typeMeta]);

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    if (!activeTypes) return items;
    return items.filter((i) => activeTypes.has(i.type));
  }, [data, activeTypes]);

  // ── FactoryGantt mapping: rows = types or resources ──
  const ganttResources: GanttResource[] = useMemo(() => {
    if (groupBy === 'resource') {
      const seen = new Map<string, GanttResource>();
      for (const it of filteredItems) {
        if (!seen.has(it.resourceId)) seen.set(it.resourceId, { id: it.resourceId, name: it.resourceName });
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    const present = new Set(filteredItems.map((i) => i.type));
    return typeMeta.filter((tm) => present.has(tm.type)).map((tm) => ({ id: tm.type, name: tm.label, sub: t('schedule.view.itemsCount', { count: counts[tm.type] ?? 0 }) }));
  }, [filteredItems, groupBy, typeMeta, counts, t]);

  const ganttTasks: FactoryTask[] = useMemo(() => filteredItems.map((it) => ({
    id: it.id,
    resourceId: groupBy === 'resource' ? it.resourceId : it.type,
    start: it.start,
    end: it.end,
    color: it.color,
    label: it.title,
    tooltip: `${it.title}${it.subtitle ? `\n${it.subtitle}` : ''}\n${it.resourceName}\n${new Date(it.start).toLocaleString()} → ${new Date(it.end).toLocaleString()}`,
    status: it.status,
    progress: it.progress,
  })), [filteredItems, groupBy]);

  const toggleType = (t: string) => {
    setActiveTypes((prev) => {
      const base = prev ?? new Set(typeMeta.map((m) => m.type));
      const next = new Set(base);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const shift = (dir: -1 | 1) =>
    setAnchor((a) => new Date(a.getTime() + dir * windowDays * 86_400_000));
  const today = () => {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - 1);
    setAnchor(d);
  };

  const rangeLabel = `${new Date(dateFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: getFactoryTimeZone() })} – ${new Date(dateTo).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: getFactoryTimeZone() })}`;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* view: gantt / calendar */}
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setView('gantt')}
              className={cn('px-2.5 py-1.5 text-xs flex items-center gap-1.5', view === 'gantt' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50')}>
              <GanttChartSquare size={13} /> {t('schedule.view.gantt')}
            </button>
            <button onClick={() => setView('calendar')}
              className={cn('px-2.5 py-1.5 text-xs flex items-center gap-1.5 border-l border-border', view === 'calendar' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50')}>
              <CalendarDays size={13} /> {t('schedule.view.calendar')}
            </button>
          </div>
          {view === 'gantt' && (
            <>
              {/* group by */}
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                <button onClick={() => setGroupBy('type')}
                  className={cn('px-2.5 py-1.5 text-xs flex items-center gap-1.5', groupBy === 'type' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50')}>
                  <Layers size={13} /> {t('schedule.view.groupType')}
                </button>
                <button onClick={() => setGroupBy('resource')}
                  className={cn('px-2.5 py-1.5 text-xs flex items-center gap-1.5 border-l border-border', groupBy === 'resource' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50')}>
                  <Boxes size={13} /> {t('schedule.view.groupResource')}
                </button>
              </div>
              {/* zoom */}
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                {(['day', 'week', 'month'] as FactoryZoom[]).map((z) => (
                  <button key={z} onClick={() => setZoom(z)}
                    className={cn('px-2.5 py-1.5 text-xs', z !== 'day' && 'border-l border-border',
                      zoom === z ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50')}>
                    {t('schedule.view.zoom.' + z)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* type filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {!lockTypes && typeMeta.map((t) => {
            const on = !activeTypes || activeTypes.has(t.type);
            return (
              <button key={t.type} onClick={() => toggleType(t.type)}
                className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors',
                  on ? 'border-transparent' : 'border-border opacity-50')}
                style={on ? { background: `${t.color}22`, color: t.color } : undefined}>
                <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                {t.label}
                <span className="opacity-70">{counts[t.type] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {/* date nav (gantt only — calendar has its own month nav) */}
        {view === 'gantt' && (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8" onClick={today}>
              <CalendarRange size={14} className="mr-1.5" /> {t('schedule.view.today')}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(-1)}><ChevronLeft size={16} /></Button>
            <span className="text-xs font-medium text-muted-foreground min-w-[180px] text-center tabular-nums">{rangeLabel}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(1)}><ChevronRight size={16} /></Button>
          </div>
        )}
      </div>

      {/* Body: calendar or gantt */}
      {view === 'calendar' ? (
        <ScheduleCalendar
          items={filteredItems}
          month={calAnchor}
          typeLabels={typeLabels}
          onPrevMonth={() => setCalAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}
          onNextMonth={() => setCalAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}
          onToday={() => setCalAnchor(new Date())}
        />
      ) : isLoading ? (
        <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-7 rounded" />)}
        </div>
      ) : (
        <FactoryGantt
          tasks={ganttTasks}
          resources={ganttResources}
          rangeFrom={dateFrom}
          rangeTo={dateTo}
          zoom={zoom}
          onZoomChange={(z) => setZoom(z)}
          statusExtra={`${rangeLabel} · ${t('schedule.view.groupedBy', { group: t('schedule.view.' + (groupBy === 'type' ? 'groupType' : 'groupResource')) })}`}
        />
      )}
    </div>
  );
}
