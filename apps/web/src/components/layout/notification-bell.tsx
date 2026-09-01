'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, CheckCheck, AlertTriangle, Info, CheckCircle, BellOff, Settings,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useNotificationStore } from '@/store/notification-store';
import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, timeAgo } from '@/lib/utils';

interface FeedItem {
  id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  isRead: boolean;
  createdAt: string;
  link?: string | null;
}

// Notifications link to list pages (no `/[id]` detail routes exist). Strip any trailing
// /<uuid> so legacy deep-links navigate to the list instead of 404-ing.
const DETAIL_ID_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
function notifHref(link?: string | null): string | null {
  if (!link) return null;
  return link.replace(DETAIL_ID_RE, '') || link;
}

const SEVERITY_ICON: Record<string, { icon: typeof Info; color: string; bg: string }> = {
  critical: { icon: AlertTriangle, color: 'text-red-400',   bg: 'bg-red-500/15'    },
  error:    { icon: AlertTriangle, color: 'text-red-400',   bg: 'bg-red-500/15'    },
  warning:  { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/15'  },
  success:  { icon: CheckCircle,   color: 'text-green-400', bg: 'bg-green-500/15'  },
  info:     { icon: Info,          color: 'text-blue-400',  bg: 'bg-blue-500/15'   },
};

export function NotificationBell() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const liveNotifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const storeMarkRead = useNotificationStore((s) => s.markRead);
  const storeMarkAllRead = useNotificationStore((s) => s.markAllRead);

  // Recent persisted notifications (so the dropdown is populated on a fresh load,
  // not only with notifications received live this session).
  const { data: recent } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => api.get<{ data: FeedItem[]; unreadCount: number }>('/notifications', { params: { limit: 8 } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Keep the badge authoritative: the server's unreadCount wins on every fetch.
  useEffect(() => {
    if (recent && typeof recent.unreadCount === 'number') setUnreadCount(recent.unreadCount);
  }, [recent, setUnreadCount]);

  // Merge live (WS) + persisted (API), dedupe by id, newest first, cap at 8.
  const items: FeedItem[] = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const n of recent?.data ?? []) map.set(n.id, n);
    for (const n of liveNotifications) {
      if (!map.has(n.id)) {
        map.set(n.id, {
          id: n.id, title: n.title, message: n.message,
          severity: n.severity, category: n.category,
          isRead: n.isRead, createdAt: n.createdAt, link: n.link,
        });
      }
    }
    return [...map.values()]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 8);
  }, [recent, liveNotifications]);

  const markAll = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      storeMarkAllRead();
      setUnreadCount(0);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function handleClick(item: FeedItem) {
    if (!item.isRead) {
      storeMarkRead(item.id);
      markOne.mutate(item.id);
    }
    setOpen(false);
    const href = notifHref(item.link);
    if (href) router.push(href);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
        >
          <Bell size={15} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[360px] p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bell size={14} className="text-primary" />
            {t('notifications.title')}
            {unreadCount > 0 && (
              <span className="text-[11px] font-medium text-muted-foreground">{t('notifications.new', { count: unreadCount })}</span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="text-[11px] text-primary hover:underline flex items-center gap-1"
            >
              <CheckCheck size={12} /> {t('notifications.markAll')}
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-[380px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-10 text-center">
              <BellOff className="w-7 h-7 mx-auto mb-2 text-muted-foreground/40" />
              <div className="text-sm text-muted-foreground">{t('notifications.allCaughtUp')}</div>
            </div>
          ) : (
            items.map((item) => {
              const cfg = SEVERITY_ICON[item.severity] ?? SEVERITY_ICON.info;
              const Icon = cfg.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={cn(
                    'w-full text-left flex items-start gap-3 px-3 py-2.5 border-b border-border/40 transition-colors hover:bg-foreground/[0.04]',
                    !item.isRead && 'bg-foreground/[0.025]',
                  )}
                >
                  <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5', cfg.bg)}>
                    <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-[13px] truncate', !item.isRead ? 'font-semibold' : 'font-medium text-foreground/80')}>
                        {item.title}
                      </span>
                      {!item.isRead && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />}
                    </div>
                    {item.message && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{item.message}</p>
                    )}
                    <span className="text-[10px] text-muted-foreground/70">{timeAgo(item.createdAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 bg-muted/20">
          <button
            onClick={() => { setOpen(false); router.push('/notifications'); }}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t('notifications.viewAll')}
          </button>
          <button
            onClick={() => { setOpen(false); router.push('/notifications/preferences'); }}
            className="text-muted-foreground hover:text-foreground"
            title={t('notifications.settings')}
          >
            <Settings size={13} />
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
