'use client';

/**
 * AutoGenerateWODialog — the single, shared Auto-Generate Work Order dialog used
 * by BOTH the PO list (production-orders-view) and the Control Panel pipeline
 * (manufacturing-control-view). One form, one principle:
 *   • overlap-aware "smart finish" estimate (work content + planned stoppage)
 *   • reschedule-request governance when the finish exceeds the due date
 *   • 1 Work Order → N Job Orders (ISA-95 dispatch list)
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Layers, CheckCircle2, AlertCircle, BarChart3, Info, Cpu,
  Clock, AlertTriangle, CalendarClock,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

export interface AutoGenPO {
  id: string;
  orderNumber: string;
  targetQty: number;
  unit?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  sku?: { name?: string | null; itemNumber?: string | null } | null;
}

interface Props {
  po: AutoGenPO;
  open: boolean;
  onClose: () => void;
  /** Called after a successful generation (e.g. to refresh the host view). */
  onDone?: () => void;
}

// Plant timezone offset (Asia/Riyadh = UTC+3, no DST). Datetime-local inputs are
// interpreted in the FACTORY timezone — never the operator's browser timezone — so
// a picked "8:00 PM" always means 8 PM in Riyadh and stores the correct UTC instant
// regardless of where the browser is.
const FACTORY_OFFSET_MS = 3 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** UTC ISO → datetime-local string in factory (Riyadh) time. */
function toLocalInput(iso?: string | null): string {
  const base = iso ? new Date(iso).getTime() : Date.now();
  const d = new Date(base + FACTORY_OFFSET_MS); // shift, then read via getUTC*
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** datetime-local string (interpreted as factory/Riyadh time) → UTC ISO to send. */
function factoryInputToUtcIso(naive: string): string {
  const [datePart, timePart] = naive.split('T');
  const [y, mo, dd] = datePart.split('-').map(Number);
  const [h, mi] = (timePart ?? '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, dd, h, mi) - FACTORY_OFFSET_MS).toISOString();
}

export function AutoGenerateWODialog({ po, open, onClose, onDone }: Props) {
  const { t } = useTranslation(['production', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [plannedStart, setStart] = useState(toLocalInput(po.plannedStart));
  const [plannedEnd, setEnd] = useState(toLocalInput(po.plannedEnd ?? new Date(Date.now() + 86_400_000).toISOString()));
  const [autoStart, setAutoStart] = useState(false);
  // Per-step operator pre-assignment: routingStepId → operatorId
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  // Assignable users = everyone below the caller's role in their factory (operators
  // and other sub-roles). Uses the dedicated endpoint so Production Managers /
  // Supervisors can populate this without full user-management access.
  const { data: usersData } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable'),
    enabled: open,
    staleTime: 300_000,
  });
  const prettyRole = (r?: string) =>
    (r ?? '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const operators: Array<{ id: string; name: string; role?: string }> =
    ((usersData as any) ?? []).map((u: any) => ({ id: u.id, name: u.name, role: u.role }));

  const fromIso = plannedStart ? factoryInputToUtcIso(plannedStart) : undefined;

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['po-autogen-preview', po.id, fromIso],
    queryFn: () => api.get(`/production/production-orders/${po.id}/auto-generate-preview`, { params: { from: fromIso } }),
    enabled: open,
    staleTime: 0,
  });
  const prev = preview as any;
  const smart = prev?.smart as null | {
    computedFinish: string | null; workContentMins: number; plannedStoppageMins: number;
    totalDurationMins: number; exceedsDue: boolean; dueDate: string | null;
  };

  // Latest reschedule request for this PO (governance when the finish overruns the due date)
  const { data: reschedData } = useQuery({
    queryKey: ['po-reschedule-requests', po.id],
    queryFn: () => api.get(`/production/reschedule-requests`, { params: { productionOrderId: po.id } }),
    enabled: open,
    staleTime: 0,
  });
  const latestReschedule = (reschedData as any[])?.[0] ?? null;
  const approvedReschedule = latestReschedule?.status === 'APPROVED' ? latestReschedule : null;
  const pendingReschedule = latestReschedule?.status === 'PENDING' ? latestReschedule : null;

  // Once a reschedule is approved, reset the Production Start/End inputs to the
  // approved window so the form reflects the authoritative dates everywhere.
  useEffect(() => {
    if (approvedReschedule) {
      setStart(toLocalInput(approvedReschedule.proposedStart));
      setEnd(toLocalInput(approvedReschedule.proposedEnd));
    }
  }, [approvedReschedule?.id, approvedReschedule?.proposedStart, approvedReschedule?.proposedEnd]);

  const requestResched = useMutation({
    mutationFn: () => api.post(`/production/production-orders/${po.id}/reschedule-requests`, {
      proposedStart: fromIso,
      proposedEnd: smart?.computedFinish,
      workContentMins: smart?.workContentMins,
      plannedStoppageMins: smart?.plannedStoppageMins,
      dueDate: smart?.dueDate ?? undefined,
      reason: 'Smart finish time exceeds the production-order due date.',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['po-reschedule-requests', po.id] });
      toast({ title: 'Reschedule request raised', description: 'Awaiting approval before work orders can be generated.' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' }),
  });

  const reviewResched = useMutation({
    mutationFn: (approve: boolean) => api.patch(`/production/reschedule-requests/${latestReschedule.id}/review`, { approve }),
    onSuccess: (_res, approve) => {
      qc.invalidateQueries({ queryKey: ['po-reschedule-requests', po.id] });
      toast({ title: approve ? 'Reschedule approved' : 'Reschedule rejected' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' }),
  });

  const genMut = useMutation({
    mutationFn: () => api.post(`/production/production-orders/${po.id}/auto-generate-work-orders`, {
      plannedStart: factoryInputToUtcIso(plannedStart),
      plannedEnd: factoryInputToUtcIso(plannedEnd),
      autoStart,
      assignments: Object.entries(assignments)
        .filter(([, operatorId]) => operatorId)
        .map(([stepId, operatorId]) => ({ stepId, operatorId })),
      ...(approvedReschedule ? { rescheduleRequestId: approvedReschedule.id } : {}),
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      // WO lists are keyed ['production','work-orders'] — invalidate that prefix (+ KPIs).
      qc.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      qc.invalidateQueries({ queryKey: ['production', 'kpis'] });
      qc.invalidateQueries({ queryKey: ['job-orders'] });
      const joCount = res?.jobOrdersCreated ?? 0;
      const shortages = res?.materialShortages ?? [];
      if (shortages.length > 0) {
        toast({
          variant: 'destructive',
          title: t('autoGen.materialShort.title', { count: shortages.length, defaultValue: '{{count}} material shortage(s) — WO awaiting materials' }),
          description: t('autoGen.materialShort.desc', { defaultValue: 'A request was sent to inventory. The work order cannot start until materials are available.' }),
        });
      } else {
        toast({
          title: `Work order created + ${joCount} job order${joCount !== 1 ? 's' : ''} dispatched`,
          description: `Linked to ${po.orderNumber}`,
        });
      }
      onDone?.();
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' }),
  });

  const joSteps: any[] = prev?.jobOrdersToCreate ?? prev?.workOrdersToCreate ?? [];
  const isDispatchMode = prev?.mode === 'dispatch' || joSteps.length > 1;
  const blockedByReschedule = !!smart?.exceedsDue && !approvedReschedule;
  const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { timeZone: 'Asia/Riyadh' }) : '—');
  const fmtDur = (mins?: number) => {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            {t('autogen.title')}
          </DialogTitle>
          <DialogDescription>
            {po.orderNumber} · {po.sku?.name ?? '—'} · {po.targetQty.toLocaleString()} {po.unit}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('autogen.productionStart')} *</Label>
              <Input type="datetime-local" value={plannedStart} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('autogen.productionEnd')} *</Label>
              <Input type="datetime-local" value={plannedEnd} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>

          {/* Auto-start toggle */}
          <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border/60 bg-muted/20 cursor-pointer">
            <Checkbox checked={autoStart} onCheckedChange={v => setAutoStart(!!v)} className="mt-0.5" />
            <span className="text-xs">
              <span className="font-medium">{t('autogen.autoStart')}</span>
              <span className="block text-muted-foreground mt-0.5">
                {t('autogen.autoStartHelp')}
              </span>
            </span>
          </label>

          {previewLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-10 rounded-lg" />)}
            </div>
          ) : prev ? (
            <div className="space-y-3">
              {/* Model explanation + recipe/process badges */}
              <div className="flex items-center gap-3 flex-wrap text-xs">
                {isDispatchMode && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-card border border-purple-500/20">
                    <Layers className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-purple-300 font-medium">{t('autogen.woToJos', { count: joSteps.length })}</span>
                  </div>
                )}
                {prev.recipe && (() => {
                  const approved = prev.recipe.status === 'APPROVED';
                  return (
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-card border ${approved ? 'border-green-500/20' : 'border-amber-500/20'}`}>
                      {approved ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}
                      <span className={`font-medium ${approved ? 'text-green-300' : 'text-amber-300'}`}>
                        {t('autogen.recipePrefix')} {prev.recipe.code} v{prev.recipe.version}
                        {!approved && <span className="ms-1 opacity-70">({prev.recipe.status})</span>}
                      </span>
                    </div>
                  );
                })()}
                {prev.process && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-card border border-blue-500/20">
                    <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-blue-300 font-medium">{prev.process.name}</span>
                    {prev.process.scopeType && prev.process.scopeType !== 'PRODUCT' && (
                      <span className="text-[10px] text-blue-400">{t('autogen.scopeSuffix', { scope: String(prev.process.scopeType).replace('_', ' ') })}</span>
                    )}
                    {prev.process.totalCycleTimeMins && (
                      <span className="text-muted-foreground">{t('autogen.minSuffix', { count: prev.process.totalCycleTimeMins })}</span>
                    )}
                  </div>
                )}
                {!prev.recipe && !prev.process && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-card border border-amber-500/20">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-amber-300">{t('autogen.noRecipe')}</span>
                  </div>
                )}
              </div>

              {/* Warning */}
              {prev.warning && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {prev.warning}
                </div>
              )}

              {/* Smart finish estimate (overlap-aware schedule + planned stoppage) */}
              {smart && (
                <div className={cn('rounded-xl border p-3 text-xs space-y-2',
                  smart.exceedsDue ? 'border-red-500/30 bg-red-500/10' : 'border-emerald-500/30 bg-emerald-500/10')}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> {t('autogen.smartFinish')}
                    </span>
                    <span className={cn('font-bold tabular-nums', smart.exceedsDue ? 'text-red-400' : 'text-emerald-400')}>
                      {fmtDateTime(smart.computedFinish)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                    <div>{t('autogen.workContent')}<br /><span className="text-foreground font-medium">{fmtDur(smart.workContentMins)}</span></div>
                    <div>{t('autogen.plannedStoppage')}<br /><span className="text-foreground font-medium">+{fmtDur(smart.plannedStoppageMins)}</span></div>
                    <div>{t('autogen.totalDuration')}<br /><span className="text-foreground font-medium">{fmtDur(smart.totalDurationMins)}</span></div>
                  </div>
                  {smart.dueDate && (
                    <div className="text-[11px] text-muted-foreground">{t('autogen.dueDate')} <span className="font-medium text-foreground">{fmtDateTime(smart.dueDate)}</span></div>
                  )}
                  {smart.exceedsDue && (
                    <div className="border-t border-red-500/20 pt-2 space-y-2">
                      <div className="flex items-center gap-1.5 text-red-300">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('autogen.exceedsDue')}
                      </div>
                      {approvedReschedule ? (
                        <div className="flex items-center gap-1.5 text-emerald-300">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t('autogen.rescheduleApproved', { date: fmtDateTime(approvedReschedule.proposedEnd) })}
                        </div>
                      ) : pendingReschedule ? (
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-amber-300">{t('autogen.reschedulePending')}</span>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="h-7" onClick={() => reviewResched.mutate(false)} disabled={reviewResched.isPending}>{t('autogen.reject')}</Button>
                            <Button size="sm" className="h-7" onClick={() => reviewResched.mutate(true)} disabled={reviewResched.isPending}>{t('autogen.approve')}</Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => requestResched.mutate()} disabled={requestResched.isPending || !smart.computedFinish}>
                          <CalendarClock className="w-3.5 h-3.5" /> {t('autogen.requestReschedule')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Dispatch list preview */}
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {isDispatchMode ? t('autogen.dispatchListTitle', { count: joSteps.length }) : t('autogen.woStepsTitle', { count: joSteps.length })}
                  </span>
                  {isDispatchMode && <span className="text-xs text-muted-foreground">{t('autogen.scheduledReady')}</span>}
                </div>
                {joSteps.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    {t('autogen.noRoutingSteps')}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50">
                        {[t('autogen.colNum'), t('autogen.colOperation'), t('autogen.colMachineCell'), t('autogen.colAssignTo'), t('autogen.colQtyFlow'), t('autogen.colEstDuration')].map(h => (
                          <th key={h} className="text-start p-3 text-xs text-muted-foreground font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {joSteps.map((step: any, i: number) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="p-3 text-xs font-mono text-brand-400">{step.stepNumber}</td>
                          <td className="p-3 text-xs font-medium">{step.operationName}</td>
                          <td className="p-3">
                            <div className="flex flex-col gap-0.5">
                              {step.machine ? (
                                <div className="flex items-center gap-1.5 text-xs"><Cpu className="w-3 h-3 text-muted-foreground" />{step.machine.name}</div>
                              ) : (
                                <span className="text-xs text-amber-400">{t('autogen.noMachine')}</span>
                              )}
                              {step.workCenter && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground"><Layers className="w-2.5 h-2.5" />{step.workCenter.name}</div>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            {step.stepId ? (
                              <select
                                value={assignments[step.stepId] ?? ''}
                                onChange={e => setAssignments(a => ({ ...a, [step.stepId]: e.target.value }))}
                                className="text-xs bg-background/80 border border-border rounded-md px-2 py-1.5 min-w-[150px] max-w-[220px] focus:outline-none focus:border-brand-400"
                              >
                                <option value="">{t('autogen.operatorOpt')}</option>
                                {operators.map(u => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}{u.role ? ` · ${prettyRole(u.role)}` : ''}
                                  </option>
                                ))}
                              </select>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="p-3 text-xs tabular-nums">
                            {step.plannedQtyIn != null && step.inputUnit
                              ? <>{step.plannedQtyIn} {step.inputUnit} → {step.plannedQtyOut} {step.outputUnit}</>
                              : <>{(step.plannedQtyOut ?? step.plannedQty ?? po.targetQty).toLocaleString()} <span className="text-muted-foreground font-medium">{step.outputUnit ?? po.unit}</span></>}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {step.estimatedDurationMins ? t('autogen.minUnit', { count: Math.round(step.estimatedDurationMins) }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {prev.existingWOCount > 0 && (
                <p className="text-xs text-amber-400/80">
                  {t('autogen.alreadyHasWos', { count: prev.existingWOCount })}
                </p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('autogen.cancel')}</Button>
          <Button
            onClick={() => genMut.mutate()}
            disabled={genMut.isPending || !prev?.canGenerate || !plannedStart || !plannedEnd || blockedByReschedule}
            className="gap-2"
          >
            <Zap className="w-3.5 h-3.5" />
            {genMut.isPending
              ? t('autogen.generating')
              : blockedByReschedule
                ? t('autogen.approveToContinue')
                : isDispatchMode
                  ? t('autogen.generateDispatch', { count: joSteps.length })
                  : t('autogen.generateWo')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
