'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import {
  PackageCheck, AlertTriangle, Clock, Search, Package,
  MapPin, Calendar, ChevronDown, Filter, AlertCircle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';

// ── Types ────────────────────────────────────────────────────

interface PendingRequest {
  id: string;
  woId: string;
  woNumber: string;
  woTitle: string;
  woPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  woDueDate: string | null;
  machine: { name: string; code: string };
  sparePartId: string;
  partNumber: string;
  partName: string;
  category: string | null;
  stockQty: number;
  minStockQty: number;
  storageLocation: string | null;
  unitCost: number | null;
  quantityRequested: number;
  quantityIssued: number;
  status: 'PENDING';
  requestedAt: string;
  notes: string | null;
  insufficientStock: boolean;
}

interface PendingPartsResponse {
  data: PendingRequest[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Constants ────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { labelKey: string; bg: string; text: string; border: string }> = {
  CRITICAL: { labelKey: 'spareRequestsView.priority.critical', bg: 'bg-red-500/10',  text: 'text-red-400',  border: 'border-red-500/30'  },
  HIGH:     { labelKey: 'spareRequestsView.priority.high',     bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  MEDIUM:   { labelKey: 'spareRequestsView.priority.medium',  bg: 'bg-blue-500/10',  text: 'text-blue-400',  border: 'border-blue-500/30'  },
  LOW:      { labelKey: 'spareRequestsView.priority.low',     bg: 'bg-muted/20',     text: 'text-muted-foreground', border: 'border-border' },
};

const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// ── Component ────────────────────────────────────────────────

export function SparePartsRequestsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [issueDialog, setIssueDialog] = useState<PendingRequest | null>(null);
  const [issueQty, setIssueQty] = useState('');
  const [issueNotes, setIssueNotes] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Queries ─────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', 'pending-parts', { search, priority: priorityFilter }, page],
    queryFn: () =>
      api.get<PendingPartsResponse>('/maintenance/pending-parts', {
        params: {
          search: search || undefined,
          page,
          limit: 20,
        },
      }),
    staleTime: 15_000,
  });

  const requests: PendingRequest[] = (data as unknown as PendingPartsResponse)?.data ?? [];
  const total: number = (data as unknown as PendingPartsResponse)?.total ?? 0;

  // Sorted by priority order, then filtered
  const filtered = requests
    .filter(r => !priorityFilter || r.woPriority === priorityFilter)
    .sort((a, b) => (PRIORITY_ORDER[a.woPriority] ?? 3) - (PRIORITY_ORDER[b.woPriority] ?? 3));

  // KPI counts
  const insufficientCount = requests.filter(r => r.insufficientStock).length;
  const criticalHighCount = requests.filter(r => r.woPriority === 'CRITICAL' || r.woPriority === 'HIGH').length;

  // ── Mutations ────────────────────────────────────────────────

