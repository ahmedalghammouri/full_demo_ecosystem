'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, AlertTriangle, CheckCircle2, Activity, Plus } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormDialog } from '@/components/ui/form-dialog';
import { SelectMenu } from '@/components/ui/select-menu';
import { useToast } from '@/components/ui/use-toast';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useOrderFilterStore } from '@/store/order-filter-store';

interface SPCParameter {
  parameterName: string;
  unit: string | null;
  machineId: string | null;
  mean: number | null;
  ucl: number | null;
  lcl: number | null;
  sampleCount: number;
}

interface SPCMeasurement {
  id: string;
  parameterName: string;
  value: number;
  ucl: number | null;
  lcl: number | null;
  cl: number | null;
  isOutOfControl: boolean;
  measuredAt: string;
  subgroupNumber: number | null;
}

type Status = 'IN_CONTROL' | 'WARNING' | 'OUT_OF_CONTROL';

function computeStatus(measurements: SPCMeasurement[], cpk: number): Status {
  if (measurements.some(m => m.isOutOfControl)) return 'OUT_OF_CONTROL';
  if (cpk < 1.0) return 'OUT_OF_CONTROL';
  if (cpk < 1.33) return 'WARNING';
  return 'IN_CONTROL';
}

function computeCpk(values: number[], ucl: number, lcl: number, mean: number): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return 0;
  const cpu = (ucl - avg) / (3 * sigma);
  const cpl = (avg - lcl) / (3 * sigma);
  return parseFloat(Math.min(cpu, cpl).toFixed(2));
}

const STATUS_CFG: Record<Status, { labelKey: string; color: string; icon: any }> = {
  IN_CONTROL:     { labelKey: 'spc.status.IN_CONTROL',     color: 'text-green-400', icon: CheckCircle2  },
  WARNING:        { labelKey: 'spc.status.WARNING',        color: 'text-amber-400', icon: AlertTriangle },
  OUT_OF_CONTROL: { labelKey: 'spc.status.OUT_OF_CONTROL', color: 'text-red-400',   icon: AlertTriangle },
};

