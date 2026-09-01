'use client';
import { useTranslation } from 'react-i18next';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, BellOff, CheckCheck, Filter, AlertTriangle,
  Info, CheckCircle, Settings, Trash2, RefreshCw, SlidersHorizontal,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNotificationStore } from '@/store/notification-store';
import { api } from '@/services/api.client';
import { cn, timeAgo } from '@/lib/utils';

// ── Config ─────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { icon: typeof Info; color: string; bg: string }> = {
  error:    { icon: AlertTriangle, color: 'text-red-400',   bg: 'bg-red-500/15'    },
  warning:  { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/15'  },
  info:     { icon: Info,          color: 'text-blue-400',  bg: 'bg-blue-500/15'   },
  success:  { icon: CheckCircle,   color: 'text-green-400', bg: 'bg-green-500/15'  },
  critical: { icon: AlertTriangle, color: 'text-red-400',   bg: 'bg-red-500/15'    },
};

const CATEGORY_COLORS: Record<string, string> = {
  alarm:       'text-red-400 bg-red-500/10 border-red-500/30',
  production:  'text-brand-400 bg-brand-500/10 border-brand-500/30',
  quality:     'text-purple-400 bg-purple-500/10 border-purple-500/30',
  maintenance: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  downtime:    'text-orange-400 bg-orange-500/10 border-orange-500/30',
  energy:      'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  inventory:   'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  system:      'text-gray-400 bg-gray-500/10 border-gray-500/30',
};

const SEVERITY_FILTERS = ['all', 'error', 'warning', 'info'];

const CATEGORY_FILTERS = ['all', 'alarm', 'production', 'quality', 'maintenance', 'downtime', 'energy'];

// No entity has a `/[id]` detail route — notifications link to list pages. Strip any
// trailing /<uuid> so legacy deep-links (e.g. /production/orders/<id>) navigate to the
// list instead of 404-ing.
const DETAIL_ID_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
function notifHref(link?: string | null): string | null {
  if (!link) return null;
  return link.replace(DETAIL_ID_RE, '') || link;
}

// ── Types ───────────────────────────────────────────────────────

interface NotifItem {
  id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  isRead: boolean;
  createdAt: string;
  link?: string | null;
  isApiRecord: boolean;
}

// ── Component ───────────────────────────────────────────────────

const PAGE_SIZE = 15;

