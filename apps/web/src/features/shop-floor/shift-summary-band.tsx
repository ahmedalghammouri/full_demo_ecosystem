'use client';

/**
 * Current-shift summary band — identity + time & output progress + quick stats.
 * Fed by GET /shifts/analysis. Shared by the Shop Floor (above the cards) and the
 * Live Dashboard (below the filters). `compact` drops the inline stat strip.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const fmtMins = (m: number | null | undefined) => {
  if (m == null) return '—';
  if (m < 1) return `${Math.round(m * 60)}s`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
};

/**
 * Per-job-order shift band — the CURRENT shift, but with THIS job order's data:
 * its production this shift vs the shift target converted to this step's own
 * output unit (base unit → outUnit via the product packaging). Used on each shop
 * floor card and on the live dashboard (below the filters).
 */
export function JobShiftBand({ status, machine, machineName }: { status: any; machine: any; machineName?: string }) {
  const { t: tr } = useTranslation('production');
  if (!status?.active) return null;
  const a = status.active;
  const timePct = Math.min(100, status.timeProgressPct ?? 0);
  const good = machine?.good ?? 0;
  const unit = machine?.unit ?? '';
  const target = machine?.shiftTarget ?? null;
  const outPct = machine?.shiftTargetPct ?? (target ? Math.round((good / target) * 1000) / 10 : null);
  const onTrack = outPct != null ? outPct >= timePct - 5 : true;
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold">
          <Clock className={`w-3.5 h-3.5 ${status.isActiveNow ? 'text-green-400' : 'text-muted-foreground'}`} />
          {a.name}
          <span className="text-muted-foreground/60 font-mono font-normal">{a.window}</span>
        </span>
        <span className="text-[10px] text-muted-foreground">{fmtMins(status.elapsedMin)} / {fmtMins(status.elapsedMin + status.remainingMin)}</span>
      </div>
      {/* Time progress */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-1.5">
        <div className="h-full rounded-full bg-brand-500/60" style={{ width: `${timePct}%` }} />
      </div>
      {/* This JO's shift output vs step target */}
      {target != null ? (
        <>
          <div className="flex items-center justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">{tr('sf.shiftOutput')} {good.toLocaleString()} / {target.toLocaleString()} {unit}</span>
            <span className={onTrack ? 'text-green-400' : 'text-amber-400'}>{onTrack ? tr('sf.onTrack') : tr('sf.behind')} · {outPct ?? 0}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${onTrack ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, outPct ?? 0)}%` }} />
          </div>
        </>
      ) : (
        <div className="text-[10px] text-muted-foreground">{tr('sf.shiftOutput')} {good.toLocaleString()} {unit}{machineName ? ` · ${machineName}` : ''}</div>
      )}
    </div>
  );
}

export function ShiftSummaryBand({ shift, compact }: { shift: any; compact?: boolean }) {
  const { t: tr } = useTranslation('production');
  if (!shift?.status?.active) return null;
  const s = shift.status;
  const a = s.active;
  const t = shift.totals;
  const timePct = Math.min(100, s.timeProgressPct ?? 0);
  const outPct = t?.targetProgressPct ?? null;
  const onTrack = outPct != null ? outPct >= timePct - 5 : true;
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-[180px]">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.isActiveNow ? 'bg-green-500/20 border border-green-400/30' : 'bg-muted border border-border'}`}>
            <Clock className={`w-5 h-5 ${s.isActiveNow ? 'text-green-400' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">{a.name}</span>
              <Badge variant={s.isActiveNow ? 'success' : 'secondary'} className="text-[10px]">{s.isActiveNow ? tr('sf.active') : tr('sf.idle')}</Badge>
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">{a.window} · {tr('sf.shiftsPerDay', { count: s.shiftsPerDay })}</div>
          </div>
        </div>
        <div className="flex-1 min-w-[260px] space-y-2">
          <div>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="text-muted-foreground">{tr('sf.shiftTimeElapsed', { time: fmtMins(s.elapsedMin) })}</span>
              <span className="text-muted-foreground">{tr('sf.leftSuffix', { time: fmtMins(s.remainingMin) })}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-brand-500/70" style={{ width: `${timePct}%` }} /></div>
          </div>
          {t?.target != null && (
            <div>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="text-muted-foreground">{tr('sf.finishedOutput')} {t.good.toLocaleString()} / {t.target.toLocaleString()} {t.unit ?? ''}{(t.inProcess ?? 0) > 0 ? tr('sf.inProcessSuffix', { count: t.inProcess.toLocaleString() }) : ''}</span>
                <span className={onTrack ? 'text-green-400' : 'text-amber-400'}>{onTrack ? tr('sf.onTrack') : tr('sf.behindPace')} · {outPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full ${onTrack ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, outPct ?? 0)}%` }} /></div>
            </div>
          )}
        </div>
        {!compact && t && (
          <div className="flex items-center divide-x divide-border/50 text-center">
            <div className="px-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr('sf.finished')} · {t.unit ?? tr('sf.base')}</div><div className="text-base font-bold tabular-nums text-green-400">{t.good.toLocaleString()}</div></div>
            {(t.inProcess ?? 0) > 0 && <div className="px-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr('sf.inProcess')}</div><div className="text-base font-bold tabular-nums text-sky-400">{t.inProcess.toLocaleString()}</div></div>}
            {t.scrap > 0 && <div className="px-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr('sf.scrap')}</div><div className="text-base font-bold tabular-nums text-red-400">{t.scrap.toLocaleString()}</div></div>}
            {t.quality != null && <div className="px-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr('sf.quality')}</div><div className="text-base font-bold tabular-nums">{t.quality}%</div></div>}
            <div className="px-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tr('sf.running')}</div><div className="text-base font-bold tabular-nums">{t.runningMachines}/{t.totalMachines}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}
