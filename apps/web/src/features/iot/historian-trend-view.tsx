'use client';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, Activity, Search,
  RefreshCw, Trash2, Plus, X, Pause, Play, Radio, Gauge, Cpu, Download,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useWebSocket } from '@/hooks/use-websocket';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────
interface TagDef {
  id: string;
  code: string;
  name: string;
  unit?: string | null;
  device?: { id: string; name: string } | null;
  machine?: { id: string; name: string; code: string } | null;
  line?: { id: string; name: string; code: string } | null;
  area?: { id: string; name: string; code: string } | null;
}
interface Machine { id: string; name: string; code: string }

// A chartable series — raw tag OR a derived OEE/KPI/production metric.
interface SeriesDef {
  key: string;                       // unique dataKey + react key
  label: string;                     // legend label
  unit?: string;
  kind: 'tag' | 'oee' | 'prod';
  tagCode?: string;                  // kind === 'tag'
  machineId?: string;                // kind === 'oee' | 'prod'
  field?: string;                    // oee: availability|performance|quality|oee · prod: good|rejected|rate
}

interface TreeNode {
  key: string;
  label: string;
  icon?: 'folder' | 'machine';
  series?: SeriesDef;                // leaf when set
  children: TreeNode[];
}

// ── Time ranges ───────────────────────────────────────────────────
const RANGES: { labelKey: string; ms: number; everyMin: number }[] = [
  { labelKey: 'historian.rangeLast15Min', ms: 15 * 60_000, everyMin: 0 },
  { labelKey: 'historian.rangeLast1Hour', ms: 60 * 60_000, everyMin: 0 },
  { labelKey: 'historian.rangeLast8Hours', ms: 8 * 3600_000, everyMin: 1 },
  { labelKey: 'historian.rangeLast24Hours', ms: 24 * 3600_000, everyMin: 5 },
  { labelKey: 'historian.rangeLast7Days', ms: 7 * 24 * 3600_000, everyMin: 30 },
];

const PALETTE = ['#4c7571', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];

// OEE / KPI metric leaves offered per machine.
const KPI_METRICS: { field: string; labelKey: string; unit: string; kind: 'oee' | 'prod' }[] = [
  { field: 'oee',            labelKey: 'historian.mOee',            unit: '%',    kind: 'oee' },
  { field: 'oeeTb',          labelKey: 'historian.mOeeTb',          unit: '%',    kind: 'oee' },
  { field: 'availability',   labelKey: 'historian.mAvailability',   unit: '%',    kind: 'oee' },
  { field: 'availabilityTb', labelKey: 'historian.mAvailabilityTb', unit: '%', kind: 'oee' },
  { field: 'performance',    labelKey: 'historian.mPerformance',    unit: '%',    kind: 'oee' },
  { field: 'quality',        labelKey: 'historian.mQuality',        unit: '%',    kind: 'oee' },
  { field: 'good',           labelKey: 'historian.mGood',           unit: 'pcs',  kind: 'prod' },
  { field: 'rejected',       labelKey: 'historian.mRejected',       unit: 'pcs',  kind: 'prod' },
  { field: 'rate',           labelKey: 'historian.mRate',           unit: '/hr',  kind: 'prod' },
];

type TFunc = (key: string) => string;

// ── Tree builders ─────────────────────────────────────────────────
function buildTagTree(tags: TagDef[], tr: TFunc): TreeNode {
  const root = new Map<string, TreeNode>();
  for (const t of tags) {
    const area = t.area?.name ?? tr('historian.defaultArea');
    const sub = t.machine?.name ?? t.line?.name ?? t.device?.name ?? tr('historian.ioGroup');
    let areaNode = root.get(area);
    if (!areaNode) { areaNode = { key: `tag/a:${area}`, label: area, icon: 'folder', children: [] }; root.set(area, areaNode); }
    let subNode = areaNode.children.find((c) => c.label === sub);
    if (!subNode) { subNode = { key: `${areaNode.key}/s:${sub}`, label: sub, icon: 'folder', children: [] }; areaNode.children.push(subNode); }
    subNode.children.push({
      key: `tag:${t.code}`,
      label: t.code,
      series: { key: `tag:${t.code}`, label: t.code, unit: t.unit ?? undefined, kind: 'tag', tagCode: t.code },
      children: [],
    });
  }
  const arr = [...root.values()];
  const sortRec = (nodes: TreeNode[]) => { nodes.sort((a, b) => a.label.localeCompare(b.label)); nodes.forEach((n) => sortRec(n.children)); };
  sortRec(arr);
  return { key: 'root:tags', label: tr('historian.rootTags'), icon: 'folder', children: arr };
}

