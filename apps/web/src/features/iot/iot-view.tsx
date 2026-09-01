'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wifi, WifiOff, Radio, Activity, Signal, RefreshCw, Plus, Settings, AlertTriangle, Cpu } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/services/api.client';
import { cn, timeAgo } from '@/lib/utils';

interface IoTDevice {
  id: string;
  name: string;
  protocol: string;
  host: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  machine?: { name: string };
  tagCount?: number;
  lastSeenAt?: string;
}

interface IoTTag {
  id: string;
  name: string;
  code: string;
  dataType: string;
  unit?: string;
  machine?: { name: string };
  device?: { name: string };
  currentValue?: { value: string; quality: string; timestamp: string };
}

const statusConfig = {
  CONNECTED:    { color: 'text-green-400', bg: 'bg-green-500/20',  icon: Wifi,          labelKey: 'overview.statusConnected'    },
  DISCONNECTED: { color: 'text-gray-400',  bg: 'bg-gray-500/20',   icon: WifiOff,        labelKey: 'overview.statusDisconnected' },
  ERROR:        { color: 'text-red-400',   bg: 'bg-red-500/20',    icon: AlertTriangle,  labelKey: 'overview.statusError'        },
};

const qualityColors: Record<string, string> = {
  GOOD:      'text-green-400',
  BAD:       'text-red-400',
  UNCERTAIN: 'text-amber-400',
};

export function IoTView() {
  const { t } = useTranslation(['iot', 'common']);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: devicesData, isLoading: devLoading } = useQuery({
    queryKey: ['iot', 'devices'],
    queryFn: () => api.get('/iot/devices'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: tagsData, isLoading: tagsLoading } = useQuery({
    queryKey: ['iot', 'tags'],
    queryFn: () => api.get('/iot/tags'),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const devices: IoTDevice[] = (devicesData as any)?.data ?? (devicesData as any) ?? [];
  const tags: IoTTag[] = (tagsData as any)?.data ?? (tagsData as any) ?? [];

  const connectedCount = devices.filter(d => d.status === 'CONNECTED').length;
  const protocols = new Set(devices.map(d => d.protocol).filter(Boolean));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('headers.overview.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('headers.overview.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['iot'] });
          }}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('common.refresh')}
          </Button>
          <Button size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {t('common.addDevice')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('overview.statConnectedDevices'), value: `${connectedCount}/${devices.length}`, icon: Wifi,     color: 'text-green-400'  },
          { label: t('overview.statTotalTags'),        value: tags.length,                            icon: Radio,    color: 'text-brand-400'  },
          { label: t('overview.statDataPoints'),       value: tags.filter(t => t.currentValue).length, icon: Activity, color: 'text-cyan-400'  },
          { label: t('overview.statProtocolsActive'),  value: protocols.size || 0,                    icon: Signal,   color: 'text-purple-400' },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="glass-card rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                <Icon className={cn('w-4 h-4', stat.color)} />
              </div>
              <div>
                <div className="text-xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">{t('overview.tabDevices')}</TabsTrigger>
          <TabsTrigger value="tags">{t('overview.tabTags')}</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="mt-4">
          {devLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-40 rounded-xl" />)}
            </div>
          ) : devices.length === 0 ? (
            <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">
              <WifiOff className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <div className="font-medium">{t('overview.noDevices')}</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {devices.map((device, i) => {
                const statusCfg = statusConfig[device.status] ?? statusConfig.DISCONNECTED;
                const StatusIcon = statusCfg.icon;
                return (
                  <motion.div
                    key={device.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={cn(
                      'glass-card rounded-xl p-5 cursor-pointer transition-all',
                      selectedDevice === device.id ? 'ring-1 ring-brand-500' : 'hover:ring-1 hover:ring-white/20',
                    )}
                    onClick={() => setSelectedDevice(device.id === selectedDevice ? null : device.id)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', statusCfg.bg)}>
                          <StatusIcon className={cn('w-4 h-4', statusCfg.color)} />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{device.name}</div>
                          <div className="text-[11px] text-muted-foreground">{device.machine?.name ?? t('overview.noMachine')}</div>
                        </div>
                      </div>
                      {device.protocol && (
                        <Badge variant="outline" className="text-[10px]">{device.protocol}</Badge>
                      )}
                    </div>

                    {device.host && (
                      <div className="text-[11px] font-mono text-muted-foreground mb-3 truncate">{device.host}</div>
                    )}

                    <div className="flex items-center justify-between text-xs">
                      <div className="text-muted-foreground">
                        {device.tagCount != null ? t('overview.tagsCount', { count: device.tagCount }) : ''}
                      </div>
                      <div className={cn('flex items-center gap-1', statusCfg.color)}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                        <span>{device.lastSeenAt ? timeAgo(device.lastSeenAt) : t(statusCfg.labelKey)}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs">
                        <Cpu className="w-3 h-3 mr-1" />{t('overview.tagsBtn')}
                      </Button>
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs">
                        <Settings className="w-3 h-3 mr-1" />{t('overview.configBtn')}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tags" className="mt-4">
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-muted-foreground font-medium">{t('overview.thTagName')}</th>
                  <th className="text-left p-4 text-muted-foreground font-medium">{t('overview.thCode')}</th>
                  <th className="text-right p-4 text-muted-foreground font-medium">{t('overview.thValue')}</th>
                  <th className="text-left p-4 text-muted-foreground font-medium">{t('overview.thQuality')}</th>
                  <th className="text-left p-4 text-muted-foreground font-medium">{t('overview.thMachine')}</th>
                  <th className="text-left p-4 text-muted-foreground font-medium">{t('overview.thUpdated')}</th>
                </tr>
              </thead>
              <tbody>
                {tagsLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="p-4"><div className="shimmer h-4 rounded w-20" /></td>
                      ))}
                    </tr>
                  ))
                ) : tags.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">{t('overview.noTags')}</td>
                  </tr>
                ) : (
                  tags.map(tag => (
                    <tr key={tag.id} className="border-b border-border/50 hover:bg-foreground/5">
                      <td className="p-4 font-medium text-sm">{tag.name}</td>
                      <td className="p-4 font-mono text-xs text-muted-foreground">{tag.code}</td>
                      <td className="p-4 text-right font-mono text-sm">
                        {tag.currentValue ? `${tag.currentValue.value}${tag.unit ? ` ${tag.unit}` : ''}` : '—'}
                      </td>
                      <td className="p-4">
                        {tag.currentValue ? (
                          <span className={cn('text-xs font-medium', qualityColors[tag.currentValue.quality] ?? 'text-muted-foreground')}>
                            {tag.currentValue.quality}
                          </span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">{tag.machine?.name ?? '—'}</td>
                      <td className="p-4 text-xs text-muted-foreground">
                        {tag.currentValue ? timeAgo(tag.currentValue.timestamp) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
