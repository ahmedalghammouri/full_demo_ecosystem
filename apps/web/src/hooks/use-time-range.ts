'use client';

import { useTimeRangeStore } from '@/store/time-range-store';

/**
 * Derives API params + a query-key fragment from the global analysis time range.
 * `params` carries BOTH `timeframe` (bucket hint) and resolved `dateFrom`/`dateTo`
 * so it works uniformly with every OEE/KPI endpoint. Put `key` in the queryKey so
 * changing the range refetches.
 *
 *   const { params, key } = useTimeRange();
 *   useQuery({ queryKey: ['production','oee', key, scopeKey],
 *              queryFn: () => api.get('/production/oee/calculate', { params: { ...params, ...scopeFilter } }) });
 */
export function useTimeRange() {
  const { preset, from, to } = useTimeRangeStore();
  // Format from LOCAL calendar components (NOT toISOString, which converts to UTC
  // and shifts local midnight to the previous day for +offset timezones — that bug
  // made "Today/Shift" leak into yesterday's production). "Today" must mean the
  // user's local today, consistent with how the shop floor experiences the day.
  const iso = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const now = new Date();

  let dateFrom: string;
  let dateTo = iso(now);
  if (preset === 'custom' && from && to) {
    dateFrom = from;
    dateTo = to;
  } else {
    const d = new Date(now);
    if (preset === 'week') d.setDate(now.getDate() - 7);
    else if (preset === 'month') d.setDate(now.getDate() - 30);
    // Today AND shift both round down to midnight here, and that is not a
    // mistake: a shift is not a client-side concept — only the server knows
    // the templates — so `timeframe` carries the distinction and the API
    // resolves the real shift window. These dates are the fallback for a
    // plant with no shifts configured.
    //
    // It WAS a mistake for as long as the engine endpoints ignored
    // `timeframe`: the two buttons then produced identical windows, identical
    // charts and identical numbers, and the night shift's first four and a
    // half hours were missing from the view that claimed to show it.
    else d.setHours(0, 0, 0, 0);
    dateFrom = iso(d);
  }

  const params = { timeframe: preset, dateFrom, dateTo };
  const key = preset === 'custom' ? `custom:${from}:${to}` : preset;
  const label = preset === 'custom' && from && to ? `${from} → ${to}` : preset.charAt(0).toUpperCase() + preset.slice(1);

  return { preset, params, key, label, dateFrom, dateTo };
}
