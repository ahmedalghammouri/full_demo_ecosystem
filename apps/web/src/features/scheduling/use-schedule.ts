'use client';

import { useQuery } from '@tanstack/react-query';
import { schedulingService, type UnifiedScheduleParams } from '@/services/scheduling.service';

export function useUnifiedSchedule(params: UnifiedScheduleParams) {
  return useQuery({
    queryKey: ['scheduling', 'unified', params],
    queryFn: () => schedulingService.getUnified(params),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
