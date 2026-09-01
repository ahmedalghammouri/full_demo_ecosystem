'use client';

/**
 * The selected factory's capability list.
 *
 * Read from the API, not from the persisted store, and the distinction is the
 * whole point of this file.
 *
 * The store keeps whatever was written into it when the factory was chosen, and
 * that object survives in localStorage across deploys. When a release adds a
 * field the store did not previously carry — as `metadata.capabilities` was
 * added — every existing session keeps the old shape. Gate the navigation on
 * that and the result depends on when the user last signed in, which is not a
 * thing anyone can debug from a screenshot.
 *
 * So the store is a hint and the API is the answer. `/ecosystem/factories` is
 * public and cached for the session, so this costs one request per visit.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { capabilitiesOfFactory, type FactoryCapability } from './nav-capabilities';

interface FactoryCapabilityRow {
  id: string;
  code: string;
  capabilityCount: number;
  capabilities: { code: string }[];
}

export interface CapabilityState {
  /** The modules this site has, or null while genuinely unknown. */
  capabilities: FactoryCapability[] | null;
  /** True once an authoritative answer has arrived, or the store supplied one. */
  resolved: boolean;
}

/**
 * @param selectedFactory the store's factory object, used as the fast path
 */
export function useFactoryCapabilities(selectedFactory: unknown): CapabilityState {
  const factoryId =
    selectedFactory && typeof selectedFactory === 'object'
      ? (selectedFactory as { id?: string }).id
      : undefined;

  // The fast path: a factory chosen since the capability list was added already
  // carries it, and the navigation renders correctly on the first paint.
  const fromStore = capabilitiesOfFactory(selectedFactory);

  const q = useQuery({
    queryKey: ['factory-capabilities'],
    queryFn: () => api.get<FactoryCapabilityRow[]>('/ecosystem/factories'),
    // The estate's classification does not change during a session.
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    // Only worth asking when a factory is actually selected.
    enabled: !!factoryId,
  });

  if (!factoryId) return { capabilities: null, resolved: true };

  const row = q.data?.find((f) => f.id === factoryId);
  if (row) {
    return { capabilities: row.capabilities.map((c) => c.code) as FactoryCapability[], resolved: true };
  }

  // No answer yet. A stale store object is better than nothing; a fresh one is
  // already correct. Either way this is replaced the moment the query lands.
  if (fromStore) return { capabilities: fromStore, resolved: true };

  // Genuinely unknown, and only until the request returns. Reporting this as
  // unresolved is what stops the navigation from hiding everything on the
  // strength of a session that predates the capability list.
  return { capabilities: null, resolved: !q.isLoading && !q.isFetching && q.isError };
}
