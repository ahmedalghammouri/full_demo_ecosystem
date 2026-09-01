'use client';
import { useTranslation } from 'react-i18next';

import React, { useState, useMemo } from 'react';
import { Plus, Download, Filter, Search, Calendar, Clock, CheckCircle, AlertCircle, Pencil, Trash2, MoreHorizontal, Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MachinePicker } from '@/components/ui/machine-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { KPICard } from '@/components/widgets/kpi-card';
import { TablePagination } from '@/components/ui/table-pagination';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { formatDate, cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';

export function MaintenancePreventiveView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const { toast } = useToast()
  const qc = useQueryClient()
  const { archive: archivePM, restore: restorePM, bulkArchive, bulkRestore } = useArchive('pm-plans', [['maintenance', 'preventive']], 'PM schedule')
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState<ArchiveScope>('active')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editSchedule, setEditSchedule] = useState<any | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; task: string } | null>(null)
  const [form, setForm] = useState({
    machineId: '', task: '', type: 'TIME_BASED', frequency: 'WEEKLY', frequencyDays: '',
    estimatedHours: '', runtimeHours: '', description: '', instructions: '', nextDueAt: '',
  })

  const { data: pmSchedules, isLoading } = useQuery({
    queryKey: ['maintenance', 'preventive', { search, archived, page }],
    queryFn: () => api.get('/maintenance/preventive', { params: { search, archived: archived !== 'active' ? archived : undefined, limit: 20, page } }),
    staleTime: 30_000,
  })

  const { data: pmKPIs } = useQuery({
    queryKey: ['maintenance', 'preventive-kpis'],
    queryFn: () => api.get('/maintenance/preventive/kpis'),
    refetchInterval: 60_000,
  })

  const schedules = (pmSchedules as any)?.data ?? [];
  const sel = useRowSelection(schedules);
  const total: number = (pmSchedules as any)?.total ?? 0;

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/maintenance/preventive', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'preventive'] })
      toast({ title: 'PM schedule created successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to create schedule', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/maintenance/preventive/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'preventive'] })
      toast({ title: 'PM schedule updated successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to update schedule', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/maintenance/preventive/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'preventive'] })
      toast({ title: 'PM schedule deleted successfully' })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to delete schedule', variant: 'destructive' }),
  })

  const EMPTY_FORM = {
    machineId: '', task: '', type: 'TIME_BASED', frequency: 'WEEKLY', frequencyDays: '',
    estimatedHours: '', runtimeHours: '', description: '', instructions: '', nextDueAt: '',
  };

  // Map a recurrence in days back to a named preset (else "CUSTOM").
  const freqPresetFromDays = (days?: number | null): string => {
    const map: Record<number, string> = { 1: 'DAILY', 7: 'WEEKLY', 30: 'MONTHLY', 91: 'QUARTERLY', 365: 'YEARLY' };
    return days != null && map[days] ? map[days] : (days != null ? 'CUSTOM' : 'WEEKLY');
  };

  const handleOpenCreate = () => {
    setEditSchedule(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  };

  const handleOpenEdit = (schedule: any) => {
    setEditSchedule(schedule)
    const preset = freqPresetFromDays(schedule.frequencyDays)
    setForm({
      machineId: schedule.machineId ?? '',
      task: schedule.task ?? '',
      type: schedule.type ?? 'TIME_BASED',
      frequency: preset,
      frequencyDays: preset === 'CUSTOM' ? String(schedule.frequencyDays ?? '') : '',
      estimatedHours: schedule.estimatedHours != null ? String(schedule.estimatedHours) : '',
      runtimeHours: schedule.runtimeHours != null ? String(schedule.runtimeHours) : '',
      description: schedule.description ?? '',
      instructions: schedule.instructions ?? '',
      nextDueAt: schedule.nextDue ? schedule.nextDue.slice(0, 10) : '',
    })
    setFormOpen(true)
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditSchedule(null)
  };

  const handleSubmit = () => {
    const isCustom = form.frequency === 'CUSTOM'
    const dto: any = {
      machineId: form.machineId,
      task: form.task,
      type: form.type,
      frequency: isCustom ? undefined : form.frequency,
      frequencyDays: isCustom && form.frequencyDays ? parseInt(form.frequencyDays) : undefined,
      estimatedHours: form.estimatedHours ? parseFloat(form.estimatedHours) : undefined,
      runtimeHours: form.runtimeHours ? parseFloat(form.runtimeHours) : undefined,
      description: form.description || undefined,
      instructions: form.instructions || undefined,
      nextDueAt: form.nextDueAt ? new Date(form.nextDueAt).toISOString() : undefined,
    };
    if (editSchedule) {
      updateMutation.mutate({ id: editSchedule.id, dto })
    } else {
      createMutation.mutate(dto)
    }
  };

  const isValid = !!(
    form.machineId && form.task && form.type &&
    (form.type === 'RUNTIME_BASED' ? !!form.runtimeHours : (form.frequency !== 'CUSTOM' || !!form.frequencyDays))
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.preventive.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.preventive.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            Export
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
            <Plus size={13} />
            New PM Schedule
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <InlineFormSlot />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Total Schedules" value={(pmKPIs as any)?.total ?? 0} isLoading={isLoading} />
          <KPICard title="Due This Week" value={(pmKPIs as any)?.dueThisWeek ?? 0} colorMode="alarm" isLoading={isLoading} />
          <KPICard title="Overdue" value={(pmKPIs as any)?.overdue ?? 0} colorMode="alarm" isLoading={isLoading} />
          <KPICard title="Completed" value={(pmKPIs as any)?.completed ?? 0} colorMode="default" isLoading={isLoading} />
        </div>

        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{t('pm.schedules')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('pm.search')}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="h-8 pl-7 w-48 text-xs"
                />
              </div>
              <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('selectAll')} /></TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.equipment')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.task')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.frequency')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.lastDone')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.nextDue')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.status')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.assignedTo')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('pm.col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="shimmer h-3.5 rounded w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : schedules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                      {t('pm.noSchedules')}
                    </TableCell>
                  </TableRow>
                ) : (
                  schedules.map((schedule: any) => (
                    <TableRow key={schedule.id} className={cn('border-border/20 hover:bg-muted/20', sel.isSelected(schedule.id) && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={sel.isSelected(schedule.id)} onCheckedChange={() => sel.toggle(schedule.id)} aria-label="Select row" /></TableCell>
                      <TableCell className="text-xs font-medium">{schedule.equipment}</TableCell>
                      <TableCell className="text-xs">{schedule.task}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{schedule.frequency}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(schedule.lastDone)}</TableCell>
                      <TableCell className="text-xs font-medium">{formatDate(schedule.nextDue)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={schedule.status === 'OVERDUE' ? 'destructive' : schedule.status === 'DUE' ? 'outline' : 'secondary'}
                          className="text-[10px] h-5"
                        >
                          {schedule.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{schedule.assignedTo}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenEdit(schedule)}>
                              <Pencil className="w-3.5 h-3.5 mr-2" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {schedule.archivedAt ? (
                              <DropdownMenuItem onClick={() => restorePM.mutate(schedule.id)}>
                                <RotateCcw className="w-3.5 h-3.5 mr-2" />Restore
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => archivePM.mutate(schedule.id)}>
                                <ArchiveIcon className="w-3.5 h-3.5 mr-2" />Archive
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ id: schedule.id, task: schedule.task })}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
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
        title={editSchedule ? t('pmform.editTitle') : t('pmform.createTitle')}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('pmform.equipment')} *</Label>
            <MachinePicker
              value={form.machineId || null}
              onChange={(id) => setForm(f => ({ ...f, machineId: id ?? '' }))}
              placeholder={t('pmform.selectMachine')}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label>{t('pmform.pmType')} *</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TIME_BASED">{t('pmform.timeBased')}</SelectItem>
                <SelectItem value="RUNTIME_BASED">{t('pmform.runtimeBased')}</SelectItem>
                <SelectItem value="CONDITION_BASED">{t('pmform.conditionBased')}</SelectItem>
                <SelectItem value="CALENDAR_BASED">{t('pmform.calendarBased')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.type === 'RUNTIME_BASED' ? (
            <div>
              <Label>{t('pmform.runtimeInterval')} *</Label>
              <Input type="number" min="0" step="1" value={form.runtimeHours} onChange={e => setForm(v => ({ ...v, runtimeHours: e.target.value }))} className="mt-1" placeholder={t('pmform.runtimePlaceholder')} />
            </div>
          ) : (
            <div>
              <Label>{t('pmform.frequency')} *</Label>
              <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">{t('pmform.daily')}</SelectItem>
                  <SelectItem value="WEEKLY">{t('pmform.weekly')}</SelectItem>
                  <SelectItem value="MONTHLY">{t('pmform.monthly')}</SelectItem>
                  <SelectItem value="QUARTERLY">{t('pmform.quarterly')}</SelectItem>
                  <SelectItem value="YEARLY">{t('pmform.yearly')}</SelectItem>
                  <SelectItem value="CUSTOM">{t('pmform.custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {form.type !== 'RUNTIME_BASED' && form.frequency === 'CUSTOM' && (
            <div>
              <Label>{t('pmform.everyNDays')} *</Label>
              <Input type="number" min="1" step="1" value={form.frequencyDays} onChange={e => setForm(v => ({ ...v, frequencyDays: e.target.value }))} className="mt-1" placeholder={t('pmform.everyNPlaceholder')} />
            </div>
          )}
          <div>
            <Label>{t('pmform.firstDue')}</Label>
            <Input type="date" value={form.nextDueAt} onChange={e => setForm(v => ({ ...v, nextDueAt: e.target.value }))} className="mt-1" />
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('pmform.firstDueHelp')}</p>
          </div>

          <div className="col-span-2">
            <Label>{t('pmform.taskName')} *</Label>
            <Input value={form.task} onChange={e => setForm(v => ({ ...v, task: e.target.value }))} className="mt-1" placeholder={t('pmform.taskPlaceholder')} />
          </div>
          <div>
            <Label>{t('pmform.estimatedHours')}</Label>
            <Input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={e => setForm(v => ({ ...v, estimatedHours: e.target.value }))} className="mt-1" placeholder="0.0" />
          </div>
          <div className="col-span-2">
            <Label>{t('pmform.description')}</Label>
            <Input value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} className="mt-1" placeholder={t('pmform.descPlaceholder')} />
          </div>
          <div className="col-span-2">
            <Label>{t('pmform.instructions')}</Label>
            <textarea
              value={form.instructions}
              onChange={e => setForm(v => ({ ...v, instructions: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('pmform.instructionsPlaceholder')}
            />
          </div>
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('pmform.deleteTitle', { task: deleteDialog?.task })}
        description={t('pmform.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('pmform.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('pmform.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  )
}
