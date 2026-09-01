'use client';

/**
 * PlantLiveIndex — directory of published plant live views with smart grouping
 * (by hierarchy level), search + type filters, and the ability to pick the factory
 * DEFAULT landing view (the one shown after sign-in instead of /apps).
 */

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Loader2, LayoutGrid, ArrowRight, Search, Star, Building2, Layers, Activity, Cpu } from 'lucide-react';

import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { setDefaultDashboard, clearDefaultDashboard } from './use-plant-dashboard';

type PublishedRow = { id: string; name: string; entityType: string; entityId: string; publishedAt: string | null; isDefault?: boolean };

const TYPE_META: Record<string, { label: string; plural: string; icon: React.ReactNode; color: string }> = {
  plant: { label: 'Plant', plural: 'Plants', icon: <Building2 size={14} />, color: 'text-brand-400' },
  area: { label: 'Area', plural: 'Areas', icon: <Layers size={14} />, color: 'text-blue-400' },
  line: { label: 'Line', plural: 'Lines', icon: <Activity size={14} />, color: 'text-cyan-400' },
  machine: { label: 'Machine', plural: 'Machines', icon: <Cpu size={14} />, color: 'text-green-400' },
};
const ORDER = ['plant', 'area', 'line', 'machine'];

export function PlantLiveIndex({ entityType }: { entityType?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>(entityType ?? 'all');

  const { data, isLoading } = useQuery<PublishedRow[]>({
    queryKey: ['plant-published-list', 'all'],
    queryFn: () => api.get('/plant-dashboards/published'),
  });
  const rows = data ?? [];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (typeFilter === 'all' || r.entityType === typeFilter) &&
      (!needle || r.name.toLowerCase().includes(needle) || r.entityType.includes(needle)),
    );
  }, [rows, q, typeFilter]);

  // Group by entity type for smart categorisation.
  const groups = useMemo(() => {
    const m = new Map<string, PublishedRow[]>();
    for (const r of filtered) { const a = m.get(r.entityType) ?? []; a.push(r); m.set(r.entityType, a); }
    return ORDER.filter((t) => m.has(t)).map((t) => ({ type: t, rows: m.get(t)! }));
  }, [filtered]);

  const setDefault = async (r: PublishedRow) => {
    try {
      if (r.isDefault) await clearDefaultDashboard(r.id); else await setDefaultDashboard(r.id);
      await qc.invalidateQueries({ queryKey: ['plant-published-list'] });
      await qc.invalidateQueries({ queryKey: ['plant-default-dashboard'] });
      toast({ title: r.isDefault ? 'Default landing view cleared' : 'Set as default landing view' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e?.response?.data?.message });
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.entityType] = (c[r.entityType] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="max-w-4xl mx-auto px-5 py-6">
      <div className="flex items-center gap-2 mb-1">
        <Monitor className="text-brand-400" size={22} />
        <h1 className="text-xl font-bold">Plant Live Views</h1>
      </div>
      <p className="text-sm text-foreground/50 mb-4">Published dashboards. Open one, or set the ⭐ default that opens after you sign in.</p>

      {/* Search + type filter chips */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search views…"
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted/40 border border-border text-sm focus:outline-none focus:border-brand-400" />
        </div>
        <div className="flex gap-1">
          {['all', ...ORDER].map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={cn('h-9 px-3 rounded-xl text-xs font-semibold border transition',
                typeFilter === t ? 'bg-brand-500 text-white border-brand-500' : 'border-border text-foreground/60 hover:bg-accent')}>
              {t === 'all' ? 'All' : TYPE_META[t].plural} <span className="opacity-60">{counts[t] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/60 p-10 text-center text-foreground/50">
          <LayoutGrid className="mx-auto mb-2 opacity-40" size={28} />
          {rows.length === 0 ? 'No published dashboards yet.' : 'No views match your filter.'}
          {rows.length === 0 && (
            <div className="mt-3"><button onClick={() => router.push('/hierarchy')} className="h-9 px-4 rounded-xl bg-brand-500 text-white text-sm font-semibold">Go to Plant Hierarchy</button></div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => {
            const meta = TYPE_META[g.type];
            return (
              <div key={g.type}>
                <div className={cn('flex items-center gap-1.5 mb-2 text-xs font-bold uppercase tracking-wide', meta.color)}>
                  {meta.icon} {meta.plural} <span className="text-foreground/40">· {g.rows.length}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 p-3 rounded-xl border border-border/60 hover:border-brand-400/40 transition">
                      <button onClick={() => setDefault(r)} title={r.isDefault ? 'Default landing view — click to clear' : 'Set as default landing view'}
                        className={cn('shrink-0 p-1', r.isDefault ? 'text-amber-400' : 'text-foreground/30 hover:text-amber-400')}>
                        <Star size={16} className={r.isDefault ? 'fill-amber-400' : ''} />
                      </button>
                      <button onClick={() => router.push(`/plant-live-view/${r.entityType}/${r.entityId}`)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        <span className="font-semibold truncate">{r.name}</span>
                        {r.isDefault && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Default</span>}
                        <span className="flex-1" />
                        {r.publishedAt && <span className="text-[11px] text-foreground/40">{new Date(r.publishedAt).toLocaleDateString()}</span>}
                        <ArrowRight size={15} className="text-foreground/40" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
