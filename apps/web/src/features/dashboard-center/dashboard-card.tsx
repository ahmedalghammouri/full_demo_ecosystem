'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import * as LucideIcons from 'lucide-react';
import {
  Star, ExternalLink, Play, MoreHorizontal, Copy, Pencil, Trash2,
  LayoutDashboard, Factory, Globe, FileText, Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { DashboardCatalogItem, DashboardSource } from './use-dashboard-center';

export function resolveIcon(name?: string | null): React.ElementType {
  if (!name) return LayoutDashboard;
  const Icon = (LucideIcons as unknown as Record<string, React.ElementType>)[name];
  return Icon ?? LayoutDashboard;
}

const SOURCE_META: Record<DashboardSource, { labelKey: string; icon: React.ElementType; cls: string }> = {
  Industry360_NATIVE: { labelKey: 'dashboardCenter.card.srcIndustry360', icon: Factory, cls: 'text-brand-400 border-brand-500/30 bg-brand-500/10' },
  GRAFANA: { labelKey: 'dashboardCenter.card.srcGrafana', icon: Sparkles, cls: 'text-orange-400 border-orange-500/30 bg-orange-500/10' },
  REPORT: { labelKey: 'dashboardCenter.card.srcReport', icon: FileText, cls: 'text-slate-400 border-slate-500/30 bg-slate-500/10' },
  EXTERNAL: { labelKey: 'dashboardCenter.card.srcExternal', icon: Globe, cls: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
  TEMPLATE: { labelKey: 'dashboardCenter.card.srcTemplate', icon: Copy, cls: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
};

interface DashboardCardProps {
  dashboard: DashboardCatalogItem;
  onLaunch: (d: DashboardCatalogItem) => void;
  onToggleFavorite: (d: DashboardCatalogItem) => void;
  onClone?: (d: DashboardCatalogItem) => void;
  onEdit?: (d: DashboardCatalogItem) => void;
  onDelete?: (d: DashboardCatalogItem) => void;
  index?: number;
}

export function DashboardCard({
  dashboard, onLaunch, onToggleFavorite, onClone, onEdit, onDelete, index = 0,
}: DashboardCardProps) {
  const { t } = useTranslation('modules');
  const Icon = resolveIcon(dashboard.icon);
  const source = SOURCE_META[dashboard.source];
  const accent = dashboard.category?.color ?? '#4c7571';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="group industrial-card rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors cursor-pointer"
      onClick={() => onLaunch(dashboard)}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${accent}1f`, color: accent }}
        >
          <Icon size={18} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold leading-snug truncate">{dashboard.title}</h3>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(dashboard); }}
              className="shrink-0 text-muted-foreground hover:text-amber-400 transition-colors"
              aria-label={dashboard.isFavorite ? t('dashboardCenter.card.unfavorite') : t('dashboardCenter.card.favorite')}
            >
              <Star size={15} className={cn(dashboard.isFavorite && 'fill-amber-400 text-amber-400')} />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 min-h-[28px]">
            {dashboard.description}
          </p>
        </div>
      </div>

      {/* Tags */}
      {dashboard.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dashboard.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={cn('text-[9px] h-5 gap-1', source.cls)}>
            <source.icon size={9} />
            {t(source.labelKey)}
          </Badge>
          {dashboard.isFactoryAware && (
            <Badge variant="outline" className="text-[9px] h-5 text-muted-foreground">
              {t('dashboardCenter.card.factoryAware')}
            </Badge>
          )}
          {dashboard.isTemplate && (
            <Badge variant="outline" className="text-[9px] h-5 text-purple-400 border-purple-500/30">
              {t('dashboardCenter.card.srcTemplate')}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {dashboard.isTemplate ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              onClick={(e) => { e.stopPropagation(); onClone?.(dashboard); }}
            >
              <Copy size={12} /> {t('dashboardCenter.card.use')}
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={(e) => { e.stopPropagation(); onLaunch(dashboard); }}
            >
              {dashboard.source === 'GRAFANA' || dashboard.source === 'EXTERNAL'
                ? <ExternalLink size={12} />
                : <Play size={12} />}
              {t('dashboardCenter.card.launch')}
            </Button>
          )}

          {(dashboard.canManage || onClone) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem className="gap-2 text-xs" onClick={() => onLaunch(dashboard)}>
                  <Play size={12} /> {t('dashboardCenter.card.launch')}
                </DropdownMenuItem>
                {onClone && (
                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => onClone(dashboard)}>
                    <Copy size={12} /> {t('dashboardCenter.card.duplicate')}
                  </DropdownMenuItem>
                )}
                {dashboard.canManage && onEdit && (
                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => onEdit(dashboard)}>
                    <Pencil size={12} /> {t('dashboardCenter.card.edit')}
                  </DropdownMenuItem>
                )}
                {dashboard.canManage && !dashboard.isSystem && onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="gap-2 text-xs text-danger-400" onClick={() => onDelete(dashboard)}>
                      <Trash2 size={12} /> {t('dashboardCenter.card.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </motion.div>
  );
}
