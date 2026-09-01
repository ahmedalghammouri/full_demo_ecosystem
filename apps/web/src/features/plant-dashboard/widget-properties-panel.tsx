'use client';

/**
 * WidgetPropertiesPanel — the right-side card configuration panel: General, Data
 * (KPI binding, per widget type), Scope (independent per card), Refresh, Thresholds
 * (conditional formatting) and Style. Emits partial patches to the selected widget.
 */

import React, { useMemo, useState } from 'react';
import {
  Copy, Lock, Unlock, Eye, EyeOff, BringToFront, SendToBack, Trash2,
  Plus, ChevronUp, ChevronDown, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Widget } from './use-plant-dashboard';

type KpiMeta = { code: string; label: string; category: string; unit: string; decimals: number };

const TIME_RANGES = ['current', 'today', 'shift', 'week', 'month'];
const REFRESH_INTERVALS = [1, 2, 5, 10, 30, 60, 300];
const OPS = [
  ['gte', '≥'], ['gt', '>'], ['lte', '≤'], ['lt', '<'], ['eq', '='], ['ne', '≠'], ['between', 'between'],
];
const SCOPE_TYPES = ['plant', 'area', 'line', 'machine'];

function flattenScope(scopeOptions: any[] | undefined, type: string): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const f of scopeOptions ?? []) {
    if (type === 'plant') out.push({ id: f.id, label: `${f.code} — ${f.name}` });
    for (const a of f.areas ?? []) {
      if (type === 'area') out.push({ id: a.id, label: `${a.code} — ${a.name}` });
      for (const l of a.productionLines ?? []) {
        if (type === 'line') out.push({ id: l.id, label: `${l.code} — ${l.name}` });
        for (const mch of l.machines ?? []) {
          if (type === 'machine') out.push({ id: mch.id, label: `${mch.code} — ${mch.name}` });
        }
      }
    }
  }
  return out;
}

