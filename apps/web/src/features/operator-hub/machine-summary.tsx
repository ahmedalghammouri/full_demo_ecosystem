'use client';

/**
 * MachineSummary — compact shop-floor dashboard: a running/stopped bar across all
 * machines plus tiles for shift, active alarms, downtime and maintenance requests
 * raised. Reads live machine states (GET /iot/machines/states), shift analysis,
 * alarm KPIs and the caller's maintenance requests.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bell, Clock, Wrench, Factory } from 'lucide-react';

import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

type MState = { id: string; code: string; name: string; state: string; oee: number };

const RUN = new Set(['RUNNING']);
const PLANNED = new Set(['PLANNED_STOP', 'MAINTENANCE']);
const STATE_COLOR: Record<string, string> = {
  RUNNING: '#22c55e', IDLE: '#64748b', PLANNED_STOP: '#3b82f6', BREAKDOWN: '#ef4444',
  SETUP: '#f59e0b', CHANGEOVER: '#f59e0b', STARVED: '#f97316', BLOCKED: '#f97316',
  MAINTENANCE: '#a855f7', OFFLINE: '#475569',
};

export function MachineSummary() {
  const { data: statesData } = useQuery({
    queryKey: ['machine-states'],
    queryFn: () => api.get('/iot/machines/states'),
    refetchInterval: 10_000,
  });
  const { data: shiftA } = useQuery({
    queryKey: ['shift-analysis'],
    queryFn: () => api.get('/shifts/analysis'),
    refetchInterval: 20_000,
  });
  const { data: alarmKpis } = useQuery({
    queryKey: ['alarm-kpis'],
    queryFn: () => api.get('/alarms/kpis'),
    refetchInterval: 15_000,
  });
  const { data: myReq } = useQuery({
    queryKey: ['my-maint-requests'],
    queryFn: () => api.get('/maintenance/work-orders', { params: { type: 'CORRECTIVE', limit: 100 } }).catch(() => null),
    refetchInterval: 30_000,
  });

  const machines: MState[] = (statesData as any) ?? [];
  const running = machines.filter((m) => RUN.has(m.state)).length;
  const stopped = machines.length - running;
  const shift: any = shiftA;
  const downtimeMins = Math.round(shift?.totals?.downtimeMins ?? 0);
  const alarms = (alarmKpis as any)?.active ?? 0;
  const maintReqs = (() => {
    const rows = (myReq as any)?.data ?? (myReq as any) ?? [];
    return Array.isArray(rows) ? rows.length : 0;
  })();

  // Ordered segments for the running/stopped bar.
  const segments = useMemo(
    () => [...machines].sort((a, b) => a.code.localeCompare(b.code)),
    [machines],
  );

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      {/* Running / stopped bar */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold text-foreground flex items-center gap-1.5"><Factory size={15} /> Machines</div>
        <div className="text-xs text-foreground/50">
          <span className="text-green-400 font-semibold">{running} running</span> · <span className="text-red-400 font-semibold">{stopped} stopped</span>
        </div>
      </div>
      <div className="flex gap-0.5 h-6 rounded-lg overflow-hidden mb-1">
        {segments.length === 0 ? (
          <div className="flex-1 bg-muted" />
        ) : segments.map((m) => (
          <div key={m.id} title={`${m.code} · ${m.state}`} className="flex-1 min-w-[6px]" style={{ background: STATE_COLOR[m.state] ?? '#475569' }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mb-3">
        {segments.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1 text-[10px] text-foreground/50">
            <span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOR[m.state] ?? '#475569' }} /> {m.code}
          </span>
        ))}
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-4 gap-2">
        <SumTile icon={<Activity size={14} />} label="Shift" value={shift?.status?.active?.name ? shift.status.active.name.split('—')[0].trim() : '—'} />
        <SumTile icon={<Bell size={14} />} label="Alarms" value={String(alarms)} tone={alarms > 0 ? 'red' : 'default'} />
        <SumTile icon={<Clock size={14} />} label="Downtime" value={`${downtimeMins}m`} tone={downtimeMins > 0 ? 'amber' : 'default'} />
        <SumTile icon={<Wrench size={14} />} label="Maint. reqs" value={String(maintReqs)} tone={maintReqs > 0 ? 'amber' : 'default'} />
      </div>
    </div>
  );
}

function SumTile({ icon, label, value, tone = 'default' }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  const toneCls: Record<string, string> = { default: 'text-foreground', red: 'text-red-400', amber: 'text-amber-400' };
  return (
    <div className="rounded-xl bg-muted/40 p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase text-foreground/45">{icon}{label}</div>
      <div className={cn('text-base font-bold tabular-nums mt-0.5 truncate', toneCls[tone])}>{value}</div>
    </div>
  );
}
