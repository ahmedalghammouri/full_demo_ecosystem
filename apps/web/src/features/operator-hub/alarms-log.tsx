'use client';

/**
 * AlarmsLog — shop-floor alarm history with acknowledge / resolve. Reads GET /alarms
 * (unguarded beyond auth) and uses the ack/resolve endpoints operators can call.
 */

import React from 'react';
import { formatDateTimeShort } from '@/lib/datetime';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react';

import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

type Alarm = {
  id: string;
  code: string | null;
  description: string;
  severity: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  machine: { id: string; name: string; code: string } | null;
};

const SEV: Record<string, string> = {
  CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30',
  HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  MEDIUM: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  LOW: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  INFO: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};
/** Plant time — a tablet with a wrong timezone must not shift alarm times. */
const when = (iso: string) => formatDateTimeShort(iso);

export function AlarmsLog({ limit = 30 }: { limit?: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['alarms', 'log', limit],
    queryFn: () => api.get('/alarms', { params: { limit } }),
    refetchInterval: 15_000,
  });
  const alarms: Alarm[] = (data as any) ?? [];

  const ack = useMutation({
    mutationFn: (id: string) => api.patch(`/alarms/${id}/acknowledge`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alarms'] }); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Ack failed', description: e?.response?.data?.message }),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.patch(`/alarms/${id}/resolve`, {}),
    onSuccess: () => { toast({ title: 'Alarm resolved' }); qc.invalidateQueries({ queryKey: ['alarms'] }); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Resolve failed', description: e?.response?.data?.message }),
  });

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground p-4 text-sm"><Loader2 className="animate-spin" size={15} /> Loading alarms…</div>;
  if (alarms.length === 0) return <div className="text-center text-muted-foreground/70 py-8 text-sm">No alarms.</div>;

  return (
    <ul className="flex flex-col gap-2">
      {alarms.map((a) => {
        const resolved = !!a.resolvedAt;
        const acked = !!a.acknowledgedAt;
        return (
          <li key={a.id} className={cn('rounded-xl border p-3', resolved ? 'border-border/40 opacity-60' : 'border-border/70')}>
            <div className="flex items-start gap-2">
              <span className={cn('mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg border shrink-0', SEV[a.severity] ?? SEV.INFO)}>
                <Bell size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border', SEV[a.severity] ?? SEV.INFO)}>{a.severity}</span>
                  <span className="text-xs font-semibold text-foreground truncate">{a.machine?.code ?? a.machine?.name ?? '—'}</span>
                  {resolved && <span className="text-[10px] text-emerald-400">resolved</span>}
                  {!resolved && acked && <span className="text-[10px] text-sky-400">ack’d</span>}
                </div>
                <div className="text-sm text-foreground/80 mt-0.5">{a.description}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{when(a.triggeredAt)}</div>
              </div>
            </div>
            {!resolved && (
              <div className="flex gap-2 mt-2">
                {!acked && (
                  <button disabled={ack.isPending} onClick={() => ack.mutate(a.id)}
                    className="flex-1 h-8 rounded-lg border border-sky-500/40 text-sky-400 text-xs font-semibold active:scale-95 flex items-center justify-center gap-1">
                    <Check size={13} /> Acknowledge
                  </button>
                )}
                <button disabled={resolve.isPending} onClick={() => resolve.mutate(a.id)}
                  className="flex-1 h-8 rounded-lg border border-emerald-500/40 text-emerald-400 text-xs font-semibold active:scale-95 flex items-center justify-center gap-1">
                  <CheckCheck size={13} /> Resolve
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
