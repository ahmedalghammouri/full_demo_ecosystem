'use client';

/**
 * CarbonScope2Card — Scope 2 (purchased electricity) emissions.
 *
 *   kg CO₂e = kWh consumed × grid emission factor
 *
 * The kWh shown here is the same figure the Energy dashboard reports — the API
 * reads one source for both — so the carbon number can never contradict the
 * energy number. The applied factor is displayed with its unit, source and
 * effective date, and a factor that fell back to the default is labelled as such
 * rather than passed off as configured.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Leaf, Info, AlertTriangle } from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { api } from '@/services/api.client';
import { Badge } from '@/components/ui/badge';

interface Scope2Response {
  kwh: number;
  kgCO2e: number;
  tCO2e: number;
  factor: {
    factorKgPerKwh: number;
    unit: string;
    source: string | null;
    effectiveFrom: string | null;
    isFallback: boolean;
  };
  window: { from: string; to: string };
  method: { standard: string; formula: string; note: string };
}

export function CarbonScope2Card() {
  const { t } = useTranslation('modules');
  const { filter, key: scopeKey } = useScope();
  const { dateFrom, dateTo, key: timeKey } = useTimeRange();

  const { data, isLoading } = useQuery({
    queryKey: ['energy', 'carbon', 'scope2', scopeKey, timeKey],
    queryFn: () => api.get<Scope2Response>('/energy/carbon/scope2', {
      params: { dateFrom, dateTo, ...filter },
    }),
    staleTime: 60_000,
  });

  const big = data && data.tCO2e >= 1;

  return (
    <div className="industrial-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-500/15 text-success-400">
            <Leaf size={15} />
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('carbon.scope2', 'Scope 2 Carbon Footprint')}
          </span>
        </div>

        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label={t('carbon.method', 'Calculation method')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60
                         text-muted-foreground transition-colors hover:border-brand-500/40
                         hover:bg-brand-500/10 hover:text-brand-400"
            >
              <Info size={13} />
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              align="end"
              sideOffset={6}
              className="z-50 w-80 rounded-lg border border-border/70 bg-popover p-3 text-xs leading-relaxed
                         text-popover-foreground shadow-xl outline-none"
            >
              <p className="mb-2 font-semibold">{data?.method.standard ?? 'GHG Protocol Scope 2'}</p>
              <p className="mb-2 font-mono text-[11px]">
                {data?.method.formula ?? 'kg CO₂e = kWh × grid emission factor'}
              </p>
              <p className="text-muted-foreground">{data?.method.note}</p>
              {data && (
                <dl className="mt-2 space-y-1 border-t border-border/40 pt-2">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('carbon.factor', 'Factor applied')}</dt>
                    <dd className="font-medium">{data.factor.factorKgPerKwh} {data.factor.unit}</dd>
                  </div>
                  {data.factor.effectiveFrom && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('carbon.effective', 'Effective from')}</dt>
                      <dd className="font-medium">{data.factor.effectiveFrom.slice(0, 10)}</dd>
                    </div>
                  )}
                  {data.factor.source && (
                    <p className="pt-1 text-[11px] text-muted-foreground">{data.factor.source}</p>
                  )}
                </dl>
              )}
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>

      <div className="flex items-baseline gap-1.5">
        {isLoading ? (
          <div className="shimmer h-8 w-28 rounded" />
        ) : (
          <>
            <span className="text-3xl font-bold tabular-nums">
              {data ? (big ? data.tCO2e.toLocaleString() : Math.round(data.kgCO2e).toLocaleString()) : '—'}
            </span>
            <span className="text-sm text-muted-foreground">{big ? 't CO₂e' : 'kg CO₂e'}</span>
          </>
        )}
      </div>

      {data?.factor.isFallback && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-warning-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {t('carbon.fallback',
            'No emission factor configured for this factory — the KSA default was applied. Set one to make this figure auditable.')}
        </p>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 pt-2
                        text-[11px] text-muted-foreground">
          <span>{Math.round(data.kwh).toLocaleString()} kWh</span>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            × {data.factor.factorKgPerKwh}
          </Badge>
        </div>
      )}
    </div>
  );
}
