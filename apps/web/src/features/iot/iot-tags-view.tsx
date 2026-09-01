'use client';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Download, Search, Tag, MoreHorizontal, Pencil, Trash2,
  LayoutGrid, List, Server, Activity, Wifi, Gauge, Cpu, X,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { TablePagination } from '@/components/ui/table-pagination';
import { useToast } from '@/components/ui/use-toast';
import { useWebSocket } from '@/hooks/use-websocket';
import { api } from '@/services/api.client';
import { formatDate, cn } from '@/lib/utils';

export function IotTagsView() {
  const { t } = useTranslation(['iot', 'common']);
  const { toast } = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<'table' | 'grid' | 'device'>('grid')
  const [deviceFilter, setDeviceFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [dataTypeFilter, setDataTypeFilter] = useState('ALL')
  const [qualityFilter, setQualityFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [liveOnly, setLiveOnly] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editTag, setEditTag] = useState<any | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null)
  const emptyForm = {
    code: '', name: '', deviceId: '', scopeType: 'machine', machineId: '', lineId: '', areaId: '', dataType: 'INT', tagType: 'MEASUREMENT',
    unit: '', description: '',
    address: '', registerType: 'HOLDING', wordCount: '1', wordOrder: 'BIG',
    scaleFactor: '', offset: '', counterRole: 'NONE', edgeType: 'RISING', pollIntervalMs: '',
    historizationEnabled: true, isMachineStatus: false, statusMap: '',
    signalRole: 'NONE', pulseWindowMs: '', pulseMinEdges: '', idleThresholdMs: '',
    mqttPublishMode: 'CHANGE', mqttPublishRateSec: '', historizationMode: 'CHANGE', historizationRateSec: '', deadband: '',
  };
  const [form, setForm] = useState({ ...emptyForm })

  // Live tag values pushed from the edge gateway via MQTT→Socket.io bridge.
  const { subscribe } = useWebSocket()
  const [live, setLive] = useState<Record<string, { value: any; quality: string; ts: string }>>({})
  useEffect(() => {
    return subscribe('iot:tag:updated', (...args: unknown[]) => {
      const m = args[0] as { tagId?: string; tagCode?: string; value: any; quality: string; ts: string }
      const key = m.tagId || m.tagCode
      if (key) setLive(prev => ({ ...prev, [key]: { value: m.value, quality: m.quality, ts: m.ts } }))
    })
  }, [subscribe])

  const { data: tags, isLoading } = useQuery({
    queryKey: ['iot', 'tags', 'all'],
    queryFn: () => api.get('/iot/tags', { params: { limit: 500 } }),
    staleTime: 10_000,
  })

  // Devices for the source dropdown (gateway-pollable Modbus devices + others).
  const { data: devicesResp } = useQuery({
    queryKey: ['iot', 'devices', 'all'],
    queryFn: () => api.get('/iot/devices', { params: { limit: 200 } }),
    staleTime: 30_000,
  })
  const deviceOptions = (devicesResp as any)?.data ?? (Array.isArray(devicesResp) ? devicesResp : []);
  const { data: machinesResp } = useQuery({ queryKey: ['hierarchy', 'machines'], queryFn: () => api.get('/hierarchy/machines'), staleTime: 60_000 })
  const { data: linesResp } = useQuery({ queryKey: ['hierarchy', 'lines'], queryFn: () => api.get('/hierarchy/lines'), staleTime: 60_000 })
  const { data: areasResp } = useQuery({ queryKey: ['hierarchy', 'areas'], queryFn: () => api.get('/hierarchy/areas'), staleTime: 60_000 })
  const machineOpts = Array.isArray(machinesResp) ? machinesResp : ((machinesResp as any)?.data ?? []);
  const lineOpts = Array.isArray(linesResp) ? linesResp : ((linesResp as any)?.data ?? []);
  const areaOpts = Array.isArray(areasResp) ? areasResp : ((areasResp as any)?.data ?? []);

  const tagList: any[] = (tags as any)?.data ?? [];
  const PAGE = 24;

  // Resolve a tag's current value/quality/timestamp — prefer the live WS push.
  const resolveLive = (t: any) => {
    const lv = live[t.id] ?? live[t.code];
    return {
      value: lv?.value ?? t.currentValue?.value ?? null,
      quality: lv?.quality ?? t.currentValue?.quality ?? null,
      ts: lv?.ts ?? t.currentValue?.timestamp ?? null,
      isLive: !!lv,
    };
  };

  const filtered = useMemo(() => tagList.filter((t) => {
    const r = resolveLive(t);
    if (search && !`${t.code} ${t.name} ${t.device?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (deviceFilter !== 'ALL' && (t.deviceId ?? 'none') !== deviceFilter) return false;
    if (typeFilter !== 'ALL' && t.tagType !== typeFilter) return false;
    if (dataTypeFilter !== 'ALL' && t.dataType !== dataTypeFilter) return false;
    if (qualityFilter !== 'ALL' && (r.quality ?? 'UNKNOWN') !== qualityFilter) return false;
    if (statusFilter !== 'ALL' && (t.isActive ? 'ACTIVE' : 'INACTIVE') !== statusFilter) return false;
    if (liveOnly && !r.isLive) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tagList, live, search, deviceFilter, typeFilter, dataTypeFilter, qualityFilter, statusFilter, liveOnly]);

  const total = filtered.length;
  const pageData = filtered.slice((page - 1) * PAGE, page * PAGE);

  const kpis = useMemo(() => ({
    total: tagList.length,
    active: tagList.filter((t) => t.isActive).length,
    live: tagList.filter((t) => live[t.id] || live[t.code]).length,
    good: tagList.filter((t) => resolveLive(t).quality === 'GOOD').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tagList, live]);

  const tagTypes = useMemo(() => [...new Set(tagList.map((t) => t.tagType).filter(Boolean))].sort(), [tagList]);
  const dataTypes = useMemo(() => [...new Set(tagList.map((t) => t.dataType).filter(Boolean))].sort(), [tagList]);
  const activeFilterCount = [deviceFilter, typeFilter, dataTypeFilter, qualityFilter, statusFilter].filter((v) => v !== 'ALL').length + (liveOnly ? 1 : 0);
  const clearFilters = () => { setDeviceFilter('ALL'); setTypeFilter('ALL'); setDataTypeFilter('ALL'); setQualityFilter('ALL'); setStatusFilter('ALL'); setLiveOnly(false); setSearch(''); setPage(1); };

  useEffect(() => { setPage(1); }, [search, deviceFilter, typeFilter, dataTypeFilter, qualityFilter, statusFilter, liveOnly, viewMode]);

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/iot/tags', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'tags'] })
      toast({ title: 'Tag created successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to create tag', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/iot/tags/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'tags'] })
      toast({ title: 'Tag updated successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to update tag', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/iot/tags/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'tags'] })
      toast({ title: 'Tag deleted successfully' })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to delete tag', variant: 'destructive' }),
  })

  const handleOpenCreate = () => {
    setEditTag(null)
    setForm({ ...emptyForm })
    setFormOpen(true)
  };

  const handleOpenEdit = (tag: any) => {
    setEditTag(tag)
    setForm({
      code: tag.code || '',
      name: tag.name || '',
      deviceId: tag.deviceId || '',
      // Machine is the most specific scope — prefer it over the line/area that
      // are auto-derived from it (a machine-scoped tag also carries a lineId).
      scopeType: tag.machineId ? 'machine' : tag.lineId ? 'line' : tag.areaId ? 'area' : 'machine',
      machineId: tag.machineId || '',
      lineId: tag.lineId || '',
      areaId: tag.areaId || '',
      dataType: tag.dataType || 'INT',
      tagType: tag.tagType || 'MEASUREMENT',
      unit: tag.unit || '',
      description: tag.description || '',
      address: tag.address || '',
      registerType: tag.registerType || 'HOLDING',
      wordCount: String(tag.wordCount ?? 1),
      wordOrder: tag.wordOrder || 'BIG',
      scaleFactor: tag.scaleFactor != null ? String(tag.scaleFactor) : '',
      offset: tag.offset != null ? String(tag.offset) : '',
      counterRole: tag.counterRole || 'NONE',
      edgeType: tag.edgeType || 'RISING',
      pollIntervalMs: tag.pollIntervalMs != null ? String(tag.pollIntervalMs) : '',
      historizationEnabled: tag.historizationEnabled !== false,
      isMachineStatus: !!tag.isMachineStatus,
      statusMap: tag.statusMap ? JSON.stringify(tag.statusMap) : '',
      signalRole: tag.signalRole || 'NONE',
      pulseWindowMs: tag.pulseWindowMs != null ? String(tag.pulseWindowMs) : '',
      pulseMinEdges: tag.pulseMinEdges != null ? String(tag.pulseMinEdges) : '',
      idleThresholdMs: tag.idleThresholdMs != null ? String(tag.idleThresholdMs) : '',
      mqttPublishMode: tag.mqttPublishMode || 'CHANGE',
      mqttPublishRateSec: tag.mqttPublishRateSec != null ? String(tag.mqttPublishRateSec) : '',
      historizationMode: tag.historizationMode || 'CHANGE',
      historizationRateSec: tag.historizationRateSec != null ? String(tag.historizationRateSec) : '',
      deadband: tag.deadband != null ? String(tag.deadband) : '',
    })
    setFormOpen(true)
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditTag(null)
  };

  const handleSubmit = () => {
    // Coerce numeric strings; drop empties so they don't overwrite with NaN/null.
    const num = (s: string) => (s === '' ? undefined : Number(s));
    const dto: any = {
      code: form.code.trim(),
      name: form.name.trim(),
      deviceId: form.deviceId || null,
      machineId: form.scopeType === 'machine' ? (form.machineId || null) : null,
      lineId: form.scopeType === 'line' ? (form.lineId || null) : null,
      areaId: form.scopeType === 'area' ? (form.areaId || null) : null,
      dataType: form.dataType,
      tagType: form.tagType,
      unit: form.unit || null,
      description: form.description || null,
      address: form.address || null,
      registerType: form.registerType,
      wordCount: num(form.wordCount),
      wordOrder: form.wordOrder,
      scaleFactor: num(form.scaleFactor),
      offset: num(form.offset),
      counterRole: form.tagType === 'COUNTER' ? form.counterRole : 'NONE',
      edgeType: form.edgeType,
      pollIntervalMs: num(form.pollIntervalMs),
      historizationEnabled: form.historizationEnabled,
      mqttPublishMode: form.mqttPublishMode,
      mqttPublishRateSec: form.mqttPublishMode === 'RATE' ? (num(form.mqttPublishRateSec) ?? 0) : undefined,
      historizationMode: form.historizationMode,
      historizationRateSec: form.historizationMode === 'RATE' ? (num(form.historizationRateSec) ?? 0) : undefined,
      deadband: form.mqttPublishMode === 'CHANGE' || form.historizationMode === 'CHANGE' ? num(form.deadband) : undefined,
      // A PROCESSING signal never drives state — it measures whether product is
      // flowing, which is what Starved and Blocked are inferred FROM.
      isMachineStatus: form.signalRole === 'PROCESSING' ? false : form.isMachineStatus,
      statusMap: form.isMachineStatus && form.statusMap.trim()
        ? (() => { try { return JSON.parse(form.statusMap); } catch { return undefined; } })()
        : null,
      // How the gateway is to READ this signal — a separate question from whether
      // it DRIVES the machine's state. Tying the two together made a PROCESSING
      // binding impossible to express: the only way to reach this field was to
      // tick "drives machine state" first, which is the one thing a processing
      // signal must not do. NONE clears the role rather than sending the literal
      // string, so a tag can be demoted back to a plain one.
      signalRole: form.signalRole !== 'NONE' ? form.signalRole : null,
      pulseWindowMs: num(form.pulseWindowMs),
      pulseMinEdges: num(form.pulseMinEdges),
      idleThresholdMs: num(form.idleThresholdMs),
    };
    if (editTag) updateMutation.mutate({ id: editTag.id, dto })
    else createMutation.mutate(dto)
  };

  const isValid = !!(form.code && form.name && form.dataType)
  const isCounter = form.tagType === 'COUNTER'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">{t('headers.tags.title')}
            <DataModeBadge mode="live" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.tags.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            Export
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
            <Plus size={13} />
            Add Tag
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot className="empty:mb-0" />

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile icon={Tag} label="Total Tags" value={kpis.total} tone="text-foreground" />
          <KpiTile icon={Activity} label="Active" value={kpis.active} tone="text-blue-400" />
          <KpiTile icon={Wifi} label="Live now" value={kpis.live} tone="text-green-400" />
          <KpiTile icon={Gauge} label="Acceptance Quality" value={kpis.good} tone="text-emerald-400" />
        </div>

        {/* Toolbar: filters + view switch */}
        <div className="industrial-card p-3 flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder={t('tags.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-7 w-48 text-xs" />
          </div>
          <FilterSelect value={deviceFilter} onChange={setDeviceFilter} placeholder={t('tags.filterDevice')} width="w-40"
            options={[{ v: 'ALL', l: t('tags.allDevices') }, { v: 'none', l: t('tags.noDevice') }, ...deviceOptions.map((d: any) => ({ v: d.id, l: d.name }))]} />
          <FilterSelect value={typeFilter} onChange={setTypeFilter} placeholder={t('tags.filterType')} width="w-36"
            options={[{ v: 'ALL', l: t('tags.allTypes') }, ...tagTypes.map((tt) => ({ v: tt, l: tt }))]} />
          <FilterSelect value={dataTypeFilter} onChange={setDataTypeFilter} placeholder={t('tags.filterDataType')} width="w-32"
            options={[{ v: 'ALL', l: t('tags.allDataTypes') }, ...dataTypes.map((dt) => ({ v: dt, l: dt }))]} />
          <FilterSelect value={qualityFilter} onChange={setQualityFilter} placeholder={t('tags.filterQuality')} width="w-32"
            options={[{ v: 'ALL', l: t('tags.allQuality') }, { v: 'GOOD', l: t('tags.qGood') }, { v: 'BAD', l: t('tags.qBad') }, { v: 'UNCERTAIN', l: t('tags.qUncertain') }, { v: 'UNKNOWN', l: t('tags.qUnknown') }]} />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} placeholder={t('tags.filterStatus')} width="w-32"
            options={[{ v: 'ALL', l: t('tags.allStatus') }, { v: 'ACTIVE', l: t('tags.sActive') }, { v: 'INACTIVE', l: t('tags.sInactive') }]} />
          <Button variant={liveOnly ? 'default' : 'outline'} size="sm" className="h-8 text-xs gap-1.5" onClick={() => setLiveOnly((v) => !v)}>
            <Wifi size={12} /> Live only
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground" onClick={clearFilters}>
              <X size={12} /> Clear ({activeFilterCount})
            </Button>
          )}
          {/* View switch */}
          <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border/50 p-0.5">
            {([['grid', LayoutGrid, 'Live grid'], ['table', List, 'Table'], ['device', Server, 'By device']] as const).map(([m, Icon, title]) => (
              <button key={m} title={title} onClick={() => setViewMode(m)}
                className={cn('h-7 w-7 rounded-md flex items-center justify-center transition-colors', viewMode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/40')}>
                <Icon size={14} />
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">{total} of {tagList.length}</span>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer h-28 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="industrial-card py-16 text-center text-muted-foreground">
            <Tag size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No tags match the current filters</p>
            {activeFilterCount > 0 && <button className="text-xs text-primary mt-1 hover:underline" onClick={clearFilters}>Clear filters</button>}
          </div>
        ) : viewMode === 'grid' ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {pageData.map((t) => <TagCard key={t.id} tag={t} live={resolveLive(t)} onEdit={() => handleOpenEdit(t)} onDelete={() => setDeleteDialog({ id: t.id, name: t.name })} />)}
            </div>
            <TablePagination page={page} total={total} limit={PAGE} onPageChange={setPage} isLoading={isLoading} />
          </>
        ) : viewMode === 'device' ? (
          <div className="space-y-4">
            {Object.entries(filtered.reduce((acc: Record<string, any[]>, t) => {
              const key = t.device?.name ?? 'Unassigned';
              (acc[key] ||= []).push(t); return acc;
            }, {})).map(([device, group]) => (
              <div key={device} className="industrial-card p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Server size={14} className="text-primary" />
                  <span className="text-sm font-semibold">{device}</span>
                  <Badge variant="outline" className="text-[10px]">{group.length}</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {group.map((t) => <TagCard key={t.id} tag={t} live={resolveLive(t)} onEdit={() => handleOpenEdit(t)} onDelete={() => setDeleteDialog({ id: t.id, name: t.name })} />)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="industrial-card p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  {['Tag', 'Device', 'Type / Role', 'Data Type', 'Current Value', 'Unit', 'Quality', 'Last Update', 'Status', ''].map((h) => (
                    <TableHead key={h} className="text-[11px] font-semibold">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageData.map((tag: any) => {
                  const r = resolveLive(tag);
                  return (
                    <TableRow key={tag.id} className="border-border/20 hover:bg-muted/20">
                      <TableCell className="text-xs">
                        <div className="font-mono font-semibold text-primary">{tag.code}</div>
                        <div className="text-muted-foreground">{tag.name}</div>
                      </TableCell>
                      <TableCell className="text-xs">{tag.device?.name ?? '—'}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px] h-5">{tag.tagType}</Badge>
                        {tag.counterRole && tag.counterRole !== 'NONE' && (
                          <Badge variant="secondary" className="text-[10px] h-5 ml-1">{tag.counterRole}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{tag.dataType}</TableCell>
                      <TableCell className="text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          {r.isLive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" title="Live" />}
                          {fmtTagValue(r.value)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{tag.unit ?? '—'}</TableCell>
                      <TableCell><QualityBadge quality={r.quality} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.ts ? formatDate(r.ts) : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={tag.isActive ? 'default' : 'secondary'} className="text-[10px] h-5">{tag.isActive ? 'Active' : 'Inactive'}</Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenEdit(tag)}><Pencil className="w-3.5 h-3.5 mr-2" />Edit</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ id: tag.id, name: tag.name })}><Trash2 className="w-3.5 h-3.5 mr-2" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <TablePagination page={page} total={total} limit={PAGE} onPageChange={setPage} isLoading={isLoading} />
          </div>
        )}
      </div>

      <FormDialog
        open={formOpen}
        onClose={handleCloseForm}
        title={editTag ? t('tform.editTitle') : t('tform.createTitle')}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('tform.tagCode')} *</Label>
            <Input value={form.code} onChange={e => setForm(v => ({ ...v, code: e.target.value }))} className="mt-1" placeholder="e.g. CNT_GOOD_01" />
          </div>
          <div>
            <Label>{t('tform.tagName')} *</Label>
            <Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} className="mt-1" placeholder="e.g. Acceptance count" />
          </div>
          <div>
            <Label>{t('tform.tagType')}</Label>
            {/* Choosing STATUS is already the statement "this tag drives machine
                state" — making the user then find a checkbox further down the
                form to say it again is a trap, and a STATUS tag left unticked
                is read by nothing. */}
            <Select
              value={form.tagType}
              onValueChange={v => setForm(f => ({
                ...f,
                tagType: v,
                isMachineStatus: v === 'STATUS' && f.signalRole !== 'PROCESSING' ? true : f.isMachineStatus,
              }))}
            >
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEASUREMENT">{t('tform.measurement')}</SelectItem>
                <SelectItem value="COUNTER">{t('tform.counter')}</SelectItem>
                <SelectItem value="STATUS">{t('tform.status')}</SelectItem>
                <SelectItem value="SETPOINT">{t('tform.setpoint')}</SelectItem>
                <SelectItem value="ALARM">{t('tform.alarm')}</SelectItem>
                <SelectItem value="EVENT">{t('tform.event')}</SelectItem>
                <SelectItem value="ENERGY">{t('tform.energy')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('tform.dataType')} *</Label>
            <Select value={form.dataType} onValueChange={v => setForm(f => ({ ...f, dataType: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INT">{t('tform.integer')}</SelectItem>
                <SelectItem value="FLOAT">{t('tform.float')}</SelectItem>
                <SelectItem value="BOOL">{t('tform.boolean')}</SelectItem>
                <SelectItem value="STRING">{t('tform.string')}</SelectItem>
                <SelectItem value="TIMESTAMP">{t('tform.timestamp')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('tform.sourceDevice')}</Label>
            <Select value={form.deviceId || 'none'} onValueChange={v => setForm(f => ({ ...f, deviceId: v === 'none' ? '' : v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('tform.selectDevice')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('tform.noneDash')}</SelectItem>
                {deviceOptions.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('tform.unit')}</Label>
            <Input value={form.unit} onChange={e => setForm(v => ({ ...v, unit: e.target.value }))} className="mt-1" placeholder="e.g. °C, pcs, RPM" />
          </div>
          <div>
            <Label>{t('tform.scope')}{isCounter ? t('tform.scopeCounterHint') : ''}</Label>
            <Select value={form.scopeType} onValueChange={v => setForm(f => ({ ...f, scopeType: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="machine">{t('tform.machine')}</SelectItem>
                <SelectItem value="line">{t('tform.line')}</SelectItem>
                <SelectItem value="area">{t('tform.area')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{form.scopeType === 'line' ? t('tform.productionLine') : form.scopeType === 'area' ? t('tform.area') : t('tform.machine')}</Label>
            <Select
              value={(form.scopeType === 'machine' ? form.machineId : form.scopeType === 'line' ? form.lineId : form.areaId) || 'none'}
              onValueChange={v => setForm(f => ({ ...f, [f.scopeType === 'machine' ? 'machineId' : f.scopeType === 'line' ? 'lineId' : 'areaId']: v === 'none' ? '' : v }))}
            >
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('tform.select')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('tform.selectDash')}</SelectItem>
                {(form.scopeType === 'machine' ? machineOpts : form.scopeType === 'line' ? lineOpts : areaOpts).map((o: any) => (
                  <SelectItem key={o.id} value={o.id}>{o.name} ({o.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Modbus register binding ── */}
          <div className="col-span-2 pt-2 mt-1 border-t border-border/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('tform.modbusBinding')}
          </div>
          <div>
            <Label>{t('tform.registerAddress')}</Label>
            <Input value={form.address} onChange={e => setForm(v => ({ ...v, address: e.target.value }))} className="mt-1" placeholder="e.g. 100" />
          </div>
          <div>
            <Label>{t('tform.registerType')}</Label>
            <Select value={form.registerType} onValueChange={v => setForm(f => ({ ...f, registerType: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HOLDING">{t('tform.holding')}</SelectItem>
                <SelectItem value="INPUT">{t('tform.input')}</SelectItem>
                <SelectItem value="COIL">{t('tform.coil')}</SelectItem>
                <SelectItem value="DISCRETE">{t('tform.discrete')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('tform.wordCount')}</Label>
            <Select value={form.wordCount} onValueChange={v => setForm(f => ({ ...f, wordCount: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t('tform.word1')}</SelectItem>
                <SelectItem value="2">{t('tform.word2')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('tform.wordOrder')}</Label>
            <Select value={form.wordOrder} onValueChange={v => setForm(f => ({ ...f, wordOrder: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BIG">{t('tform.bigEndian')}</SelectItem>
                <SelectItem value="LITTLE">{t('tform.littleEndian')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('tform.scaleFactor')}</Label>
            <Input value={form.scaleFactor} onChange={e => setForm(v => ({ ...v, scaleFactor: e.target.value }))} className="mt-1" placeholder="e.g. 0.1" />
          </div>
          <div>
            <Label>{t('tform.offset')}</Label>
            <Input value={form.offset} onChange={e => setForm(v => ({ ...v, offset: e.target.value }))} className="mt-1" placeholder="e.g. 0" />
          </div>

          {/* ── Counter mapping (only for COUNTER tags) ── */}
          {isCounter && (
            <>
              <div className="col-span-2 pt-2 mt-1 border-t border-border/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('tform.counterMapping')}
              </div>
              <div>
                <Label>{t('tform.counterRole')}</Label>
                <Select value={form.counterRole} onValueChange={v => setForm(f => ({ ...f, counterRole: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t('tform.crNone')}</SelectItem>
                    <SelectItem value="TOTAL">{t('tform.crTotal')}</SelectItem>
                    <SelectItem value="GOOD">{t('tform.crGood')}</SelectItem>
                    <SelectItem value="BAD">{t('tform.crBad')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('tform.edgeTrigger')}</Label>
                <Select value={form.edgeType} onValueChange={v => setForm(f => ({ ...f, edgeType: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RISING">{t('tform.etRising')}</SelectItem>
                    <SelectItem value="FALLING">{t('tform.etFalling')}</SelectItem>
                    <SelectItem value="CHANGE">{t('tform.etChange')}</SelectItem>
                    <SelectItem value="TOTALIZER">{t('tform.etTotalizer')}</SelectItem>
                  </SelectContent>
                </Select>
                {form.edgeType === 'TOTALIZER' && (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t('tform.etTotalizerHint')}</p>
                )}
              </div>
            </>
          )}

          <div className="col-span-2">
            <Label>{t('tform.description')}</Label>
            <Input value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} className="mt-1" />
          </div>

          {/* Historian + machine-status options */}
          <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border/40">
            <label className="flex items-center gap-2 text-sm cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={form.historizationEnabled}
                onChange={e => setForm(v => ({ ...v, historizationEnabled: e.target.checked }))}
              />
              <span>{t('tform.historize')}</span>
            </label>
            {/* Separate from the signal role below: the role says how the bit is
                READ, this says whether it DRIVES the machine's state. A
                processing signal has a role and must not have this. */}
            <label className={`flex items-center gap-2 text-sm mt-2 ${form.signalRole === 'PROCESSING' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={form.signalRole === 'PROCESSING' ? false : form.isMachineStatus}
                disabled={form.signalRole === 'PROCESSING'}
                onChange={e => setForm(v => ({ ...v, isMachineStatus: e.target.checked }))}
              />
              <span>{t('tform.machineStatusDriver')}</span>
            </label>
            {form.signalRole === 'PROCESSING' && (
              <p className="text-[11px] text-muted-foreground mt-1">{t('tform.processingNeverDrivesState')}</p>
            )}
          </div>

          {/* ── Emission control: MQTT + historian by change / by rate ── */}
          <div className="col-span-2 pt-2 mt-1 border-t border-border/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('tform.emissionControl')}
          </div>
          <div>
            <Label>{t('tform.mqttPublishMode')}</Label>
            <Select value={form.mqttPublishMode} onValueChange={v => setForm(f => ({ ...f, mqttPublishMode: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CHANGE">{t('tform.emitOnChange')}</SelectItem>
                <SelectItem value="RATE">{t('tform.emitByRate')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.mqttPublishMode === 'RATE' && (
            <div>
              <Label>{t('tform.mqttPublishRateSec')}</Label>
              <Input type="number" min={0} value={form.mqttPublishRateSec} onChange={e => setForm(v => ({ ...v, mqttPublishRateSec: e.target.value }))} className="mt-1" placeholder="e.g. 5" />
            </div>
          )}
          <div>
            <Label>{t('tform.historizationMode')}</Label>
            <Select value={form.historizationMode} onValueChange={v => setForm(f => ({ ...f, historizationMode: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CHANGE">{t('tform.emitOnChange')}</SelectItem>
                <SelectItem value="RATE">{t('tform.emitByRate')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.historizationMode === 'RATE' && (
            <div>
              <Label>{t('tform.historizationRateSec')}</Label>
              <Input type="number" min={0} value={form.historizationRateSec} onChange={e => setForm(v => ({ ...v, historizationRateSec: e.target.value }))} className="mt-1" placeholder="e.g. 60" />
            </div>
          )}
          {(form.mqttPublishMode === 'CHANGE' || form.historizationMode === 'CHANGE') && form.dataType !== 'BOOL' && form.dataType !== 'STRING' && (
            <div className="col-span-2">
              <Label>{t('tform.deadband')}</Label>
              <Input value={form.deadband} onChange={e => setForm(v => ({ ...v, deadband: e.target.value }))} className="mt-1" placeholder={t('tform.deadbandPlaceholder')} />
              <p className="text-[11px] text-muted-foreground mt-1">{t('tform.deadbandHelp')}</p>
            </div>
          )}

          {(form.isMachineStatus || form.tagType === 'STATUS' || form.signalRole !== 'NONE') && (
            <div className="col-span-2 rounded-lg border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground space-y-3">
              <p>
                {form.dataType === 'BOOL'
                  ? t('tform.boolHelp')
                  : t('tform.intHelp')}
                {' '}{t('tform.countersRunningOnly')}
              </p>
              {form.dataType === 'INT' && form.isMachineStatus && (
                <div>
                  <Label className="text-xs">{t('tform.statusMap')}</Label>
                  <Input
                    value={form.statusMap}
                    onChange={e => setForm(v => ({ ...v, statusMap: e.target.value }))}
                    placeholder='{"0":"IDLE","1":"RUNNING","2":"BREAKDOWN"}'
                    className="mt-1 font-mono text-[11px]"
                  />
                </div>
              )}

              {/* ── Signal interpretation ──────────────────────────────────
                  The same wire means different things on different machines.
                  A run-mode contact that stays closed while the machine waits
                  for product says something different from one that opens; a
                  robot that signals "stopped" by pulsing says something
                  different again. Which of those this tag is, is a plant fact,
                  so it is chosen here rather than compiled in. */}
              <div className="pt-2 border-t border-border/40">
                <Label className="text-xs">{t('tform.signalRole')}</Label>
                <Select value={form.signalRole} onValueChange={v => setForm(f => ({
                  ...f,
                  signalRole: v,
                  // Choosing PROCESSING answers the question the checkbox asks.
                  isMachineStatus: v === 'PROCESSING' ? false : f.isMachineStatus,
                }))}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t('tform.roleNone')}</SelectItem>
                    <SelectItem value="RUN_MODE">{t('tform.roleRunMode')}</SelectItem>
                    <SelectItem value="RUN_MODE_PULSED">{t('tform.roleRunModePulsed')}</SelectItem>
                    <SelectItem value="PROCESSING">{t('tform.roleProcessing')}</SelectItem>
                    <SelectItem value="INFEED_AVAILABLE">{t('tform.roleInfeed')}</SelectItem>
                    <SelectItem value="OUTFEED_BLOCKED">{t('tform.roleOutfeed')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] mt-1">
                  {form.signalRole === 'RUN_MODE' && t('tform.roleRunModeHelp')}
                  {form.signalRole === 'RUN_MODE_PULSED' && t('tform.roleRunModePulsedHelp')}
                  {form.signalRole === 'PROCESSING' && t('tform.roleProcessingHelp')}
                  {form.signalRole === 'INFEED_AVAILABLE' && t('tform.roleInfeedHelp')}
                  {form.signalRole === 'OUTFEED_BLOCKED' && t('tform.roleOutfeedHelp')}
                  {form.signalRole === 'NONE' && t('tform.roleNoneHelp')}
                </p>
              </div>

              {/* Pulse detection only means anything for a pulsing signal. */}
              {form.signalRole === 'RUN_MODE_PULSED' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">{t('tform.pulseWindowMs')}</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-xs" placeholder="6000"
                      value={form.pulseWindowMs}
                      onChange={e => setForm(v => ({ ...v, pulseWindowMs: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">{t('tform.pulseMinEdges')}</Label>
                    <Input type="number" min={2} className="mt-1 h-8 text-xs" placeholder="4"
                      value={form.pulseMinEdges}
                      onChange={e => setForm(v => ({ ...v, pulseMinEdges: e.target.value }))} />
                  </div>
                  <p className="col-span-2 text-[11px]">{t('tform.pulseHelp')}</p>
                </div>
              )}

              {/* A processing signal is legitimately still between units. How
                  long is the plant's own slowest normal cycle — a wrapper table
                  rests minutes between pallets, a filler does not. */}
              {form.signalRole === 'PROCESSING' && (
                <div>
                  <Label className="text-xs">{t('tform.idleThresholdMs')}</Label>
                  <Input type="number" min={0} className="mt-1 h-8 text-xs" placeholder="300000"
                    value={form.idleThresholdMs}
                    onChange={e => setForm(v => ({ ...v, idleThresholdMs: e.target.value }))} />
                  <p className="text-[11px] mt-1">{t('tform.idleThresholdHelp')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('tform.deleteTitle', { name: deleteDialog?.name })}
        description={t('tform.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function fmtTagValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

const QUALITY_CLS: Record<string, string> = {
  GOOD: 'text-green-400 border-green-500/30 bg-green-500/10',
  BAD: 'text-red-400 border-red-500/30 bg-red-500/10',
  UNCERTAIN: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
};

function QualityBadge({ quality }: { quality: string | null }) {
  if (!quality) return <span className="text-[10px] text-muted-foreground">—</span>;
  return <span className={cn('inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border', QUALITY_CLS[quality] ?? 'text-muted-foreground border-border')}>{quality}</span>;
}

function KpiTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className="industrial-card p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0"><Icon size={16} className={tone} /></div>
      <div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={cn('text-xl font-bold leading-none mt-0.5', tone)}>{value}</div>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, options, placeholder, width }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; placeholder: string; width: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-8 text-xs', width)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function TagCard({ tag, live, onEdit, onDelete }: { tag: any; live: { value: any; quality: string | null; ts: string | null; isLive: boolean }; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className={cn('rounded-xl border bg-card p-3 transition-colors hover:border-foreground/20 relative', live.isLive ? 'border-green-500/30' : 'border-border/50', !tag.isActive && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold text-primary truncate">{tag.code}</div>
          <div className="text-[10px] text-muted-foreground truncate">{tag.name}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1 shrink-0"><MoreHorizontal size={13} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}><Pencil className="w-3.5 h-3.5 mr-2" />Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="w-3.5 h-3.5 mr-2" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          {live.isLive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />}
          <span className="text-2xl font-bold tabular-nums truncate">{fmtTagValue(live.value)}</span>
          {tag.unit && <span className="text-[10px] text-muted-foreground shrink-0">{tag.unit}</span>}
        </div>
        <QualityBadge quality={live.quality} />
      </div>
      <div className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 truncate"><Cpu size={10} /> {tag.device?.name ?? '—'}</span>
        <span className="shrink-0">{live.ts ? new Date(live.ts).toLocaleTimeString() : '—'}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <Badge variant="outline" className="text-[9px] h-4 px-1">{tag.tagType}</Badge>
        {tag.counterRole && tag.counterRole !== 'NONE' && <Badge variant="secondary" className="text-[9px] h-4 px-1">{tag.counterRole}</Badge>}
        <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground">{tag.dataType}</Badge>
      </div>
    </div>
  );
}
