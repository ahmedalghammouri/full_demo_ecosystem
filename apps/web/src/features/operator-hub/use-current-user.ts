'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';

export type CurrentUser = { id: string; name: string; role: string; factoryId: string | null };

/** The logged-in user (GET /auth/me) — used to scope the shop floor to the operator. */
export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/auth/me'),
    staleTime: 300_000,
  });
}