export function QualitySpcView() {
  const { t } = useTranslation(['quality', 'common']);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { filter, key: scopeKey } = useScope();
  const { dateFrom, dateTo, key: timeKey } = useTimeRange();
  const { poNumber, woId } = useOrderFilterStore();
  const [selected, setSelected] = useState<string | null>(null);

  // Resolve the selected PO number → id (the global Orders filter holds the number).
  const { data: poResp } = useQuery({
    queryKey: ['production', 'production-orders', 'spc-filter'],
    queryFn: () => api.get<any>('/production/production-orders', { params: { limit: 200 } }),
    enabled: !!poNumber,
    staleTime: 60_000,
  });
  const productionOrders: any[] = Array.isArray(poResp) ? poResp : ((poResp as any)?.data ?? []);
  const productionOrderId = poNumber ? productionOrders.find((p) => p.orderNumber === poNumber)?.id : undefined;

  // Shared scope + time + order params applied to both SPC queries.
  const spcParams = {
    ...filter,
    dateFrom, dateTo,
    workOrderId: woId || undefined,
    productionOrderId: productionOrderId || undefined,
  };
  const filterKey = `${scopeKey}|${timeKey}|${woId}|${productionOrderId ?? poNumber}`;

  // Quick-record modal state
  const [recordOpen, setRecordOpen] = useState(false);
  const [recMachineId, setRecMachineId] = useState('');
  const [recParam, setRecParam] = useState('');
  const [recValues, setRecValues] = useState<string[]>(['']);

  const { data: paramsData, isLoading: paramsLoading } = useQuery({
    queryKey: ['quality', 'spc', 'parameters', filterKey],
    queryFn: () => api.get('/quality/spc', { params: spcParams }),
    staleTime: 30_000,
  });

  const parameters: SPCParameter[] = (paramsData as any) ?? [];

  const { data: machinesData } = useQuery({
    queryKey: ['hierarchy', 'machines'],
    queryFn: () => api.get('/hierarchy/machines'),
    enabled: recordOpen,
    staleTime: 300_000,
  });
  const machines: Array<{ id: string; name: string; code?: string }> = (machinesData as any)?.data ?? (machinesData as any) ?? [];

  const recordMutation = useMutation({
    mutationFn: (body: any) => api.post('/quality/spc/measurements', body),
    onSuccess: (res: any) => {
      toast({ title: t('spc.recorded', { count: res?.recorded ?? 0, defaultValue: `${res?.recorded ?? 0} reading(s) recorded` }) });
      qc.invalidateQueries({ queryKey: ['quality', 'spc'] });
      setRecordOpen(false);
      setRecValues(['']);
      setRecParam('');
    },
    onError: () => toast({ title: t('spc.recordFailed', { defaultValue: 'Failed to record measurement' }), variant: 'destructive' }),
  });

  const openRecord = () => {
    const p = selected ? parameters.find(x => x.parameterName === selected) : parameters[0];
    setRecParam(p?.parameterName ?? '');
    setRecMachineId(p?.machineId ?? '');
    setRecValues(['']);
    setRecordOpen(true);
  };

  const submitRecord = () => {
    const vals = recValues.map(v => v.trim()).filter(v => v !== '' && !isNaN(Number(v)));
    if (!recMachineId || !recParam || vals.length === 0) return;
    const unit = parameters.find(p => p.parameterName === recParam)?.unit ?? undefined;
    recordMutation.mutate({
      machineId: recMachineId,
      measurements: vals.map((v, i) => ({ parameterName: recParam, value: Number(v), unit, subgroupNumber: i + 1 })),
    });
  };

  const selectedParam = selected
    ? parameters.find(p => p.parameterName === selected)
    : parameters[0] ?? null;

  if (!selected && parameters.length > 0 && selectedParam) {
    // auto-select first without causing render loop — handled via useMemo key
  }

  const activeParamName = selectedParam?.parameterName ?? null;

  const { data: measurementsData, isLoading: measLoading } = useQuery({
    queryKey: ['quality', 'spc', 'measurements', activeParamName, filterKey],
    queryFn: () => api.get('/quality/spc/measurements', {
      params: { ...spcParams, parameterId: activeParamName, limit: 100 },
    }),
    enabled: !!activeParamName,
    staleTime: 30_000,
  });

  const rawMeasurements: SPCMeasurement[] = (measurementsData as any) ?? [];
  const measurements = [...rawMeasurements].reverse();

  const chartData = measurements.map((m, i) => ({
    sample: m.subgroupNumber ?? i + 1,
    value: m.value,
    isOutOfControl: m.isOutOfControl,
  }));

  const paramValues = measurements.map(m => m.value);
  const ucl = selectedParam?.ucl ?? measurements[0]?.ucl ?? null;
  const lcl = selectedParam?.lcl ?? measurements[0]?.lcl ?? null;
  const cl  = selectedParam?.mean ?? measurements[0]?.cl ?? null;

  const cpk = useMemo(() => {
    if (ucl == null || lcl == null || cl == null || paramValues.length < 2) return 0;
    return computeCpk(paramValues, ucl, lcl, cl);
  }, [paramValues, ucl, lcl, cl]);

  const status: Status = useMemo(() => {
    return computeStatus(rawMeasurements, cpk);
  }, [rawMeasurements, cpk]);

  const unit = selectedParam?.unit ?? '';

  const StatusIcon = selectedParam ? STATUS_CFG[status].icon : Activity;

  if (paramsLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <div>
            <h1 className="text-lg font-bold">{t('headers.spc.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t('headers.spc.subtitle')}</p>
          </div>
        </div>
        <div className="flex-1 p-6 grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="industrial-card rounded-xl p-4">
              <div className="shimmer h-4 rounded w-24 mb-3" />
              <div className="shimmer h-8 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (parameters.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <div>
            <h1 className="text-lg font-bold">{t('headers.spc.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t('spc.subtitleStability')}</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t('spc.noMeasurements')}</p>
            <p className="text-xs mt-1">{t('spc.noMeasurementsHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.spc.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('spc.subtitleCapability')}</p>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={openRecord}>
          <Plus size={14} /> {t('spc.record', { defaultValue: 'Record measurement' })}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Parameter selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {parameters.map((p) => {
            const isSelected = (selected ?? parameters[0]?.parameterName) === p.parameterName;
            return (
              <button
                key={p.parameterName}
                onClick={() => setSelected(p.parameterName)}
                className={cn(
                  'industrial-card rounded-xl p-4 text-left transition-all',
                  isSelected && 'border-brand-500/60 bg-brand-500/5',
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium truncate">{p.parameterName}</span>
                  <Activity size={13} className="text-muted-foreground shrink-0" />
                </div>
                <div className="text-xs text-muted-foreground">{t('spc.samples')}</div>
                <div className="text-2xl font-bold text-foreground">{p.sampleCount}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{p.unit ?? t('spc.unit')}</div>
              </button>
            );
          })}
        </div>

        {/* Main chart */}
        {selectedParam && (
          <div className="industrial-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold">{t('spc.controlChart', { name: selectedParam.parameterName })}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ucl != null && <>UCL: {ucl.toFixed(4)} {unit} &nbsp;|&nbsp;</>}
                  {cl  != null && <>{t('spc.mean')}: {cl.toFixed(4)} {unit} &nbsp;|&nbsp;</>}
                  {lcl != null && <>LCL: {lcl.toFixed(4)} {unit}</>}
                </p>
              </div>
              <div className={cn('flex items-center gap-1.5 text-xs font-semibold', STATUS_CFG[status].color)}>
                <StatusIcon size={13} />
                {t(STATUS_CFG[status].labelKey)}
              </div>
            </div>

            {measLoading ? (
              <div className="h-[280px] flex items-center justify-center">
                <div className="shimmer h-full w-full rounded-lg" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                {t('spc.noData')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="sample"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    label={{ value: t('spc.sample'), position: 'insideBottom', offset: -2, fontSize: 11, fill: '#64748b' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    domain={['auto', 'auto']}
                    unit={unit ? ` ${unit}` : ''}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                    formatter={(v: number) => [`${v} ${unit}`, t('spc.valueLabel')]}
                  />
                  {ucl != null && (
                    <ReferenceLine y={ucl} stroke="#ef4444" strokeDasharray="6 3" label={{ value: 'UCL', fill: '#ef4444', fontSize: 10 }} />
                  )}
                  {cl != null && (
                    <ReferenceLine y={cl} stroke="#4c7571" strokeDasharray="4 4" label={{ value: 'CL', fill: '#4c7571', fontSize: 10 }} />
                  )}
                  {lcl != null && (
                    <ReferenceLine y={lcl} stroke="#ef4444" strokeDasharray="6 3" label={{ value: 'LCL', fill: '#ef4444', fontSize: 10 }} />
                  )}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const d = chartData[props.index];
                      return (
                        <circle
                          key={props.index}
                          cx={props.cx}
                          cy={props.cy}
                          r={4}
                          fill={d?.isOutOfControl ? '#ef4444' : '#22c55e'}
                          stroke={d?.isOutOfControl ? '#ef4444' : '#22c55e'}
                        />
                      );
                    }}
                    activeDot={{ r: 5 }}
                    name={t('spc.valueLabel')}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Capability summary */}
        {selectedParam && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Cpk',  value: cpk,  isGood: cpk >= 1.33  },
              { label: 'UCL',  value: ucl != null ? `${ucl.toFixed(4)} ${unit}` : '—', isGood: true },
              { label: t('spc.mean'), value: cl  != null ? `${cl.toFixed(4)} ${unit}`  : '—', isGood: true },
              { label: 'LCL',  value: lcl != null ? `${lcl.toFixed(4)} ${unit}` : '—', isGood: true },
            ].map(s => (
              <div key={s.label} className="industrial-card rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className={cn('text-lg font-bold mt-0.5', !s.isGood ? 'text-red-400' : 'text-foreground')}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick-record SPC measurement(s) — direct entry (Industry-4.0 ready) */}
      <FormDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        title={t('spc.record', { defaultValue: 'Record measurement' })}
        onSubmit={submitRecord}
        isSubmitting={recordMutation.isPending}
        isValid={!!recMachineId && !!recParam && recValues.some(v => v.trim() !== '' && !isNaN(Number(v)))}
      >
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground">{t('spc.parameter', { defaultValue: 'Parameter' })}</label>
            <SelectMenu
              size="md" fullWidth value={recParam} onValueChange={setRecParam}
              options={parameters.map(p => ({ value: p.parameterName, label: `${p.parameterName}${p.unit ? ` (${p.unit})` : ''}` }))}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">{t('iform.machineLabel', { defaultValue: 'Machine' })}</label>
            <SelectMenu
              size="md" fullWidth value={recMachineId} onValueChange={setRecMachineId}
              options={machines.map(m => ({ value: m.id, label: m.code ? `${m.name} (${m.code})` : m.name }))}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">{t('spc.readings', { defaultValue: 'Readings (one per sampled unit)' })}</label>
            <div className="space-y-1.5 mt-1">
              {recValues.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-6">#{i + 1}</span>
                  <Input
                    value={v}
                    onChange={e => setRecValues(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                    className="h-8 text-sm flex-1"
                    placeholder={t('iform.enterValue')}
                    inputMode="decimal"
                  />
                  {recValues.length > 1 && (
                    <button type="button" onClick={() => setRecValues(prev => prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground/60 hover:text-red-400 px-1">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setRecValues(prev => [...prev, ''])}
              className="mt-1.5 text-[11px] text-primary hover:underline font-medium">
              + {t('iform.addReading', { defaultValue: 'Add reading' })}
            </button>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
