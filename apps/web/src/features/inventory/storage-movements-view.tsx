'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import {
  ArrowLeftRight, Search, MapPin, Package, FlaskConical, Wrench, Boxes,
  ArrowRight, Plus, Layers,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';

// ── Types ────────────────────────────────────────────────────
type EntityType = 'RAW_MATERIAL' | 'SPARE_PART' | 'PRODUCT';
type ItemKind = 'MATERIAL_LOT' | 'RAW_MATERIAL' | 'SPARE_PART' | 'PRODUCT';

interface Transfer {
  id: string; transferNumber: string; entityType: EntityType;
  entityCode: string; entityName: string; quantity: number; unit: string | null;
  createdAt: string;
  fromLocation: { code: string; name: string; zone: string } | null;
  toLocation: { code: string; name: string; zone: string } | null;
  materialLot: { lotNumber: string } | null;
}
interface ListResponse { data: Transfer[]; total: number; page: number; limit: number; totalPages: number; }
interface StorageLocation { id: string; code: string; name: string; zone: string; }
interface LocationContents {
  rawMaterials: { id: string; code: string; name: string; unit: string; stockQty: number }[];
  materialLots: { id: string; lotNumber: string; materialCode: string; materialName: string; remainingQty: number; unit: string }[];
  spareParts: { id: string; partNumber: string; name: string; stockQty: number }[];
  skus: { id: string; code: string; name: string; itemNumber: string | null; currentStock?: number; baseUnit?: string }[];
}

const KIND_CONFIG: Record<ItemKind, { labelKey: string; icon: React.ElementType }> = {
  MATERIAL_LOT:  { labelKey: 'storageMoves.kind.lot',     icon: Layers },
  RAW_MATERIAL:  { labelKey: 'storageMoves.kind.raw',     icon: FlaskConical },
  SPARE_PART:    { labelKey: 'storageMoves.kind.spare',   icon: Wrench },
  PRODUCT:       { labelKey: 'storageMoves.kind.product', icon: Boxes },
};

