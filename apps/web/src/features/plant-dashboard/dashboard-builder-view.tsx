'use client';

/**
 * DashboardBuilderView — Phase 2 builder shell. Loads (or creates) the dashboard for
 * a hierarchy entity, manages the background image, and provides a scaled 1920×1080
 * logical canvas onto which widgets are added from the toolbox, moved, and deleted,
 * then saved (draft) and published. Resize, the full properties panel, KPI binding,
 * thresholds/styling and undo/redo arrive in Phase 3; live values in Phase 4.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Save, UploadCloud, Rocket, ArrowLeft, Eye, Grid3x3, Trash2, ImageOff, Loader2, Plus,
  Undo2, Redo2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { WidgetCard } from './widget-card';
import { WidgetPropertiesPanel } from './widget-properties-panel';
import {
  useEntityDashboards, useDashboard, useDashboardMutations, useAuthedImage,
  useKpiCatalog, useScopeOptions, fetchLiveData, buildSubscriptions, groupLive, validateDashboard,
  DEFAULT_CANVAS, type Widget, type Dashboard,
} from './use-plant-dashboard';

const TOOLBOX: { type: string; label: string; w: number; h: number }[] = [
  { type: 'kpiValue', label: 'KPI Value', w: 180, h: 110 },
  { type: 'multiKpi', label: 'Multi-KPI', w: 220, h: 180 },
  { type: 'equipmentStatus', label: 'Equipment Status', w: 220, h: 150 },
  { type: 'lineStatus', label: 'Line Status', w: 220, h: 170 },
  { type: 'oeeSummary', label: 'OEE Summary', w: 240, h: 130 },
  { type: 'productionSummary', label: 'Production Summary', w: 240, h: 150 },
  { type: 'trendChart', label: 'Trend Chart', w: 320, h: 200 },
  { type: 'activeAlarms', label: 'Active Alarms', w: 320, h: 200 },
  { type: 'text', label: 'Text / Label', w: 160, h: 60 },
  { type: 'image', label: 'Image / Icon', w: 120, h: 120 },
  { type: 'navButton', label: 'Navigation Button', w: 160, h: 60 },
];

const uid = () => `w_${Math.random().toString(36).slice(2, 10)}`;

/** Read an image file's natural pixel dimensions (client-side). */
function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function DashboardBuilderView({ entityType, entityId }: { entityType: string; entityId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { data: list, isLoading: listLoading } = useEntityDashboards(entityType, entityId);
  const [dashId, setDashId] = useState<string | null>(null);
  useEffect(() => { if (!dashId && list?.length) setDashId(list[0].id); }, [list, dashId]);

  const { data: loaded } = useDashboard(dashId);
  const m = useDashboardMutations(dashId);

  const { data: kpiCatalog } = useKpiCatalog();
  const { data: scopeOptions } = useScopeOptions();

  // Local editable state
  const [name, setName] = useState('');
  const [widgets, setWidgetsRaw] = useState<Widget[]>([]);
  // `fill` locks the image to the canvas box so widgets never drift off it.
  const [bgSettings, setBgSettings] = useState<Record<string, any>>({ fit: 'fill', opacity: 1 });
  const [canvasSettings, setCanvasSettings] = useState<Record<string, any>>(DEFAULT_CANVAS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Undo / redo history over the widgets array.
  const undoStack = useRef<Widget[][]>([]);
  const redoStack = useRef<Widget[][]>([]);
  const clipboard = useRef<Widget | null>(null);
  const commit = useCallback((next: Widget[] | ((w: Widget[]) => Widget[])) => {
    setWidgetsRaw((prev) => {
      undoStack.current.push(prev);
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      return typeof next === 'function' ? (next as any)(prev) : next;
    });
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    setWidgetsRaw((prev) => { const p = undoStack.current.pop(); if (!p) return prev; redoStack.current.push(prev); setDirty(true); return p; });
  }, []);
  const redo = useCallback(() => {
    setWidgetsRaw((prev) => { const n = redoStack.current.pop(); if (!n) return prev; undoStack.current.push(prev); setDirty(true); return n; });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setName(loaded.name);
    setWidgetsRaw((loaded.widgets ?? []).map((w) => ({ ...w, id: w.id ?? uid() })));
    setBgSettings({ fit: 'fill', opacity: 1, ...(loaded.backgroundSettings ?? {}) });
    setCanvasSettings({ ...DEFAULT_CANVAS, ...(loaded.canvasSettings ?? {}) });
    undoStack.current = []; redoStack.current = [];
    setDirty(false);
  }, [loaded]);

  // Live values in preview mode (so bindings can be verified while building).
  const subs = useMemo(() => (preview ? buildSubscriptions(widgets) : []), [preview, widgets]);
  const { data: liveData } = useQuery({
    queryKey: ['builder-live', dashId, subs.map((s) => `${s.widgetId}:${s.scopeId}:${s.timeRange}`).join(',')],
    queryFn: () => fetchLiveData(subs),
    enabled: preview && subs.length > 0,
    refetchInterval: 5_000,
  });
  const liveByWidget = useMemo(() => groupLive(liveData?.data), [liveData]);

  const canvas = canvasSettings;
  const bgUrl = useAuthedImage(loaded?.backgroundImageUrl ?? null);

  // ── Canvas zoom (FIXED artboard that scrolls; not auto-fit) ─────────────────
  // The artboard keeps its size regardless of side-panel state; the viewport
  // scrolls. Zoom is user-controlled (buttons below) and only auto-fits ONCE on
  // first load so opening the properties panel never resizes the image.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const fittedRef = useRef(false);
  const fitToScreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const pad = 48;
    const s = Math.min((el.clientWidth - pad) / canvas.width, (el.clientHeight - pad) / canvas.height);
    setScale(Math.max(0.1, Math.min(s, 2)));
  }, [canvas.width, canvas.height]);
  const zoomBy = (f: number) => setScale((s) => Math.max(0.1, Math.min(2, Math.round(s * f * 100) / 100)));
  // Fit once when the artboard first has a real size (image loaded / canvas known).
  useEffect(() => {
    if (fittedRef.current) return;
    if (canvas.width && wrapRef.current?.clientWidth) { fittedRef.current = true; fitToScreen(); }
  }, [canvas.width, canvas.height, fitToScreen, loaded]);

  // ── Create dashboard if none exists ─────────────────────────────────────────
  const createDefault = async () => {
    const created: any = await m.create.mutateAsync({
      name: `${entityType.toUpperCase()} Dashboard`, entityType: entityType as any, entityId,
      canvasSettings: DEFAULT_CANVAS,
    });
    setDashId(created.id);
  };

  // ── Widget ops ──────────────────────────────────────────────────────────────
  const addWidget = (t: (typeof TOOLBOX)[number]) => {
    const w: Widget = {
      id: uid(), widgetType: t.type, title: t.label,
      x: Math.round((canvas.width - t.w) / 2), y: Math.round((canvas.height - t.h) / 2),
      width: t.w, height: t.h, zIndex: (widgets.reduce((m, x) => Math.max(m, x.zIndex ?? 1), 0)) + 1, visible: true, locked: false,
      dataConfig: {}, scopeConfig: { scopeType: entityType, scopeId: entityId, timeRange: 'today' }, displayConfig: {},
      refreshConfig: { mode: 'poll', intervalSec: 5 }, thresholdConfig: {},
    };
    commit((ws) => [...ws, w]);
    setSelectedId(w.id!);
  };
  const deleteWidget = (id: string) => { commit((ws) => ws.filter((w) => w.id !== id)); if (selectedId === id) setSelectedId(null); };
  const patchWidget = (id: string, patch: Partial<Widget>) => commit((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const duplicateWidget = (id: string) => {
    const src = widgets.find((w) => w.id === id); if (!src) return;
    const copy: Widget = { ...src, id: uid(), x: src.x + 20, y: src.y + 20, zIndex: (widgets.reduce((m, x) => Math.max(m, x.zIndex ?? 1), 0)) + 1 };
    commit((ws) => [...ws, copy]); setSelectedId(copy.id!);
  };
  const bringToFront = (id: string) => { const max = widgets.reduce((m, x) => Math.max(m, x.zIndex ?? 1), 0); patchWidget(id, { zIndex: max + 1 }); };
  const sendToBack = (id: string) => { const min = widgets.reduce((m, x) => Math.min(m, x.zIndex ?? 1), 1); patchWidget(id, { zIndex: min - 1 }); };

  // Live-move without flooding history: snapshot once on gesture start.
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; mode: 'move' | 'resize'; ow: number; oh: number } | null>(null);
  const startGesture = (e: React.PointerEvent, w: Widget, mode: 'move' | 'resize') => {
    if (preview || w.locked) return;
    e.stopPropagation();
    setSelectedId(w.id!);
    undoStack.current.push(widgets); redoStack.current = [];
    dragRef.current = { id: w.id!, sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, ow: w.width, oh: w.height, mode };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onWidgetPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    const g = canvas.grid || 10; const snap = (n: number) => (canvas.snap && showGrid ? Math.round(n / g) * g : Math.round(n));
    if (d.mode === 'move') {
      setWidgetsRaw((ws) => ws.map((w) => w.id === d.id ? { ...w, x: Math.max(0, snap(d.ox + dx)), y: Math.max(0, snap(d.oy + dy)) } : w));
    } else {
      setWidgetsRaw((ws) => ws.map((w) => w.id === d.id ? { ...w, width: Math.max(60, snap(d.ow + dx)), height: Math.max(40, snap(d.oh + dy)) } : w));
    }
    setDirty(true);
  };
  const onWidgetPointerUp = () => { dragRef.current = null; };

  // Keyboard: delete, copy/paste/duplicate, undo/redo, arrow-move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (!selectedId) return;
      const sel = widgets.find((w) => w.id === selectedId);
      if (mod && e.key.toLowerCase() === 'c') { clipboard.current = sel ?? null; return; }
      if (mod && e.key.toLowerCase() === 'v' && clipboard.current) { e.preventDefault(); const c: Widget = { ...clipboard.current, id: uid(), x: clipboard.current.x + 24, y: clipboard.current.y + 24 }; commit((ws) => [...ws, c]); setSelectedId(c.id!); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateWidget(selectedId); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteWidget(selectedId); return; }
      if (e.key.startsWith('Arrow') && sel && !sel.locked) {
        e.preventDefault(); const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        patchWidget(selectedId, { x: Math.max(0, sel.x + dx), y: Math.max(0, sel.y + dy) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, widgets, commit, undo, redo]);

  // ── Save / publish ──────────────────────────────────────────────────────────
  // Send ONLY the fields the WidgetDto whitelist allows — DB rows carry extra
  // columns (dashboardId/createdAt/updatedAt) that the validator would reject (400).
  const toWidgetPayload = (w: Widget) => ({
    id: w.id, widgetType: w.widgetType, title: w.title,
    x: Math.round(w.x), y: Math.round(w.y), width: Math.round(w.width), height: Math.round(w.height),
    zIndex: w.zIndex ?? 1, rotation: w.rotation ?? 0, locked: !!w.locked, visible: w.visible !== false,
    scopeConfig: w.scopeConfig ?? {}, dataConfig: w.dataConfig ?? {}, displayConfig: w.displayConfig ?? {},
    refreshConfig: w.refreshConfig ?? {}, thresholdConfig: w.thresholdConfig ?? {},
  });
  const doSave = async () => {
    if (!dashId) return;
    await m.save.mutateAsync({
      name, canvasSettings,
      backgroundSettings: { fit: bgSettings.fit, opacity: bgSettings.opacity, position: bgSettings.position },
      widgets: widgets.map(toWidgetPayload),
    } as Partial<Dashboard>);
    setDirty(false);
    toast({ title: 'Dashboard saved' });
  };
  const [validationErrors, setValidationErrors] = useState<Array<{ widgetId: string; message: string }>>([]);
  const doPublish = async () => {
    if (!dashId) return;
    if (dirty) await doSave();
    const errs = await validateDashboard(dashId);
    if (errs.length) {
      setValidationErrors(errs);
      toast({ variant: 'destructive', title: `Fix ${errs.length} issue${errs.length > 1 ? 's' : ''} before publishing` });
      return;
    }
    setValidationErrors([]);
    await m.publish.mutateAsync();
    toast({ title: 'Dashboard published' });
  };

  const onUpload = async (file: File) => {
    if (!dashId) return;
    await m.uploadBackground.mutateAsync(file);
    // Lock the canvas box to the image's aspect ratio so `fill` maps the image 1:1
    // onto the coordinate space — widgets then never drift or rescale relative to it.
    try {
      const dims = await readImageSize(file);
      if (dims?.w && dims?.h) {
        const width = 1920;
        const height = Math.round((1920 * dims.h) / dims.w);
        setCanvasSettings((c) => ({ ...c, width, height }));
        setDirty(true);
      }
    } catch { /* keep default canvas if the image can't be measured */ }
    toast({ title: 'Background updated' });
  };

  const selected = useMemo(() => widgets.find((w) => w.id === selectedId) ?? null, [widgets, selectedId]);

  // ── Empty state (no dashboard yet) ──────────────────────────────────────────
  if (listLoading) return <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>;
  if (!dashId) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
        <Grid3x3 className="opacity-30" size={40} />
        <div>
          <div className="text-lg font-bold">No dashboard for this {entityType}</div>
          <div className="text-sm text-foreground/50">Create one to start designing the live view.</div>
        </div>
        <button onClick={createDefault} disabled={m.create.isPending} className="h-10 px-4 rounded-xl bg-brand-500 text-white font-semibold text-sm inline-flex items-center gap-2">
          {m.create.isPending ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Create dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-var(--header-h,4rem))]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-accent"><ArrowLeft size={16} /></button>
        <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }}
          className="text-base font-bold bg-transparent border-b border-transparent focus:border-border outline-none min-w-[200px]" />
        <span className="text-[11px] text-foreground/45">{entityType} · {loaded?.status ?? 'draft'}{dirty ? ' · unsaved' : ''}</span>
        <div className="flex-1" />
        <button onClick={undo} disabled={undoStack.current.length === 0} className="p-2 rounded-lg hover:bg-accent disabled:opacity-30" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
        <button onClick={redo} disabled={redoStack.current.length === 0} className="p-2 rounded-lg hover:bg-accent disabled:opacity-30" title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
        <button onClick={() => setShowGrid((g) => !g)} className={cn('p-2 rounded-lg text-xs', showGrid ? 'bg-accent' : 'hover:bg-accent')} title="Toggle grid"><Grid3x3 size={15} /></button>
        <button onClick={() => setPreview((p) => !p)} className={cn('h-9 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5', preview ? 'bg-brand-500 text-white' : 'border border-border')}><Eye size={14} /> Preview</button>
        <button onClick={doSave} disabled={m.save.isPending} className="h-9 px-3 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-1.5"><Save size={14} /> Save</button>
        <button onClick={doPublish} disabled={m.publish.isPending} className="h-9 px-3 rounded-lg bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"><Rocket size={14} /> Publish</button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Toolbox */}
        {!preview && (
          <aside className="w-52 shrink-0 border-r border-border overflow-y-auto p-2">
            <div className="text-[10px] font-semibold uppercase text-foreground/45 px-1 mb-1">Components</div>
            <div className="flex flex-col gap-1">
              {TOOLBOX.map((t) => (
                <button key={t.type} onClick={() => addWidget(t)}
                  className="text-left text-xs px-2.5 py-2 rounded-lg border border-border/60 hover:bg-accent hover:border-brand-400/40 transition flex items-center gap-2">
                  <Plus size={12} className="text-brand-400" /> {t.label}
                </button>
              ))}
            </div>

            <div className="text-[10px] font-semibold uppercase text-foreground/45 px-1 mt-4 mb-1">Background</div>
            <label className="text-xs px-2.5 py-2 rounded-lg border border-border/60 hover:bg-accent cursor-pointer flex items-center gap-2">
              <UploadCloud size={13} className="text-brand-400" /> {loaded?.backgroundImageUrl ? 'Replace image' : 'Upload image'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ''; }} />
            </label>
            {loaded?.backgroundImageUrl && (
              <button onClick={() => m.removeBackground.mutate()} className="w-full mt-1 text-xs px-2.5 py-2 rounded-lg border border-border/60 hover:bg-accent flex items-center gap-2 text-red-400"><ImageOff size={13} /> Remove image</button>
            )}
            <div className="mt-2 px-1 space-y-2">
              <label className="text-[11px] text-foreground/60 flex flex-col gap-1">Fit
                <select value={bgSettings.fit} onChange={(e) => { setBgSettings((s) => ({ ...s, fit: e.target.value })); setDirty(true); }}
                  className="h-8 rounded-lg bg-muted/40 border border-border px-2 text-xs">
                  {['cover', 'contain', 'fill', 'none'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-foreground/60 flex flex-col gap-1">Opacity {Math.round((bgSettings.opacity ?? 1) * 100)}%
                <input type="range" min={0.1} max={1} step={0.05} value={bgSettings.opacity ?? 1}
                  onChange={(e) => { setBgSettings((s) => ({ ...s, opacity: Number(e.target.value) })); setDirty(true); }} />
              </label>
            </div>
          </aside>
        )}

        {/* Canvas — FIXED artboard inside a scrollable viewport (does not resize
            when the side panels open/close; the viewport scrolls instead). */}
        <div className="flex-1 relative min-w-0">
          <div ref={wrapRef} className="absolute inset-0 overflow-auto bg-[#0b1120]" onPointerDown={() => setSelectedId(null)}>
            {/* Flex wrapper: centers the artboard when it fits, scrolls when it doesn't. */}
            <div className="min-w-full min-h-full flex p-8">
              {/* Sizer reserves the SCALED footprint so scrollbars are accurate. */}
              <div className="m-auto shrink-0" style={{ width: canvas.width * scale, height: canvas.height * scale }}>
          <div
            className="relative shadow-2xl"
            style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            onPointerMove={onWidgetPointerMove}
            onPointerUp={onWidgetPointerUp}
          >
            {/* Background */}
            <div className="absolute inset-0 bg-slate-800" style={{ opacity: bgSettings.opacity ?? 1 }}>
              {bgUrl
                ? <img src={bgUrl} alt="" className="w-full h-full" style={{ objectFit: (bgSettings.fit ?? 'fill') as any }} draggable={false} />
                : <div className="w-full h-full flex items-center justify-center text-slate-500 text-2xl">Upload a background layout image</div>}
            </div>
            {/* Grid */}
            {showGrid && !preview && (
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: 'linear-gradient(rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.12) 1px, transparent 1px)',
                backgroundSize: `${(canvas.grid || 10) * 4}px ${(canvas.grid || 10) * 4}px`,
              }} />
            )}
            {/* Widgets */}
            {widgets.filter((w) => preview ? w.visible !== false : true).map((w) => (
              <div
                key={w.id}
                onPointerDown={(e) => startGesture(e, w, 'move')}
                className={cn('absolute', w.visible === false && 'opacity-40',
                  !preview && !w.locked && 'cursor-move', selectedId === w.id && !preview && 'ring-2 ring-brand-400')}
                style={{ left: w.x, top: w.y, width: w.width, height: w.height, zIndex: w.zIndex ?? 1 }}
              >
                <WidgetCard widget={w} live={preview ? liveByWidget.get(w.id!) : undefined} />
                {!preview && selectedId === w.id && !w.locked && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); deleteWidget(w.id!); }}
                      className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg z-10">
                      <Trash2 size={12} />
                    </button>
                    {/* Resize handle */}
                    <div
                      onPointerDown={(e) => startGesture(e, w, 'resize')}
                      className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-sm bg-brand-400 cursor-nwse-resize z-10"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
              </div>
            </div>
          </div>

          {/* Zoom controls — pinned to the viewport corner (don't scroll) */}
          <div className="absolute bottom-3 right-3 flex items-center gap-0.5 bg-slate-900/85 border border-border/60 rounded-lg px-1 py-0.5 backdrop-blur">
            <button onClick={() => zoomBy(1 / 1.2)} className="px-2 py-1 text-slate-300 hover:text-white text-sm">−</button>
            <button onClick={fitToScreen} className="px-1.5 py-1 text-[10px] text-slate-300 hover:text-white tabular-nums" title="Fit to screen">{Math.round(scale * 100)}%</button>
            <button onClick={() => zoomBy(1.2)} className="px-2 py-1 text-slate-300 hover:text-white text-sm">+</button>
            <button onClick={() => setScale(1)} className="px-1.5 py-1 text-[10px] text-slate-400 hover:text-white border-l border-border/60" title="Actual size">1:1</button>
          </div>

          {/* Validation errors (click to select the affected card) */}
          {validationErrors.length > 0 && !preview && (
            <div className="absolute bottom-3 left-3 max-w-sm max-h-48 overflow-y-auto bg-slate-900/95 border border-red-500/40 rounded-lg p-2 text-[11px] shadow-xl">
              <div className="flex items-center justify-between mb-1 text-red-400 font-semibold">
                <span>{validationErrors.length} validation issue{validationErrors.length > 1 ? 's' : ''}</span>
                <button onClick={() => setValidationErrors([])} className="text-slate-400 hover:text-white">✕</button>
              </div>
              {validationErrors.map((e, i) => (
                <button key={i} onClick={() => setSelectedId(e.widgetId)} className="block w-full text-left px-1.5 py-1 rounded hover:bg-red-500/10 text-slate-200">
                  • {e.message}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Properties */}
        {!preview && selected && (
          <WidgetPropertiesPanel
            widget={selected}
            kpiCatalog={kpiCatalog}
            scopeOptions={scopeOptions}
            onChange={(patch) => patchWidget(selected.id!, patch)}
            actions={{
              duplicate: () => duplicateWidget(selected.id!),
              remove: () => deleteWidget(selected.id!),
              toggleLock: () => patchWidget(selected.id!, { locked: !selected.locked }),
              toggleVisible: () => patchWidget(selected.id!, { visible: selected.visible === false }),
              front: () => bringToFront(selected.id!),
              back: () => sendToBack(selected.id!),
            }}
          />
        )}
      </div>
    </div>
  );
}
