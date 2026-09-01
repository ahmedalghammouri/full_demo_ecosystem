'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Router, Wifi, WifiOff, RefreshCw, Cpu, Server, Clock,
  MoreHorizontal, Pencil, Trash2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { KPICard } from '@/components/widgets/kpi-card';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn, timeAgo, formatDateTime } from '@/lib/utils';

interface Gateway {
  id: string;
  name: string;
  hostname: string | null;
  version: string | null;
  status: string;
  online: boolean;
  deviceCount: number;
  lastHeartbeatAt: string | null;
  lastError: string | null;
}

export function IotGatewaysView() {
  const { t } = useTranslation(['iot', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editGateway, setEditGateway] = useState<Gateway | null>(null);
  const [form, setForm] = useState({ name: '', isActive: true });
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['iot', 'gateways', 'kpis'],
    queryFn: () => api.get<{ total: number; online: number; offline: number }>('/iot/gateways/kpis'),
    refetchInterval: 15_000,
  });

  const { data: gateways, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['iot', 'gateways'],
    queryFn: () => api.get<Gateway[]>('/iot/gateways'),
    refetchInterval: 15_000,
  });

  const list = Array.isArray(gateways) ? gateways : [];

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/iot/gateways/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'gateways'] });
      toast({ title: 'Gateway updated' });
      setEditGateway(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Update failed', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/iot/gateways/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iot', 'gateways'] });
      toast({ title: 'Gateway removed' });
      setDeleteDialog(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Delete failed', variant: 'destructive' }),
  });

  const openEdit = (gw: Gateway) => {
    setEditGateway(gw);
    setForm({ name: gw.name, isActive: true });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Router size={18} className="text-primary" />
            {t('headers.gateways.title')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.gateways.subtitle')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-8 text-xs">
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <InlineFormSlot className="empty:hidden" />

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3 max-w-2xl">
          <KPICard title="Gateways" value={kpis?.total ?? 0} isLoading={kpisLoading} icon={<Server size={16} />} />
          <KPICard title="Online" value={kpis?.online ?? 0} isLoading={kpisLoading} icon={<Wifi size={16} />} />
          <KPICard title="Offline" value={kpis?.offline ?? 0} colorMode="alarm" isLoading={kpisLoading} icon={<WifiOff size={16} />} />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="industrial-card p-12 text-center text-muted-foreground">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 opacity-40 animate-spin" />
            <div className="text-sm">Loading gateways…</div>
          </div>
        ) : list.length === 0 ? (
          <div className="industrial-card p-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mx-auto mb-4">
              <Router className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <div className="font-semibold text-foreground/70 text-base">No edge gateways registered</div>
            <div className="text-muted-foreground text-sm mt-1.5">
              Install the Industry360° Edge Gateway on a plant PC; it registers itself here on first connect.
            </div>
          </div>
        ) : (
          <div className="industrial-card p-4">
            <div className="rounded-lg border border-border/30 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/30">
                    <TableHead className="text-[11px] font-semibold">Gateway</TableHead>
                    <TableHead className="text-[11px] font-semibold">Status</TableHead>
                    <TableHead className="text-[11px] font-semibold">Host</TableHead>
                    <TableHead className="text-[11px] font-semibold">Version</TableHead>
                    <TableHead className="text-[11px] font-semibold">Devices</TableHead>
                    <TableHead className="text-[11px] font-semibold">Last heartbeat</TableHead>
                    <TableHead className="text-[11px] font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((gw) => (
                    <motion.tr
                      key={gw.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={cn('border-b border-border/20 hover:bg-muted/20', !gw.online && 'opacity-70')}
                    >
                      <TableCell>
                        <div className="font-medium text-sm">{gw.name}</div>
                        {gw.lastError && <div className="text-[11px] text-danger-400 mt-0.5">{gw.lastError}</div>}
                      </TableCell>
                      <TableCell>
                        {gw.online ? (
                          <Badge variant="outline" className="text-[10px] gap-1 text-success-400 border-success-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" /> Online
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-1 text-danger-400 border-danger-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-danger-400" /> Offline
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{gw.hostname ?? '—'}</span></TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{gw.version ?? '—'}</span></TableCell>
                      <TableCell>
                        <span className="text-xs flex items-center gap-1.5"><Cpu size={12} className="text-muted-foreground" />{gw.deviceCount}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5" title={gw.lastHeartbeatAt ? formatDateTime(gw.lastHeartbeatAt) : ''}>
                          <Clock size={12} />
                          {gw.lastHeartbeatAt ? `${timeAgo(gw.lastHeartbeatAt)} ago` : 'never'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(gw)}>
                              <Pencil className="w-3.5 h-3.5 mr-2" />Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ id: gw.id, name: gw.name })}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" />Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      <FormDialog
        open={!!editGateway}
        onClose={() => setEditGateway(null)}
        title="Rename Gateway"
        onSubmit={() => editGateway && updateMutation.mutate({ id: editGateway.id, dto: { name: form.name } })}
        isSubmitting={updateMutation.isPending}
        isValid={!!form.name.trim()}
      >
        <div>
          <Label>Gateway Name</Label>
          <Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} className="mt-1" />
          <p className="text-[11px] text-muted-foreground mt-2">
            Connection settings (DB / MQTT / Influx) are configured on the gateway itself, in its local dashboard → Settings.
          </p>
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={`Remove gateway ${deleteDialog?.name}?`}
        description="This deactivates the gateway record. If the gateway is still running it will re-register on its next heartbeat."
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
