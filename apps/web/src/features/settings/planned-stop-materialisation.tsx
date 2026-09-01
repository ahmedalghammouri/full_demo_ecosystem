'use client';

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';

import { api } from '@/services/api.client';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

/**
 * Whether the shift schedule is written into the machines' own state history.
 *
 * ── What it turns on ────────────────────────────────────────────────────────
 * A planned stop lives as a TEMPLATE, which the OEE engine reads at
 * calculation time. That leaves the two halves of the system disagreeing about
 * the same minute: the arithmetic excludes a scheduled break, while the
 * timeline reads the sensor and draws whatever the machine reported through it.
 * With this on, an hourly job writes those windows as state records, and both
 * halves read one source.
 *
 * ── Why it defaults to off ──────────────────────────────────────────────────
 * It is right for a plant whose breaks genuinely repeat on a rule, and wrong
 * for one that plans day by day — there a template writes windows nobody
 * scheduled, and the records outlive the template that made them. This plant
 * books dated downtime events for the two days its schedule covers, which
 * needs none of this. So it is a decision somebody makes, not a behaviour
 * discovered on a timeline.
 */
export function PlannedStopMaterialisation() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['planned-stop-materialisation'],
    queryFn: () => api.get<{ enabled: boolean }>('/system/planned-stop-materialisation'),
    staleTime: 30_000,
  });

  const mut = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch<{ enabled: boolean }>('/system/planned-stop-materialisation', { enabled }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['planned-stop-materialisation'] });
      toast({
        title: r.enabled ? 'Schedule materialisation on' : 'Schedule materialisation off',
        description: r.enabled
          ? 'Planned stops will be written into machine state history every hour.'
          : 'The writer is stopped. Records it already wrote are left in place.',
      });
    },
    onError: (e: any) =>
      toast({
        variant: 'destructive',
        title: 'Could not change the setting',
        description: e?.response?.data?.message ?? 'Please try again.',
      }),
  });

  const enabled = q.data?.enabled ?? false;
  const busy = q.isLoading || mut.isPending;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <div className="text-sm font-medium">Write the shift schedule into machine history</div>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Turns planned-stop templates into machine state records every hour, so the timeline
              and the OEE arithmetic agree inside a scheduled window instead of one excluding a
              break the other draws as idle.
            </p>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Leave this off unless your breaks repeat on a rule. A plant that plans day by day
              should book dated planned downtime instead — a recurring template writes windows
              nobody scheduled.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Write the shift schedule into machine history"
          disabled={busy}
          onClick={() => mut.mutate(!enabled)}
          className={cn(
            'relative mt-0.5 h-5 w-10 shrink-0 rounded-full transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            busy && 'opacity-60',
            enabled ? 'bg-brand-600' : 'bg-foreground/20',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {mut.isPending && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…
        </p>
      )}

      {/*
        Said plainly, because the opposite is the common assumption: turning a
        writer off does not un-write. Records already on the timeline stay until
        somebody removes them deliberately.
      */}
      {!enabled && !busy && (
        <p className="mt-3 text-xs text-muted-foreground">
          Off. Any records written while it was on remain on the timeline — switching off stops the
          writer, it does not erase what it wrote.
        </p>
      )}
    </div>
  );
}
