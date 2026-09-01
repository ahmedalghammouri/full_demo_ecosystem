'use client';
import { useTranslation } from 'react-i18next';

/**
 * Material Consumption ledger — every row is a real consumption written when
 * a routed work order completes (routing-step materials × produced output),
 * linked to its work order, output batch and FIFO raw-material lot.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Boxes, Package, FlaskConical, GitCommit } from 'lucide-react';

import { api } from '@/services/api.client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TablePagination } from '@/components/ui/table-pagination';

interface ConsumptionRow {
  id: string;
  materialCode: string;
  materialName: string;
  quantityPlanned: number;
  quantityActual: number;
  unit: string;
  consumedAt: string;
  workOrder: { id: string; orderNumber: string } | null;
  batchRecord: { id: string; batchNumber: string; lotNumber: string | null } | null;
  materialLot: { id: string; lotNumber: string } | null;
}

interface ConsumptionResponse {
  data: ConsumptionRow[];
  total: number;
  totalPages: number;
  totalPlanned: number;
  totalActual: number;
}

export function MaterialConsumptionView() {
  const { t } = useTranslation('modules');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['traceability', 'consumption', search, page],
    queryFn: () => api.get<ConsumptionResponse>('/traceability/consumption', {
      params: { search: search || undefined, page, limit: 30 },
    }),
    staleTime: 15_000,
  });

  const resp = data as unknown as ConsumptionResponse | undefined;
  const rows = resp?.data ?? [];

  const kpis = [
    { label: 'Consumption Records', value: resp?.total ?? 0, icon: Boxes, color: 'text-sky-400' },
    { label: 'Planned Quantity', value: (resp?.totalPlanned ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 }), icon: Package, color: 'text-indigo-400' },
    { label: 'Actual Consumed', value: (resp?.totalActual ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 }), icon: FlaskConical, color: 'text-emerald-400' },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('traceability.consumption.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('traceability.consumption.subtitle')}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
              </div>
              <k.icon size={22} className={k.color} />
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('consumptionSearch')}
            className="h-9 ps-8"
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr className="text-left text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 font-semibold">{t('consumptionCol.consumedAt')}</th>
                  <th className="px-4 py-3 font-semibold">{t('consumptionCol.material')}</th>
                  <th className="px-4 py-3 font-semibold text-end">{t('consumptionCol.planned')}</th>
                  <th className="px-4 py-3 font-semibold text-end">{t('consumptionCol.actual')}</th>
                  <th className="px-4 py-3 font-semibold">{t('consumptionCol.unit')}</th>
                  <th className="px-4 py-3 font-semibold">{t('consumptionCol.workOrder')}</th>
                  <th className="px-4 py-3 font-semibold">{t('consumptionCol.outputBatch')}</th>
                  <th className="px-4 py-3 font-semibold">{t('consumptionCol.rawLot')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-xs">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-xs">
                      {t('noConsumption')}
                    </td>
                  </tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-2.5 tabular-nums text-xs text-muted-foreground">
                      {new Date(r.consumedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.materialName}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{r.materialCode}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.quantityPlanned.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{r.quantityActual.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs">{r.unit}</td>
                    <td className="px-4 py-2.5">
                      {r.workOrder
                        ? <Badge variant="outline" className="font-mono text-[11px]"><GitCommit size={9} className="mr-1" />{r.workOrder.orderNumber}</Badge>
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.batchRecord?.batchNumber ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.materialLot?.lotNumber ?? <span className="text-muted-foreground">unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(resp?.total ?? 0) > 30 && (
            <div className="border-t border-border/50 px-4 py-2">
              <TablePagination page={page} total={resp!.total} limit={30} onPageChange={setPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
