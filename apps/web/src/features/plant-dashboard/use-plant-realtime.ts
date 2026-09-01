'use client';

/**
 * usePlantRealtime — ONE shared real-time manager for a live dashboard. It reuses the
 * app's single socket (useWebSocket), joins the machine/alarm rooms once, and on any
 * relevant event debounce-triggers a refetch of the batched live-data (push-to-refresh)
 * instead of opening a socket per card or streaming every KPI over the wire. Polling is
 * the fallback; the socket just makes it near-instant. Exposes connection + stale state.
 */

import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';

export type ConnectionState = 'live' | 'reconnecting' | 'disconnected' | 'delayed';

export function usePlantRealtime({
  onSignal, lastUpdatedAt, staleMs = 20_000, debounceMs = 1500,
}: {
  onSignal: () => void;
  lastUpdatedAt: number | undefined;
  staleMs?: number;
  debounceMs?: number;
}) {
  const { isConnected, subscribe, emit } = useWebSocket();
  const [visible, setVisible] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const signalRef = useRef(onSignal);
  signalRef.current = onSignal;
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tab visibility → pause pushes while hidden (reduce work).
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    onVis();
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Join rooms once connected so the server pushes events.
  useEffect(() => {
    if (!isConnected) return;
    emit('subscribe:machines');
    emit('subscribe:alarms');
  }, [isConnected, emit]);

  // Any machine/alarm event → debounced refetch (skip while hidden).
  useEffect(() => {
    const fire = () => {
      if (!visible) return;
      if (debTimer.current) clearTimeout(debTimer.current);
      debTimer.current = setTimeout(() => signalRef.current(), debounceMs);
    };
    const offs = [
      subscribe('machine:state-changed', fire),
      subscribe('machine:telemetry', fire),
      subscribe('production.kpi.updated', fire),
      subscribe('alarm:triggered', fire),
    ];
    return () => { offs.forEach((off) => off?.()); if (debTimer.current) clearTimeout(debTimer.current); };
  }, [subscribe, visible, debounceMs]);

  // Tick for stale detection.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const isStale = lastUpdatedAt != null && now - lastUpdatedAt > staleMs;
  const connectionState: ConnectionState = !isConnected ? 'disconnected' : isStale ? 'delayed' : 'live';

  return { connectionState, isStale, isConnected, visible };
}
