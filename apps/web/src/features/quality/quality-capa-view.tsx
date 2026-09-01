'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Search, ChevronRight, Eye, MoreHorizontal, CheckCircle2, ShieldCheck, Pencil, Trash2, Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { ExportMenu } from '@/components/ui/export-menu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { api } from '@/services/api.client';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn, formatDate } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';

type CapaType = 'CORRECTIVE' | 'PREVENTIVE';
type CapaStatus = 'OPEN' | 'IN_PROGRESS' | 'VERIFIED' | 'CLOSED';

const TYPE_CFG: Record<CapaType, { labelKey: string; color: string }> = {
  CORRECTIVE: { labelKey: 'capa.type.CORRECTIVE', color: 'text-red-400' },
  PREVENTIVE: { labelKey: 'capa.type.PREVENTIVE', color: 'text-brand-400' },
};

const STATUS_VARIANT: Record<CapaStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  OPEN: 'destructive',
  IN_PROGRESS: 'default',
  VERIFIED: 'outline',
  CLOSED: 'secondary',
};

const STATUS_KEYS: CapaStatus[] = ['OPEN', 'IN_PROGRESS', 'VERIFIED', 'CLOSED'];

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['VERIFICATION'],
  VERIFICATION: ['CLOSED'],
  CLOSED: [],
};

interface Capa {
  id: string;
  capaNumber: string;
  title: string;
  type: CapaType;
  status: CapaStatus;
  priority: string;
  dueDate?: string;
  effectiveness?: string;
  ncr?: { ncrNumber: string };
  assignedTo?: { name: string };
  createdAt: string;
}

