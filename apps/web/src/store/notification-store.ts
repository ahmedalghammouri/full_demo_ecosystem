import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error' | 'critical';
export type NotificationCategory =
  | 'alarm' | 'production' | 'quality' | 'maintenance'
  | 'downtime' | 'energy' | 'inventory' | 'system';

export interface Notification {
  id: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  /** ISO timestamp string. */
  createdAt: string;
  isRead: boolean;
  link?: string | null;
}

/** A notification pushed over the WebSocket (already persisted server-side). */
export interface IncomingNotification {
  id?: string;
  title: string;
  message?: string;
  severity?: NotificationSeverity;
  category?: NotificationCategory;
  createdAt?: string;
  isRead?: boolean;
  link?: string | null;
}

interface NotificationStore {
  /** Live in-memory cache (for the bell dropdown); the full list is fetched per-page. */
  notifications: Notification[];
  unreadCount: number;
  /** Add/merge a notification (deduped by id). Returns true if it was new. */
  add: (n: IncomingNotification) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Authoritative unread count from the server (REST poll or WS push). */
  setUnreadCount: (count: number) => void;
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  }
}

export const useNotificationStore = create<NotificationStore>()(
  immer((set, get) => ({
    notifications: [],
    unreadCount: 0,

    add: (incoming) => {
      const id = incoming.id ?? genId();
      if (get().notifications.some((n) => n.id === id)) return false;

      const notif: Notification = {
        id,
        title: incoming.title,
        message: incoming.message ?? '',
        severity: incoming.severity ?? 'info',
        category: incoming.category ?? 'system',
        createdAt: incoming.createdAt ?? new Date().toISOString(),
        isRead: incoming.isRead ?? false,
        link: incoming.link ?? null,
      };

      set((s) => {
        s.notifications.unshift(notif);
        if (s.notifications.length > 100) s.notifications = s.notifications.slice(0, 100);
        if (!notif.isRead) s.unreadCount += 1;
      });
      return true;
    },

    markRead: (id) =>
      set((s) => {
        const n = s.notifications.find((x) => x.id === id);
        if (n && !n.isRead) {
          n.isRead = true;
          s.unreadCount = Math.max(0, s.unreadCount - 1);
        }
      }),

    markAllRead: () =>
      set((s) => {
        s.notifications.forEach((n) => { n.isRead = true; });
        s.unreadCount = 0;
      }),

    remove: (id) =>
      set((s) => {
        const n = s.notifications.find((x) => x.id === id);
        if (n && !n.isRead) s.unreadCount = Math.max(0, s.unreadCount - 1);
        s.notifications = s.notifications.filter((x) => x.id !== id);
      }),

    clear: () =>
      set((s) => {
        s.notifications = [];
        s.unreadCount = 0;
      }),

    setUnreadCount: (count) =>
      set((s) => {
        s.unreadCount = Math.max(0, count);
      }),
  })),
);
