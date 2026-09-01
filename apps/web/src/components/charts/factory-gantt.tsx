'use client';

/**
 * FactoryGantt — the Industry360° "Factory Navigator" Gantt (SkyMes-class, zero deps).
 *
 * One shared, professional resource Gantt for every Planning & Scheduling view:
 *  • Zoom: 30 min · 1 hour · day · week · month (sub-day scales show day → hour cells)
 *  • Two row modes: Machines (resource rows) or expandable Order Tree
 *    (Production Order → Work Order → Job Order steps, chevron expand/collapse,
 *    summary bars on group rows)
 *  • Typed dependency arrows from step relations: FS / SS / FF / SF (+ lag),
 *    colour-coded, drawn between the correct bar endpoints
 *  • Supply lane (material markers) and Demand lane (due diamonds + finish dots
 *    with elbow connectors), toolbar (Gantt View / Actions / Insights / CTP /
 *    Filter / Today / zoom −+), drag-to-move + edge-resize, now line, shading.
 */

import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { getFactoryTimeZone } from '@/lib/datetime';
import { useTranslation } from 'react-i18next';
import {
  Truck, PackageCheck, Cpu, CalendarDays, ChevronDown, ChevronRight,
  Filter as FilterIcon, ZoomIn, ZoomOut, Eye, Workflow, CalendarClock,
  Layers, SlidersHorizontal, ClipboardList, Boxes,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// ── Public types ─────────────────────────────────────────────────
export type FactoryZoom = '30min' | 'hour' | 'day' | 'week' | 'month';
export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface GanttResource {
  id: string;
  name: string;
  sub?: string;
}

/** Order tree node: PO (depth 0) → WO (1) → JO step (leaf w/ taskId). */
export interface GanttTreeNode {
  id: string;
  label: string;
  sub?: string;
  taskId?: string;
  children?: GanttTreeNode[];
}

export interface FactoryTask {
  id: string;
  resourceId: string;
  start: string;
  end: string;
  color: string;
  statusColor?: string;
  label: string;
  tooltip?: string;
  predecessorId?: string | null;
  predecessorType?: DepType;
  orderKey?: string;
  status?: string;
  progress?: number;
}

export interface SupplyMarker { id: string; date: string; color: string; label: string }

export interface DemandMarker {
  id: string;
  orderKey: string;
  color: string;
  dueDate: string | null;
  finish: string;
  late: boolean;
  label: string;
}

export interface GanttAction {
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  disabled?: boolean;
}

interface FactoryGanttProps {
  title?: string;
  tasks: FactoryTask[];
  resources: GanttResource[];
  tree?: GanttTreeNode[];
  supply?: SupplyMarker[];
  demand?: DemandMarker[];
  rangeFrom: string;
  rangeTo: string;
  zoom?: FactoryZoom;
  onZoomChange?: (z: FactoryZoom) => void;
  onTaskMove?: (task: FactoryTask, start: Date, end: Date) => void;
  onTaskClick?: (task: FactoryTask) => void;
  actions?: GanttAction[];
  insights?: React.ReactNode;
  onCtp?: () => void;
  /** 0=Sun … 6=Sat. Plant weekend = Friday (5). */
  nonWorkingDays?: number[];
  statusExtra?: string;
}

// ── Geometry / scales ────────────────────────────────────────────
const DAY = 86_400_000;
const HOUR_MS = 3_600_000;
const PX: Record<FactoryZoom, number> = { '30min': 3072, hour: 1536, day: 260, week: 72, month: 28 };
const ZOOM_ORDER: FactoryZoom[] = ['month', 'week', 'day', 'hour', '30min'];
const ZOOM_LABEL_KEY: Record<FactoryZoom, string> = { '30min': 'gantt.zoom30min', hour: 'gantt.zoomHour', day: 'gantt.zoomDay', week: 'gantt.zoomWeek', month: 'gantt.zoomMonth' };
const ROW_H = 44;
const BAR_H = 24;
const LANE_H = 40;
const LABEL_W = 230;
/** Width reserved for the pinned day/month label in the axis header. */
const DAY_LABEL_W = 118;
const HEADER_H = 64;

const DEP_COLOR: Record<DepType, string> = { FS: '#94a3b8', SS: '#0ea5e9', FF: '#a855f7', SF: '#f59e0b' };

/**
 * The axis works in a "plant frame": every instant is offset by the factory's UTC
 * offset before it is positioned, so the existing getUTC* label readers below
 * yield PLANT-local wall-clock values. Without this the whole timeline rendered
 * in UTC — a work order planned 01 Aug 00:00 Riyadh drew at 31 Jul 21:00.
 *
 * `x()` positions values already in the plant frame (axis ticks, day columns);
 * `xt()` positions REAL instants (task start/end, now, supply/demand dates) and
 * applies the offset itself. Durations are frame-independent, so drag deltas and
 * end-vs-end comparisons need no conversion.
 */
const plantOffsetMs = (at: Date, timeZone: string): number => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(f.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'))
    - Math.floor(at.getTime() / 1000) * 1000;
};
/** Plant-local midnight of `d`, as a pseudo-UTC instant. */
const startOfDayIn = (d: Date, shift: number) => {
  const p = new Date(+d + shift);
  return new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()));
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface FlatRow {
  key: string;
  label: string;
  sub?: string;
  depth: number;
  kind: 'group' | 'leaf' | 'resource';
  taskId?: string;
  nodeId?: string;
  hasChildren?: boolean;
  taskIds: string[]; // all descendant tasks (groups) or self (leaf)
}

