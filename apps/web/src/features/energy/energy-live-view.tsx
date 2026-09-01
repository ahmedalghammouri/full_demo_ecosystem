'use client';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, Activity, AlertTriangle, RefreshCw, Cpu, Gauge } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KPICard } from '@/components/widgets/kpi-card';
import { useScope } from '@/hooks/use-scope';
import { useWebSocket } from '@/hooks/use-websocket';
import { api } from '@/services/api.client';
import { cn, timeAgo } from '@/lib/utils';

interface LiveMeter {
  meterId: string; meterNumber: string; name: string; type: string; unit: string;
  scopeKind: string; scopeName: string; machineState: string | null;
  powerKw: number | null; lastValue: number | null; lastAt: string | null;
  inProduction: boolean; executingJobOrders: number; standby: boolean;
}
interface LiveResp { totalPowerKw: number; standbyPowerKw: number; standbyCount: number; meters: LiveMeter[]; }

export function EnergyLiveView() {
  const { t } = useTranslation('modules');
  const { filter } = useScope();
  const { subscribe } = useWebSocket();
  const [livePower, setLivePower] = useState<Record<string, number>>({});

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['energy', 'live', filter],
    queryFn: () => api.get<LiveResp>('/energy/live', { params: { ...filter } }),
    refetchInterval: 5_000,
  });

  // Live power patches from the gateway energy event (between refetches).
  useEffect(() => subscribe('energy:reading', (...args: unknown[]) => {
    const m = args[0] as { meterId?: string; powerKw?: number };
    if (m?.meterId && typeof m.powerKw === 'number') setLivePower(prev => ({ ...prev, [m.meterId!]: m.powerKw! }));
  }), [subscribe]);

  const resp = data ?? { totalPowerKw: 0, standbyPowerKw: 0, standbyCount: 0, meters: [] };
  const meters = resp.meters.map(m => ({ ...m, powerKw: livePower[m.meterId] ?? m.powerKw }));
  const totalPower = meters.reduce((s, m) => s + (m.powerKw ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Activity size={18} className="text-primary" /> {t('energy.live.title')}
            <DataModeBadge mode="live" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('energy.live.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-8 text-xs">
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} /> {t('energy.refresh')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl">
          <KPICard title={t('energy.livePower')} value={parseFloat(totalPower.toFixed(2))} unit="kW" isLoading={isLoading} icon={<Zap size={16} />} />
          <KPICard title={t('energy.standbyPower')} value={resp.standbyPowerKw} unit="kW" colorMode="alarm" isLoading={isLoading} icon={<AlertTriangle size={16} />} subtitle={t('energy.noProduction')} />
          <KPICard title={t('energy.standbyMeters')} value={resp.standbyCount} colorMode="alarm" isLoading={isLoading} icon={<Gauge size={16} />} />
        </div>

        <div className="glass-card rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('energy.colMeter')}</TableHead>
                <TableHead>{t('energy.colScope')}</TableHead>
                <TableHead>{t('energy.colMachineState')}</TableHead>
                <TableHead className="mono">{t('energy.colPower')}</TableHead>
                <TableHead>{t('energy.colProduction')}</TableHead>
                <TableHead>{t('energy.colUpdated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {meters.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">{t('energy.noMetersInScope')}</TableCell></TableRow>
              ) : meters.map(m => (
                <motion.tr key={m.meterId} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className={cn('border-b border-border/50 hover:bg-foreground/[0.03]', m.standby && 'bg-danger-500/[0.06]')}>
                  <TableCell>
                    <div className="font-medium text-sm">{m.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{m.meterNumber}</div>
                  </TableCell>
                  <TableCell><span className="text-xs flex items-center gap-1.5"><Cpu size={12} className="text-muted-foreground" />{m.scopeName} <span className="text-muted-foreground">({m.scopeKind})</span></span></TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{m.machineState ?? '—'}</span></TableCell>
                  <TableCell className="mono font-semibold tabular-nums">{m.powerKw != null ? `${m.powerKw.toFixed(2)} kW` : '—'}</TableCell>
                  <TableCell>
                    {m.inProduction
                      ? <Badge variant="outline" className="text-[10px] text-success-400 border-success-500/30">{t('energy.inProduction', { count: m.executingJobOrders })}</Badge>
                      : m.standby
                        ? <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle size={10} /> {t('energy.standbyDraw')}</Badge>
                        : <Badge variant="secondary" className="text-[10px]">{t('energy.idle')}</Badge>}
                  </TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{m.lastAt ? t('energy.timeAgo', { time: timeAgo(m.lastAt) }) : '—'}</span></TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
