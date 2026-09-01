'use client';

/**
 * ScheduleCalendar — month-grid calendar for the unified schedule, the same
 * visual language as the Maintenance Scheduling calendar. Renders any
 * GanttItem[] (production orders, work orders, downtime, shifts, …) as
 * type-coloured chips on each day they span, with a selected-day detail panel.
 *
 * Presentational: the parent owns the displayed month (so it can fetch that
 * month's items); this component owns only the selected-day state.
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import type { GanttItem } from '@/components/charts/gantt-chart';
import { cn } from '@/lib/utils';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface ScheduleCalendarProps {
  items: GanttItem[];
  /** Any date within the month to display. */
  month: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  typeLabels?: Record<string, string>;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ScheduleCalendar({ items, month, onPrevMonth, onNextMonth, onToday, typeLabels = {} }: ScheduleCalendarProps) {
  const { t } = useTranslation('modules');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const monthName = month.toLocaleString('default', { month: 'long' });
  const firstWeekday = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const today = new Date();

  // Bucket items onto every day they span within this month.
  const byDay = useMemo(() => {
    const map: Record<number, GanttItem[]> = {};
    const monthStart = new Date(year, monthIdx, 1).getTime();
    const monthEnd = new Date(year, monthIdx, daysInMonth, 23, 59, 59).getTime();
    for (const it of items) {
      const s = new Date(it.start).getTime();
      const e = Math.max(new Date(it.end).getTime(), s);
      if (e < monthStart || s > monthEnd) continue;
      const from = new Date(Math.max(s, monthStart));
      const to = new Date(Math.min(e, monthEnd));
      const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      while (cursor.getTime() <= to.getTime()) {
        if (cursor.getMonth() === monthIdx) {
          const day = cursor.getDate();
          (map[day] ??= []).push(it);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [items, year, monthIdx, daysInMonth]);

  const selectedItems = selectedDay != null ? byDay[selectedDay] ?? [] : [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card p-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={onToday} className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted/60 transition-colors flex items-center gap-1.5">
            <CalendarRange size={13} /> {t('schedule.cal.today')}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onPrevMonth} className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
              <ChevronLeft size={16} />
            </button>
            <h2 className="text-sm font-semibold min-w-[140px] text-center">{monthName} {year}</h2>
            <button onClick={onNextMonth} className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground">
              <ChevronRight size={16} />
            </button>
          </div>
          <span className="w-[60px]" />
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_KEYS.map(d => (
            <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1">{t('schedule.cal.weekday.' + d)}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstWeekday }).map((_, i) => <div key={`empty-${i}`} className="min-h-24" />)}

          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1;
            const dayItems = byDay[day] ?? [];
            const isToday = day === today.getDate() && monthIdx === today.getMonth() && year === today.getFullYear();
            const isSelected = selectedDay === day;
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(isSelected ? null : day)}
                className={cn(
                  'min-h-24 rounded-md border p-1 text-left flex flex-col transition-colors overflow-hidden',
                  isSelected ? 'border-brand-400/60 bg-brand-500/10'
                    : 'border-border/30 hover:border-border/60 hover:bg-muted/20',
                  isToday && !isSelected && 'border-brand-400/40 bg-brand-500/5',
                )}
              >
                <span className={cn('text-[11px] font-semibold mb-0.5 leading-none', isToday ? 'text-brand-400' : 'text-foreground')}>
                  {day}
                </span>
                <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                  {dayItems.slice(0, 3).map((it, i) => (
                    <div
                      key={`${it.id}-${i}`}
                      className="rounded-sm px-1 py-0.5 text-[9px] font-medium truncate text-white leading-none"
                      style={{ background: it.color }}
                      title={it.title}
                    >
                      {it.title}
                    </div>
                  ))}
                  {dayItems.length > 3 && (
                    <span className="text-[9px] text-muted-foreground px-1">{t('schedule.cal.moreCount', { count: dayItems.length - 3 })}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day panel */}
      {selectedDay != null && (
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">
            {monthName} {selectedDay}, {year}
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              {t('schedule.cal.itemCount', { count: selectedItems.length })}
            </span>
          </h3>
          {selectedItems.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">{t('schedule.cal.nothingScheduled')}</p>
          ) : (
            <div className="space-y-1.5">
              {selectedItems.map((it, i) => (
                <div key={`${it.id}-${i}`} className="flex items-center gap-2.5 rounded-lg border border-border/40 px-3 py-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: it.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{it.title}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {(typeLabels[it.type] ?? it.type)}{it.resourceName ? ` · ${it.resourceName}` : ''}{it.subtitle ? ` · ${it.subtitle}` : ''}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                    {fmtTime(it.start)}–{fmtTime(it.end)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
