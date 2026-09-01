'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Filter, RefreshCw, TrendingDown,
  Package, Clock, User, FileText,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SortableHeader } from '@/components/ui/sortable-header';
import { TablePagination } from '@/components/ui/table-pagination';
import { useSortedData } from '@/lib/use-sorted-data';

const CATEGORIES = ['QUALITY','SETUP','DAMAGE','OVERRUN','MATERIAL','MACHINE','OPERATOR','OTHER'] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_COLORS: Record<Category, string> = {
  QUALITY:  'bg-red-500/15 text-red-400 border-red-500/30',
  SETUP:    'bg-orange-500/15 text-orange-400 border-orange-500/30',
  DAMAGE:   'bg-rose-500/15 text-rose-400 border-rose-500/30',
  OVERRUN:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  MATERIAL: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  MACHINE:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
  OPERATOR: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  OTHER:    'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

interface ScrapLog {
  id: string;
  qty: number;
  reason: string;
  category: Category;
  notes: string | null;
  createdAt: string;
  jobOrder: { operationName: string; sequenceOrder: number; outputUnit: string };
  workOrder: { orderNumber: string; sku: { name: string; code: string } };
  operator: { name: string } | null;
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function ScrapLogView() {
  const { t } = useTranslation(['production', 'common']);
  const [category, setCategory] = useState<string>('');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const LIMIT = 25;

  const { data, isLoading, refetch, isFetching } = useQuery<ScrapLog[]>({
    queryKey: ['scrap-logs', category, from, to],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '500' };
      if (category) params.category = category;
      if (from) params.from = new Date(from).toISOString();
      if (to)   params.to   = new Date(to).toISOString();
      return api.get('/production/scrap-logs', { params });
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const logs: ScrapLog[] = (data as any) ?? [];

  const filtered = search
    ? logs.filter(l =>
        l.reason.toLowerCase().includes(search.toLowerCase()) ||
        l.workOrder.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
        l.workOrder.sku.name.toLowerCase().includes(search.toLowerCase()) ||
        l.jobOrder.operationName.toLowerCase().includes(search.toLowerCase()),
      )
    : logs;

  const { sortedData: sortedLogs, sortCol, sortDir, handleSort } = useSortedData(
    filtered as unknown as Record<string, unknown>[],
    'createdAt',
    'desc',
  );
  const pageData = sortedLogs.slice((page - 1) * LIMIT, page * LIMIT) as unknown as ScrapLog[];

  // Reset page when filters or sort change
  useEffect(() => { setPage(1); }, [search, category, from, to, sortCol, sortDir]);

  // KPIs
  const totalScrap = filtered.reduce((s, l) => s + l.qty, 0);
  const byCat = CATEGORIES.map(c => ({
    cat: c,
    qty: filtered.filter(l => l.category === c).reduce((s, l) => s + l.qty, 0),
    count: filtered.filter(l => l.category === c).length,
  })).filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty);
  const topCategory = byCat[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t('headers.scrap.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('headers.scrap.subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('w-4 h-4 mr-2', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5" />Total Scrapped
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold text-red-400">{fmt(totalScrap)}</p>
            <p className="text-xs text-muted-foreground">{filtered.length} events</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />Top Category
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {topCategory ? (
              <>
                <p className="text-lg font-bold">{topCategory.cat}</p>
                <p className="text-xs text-muted-foreground">{fmt(topCategory.qty)} units · {topCategory.count} events</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" />Avg per Event
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold">{filtered.length ? fmt(totalScrap / filtered.length) : '—'}</p>
            <p className="text-xs text-muted-foreground">units/event</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />Latest Event
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {filtered.length ? (
              <>
                <p className="text-sm font-semibold">{fmtDate(filtered[0].createdAt)}</p>
                <p className="text-xs text-muted-foreground truncate">{filtered[0].workOrder.orderNumber}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category breakdown bar */}
      {byCat.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Scrap by Category</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {byCat.map(({ cat, qty }) => (
              <div key={cat} className="flex items-center gap-3">
                <span className={cn('text-xs font-medium border rounded px-1.5 py-0.5 w-20 text-center', CATEGORY_COLORS[cat])}>
                  {cat}
                </span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500/60 rounded-full transition-all"
                    style={{ width: `${(qty / totalScrap) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-16 text-right">{fmt(qty)} units</span>
                <span className="text-xs text-muted-foreground w-16 text-right">
                  {((qty / totalScrap) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/30 rounded-lg border">
        <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
        <Input
          placeholder={t('scrap.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 w-64 text-sm"
        />
        <Select value={category || 'ALL'} onValueChange={v => setCategory(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder={t('scrap.allCategories')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('scrap.allCategories')}</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">From</span>
          <Input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-xs w-44" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">To</span>
          <Input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} className="h-8 text-xs w-44" />
        </div>
        {(category || from || to || search) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs"
            onClick={() => { setCategory(''); setFrom(''); setTo(''); setSearch(''); }}>
            Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} records</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <SortableHeader column="createdAt"  label={t('scrap.col.timestamp')}  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="workOrder"  label={t('scrap.col.workOrder')}  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="jobOrder"   label={t('scrap.col.operation')}  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="category"   label={t('scrap.col.category')}   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="qty"        label={t('scrap.col.qty')}        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-end" />
                <th className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('scrap.col.reason')}</th>
                <SortableHeader column="operator"   label={t('scrap.col.operator')}   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground text-sm">
                    {t('scrap.noScrap')}
                  </td>
                </tr>
              ) : (
                pageData.map(log => (
                  <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {fmtDate(log.createdAt)}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-xs">{log.workOrder.orderNumber}</div>
                      <div className="text-xs text-muted-foreground">{log.workOrder.sku.code}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-xs">
                        <span className="text-muted-foreground">#{log.jobOrder.sequenceOrder} </span>
                        {log.jobOrder.operationName}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={cn('text-xs font-medium border rounded px-1.5 py-0.5', CATEGORY_COLORS[log.category])}>
                        {log.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-red-400 text-sm">
                      {fmt(log.qty)}
                      <span className="text-xs text-muted-foreground ml-1">{log.jobOrder.outputUnit}</span>
                    </td>
                    <td className="py-2.5 px-4 max-w-[220px]">
                      <div className="flex items-start gap-1.5">
                        <FileText className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs line-clamp-2">{log.reason}</span>
                      </div>
                      {log.notes && (
                        <div className="text-xs text-muted-foreground mt-0.5 pl-4 line-clamp-1">{log.notes}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {log.operator ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <User className="w-3 h-3 text-muted-foreground" />
                          {log.operator.name}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={page}
          total={sortedLogs.length}
          limit={LIMIT}
          onPageChange={setPage}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
