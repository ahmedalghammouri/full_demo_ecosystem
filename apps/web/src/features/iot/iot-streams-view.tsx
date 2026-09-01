'use client';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import React from 'react';
import { Plus, Download, Activity, Pause, Play } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KPICard } from '@/components/widgets/kpi-card';
import { api } from '@/services/api.client';

export function IotStreamsView() {
  const { t } = useTranslation(['iot', 'common']);
  const { data: streams, isLoading } = useQuery({
    queryKey: ['iot', 'streams'],
    queryFn: () => api.get('/iot/streams'),
    staleTime: 15_000,
  });

  const { data: kpis } = useQuery({
    queryKey: ['iot', 'streams-kpis'],
    queryFn: () => api.get('/iot/streams/kpis'),
    refetchInterval: 30_000,
  });

  const streamList = (streams as any)?.data ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">{t('headers.streams.title')}
            <DataModeBadge mode="live" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.streams.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            {t('common.export')}
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs">
            <Plus size={13} />
            {t('common.newStream')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('streams.kpiTotal')} value={(kpis as any)?.total ?? 0} isLoading={isLoading} />
          <KPICard title={t('streams.kpiActive')} value={(kpis as any)?.active ?? 0} colorMode="default" isLoading={isLoading} />
          <KPICard title={t('streams.kpiPaused')} value={(kpis as any)?.paused ?? 0} colorMode="alarm" isLoading={isLoading} />
          <KPICard title={t('streams.kpiMessagesPerSec')} value={(kpis as any)?.messagesPerSec ?? 0} isLoading={isLoading} />
        </div>

        <div className="industrial-card p-4">
          <h3 className="text-sm font-semibold mb-4">{t('streams.active')}</h3>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="text-[11px] font-semibold">{t('streams.thName')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('streams.thSource')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('streams.thDestination')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('streams.thStatus')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('streams.thMessages')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('streams.thRate')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('streams.thLatency')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('streams.thActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="shimmer h-3.5 rounded w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : streamList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                      {t('streams.noStreams')}
                    </TableCell>
                  </TableRow>
                ) : (
                  streamList.map((stream: any) => (
                    <TableRow key={stream.id} className="border-border/20 hover:bg-muted/20">
                      <TableCell className="text-xs font-semibold">{stream.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{stream.source}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{stream.destination}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={stream.status === 'ACTIVE' ? 'default' : stream.status === 'PAUSED' ? 'outline' : 'destructive'}
                          className="text-[10px] h-5 gap-1"
                        >
                          <Activity size={10} />
                          {stream.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{stream.messageCount.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{stream.rate}/s</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{stream.latency}ms</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {stream.status === 'ACTIVE' ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Pause size={13} />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Play size={13} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
