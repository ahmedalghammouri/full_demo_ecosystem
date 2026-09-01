'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { Zap, Gauge, Thermometer, Activity, Plus, Clock, Pencil, Trash2, MoreVertical, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SelectMenu } from '@/components/ui/select-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';

interface EnergyMeter {
  id: string;
  meterNumber: string;
  name: string;
  type: string;
  unit: string;
  brand: string | null;
  location: string | null;
  machine: { name: string; code: string } | null;
  area: { name: string } | null;
  lastReading: { value: number; unit: string; timestamp: string; source: string } | null;
  mtdConsumption: number;
  mtdCost: number;
}

const TYPE_COLORS: Record<string, string> = {
  ELECTRICAL: 'text-yellow-400 bg-yellow-500/20',
  NATURAL_GAS: 'text-orange-400 bg-orange-500/20',
  COMPRESSED_AIR: 'text-cyan-400 bg-cyan-500/20',
  WATER: 'text-blue-400 bg-blue-500/20',
  STEAM: 'text-purple-400 bg-purple-500/20',
  CHILLED_WATER: 'text-green-400 bg-green-500/20',
};

// Per-template identity + comms defaults applied when a template is chosen in the meter form.
// Values follow each vendor's published defaults (PM5110: RS485-only, Modbus RTU, 19200 8E1).
const TEMPLATE_DEFAULTS: Record<string, Record<string, unknown>> = {
  SCHNEIDER_PM5110: {
    type: 'ELECTRICAL', unit: 'kWh', model: 'METSEPM5110',
    protocol: 'MODBUS_RTU', unitId: 1, serialPort: 'COM3',
    baudRate: 19200, parity: 'even', dataBits: 8, stopBits: 1,
  },
};

const TYPE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  ELECTRICAL: Zap,
  NATURAL_GAS: Thermometer,
  COMPRESSED_AIR: Gauge,
  WATER: Activity,
  STEAM: Thermometer,
  CHILLED_WATER: Activity,
};