// ── Component ────────────────────────────────────────────────
export function StorageMovementsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  // Form state
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');
  const [kind, setKind] = useState<ItemKind>('MATERIAL_LOT');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['storage-transfers', search, page],
    queryFn: () => api.get<ListResponse>('/inventory/storage-transfers', { params: { search: search || undefined, page, limit: 20 } }),
    staleTime: 15_000,
  });
  const { data: stats } = useQuery({
    queryKey: ['storage-transfers', 'stats'],
    queryFn: () => api.get<{ total: number; byType: Record<string, number> }>('/inventory/storage-transfers/stats'),
    staleTime: 15_000,
  });
  const { data: locsResp } = useQuery({
    queryKey: ['storage-locations', 'all'],
    queryFn: () => api.get('/inventory/storage-locations?limit=200'),
    staleTime: 60_000,
  });
  const locations: StorageLocation[] = (locsResp as any)?.data ?? (locsResp as any) ?? [];

  // Source-location contents (drives the item picker)
  const { data: contentsResp } = useQuery({
    queryKey: ['location-contents', fromLoc],
    queryFn: () => api.get(`/inventory/storage-locations/${fromLoc}/contents`),
    enabled: !!fromLoc && open,
    staleTime: 10_000,
  });
  const contents = contentsResp as unknown as LocationContents | undefined;

  const rows: Transfer[] = (data as unknown as ListResponse)?.data ?? [];
  const total: number = (data as unknown as ListResponse)?.total ?? 0;
  const st = stats as unknown as { total: number; byType: Record<string, number> } | undefined;

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/inventory/storage-transfers', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['location-contents'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['raw-materials'] });
      toast({ title: t('storageMoves.createdSuccess'), variant: 'success' });
      closeForm();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast({ title: t('storageMoves.createdFailed'), description: msg, variant: 'destructive' });
    },
  });

  const openForm = () => { setOpen(true); setFromLoc(''); setToLoc(''); setKind('MATERIAL_LOT'); setItemId(''); setQty(''); setNotes(''); };
  const closeForm = () => { setOpen(false); setItemId(''); setQty(''); setNotes(''); };

  // Item options for the selected kind from the source-location contents
  const itemOptions: { id: string; label: string; remaining?: number; unit?: string }[] = (() => {
    if (!contents) return [];
    if (kind === 'MATERIAL_LOT') return (contents.materialLots ?? []).map(l => ({ id: l.id, label: `${l.lotNumber} · ${l.materialName}`, remaining: l.remainingQty, unit: l.unit }));
    if (kind === 'RAW_MATERIAL') return (contents.rawMaterials ?? []).map(r => ({ id: r.id, label: `${r.code} — ${r.name}`, remaining: r.stockQty, unit: r.unit }));
    if (kind === 'SPARE_PART') return (contents.spareParts ?? []).map(p => ({ id: p.id, label: `${p.partNumber} — ${p.name}`, remaining: p.stockQty, unit: 'PCS' }));
    return (contents.skus ?? []).map(s => ({ id: s.id, label: `${s.itemNumber ?? s.code} — ${s.name}`, remaining: s.currentStock, unit: s.baseUnit }));
  })();
  const selectedItem = itemOptions.find(o => o.id === itemId);
  const isLot = kind === 'MATERIAL_LOT';

  const submit = () => {
    const dto: any = { entityType: kind === 'MATERIAL_LOT' ? 'RAW_MATERIAL' : kind, fromLocationId: fromLoc || undefined, toLocationId: toLoc, notes: notes || undefined };
    if (kind === 'MATERIAL_LOT') { dto.materialLotId = itemId; if (qty) dto.quantity = parseFloat(qty); }
    else dto.entityId = itemId;
    createMutation.mutate(dto);
  };

  const valid = !!toLoc && !!itemId && toLoc !== fromLoc && (!isLot || (!qty || parseFloat(qty) > 0));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.storageMoves.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.storageMoves.subtitle')}</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openForm}><Plus size={14} />{t('storageMoves.newTransfer')}</Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted-foreground">{t('storageMoves.kpi.total')}</span><ArrowLeftRight size={14} className="text-brand-400" /></div>
            <p className="text-2xl font-bold text-brand-400">{st?.total ?? 0}</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted-foreground">{t('storageMoves.kind.raw')}</span><FlaskConical size={14} className="text-amber-400" /></div>
            <p className="text-2xl font-bold">{st?.byType?.RAW_MATERIAL ?? 0}</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted-foreground">{t('storageMoves.kind.spare')}</span><Wrench size={14} className="text-blue-400" /></div>
            <p className="text-2xl font-bold">{st?.byType?.SPARE_PART ?? 0}</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1"><span className="text-xs text-muted-foreground">{t('storageMoves.kind.product')}</span><Boxes size={14} className="text-green-400" /></div>
            <p className="text-2xl font-bold">{st?.byType?.PRODUCT ?? 0}</p>
          </div>
        </div>

        {/* Table */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('storageMoves.tableTitle')}</h3>
            <div className="relative">
              <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('storageMoves.search')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-8 pl-7 w-48 text-xs" />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  {[t('storageMoves.col.transfer'), t('storageMoves.col.item'), t('storageMoves.col.from'), '', t('storageMoves.col.to'), t('storageMoves.col.qty'), t('storageMoves.col.date')].map((h, i) => (
                    <TableHead key={i} className="text-[11px] font-semibold whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>)}</TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <ArrowLeftRight size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">{t('storageMoves.empty')}</p>
                    <p className="text-xs mt-1">{t('storageMoves.emptyHint')}</p>
                  </TableCell></TableRow>
                ) : (
                  rows.map(r => (
                    <TableRow key={r.id} className="border-border/20 hover:bg-muted/20">
                      <TableCell className="font-mono text-xs font-semibold text-primary">{r.transferNumber}</TableCell>
                      <TableCell>
                        <div className="text-xs font-medium max-w-[180px] truncate">{r.entityName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{r.entityCode}{r.materialLot ? ` · ${r.materialLot.lotNumber}` : ''}</div>
                      </TableCell>
                      <TableCell>
                        {r.fromLocation ? (
                          <div className="flex items-center gap-1 text-xs"><MapPin size={10} className="text-muted-foreground" />{r.fromLocation.code}</div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><ArrowRight size={13} className="text-brand-400" /></TableCell>
                      <TableCell>
                        {r.toLocation ? (
                          <div className="flex items-center gap-1 text-xs"><MapPin size={10} className="text-brand-400" />{r.toLocation.code}</div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><span className="text-xs font-semibold tabular-nums">{r.quantity}</span> <span className="text-[10px] text-muted-foreground">{r.unit}</span></TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      {/* ── New Transfer inline form ────────────────────────── */}
      {open && (
        <InlineFormPanel
          open={open}
          onClose={closeForm}
          icon={ArrowLeftRight}
          iconClassName="text-brand-400"
          iconWrapClassName="bg-brand-500/15"
          title={t('storageMoves.newTransfer')}
          description={t('storageMoves.formDesc')}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={closeForm}>{t('storageMoves.cancel')}</Button>
              <Button size="sm" className="gap-1.5" disabled={!valid || createMutation.isPending} onClick={submit}>
                <ArrowLeftRight size={12} />{createMutation.isPending ? t('storageMoves.submitting') : t('storageMoves.execute')}
              </Button>
            </>
          )}
        >
          <div className="space-y-3 py-1">
            {/* Source location */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t('storageMoves.from')} <span className="text-destructive">*</span></Label>
              <select value={fromLoc} onChange={e => { setFromLoc(e.target.value); setItemId(''); }} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="">{t('storageMoves.selectLocation')}</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
              </select>
            </div>

            {/* Item kind */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t('storageMoves.itemKind')}</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {(Object.keys(KIND_CONFIG) as ItemKind[]).map(k => {
                  const C = KIND_CONFIG[k];
                  return (
                    <button key={k} type="button" onClick={() => { setKind(k); setItemId(''); setQty(''); }}
                      className={cn('flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] font-medium transition-colors',
                        kind === k ? 'border-brand-500/60 bg-brand-500/10 text-brand-300' : 'border-border/40 text-muted-foreground hover:bg-muted/20')}>
                      <C.icon size={14} />{t(C.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Item */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t('storageMoves.item')} <span className="text-destructive">*</span></Label>
              <select value={itemId} onChange={e => { setItemId(e.target.value); const it = itemOptions.find(o => o.id === e.target.value); if (isLot && it?.remaining != null) setQty(String(it.remaining)); }}
                disabled={!fromLoc} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50">
                <option value="">{fromLoc ? t('storageMoves.selectItem') : t('storageMoves.selectLocationFirst')}</option>
                {itemOptions.map(o => <option key={o.id} value={o.id}>{o.label}{o.remaining != null ? ` (${o.remaining} ${o.unit ?? ''})` : ''}</option>)}
              </select>
              {!isLot && selectedItem && <p className="text-[11px] text-muted-foreground">{t('storageMoves.relocateHint')}</p>}
            </div>

            {/* Qty (lots only) */}
            {isLot && selectedItem && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('storageMoves.qty')} <span className="font-normal text-muted-foreground">{selectedItem.unit} · {t('storageMoves.maxAvail', { count: selectedItem.remaining ?? 0 })}</span></Label>
                <Input type="number" min={0} step="any" max={selectedItem.remaining} value={qty} onChange={e => setQty(e.target.value)} className="h-9" />
                <p className="text-[11px] text-muted-foreground">{t('storageMoves.qtyHint')}</p>
              </div>
            )}

            {/* Destination */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t('storageMoves.to')} <span className="text-destructive">*</span></Label>
              <select value={toLoc} onChange={e => setToLoc(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="">{t('storageMoves.selectLocation')}</option>
                {locations.filter(l => l.id !== fromLoc).map(l => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('storageMoves.notes')}</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('storageMoves.notesPlaceholder')} className="h-9" />
            </div>
          </div>
        </InlineFormPanel>
      )}
    </div>
  );
}