export function QualityCapaView() {
  const { t } = useTranslation(['quality', 'common']);
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CapaStatus | null>(null)
  const [archived, setArchived] = useState<ArchiveScope>('active')
  const [formOpen, setFormOpen] = useState(false)
  const [editCapa, setEditCapa] = useState<Capa | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; capaNumber: string } | null>(null)
  const [form, setForm] = useState({
    title: '', type: 'CORRECTIVE', priority: 'MEDIUM', dueDate: '', ncrId: '__none__', description: '',
  })

  const queryClient = useQueryClient()
  const { archive: archiveCapa, restore: restoreCapa, bulkArchive, bulkRestore } = useArchive('capas', [['quality', 'capa']], 'CAPA')
  const { toast } = useToast()
  const { dateFrom, dateTo, key: timeKey } = useTimeRange()

  const { data, isLoading } = useQuery({
    queryKey: ['quality', 'capa', { search, status: statusFilter, archived, page, timeKey }],
    queryFn: () => api.get('/quality/capa', {
      params: { search: search || undefined, status: statusFilter || undefined, archived: archived !== 'active' ? archived : undefined, dateFrom, dateTo, limit: 20, page },
    }),
    staleTime: 20_000,
  })

  const { data: ncrsData } = useQuery({
    queryKey: ['quality', 'ncr', 'capa-dropdown'],
    queryFn: () => api.get('/quality/ncr', { params: { limit: 100, status: 'OPEN,IN_REVIEW,CAPA_PENDING' } }),
    staleTime: 60_000,
    enabled: formOpen,
  })
  const openNcrs: Array<{ id: string; ncrNumber: string; title: string }> = (ncrsData as any)?.data ?? []

  const capas: Capa[] = (data as any)?.data ?? (data as any) ?? [];
  const sel = useRowSelection(capas);
  const total: number = (data as any)?.total ?? 0;

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/quality/capa', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'capa'] })
      toast({ title: t('toast.capaCreated') })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.capaCreateFailed'), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/quality/capa/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'capa'] })
      toast({ title: t('toast.capaDeleted') })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.capaDeleteFailed'), variant: 'destructive' }),
  })

  const statusMutation = useMutation({
    mutationFn: ({ capaId, action }: { capaId: string; action: 'verify' | 'close' }) =>
      api.patch(`/quality/capa/${capaId}/${action}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'capa'] })
      toast({ title: t('toast.capaUpdatedShort') })
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.failed'), variant: 'destructive' }),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/quality/capa/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'capa'] })
      toast({ title: t('toast.capaUpdated') })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.capaUpdateFailed'), variant: 'destructive' }),
  })

  const stats = [
    { label: t('capa.status.OPEN'),        value: capas.filter(c => c.status === 'OPEN').length,         color: 'text-red-400'   },
    { label: t('capa.status.IN_PROGRESS'), value: capas.filter(c => c.status === 'IN_PROGRESS').length,  color: 'text-brand-400' },
    { label: t('capa.status.VERIFIED'),    value: capas.filter(c => c.status === 'VERIFIED').length,     color: 'text-amber-400' },
    { label: t('capa.status.CLOSED'),      value: capas.filter(c => c.status === 'CLOSED').length,       color: 'text-green-400' },
  ];

  const handleOpenCreate = () => {
    setEditCapa(null)
    setForm({ title: '', type: 'CORRECTIVE', priority: 'MEDIUM', dueDate: '', ncrId: '__none__', description: '' })
    setFormOpen(true)
  };

  const handleOpenEdit = (capa: Capa) => {
    setEditCapa(capa)
    setForm({
      title: capa.title,
      type: capa.type,
      priority: capa.priority,
      dueDate: capa.dueDate?.slice(0, 10) ?? '',
      ncrId: (capa as any).ncrId ?? '__none__',
      description: (capa as any).description ?? '',
    })
    setFormOpen(true)
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditCapa(null)
  };

  const buildDto = () => ({
    title: form.title,
    type: form.type,
    priority: form.priority,
    dueDate: form.dueDate || undefined,
    ncrId: (form.ncrId && form.ncrId !== '__none__') ? form.ncrId : undefined,
    description: form.description || undefined,
  });

  const handleSubmit = () => {
    if (editCapa) {
      editMutation.mutate({ id: editCapa.id, dto: buildDto() })
    } else {
      createMutation.mutate(buildDto())
    }
  };

  const isValid = !!(form.title && form.type && form.priority)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.capa.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.capa.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            filename="capa-register"
            title={t('capa.register')}
            rows={capas}
            columns={[
              { key: 'capaNumber', label: t('capa.col.capa') },
              { key: 'title', label: t('capa.col.title') },
              { key: 'type', label: t('capa.col.type') },
              { key: 'status', label: t('capa.col.status') },
              { key: 'ncr', label: t('capa.col.relatedNcr'), value: (r: any) => r.ncr?.ncrNumber ?? '' },
              { key: 'assignedTo', label: t('capa.col.owner'), value: (r: any) => r.assignedTo?.name ?? '' },
              { key: 'dueDate', label: t('capa.col.dueDate'), value: (r: any) => r.dueDate ? formatDate(r.dueDate) : '' },
              { key: 'effectiveness', label: t('capa.col.effectiveness'), value: (r: any) => r.effectiveness ?? '' },
            ]}
          />
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}><Plus size={13} />{t('capa.newCapa')}</Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <InlineFormSlot />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <div key={s.label} className="industrial-card rounded-xl p-4">
              <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('capa.register')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder={t('capa.search')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-8 ps-7 w-44 text-xs" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    {statusFilter ? t(`capa.status.${statusFilter}`) : t('capa.allStatus')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setStatusFilter(null); setPage(1); }}>{t('capa.allStatus')}</DropdownMenuItem>
                  {STATUS_KEYS.map(k => (
                    <DropdownMenuItem key={k} onClick={() => { setStatusFilter(k); setPage(1); }}>{t(`capa.status.${k}`)}</DropdownMenuItem>
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
                  <TableHead className="w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('capa.selectAll')} /></TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.capa')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.title')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.type')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.status')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.relatedNcr')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.owner')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.dueDate')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.effectiveness')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('capa.col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : capas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">{t('capa.noCapas')}</TableCell>
                  </TableRow>
                ) : (
                  capas.map(capa => {
                    const typeCfg = TYPE_CFG[capa.type];
                    const overdue = capa.dueDate && new Date(capa.dueDate) < new Date() && capa.status !== 'CLOSED';
                    const nextSteps = TRANSITIONS[capa.status] ?? [];
                    return (
                      <TableRow key={capa.id} className={cn('border-border/20 hover:bg-muted/20', sel.isSelected(capa.id) && 'bg-primary/5')}>
                        <TableCell><Checkbox checked={sel.isSelected(capa.id)} onCheckedChange={() => sel.toggle(capa.id)} aria-label={t('capa.selectAll')} /></TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-primary">
                          <Link href={`/quality/capa/${capa.id}`} className="hover:underline">{capa.capaNumber}</Link>
                        </TableCell>
                        <TableCell className="text-xs max-w-[180px]"><span className="truncate block">{capa.title}</span></TableCell>
                        <TableCell><span className={cn('text-[10px] font-semibold', typeCfg?.color)}>{t(`capa.type.${capa.type}`, { defaultValue: capa.type })}</span></TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[capa.status] ?? 'secondary'} className="text-[10px] h-5">
                            {t(`capa.status.${capa.status}`, { defaultValue: capa.status })}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{capa.ncr?.ncrNumber ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{capa.assignedTo?.name ?? '—'}</TableCell>
                        <TableCell className={cn('text-xs', overdue ? 'text-red-400 font-medium' : 'text-muted-foreground')}>
                          {capa.dueDate ? formatDate(capa.dueDate) : '—'}{overdue ? ' ⚠' : ''}
                        </TableCell>
                        <TableCell className="text-xs">
                          {capa.effectiveness
                            ? <span className="text-green-400">{capa.effectiveness}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal size={13} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild className="gap-2 text-xs">
                                <Link href={`/quality/capa/${capa.id}`}><Eye size={12} /> {t('capa.viewManage')}</Link>
                              </DropdownMenuItem>
                              {['OPEN', 'IN_PROGRESS'].includes(capa.status) && (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => handleOpenEdit(capa)}>
                                  <Pencil size={12} /> {t('common.edit')}
                                </DropdownMenuItem>
                              )}
                              {capa.status === 'IN_PROGRESS' && (
                                <DropdownMenuItem asChild className="gap-2 text-xs">
                                  <Link href={`/quality/capa/${capa.id}`}><ShieldCheck size={12} /> {t('capa.addActionsVerify')}</Link>
                                </DropdownMenuItem>
                              )}
                              {capa.status === 'VERIFIED' && (
                                <DropdownMenuItem className="gap-2 text-xs text-green-400" onClick={() => statusMutation.mutate({ capaId: capa.id, action: 'close' })}>
                                  <CheckCircle2 size={12} /> {t('capa.closeCapa')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {(capa as any).archivedAt ? (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => restoreCapa.mutate(capa.id)}>
                                  <RotateCcw size={12} /> {t('common.restore')}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => archiveCapa.mutate(capa.id)}>
                                  <ArchiveIcon size={12} /> {t('common.archive')}
                                </DropdownMenuItem>
                              )}
                              {['OPEN'].includes(capa.status) && (
                                <DropdownMenuItem className="gap-2 text-destructive text-xs" onClick={() => setDeleteDialog({ id: capa.id, capaNumber: capa.capaNumber })}>
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
        title={editCapa ? t('cform.editTitle') : t('cform.createTitle')}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || editMutation.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('cform.type')} *</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CORRECTIVE">{t('capa.type.CORRECTIVE')}</SelectItem>
                <SelectItem value="PREVENTIVE">{t('capa.type.PREVENTIVE')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>{t('cform.title')} *</Label>
            <Input value={form.title} onChange={e => setForm(v => ({ ...v, title: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('cform.priority')} *</Label>
            <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(p => <SelectItem key={p} value={p}>{t(`common:priority.${p}`, { defaultValue: p })}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('cform.dueDate')}</Label>
            <Input type="date" value={form.dueDate} onChange={e => setForm(v => ({ ...v, dueDate: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('cform.relatedNcr')}</Label>
            <EntityPicker
              items={openNcrs}
              value={form.ncrId === '__none__' ? null : (form.ncrId || null)}
              onChange={id => setForm(f => ({ ...f, ncrId: id ?? '__none__' }))}
              getId={ncr => ncr.id}
              getPrimary={ncr => ncr.ncrNumber}
              getSecondary={ncr => ncr.title}
              searchText={ncr => `${ncr.ncrNumber} ${ncr.title}`}
              placeholder={t('cform.linkNcr')}
              searchPlaceholder={t('cform.searchNcrs')}
              className="mt-1"
            />
          </div>
          <div className="col-span-2">
            <Label>{t('cform.description')}</Label>
            <Input value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} className="mt-1" />
          </div>
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('capa.deleteTitle', { number: deleteDialog?.capaNumber })}
        description={t('capa.deleteDescription')}
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('capa.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('capa.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  )
}