function timeAgo(iso: string, t: (k: string, o?: any) => string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return t('energy.agoMin', { value: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('energy.agoHour', { value: hrs });
  return t('energy.agoDay', { value: Math.floor(hrs / 24) });
}

export function EnergyMetersView() {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const [showReadingForm, setShowReadingForm] = useState<EnergyMeter | null>(null);
  const [readingValue, setReadingValue] = useState('');
  const [showMeterForm, setShowMeterForm] = useState(false);
  const [editMeter, setEditMeter] = useState<EnergyMeter | null>(null);
  const [deleteMeter, setDeleteMeter] = useState<EnergyMeter | null>(null);
  const { register, handleSubmit, reset, setValue, watch } = useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['energy', 'meters'],
    queryFn: () => api.get<EnergyMeter[]>('/energy/meters'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: gateways } = useQuery({
    queryKey: ['iot', 'gateways'],
    queryFn: () => api.get<any[]>('/iot/gateways'),
    staleTime: 30_000,
  });
  const { data: templates } = useQuery({
    queryKey: ['energy', 'meter-templates'],
    queryFn: () => api.get<any[]>('/energy/meter-templates'),
    staleTime: 300_000,
  });
  const gatewayOptions = Array.isArray(gateways) ? gateways : [];
  const templateOptions = Array.isArray(templates) ? templates : [];

  const { data: machinesR } = useQuery({ queryKey: ['hierarchy', 'machines'], queryFn: () => api.get<any[]>('/hierarchy/machines'), staleTime: 60_000 });
  const { data: linesR } = useQuery({ queryKey: ['hierarchy', 'lines'], queryFn: () => api.get<any[]>('/hierarchy/lines'), staleTime: 60_000 });
  const { data: areasR } = useQuery({ queryKey: ['hierarchy', 'areas'], queryFn: () => api.get<any[]>('/hierarchy/areas'), staleTime: 60_000 });
  const machineOpts = Array.isArray(machinesR) ? machinesR : ((machinesR as any)?.data ?? []);
  const lineOpts = Array.isArray(linesR) ? linesR : ((linesR as any)?.data ?? []);
  const areaOpts = Array.isArray(areasR) ? areasR : ((areasR as any)?.data ?? []);

  const addReadingMutation = useMutation({
    mutationFn: (dto: { meterId: string; value: number }) => api.post('/energy/readings', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['energy'] });
      toast({ title: t('energy.toastReadingAdded') });
      setShowReadingForm(null);
      setReadingValue('');
    },
  });

  const createMeterMutation = useMutation({
    mutationFn: (dto: any) => api.post('/energy/meters', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['energy'] });
      toast({ title: t('energy.toastMeterCreated') });
      setShowMeterForm(false);
      setEditMeter(null);
      reset();
    },
  });

  const updateMeterMutation = useMutation({
    mutationFn: ({ id, ...dto }: any) => api.patch(`/energy/meters/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['energy'] });
      toast({ title: t('energy.toastMeterUpdated') });
      setShowMeterForm(false);
      setEditMeter(null);
      reset();
    },
  });

  const deleteMeterMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/energy/meters/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['energy'] });
      toast({ title: t('energy.toastMeterDeleted') });
      setDeleteMeter(null);
    },
  });

  const handleEdit = (meter: EnergyMeter) => {
    setEditMeter(meter);
    setValue('meterNumber', meter.meterNumber);
    setValue('name', meter.name);
    setValue('type', meter.type);
    setValue('unit', meter.unit);
    setValue('location', meter.location || '');
    setShowMeterForm(true);
  };

  // Selecting a meter template pre-fills identity + the vendor's RS485 comms defaults so
  // the created device polls without hand-tuning. PM5110 ships RS485-only @ 19200 8E1 (see
  // its register map md). Fields stay editable afterward.
  const applyTemplate = (key: string) => {
    setValue('templateKey', key);
    const tpl = templateOptions.find((t) => t.key === key);
    if (tpl?.manufacturer) setValue('manufacturer', tpl.manufacturer);
    const d = TEMPLATE_DEFAULTS[key];
    if (d) for (const [k, v] of Object.entries(d)) setValue(k, v as any);
  };

  const onSubmitMeter = (data: any) => {
    // Resolve scope: keep only the selected machine/line/area target.
    const st = data.scopeType ?? 'machine';
    const scoped = {
      ...data,
      machineId: st === 'machine' ? (data.machineId || null) : null,
      lineId: st === 'line' ? (data.lineId || null) : null,
      areaId: st === 'area' ? (data.areaId || null) : null,
    };
    delete scoped.scopeType;
    if (editMeter) {
      updateMeterMutation.mutate({ id: editMeter.id, ...scoped });
    } else {
      createMeterMutation.mutate(scoped);
    }
  };

  const meters: EnergyMeter[] = Array.isArray(data) ? data : [];

  const byType = meters.reduce<Record<string, EnergyMeter[]>>((acc, m) => {
    if (!acc[m.type]) acc[m.type] = [];
    acc[m.type].push(m);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('energy.meters.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('energy.metersCount', { count: meters.length })}</p>
        </div>
        <Button onClick={() => { setShowMeterForm(true); setEditMeter(null); reset({ type: 'ELECTRICAL' }); }}>
          <Plus className="w-4 h-4 mr-2" />{t('energy.addMeter')}
        </Button>
      </div>

      <InlineFormSlot />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-5">
              <div className="shimmer h-32 rounded" />
            </div>
          ))}
        </div>
      ) : meters.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">
          <Gauge className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <div className="font-medium">{t('energy.noMeters')}</div>
        </div>
      ) : (
        Object.entries(byType).map(([type, typeMeters]) => {
          const palette = TYPE_COLORS[type] ?? 'text-muted-foreground bg-muted/20';
          const [textColor, bgColor] = palette.split(' ');
          const Icon = TYPE_ICONS[type] ?? Zap;
          return (
            <div key={type}>
              <div className="flex items-center gap-2 mb-3">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', bgColor)}>
                  <Icon className={cn('w-3.5 h-3.5', textColor)} />
                </div>
                <h2 className="font-semibold text-sm">{type.replace(/_/g, ' ')}</h2>
                <Badge variant="outline" className="text-[10px]">{t('energy.metersBadge', { count: typeMeters.length })}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {typeMeters.map((m, i) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="glass-card rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-sm">{m.name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{m.meterNumber}</div>
                      </div>
                      <Badge variant="outline" className={cn('text-[10px]', textColor, bgColor.replace('bg-', 'border-').replace('/20', '/40'))}>
                        {m.unit}
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      {m.machine?.name ?? m.area?.name ?? m.location ?? t('energy.factoryLevel')}
                    </div>

                    <div className="border-t border-border/40 pt-3 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{t('energy.cardLastReading')}</span>
                        {m.lastReading ? (
                          <span className="font-semibold">{m.lastReading.value} {m.lastReading.unit}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </div>
                      {m.lastReading && (
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />{timeAgo(m.lastReading.timestamp, t)}
                          </span>
                          <span>{m.lastReading.source}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-muted-foreground">{t('energy.cardMtdConsumption')}</span>
                        <span className="font-semibold">{m.mtdConsumption.toLocaleString()} {m.unit}</span>
                      </div>
                      {m.mtdCost > 0 && (
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{t('energy.cardMtdCost')}</span>
                          <span className="text-green-400">{m.mtdCost.toLocaleString()} SAR</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                        onClick={() => { setShowReadingForm(m); setReadingValue(''); }}
                      >
                        <Plus className="w-3 h-3 mr-1" />{t('energy.addReading')}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0">
                            <MoreVertical className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(m)}>
                            <Pencil className="w-3 h-3 mr-2" />{t('energy.tform.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDeleteMeter(m)} className="text-destructive">
                            <Trash2 className="w-3 h-3 mr-2" />{t('energy.tform.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* Cost tariffs — configure SAR per unit, scoped by machine/line/area */}
      <EnergyTariffsSection machineOpts={machineOpts} lineOpts={lineOpts} areaOpts={areaOpts} />

      {/* Add reading — inline form */}
      {showReadingForm && (
        <InlineFormPanel
          open={!!showReadingForm}
          onClose={() => setShowReadingForm(null)}
          icon={Activity}
          title={t('energy.mform.addReadingTitle', { name: showReadingForm.name })}
          description={t('energy.mform.readingDesc', { unit: showReadingForm.unit })}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={() => setShowReadingForm(null)}>{t('energy.mform.cancel')}</Button>
              <Button
                size="sm"
                disabled={!readingValue || addReadingMutation.isPending}
                onClick={() => addReadingMutation.mutate({
                  meterId: showReadingForm.id,
                  value: parseFloat(readingValue),
                })}
              >
                {addReadingMutation.isPending ? t('energy.mform.saving') : t('energy.mform.save')}
              </Button>
            </>
          )}
        >
            <Input
              type="number"
              placeholder={t('energy.mform.valuePlaceholder', { unit: showReadingForm.unit })}
              value={readingValue}
              onChange={e => setReadingValue(e.target.value)}
              className="h-9"
              autoFocus
            />
        </InlineFormPanel>
      )}

      {/* Create/Edit Meter — inline form */}
      <InlineFormPanel
        open={showMeterForm}
        onClose={() => { setShowMeterForm(false); setEditMeter(null); }}
        icon={editMeter ? Pencil : Plus}
        title={editMeter ? t('energy.mform.editTitle') : t('energy.mform.createTitle')}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => { setShowMeterForm(false); setEditMeter(null); }}>{t('energy.mform.cancel')}</Button>
            <Button type="button" onClick={handleSubmit(onSubmitMeter)} disabled={createMeterMutation.isPending || updateMeterMutation.isPending}>
              {createMeterMutation.isPending || updateMeterMutation.isPending ? t('energy.mform.saving') : t('energy.mform.save')}
            </Button>
          </>
        )}
      >
            <form onSubmit={handleSubmit(onSubmitMeter)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('energy.mform.meterNumber')} *</Label>
                  <Input {...register('meterNumber', { required: true })} placeholder="MTR-001" className="mt-1" />
                </div>
                <div>
                  <Label>{t('energy.mform.type')} *</Label>
                  <SelectMenu
                    size="md"
                    fullWidth
                    className="mt-1"
                    value={(watch('type') as string) ?? 'ELECTRICAL'}
                    onValueChange={(v) => setValue('type', v, { shouldValidate: true })}
                    options={[
                      { value: 'ELECTRICAL', label: t('energy.mform.tElectrical') },
                      { value: 'NATURAL_GAS', label: t('energy.mform.tNaturalGas') },
                      { value: 'COMPRESSED_AIR', label: t('energy.mform.tCompressedAir') },
                      { value: 'WATER', label: t('energy.mform.tWater') },
                      { value: 'STEAM', label: t('energy.mform.tSteam') },
                      { value: 'CHILLED_WATER', label: t('energy.mform.tChilledWater') },
                    ]}
                  />
                </div>
              </div>
              <div>
                <Label>{t('energy.mform.name')} *</Label>
                <Input {...register('name', { required: true })} placeholder={t('energy.mform.namePlaceholder')} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('energy.mform.unit')} *</Label>
                  <Input {...register('unit', { required: true })} placeholder="kWh" className="mt-1" />
                </div>
                <div>
                  <Label>{t('energy.mform.location')}</Label>
                  <Input {...register('location')} placeholder={t('energy.mform.locationPlaceholder')} className="mt-1" />
                </div>
              </div>

              {/* Scope — what this meter measures in the plant hierarchy */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('energy.mform.scope')}</Label>
                  <SelectMenu size="md" fullWidth className="mt-1"
                    value={(watch('scopeType') as string) ?? 'machine'}
                    onValueChange={(v) => setValue('scopeType', v)}
                    options={[{ value: 'machine', label: t('energy.mform.machine') }, { value: 'line', label: t('energy.mform.line') }, { value: 'area', label: t('energy.mform.area') }]}
                  />
                </div>
                <div>
                  <Label>{(watch('scopeType') ?? 'machine') === 'line' ? t('energy.mform.productionLine') : (watch('scopeType') === 'area') ? t('energy.mform.area') : t('energy.mform.machine')}</Label>
                  {(() => {
                    const st = (watch('scopeType') as string) ?? 'machine';
                    const opts = st === 'line' ? lineOpts : st === 'area' ? areaOpts : machineOpts;
                    const field = st === 'line' ? 'lineId' : st === 'area' ? 'areaId' : 'machineId';
                    return (
                      <SelectMenu size="md" fullWidth className="mt-1"
                        value={(watch(field) as string) ?? ''}
                        onValueChange={(v) => setValue(field, v)}
                        options={[{ value: '', label: t('energy.mform.selectDash') }, ...opts.map((o: any) => ({ value: o.id, label: `${o.name} (${o.code})` }))]}
                      />
                    );
                  })()}
                </div>
              </div>

              {/* Power-meter acquisition (optional) — makes the meter pollable by an edge gateway */}
              {!editMeter && (
                <div className="pt-3 mt-1 border-t border-border/40 space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('energy.mform.edgeAcq')}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t('energy.mform.edgeGateway')}</Label>
                      <SelectMenu size="md" fullWidth className="mt-1"
                        value={(watch('gatewayId') as string) ?? ''}
                        onValueChange={(v) => setValue('gatewayId', v)}
                        options={[{ value: '', label: t('energy.mform.noneManual') }, ...gatewayOptions.map((g) => ({ value: g.id, label: `${g.name}${g.online ? t('energy.mform.onlineSuffix') : ''}` }))]}
                      />
                    </div>
                    <div>
                      <Label>{t('energy.mform.meterTemplate')}</Label>
                      <SelectMenu size="md" fullWidth className="mt-1"
                        value={(watch('templateKey') as string) ?? ''}
                        onValueChange={(v) => applyTemplate(v)}
                        options={[{ value: '', label: t('energy.mform.noneDash') }, ...templateOptions.map((tpl) => ({ value: tpl.key, label: tpl.label }))]}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t('energy.mform.protocol')}</Label>
                      <SelectMenu size="md" fullWidth className="mt-1"
                        value={(watch('protocol') as string) ?? 'MODBUS'}
                        onValueChange={(v) => setValue('protocol', v)}
                        options={[
                          { value: 'MODBUS', label: t('energy.mform.pModbusTcp') },
                          { value: 'MODBUS_RTU_TCP', label: t('energy.mform.pModbusRtuTcp') },
                          { value: 'MODBUS_RTU', label: t('energy.mform.pModbusRtu') },
                        ]}
                      />
                    </div>
                    <div>
                      <Label>{t('energy.mform.modbusUnitId')}</Label>
                      <Input type="number" {...register('unitId', { valueAsNumber: true })} placeholder="1" className="mt-1" />
                    </div>
                  </div>
                  {watch('protocol') === 'MODBUS_RTU' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>{t('energy.mform.serialPort')}</Label><Input {...register('serialPort')} placeholder="COM3" className="mt-1" /></div>
                      <div><Label>{t('energy.mform.baudRate')}</Label><Input type="number" {...register('baudRate', { valueAsNumber: true })} placeholder="19200" className="mt-1" /></div>
                      <div><Label>{t('energy.mform.parity')}</Label>
                        <SelectMenu size="md" fullWidth className="mt-1" value={(watch('parity') as string) ?? 'even'} onValueChange={(v) => setValue('parity', v)}
                          options={[{ value: 'none', label: t('energy.mform.pNone') }, { value: 'even', label: t('energy.mform.pEven') }, { value: 'odd', label: t('energy.mform.pOdd') }]} />
                      </div>
                      <div><Label>{t('energy.mform.dataBits')}</Label><Input type="number" {...register('dataBits', { valueAsNumber: true })} placeholder="8" className="mt-1" /></div>
                      <div><Label>{t('energy.mform.stopBits')}</Label><Input type="number" {...register('stopBits', { valueAsNumber: true })} placeholder="1" className="mt-1" /></div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>{t('energy.mform.ipAddress')}</Label><Input {...register('ipAddress')} placeholder="192.168.1.50" className="mt-1" /></div>
                      <div><Label>{t('energy.mform.port')}</Label><Input type="number" {...register('port', { valueAsNumber: true })} placeholder="502" className="mt-1" /></div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>{t('energy.mform.manufacturer')}</Label><Input {...register('manufacturer')} placeholder="Schneider Electric" className="mt-1" /></div>
                    <div><Label>{t('energy.mform.model')}</Label><Input {...register('model')} placeholder="METSEPM5110" className="mt-1" /></div>
                  </div>
                </div>
              )}
            </form>
      </InlineFormPanel>

      {/* Delete Dialog */}
      {deleteMeter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold">{t('energy.mform.deleteTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('energy.mform.deleteConfirmPre')} <strong>{deleteMeter.name}</strong>{t('energy.mform.deleteConfirmPost')}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteMeter(null)}>{t('energy.mform.cancel')}</Button>
              <Button variant="destructive" onClick={() => deleteMeterMutation.mutate(deleteMeter.id)} disabled={deleteMeterMutation.isPending}>
                {deleteMeterMutation.isPending ? t('energy.mform.deleting') : t('energy.mform.delete')}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ── Cost Tariffs ────────────────────────────────────────────────────────────

interface EnergyTariff {
  id: string;
  energyType: string;
  ratePerUnit: number;
  currency: string;
  label: string | null;
  machine: { id: string; name: string; code: string } | null;
  line: { id: string; name: string } | null;
  area: { id: string; name: string } | null;
}

const ENERGY_TYPE_OPTS = [
  { value: 'ELECTRICAL', tKey: 'tElectrical' },
  { value: 'NATURAL_GAS', tKey: 'tNaturalGas' },
  { value: 'COMPRESSED_AIR', tKey: 'tCompressedAir' },
  { value: 'WATER', tKey: 'tWater' },
  { value: 'STEAM', tKey: 'tSteam' },
  { value: 'CHILLED_WATER', tKey: 'tChilledWater' },
];

function EnergyTariffsSection({ machineOpts, lineOpts, areaOpts }: { machineOpts: any[]; lineOpts: any[]; areaOpts: any[] }) {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EnergyTariff | null>(null);
  const [energyType, setEnergyType] = useState('ELECTRICAL');
  const [scopeType, setScopeType] = useState('factory');
  const [scopeId, setScopeId] = useState('');
  const [rate, setRate] = useState('');
  const [label, setLabel] = useState('');

  const { data } = useQuery({
    queryKey: ['energy', 'tariffs'],
    queryFn: () => api.get<EnergyTariff[]>('/energy/tariffs'),
    staleTime: 30_000,
  });
  const tariffs: EnergyTariff[] = Array.isArray(data) ? data : [];

  const reset = () => { setEditing(null); setEnergyType('ELECTRICAL'); setScopeType('factory'); setScopeId(''); setRate(''); setLabel(''); };
  const invalidate = () => qc.invalidateQueries({ queryKey: ['energy'] });

  const createM = useMutation({
    mutationFn: (dto: any) => api.post('/energy/tariffs', dto),
    onSuccess: () => { invalidate(); toast({ title: t('energy.toastTariffCreated') }); setShowForm(false); reset(); },
  });
  const updateM = useMutation({
    mutationFn: ({ id, ...dto }: any) => api.patch(`/energy/tariffs/${id}`, dto),
    onSuccess: () => { invalidate(); toast({ title: t('energy.toastTariffUpdated') }); setShowForm(false); reset(); },
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api.delete(`/energy/tariffs/${id}`),
    onSuccess: () => { invalidate(); toast({ title: t('energy.toastTariffDeleted') }); },
  });

  const openEdit = (t: EnergyTariff) => {
    setEditing(t);
    setEnergyType(t.energyType);
    setScopeType(t.machine ? 'machine' : t.line ? 'line' : t.area ? 'area' : 'factory');
    setScopeId(t.machine?.id ?? t.line?.id ?? t.area?.id ?? '');
    setRate(String(t.ratePerUnit));
    setLabel(t.label ?? '');
    setShowForm(true);
  };

  const submit = () => {
    const dto: any = {
      energyType,
      ratePerUnit: parseFloat(rate),
      label: label || null,
      machineId: scopeType === 'machine' ? (scopeId || null) : null,
      lineId: scopeType === 'line' ? (scopeId || null) : null,
      areaId: scopeType === 'area' ? (scopeId || null) : null,
    };
    if (editing) updateM.mutate({ id: editing.id, ...dto });
    else createM.mutate(dto);
  };

  const scopeOpts = scopeType === 'machine' ? machineOpts : scopeType === 'line' ? lineOpts : scopeType === 'area' ? areaOpts : [];
  const scopeLabel = (tf: EnergyTariff) =>
    tf.machine ? `${t('energy.tform.machine')} · ${tf.machine.name}` : tf.line ? `${t('energy.tform.line')} · ${tf.line.name}` : tf.area ? `${t('energy.tform.area')} · ${tf.area.name}` : t('energy.tform.factoryDefault');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-green-500/20">
            <DollarSign className="w-3.5 h-3.5 text-green-400" />
          </div>
          <h2 className="font-semibold text-sm">{t('energy.costTariffs')}</h2>
          <Badge variant="outline" className="text-[10px]">{t('energy.ratesBadge', { count: tariffs.length })}</Badge>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { reset(); setShowForm(true); }}>
          <Plus className="w-3 h-3 mr-1" />{t('energy.addTariff')}
        </Button>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        {tariffs.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            {t('energy.noTariffs')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-background/60">
              <tr className="border-b border-border">
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('energy.metersCol.energyType')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('energy.metersCol.scope')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('energy.metersCol.label')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('energy.metersCol.rate')}</th>
                <th className="p-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {tariffs.map((tf) => (
                <tr key={tf.id} className="border-b border-border/30 hover:bg-foreground/5">
                  <td className="p-3 text-xs">{tf.energyType.replace(/_/g, ' ')}</td>
                  <td className="p-3 text-xs text-muted-foreground">{scopeLabel(tf)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{tf.label ?? '—'}</td>
                  <td className="p-3 text-xs text-right font-semibold text-green-400">{t('energy.ratePerUnit', { rate: tf.ratePerUnit, currency: tf.currency })}</td>
                  <td className="p-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0"><MoreVertical className="w-3 h-3" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(tf)}><Pencil className="w-3 h-3 me-2" />{t('energy.tform.edit')}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => deleteM.mutate(tf.id)} className="text-destructive"><Trash2 className="w-3 h-3 me-2" />{t('energy.tform.delete')}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <InlineFormPanel
        open={showForm}
        onClose={() => { setShowForm(false); reset(); }}
        icon={editing ? Pencil : DollarSign}
        title={editing ? t('energy.tform.editTitle') : t('energy.tform.createTitle')}
        description={t('energy.tform.desc')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setShowForm(false); reset(); }}>{t('energy.tform.cancel')}</Button>
            <Button onClick={submit} disabled={!rate || createM.isPending || updateM.isPending}>
              {createM.isPending || updateM.isPending ? t('energy.tform.saving') : t('energy.tform.save')}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('energy.tform.energyType')} *</Label>
              <SelectMenu size="md" fullWidth className="mt-1" value={energyType} onValueChange={setEnergyType} options={ENERGY_TYPE_OPTS.map((o) => ({ value: o.value, label: t(`energy.mform.${o.tKey}`) }))} />
            </div>
            <div>
              <Label>{t('energy.tform.rate')} *</Label>
              <Input type="number" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.18" className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('energy.tform.scope')}</Label>
              <SelectMenu size="md" fullWidth className="mt-1" value={scopeType}
                onValueChange={(v) => { setScopeType(v); setScopeId(''); }}
                options={[{ value: 'factory', label: t('energy.tform.factoryDefault') }, { value: 'area', label: t('energy.tform.area') }, { value: 'line', label: t('energy.tform.line') }, { value: 'machine', label: t('energy.tform.machine') }]} />
            </div>
            <div>
              <Label>{scopeType === 'factory' ? t('energy.tform.appliesTo') : t('energy.tform.target')}</Label>
              {scopeType === 'factory' ? (
                <Input disabled value={t('energy.tform.allMeters')} className="mt-1" />
              ) : (
                <SelectMenu size="md" fullWidth className="mt-1" value={scopeId} onValueChange={setScopeId}
                  options={[{ value: '', label: t('energy.tform.selectDash') }, ...scopeOpts.map((o: any) => ({ value: o.id, label: o.code ? `${o.name} (${o.code})` : o.name }))]} />
              )}
            </div>
          </div>
          <div>
            <Label>{t('energy.tform.label')}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('energy.tform.labelPlaceholder')} className="mt-1" />
          </div>
        </div>
      </InlineFormPanel>
    </div>
  );
}
