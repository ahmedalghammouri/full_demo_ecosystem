'use client';
/**
 * Live Production — what is being made right now.
 *
 * The first question a supervisor walking in asks: which orders are running, on
 * which machines, how far along, and is the line healthy this shift. No time
 * filter, because the answer is only ever about this shift; if you want last
 * Tuesday, that is the analytics side of the menu.
 *
 * Quantities stay in the unit each step counts. The filler thinks in inners and
 * the palletiser in pallets, and normalising both to pieces on an operator's own
 * screen helps nobody — the plant rollups convert, this list does not.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Factory } from 'lucide-react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';
import {
  useLive, LiveHeader, LiveStat, LivePct, LiveEmpty, LiveFailed,
  StateChip, fmtMin, fmtNum, since,
} from './live-shared';

export function LiveProductionView() {
  const { t } = useTranslation(['production', 'common']);
  // Declaring the mode is what hides the period control: this view has no use
  // for one, and an unusable filter is worse than a missing one.
  useDeclareViewMode('live');
  const { data, isLoading, error, refetch, scope } = useLive();

  const body = () => {
    if (error) return <LiveFailed onRetry={refetch} />;
    if (isLoading && !data) return <LiveEmpty text={t('common:loading')} />;
    if (!data) return <LiveEmpty text={t('live.noData')} />;

    const x = data.totals;
    const p = data.plant;
    const stateOf = (machineId: string | null) =>
      data.machines.find((m) => m.machineId === machineId)?.state ?? 'OFFLINE';

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {/* Both bases, side by side and labelled. The system supports two ways
              of measuring availability and a plant needs to see them together —
              showing one and hiding the other is how OEE-TB quietly disappeared. */}
          <LiveStat label={t('live.oee')} value={x.oee == null ? '—' : `${x.oee}%`} tone="primary"
                    sub={t('live.scheduleBasis')} />
          <LiveStat label={t('live.oeeTb')} value={x.oeeTb == null ? '—' : `${x.oeeTb}%`}
                    sub={t('live.timeBasis')} />
          <LiveStat label={t('oeeAn.availability')} value={x.availability == null ? '—' : `${x.availability}%`}
                    sub={x.availabilityTb == null ? undefined : t('live.tbIs', { v: x.availabilityTb })} />
          <LiveStat label={t('oeeAn.performance')} value={x.performance == null ? '—' : `${x.performance}%`} />
          <LiveStat label={t('oeeAn.quality')} value={x.quality == null ? '—' : `${x.quality}%`} />
          <LiveStat label={t('live.goodNow')} value={fmtNum(x.good)} tone="good" sub={t('schedCap.pieces')} />
          <LiveStat label={t('oeeAn.scrap')} value={fmtNum(x.scrap)} tone={x.scrap > 0 ? 'bad' : undefined}
                    sub={t('schedCap.pieces')} />
        </div>

        {/* ── Plant readings for this shift ─────────────────────────────
            These lived on the Loss Tree and Schedule & Capacity pages. They are
            readings of how the plant stands right now, so they belong here — and
            they are computed over the same shift window as everything above, so
            they cannot disagree with it. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <LiveStat label={t('live.teep')} value={p.teep == null ? '—' : `${p.teep}%`}
                    tone="warn"
                    sub={p.teepTb == null ? t('oeeAn.vsCalendar') : t('live.tbIs', { v: p.teepTb })} />
          <LiveStat label={t('oeeAn.utilization')} value={p.utilization == null ? '—' : `${p.utilization}%`}
                    sub={t('oeeAn.ofCalendar')} />
          <LiveStat label={t('schedCap.msa')}
                    value={p.scheduleAttainment == null ? '—' : `${p.scheduleAttainment}%`}
                    tone={p.scheduleAttainment != null && p.scheduleAttainment >= 95 ? 'good' : 'warn'}
                    sub={t('schedCap.ordersCount', { count: p.scheduledOrders })} />
          <LiveStat label={t('schedCap.capacity')}
                    value={p.capacityUtilization == null ? '—' : `${p.capacityUtilization}%`}
                    tone={p.capacityUtilization != null && p.capacityUtilization > 100 ? 'bad' : undefined}
                    sub={p.machinesWithoutRate > 0
                      ? t('live.machinesWithoutRate', { count: p.machinesWithoutRate })
                      : t('schedCap.designedUnits')} />
        </div>

        {/* ── Orders actually executing ─────────────────────────────────── */}
        <section className="rounded-lg border border-border/50 overflow-hidden">
          <header className="px-4 py-3 border-b border-border/50">
            <h2 className="text-sm font-semibold">{t('live.runningOrders')}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t('live.runningOrdersHelp')}</p>
          </header>
          {data.jobOrders.length === 0 ? (
            <LiveEmpty text={t('live.nothingRunning')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{t('live.operation')}</TableHead>
                  <TableHead>{t('oeeAn.machine')}</TableHead>
                  <TableHead>{t('live.state')}</TableHead>
                  <TableHead>{t('schedCap.order')}</TableHead>
                  <TableHead>{t('schedCap.sku')}</TableHead>
                  <TableHead className="text-right">{t('live.progress')}</TableHead>
                  <TableHead className="text-right">{t('oeeAn.scrap')}</TableHead>
                  <TableHead className="text-right">{t('live.runningFor')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobOrders.map((j) => {
                  const pct = j.plannedQty > 0
                    ? Math.min(100, Math.round((j.goodQty / j.plannedQty) * 1000) / 10)
                    : null;
                  return (
                    <TableRow key={j.jobOrderId}>
                      <TableCell className="text-xs text-muted-foreground">{j.sequenceOrder}</TableCell>
                      <TableCell className="text-sm font-medium">{j.operationName ?? '—'}</TableCell>
                      <TableCell className="text-xs">{j.machineCode ?? '—'}</TableCell>
                      <TableCell><StateChip state={stateOf(j.machineId)} /></TableCell>
                      <TableCell className="text-xs">
                        <div>{j.workOrderNumber ?? '—'}</div>
                        {j.productionOrderNumber && (
                          <div className="text-[10px] text-muted-foreground">{j.productionOrderNumber}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{j.sku ?? '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {/* In the step's OWN unit — an operator at the cartoner
                            thinks in cartons, not in normalised pieces. */}
                        {fmtNum(j.goodQty)} / {fmtNum(j.plannedQty)}{' '}
                        <span className="text-muted-foreground">{j.outputUnit ?? ''}</span>
                        {pct != null && <span className="ms-1.5 text-muted-foreground">({pct}%)</span>}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {j.scrapQty > 0
                          ? <span className="text-red-400">{fmtNum(j.scrapQty)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {since(j.startedAt) ?? '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>

        {/* ── How the line is running this shift ────────────────────────── */}
        <section className="rounded-lg border border-border/50 overflow-hidden">
          <header className="px-4 py-3 border-b border-border/50">
            <h2 className="text-sm font-semibold">{t('live.thisShiftByMachine')}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t('live.sameEngineNote')}</p>
          </header>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('oeeAn.machine')}</TableHead>
                <TableHead>{t('live.state')}</TableHead>
                <TableHead className="text-right">{t('machineStatus.plannedProduction')}</TableHead>
                <TableHead className="text-right">{t('machineStatus.running')}</TableHead>
                <TableHead className="text-right">{t('machineStatus.unplanned')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.availability')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.oee')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.machines.map((m) => (
                <TableRow key={m.machineId}>
                  <TableCell className="text-sm">
                    <div className="font-medium">{m.code}</div>
                    <div className="text-[11px] text-muted-foreground">{m.name}</div>
                  </TableCell>
                  <TableCell>
                    <StateChip state={m.state} />
                    {m.stateSince && (
                      <div className="text-[10px] text-muted-foreground mt-1">{since(m.stateSince)}</div>
                    )}
                  </TableCell>
                  {/*
                    Zero planned production is a REASON, not a number.

                    A starved or blocked machine loses its minutes to external
                    loss -- the line could not feed it, so those minutes leave
                    the denominator entirely. That is standard OEE and it is
                    correct. But a machine that stood in the shift for eleven
                    hours showing "0m" of planned production reads as a broken
                    row, and the plant asked about it for that reason.

                    A breakdown is the machine's own fault and stays in the
                    denominator, which is why M1 shows its full time and M2
                    beside it shows none. Saying so is the difference between
                    a figure that looks wrong and one that explains itself.
                  */}
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {m.plannedMin > 0 ? fmtMin(m.plannedMin) : (
                      <span title={t('live.externalLossHelp')}>
                        <span className="text-muted-foreground/60">{t('live.outsideDenominator')}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs">{fmtMin(m.runMin)}</TableCell>
                  <TableCell className="text-right text-xs text-red-400">{fmtMin(m.downMin)}</TableCell>
                  <TableCell className="text-right"><LivePct v={m.availability} /></TableCell>
                  <TableCell className="text-right"><LivePct v={m.oee} good={70} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <p className="text-[11px] text-muted-foreground flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{t('live.noTimeFilter')}</Badge>
          {t('live.noTimeFilterHelp')}
        </p>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <LiveHeader
        title={t('live.productionTitle')}
        subtitle={t('live.productionSubtitle')}
        icon={Factory}
        data={data}
        scope={scope}
      />
      {body()}
    </div>
  );
}
