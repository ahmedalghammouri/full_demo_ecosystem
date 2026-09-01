'use client';

import { useScopeStore } from '@/store/scope-store';

/**
 * Derives the API filter params + a query-key fragment from the global analysis
 * scope. Spread `filter` into analysis API calls and put `key` in the react-query
 * queryKey so changing the scope refetches.
 *
 *   const { filter, key } = useScope();
 *   useQuery({ queryKey: ['production','oee', timeframe, key],
 *              queryFn: () => api.get('/production/oee/calculate', { params: { timeframe, ...filter } }) });
 */
export function useScope() {
  const scope = useScopeStore((s) => s.scope);

  // FACTORY (or null) = no filter (whole factory).
  const filter: { areaId?: string; lineId?: string; machineId?: string } =
    scope && scope.type === 'AREA' ? { areaId: scope.id }
    : scope && scope.type === 'LINE' ? { lineId: scope.id }
    : scope && scope.type === 'MACHINE' ? { machineId: scope.id }
    : {};

  const key = scope && scope.type !== 'FACTORY' ? `${scope.type}:${scope.id}` : 'all';

  return { scope, filter, key, isFactory: !scope || scope.type === 'FACTORY' };
}
