'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { Plus, Download, Settings, CheckCircle, XCircle, Pencil, Trash2, MoreVertical } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';
import { TablePagination } from '@/components/ui/table-pagination';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { api } from '@/services/api.client';

export function IotDriversView() {
  const { t } = useTranslation(['iot', 'common']);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState<any | null>(null);
  const [deleteDriver, setDeleteDriver] = useState<any | null>(null);
  const { register, handleSubmit, reset, setValue } = useForm();

  const { data: drivers, isLoading } = useQuery({
    queryKey: ['iot', 'drivers', { page }],
    queryFn: () => api.get('/iot/drivers', { params: { limit: 20, page } }),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/iot/drivers', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'drivers'] });
      toast({ title: t('drivers.createdSuccess') });
      setShowForm(false);
      reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...dto }: any) => api.patch(`/iot/drivers/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'drivers'] });
      toast({ title: t('drivers.updatedSuccess') });
      setEditDriver(null);
      setShowForm(false);
      reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/iot/drivers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'drivers'] });
      toast({ title: t('drivers.deletedSuccess') });
      setDeleteDriver(null);
    },
  });

  const handleEdit = (driver: any) => {
    setEditDriver(driver);
    setValue('protocol', driver.protocol);
    setValue('version', driver.version);
    setValue('description', driver.description);
    setShowForm(true);
  };

  const onSubmit = (data: any) => {
    if (editDriver) {
      updateMutation.mutate({ id: editDriver.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const driverList = (drivers as any)?.data ?? [];
  const total: number = (drivers as any)?.total ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.drivers.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.drivers.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            {t('common.export')}
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { setShowForm(true); setEditDriver(null); reset(); }}>
            <Plus size={13} />
            {t('common.addDriver')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <InlineFormSlot className="mb-6 empty:mb-0" />

        <div className="industrial-card p-4">
          <h3 className="text-sm font-semibold mb-4">{t('drivers.available')}</h3>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="text-[11px] font-semibold">{t('drivers.thProtocol')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('drivers.thVersion')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('drivers.thDescription')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('drivers.thDevices')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('drivers.thStatus')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('drivers.thActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="shimmer h-3.5 rounded w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : driverList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                      No drivers found
                    </TableCell>
                  </TableRow>
                ) : (
                  driverList.map((driver: any) => (
                    <TableRow key={driver.id} className="border-border/20 hover:bg-muted/20">
                      <TableCell className="font-mono text-xs font-semibold text-primary">{driver.protocol}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{driver.version}</TableCell>
                      <TableCell className="text-xs">{driver.description}</TableCell>
                      <TableCell className="text-xs font-semibold">{driver.deviceCount || 0}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={driver.status === 'ACTIVE' ? 'default' : 'secondary'}
                          className="text-[10px] h-5 gap-1"
                        >
                          {driver.status === 'ACTIVE' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {driver.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical size={13} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(driver)}>
                              <Pencil size={12} className="mr-2" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setDeleteDriver(driver)} className="text-destructive">
                              <Trash2 size={12} className="mr-2" />Delete
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

      {/* Create/Edit Driver — inline form */}
      <InlineFormPanel
        open={showForm}
        onClose={() => { setShowForm(false); setEditDriver(null); }}
        icon={editDriver ? Pencil : Plus}
        title={editDriver ? t('drvform.editTitle') : t('drvform.createTitle')}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditDriver(null); }}>{t('drvform.cancel')}</Button>
            <Button type="button" onClick={handleSubmit(onSubmit)} disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? t('drvform.saving') : t('drvform.save')}
            </Button>
          </>
        )}
      >
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div>
                <Label>{t('drvform.protocol')} *</Label>
                <Input {...register('protocol', { required: true })} placeholder="MODBUS_TCP" className="mt-1" />
              </div>
              <div>
                <Label>{t('drvform.version')} *</Label>
                <Input {...register('version', { required: true })} placeholder="1.0.0" className="mt-1" />
              </div>
              <div>
                <Label>{t('drvform.description')} *</Label>
                <Input {...register('description', { required: true })} placeholder="Modbus TCP/IP driver" className="mt-1" />
              </div>
            </form>
      </InlineFormPanel>

      {/* Delete Dialog */}
      {deleteDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold">{t('drvform.deleteTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('drvform.deleteConfirmPre')} <strong>{deleteDriver.protocol}</strong>?</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteDriver(null)}>{t('drvform.cancel')}</Button>
              <Button variant="destructive" onClick={() => deleteMutation.mutate(deleteDriver.id)} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? t('drvform.deleting') : t('drvform.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
