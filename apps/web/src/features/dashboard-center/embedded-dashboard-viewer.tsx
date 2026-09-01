'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowLeft, ExternalLink, RefreshCw, Building2, Clock, Maximize2, AlertTriangle, Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { cn } from '@/lib/utils';
import { useFactoryStore } from '@/store/factory-store';
import { useDashboardEmbed, type EmbedContext } from './use-dashboard-center';
import { resolveIcon } from './dashboard-card';

const TIME_RANGES: { value: string; labelKey: string }[] = [
  { value: 'now-1h', labelKey: 'viewer.range1h' },
  { value: 'now-6h', labelKey: 'viewer.range6h' },
  { value: 'now-24h', labelKey: 'viewer.range24h' },
  { value: 'now-7d', labelKey: 'viewer.range7d' },
  { value: 'now-30d', labelKey: 'viewer.range30d' },
];

export function EmbeddedDashboardViewer({ dashboardId }: { dashboardId: string }) {
  const { t } = useTranslation('modules');
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const { selectedFactory } = useFactoryStore();

  const [timeRange, setTimeRange] = useState('now-24h');
  const [reloadKey, setReloadKey] = useState(0);

  const ctx: EmbedContext = useMemo(() => ({
    factoryId: selectedFactory?.id ?? null,
    from: timeRange,
    theme: resolvedTheme === 'light' ? 'light' : 'dark',
  }), [selectedFactory?.id, timeRange, resolvedTheme]);

  const { data, isLoading, error } = useDashboardEmbed(dashboardId, ctx);

  const Icon = resolveIcon(data?.dashboard.icon);
  const iframeUrl = data?.url ? `${data.url}${data.url.includes('?') ? '&' : '?'}_r=${reloadKey}` : null;

  return (
    <div className="flex flex-col h-full">
      {/* Viewer toolbar — keeps users inside Industry360° chrome */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/50 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => router.push('/dashboard-center')}>
            <ArrowLeft size={14} /> {t('dashboardCenter.viewer.catalog')}
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={16} className="text-primary shrink-0" />
            <span className="text-sm font-semibold truncate">{data?.dashboard.title ?? t('dashboardCenter.viewer.loading')}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data?.dashboard.isFactoryAware && (
            <Badge variant="outline" className="h-8 gap-1.5 text-xs">
              <Building2 size={13} className="text-cyan-400" />
              {selectedFactory?.code ?? t('dashboardCenter.viewer.allFactories')}
            </Badge>
          )}

          {/* Time range — applies as Custom from/to */}
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-muted-foreground" />
            <SelectMenu
              value={timeRange}
              onValueChange={setTimeRange}
              menuLabel={t('dashboardCenter.viewer.timeRange')}
              options={TIME_RANGES.map((r) => ({ value: r.value, label: t('dashboardCenter.' + r.labelKey) }))}
            />
          </div>

          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setReloadKey((k) => k + 1)} title={t('dashboardCenter.viewer.reload')}>
            <RefreshCw size={13} />
          </Button>
          {iframeUrl && (
            <Button variant="outline" size="icon" className="h-8 w-8" title={t('dashboardCenter.viewer.openNewTab')}
              onClick={() => window.open(data!.url!, '_blank', 'noopener')}>
              <Maximize2 size={13} />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative bg-background">
        {isLoading ? (
          <div className="absolute inset-0 p-4">
            <div className="shimmer h-full w-full rounded-lg" />
          </div>
        ) : error ? (
          <ViewerMessage
            icon={<AlertTriangle size={22} className="text-danger-400" />}
            title={t('dashboardCenter.viewer.errorTitle')}
            body={t('dashboardCenter.viewer.errorBody')}
            action={<Button size="sm" variant="outline" onClick={() => router.push('/dashboard-center')}>{t('dashboardCenter.viewer.backToCatalog')}</Button>}
          />
        ) : data?.kind === 'native' ? (
          <ViewerMessage
            icon={<ExternalLink size={22} className="text-brand-400" />}
            title={t('dashboardCenter.viewer.nativeTitle')}
            body={t('dashboardCenter.viewer.nativeBody')}
            action={data.route
              ? <Button size="sm" onClick={() => router.push(data.route!)}>{t('dashboardCenter.viewer.openDashboard')}</Button>
              : undefined}
          />
        ) : data?.kind === 'grafana' && !data.embeddable ? (
          <ViewerMessage
            icon={<Settings size={22} className="text-warning-400" />}
            title={data.grafanaConfigured ? t('dashboardCenter.viewer.grafanaNotMappedTitle') : t('dashboardCenter.viewer.grafanaNotConfiguredTitle')}
            body={data.grafanaConfigured
              ? t('dashboardCenter.viewer.grafanaNotMappedBody')
              : t('dashboardCenter.viewer.grafanaNotConfiguredBody')}
          />
        ) : iframeUrl ? (
          <iframe
            key={reloadKey}
            src={iframeUrl}
            title={data?.dashboard.title ?? t('dashboardCenter.viewer.dashboard')}
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="fullscreen"
          />
        ) : (
          <ViewerMessage
            icon={<AlertTriangle size={22} className="text-muted-foreground" />}
            title={t('dashboardCenter.viewer.nothingTitle')}
            body={t('dashboardCenter.viewer.nothingBody')}
          />
        )}
      </div>
    </div>
  );
}

function ViewerMessage({
  icon, title, body, action,
}: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-foreground/5 flex items-center justify-center mb-3">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-md">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
