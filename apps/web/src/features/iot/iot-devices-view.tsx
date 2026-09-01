'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { Plus, Download, Search, Wifi, WifiOff, Activity, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { MachinePicker } from '@/components/ui/machine-picker';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { KPICard } from '@/components/widgets/kpi-card';
import { TablePagination } from '@/components/ui/table-pagination';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { formatDate } from '@/lib/utils';

export function IotDevicesView() {
  const { t } = useTranslation(['iot', 'common']);
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editDevice, setEditDevice] = useState<any | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null)
  const emptyForm = {
    deviceId: '', name: '', type: 'PLC', protocol: 'MODBUS', location: '', ipAddress: '',
    port: '502', unitId: '1', pollIntervalMs: '', gatewayId: '',
    scopeType: 'machine', machineId: '', lineId: '', areaId: '',
    serialPort: '', baudRate: '9600', parity: 'none', stopBits: '1',
    // EdgeCounter block ranges (start + quantity per register type).
    ecDiStart: '0', ecDiQty: '8', ecCoilStart: '0', ecCoilQty: '0',
    ecHrStart: '0', ecHrQty: '0', ecIrStart: '0', ecIrQty: '0',
  };
  const [form, setForm] = useState({ ...emptyForm })

  // Edge gateways for the assignment dropdown.
  const { data: gatewaysResp } = useQuery({
    queryKey: ['iot', 'gateways', 'all'],
    queryFn: () => api.get('/iot/gateways'),
    staleTime: 30_000,
  })
  const gatewayOptions = Array.isArray(gatewaysResp) ? gatewaysResp : ((gatewaysResp as any)?.data ?? []);
  const { data: linesResp } = useQuery({ queryKey: ['hierarchy', 'lines'], queryFn: () => api.get('/hierarchy/lines'), staleTime: 60_000 })
  const { data: areasResp } = useQuery({ queryKey: ['hierarchy', 'areas'], queryFn: () => api.get('/hierarchy/areas'), staleTime: 60_000 })
  const lineOptions = Array.isArray(linesResp) ? linesResp : ((linesResp as any)?.data ?? []);
  const areaOptions = Array.isArray(areasResp) ? areasResp : ((areasResp as any)?.data ?? []);

  const { data: devices, isLoading } = useQuery({
    queryKey: ['iot', 'devices', { search, page }],
    queryFn: () => api.get('/iot/devices', { params: { search, limit: 20, page } }),
    staleTime: 15_000,
  })

  const { data: kpis } = useQuery({
    queryKey: ['iot', 'devices-kpis'],
    queryFn: () => api.get('/iot/devices/kpis'),
    refetchInterval: 30_000,
  })

  const deviceList = (devices as any)?.data ?? [];
  const total: number = (devices as any)?.total ?? 0;

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/iot/devices', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'devices'] })
      toast({ title: t('devices.createdSuccess') })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: t('devices.errorTitle'), description: e?.response?.data?.message ?? t('devices.createFailed'), variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/iot/devices/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'devices'] })
      toast({ title: t('devices.updatedSuccess') })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: t('devices.errorTitle'), description: e?.response?.data?.message ?? t('devices.updateFailed'), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/iot/devices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'devices'] })
      toast({ title: t('devices.deletedSuccess') })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: t('devices.errorTitle'), description: e?.response?.data?.message ?? t('devices.deleteFailed'), variant: 'destructive' }),
  })

  const handleOpenCreate = () => {
    setEditDevice(null)
    setForm({ ...emptyForm })
    setFormOpen(true)
  };

  const handleOpenEdit = (device: any) => {
    setEditDevice(device)
    setForm({
      deviceId: device.deviceCode || device.deviceId || '',
      name: device.name || '',
      type: device.type || 'PLC',
      protocol: device.protocol || 'MODBUS',
      location: device.location || '',
      ipAddress: device.ipAddress || '',
      port: device.port != null ? String(device.port) : '502',
      unitId: device.unitId != null ? String(device.unitId) : '1',
      pollIntervalMs: device.pollIntervalMs != null ? String(device.pollIntervalMs) : '',
      gatewayId: device.gatewayId || '',
      // Machine is the most specific scope — prefer it over the line/area that
      // are auto-derived from it (a machine-scoped device also carries a lineId).
      scopeType: device.machineId ? 'machine' : device.lineId ? 'line' : device.areaId ? 'area' : 'machine',
      machineId: device.machineId || '',
      lineId: device.lineId || '',
      areaId: device.areaId || '',
      serialPort: device.serialPort || '',
      baudRate: device.baudRate != null ? String(device.baudRate) : '9600',
      parity: device.parity || 'none',
      stopBits: device.stopBits != null ? String(device.stopBits) : '1',
      ecDiStart: String(device.config?.edgeCounter?.discrete?.start ?? 0),
      ecDiQty: String(device.config?.edgeCounter?.discrete?.quantity ?? 0),
      ecCoilStart: String(device.config?.edgeCounter?.coil?.start ?? 0),
      ecCoilQty: String(device.config?.edgeCounter?.coil?.quantity ?? 0),
      ecHrStart: String(device.config?.edgeCounter?.holding?.start ?? 0),
      ecHrQty: String(device.config?.edgeCounter?.holding?.quantity ?? 0),
      ecIrStart: String(device.config?.edgeCounter?.input?.start ?? 0),
      ecIrQty: String(device.config?.edgeCounter?.input?.quantity ?? 0),
    })
    setFormOpen(true)
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditDevice(null)
  };

  const handleSubmit = () => {
    const num = (s: string) => (s === '' ? undefined : Number(s));
    const dto: any = {
      deviceCode: form.deviceId.trim(),
      name: form.name.trim(),
      type: form.type,
      protocol: form.protocol,
      ipAddress: form.ipAddress || null,
      port: num(form.port),
      unitId: num(form.unitId),
      pollIntervalMs: num(form.pollIntervalMs),
      gatewayId: form.gatewayId || null,
      machineId: form.scopeType === 'machine' ? (form.machineId || null) : null,
      lineId: form.scopeType === 'line' ? (form.lineId || null) : null,
      areaId: form.scopeType === 'area' ? (form.areaId || null) : null,
      serialPort: form.protocol === 'MODBUS_RTU' ? (form.serialPort || null) : null,
      baudRate: form.protocol === 'MODBUS_RTU' ? num(form.baudRate) : undefined,
      parity: form.protocol === 'MODBUS_RTU' ? form.parity : undefined,
      stopBits: form.protocol === 'MODBUS_RTU' ? num(form.stopBits) : undefined,
    };
    // EdgeCounter: send the block ranges so the backend auto-creates one tag per
    // address. Only sent on create (auto-provision runs once).
    if (form.type === 'EDGE_COUNTER' && !editDevice) {
      const range = (start: string, qty: string) => ({ start: Number(start) || 0, quantity: Number(qty) || 0 });
      dto.edgeCounter = {
        discrete: range(form.ecDiStart, form.ecDiQty),
        coil: range(form.ecCoilStart, form.ecCoilQty),
        holding: range(form.ecHrStart, form.ecHrQty),
        input: range(form.ecIrStart, form.ecIrQty),
      };
    }
    if (editDevice) updateMutation.mutate({ id: editDevice.id, dto })
    else createMutation.mutate(dto)
  };

  const isValid = !!(form.deviceId && form.name && form.type && form.protocol)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.devices.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.devices.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            {t('common.export')}
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
            <Plus size={13} />
            {t('common.addDevice')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <InlineFormSlot />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('devices.kpiTotal')} value={(kpis as any)?.total ?? 0} isLoading={isLoading} />
          <KPICard title={t('devices.kpiConnected')} value={(kpis as any)?.connected ?? 0} colorMode="default" isLoading={isLoading} />
          <KPICard title={t('devices.kpiDisconnected')} value={(kpis as any)?.disconnected ?? 0} colorMode="alarm" isLoading={isLoading} />
          <KPICard title={t('devices.kpiErrors')} value={(kpis as any)?.errored ?? 0} colorMode="alarm" isLoading={isLoading} />
        </div>

        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{t('devices.connectedDevices')}</h3>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('devices.searchPlaceholder')}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="h-8 pl-7 w-48 text-xs"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="text-[11px] font-semibold">{t('devices.thDeviceId')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thName')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thType')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thProtocol')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thStatus')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thLastSeen')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thTags')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thScope')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thGateway')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('devices.thActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="shimmer h-3.5 rounded w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : deviceList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">
                      {t('devices.noDevices')}
                    </TableCell>
                  </TableRow>
                ) : (
                  deviceList.map((device: any) => (
                    <TableRow key={device.id} className="border-border/20 hover:bg-muted/20 cursor-pointer">
                      <TableCell className="font-mono text-xs font-semibold text-primary">{device.deviceCode}</TableCell>
                      <TableCell className="text-xs font-medium">{device.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{device.type}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{device.protocol}</TableCell>
                      <TableCell>
                        <Badge
                          variant={device.status === 'CONNECTED' ? 'default' : device.status === 'ERROR' ? 'destructive' : 'secondary'}
                          className="text-[10px] h-5 gap-1"
                        >
                          {device.status === 'CONNECTED' ? <Wifi size={10} /> : <WifiOff size={10} />}
                          {device.status}
                        </Badge>
                        {device.status === 'ERROR' && device.lastError && (
                          <div className="text-[10px] text-danger-400 mt-0.5 max-w-[180px] truncate" title={device.lastError}>{device.lastError}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{device.lastSeenAt ? formatDate(device.lastSeenAt) : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{device._count?.tagDefinitions ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{device.machine?.name ? `${device.machine.name}` : device.line?.name ? t('devices.scopeLine', { name: device.line.name }) : device.area?.name ? t('devices.scopeArea', { name: device.area.name }) : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{device.gateway?.name ?? '—'}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenEdit(device)}>
                              <Pencil className="w-3.5 h-3.5 mr-2" />{t('common.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ id: device.id, name: device.name })}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" />{t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
          </div>
        </div>
      </div>

      <FormDialog
        open={formOpen}
        onClose={handleCloseForm}
        title={editDevice ? t('dform.editTitle') : t('dform.createTitle')}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('dform.deviceCode')} *</Label>
            <Input value={form.deviceId} onChange={e => setForm(v => ({ ...v, deviceId: e.target.value }))} className="mt-1" placeholder="e.g. PLC-LINE1" />
          </div>
          <div>
            <Label>{t('dform.name')} *</Label>
            <Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('dform.type')} *</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v, pollIntervalMs: v === 'EDGE_COUNTER' && !f.pollIntervalMs ? '100' : f.pollIntervalMs }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PLC">PLC</SelectItem>
                <SelectItem value="HMI">HMI</SelectItem>
                <SelectItem value="GATEWAY">{t('dform.tGateway')}</SelectItem>
                <SelectItem value="SENSOR">{t('dform.tSensor')}</SelectItem>
                <SelectItem value="METER">{t('dform.tMeter')}</SelectItem>
                <SelectItem value="DRIVE">{t('dform.tDrive')}</SelectItem>
                <SelectItem value="EDGE_COUNTER">{t('dform.tEdgeCounter')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('dform.protocol')} *</Label>
            <Select value={form.protocol} onValueChange={v => setForm(f => ({ ...f, protocol: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MODBUS">{t('dform.pModbusTcp')}</SelectItem>
                <SelectItem value="MODBUS_RTU_TCP">{t('dform.pModbusRtuTcp')}</SelectItem>
                <SelectItem value="MODBUS_RTU">{t('dform.pModbusRtu')}</SelectItem>
                <SelectItem value="MQTT">MQTT</SelectItem>
                <SelectItem value="OPCUA">{t('dform.pOpcua')}</SelectItem>
                <SelectItem value="HTTP">{t('dform.pHttp')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.protocol === 'MODBUS_RTU' ? (
            <>
              <div>
                <Label>{t('dform.serialPort')}</Label>
                <Input value={form.serialPort} onChange={e => setForm(v => ({ ...v, serialPort: e.target.value }))} className="mt-1" placeholder="COM3" />
              </div>
              <div>
                <Label>{t('dform.baudRate')}</Label>
                <Input value={form.baudRate} onChange={e => setForm(v => ({ ...v, baudRate: e.target.value }))} className="mt-1" placeholder="9600" />
              </div>
              <div>
                <Label>{t('dform.parity')}</Label>
                <Select value={form.parity} onValueChange={v => setForm(f => ({ ...f, parity: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('dform.pNone')}</SelectItem>
                    <SelectItem value="even">{t('dform.pEven')}</SelectItem>
                    <SelectItem value="odd">{t('dform.pOdd')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('dform.stopBits')}</Label>
                <Input value={form.stopBits} onChange={e => setForm(v => ({ ...v, stopBits: e.target.value }))} className="mt-1" placeholder="1" />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>{t('dform.ipAddress')}</Label>
                <Input value={form.ipAddress} onChange={e => setForm(v => ({ ...v, ipAddress: e.target.value }))} className="mt-1" placeholder="e.g. 192.168.1.100" />
              </div>
              <div>
                <Label>{t('dform.port')}</Label>
                <Input value={form.port} onChange={e => setForm(v => ({ ...v, port: e.target.value }))} className="mt-1" placeholder="502" />
              </div>
            </>
          )}

          {/* ── Edge gateway acquisition ── */}
          <div className="col-span-2 pt-2 mt-1 border-t border-border/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dform.edgeAcq')}
          </div>
          <div>
            <Label>{t('dform.assignedGateway')}</Label>
            <Select value={form.gatewayId || 'none'} onValueChange={v => setForm(f => ({ ...f, gatewayId: v === 'none' ? '' : v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('dform.selectGateway')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('dform.noneDash')}</SelectItem>
                {gatewayOptions.map((g: any) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}{g.online ? t('dform.onlineSuffix') : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('dform.scope')}</Label>
            <Select value={form.scopeType} onValueChange={v => setForm(f => ({ ...f, scopeType: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="machine">{t('dform.machine')}</SelectItem>
                <SelectItem value="line">{t('dform.line')}</SelectItem>
                <SelectItem value="area">{t('dform.area')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{form.scopeType === 'line' ? t('dform.productionLine') : form.scopeType === 'area' ? t('dform.area') : t('dform.boundMachine')}</Label>
            <div className="mt-1">
              {form.scopeType === 'machine' ? (
                <MachinePicker value={form.machineId || null} onChange={(id) => setForm(f => ({ ...f, machineId: id || '' }))} placeholder={t('dform.selectMachine')} />
              ) : form.scopeType === 'line' ? (
                <Select value={form.lineId || 'none'} onValueChange={v => setForm(f => ({ ...f, lineId: v === 'none' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder={t('dform.selectLine')} /></SelectTrigger>
                  <SelectContent><SelectItem value="none">{t('dform.selectDash')}</SelectItem>{lineOptions.map((l: any) => (<SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>))}</SelectContent>
                </Select>
              ) : (
                <Select value={form.areaId || 'none'} onValueChange={v => setForm(f => ({ ...f, areaId: v === 'none' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder={t('dform.selectArea')} /></SelectTrigger>
                  <SelectContent><SelectItem value="none">{t('dform.selectDash')}</SelectItem>{areaOptions.map((a: any) => (<SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>))}</SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div>
            <Label>{t('dform.modbusUnitId')}</Label>
            <Input value={form.unitId} onChange={e => setForm(v => ({ ...v, unitId: e.target.value }))} className="mt-1" placeholder="1" />
          </div>
          <div>
            <Label>{t('dform.pollInterval')}</Label>
            <Input value={form.pollIntervalMs} onChange={e => setForm(v => ({ ...v, pollIntervalMs: e.target.value }))} className="mt-1" placeholder={t('dform.pollPlaceholder')} />
          </div>

          {/* ── EdgeCounter: auto-create tags from register blocks ── */}
          {form.type === 'EDGE_COUNTER' && (
            <>
              <div className="col-span-2 pt-2 mt-1 border-t border-border/40">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dform.ecBlocks')}</div>
                <p className="text-[11px] text-muted-foreground mt-1">{editDevice ? t('dform.ecEditNote') : t('dform.ecHint')}</p>
              </div>
              {([
                ['discrete', t('dform.ecDiscrete'), 'ecDiStart', 'ecDiQty'],
                ['coil', t('dform.ecCoil'), 'ecCoilStart', 'ecCoilQty'],
                ['holding', t('dform.ecHolding'), 'ecHrStart', 'ecHrQty'],
                ['input', t('dform.ecInput'), 'ecIrStart', 'ecIrQty'],
              ] as const).map(([key, label, startKey, qtyKey]) => (
                <div key={key} className="col-span-2 grid grid-cols-[1fr_auto_auto] items-end gap-2">
                  <Label className="pb-2">{label}</Label>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">{t('dform.ecStart')}</Label>
                    <Input type="number" min={0} disabled={!!editDevice} value={(form as any)[startKey]} onChange={e => setForm(v => ({ ...v, [startKey]: e.target.value }))} className="mt-1 w-24" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">{t('dform.ecQty')}</Label>
                    <Input type="number" min={0} disabled={!!editDevice} value={(form as any)[qtyKey]} onChange={e => setForm(v => ({ ...v, [qtyKey]: e.target.value }))} className="mt-1 w-24" />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('dform.deleteTitle', { name: deleteDialog?.name })}
        description={t('dform.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