export function NotificationsView() {
  const { t } = useTranslation('modules');
  const wsMarkAllRead   = useNotificationStore(s => s.markAllRead);
  const setUnreadCount  = useNotificationStore(s => s.setUnreadCount);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();

  const hasFilters = showUnreadOnly || severityFilter !== 'all' || categoryFilter !== 'all';

  // Reset to the first page whenever a filter changes.
  useEffect(() => { setPage(1); }, [severityFilter, categoryFilter, showUnreadOnly]);

  // ── Server-paginated query (filters applied server-side) ─────

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['notifications', { page, severityFilter, categoryFilter, showUnreadOnly }],
    queryFn: () => api.get('/notifications', {
      params: {
        page,
        limit: PAGE_SIZE,
        ...(categoryFilter !== 'all' && { category: categoryFilter }),
        ...(severityFilter !== 'all' && { severity: severityFilter }),
        ...(showUnreadOnly && { isRead: false }),
      },
    }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const apiData = data as any;
  const items: NotifItem[] = (apiData?.data ?? []).map((n: any) => ({
    id: n.id,
    title: n.title,
    message: n.message ?? '',
    severity: n.severity ?? 'info',
    category: n.category ?? 'system',
    isRead: n.isRead,
    createdAt: n.createdAt,
    link: n.link ?? null,
    isApiRecord: true,
  }));

  const total = apiData?.total ?? 0;
  const totalPages = Math.max(1, apiData?.totalPages ?? 1);
  const unreadCount = apiData?.unreadCount ?? 0;

  // Sync the authoritative unread count to the store (drives the bell badge).
  useEffect(() => {
    if (apiData?.unreadCount !== undefined) setUnreadCount(apiData.unreadCount);
  }, [apiData, setUnreadCount]);

  // ── Mutations ────────────────────────────────────────────────

  const markAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      wsMarkAllRead();
      setUnreadCount(0);
      toast({ title: t('notifications.toast.allRead'), variant: 'success' });
    },
    onError: () => toast({ title: t('notifications.toast.allReadFailed'), variant: 'destructive' }),
  });

  const markOneMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({ title: t('notifications.toast.deleted') });
    },
    onError: () => toast({ title: t('notifications.toast.deleteFailed'), variant: 'destructive' }),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post('/notifications/test'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({ title: t('notifications.toast.testSent'), variant: 'success' });
    },
    onError: () => toast({ title: t('notifications.toast.testFailed'), variant: 'destructive' }),
  });

  function clearFilters() {
    setSeverityFilter('all');
    setCategoryFilter('all');
    setShowUnreadOnly(false);
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full p-6 gap-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <Bell className="w-6 h-6 text-primary" />
            {t('notifications.title')}
            {unreadCount > 0 && (
              <Badge className="bg-destructive text-white border-0 text-xs">{unreadCount}</Badge>
            )}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('notifications.subtitle')}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => router.push('/notifications/preferences')} className="gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {t('notifications.btnPreferences')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/notifications/rules')} className="gap-1.5">
            <Settings className="w-3.5 h-3.5" />
            {t('notifications.btnRules')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            {t('notifications.sendTest')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            {t('notifications.refresh')}
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending} className="gap-1.5">
              <CheckCheck className="w-3.5 h-3.5" />
              {t('notifications.markAllRead')}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card rounded-xl p-4 space-y-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground w-14 shrink-0">{t('notifications.severity')}</span>
          {SEVERITY_FILTERS.map((f) => (
            <Button
              key={f}
              variant={severityFilter === f ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSeverityFilter(f)}
              className="h-7 text-xs"
            >
              {t(`notifications.sev.${f}`)}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground w-14 shrink-0">{t('notifications.category')}</span>
          {CATEGORY_FILTERS.map((f) => (
            <Button
              key={f}
              variant={categoryFilter === f ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategoryFilter(f)}
              className="h-7 text-xs"
            >
              {t(`notifications.cat.${f}`)}
            </Button>
          ))}
          <Button
            variant={showUnreadOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowUnreadOnly(!showUnreadOnly)}
            className="h-7 text-xs ms-auto gap-1.5"
          >
            <Filter className="w-3 h-3" />
            {t('notifications.unreadOnly')}
          </Button>
        </div>
      </div>

      {/* List — fills remaining height and scrolls internally */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <div className="glass-card rounded-xl p-12 text-center text-muted-foreground flex-1 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 mb-3 opacity-40 animate-spin" />
            <div className="text-sm">{t('notifications.loading')}</div>
          </div>
        ) : items.length === 0 ? (
          <div className="glass-card rounded-xl p-16 text-center flex-1 flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
              <BellOff className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <div className="font-semibold text-foreground/70 text-base">
              {hasFilters ? t('notifications.noMatch') : t('notifications.noYet')}
            </div>
            <div className="text-muted-foreground text-sm mt-1.5">
              {hasFilters
                ? t('notifications.noMatchHint')
                : t('notifications.noYetHint')}
            </div>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                {t('notifications.clearFilters')}
              </Button>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-y-auto flex-1 divide-y divide-border/50">
            <AnimatePresence initial={false}>
              {items.map((notif) => {
                const cfg = SEVERITY_CONFIG[notif.severity] ?? SEVERITY_CONFIG.info;
                const Icon = cfg.icon;
                return (
                  <motion.div
                    key={notif.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 40, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      'flex items-start gap-4 p-4 group transition-colors',
                      !notif.isRead ? 'bg-foreground/[0.025]' : 'opacity-70',
                      'hover:bg-foreground/[0.04] hover:opacity-100',
                    )}
                  >
                    {/* Severity icon */}
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5', cfg.bg)}>
                      <Icon className={cn('w-4 h-4', cfg.color)} />
                    </div>

                    {/* Content */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        if (!notif.isRead && notif.isApiRecord) {
                          markOneMutation.mutate(notif.id);
                        }
                        const href = notifHref(notif.link);
                        if (href) router.push(href);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className={cn('text-sm font-medium', !notif.isRead && 'text-foreground')}>
                          {notif.title}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {timeAgo(notif.createdAt)}
                          </span>
                          {!notif.isRead && (
                            <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                          )}
                        </div>
                      </div>

                      {notif.message && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                          {notif.message}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge className={cn('text-[10px] py-0 px-1.5 h-4 border', CATEGORY_COLORS[notif.category] ?? '')}>
                          {t(`notifications.cat.${notif.category}`, { defaultValue: notif.category })}
                        </Badge>
                        <Badge variant="outline" className={cn('text-[10px] py-0 px-1.5 h-4', cfg.color)}>
                          {t(`notifications.sev.${notif.severity}`, { defaultValue: notif.severity })}
                        </Badge>
                      </div>
                    </div>

                    {/* Delete button — visible on hover */}
                    {notif.isApiRecord && (
                      <button
                        onClick={() => deleteMutation.mutate(notif.id)}
                        className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-1 rounded hover:bg-destructive/20 hover:text-destructive"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Pagination footer */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-4 shrink-0 text-xs text-muted-foreground">
          <span>
            {t('notifications.page.summary', { total, unread: unreadCount, from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total) })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {t('notifications.page.prev')}
            </Button>
            <span className="px-1 font-medium text-foreground/80">{t('notifications.page.indicator', { page, total: totalPages })}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t('notifications.page.next')}
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
