'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { ArrowLeftRight, Search, Package, XCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { ExportMenu } from '@/components/ui/export-menu';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

interface Movement {
  id: string;
  entityType: string;
  entityCode: string | null;
  entityName: string | null;
  movementType: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  stockBefore: number | null;
  stockAfter: number | null;
  referenceType: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  performedBy?: { name: string | null } | null;
}

const ENTITY_LABEL_KEYS: Record<string, string> = { SPARE_PART: 'stockMovementsView.entity.SPARE_PART', RAW_MATERIAL: 'stockMovementsView.entity.RAW_MATERIAL', PRODUCT: 'stockMovementsView.entity.PRODUCT' };
const MOVEMENT_TONE: Record<string, string> = {
  RECEIPT: 'text-green-400 border-green-400/40', RETURN: 'text-green-400 border-green-400/40', RELEASE: 'text-green-400 border-green-400/40',
  ISSUE: 'text-red-400 border-red-400/40', CONSUMPTION: 'text-red-400 border-red-400/40',
  ADJUSTMENT: 'text-amber-400 border-amber-400/40', RESERVATION: 'text-blue-400 border-blue-400/40',
};
const MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'CONSUMPTION'];

const fmt = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString(); };

export function StockMovementsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('ALL');
  const [movementType, setMovementType] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'stock-movements', { entityType, movementType, dateFrom, dateTo, page }],
    queryFn: () => api.get<any>('/inventory/stock-movements', {
      params: {
        entityType: entityType !== 'ALL' ? entityType : undefined,
        movementType: movementType !== 'ALL' ? movementType : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
        page,
        limit: 25,
      },
    }),
    staleTime: 15_000,
  });

  const all: Movement[] = (data as any)?.data ?? [];
  const total: number = (data as any)?.total ?? 0;
  // Client-side text search (the endpoint has no text filter).
  const rows = search
    ? all.filter((m) => `${m.entityName ?? ''} ${m.entityCode ?? ''} ${m.referenceNumber ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    : all;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><ArrowLeftRight size={18} className="text-primary" /> {t('headers.stockMovements.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.stockMovements.subtitle')}</p>
        </div>
        <ExportMenu
          filename="stock-movements"
          title={t('stockMovementsView.exportTitle')}
          rows={rows}
          columns={[
            { key: 'createdAt', label: t('stockMovementsView.exportCol.date'), value: (r: any) => fmt(r.createdAt) },
            { key: 'entityType', label: t('stockMovementsView.exportCol.type'), value: (r: any) => (ENTITY_LABEL_KEYS[r.entityType] ? t(ENTITY_LABEL_KEYS[r.entityType]) : r.entityType) },
            { key: 'entityCode', label: t('stockMovementsView.exportCol.itemCode'), value: (r: any) => r.entityCode ?? '' },
            { key: 'entityName', label: t('stockMovementsView.exportCol.item'), value: (r: any) => r.entityName ?? '' },
            { key: 'movementType', label: t('stockMovementsView.exportCol.movement') },
            { key: 'quantity', label: t('stockMovementsView.exportCol.qty') },
            { key: 'stockBefore', label: t('stockMovementsView.exportCol.before'), value: (r: any) => r.stockBefore ?? '' },
            { key: 'stockAfter', label: t('stockMovementsView.exportCol.after'), value: (r: any) => r.stockAfter ?? '' },
            { key: 'totalCost', label: t('stockMovementsView.exportCol.cost'), value: (r: any) => r.totalCost ?? '' },
            { key: 'reference', label: t('stockMovementsView.exportCol.reference'), value: (r: any) => r.referenceNumber ?? r.referenceType ?? '' },
            { key: 'performedBy', label: t('stockMovementsView.exportCol.by'), value: (r: any) => r.performedBy?.name ?? '' },
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Filters */}
        <div className="industrial-card p-4 flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder={t('stockMovements.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 ps-7 w-56 text-xs" />
          </div>
          <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(1); }}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('stockMovementsView.allItemTypes')}</SelectItem>
              {Object.keys(ENTITY_LABEL_KEYS).map((k) => <SelectItem key={k} value={k}>{t(ENTITY_LABEL_KEYS[k])}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={movementType} onValueChange={(v) => { setMovementType(v); setPage(1); }}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('stockMovementsView.allMovements')}</SelectItem>
              {MOVEMENT_TYPES.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-8 w-36 text-xs" title={t('stockMovementsView.from')} />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-8 w-36 text-xs" title={t('stockMovementsView.to')} />
        </div>

        <div className="rounded-lg border border-border/30 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/30">
                <TableHead className="text-[11px] font-semibold">{t('stockMovements.col.date')}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t('stockMovements.col.item')}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t('stockMovements.col.type')}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t('stockMovements.col.movement')}</TableHead>
                <TableHead className="text-[11px] font-semibold text-end">{t('stockMovements.col.qty')}</TableHead>
                <TableHead className="text-[11px] font-semibold text-end">{t('stockMovements.col.beforeAfter')}</TableHead>
                <TableHead className="text-[11px] font-semibold text-end">{t('stockMovements.col.cost')}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t('stockMovements.col.reference')}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t('stockMovements.col.by')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-border/20">{Array.from({ length: 9 }).map((_, j) => <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>)}</TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground text-sm">
                  <Package size={20} className="mx-auto mb-2 opacity-40" /> {t('stockMovements.noMovements')}
                </TableCell></TableRow>
              ) : rows.map((m) => {
                const inbound = ['RECEIPT', 'RETURN', 'RELEASE'].includes(m.movementType);
                return (
                  <TableRow key={m.id} className="border-border/20 hover:bg-muted/20">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(m.createdAt)}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{m.entityName ?? '—'}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{m.entityCode}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ENTITY_LABEL_KEYS[m.entityType] ? t(ENTITY_LABEL_KEYS[m.entityType]) : m.entityType}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px]', MOVEMENT_TONE[m.movementType] ?? '')}>{m.movementType}</Badge>
                    </TableCell>
                    <TableCell className={cn('text-xs text-right font-mono font-semibold', inbound ? 'text-green-400' : m.movementType === 'ADJUSTMENT' ? 'text-amber-400' : 'text-red-400')}>
                      {inbound ? '+' : m.movementType === 'ADJUSTMENT' ? '' : '-'}{Math.abs(m.quantity)}
                    </TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground tabular-nums">
                      {m.stockBefore ?? '—'} → <span className="text-foreground font-medium">{m.stockAfter ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{m.totalCost != null ? m.totalCost.toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.referenceNumber ?? m.referenceType ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.performedBy?.name ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <TablePagination page={page} total={total} limit={25} onPageChange={setPage} isLoading={isLoading} />
      </div>
    </div>
  );
}
