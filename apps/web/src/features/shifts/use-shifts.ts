'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  shiftService, type ShiftTemplateInput, type GenerateInstancesInput,
  type GeneratePlannedDowntimeInput, type AddPlannedDowntimeInput,
} from '@/services/shift.service';
import { toast } from '@/components/ui/use-toast';

const KEYS = {
  config: ['shifts', 'config'] as const,
  templates: (inc: boolean) => ['shifts', 'templates', inc] as const,
  instances: (p: unknown) => ['shifts', 'instances', p] as const,
  current: ['shifts', 'instances', 'current'] as const,
};

export function useShiftConfig() {
  return useQuery({
    queryKey: KEYS.config,
    queryFn: () => shiftService.getConfig(),
    staleTime: 60_000,
  });
}

export function useShiftTemplates(includeInactive = false) {
  return useQuery({
    queryKey: KEYS.templates(includeInactive),
    queryFn: () => shiftService.listTemplates(includeInactive),
    staleTime: 30_000,
  });
}

export function useShiftInstances(params: Parameters<typeof shiftService.listInstances>[0] = {}) {
  return useQuery({
    queryKey: KEYS.instances(params),
    queryFn: () => shiftService.listInstances(params),
    staleTime: 15_000,
  });
}

export function useCurrentShift() {
  return useQuery({
    queryKey: KEYS.current,
    queryFn: () => shiftService.getCurrent(),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['shifts'] });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ShiftTemplateInput) => shiftService.createTemplate(body),
    onSuccess: () => { invalidateAll(qc); toast({ title: 'Shift created' }); },
    onError: (e: unknown) => toast({
      title: 'Could not create shift',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ShiftTemplateInput> }) =>
      shiftService.updateTemplate(id, body),
    onSuccess: () => { invalidateAll(qc); toast({ title: 'Shift updated' }); },
    onError: (e: unknown) => toast({
      title: 'Could not update shift',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => shiftService.deleteTemplate(id),
    onSuccess: (res) => {
      invalidateAll(qc);
      toast({ title: res.deactivated ? 'Shift deactivated (has history)' : 'Shift deleted' });
    },
    onError: (e: unknown) => toast({
      title: 'Could not delete shift',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function useGenerateInstances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateInstancesInput) => shiftService.generateInstances(body),
    onSuccess: (res) => {
      invalidateAll(qc);
      toast({ title: `Generated ${res.created} shift(s)`, description: `${res.skipped} already existed` });
    },
    onError: (e: unknown) => toast({
      title: 'Could not generate shifts',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function usePlannedCauses() {
  return useQuery({
    queryKey: ['shifts', 'downtime-causes'],
    queryFn: () => shiftService.listPlannedCauses(),
    staleTime: 120_000,
  });
}

export function usePlannedDowntime(params: Parameters<typeof shiftService.listPlannedDowntime>[0] = {}) {
  return useQuery({
    queryKey: ['shifts', 'planned-downtime', params],
    queryFn: () => shiftService.listPlannedDowntime(params),
    staleTime: 15_000,
  });
}

export function useGeneratePlannedDowntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GeneratePlannedDowntimeInput) => shiftService.generatePlannedDowntime(body),
    onSuccess: (res) => {
      invalidateAll(qc);
      toast({
        title: `Created ${res.created} planned downtime event(s)`,
        description: `${res.instances} shift(s) × ${res.machines} machine(s) · ${res.skipped} already existed`,
      });
    },
    onError: (e: unknown) => toast({
      title: 'Could not generate planned downtime',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function useAddPlannedDowntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddPlannedDowntimeInput) => shiftService.addPlannedDowntime(body),
    onSuccess: (res) => {
      invalidateAll(qc);
      toast({
        title: `Added planned downtime to ${res.created} machine(s)`,
        description: `Scope: ${res.scope.toLowerCase()}${res.skipped ? ` · ${res.skipped} already existed` : ''}`,
      });
    },
    onError: (e: unknown) => toast({
      title: 'Could not add planned downtime',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}

export function useDeletePlannedDowntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => shiftService.deletePlannedDowntime(id),
    onSuccess: () => { invalidateAll(qc); toast({ title: 'Planned downtime removed' }); },
    onError: (e: unknown) => toast({
      title: 'Could not remove',
      description: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });
}