const inputCls = 'h-8 w-full rounded-lg bg-muted/40 border border-border px-2 text-xs focus:outline-none focus:border-brand-400';
const labelCls = 'text-[11px] text-foreground/60 flex flex-col gap-1';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-border/50">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase text-foreground/50">
        {title}{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

export function WidgetPropertiesPanel({
  widget, kpiCatalog, scopeOptions, onChange, actions,
}: {
  widget: Widget;
  kpiCatalog: KpiMeta[] | undefined;
  scopeOptions: any[] | undefined;
  onChange: (patch: Partial<Widget>) => void;
  actions: {
    duplicate: () => void; remove: () => void; toggleLock: () => void; toggleVisible: () => void;
    front: () => void; back: () => void;
  };
}) {
  const data = widget.dataConfig ?? {};
  const scope = widget.scopeConfig ?? {};
  const disp = widget.displayConfig ?? {};
  const refresh = widget.refreshConfig ?? {};
  const rules: any[] = widget.thresholdConfig?.rules ?? [];

  const setData = (p: Record<string, any>) => onChange({ dataConfig: { ...data, ...p } });
  const setScope = (p: Record<string, any>) => onChange({ scopeConfig: { ...scope, ...p } });
  const setDisp = (p: Record<string, any>) => onChange({ displayConfig: { ...disp, ...p } });
  const setRefresh = (p: Record<string, any>) => onChange({ refreshConfig: { ...refresh, ...p } });
  const setRules = (r: any[]) => onChange({ thresholdConfig: { ...(widget.thresholdConfig ?? {}), rules: r } });

  const scopeList = useMemo(() => flattenScope(scopeOptions, scope.scopeType ?? 'machine'), [scopeOptions, scope.scopeType]);

  const pickKpi = (code: string) => {
    const meta = kpiCatalog?.find((k) => k.code === code);
    setData({ kpiCode: code, unit: meta?.unit ?? '', decimals: meta?.decimals ?? 0, kpiLabel: meta?.label });
  };

  return (
    <aside className="w-64 shrink-0 border-l border-border overflow-y-auto">
      {/* Card action toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50">
        <IconBtn title="Duplicate" onClick={actions.duplicate}><Copy size={14} /></IconBtn>
        <IconBtn title={widget.locked ? 'Unlock' : 'Lock'} onClick={actions.toggleLock}>{widget.locked ? <Lock size={14} /> : <Unlock size={14} />}</IconBtn>
        <IconBtn title={widget.visible === false ? 'Show' : 'Hide'} onClick={actions.toggleVisible}>{widget.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}</IconBtn>
        <IconBtn title="Bring to front" onClick={actions.front}><BringToFront size={14} /></IconBtn>
        <IconBtn title="Send to back" onClick={actions.back}><SendToBack size={14} /></IconBtn>
        <div className="flex-1" />
        <IconBtn title="Delete" onClick={actions.remove} danger><Trash2 size={14} /></IconBtn>
      </div>

      <Section title="General">
        <label className={labelCls}>Title
          <input value={widget.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} className={inputCls} />
        </label>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Toggle label="Title" checked={disp.showTitle !== false} onChange={(v) => setDisp({ showTitle: v })} />
          <Toggle label="Border" checked={disp.showBorder !== false} onChange={(v) => setDisp({ showBorder: v })} />
          <Toggle label="Status dot" checked={disp.showStatusIndicator !== false} onChange={(v) => setDisp({ showStatusIndicator: v })} />
        </div>
      </Section>

      {/* Data binding — depends on widget type */}
      <Section title="Data">
        {widget.widgetType === 'kpiValue' && (
          <>
            <label className={labelCls}>KPI
              <select value={data.kpiCode ?? ''} onChange={(e) => pickKpi(e.target.value)} className={inputCls}>
                <option value="">Select KPI…</option>
                {kpiCatalog?.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelCls}>Unit<input value={data.unit ?? ''} onChange={(e) => setData({ unit: e.target.value })} className={inputCls} /></label>
              <label className={labelCls}>Decimals<input type="number" min={0} max={4} value={data.decimals ?? 0} onChange={(e) => setData({ decimals: Number(e.target.value) })} className={inputCls} /></label>
            </div>
          </>
        )}
        {widget.widgetType === 'multiKpi' && (
          <MultiKpiEditor rows={data.kpis ?? []} kpiCatalog={kpiCatalog} onChange={(rows) => setData({ kpis: rows })} />
        )}
        {widget.widgetType === 'trendChart' && (
          <>
            <label className={labelCls}>KPI
              <select value={data.kpiCode ?? ''} onChange={(e) => pickKpi(e.target.value)} className={inputCls}>
                <option value="">Select KPI…</option>
                {kpiCatalog?.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
              </select>
            </label>
            <label className={labelCls}>Chart type
              <select value={data.chartType ?? 'line'} onChange={(e) => setData({ chartType: e.target.value })} className={inputCls}>
                {['line', 'area', 'bar'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </>
        )}
        {widget.widgetType === 'text' && (
          <label className={labelCls}>Text
            <textarea value={disp.text ?? ''} onChange={(e) => setDisp({ text: e.target.value })} rows={3} className="rounded-lg bg-muted/40 border border-border px-2 py-1.5 text-xs" />
          </label>
        )}
        {widget.widgetType === 'navButton' && (
          <label className={labelCls}>Link (route)
            <input value={disp.href ?? ''} onChange={(e) => setDisp({ href: e.target.value })} placeholder="/oee" className={inputCls} />
          </label>
        )}
        {['oeeSummary', 'productionSummary', 'equipmentStatus', 'lineStatus', 'activeAlarms', 'image'].includes(widget.widgetType) && (
          <div className="text-[10px] text-foreground/40">This card resolves a fixed metric set for its scope.</div>
        )}
      </Section>

      {/* Scope — independent per card */}
      <Section title="Scope">
        <label className={labelCls}>Scope type
          <select value={scope.scopeType ?? 'machine'} onChange={(e) => setScope({ scopeType: e.target.value, scopeId: '' })} className={inputCls}>
            {SCOPE_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className={labelCls}>Entity
          <select value={scope.scopeId ?? ''} onChange={(e) => setScope({ scopeId: e.target.value })} className={inputCls}>
            <option value="">Select {scope.scopeType ?? 'entity'}…</option>
            {scopeList.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label className={labelCls}>Time range
          <select value={scope.timeRange ?? 'today'} onChange={(e) => setScope({ timeRange: e.target.value })} className={inputCls}>
            {TIME_RANGES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      </Section>

      <Section title="Refresh">
        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>Mode
            <select value={refresh.mode ?? 'poll'} onChange={(e) => setRefresh({ mode: e.target.value })} className={inputCls}>
              {['realtime', 'poll', 'manual'].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className={labelCls}>Interval (s)
            <select value={refresh.intervalSec ?? 5} onChange={(e) => setRefresh({ intervalSec: Number(e.target.value) })} className={inputCls}>
              {REFRESH_INTERVALS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>
      </Section>

      {/* Thresholds — conditional formatting */}
      <Section title="Thresholds">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <select value={r.op ?? 'gte'} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, op: e.target.value } : x))} className="h-8 rounded-lg bg-muted/40 border border-border px-1 text-xs">
              {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="number" value={r.value ?? ''} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: Number(e.target.value) } : x))} className="h-8 w-14 rounded-lg bg-muted/40 border border-border px-1 text-xs" />
            {r.op === 'between' && <input type="number" value={r.value2 ?? ''} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value2: Number(e.target.value) } : x))} className="h-8 w-14 rounded-lg bg-muted/40 border border-border px-1 text-xs" />}
            <input type="color" value={r.color ?? '#22c55e'} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} className="h-8 w-8 rounded border border-border bg-transparent" />
            <button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="text-red-400 p-1"><Trash2 size={12} /></button>
          </div>
        ))}
        <button onClick={() => setRules([...rules, { op: 'gte', value: 85, color: '#22c55e' }])} className="text-xs text-brand-400 flex items-center gap-1"><Plus size={12} /> Add rule</button>
      </Section>

      {/* Style */}
      <Section title="Style">
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Background" value={disp.backgroundColor ?? '#0f172a'} onChange={(v) => setDisp({ backgroundColor: v })} />
          <ColorField label="Text" value={disp.textColor ?? '#e2e8f0'} onChange={(v) => setDisp({ textColor: v })} />
          <ColorField label="Border" value={disp.borderColor ?? '#334155'} onChange={(v) => setDisp({ borderColor: v })} />
          <label className={labelCls}>Radius<input type="number" value={disp.borderRadius ?? 12} onChange={(e) => setDisp({ borderRadius: Number(e.target.value) })} className={inputCls} /></label>
          <label className={labelCls}>Padding<input type="number" value={disp.padding ?? 10} onChange={(e) => setDisp({ padding: Number(e.target.value) })} className={inputCls} /></label>
          <label className={labelCls}>Opacity<input type="number" step={0.05} min={0.1} max={1} value={disp.opacity ?? 1} onChange={(e) => setDisp({ opacity: Number(e.target.value) })} className={inputCls} /></label>
        </div>
        <label className={labelCls}>Align
          <select value={disp.align ?? 'left'} onChange={(e) => setDisp({ align: e.target.value })} className={inputCls}>
            {['left', 'center', 'right'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <button onClick={() => onChange({ displayConfig: {} })} className="text-xs text-foreground/50 flex items-center gap-1 mt-1"><RotateCcw size={12} /> Reset styling</button>
      </Section>
    </aside>
  );
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return <button title={title} onClick={onClick} className={cn('p-1.5 rounded-lg hover:bg-accent', danger && 'text-red-400')}>{children}</button>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-foreground/60 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-brand-500" /> {label}
    </label>
  );
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={labelCls}>{label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded border border-border bg-transparent" />
    </label>
  );
}

