'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apsService } from '@/services/aps.service';
import { toast } from '@/components/ui/use-toast';

export function useApsPlan() {
  return useQuery({
    queryKey: ['aps', 'plan'],
    queryFn: () => apsService.getPlan(),
    staleTime: 15_000,
  });
}

export function useApsMrp() {
  return useQuery({
    queryKey: ['aps', 'mrp'],
    queryFn: () => apsService.getMrp(),
    staleTime: 30_000,
  });
}

export function useRunSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { startFrom?: string } = {}) => apsService.runSchedule(body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['aps'] });
      toast({
        title: `Plan recalculated — ${res.scheduled} operations scheduled`,
        description: `Makespan ${res.makespanHours}h · ${res.onTimePct}% on-time · ${res.utilizationPct}% utilization`,
      });
    },
    onError: (e: unknown) => toast({
      title: 'Could not recalculate the plan',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

/** Recalculate as a DRY-RUN preview — returns the plan WITHOUT writing to the DB. */
export function useRunScheduleDry() {
  return useMutation({
    mutationFn: (body: { startFrom?: string; workOrderId?: string; overrides?: Array<{ id: string; start: string; end: string }> } = {}) =>
      apsService.runSchedule({ ...body, dryRun: true }),
    onError: (e: unknown) => toast({
      title: 'Could not compute the plan',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

/** Commit a reviewed (dry-run) plan to the database. */
export function useSaveSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Array<{ id: string; start: string; end: string }>) => apsService.saveSchedule(updates),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['aps'] });
      qc.invalidateQueries({ queryKey: ['reschedule-requests'] });
      qc.invalidateQueries({ queryKey: ['sidebar-counts'] });
      const gated = res.gated?.length ?? 0;
      if (gated > 0) {
        toast({
          title: `${res.saved} saved · ${gated} need approval`,
          description: `${gated} order${gated === 1 ? '' : 's'} finish after the due date — a reschedule request was raised. Approve it on the Reschedule Requests page to apply.`,
        });
      } else {
        toast({ title: `Plan saved — ${res.saved} operation${res.saved === 1 ? '' : 's'} updated` });
      }
    },
    onError: (e: unknown) => toast({
      title: 'Could not save the plan',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function useRescheduleJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { jobId: string; machineId?: string; start: string; end?: string }) =>
      apsService.rescheduleJob(body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['aps'] });
      if (res.rippledSuccessors > 0) {
        toast({ title: 'Operation rescheduled', description: `${res.rippledSuccessors} downstream step(s) shifted` });
      }
    },
    onError: (e: unknown) => toast({
      title: 'Reschedule failed',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function useCtp() {
  return useMutation({
    mutationFn: (body: { skuId: string; quantity: number; dueDate?: string }) => apsService.ctp(body),
  });
}
