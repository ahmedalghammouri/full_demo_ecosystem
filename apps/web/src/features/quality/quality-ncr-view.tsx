'use client';
import { useTranslation } from 'react-i18next';
import { toFactoryDayKey } from '@/lib/datetime';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Eye, Filter, ChevronDown, AlertTriangle, MoreHorizontal, Pencil, Trash2, Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { ExportMenu } from '@/components/ui/export-menu';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MachinePicker } from '@/components/ui/machine-picker';
import { EntityPicker } from '@/components/ui/entity-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn, formatDate } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';

type Severity = 'MINOR' | 'MAJOR' | 'CRITICAL';
type NcrStatus = 'OPEN' | 'IN_REVIEW' | 'CAPA_PENDING' | 'RESOLVED' | 'CLOSED';

const SEV: Record<Severity, { label: string; color: string }> = {
  MINOR:    { label: 'Minor',    color: 'text-brand-400' },
  MAJOR:    { label: 'Major',    color: 'text-amber-400' },
  CRITICAL: { label: 'Critical', color: 'text-red-400'   },
};

const STATUS_VARIANT: Record<NcrStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  OPEN: 'destructive', IN_REVIEW: 'secondary', CAPA_PENDING: 'outline', RESOLVED: 'default', CLOSED: 'secondary',
};

const STATUS_LABELS: Record<NcrStatus, string> = {
  OPEN: 'Open', IN_REVIEW: 'In Review', CAPA_PENDING: 'CAPA Pending', RESOLVED: 'Resolved', CLOSED: 'Closed',
};

// Valid NCR transitions
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_REVIEW', 'RESOLVED'],
  IN_REVIEW: ['CAPA_PENDING', 'RESOLVED'],
  CAPA_PENDING: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

interface NCR {
  id: string;
  ncrNumber: string;
  title: string;
  severity: Severity;
  status: NcrStatus;
  defectCategory?: string;
  affectedQty?: number;
  detectedBy?: { name: string };
  reportedAt: string;
  dueDate?: string;
  machine?: { name: string };
  batchRecord?: { batchNumber: string };
  sku?: { name: string; code: string };
}

const DISPOSITIONS = ['USE_AS_IS', 'REWORK', 'SCRAP', 'RETURN_TO_SUPPLIER'] as const;
const DISPOSITION_LABELS: Record<string, string> = {
  USE_AS_IS: 'Use As-Is', REWORK: 'Rework', SCRAP: 'Scrap', RETURN_TO_SUPPLIER: 'Return to Supplier',
};

const EMPTY_NCR_FORM = {
  title: '', severity: 'MINOR', defectCategory: '', defectCode: '', quantity: '',
  machineId: '__none__', skuId: '__none__', batchRecordId: '__none__', disposition: '__none__',
  description: '', detectedAt: toFactoryDayKey(new Date()),
  dueDate: toFactoryDayKey(Date.now() + 7 * 24 * 60 * 60 * 1000),
  rootCause: '', correctiveAction: '', preventiveAction: '',
};