function buildKpiTree(machines: Machine[], tr: TFunc): TreeNode {
  const children = machines
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map<TreeNode>((m) => ({
      key: `kpi/m:${m.id}`,
      label: `${m.name} (${m.code})`,
      icon: 'machine',
      children: KPI_METRICS.map((metric) => {
        const metricLabel = tr(metric.labelKey);
        return {
          key: `${metric.kind}:${m.id}:${metric.field}`,
          label: metricLabel,
          series: {
            key: `${metric.kind}:${m.id}:${metric.field}`,
            label: `${m.code} ${metricLabel}`,
            unit: metric.unit,
            kind: metric.kind,
            machineId: m.id,
            field: metric.field,
          },
          children: [],
        };
      }),
    }));
  return { key: 'root:kpi', label: tr('historian.rootKpi'), icon: 'folder', children };
}

function filterTree(node: TreeNode, q: string): TreeNode | null {
  if (!q) return node;
  const lower = q.toLowerCase();
  if (node.series) {
    return node.label.toLowerCase().includes(lower) || node.series.label.toLowerCase().includes(lower) ? node : null;
  }
  const kids = node.children.map((c) => filterTree(c, q)).filter(Boolean) as TreeNode[];
  if (kids.length || node.label.toLowerCase().includes(lower)) return { ...node, children: kids };
  return null;
}

