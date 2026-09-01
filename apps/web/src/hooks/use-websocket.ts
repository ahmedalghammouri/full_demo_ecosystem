'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/store/auth-store';
import { useNotificationStore, type IncomingNotification } from '@/store/notification-store';
import { useToast } from '@/components/ui/use-toast';

// Same-origin in the browser so the socket reaches the host that served the page
// (nginx proxies /socket.io/) — works from any LAN device, not just localhost.
// An explicit non-localhost NEXT_PUBLIC_WS_URL still wins.
function resolveWsBase(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env && !/localhost|127\.0\.0\.1/i.test(env)) return env;
  if (typeof window !== 'undefined') return ''; // → window.location.origin below
  return env || 'ws://localhost:3001';
}
const WS_URL = resolveWsBase();

let globalSocket: Socket | null = null;

export function useWebSocket() {
  const { accessToken, isAuthenticated } = useAuthStore();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    if (!globalSocket) {
      globalSocket = io(WS_URL || window.location.origin, {
        auth: { token: accessToken },
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        transports: ['websocket', 'polling'],
      });
    }

    const socket = globalSocket;
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) setIsConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [isAuthenticated, accessToken]);

  const subscribe = useCallback((event: string, handler: (...args: unknown[]) => void) => {
    if (!globalSocket) return () => {};
    globalSocket.on(event, handler);
    return () => globalSocket?.off(event, handler);
  }, []);

  const emit = useCallback((event: string, data?: unknown) => {
    if (!globalSocket?.connected) return;
    globalSocket.emit(event, data);
  }, []);

  return { isConnected, subscribe, emit };
}

export function useWebSocketStatus(): boolean {
  const { isConnected } = useWebSocket();
  return isConnected;
}

/**
 * Binds the per-user notification feed to the notification store + a toast.
 * Mount this ONCE globally (the app shell) — not per-feature — so each incoming
 * notification produces exactly one toast and one store entry.
 */
export function useNotificationFeed() {
  const { subscribe } = useWebSocket();
  const addNotification = useNotificationStore((s) => s.add);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const offNotif = subscribe('notification', (raw) => {
      const data = raw as IncomingNotification;
      const isNew = addNotification(data);
      if (isNew) {
        const variant =
          data.severity === 'error' || data.severity === 'critical' ? 'destructive'
          : data.severity === 'warning' ? 'warning'
          : data.severity === 'success' ? 'success'
          : 'default';
        toast({ title: data.title, description: data.message, variant });
        // Refresh any open notification list/bell so the new item appears immediately.
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }
    });

    const offCount = subscribe('notification:unread-count', (raw) => {
      const data = raw as { count?: number };
      if (typeof data?.count === 'number') setUnreadCount(data.count);
    });

    return () => { offNotif(); offCount(); };
  }, [subscribe, addNotification, setUnreadCount, toast, queryClient]);
}

export function useRealtimeData<T>(event: string, initialData: T) {
  const { subscribe } = useWebSocket();
  const [data, setData] = useState<T>(initialData);

  useEffect(() => {
    const unsubscribe = subscribe(event, (newData) => {
      setData(newData as T);
    });
    return unsubscribe;
  }, [event, subscribe]);

  return data;
}
