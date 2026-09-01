'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from './use-websocket';

/**
 * Subscribes to `production:kpi:updated` (emitted by the backend KpiService when
 * JO→WO→PO OEE/status roll up) and invalidates the affected React Query caches so
 * work-order / production-order / dashboard / OEE views update live without a refetch.
 * Mounted once globally in the app shell. See docs/DESIGN-oee-kpi-engine.md.
 */
export function useLiveKpi() {
  const { subscribe } = useWebSocket();
  const qc = useQueryClient();

  useEffect(() => {
    const KEYS = [
      ['work-orders'],
      ['production-orders'],
      ['job-orders'],
      ['control-pos'],
      ['production', 'oee'],
      ['production', 'oee-hierarchy'],
      ['dashboard'],
    ];
    const off = subscribe('production:kpi:updated', () => {
      for (const key of KEYS) qc.invalidateQueries({ queryKey: key });
    });
    return off;
  }, [subscribe, qc]);
}