function MultiKpiEditor({ rows, kpiCatalog, onChange }: { rows: any[]; kpiCatalog: KpiMeta[] | undefined; onChange: (rows: any[]) => void }) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= rows.length) return;
    const copy = [...rows]; [copy[i], copy[j]] = [copy[j], copy[i]]; onChange(copy);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-border/50 p-1.5 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <select value={r.kpiCode ?? ''} onChange={(e) => { const meta = kpiCatalog?.find((k) => k.code === e.target.value); onChange(rows.map((x, j) => j === i ? { ...x, kpiCode: e.target.value, label: x.label ?? meta?.label, unit: meta?.unit, decimals: meta?.decimals } : x)); }} className="h-7 flex-1 rounded bg-muted/40 border border-border px-1 text-xs">
              <option value="">KPI…</option>
              {kpiCatalog?.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
            </select>
            <button onClick={() => move(i, -1)} className="p-1 text-foreground/50"><ChevronUp size={12} /></button>
            <button onClick={() => move(i, 1)} className="p-1 text-foreground/50"><ChevronDown size={12} /></button>
            <button onClick={() => onChange(rows.filter((_, j) => j !== i))} className="p-1 text-red-400"><Trash2 size={12} /></button>
          </div>
          <input value={r.label ?? ''} onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" className="h-7 rounded bg-muted/40 border border-border px-1 text-xs" />
        </div>
      ))}
      <button onClick={() => onChange([...rows, { kpiCode: '', label: '' }])} className="text-xs text-brand-400 flex items-center gap-1"><Plus size={12} /> Add KPI row</button>
    </div>
  );
}