// ── Tree node row ─────────────────────────────────────────────────
function TreeRow({
  node, depth, checked, onToggle, expandedAll,
}: {
  node: TreeNode; depth: number; checked: Set<string>;
  onToggle: (s: SeriesDef) => void; expandedAll: boolean;
}) {
  const [open, setOpen] = useState(depth < 1);
  useEffect(() => { setOpen(expandedAll); }, [expandedAll]);

  if (node.series) {
    return (
      <label
        className="flex items-center gap-2 py-1 pr-2 rounded cursor-pointer hover:bg-muted/40 text-xs"
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        <input type="checkbox" checked={checked.has(node.series.key)} onChange={() => onToggle(node.series!)} className="accent-primary" />
        {node.series.kind === 'tag'
          ? <Activity size={13} className="shrink-0 text-muted-foreground" />
          : <Gauge size={13} className="shrink-0 text-indigo-400" />}
        <span className={cn(node.series.kind === 'tag' && 'font-mono text-primary')}>{node.label}</span>
        {node.series.unit && <span className="text-[10px] text-muted-foreground">({node.series.unit})</span>}
      </label>
    );
  }

  const Icon = node.icon === 'machine' ? Cpu : open ? FolderOpen : Folder;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 py-1 pr-2 w-full text-left rounded hover:bg-muted/40 text-xs"
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        {open ? <ChevronDown size={13} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground" />}
        <Icon size={13} className={cn('shrink-0', node.icon === 'machine' ? 'text-cyan-400' : 'text-amber-500')} />
        <span className="font-medium">{node.label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{node.children.length}</span>
      </button>
      {open && node.children.map((c) => (
        <TreeRow key={c.key} node={c} depth={depth + 1} checked={checked} onToggle={onToggle} expandedAll={expandedAll} />
      ))}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────
export function HistorianTrendView() {
  const { t } = useTranslation(['iot', 'common']);
  const { subscribe, isConnected } = useWebSocket();
  const [search, setSearch] = useState('');
  const [expandedAll, setExpandedAll] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SeriesDef[]>([]);
  const [rangeIdx, setRangeIdx] = useState(2); // Last 8 hours
  const [live, setLive] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Merged rows keyed by epoch-second → { [seriesKey]: value }
  const [rows, setRows] = useState<Map<number, Record<string, number>>>(new Map());

  const range = RANGES[rangeIdx];
  const kpiEvery = Math.max(1, range.everyMin); // OEE/prod need a real window

  // ── Catalogue ──
  const { data: tagsResp, isLoading: tagsLoading } = useQuery({
    queryKey: ['iot', 'tags', 'historian-all'],
    queryFn: () => api.get('/iot/tags', { params: { limit: 1000 } }),
    staleTime: 30_000,
  });
  const { data: machinesResp, isLoading: machinesLoading } = useQuery({
    queryKey: ['hierarchy', 'machines', 'historian'],
    queryFn: () => api.get('/hierarchy/machines'),
    staleTime: 60_000,
  });
  const allTags: TagDef[] = (tagsResp as any)?.data ?? (Array.isArray(tagsResp) ? tagsResp : []);
  const machines: Machine[] = Array.isArray(machinesResp) ? machinesResp : ((machinesResp as any)?.data ?? []);

  const roots = useMemo(() => {
    const k = filterTree(buildKpiTree(machines, t), search);
    const g = filterTree(buildTagTree(allTags, t), search);
    return [k, g].filter(Boolean) as TreeNode[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTags, machines, search]);

  const selectedKeys = useMemo(() => selected.map((s) => s.key), [selected]);
  const selKey = selectedKeys.join(',');
  const colorFor = (key: string) => PALETTE[Math.max(0, selectedKeys.indexOf(key)) % PALETTE.length];

  // ── Fetch one series' history into {sec: value} map ──
  const fetchSeries = async (s: SeriesDef, fromIso: string): Promise<[number, number][]> => {
    try {
      if (s.kind === 'tag') {
        const data = await api.get<{ time: string; value: number | null }[]>('/historian/tag-trend', {
          params: { tagCode: s.tagCode, from: fromIso, everyMin: range.everyMin || undefined },
        });
        return data.filter((p) => p.value != null).map((p) => [Math.floor(new Date(p.time).getTime() / 1000), p.value as number]);
      }
      if (s.kind === 'oee') {
        const data = await api.get<any[]>('/historian/oee-trend', { params: { machineId: s.machineId, from: fromIso, everyMin: kpiEvery } });
        return data.filter((p) => p[s.field!] != null).map((p) => [Math.floor(new Date(p.time).getTime() / 1000), Number(p[s.field!])]);
      }
      // prod: good / rejected (cumulative) or rate (units/hr from goodDelta)
      const data = await api.get<any[]>('/historian/production-trend', { params: { machineId: s.machineId, from: fromIso, everyMin: kpiEvery } });
      if (s.field === 'rate') {
        return data.map((p) => [Math.floor(new Date(p.time).getTime() / 1000), Math.round(((p.goodDelta ?? 0) / kpiEvery) * 60)]);
      }
      return data.filter((p) => p[s.field!] != null).map((p) => [Math.floor(new Date(p.time).getTime() / 1000), Number(p[s.field!])]);
    } catch {
      return [];
    }
  };

  // ── Historical seed (selection / range / reload) ──
  useEffect(() => {
    if (!selected.length) { setRows(new Map()); return; }
    let cancelled = false;
    const fromIso = new Date(Date.now() - range.ms).toISOString();
    (async () => {
      const all = await Promise.all(selected.map((s) => fetchSeries(s, fromIso)));
      if (cancelled) return;
      const next = new Map<number, Record<string, number>>();
      all.forEach((series, i) => {
        const key = selected[i].key;
        for (const [sec, v] of series) next.set(sec, { ...(next.get(sec) ?? {}), [key]: v });
      });
      setRows(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, rangeIdx, reloadKey]);

  // ── Live tag updates via WebSocket (kind 'tag', matched by tagCode) ──
  useEffect(() => {
    if (!live) return;
    const byCode = new Map(selected.filter((s) => s.kind === 'tag' && s.tagCode).map((s) => [s.tagCode!, s.key]));
    if (!byCode.size) return;
    return subscribe('iot:tag:updated', (...args: unknown[]) => {
      const m = args[0] as { tagCode?: string; value: unknown; ts?: string };
      const key = m.tagCode ? byCode.get(m.tagCode) : undefined;
      if (!key) return;
      const v = Number(m.value);
      if (Number.isNaN(v)) return;
      const sec = Math.floor((m.ts ? new Date(m.ts).getTime() : Date.now()) / 1000);
      setRows((prev) => { const next = new Map(prev); next.set(sec, { ...(next.get(sec) ?? {}), [key]: v }); return next; });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, selKey, live]);

  // ── Live KPI/OEE polling (no per-second WS; sampled ~1/min) ──
  useEffect(() => {
    if (!live) return;
    const kpiSeries = selected.filter((s) => s.kind !== 'tag');
    if (!kpiSeries.length) return;
    const id = setInterval(async () => {
      const fromIso = new Date(Date.now() - 2 * kpiEvery * 60_000).toISOString();
      const all = await Promise.all(kpiSeries.map((s) => fetchSeries(s, fromIso)));
      setRows((prev) => {
        const next = new Map(prev);
        all.forEach((series, i) => {
          const key = kpiSeries[i].key;
          for (const [sec, v] of series) next.set(sec, { ...(next.get(sec) ?? {}), [key]: v });
        });
        return next;
      });
    }, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, live, rangeIdx]);

  // ── Chart data (windowed + sorted) ──
  const chartData = useMemo(() => {
    const cutoff = (Date.now() - range.ms) / 1000;
    return [...rows.entries()]
      .filter(([k]) => k >= cutoff)
      .sort((a, b) => a[0] - b[0])
      .map(([k, vals]) => ({ t: k * 1000, ...vals }));
  }, [rows, range.ms]);

  // ── Per-series stats over the visible window (last / min / avg / max) ──
  const seriesStats = useMemo(() => {
    const acc: Record<string, { last: number | null; min: number; max: number; sum: number; n: number }> = {};
    for (const s of selected) acc[s.key] = { last: null, min: Infinity, max: -Infinity, sum: 0, n: 0 };
    for (const row of chartData) {
      for (const s of selected) {
        const v = (row as any)[s.key];
        if (typeof v !== 'number' || Number.isNaN(v)) continue;
        const a = acc[s.key];
        a.last = v; a.min = Math.min(a.min, v); a.max = Math.max(a.max, v); a.sum += v; a.n += 1;
      }
    }
    return acc;
  }, [chartData, selected]);

  // ── CSV export of the charted window ──
  const exportCsv = () => {
    if (chartData.length === 0) return;
    const header = ['time', ...selected.map((s) => s.label)];
    const lines = [header.join(',')];
    for (const row of chartData) {
      const cells = [new Date((row as any).t).toISOString(), ...selected.map((s) => {
        const v = (row as any)[s.key];
        return typeof v === 'number' ? String(v) : '';
      })];
      lines.push(cells.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `historian-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Actions ──
  const toggleCheck = (s: SeriesDef) =>
    setChecked((prev) => { const n = new Set(prev); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; });

  const collectLeaves = (node: TreeNode, acc: Map<string, SeriesDef>) => {
    if (node.series) acc.set(node.series.key, node.series);
    node.children.forEach((c) => collectLeaves(c, acc));
  };
  const addSelected = () => {
    const leaves = new Map<string, SeriesDef>();
    roots.forEach((r) => collectLeaves(r, leaves));
    const toAdd = [...checked].map((k) => leaves.get(k)).filter((s): s is SeriesDef => !!s && !selected.some((x) => x.key === s.key));
    if (toAdd.length) setSelected((prev) => [...prev, ...toAdd]);
    setChecked(new Set());
  };

  const removeSeries = (key: string) => setSelected((prev) => prev.filter((s) => s.key !== key));
  const clearAll = () => { setSelected([]); setRows(new Map()); };

  const fmtTime = (t: number) => {
    const d = new Date(t);
    return range.ms <= 24 * 3600_000
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: range.ms <= 3600_000 ? '2-digit' : undefined })
      : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const isLoading = tagsLoading || machinesLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">{t('headers.historian.title')}
            <DataModeBadge mode="live" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.historian.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? 'default' : 'secondary'} className="gap-1 text-[10px] h-6">
            <Radio size={11} className={cn(isConnected && 'animate-pulse')} />
            {isConnected ? t('historian.live') : t('historian.offline')}
          </Badge>
          <Select value={String(rangeIdx)} onValueChange={(v) => setRangeIdx(Number(v))}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((r, i) => <SelectItem key={r.labelKey} value={String(i)}>{t(r.labelKey)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Body: tree | trend */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-0 overflow-hidden">
        {/* ── Browse tree ── */}
        <div className="flex flex-col border-r border-border/50 overflow-hidden">
          <div className="p-3 border-b border-border/40 space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{t('historian.browseTags')}</span>
              <button onClick={() => setExpandedAll((e) => !e)} className="text-[10px] text-muted-foreground hover:text-foreground">
                {expandedAll ? t('historian.collapseAll') : t('historian.expandAll')}
              </button>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('historian.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-7 text-xs" />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2">
            {isLoading ? (
              <div className="space-y-2 p-2">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="shimmer h-4 rounded w-full" />)}</div>
            ) : roots.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-8">{t('historian.noTags')}</p>
            ) : (
              roots.map((n) => <TreeRow key={n.key} node={n} depth={0} checked={checked} onToggle={toggleCheck} expandedAll={expandedAll} />)
            )}
          </div>

          <div className="p-3 border-t border-border/40 shrink-0">
            <Button size="sm" className="w-full gap-1.5 h-8 text-xs" disabled={checked.size === 0} onClick={addSelected}>
              <Plus size={13} />
              {checked.size > 0 ? t('historian.addSelectedCount', { count: checked.size }) : t('historian.addSelected')}
            </Button>
          </div>
        </div>

        {/* ── Trend chart ── */}
        <div className="flex flex-col overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-3 shrink-0 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setLive((l) => !l)}>
              {live ? <Pause size={13} /> : <Play size={13} />}
              {live ? t('historian.pauseLive') : t('historian.resumeLive')}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setReloadKey((k) => k + 1)} title={t('historian.reloadHistory')}>
              <RefreshCw size={13} />
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" disabled={chartData.length === 0} onClick={exportCsv}
              title={t('historian.exportCsv', { defaultValue: 'Export CSV' })}>
              <Download size={13} /> {t('common:actions.export')}
            </Button>
            {selected.length > 0 && (
              <Button size="sm" variant="ghost" className="gap-1.5 h-8 text-xs text-destructive ml-auto" onClick={clearAll}>
                <Trash2 size={13} /> {t('historian.clear')}
              </Button>
            )}
          </div>

          {selected.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 mb-3 shrink-0">
              {selected.map((s) => {
                const st = seriesStats[s.key];
                const fmt = (v: number | null | undefined) => (v == null || !isFinite(v as number) ? '—' : (Math.round((v as number) * 100) / 100).toLocaleString());
                return (
                  <div key={s.key} className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(s.key) }} />
                      <span className={cn('text-[11px] truncate flex-1', s.kind === 'tag' && 'font-mono')} title={s.label}>{s.label}</span>
                      <button onClick={() => removeSeries(s.key)} className="text-muted-foreground/60 hover:text-destructive shrink-0"><X size={12} /></button>
                    </div>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-base font-bold tabular-nums" style={{ color: colorFor(s.key) }}>{fmt(st?.last)}</span>
                      <span className="text-[10px] text-muted-foreground">{s.unit}</span>
                    </div>
                    <div className="text-[9px] text-muted-foreground tabular-nums">
                      {t('historian.min', { defaultValue: 'min' })} {fmt(st?.n ? st.min : null)} · {t('historian.avg', { defaultValue: 'avg' })} {fmt(st?.n ? st.sum / st.n : null)} · {t('historian.max', { defaultValue: 'max' })} {fmt(st?.n ? st.max : null)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex-1 min-h-0 industrial-card p-4">
            {selected.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                <Activity size={36} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">{t('historian.noSource')}</p>
                <p className="text-xs mt-1">{t('historian.noSourceHint')}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  <XAxis
                    dataKey="t" type="number" scale="time" domain={[(Date.now() - range.ms), 'dataMax']}
                    tickFormatter={fmtTime} tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={40}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={48} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {selected.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorFor(s.key)}
                          dot={false} strokeWidth={1.6} connectNulls={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