  const issueMutation = useMutation({
    mutationFn: ({ woId, requestId, dto }: { woId: string; requestId: string; dto: { quantityIssued: number; notes?: string } }) =>
      api.patch(`/maintenance/work-orders/${woId}/spare-parts/${requestId}/issue`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'pending-parts'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('spareRequestsView.issuedSuccess'), variant: 'success' });
      handleCloseIssueDialog();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast({ title: t('spareRequestsView.issueFailed'), description: msg, variant: 'destructive' });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────

  const handleOpenIssue = (req: PendingRequest) => {
    const defaultQty = Math.min(req.quantityRequested - req.quantityIssued, req.stockQty);
    setIssueDialog(req);
    setIssueQty(defaultQty > 0 ? defaultQty.toString() : '');
    setIssueNotes('');
  };

  const handleCloseIssueDialog = () => {
    setIssueDialog(null);
    setIssueQty('');
    setIssueNotes('');
  };

  const handleConfirmIssue = () => {
    if (!issueDialog) return;
    issueMutation.mutate({
      woId: issueDialog.woId,
      requestId: issueDialog.id,
      dto: {
        quantityIssued: parseInt(issueQty),
        notes: issueNotes || undefined,
      },
    });
  };

  const issueQtyNum = parseInt(issueQty);
  const issueQtyExceedsStock = issueDialog ? issueQtyNum > issueDialog.stockQty : false;
  const issueQtyExceedsRequested = issueDialog ? issueQtyNum > (issueDialog.quantityRequested - issueDialog.quantityIssued) : false;
  const issueValid = !!issueQty && issueQtyNum > 0 && !issueQtyExceedsStock && !issueMutation.isPending;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.spareRequests.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.spareRequests.subtitle')}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('spareRequestsView.kpi.totalPending')}</span>
              <Package size={14} className="text-brand-400" />
            </div>
            <p className="text-2xl font-bold text-brand-400">{total}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('spareRequestsView.awaitingIssue')}</p>
          </div>
          <div className={cn('glass-card p-4', insufficientCount > 0 && 'border-red-500/30')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('spareRequestsView.kpi.insufficientStock')}</span>
              <AlertCircle size={14} className={insufficientCount > 0 ? 'text-red-400' : 'text-muted-foreground'} />
            </div>
            <p className={cn('text-2xl font-bold', insufficientCount > 0 ? 'text-red-400' : 'text-muted-foreground')}>
              {insufficientCount}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('spareRequestsView.belowRequired')}</p>
          </div>
          <div className={cn('glass-card p-4', criticalHighCount > 0 && 'border-amber-500/30')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('spareRequestsView.kpi.highCritical')}</span>
              <AlertTriangle size={14} className={criticalHighCount > 0 ? 'text-amber-400' : 'text-muted-foreground'} />
            </div>
            <p className={cn('text-2xl font-bold', criticalHighCount > 0 ? 'text-amber-400' : 'text-muted-foreground')}>
              {criticalHighCount}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('spareRequestsView.urgentWaiting')}</p>
          </div>
        </div>

        {/* Table */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('spareRequests.pending')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('spareRequests.search')}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="h-8 pl-7 w-44 text-xs"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />
                    {priorityFilter && PRIORITY_CONFIG[priorityFilter] ? t(PRIORITY_CONFIG[priorityFilter].labelKey) : t('spareRequestsView.allPriorities')}
                    <ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setPriorityFilter(null); setPage(1); }}>{t('spareRequestsView.allPriorities')}</DropdownMenuItem>
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <DropdownMenuItem key={k} onClick={() => { setPriorityFilter(k); setPage(1); }}>
                      <span className={v.text}>{t(v.labelKey)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  {[t('spareRequests.col.wo'), t('spareRequests.col.machine'), t('spareRequests.col.priority'), t('spareRequests.col.part'), t('spareRequests.col.partNo'), t('spareRequests.col.req'), t('spareRequests.col.availableStock'), t('spareRequests.col.location'), t('spareRequests.col.dueDate'), ''].map((h, i) => (
                    <TableHead key={i} className="text-[11px] font-semibold whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      <Package size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{t('spareRequestsView.noPending')}</p>
                      <p className="text-xs mt-1">{t('spareRequestsView.noPendingHint')}</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(req => {
                    const priority = PRIORITY_CONFIG[req.woPriority];
                    const remaining = req.quantityRequested - req.quantityIssued;
                    return (
                      <TableRow key={req.id} className={cn('border-border/20 hover:bg-muted/20', req.insufficientStock && 'bg-red-500/5')}>
                        {/* WO Number */}
                        <TableCell>
                          <div className="font-mono text-xs font-semibold text-primary">{req.woNumber}</div>
                          <div className="text-[10px] text-muted-foreground max-w-[120px] truncate">{req.woTitle}</div>
                        </TableCell>

                        {/* Machine */}
                        <TableCell>
                          <div className="text-xs font-medium">{req.machine.name}</div>
                          <div className="text-[10px] font-mono text-muted-foreground">{req.machine.code}</div>
                        </TableCell>

                        {/* Priority */}
                        <TableCell>
                          <span className={cn(
                            'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                            priority.text, priority.bg, priority.border,
                          )}>
                            {t(priority.labelKey)}
                          </span>
                        </TableCell>

                        {/* Part name */}
                        <TableCell>
                          <div className="text-xs font-medium max-w-[140px] truncate">{req.partName}</div>
                          {req.category && (
                            <div className="text-[10px] text-muted-foreground">{req.category}</div>
                          )}
                        </TableCell>

                        {/* Part number */}
                        <TableCell>
                          <span className="font-mono text-[11px] text-muted-foreground">{req.partNumber}</span>
                        </TableCell>

                        {/* Requested qty */}
                        <TableCell>
                          <span className="text-xs font-semibold tabular-nums">{remaining}</span>
                          {req.quantityIssued > 0 && (
                            <div className="text-[10px] text-muted-foreground">{t('spareRequestsView.alreadyIssued', { count: req.quantityIssued })}</div>
                          )}
                        </TableCell>

                        {/* Available stock */}
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              'text-xs font-bold tabular-nums',
                              req.insufficientStock ? 'text-red-400' : 'text-green-400',
                            )}>
                              {req.stockQty}
                            </span>
                            {req.insufficientStock && (
                              <span className="flex items-center gap-0.5 text-[10px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-1.5 py-0.5 whitespace-nowrap">
                                <AlertTriangle size={8} />{t('spareRequestsView.short')}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{t('spareRequestsView.min', { count: req.minStockQty })}</div>
                        </TableCell>

                        {/* Storage location */}
                        <TableCell>
                          {req.storageLocation ? (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin size={10} />
                              {req.storageLocation}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Due date */}
                        <TableCell>
                          {req.woDueDate ? (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar size={10} />
                              {formatDate(req.woDueDate)}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Action */}
                        <TableCell>
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleOpenIssue(req)}
                            disabled={req.stockQty <= 0}
                          >
                            <PackageCheck size={11} />{t('spareRequestsView.issue')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      {/* ── Issue Parts — inline form ────────────────────────── */}
      {issueDialog && (
        <InlineFormPanel
          open={!!issueDialog}
          onClose={handleCloseIssueDialog}
          icon={PackageCheck}
          iconClassName="text-green-400"
          iconWrapClassName="bg-green-500/15"
          title={t('spareRequestsView.issueTitle')}
          description={t('spareRequestsView.issueDesc', { part: issueDialog.partName, wo: issueDialog.woNumber })}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={handleCloseIssueDialog}>{t('spareRequestsView.cancel')}</Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!issueValid}
                onClick={handleConfirmIssue}
              >
                <PackageCheck size={12} />
                {issueMutation.isPending ? t('spareRequestsView.issuing') : t('spareRequestsView.confirmIssue')}
              </Button>
            </>
          )}
        >
            <div className="space-y-4 py-1">
              {/* Part & WO summary */}
              <div className="glass-card rounded-lg p-3 space-y-1.5">
                {[
                  { label: t('spareRequestsView.summary.partNumber'),       value: issueDialog.partNumber },
                  { label: t('spareRequestsView.summary.machine'),           value: issueDialog.machine.name },
                  { label: t('spareRequestsView.summary.priority'),          value: PRIORITY_CONFIG[issueDialog.woPriority] ? t(PRIORITY_CONFIG[issueDialog.woPriority].labelKey) : issueDialog.woPriority },
                  { label: t('spareRequestsView.summary.qtyRequested'),     value: t('spareRequestsView.unitsRemaining', { count: issueDialog.quantityRequested - issueDialog.quantityIssued }) },
                  { label: t('spareRequestsView.summary.availableInStock'), value: t('spareRequestsView.units', { count: issueDialog.stockQty }) },
                  ...(issueDialog.storageLocation ? [{ label: t('spareRequestsView.summary.storageLocation'), value: issueDialog.storageLocation }] : []),
                  ...(issueDialog.unitCost ? [{ label: t('spareRequestsView.summary.unitCost'), value: `${issueDialog.unitCost.toFixed(2)} SAR` }] : []),
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium">{r.value}</span>
                  </div>
                ))}
              </div>

              {issueDialog.insufficientStock && (
                <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{t('spareRequestsView.insufficientWarn', { count: issueDialog.stockQty })}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('spareRequestsView.quantityToIssue')} <span className="text-destructive">*</span>
                  <span className="font-normal text-muted-foreground ml-1">{t('spareRequestsView.max', { count: Math.min(issueDialog.stockQty, issueDialog.quantityRequested - issueDialog.quantityIssued) })}</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={issueDialog.stockQty}
                  value={issueQty}
                  onChange={e => setIssueQty(e.target.value)}
                  className={cn('h-9', (issueQtyExceedsStock || issueQtyExceedsRequested) && 'border-red-500/60')}
                  autoFocus
                />
                {issueQtyExceedsStock && (
                  <p className="text-[11px] text-red-400">{t('spareRequestsView.exceedsStock', { count: issueDialog.stockQty })}</p>
                )}
                {!issueQtyExceedsStock && issueQtyExceedsRequested && (
                  <p className="text-[11px] text-amber-400">{t('spareRequestsView.exceedsRequested')}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t('spareRequestsView.notesOptional')}</Label>
                <Input
                  value={issueNotes}
                  onChange={e => setIssueNotes(e.target.value)}
                  placeholder={t('spareRequestsView.notesPlaceholder')}
                  className="h-9"
                />
              </div>
            </div>
        </InlineFormPanel>
      )}
    </div>
  );
}