export function QualityNcrView() {
  const { t } = useTranslation(['quality', 'common']);
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<NcrStatus | null>(null)
  const [severityFilter, setSeverityFilter] = useState<Severity | null>(null)
  const [archived, setArchived] = useState<ArchiveScope>('active')
  const [formOpen, setFormOpen] = useState(false)
  const [editNCR, setEditNCR] = useState<NCR | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; ncrNumber: string } | null>(null)
  const [form, setForm] = useState(EMPTY_NCR_FORM)

  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { filter, key: scopeKey } = useScope()
  const { dateFrom, dateTo, key: timeKey } = useTimeRange()

  const { data, isLoading } = useQuery({
    queryKey: ['quality', 'ncr', { search, status: statusFilter, severity: severityFilter, archived, page, scopeKey, timeKey }],
    queryFn: () => api.get('/quality/ncr', {
      params: {
        search: search || undefined, status: statusFilter || undefined, severity: severityFilter || undefined,
        archived: archived !== 'active' ? archived : undefined,
        ...filter, dateFrom, dateTo,
        limit: 20, page,
      },
    }),
    staleTime: 20_000,
  })

  const { data: machinesData } = useQuery({
    queryKey: ['hierarchy', 'machines', 'ncr-dropdown'],
    queryFn: () => api.get('/hierarchy/machines'),
    staleTime: 120_000,
    enabled: formOpen,
  })
  const { data: workOrdersData } = useQuery({
    queryKey: ['production', 'work-orders', 'ncr-dropdown'],
    queryFn: () => api.get('/production/work-orders', { params: { limit: 100 } }),
    staleTime: 60_000,
    enabled: formOpen,
  })
  const { data: skusData } = useQuery({
    queryKey: ['inventory', 'products', 'ncr-dropdown'],
    queryFn: () => api.get('/inventory/products', { params: { limit: 200 } }),
    staleTime: 120_000,
    enabled: formOpen,
  })
  const { data: batchesData } = useQuery({
    queryKey: ['production', 'batches', 'ncr-dropdown'],
    queryFn: () => api.get('/production/batches', { params: { limit: 100 } }),
    staleTime: 60_000,
    enabled: formOpen,
  })
  const machines: Array<{ id: string; name: string; code: string }> = (machinesData as any) ?? []
  const workOrders: Array<{ id: string; orderNumber: string; sku?: { name: string } }> = (workOrdersData as any)?.data ?? []
  const skus: Array<{ id: string; name: string; code: string }> = (skusData as any)?.data ?? []
  const batches: Array<{ id: string; batchNumber: string }> = (batchesData as any)?.data ?? []

  const ncrs: NCR[] = (data as any)?.data ?? (data as any) ?? [];
  const total: number = (data as any)?.total ?? 0;
  const sel = useRowSelection(ncrs);

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/quality/ncr', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'ncr'] })
      toast({ title: t('toast.ncrCreated') })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.ncrCreateFailed'), variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/quality/ncr/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'ncr'] })
      toast({ title: t('toast.ncrUpdated') })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.ncrUpdateFailed'), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/quality/ncr/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'ncr'] })
      toast({ title: t('toast.ncrDeleted') })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.ncrDeleteFailed'), variant: 'destructive' }),
  })

  const { archive: archiveMutation, restore: restoreMutation, bulkArchive, bulkRestore } = useArchive('ncrs', [['quality', 'ncr']], 'NCR');

  const statusMutation = useMutation({
    mutationFn: ({ ncrId, status }: { ncrId: string; status: string }) =>
      api.patch(`/quality/ncr/${ncrId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'ncr'] })
      toast({ title: t('toast.ncrStatusUpdated') })
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.ncrUpdateFailed'), variant: 'destructive' }),
  })

  const openCount = ncrs.filter((n) => n.status === 'OPEN').length;
  const criticalCount = ncrs.filter((n) => n.severity === 'CRITICAL').length;

  const handleOpenCreate = () => {
    setEditNCR(null)
    setForm({ ...EMPTY_NCR_FORM, detectedAt: toFactoryDayKey(new Date()) })
    setFormOpen(true)
  };

  const handleOpenEdit = async (ncr: NCR) => {
    setEditNCR(ncr)
    setFormOpen(true)
    // Seed from the list row, then hydrate every field from the full record.
    setForm({
      ...EMPTY_NCR_FORM,
      title: ncr.title,
      severity: ncr.severity,
      defectCategory: ncr.defectCategory ?? '',
      detectedAt: ncr.reportedAt?.slice(0, 10) ?? toFactoryDayKey(new Date()),
      dueDate: ncr.dueDate?.slice(0, 10) ?? EMPTY_NCR_FORM.dueDate,
    })
    try {
      const full = await api.get<any>(`/quality/ncr/${ncr.id}`)
      setForm({
        title: full.title ?? ncr.title,
        severity: full.severity ?? ncr.severity,
        defectCategory: full.defectCategory ?? '',
        defectCode: full.defectCode ?? '',
        quantity: full.quantity != null ? String(full.quantity) : '',
        machineId: full.machineId ?? '__none__',
        skuId: full.skuId ?? '__none__',
        batchRecordId: full.batchRecordId ?? '__none__',
        disposition: full.disposition ?? '__none__',
        description: full.description ?? '',
        detectedAt: (full.detectedAt ?? ncr.reportedAt)?.slice(0, 10) ?? toFactoryDayKey(new Date()),
        dueDate: (full.dueDate ?? ncr.dueDate)?.slice(0, 10) ?? EMPTY_NCR_FORM.dueDate,
        rootCause: full.rootCause ?? '',
        correctiveAction: full.correctiveAction ?? '',
        preventiveAction: full.preventiveAction ?? '',
      })
    } catch {
      /* keep the seeded values if the full fetch fails */
    }
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditNCR(null)
  };

  // Auto-open the create dialog when arriving via "New NCR" (?new=1).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('new') === '1') {
      handleOpenCreate()
      window.history.replaceState(null, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const buildDto = () => {
    const pick = (v: string) => (v && v !== '__none__' ? v : undefined)
    const base: any = {
      title: form.title,
      severity: form.severity,
      defectCategory: form.defectCategory,
      defectCode: form.defectCode || undefined,
      quantity: parseInt(form.quantity) || 1,
      machineId: pick(form.machineId),
      skuId: pick(form.skuId),
      batchRecordId: pick(form.batchRecordId),
      disposition: pick(form.disposition),
      description: form.description,
      detectedAt: new Date(form.detectedAt).toISOString(),
      dueDate: new Date(form.dueDate).toISOString(),
    }
    // Investigation fields are only accepted on update (post-detection analysis).
    if (editNCR) {
      base.rootCause = form.rootCause || undefined
      base.correctiveAction = form.correctiveAction || undefined
      base.preventiveAction = form.preventiveAction || undefined
    }
    return base
  };

  const handleSubmit = () => {
    if (editNCR) {
      updateMutation.mutate({ id: editNCR.id, dto: buildDto() })
    } else {
      createMutation.mutate(buildDto())
    }
  };

  const isValid = !!(
    form.title && form.severity && form.detectedAt && form.dueDate &&
    form.defectCategory && form.description && form.description.length >= 10 && form.quantity
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.ncr.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.ncr.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            filename="ncr-register"
            title={t('ncr.register')}
            rows={ncrs}
            columns={[
              { key: 'ncrNumber', label: t('ncr.col.ncr') },
              { key: 'title', label: t('ncr.col.title') },
              { key: 'severity', label: t('ncr.col.severity') },
              { key: 'status', label: t('ncr.col.status') },
              { key: 'machine', label: t('ncr.col.machine'), value: (r: any) => r.machine?.name ?? '' },
              { key: 'batch', label: t('ncr.col.batchProduct'), value: (r: any) => r.batchRecord?.batchNumber ?? r.sku?.name ?? '' },
              { key: 'detectedBy', label: t('ncr.col.detectedBy'), value: (r: any) => r.detectedBy?.name ?? '' },
              { key: 'reportedAt', label: t('ncr.col.reported'), value: (r: any) => r.reportedAt ? formatDate(r.reportedAt) : '' },
              { key: 'dueDate', label: t('ncr.col.due'), value: (r: any) => r.dueDate ? formatDate(r.dueDate) : '' },
            ]}
          />
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}><Plus size={13} /> {t('ncr.newNcr')}</Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        {/* Summary */}
        <div className="grid grid-cols-4 gap-3">
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">{t('ncr.statTotal')}</p>
            <p className="text-2xl font-bold mt-1">{ncrs.length}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">{t('ncr.statOpen')}</p>
            <p className="text-2xl font-bold mt-1 text-amber-400">{openCount}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">{t('ncr.statCritical')}</p>
            <p className="text-2xl font-bold mt-1 text-red-400">{criticalCount}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">{t('ncr.statResolved')}</p>
            <p className="text-2xl font-bold mt-1 text-green-400">
              {ncrs.filter((n) => ['RESOLVED', 'CLOSED'].includes(n.status)).length}
            </p>
          </div>
        </div>

        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('ncr.register')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder={t('ncr.search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-8 ps-7 w-40 text-xs" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />
                    {statusFilter ? t(`ncr.status.${statusFilter}`) : t('ncr.allStatus')}
                    <ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setStatusFilter(null); setPage(1); }}>{t('ncr.allStatus')}</DropdownMenuItem>
                  {(Object.keys(STATUS_LABELS) as NcrStatus[]).map((k) => (
                    <DropdownMenuItem key={k} onClick={() => { setStatusFilter(k); setPage(1); }}>{t(`ncr.status.${k}`)}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('ncr.selectAll')} /></TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.ncr')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.title')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.severity')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.status')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.machine')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.batchProduct')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.detectedBy')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.reported')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.due')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('ncr.col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 11 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : ncrs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground text-sm">
                      {t('ncr.noNcrs')}
                    </TableCell>
                  </TableRow>
                ) : (
                  ncrs.map((ncr) => {
                    const sev = SEV[ncr.severity];
                    const nextStatuses = TRANSITIONS[ncr.status] ?? [];
                    return (
                      <TableRow key={ncr.id} className={cn('border-border/20 hover:bg-muted/20', sel.isSelected(ncr.id) && 'bg-primary/5')}>
                        <TableCell><Checkbox checked={sel.isSelected(ncr.id)} onCheckedChange={() => sel.toggle(ncr.id)} aria-label={t('ncr.selectAll')} /></TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-primary">
                          <Link href={`/quality/ncr/${ncr.id}`} className="hover:underline">{ncr.ncrNumber}</Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {ncr.severity === 'CRITICAL' && <AlertTriangle size={11} className="text-red-400 shrink-0" />}
                            <span className="text-xs font-medium truncate max-w-[140px]">{ncr.title}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={cn('text-xs font-semibold', sev?.color)}>{t(`ncr.severity.${ncr.severity}`, { defaultValue: ncr.severity })}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[ncr.status] ?? 'secondary'} className="text-[10px] h-5">
                            {t(`ncr.status.${ncr.status}`, { defaultValue: ncr.status })}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ncr.machine?.name ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ncr.batchRecord?.batchNumber ?? ncr.sku?.name ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ncr.detectedBy?.name ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(ncr.reportedAt)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ncr.dueDate ? formatDate(ncr.dueDate) : '—'}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal size={13} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild className="gap-2 text-xs">
                                <Link href={`/quality/ncr/${ncr.id}`}><Eye size={12} /> {t('ncr.viewDetails')}</Link>
                              </DropdownMenuItem>
                              {['OPEN', 'IN_REVIEW'].includes(ncr.status) && (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => handleOpenEdit(ncr)}>
                                  <Pencil size={12} /> {t('common.edit')}
                                </DropdownMenuItem>
                              )}
                              {nextStatuses.length > 0 && <DropdownMenuSeparator />}
                              {nextStatuses.map((s) => (
                                <DropdownMenuItem
                                  key={s}
                                  className="text-xs"
                                  onClick={() => statusMutation.mutate({ ncrId: ncr.id, status: s })}
                                >
                                  → {t(`ncr.status.${s}`, { defaultValue: STATUS_LABELS[s as NcrStatus] ?? s })}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              {(ncr as any).archivedAt ? (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => restoreMutation.mutate(ncr.id)}>
                                  <RotateCcw size={12} /> {t('common.restore')}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => archiveMutation.mutate(ncr.id)}>
                                  <ArchiveIcon size={12} /> {t('common.archive')}
                                </DropdownMenuItem>
                              )}
                              {['OPEN'].includes(ncr.status) && (
                                <DropdownMenuItem className="gap-2 text-destructive text-xs" onClick={() => setDeleteDialog({ id: ncr.id, ncrNumber: ncr.ncrNumber })}>
                                  <Trash2 size={12} /> {t('common.delete')}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      <FormDialog
        open={formOpen}
        onClose={handleCloseForm}
        title={editNCR ? t('nform.editTitle') : t('nform.createTitle')}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('nform.severity')} *</Label>
            <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['MINOR', 'MAJOR', 'CRITICAL'] as const).map(s => <SelectItem key={s} value={s}>{t(`ncr.severity.${s}`, { defaultValue: s })}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('nform.detectedAt')} *</Label>
            <Input type="date" value={form.detectedAt} onChange={e => setForm(v => ({ ...v, detectedAt: e.target.value }))} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>{t('nform.title')} *</Label>
            <Input value={form.title} onChange={e => setForm(v => ({ ...v, title: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('nform.defectCategory')} *</Label>
            <Input value={form.defectCategory} onChange={e => setForm(v => ({ ...v, defectCategory: e.target.value }))} placeholder={t('nform.defectCategoryPlaceholder')} className="mt-1" />
          </div>
          <div>
            <Label>{t('nform.defectCode')} <span className="text-muted-foreground">({t('nform.optional')})</span></Label>
            <Input value={form.defectCode} onChange={e => setForm(v => ({ ...v, defectCode: e.target.value }))} placeholder={t('nform.defectCodePlaceholder')} className="mt-1" />
          </div>
          <div>
            <Label>{t('nform.ncQty')} *</Label>
            <Input type="number" min="1" value={form.quantity} onChange={e => setForm(v => ({ ...v, quantity: e.target.value }))} placeholder={t('nform.ncQtyPlaceholder')} className="mt-1" />
          </div>
          <div>
            <Label>{t('nform.disposition')} <span className="text-muted-foreground">({t('nform.optional')})</span></Label>
            <Select value={form.disposition} onValueChange={v => setForm(f => ({ ...f, disposition: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('nform.selectDisposition')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('common.none')}</SelectItem>
                {DISPOSITIONS.map(d => <SelectItem key={d} value={d}>{t(`ncr.disposition.${d}`, { defaultValue: DISPOSITION_LABELS[d] })}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('nform.product')} <span className="text-muted-foreground">({t('nform.optional')})</span></Label>
            <EntityPicker
              items={skus}
              value={form.skuId === '__none__' ? null : (form.skuId || null)}
              onChange={id => setForm(f => ({ ...f, skuId: id ?? '__none__' }))}
              getId={s => s.id}
              getPrimary={s => s.name}
              getSecondary={s => s.code}
              searchText={s => `${s.name} ${s.code}`}
              placeholder={t('nform.linkProduct')}
              searchPlaceholder={t('nform.searchProducts')}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('nform.batch')} <span className="text-muted-foreground">({t('nform.optional')})</span></Label>
            <EntityPicker
              items={batches}
              value={form.batchRecordId === '__none__' ? null : (form.batchRecordId || null)}
              onChange={id => setForm(f => ({ ...f, batchRecordId: id ?? '__none__' }))}
              getId={b => b.id}
              getPrimary={b => b.batchNumber}
              getSecondary={() => ''}
              searchText={b => b.batchNumber}
              placeholder={t('nform.linkBatch')}
              searchPlaceholder={t('nform.searchBatches')}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('nform.machine')} <span className="text-muted-foreground">({t('nform.optional')})</span></Label>
            <MachinePicker
              value={form.machineId === '__none__' ? null : (form.machineId || null)}
              onChange={id => setForm(f => ({ ...f, machineId: id ?? '__none__' }))}
              placeholder={t('nform.selectMachine')}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label>{t('nform.dueDate')} *</Label>
            <Input type="date" value={form.dueDate} onChange={e => setForm(v => ({ ...v, dueDate: e.target.value }))} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>{t('nform.description')} * <span className="text-muted-foreground text-xs">({t('nform.descMin')})</span></Label>
            <textarea
              value={form.description}
              onChange={e => setForm(v => ({ ...v, description: e.target.value }))}
              placeholder={t('nform.descPlaceholder')}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('nform.descChars', { count: form.description.length })}</p>
          </div>

          {/* Investigation — only meaningful once the NCR exists (post-detection analysis) */}
          {editNCR && (
            <>
              <div className="col-span-2 border-t border-border/50 pt-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('nform.investigation')}</h3>
              </div>
              <div className="col-span-2">
                <Label>{t('nform.rootCause')}</Label>
                <textarea
                  value={form.rootCause}
                  onChange={e => setForm(v => ({ ...v, rootCause: e.target.value }))}
                  placeholder={t('nform.rootCausePlaceholder')}
                  rows={2}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="col-span-2">
                <Label>{t('nform.correctiveAction')}</Label>
                <textarea
                  value={form.correctiveAction}
                  onChange={e => setForm(v => ({ ...v, correctiveAction: e.target.value }))}
                  placeholder={t('nform.correctivePlaceholder')}
                  rows={2}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="col-span-2">
                <Label>{t('nform.preventiveAction')}</Label>
                <textarea
                  value={form.preventiveAction}
                  onChange={e => setForm(v => ({ ...v, preventiveAction: e.target.value }))}
                  placeholder={t('nform.preventivePlaceholder')}
                  rows={2}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </>
          )}
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('ncr.deleteTitle', { number: deleteDialog?.ncrNumber })}
        description={t('ncr.deleteDescription')}
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('common.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('common.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  )
}