export function FactoryGantt({
  title,
  tasks, resources, tree,
  supply = [], demand = [],
  rangeFrom, rangeTo,
  zoom: zoomProp, onZoomChange,
  onTaskMove, onTaskClick,
  actions = [], insights, onCtp,
  nonWorkingDays = [5],
  statusExtra,
}: FactoryGanttProps) {
  const { t } = useTranslation('common');
  const [zoomState, setZoomState] = useState<FactoryZoom>('week');
  const zoom = zoomProp ?? zoomState;
  const setZoom = useCallback((z: FactoryZoom) => {
    if (onZoomChange) onZoomChange(z); else setZoomState(z);
  }, [onZoomChange]);

  const hasTree = !!tree && tree.length > 0;
  const [viewMode, setViewMode] = useState<'resource' | 'tree'>(hasTree ? 'tree' : 'resource');
  // Collapsed by default: a node only expands when its id is in `expanded`.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showLinks, setShowLinks] = useState(true);
  const [showShading, setShowShading] = useState(true);
  const [hiddenOrders, setHiddenOrders] = useState<Set<string>>(new Set());
  const [hiddenResources, setHiddenResources] = useState<Set<string>>(new Set());

  const subDay = zoom === 'hour' || zoom === '30min';
  const pxPerDay = PX[zoom];
  const stepMs = zoom === '30min' ? HOUR_MS / 2 : HOUR_MS;

  // Window
  const tz = getFactoryTimeZone();
  const shift = useMemo(() => plantOffsetMs(new Date(rangeFrom), tz), [rangeFrom, tz]);
  const from = useMemo(() => startOfDayIn(new Date(rangeFrom), shift), [rangeFrom, shift]);
  const to = useMemo(() => {
    const t = startOfDayIn(new Date(rangeTo), shift);
    return +t <= +from ? new Date(+from + (subDay ? 2 : 7) * DAY) : t;
  }, [rangeTo, from, subDay, shift]);
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let t = +from; t <= +to + DAY; t += DAY) out.push(new Date(t));
    return out;
  }, [from, to]);
  const timelineW = days.length * pxPerDay;
  /** Position a value ALREADY in the plant frame (axis ticks, day columns). */
  const x = useCallback((d: string | number | Date) => ((+new Date(d) - +from) / DAY) * pxPerDay, [from, pxPerDay]);
  /** Position a REAL instant — shifts it into the plant frame first. */
  const xt = useCallback(
    (d: string | number | Date) => ((+new Date(d) + shift - +from) / DAY) * pxPerDay,
    [from, pxPerDay, shift],
  );

  // Sub-day tick columns (hours / half-hours)
  const ticks = useMemo(() => {
    if (!subDay) return [];
    const out: { t: number; label: string }[] = [];
    for (let t = +from; t < +to + DAY; t += stepMs) {
      const d = new Date(t);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      out.push({ t, label: zoom === '30min' ? `${hh}:${mm}` : hh });
    }
    return out;
  }, [subDay, from, to, stepMs, zoom]);
  const tickW = (stepMs / DAY) * pxPerDay;

  // ── Filters ──
  const orderKeys = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) if (t.orderKey && !m.has(t.orderKey)) m.set(t.orderKey, t.color);
    return [...m.entries()];
  }, [tasks]);

  const visibleTasks = useMemo(
    () => tasks.filter((t) => !hiddenResources.has(t.resourceId) && !(t.orderKey && hiddenOrders.has(t.orderKey))),
    [tasks, hiddenResources, hiddenOrders],
  );
  const visibleTaskIds = useMemo(() => new Set(visibleTasks.map((t) => t.id)), [visibleTasks]);
  const hiddenCount = tasks.length - visibleTasks.length;
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // ── Rows (resource mode or flattened tree) ──
  const flatRows: FlatRow[] = useMemo(() => {
    if (viewMode === 'resource' || !hasTree) {
      return resources
        .filter((r) => !hiddenResources.has(r.id))
        .map((r) => ({
          key: `res:${r.id}`, label: r.name, sub: r.sub, depth: 0, kind: 'resource' as const,
          taskIds: visibleTasks.filter((t) => t.resourceId === r.id).map((t) => t.id),
        }));
    }
    const rows: FlatRow[] = [];
    const collectTasks = (n: GanttTreeNode): string[] => {
      const own = n.taskId && visibleTaskIds.has(n.taskId) ? [n.taskId] : [];
      return [...own, ...(n.children ?? []).flatMap(collectTasks)];
    };
    const walk = (nodes: GanttTreeNode[], depth: number) => {
      for (const n of nodes) {
        const kids = n.children ?? [];
        const allTasks = collectTasks(n);
        if (allTasks.length === 0 && !n.taskId) continue; // fully filtered out
        if (n.taskId) {
          if (!visibleTaskIds.has(n.taskId)) continue;
          rows.push({ key: `n:${n.id}`, label: n.label, sub: n.sub, depth, kind: 'leaf', taskId: n.taskId, nodeId: n.id, taskIds: allTasks });
        } else {
          rows.push({ key: `n:${n.id}`, label: n.label, sub: n.sub, depth, kind: 'group', nodeId: n.id, hasChildren: kids.length > 0, taskIds: allTasks });
          if (expanded.has(n.id)) walk(kids, depth + 1);
        }
      }
    };
    walk(tree!, 0);
    return rows;
  }, [viewMode, hasTree, tree, resources, hiddenResources, visibleTasks, visibleTaskIds, expanded]);

  // Layout
  const hasSupply = supply.length > 0;
  const hasDemand = demand.length > 0;
  const machinesTop = hasSupply ? LANE_H : 0;
  const rowY = useMemo(() => {
    const m = new Map<string, number>();
    flatRows.forEach((r, i) => m.set(r.key, machinesTop + i * ROW_H));
    return m;
  }, [flatRows, machinesTop]);
  const demandY = machinesTop + flatRows.length * ROW_H;
  const bodyH = demandY + (hasDemand ? LANE_H : 0);

  // Task → row mapping (leaf rows in tree mode, resource rows otherwise)
  const taskRowKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of flatRows) {
      if (r.kind === 'leaf' && r.taskId) m.set(r.taskId, r.key);
      if (r.kind === 'resource') for (const id of r.taskIds) m.set(id, r.key);
    }
    return m;
  }, [flatRows]);

  // Bar positions (for links + connectors)
  const pos = useMemo(() => {
    const p = new Map<string, { x1: number; x2: number; y: number }>();
    for (const t of visibleTasks) {
      const rk = taskRowKey.get(t.id);
      if (!rk) continue;
      const y = (rowY.get(rk) ?? 0) + ROW_H / 2;
      p.set(t.id, { x1: xt(t.start), x2: xt(t.end), y });
    }
    return p;
  }, [visibleTasks, taskRowKey, rowY, x]);

  // Typed dependency links: FS a.end→b.start · SS a.start→b.start · FF a.end→b.end · SF a.start→b.end
  const links = useMemo(() => {
    if (!showLinks) return [];
    const out: { id: string; d: string; color: string; type: DepType }[] = [];
    for (const t of visibleTasks) {
      if (!t.predecessorId) continue;
      const a = pos.get(t.predecessorId);
      const b = pos.get(t.id);
      if (!a || !b) continue;
      const type: DepType = t.predecessorType ?? 'FS';
      const sx = type === 'SS' || type === 'SF' ? a.x1 : a.x2;
      const targetStart = type === 'FS' || type === 'SS';
      const ex = targetStart ? b.x1 : b.x2;
      const sy = a.y, ey = b.y;
      const mid = targetStart ? Math.max(sx + 10, ex - 10) : Math.max(sx + 10, ex + 10);
      const endX = targetStart ? ex - 2 : ex + 2;
      out.push({ id: t.id, d: `M ${sx} ${sy} H ${mid} V ${ey} H ${endX}`, color: DEP_COLOR[type], type });
    }
    return out;
  }, [visibleTasks, pos, showLinks]);

  // Demand connectors: last op of each order → demand dot
  const demandLinks = useMemo(() => {
    if (!hasDemand) return [];
    const lastByOrder = new Map<string, { x2: number; y: number; end: number }>();
    for (const t of visibleTasks) {
      if (!t.orderKey) continue;
      const p = pos.get(t.id);
      if (!p) continue;
      const e = +new Date(t.end);
      const cur = lastByOrder.get(t.orderKey);
      if (!cur || e > cur.end) lastByOrder.set(t.orderKey, { x2: p.x2, y: p.y, end: e });
    }
    const dy = demandY + LANE_H / 2;
    const out: { id: string; d: string; color: string }[] = [];
    for (const dm of demand) {
      if (hiddenOrders.has(dm.orderKey)) continue;
      const lp = lastByOrder.get(dm.orderKey);
      if (!lp) continue;
      out.push({ id: dm.id, d: `M ${lp.x2} ${lp.y} H ${lp.x2 + 10} V ${dy} H ${xt(dm.finish) - 4}`, color: dm.color });
    }
    return out;
  }, [demand, visibleTasks, pos, hasDemand, demandY, hiddenOrders, xt]);

  // ── Drag move / resize ──
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Horizontal scroll offset, tracked so the day label can stay pinned inside its
   * own column. Without it the axis shows bare hours once you scroll into the
   * middle of a day — you can read "15:30" but not WHICH day, which is exactly
   * how a correct plant-local timeline still gets misread as UTC.
   */
  const [scrollX, setScrollX] = useState(0);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; dx: number } | null>(null);

  const onBarDown = (e: React.MouseEvent, t: FactoryTask, mode: 'move' | 'resize') => {
    if (!onTaskMove) { if (mode === 'move') onTaskClick?.(t); return; }
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    setDrag({ id: t.id, mode, dx: 0 });
    const move = (ev: MouseEvent) => setDrag((d) => (d ? { ...d, dx: ev.clientX - startX } : d));
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      const deltaDays = (ev.clientX - startX) / pxPerDay;
      if (Math.abs(deltaDays * DAY) < stepMs / 4) { if (mode === 'move') onTaskClick?.(t); return; }
      const s = new Date(t.start); const en = new Date(t.end);
      if (mode === 'move') onTaskMove(t, new Date(+s + deltaDays * DAY), new Date(+en + deltaDays * DAY));
      else onTaskMove(t, s, new Date(Math.max(+s + 5 * 60_000, +en + deltaDays * DAY)));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const scrollToNow = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, xt(Date.now()) - 260);
  }, [x]);
  useLayoutEffect(() => { scrollToNow(); }, [scrollToNow, zoom]);

  const zoomStep = (dir: 1 | -1) => {
    const i = ZOOM_ORDER.indexOf(zoom);
    setZoom(ZOOM_ORDER[Math.min(ZOOM_ORDER.length - 1, Math.max(0, i + dir))]);
  };

  const nowX = xt(Date.now());
  const showNow = +new Date() + shift >= +from && +new Date() + shift <= +to + DAY;

  const monthBands = useMemo(() => {
    const bands: { label: string; left: number; width: number }[] = [];
    let i = 0;
    while (i < days.length) {
      const m = days[i].getUTCMonth(), y = days[i].getUTCFullYear();
      let j = i;
      while (j < days.length && days[j].getUTCMonth() === m && days[j].getUTCFullYear() === y) j++;
      bands.push({ label: `${MONTHS[m]} ${y}`, left: i * pxPerDay, width: (j - i) * pxPerDay });
      i = j;
    }
    return bands;
  }, [days, pxPerDay]);

  const toggleSet = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };
  const toggleCollapse = (nodeId: string) => toggleSet(expanded, nodeId, setExpanded);

  // All group node ids (for expand-all / collapse-all)
  const allGroupIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (nodes: GanttTreeNode[]) => {
      for (const n of nodes) {
        if (!n.taskId && (n.children ?? []).length > 0) ids.push(n.id);
        walk(n.children ?? []);
      }
    };
    if (hasTree) walk(tree!);
    return ids;
  }, [hasTree, tree]);
  const expandAll = () => setExpanded(new Set(allGroupIds));
  const collapseAll = () => setExpanded(new Set());

  const rowIcon = (r: FlatRow): React.ElementType => {
    if (r.kind === 'resource') return Cpu;
    if (r.kind === 'leaf') return Cpu;
    return r.depth === 0 ? Boxes : ClipboardList;
  };

  // Group summary span
  const groupSpan = (r: FlatRow): { x1: number; x2: number; color: string } | null => {
    let min = Infinity, max = -Infinity, color = '#4c7571';
    for (const id of r.taskIds) {
      const t = taskById.get(id);
      if (!t) continue;
      min = Math.min(min, +new Date(t.start));
      max = Math.max(max, +new Date(t.end));
      color = t.color;
    }
    if (!isFinite(min)) return null;
    return { x1: xt(min), x2: xt(max), color };
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/60 bg-muted/20 flex-wrap">
        {title && <span className="px-2 text-sm font-semibold">{title}</span>}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Layers size={13} /> {t('gantt.view')} <ChevronDown size={12} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {hasTree && (
              <>
                <DropdownMenuLabel className="text-xs">{t('charts.gRows')}</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={viewMode === 'tree'} onCheckedChange={() => setViewMode('tree')} className="text-xs">
                  <Workflow size={12} className="mr-1.5" /> {t('gantt.orderTree')}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={viewMode === 'resource'} onCheckedChange={() => setViewMode('resource')} className="text-xs">
                  <Cpu size={12} className="mr-1.5" /> {t('gantt.machines')}
                </DropdownMenuCheckboxItem>
                {viewMode === 'tree' && (
                  <>
                    <DropdownMenuItem onClick={expandAll} className="text-xs">
                      <ChevronDown size={12} className="mr-1.5" /> {t('gantt.expandAll')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={collapseAll} className="text-xs">
                      <ChevronRight size={12} className="mr-1.5" /> {t('gantt.collapseAll')}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-xs">{t('charts.gTimeScale')}</DropdownMenuLabel>
            {ZOOM_ORDER.map((z) => (
              <DropdownMenuCheckboxItem key={z} checked={zoom === z} onCheckedChange={() => setZoom(z)} className="text-xs">{t(ZOOM_LABEL_KEY[z])}</DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={showLinks} onCheckedChange={(v) => setShowLinks(!!v)} className="text-xs">
              <Workflow size={12} className="mr-1.5" /> {t('gantt.dependencyLinks')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={showShading} onCheckedChange={(v) => setShowShading(!!v)} className="text-xs">
              <SlidersHorizontal size={12} className="mr-1.5" /> {t('gantt.nonWorkingShading')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">
              {t('gantt.links')}: <span style={{ color: DEP_COLOR.FS }}>FS</span> · <span style={{ color: DEP_COLOR.SS }}>SS</span> · <span style={{ color: DEP_COLOR.FF }}>FF</span> · <span style={{ color: DEP_COLOR.SF }}>SF</span>
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>

        {actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">{t('charts.gActions')} <ChevronDown size={12} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {actions.map((a, i) => (
                <DropdownMenuItem key={i} disabled={a.disabled} onClick={a.onClick} className="text-xs">
                  {a.icon && <a.icon size={13} className="mr-1.5" />} {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {insights && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Eye size={13} /> {t('gantt.insights')} <ChevronDown size={12} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-3">{insights}</DropdownMenuContent>
          </DropdownMenu>
        )}

        {onCtp && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onCtp}>
            <CalendarClock size={13} /> {t('gantt.ctp')}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              <FilterIcon size={13} /> {t('gantt.filter')} {hiddenCount > 0 && <span className="text-amber-500">{t('gantt.hidden', { count: hiddenCount })}</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60 max-h-80 overflow-y-auto">
            {orderKeys.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs">{t('charts.gOrders')}</DropdownMenuLabel>
                {orderKeys.map(([key, color]) => (
                  <div key={key} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-muted/50 rounded"
                    onClick={() => toggleSet(hiddenOrders, key, setHiddenOrders)}>
                    <Checkbox checked={!hiddenOrders.has(key)} />
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                    {key}
                  </div>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-xs">{t('charts.gResources')}</DropdownMenuLabel>
            {resources.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-muted/50 rounded"
                onClick={() => toggleSet(hiddenResources, r.id, setHiddenResources)}>
                <Checkbox checked={!hiddenResources.has(r.id)} />
                {r.name}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={scrollToNow}>
            <CalendarDays size={13} /> {t('gantt.today')}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomStep(-1)} title={t('gantt.zoomOut')}><ZoomOut size={14} /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => zoomStep(1)} title={t('gantt.zoomIn')}><ZoomIn size={14} /></Button>
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="flex">
        {/* Left column */}
        <div className="shrink-0 border-r border-border/60 bg-muted/20" style={{ width: LABEL_W }}>
          <div className="flex items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60" style={{ height: HEADER_H }}>
            {viewMode === 'tree' ? t('gantt.orderStep') : t('gantt.machine')}
          </div>
          <div className="relative" style={{ height: bodyH }}>
            {hasSupply && (
              <div className="absolute left-0 right-0 flex items-center gap-2 px-3 border-b border-border/40 bg-muted/40" style={{ top: 0, height: LANE_H }}>
                <span className="w-1 h-5 rounded-full shrink-0 bg-amber-500" />
                <Truck size={13} className="text-muted-foreground shrink-0" />
                <div className="text-xs font-medium">{t('charts.gSupply')}</div>
              </div>
            )}
            {flatRows.map((r) => {
              const Icon = rowIcon(r);
              return (
                <div key={r.key}
                  className="absolute left-0 right-0 flex items-center gap-1.5 border-b border-border/40 pr-2"
                  style={{ top: rowY.get(r.key), height: ROW_H, paddingLeft: 8 + r.depth * 16 }}>
                  {r.kind === 'group' ? (
                    <button onClick={() => toggleCollapse(r.nodeId!)} className="w-4 h-4 flex items-center justify-center shrink-0 hover:bg-muted rounded">
                      {expanded.has(r.nodeId!) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <Icon size={13} className={cn('shrink-0', r.kind === 'group' ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="min-w-0">
                    <div className={cn('text-xs truncate', r.kind === 'group' ? 'font-semibold' : 'font-medium')}>{r.label}</div>
                    {r.sub && <div className="text-[10px] text-muted-foreground truncate">{r.sub}</div>}
                  </div>
                </div>
              );
            })}
            {hasDemand && (
              <div className="absolute left-0 right-0 flex items-center gap-2 px-3 border-b border-border/40 bg-muted/40" style={{ top: demandY, height: LANE_H }}>
                <span className="w-1 h-5 rounded-full shrink-0 bg-pink-500" />
                <PackageCheck size={13} className="text-muted-foreground shrink-0" />
                <div className="text-xs font-medium">{t('charts.gDemand')}</div>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto" onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
          <div className="relative" style={{ width: timelineW }}>
            {/* Scale header */}
            <div className="sticky top-0 z-20 bg-card border-b border-border/60" style={{ height: HEADER_H }}>
              {subDay ? (
                <>
                  {/* day band */}
                  <div className="relative border-b border-border/40" style={{ height: 26 }}>
                    {/* column separators */}
                    {days.map((_, i) => (
                      <div key={`dc${i}`} className="absolute top-0 h-full border-r border-border/40"
                        style={{ left: i * pxPerDay, width: pxPerDay }} />
                    ))}
                    {/* labels, pinned within their own column so the day in view is always named */}
                    {days.map((d, i) => {
                      const colLeft = i * pxPerDay;
                      const colRight = colLeft + pxPerDay;
                      if (colRight < scrollX) return null; // scrolled past
                      const pinned = Math.min(Math.max(scrollX, colLeft), Math.max(colLeft, colRight - DAY_LABEL_W));
                      const inView = scrollX >= colLeft && scrollX < colRight;
                      return (
                        <div key={`dl${i}`}
                          className={cn('absolute top-0 h-full flex items-center px-2 text-[11px] font-semibold whitespace-nowrap',
                            nonWorkingDays.includes(d.getUTCDay()) ? 'text-amber-500/90' : 'text-foreground/80',
                            inView && 'bg-card/95 rounded-e-md shadow-sm')}
                          style={{ left: pinned, width: DAY_LABEL_W, zIndex: inView ? 2 : 1 }}>
                          {DOW_FULL[d.getUTCDay()]} {String(d.getUTCDate()).padStart(2, '0')} {MONTHS[d.getUTCMonth()]}
                        </div>
                      );
                    })}
                  </div>
                  {/* hour / half-hour cells */}
                  <div className="relative" style={{ height: 38 }}>
                    {ticks.map((tk, i) => (
                      <div key={i} className="absolute top-0 h-full flex items-center justify-center text-[9px] text-muted-foreground border-r border-border/30"
                        style={{ left: x(tk.t), width: tickW }}>{tk.label}</div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="relative border-b border-border/40" style={{ height: 22 }}>
                    {monthBands.map((b, i) => (
                      <div key={`mc${i}`} className="absolute top-0 h-full border-r border-border/40"
                        style={{ left: b.left, width: b.width }} />
                    ))}
                    {monthBands.map((b, i) => {
                      if (b.left + b.width < scrollX) return null;
                      const pinned = Math.min(Math.max(scrollX, b.left), Math.max(b.left, b.left + b.width - DAY_LABEL_W));
                      const inView = scrollX >= b.left && scrollX < b.left + b.width;
                      return (
                        <div key={`ml${i}`}
                          className={cn('absolute top-0 h-full flex items-center px-2 text-[11px] font-semibold text-foreground/80 whitespace-nowrap',
                            inView && 'bg-card/95 rounded-e-md shadow-sm')}
                          style={{ left: pinned, width: DAY_LABEL_W, zIndex: inView ? 2 : 1 }}>{b.label}</div>
                      );
                    })}
                  </div>
                  <div className="relative" style={{ height: 21 }}>
                    {days.map((d, i) => (
                      <div key={i} className="absolute top-0 h-full flex items-center justify-center text-[10px] text-muted-foreground border-r border-border/30"
                        style={{ left: i * pxPerDay, width: pxPerDay }}>{String(d.getUTCDate()).padStart(2, '0')}</div>
                    ))}
                  </div>
                  <div className="relative" style={{ height: 21 }}>
                    {days.map((d, i) => (
                      <div key={i} className={cn('absolute top-0 h-full flex items-center justify-center text-[9px] text-muted-foreground/60 border-r border-border/30',
                        nonWorkingDays.includes(d.getUTCDay()) && 'text-amber-500/80')}
                        style={{ left: i * pxPerDay, width: pxPerDay }}>{DOW[d.getUTCDay()]}</div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Body */}
            <div className="relative" style={{ height: bodyH }}>
              {/* grid columns */}
              {subDay
                ? ticks.map((tk, i) => (
                  <div key={`g${i}`} className="absolute top-0 bottom-0 border-r border-border/20" style={{ left: x(tk.t), width: tickW }} />
                ))
                : days.map((d, i) => (
                  <div key={`g${i}`} className="absolute top-0 bottom-0 border-r border-border/20" style={{ left: i * pxPerDay, width: pxPerDay }} />
                ))}

              {/* shading */}
              {showShading && days.map((d, i) => (
                <React.Fragment key={`sh${i}`}>
                  {nonWorkingDays.includes(d.getUTCDay()) && (
                    <div className="absolute top-0 bottom-0 bg-black/25 dark:bg-black/40" style={{ left: i * pxPerDay, width: pxPerDay }} />
                  )}
                  {subDay ? (
                    <div className="absolute top-0 bottom-0 bg-black/15 dark:bg-black/30" style={{ left: i * pxPerDay, width: (6 / 24) * pxPerDay }} />
                  ) : pxPerDay >= 56 && (
                    <div className="absolute top-0 bottom-0 bg-black/15 dark:bg-black/30" style={{ left: i * pxPerDay + pxPerDay * 0.86, width: pxPerDay * 0.14 }} />
                  )}
                </React.Fragment>
              ))}

              {/* lane + row separators */}
              {hasSupply && <div className="absolute left-0 right-0 border-b border-border/30 bg-muted/20" style={{ top: 0, height: LANE_H }} />}
              {flatRows.map((r) => (
                <div key={`ln${r.key}`} className="absolute left-0 right-0 border-b border-border/30" style={{ top: rowY.get(r.key), height: ROW_H }} />
              ))}
              {hasDemand && <div className="absolute left-0 right-0 border-b border-border/30 bg-muted/20" style={{ top: demandY, height: LANE_H }} />}

              {/* now line */}
              {showNow && (
                <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: nowX }}>
                  <div className="w-px h-full bg-red-500/80" />
                  <div className="absolute top-0 -left-[3px] w-[7px] h-[7px] rounded-full bg-red-500" />
                </div>
              )}

              {/* dependency + demand connectors */}
              <svg className="absolute inset-0 pointer-events-none z-10 overflow-visible" width={timelineW} height={bodyH}>
                <defs>
                  <marker id="fg-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
                  </marker>
                </defs>
                {links.map((l) => (
                  <path key={l.id} d={l.d} fill="none" strokeWidth={1.3} stroke={l.color} strokeOpacity={0.75} markerEnd="url(#fg-arrow)">
                    <title>{l.type}</title>
                  </path>
                ))}
                {demandLinks.map((l) => (
                  <path key={`dl${l.id}`} d={l.d} fill="none" strokeWidth={1.2} stroke={l.color} strokeOpacity={0.5} markerEnd="url(#fg-arrow)" />
                ))}
              </svg>

              {/* Supply markers */}
              {hasSupply && supply.map((s) => {
                const sx = xt(s.date);
                if (sx < 0 || sx > timelineW) return null;
                return (
                  <div key={s.id} className="absolute z-20" title={s.label} style={{ left: sx - 6, top: LANE_H / 2 - 6 }}>
                    <div className="w-3 h-3 rounded-full border-2 border-background shadow" style={{ background: s.color }} />
                  </div>
                );
              })}

              {/* Group summary bars (tree mode) */}
              {flatRows.filter((r) => r.kind === 'group').map((r) => {
                const span = groupSpan(r);
                if (!span) return null;
                const y = (rowY.get(r.key) ?? 0) + ROW_H / 2;
                return (
                  <div key={`sum${r.key}`} className="absolute z-[5] rounded-sm"
                    style={{ left: span.x1, width: Math.max(span.x2 - span.x1, 6), top: y - 3, height: 6, background: span.color, opacity: 0.45 }}>
                    <span className="absolute left-0 -top-[3px] w-[3px] h-3" style={{ background: span.color }} />
                    <span className="absolute right-0 -top-[3px] w-[3px] h-3" style={{ background: span.color }} />
                  </div>
                );
              })}

              {/* Task bars (leaf / resource rows) */}
              {visibleTasks.map((t) => {
                const rk = taskRowKey.get(t.id);
                if (!rk) return null;
                const top = (rowY.get(rk) ?? 0) + (ROW_H - BAR_H) / 2;
                const left = xt(t.start);
                const w = Math.max(xt(t.end) - left, 8);
                const isDrag = drag?.id === t.id;
                const dx = isDrag && drag!.mode === 'move' ? drag!.dx : 0;
                const dw = isDrag && drag!.mode === 'resize' ? drag!.dx : 0;
                return (
                  <div key={t.id}
                    onMouseDown={(e) => onBarDown(e, t, 'move')}
                    title={t.tooltip ?? t.label}
                    className={cn('absolute rounded-full flex items-center select-none shadow-sm overflow-hidden group',
                      onTaskMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                      isDrag && 'z-40 ring-2 ring-white/50')}
                    style={{
                      top, left: left + dx, width: Math.max(8, w + dw), height: BAR_H,
                      background: t.color,
                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22), 0 1px 3px rgba(0,0,0,0.35)',
                      opacity: t.status === 'COMPLETE' ? 0.5 : 1,
                    }}>
                    <span className="h-full w-[5px] shrink-0" style={{ background: t.statusColor ?? 'rgba(255,255,255,0.35)' }} />
                    {w + dw > 52 && (
                      <span className="px-1.5 text-[10px] font-semibold text-white truncate drop-shadow">{t.label}</span>
                    )}
                    <span className="h-full w-[5px] shrink-0 ml-auto" style={{ background: 'rgba(0,0,0,0.25)' }} />
                    {onTaskMove && (
                      <span onMouseDown={(e) => onBarDown(e, t, 'resize')}
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/30" />
                    )}
                  </div>
                );
              })}

              {/* Demand markers */}
              {hasDemand && demand.filter((d) => !hiddenOrders.has(d.orderKey)).map((d) => {
                const fx = x(d.finish);
                const dux = d.dueDate ? x(d.dueDate) : null;
                const cy = demandY + LANE_H / 2;
                return (
                  <React.Fragment key={`dm${d.id}`}>
                    {dux !== null && (
                      <div className="absolute z-20" title={`${d.label} — due ${new Date(d.dueDate!).toLocaleDateString()}`}
                        style={{ left: dux - 5, top: cy - 5 }}>
                        <div className="w-2.5 h-2.5 rotate-45 border-2 bg-background" style={{ borderColor: d.late ? '#ef4444' : d.color }} />
                      </div>
                    )}
                    <div className="absolute z-20" title={`${d.label} — finishes ${new Date(d.finish).toLocaleString()}`}
                      style={{ left: fx - 5, top: cy - 5 }}>
                      <div className="w-2.5 h-2.5 rounded-full border-2 border-background shadow" style={{ background: d.color, boxShadow: d.late ? '0 0 0 2px rgba(239,68,68,0.6)' : undefined }} />
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center gap-5 border-t border-border/60 bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>{t('gantt.scheduledTasks')}: <strong className="text-foreground">{visibleTasks.length}</strong></span>
        <span>{t('gantt.hiddenCount')}: <strong className="text-foreground">{hiddenCount}</strong></span>
        <span>{viewMode === 'tree' ? t('gantt.rows') : t('gantt.resources')}: <strong className="text-foreground">{flatRows.length}</strong></span>
        {hasDemand && <span>{t('gantt.orders')}: <strong className="text-foreground">{demand.length}</strong></span>}
        <span className="hidden lg:inline">{t('gantt.links')}: <span style={{ color: DEP_COLOR.FS }}>FS</span>/<span style={{ color: DEP_COLOR.SS }}>SS</span>/<span style={{ color: DEP_COLOR.FF }}>FF</span>/<span style={{ color: DEP_COLOR.SF }}>SF</span></span>
        {statusExtra && <span className="ml-auto">{statusExtra}</span>}
      </div>
    </div>
  );
}
