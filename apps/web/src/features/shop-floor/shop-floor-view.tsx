'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import {
  Play, Pause, CheckSquare, RefreshCw, Factory, Timer,
  Cpu, Layers, Package, Box, Boxes, User, Check, X,
  AlertCircle, ClipboardList, ArrowDownCircle, GitBranch,
  GitMerge, Shuffle, ChevronRight, BarChart2, TrendingUp,
  Clock, Zap, Wrench, BellRing, AlertTriangle, Activity,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import {
  MaintenanceRequestDialog, MachineStateDialog, AlarmDialog,
  type JOActionTarget,
} from './shop-floor-actions';
import { JobFilterBar } from './job-filter-bar';
import { JobShiftBand } from './shift-summary-band';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type JOStatus = 'SCHEDULED' | 'READY' | 'EXECUTING' | 'PAUSED' | 'COMPLETE' | 'CANCELLED';
type DepType  = 'FINISH_TO_START' | 'START_TO_START' | 'START_TO_FINISH' | 'FINISH_TO_FINISH' | null;

interface Operator { id: string; name: string; nameAr?: string }
interface ShopFloorJO {
  id: string;
  sequenceOrder: number;
  operationName: string;
  status: JOStatus;
  depType: DepType;
  plannedQtyOut?: number;
  outputUnit?: string;
  actualQtyGood: number;
  actualQtyRejected: number;
  handoverQty?: number;
  scrapReason?: string;
  operatorId?: string;
  operator?: Operator;
  actualStart?: string;
  actualEnd?: string;
  workOrder?: {
    id: string;
    orderNumber: string;
    sku?: { name: string; code: string };
    productionOrder?: { id: string; orderNumber: string };
  };
  machine?: { id?: string; name: string; code: string };
  workCenter?: { id?: string; name: string; code: string };
  predecessor?: { id: string; operationName: string; status: JOStatus };
  joQuality?: number;
  joPerformance?: number;
  joAvailability?: number;
  joOEE?: number;
  joAvailabilityTimeBased?: number;
  joOEETimeBased?: number;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const JO_STATUS: Record<JOStatus, { labelKey: string; color: string; dot: string; border: string }> = {
  SCHEDULED: { labelKey: 'sfv.status.SCHEDULED', color: 'text-slate-400  bg-slate-400/10  border-slate-400/30',  dot: 'bg-slate-400',   border: 'border-l-slate-500/40'  },
  READY:     { labelKey: 'sfv.status.READY',     color: 'text-blue-400   bg-blue-400/10   border-blue-400/30',   dot: 'bg-blue-400',    border: 'border-l-blue-500'      },
  EXECUTING: { labelKey: 'sfv.status.EXECUTING', color: 'text-green-400  bg-green-400/10  border-green-400/30',  dot: 'bg-green-400',   border: 'border-l-green-500'     },
  PAUSED:    { labelKey: 'sfv.status.PAUSED',    color: 'text-amber-400  bg-amber-400/10  border-amber-400/30',  dot: 'bg-amber-400',   border: 'border-l-amber-500'     },
  COMPLETE:  { labelKey: 'sfv.status.COMPLETE',  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', dot: 'bg-emerald-400', border: 'border-l-emerald-500' },
  CANCELLED: { labelKey: 'sfv.status.CANCELLED', color: 'text-red-400    bg-red-400/10    border-red-400/30',    dot: 'bg-red-400',     border: 'border-l-red-500/40'    },
};

const DEP_BADGE: Record<string, { short: string; color: string }> = {
  FINISH_TO_START:  { short: 'FS', color: 'text-slate-400  bg-slate-400/10  border-slate-400/20'  },
  START_TO_START:   { short: 'SS', color: 'text-cyan-400   bg-cyan-400/10   border-cyan-400/20'   },
  START_TO_FINISH:  { short: 'SF', color: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  FINISH_TO_FINISH: { short: 'FF', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
};

const UNIT_BADGE: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PIECE:  { label: 'PCS', color: 'text-sky-400    bg-sky-400/10    border-sky-400/20',    icon: <Package className="w-3 h-3" /> },
  CARTON: { label: 'CTN', color: 'text-amber-400  bg-amber-400/10  border-amber-400/20',  icon: <Box     className="w-3 h-3" /> },
  PALLET: { label: 'PLT', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20', icon: <Boxes   className="w-3 h-3" /> },
};

const VALID_NEXT: Record<JOStatus, JOStatus[]> = {
  SCHEDULED: ['CANCELLED'],
  READY:     ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['PAUSED', 'COMPLETE', 'CANCELLED'],
  PAUSED:    ['EXECUTING', 'CANCELLED'],
  COMPLETE:  [],
  CANCELLED: [],
};

const STATUS_FILTERS = [
  { value: 'ACTIVE',     labelKey: 'sfv.filter.active' },
  { value: 'ALL',        labelKey: 'sfv.filter.all' },
  { value: 'READY',      labelKey: 'sfv.status.READY' },
  { value: 'EXECUTING',  labelKey: 'sfv.status.EXECUTING' },
  { value: 'PAUSED',     labelKey: 'sfv.status.PAUSED' },
  { value: 'COMPLETE',   labelKey: 'sfv.status.COMPLETE' },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: JOStatus }) {
  const { t } = useTranslation('production');
  const c = JO_STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.color}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot} ${status === 'EXECUTING' ? 'animate-pulse' : ''}`} />
      {t(c.labelKey)}
    </span>
  );
}

function UnitTag({ unit }: { unit?: string }) {
  if (!unit) return null;
  const cfg = UNIT_BADGE[unit];
  if (!cfg) return <span className="text-xs text-muted-foreground">{unit}</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function DepTag({ type }: { type: DepType }) {
  if (!type) return null;
  const d = DEP_BADGE[type];
  if (!d) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold tracking-wider ${d.color}`}>
      {d.short}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Live elapsed timer hook
// ─────────────────────────────────────────────────────────────

function useElapsed(jo: ShopFloorJO) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (jo.status !== 'EXECUTING') {
      if (jo.actualStart && jo.actualEnd) {
        setElapsed(Math.floor(
          (new Date(jo.actualEnd).getTime() - new Date(jo.actualStart).getTime()) / 1000,
        ));
      } else if (jo.status === 'PAUSED' && jo.actualStart) {
        setElapsed(Math.floor((Date.now() - new Date(jo.actualStart).getTime()) / 1000));
      }
      return;
    }
    const start = jo.actualStart ? new Date(jo.actualStart).getTime() : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [jo.status, jo.actualStart, jo.actualEnd]);

  return elapsed;
}

// ─────────────────────────────────────────────────────────────
// Shop Floor Card
// ─────────────────────────────────────────────────────────────

function ShopFloorCard({
  jo, users, pending,
  onTransition, onRecord, onCorrect, onAssignOperator,
  onOpenLive, onAction, shiftStatus, machineShift,
}: {
  jo: ShopFloorJO;
  users: Operator[];
  pending: boolean;
  onTransition: (id: string, status: JOStatus, qty?: number) => void;
  onRecord: (id: string, rec: { goodDelta: number; scrapDelta: number; reason: string; category?: string; handoverQty?: number }) => void;
  onCorrect: (id: string, rec: { actualQtyGood: number; actualQtyRejected: number; reason: string; category?: string }) => void;
  onAssignOperator: (id: string, operatorId: string | null) => void;
  onOpenLive: (jo: ShopFloorJO) => void;
  onAction: (kind: 'maintenance' | 'state' | 'alarm', jo: ShopFloorJO) => void;
  shiftStatus?: any;
  machineShift?: any;
}) {
  const { t } = useTranslation('production');
  // Incremental entry — each save ADDS to the running totals (never replaces).
  // `countMode='set'` instead CORRECTS the absolute totals (fixes a mis-count).
  const [countMode, setCountMode] = useState<'add' | 'set'>('add');
  const [addGood,      setAddGood]      = useState('');
  const [addScrap,     setAddScrap]     = useState('');
  const [scrapReason,  setScrapReason]  = useState('');
  const [scrapCategory, setScrapCategory] = useState('QUALITY');
  const [handoverInput, setHandoverInput] = useState('');
  const [showHandover, setShowHandover] = useState(false);
  const [showAssign, setShowAssign]  = useState(false);
  const elapsed = useElapsed(jo);

  const progress = (jo.plannedQtyOut ?? 0) > 0
    ? Math.min(100, Math.round((jo.actualQtyGood / (jo.plannedQtyOut ?? 1)) * 100))
    : 0;

  const next     = VALID_NEXT[jo.status] ?? [];
  const canLog   = ['EXECUTING', 'PAUSED'].includes(jo.status);
  const statusCfg = JO_STATUS[jo.status];

  return (
    <div className={`glass-card rounded-2xl overflow-hidden flex flex-col border-l-4 ${statusCfg.border}`}>

      {/* ── Card header (click → live dashboard) ── */}
      <div
        className="px-5 py-4 flex items-start justify-between gap-3 cursor-pointer hover:bg-brand-500/5 transition-colors"
        onClick={() => onOpenLive(jo)}
        title={t('sfv.openLiveDashboard')}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <DepTag type={jo.depType} />
            <span className="text-xs text-muted-foreground font-mono">#{jo.sequenceOrder}</span>
            {jo.workOrder && (
              <span className="text-xs text-brand-400/70 font-mono">{jo.workOrder.orderNumber}</span>
            )}
            <Activity className="w-3 h-3 text-brand-400/50 ml-auto" />
          </div>
          <h3 className="text-xl font-bold tracking-wide truncate">{jo.operationName}</h3>
          <div className="flex items-center gap-2 flex-wrap mt-1 text-sm text-muted-foreground">
            {(jo.machine || jo.workCenter) && (
              <span className="flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5" />
                {jo.machine?.name ?? jo.workCenter?.name}
              </span>
            )}
            {jo.workOrder?.sku && (
              <span className="flex items-center gap-1 text-xs">
                <ChevronRight className="w-3 h-3" />
                {jo.workOrder.sku.name}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusPill status={jo.status} />
          {(jo.status === 'EXECUTING' || (jo.status === 'PAUSED' && elapsed > 0)) && (
            <span className={`flex items-center gap-1 font-mono text-sm font-semibold
              ${jo.status === 'EXECUTING' ? 'text-green-400' : 'text-amber-400'}`}>
              <Timer className="w-3.5 h-3.5" />
              {fmtElapsed(elapsed)}
            </span>
          )}
        </div>
      </div>

      {/* ── OEE mini row ── */}
      {(jo.joOEE != null || jo.joQuality != null) && (
        <div className="px-5 pb-2 flex items-center gap-2 flex-wrap">
          {jo.joQuality != null && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-green-400 bg-green-400/10 border-green-400/30 tabular-nums">
              Q: {jo.joQuality.toFixed(1)}%
            </span>
          )}
          {jo.joPerformance != null && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-blue-400 bg-blue-400/10 border-blue-400/30 tabular-nums">
              P: {jo.joPerformance.toFixed(1)}%
            </span>
          )}
          {jo.joAvailability != null && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-yellow-400 bg-yellow-400/10 border-yellow-400/30 tabular-nums" title={t('sfv.availSchedTooltip')}>
              A: {jo.joAvailability.toFixed(1)}%
            </span>
          )}
          {jo.joAvailabilityTimeBased != null && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-dashed text-yellow-400 bg-yellow-400/10 border-yellow-400/30 tabular-nums" title={t('sfv.availTbTooltip')}>
              A·T: {jo.joAvailabilityTimeBased.toFixed(1)}%
            </span>
          )}
          {jo.joOEE != null && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${
              jo.joOEE >= 85
                ? 'text-green-400 bg-green-400/10 border-green-400/30'
                : jo.joOEE >= 60
                ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
                : 'text-red-400 bg-red-400/10 border-red-400/30'
            }`} title={t('sfv.oeeSchedTooltip')}>
              OEE: {jo.joOEE.toFixed(1)}%
            </span>
          )}
          {jo.joOEETimeBased != null && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border border-dashed tabular-nums ${
              jo.joOEETimeBased >= 85
                ? 'text-green-400 bg-green-400/10 border-green-400/30'
                : jo.joOEETimeBased >= 60
                ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
                : 'text-red-400 bg-red-400/10 border-red-400/30'
            }`} title={t('sfv.oeeTbTooltip')}>
              OEE·T: {jo.joOEETimeBased.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {/* ── Progress bar ── */}
      {(jo.plannedQtyOut ?? 0) > 0 && (
        <div className="px-5 pb-3 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('sfv.target')} <span className="text-foreground font-semibold">{jo.plannedQtyOut}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">
                {jo.actualQtyGood}
                {jo.actualQtyRejected > 0 && (
                  <span className="text-red-400/80 text-xs ml-1">+{jo.actualQtyRejected}✗</span>
                )}
                <span className="text-muted-foreground font-normal"> / {jo.plannedQtyOut}</span>
              </span>
              <UnitTag unit={jo.outputUnit} />
              <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{progress}%</span>
            </div>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500
                ${jo.status === 'COMPLETE' ? 'bg-emerald-500' : jo.status === 'EXECUTING' ? 'bg-green-500' : 'bg-brand-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Smart pace / ETA while running */}
          {jo.status === 'EXECUTING' && elapsed > 5 && jo.actualQtyGood > 0 && (() => {
            const pacePerHr = Math.round(jo.actualQtyGood / (elapsed / 3600));
            const remaining = Math.max(0, (jo.plannedQtyOut ?? 0) - jo.actualQtyGood);
            const etaH = pacePerHr > 0 ? remaining / pacePerHr : null;
            return (
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-brand-400" /> {t('sfv.paceLabel', { pace: pacePerHr.toLocaleString() })}</span>
                {etaH != null && remaining > 0 && (
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {t('sfv.etaLabel', { eta: etaH < 1 ? `${Math.round(etaH * 60)}m` : `${etaH.toFixed(1)}h` })}</span>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Per-JO shift band (this shift, this job order's data) ── */}
      {shiftStatus?.active && (
        <div className="px-5 pb-3">
          <JobShiftBand status={shiftStatus} machine={machineShift} machineName={jo.machine?.name} />
        </div>
      )}

      {/* ── Operator row ── */}
      <div className="px-5 py-2.5 border-t border-border/20 flex items-center gap-2">
        <User className="w-4 h-4 text-muted-foreground/60 shrink-0" />
        {showAssign ? (
          <div className="flex items-center gap-2 flex-1">
            <select
              autoFocus
              defaultValue={jo.operatorId ?? ''}
              onChange={(e) => {
                onAssignOperator(jo.id, e.target.value || null);
                setShowAssign(false);
              }}
              onBlur={() => setShowAssign(false)}
              className="flex-1 text-sm bg-background/80 border border-brand-400/40 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-400"
            >
              <option value="">{t('sfv.unassignOperator')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <button onClick={() => setShowAssign(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : jo.operator ? (
          <button
            onClick={() => setShowAssign(true)}
            className="text-sm text-foreground hover:text-brand-400 transition-colors flex-1 text-left"
          >
            {jo.operator.name}
            <span className="text-xs text-muted-foreground/50 ml-2">{t('sfv.tapToChange')}</span>
          </button>
        ) : (
          <button
            onClick={() => setShowAssign(true)}
            className="text-sm text-muted-foreground/50 hover:text-brand-400 transition-colors flex-1 text-left italic"
          >
            {t('sfv.tapToAssignOperator')}
          </button>
        )}
      </div>

      {/* ── Smart incremental count (EXECUTING or PAUSED) ── */}
      {canLog && (() => {
        const isSet = countMode === 'set';
        const gd = parseInt(addGood, 10) || 0;
        const sd = parseInt(addScrap, 10) || 0;
        // In 'set' mode the inputs are the ABSOLUTE totals; in 'add' they are deltas.
        // Floored the same way the server floors them, so the preview cannot
        // promise a total the save will not produce.
        const newGood = Math.max(0, isSet ? gd : jo.actualQtyGood + gd);
        const newRejected = Math.max(0, isSet ? sd : jo.actualQtyRejected + sd);
        const newTotal = newGood + newRejected;
        const newQuality = newTotal > 0 ? (newGood / newTotal) * 100 : 100;
        const nothing = isSet ? (addGood === '' && addScrap === '') : (gd === 0 && sd === 0 && !showHandover);
        const toSet = (m: 'add' | 'set') => {
          setCountMode(m);
          if (m === 'set') { setAddGood(String(jo.actualQtyGood)); setAddScrap(String(jo.actualQtyRejected)); }
          else { setAddGood(''); setAddScrap(''); }
        };
        const submit = () => {
          if (isSet) {
            onCorrect(jo.id, { actualQtyGood: gd, actualQtyRejected: sd, reason: scrapReason, category: scrapCategory });
          } else {
            onRecord(jo.id, {
              goodDelta: gd, scrapDelta: sd, reason: scrapReason, category: scrapCategory,
              ...(showHandover && handoverInput !== '' ? { handoverQty: parseInt(handoverInput, 10) || 0 } : {}),
            });
          }
          setAddGood(''); setAddScrap(''); setScrapReason(''); setCountMode('add');
        };
        return (
          <div className="px-5 py-4 border-t border-border/20 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5" />{t('sfv.recordProduction')}
              </p>
              {/* Running totals (read-only) */}
              <span className="text-[10px] text-muted-foreground flex items-center gap-2 tabular-nums">
                <span className="text-green-400">✓{jo.actualQtyGood}</span>
                <span className="text-red-400">✗{jo.actualQtyRejected}</span>
                <span className="text-brand-400" title={t('sfv.handoverToNext')}>→{jo.handoverQty ?? 0}</span>
              </span>
            </div>

            {/* Add (increment) vs Correct (set absolute totals) */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/40 text-xs font-semibold">
              <button onClick={() => toSet('add')} className={`h-7 rounded-md transition ${!isSet ? 'bg-brand-500 text-white' : 'text-muted-foreground'}`}>{t('sfv.addMode', { defaultValue: 'Add (+)' })}</button>
              <button onClick={() => toSet('set')} className={`h-7 rounded-md transition ${isSet ? 'bg-brand-500 text-white' : 'text-muted-foreground'}`}>{t('sfv.correctMode', { defaultValue: 'Correct total' })}</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Add Good */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-green-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />{isSet ? t('sfv.goodTotal', { defaultValue: 'Good (total)' }) : t('sfv.addGood')}
                </label>
                {/* A total is floored at zero; a delta may be negative, which is
                    how a mis-entered count is taken back. */}
                <input
                  type="number" inputMode="numeric" min={isSet ? 0 : undefined}
                  value={addGood}
                  onChange={(e) => setAddGood(e.target.value)}
                  placeholder="+0"
                  className="w-full h-14 text-2xl font-bold text-center tabular-nums bg-green-500/5 border border-green-500/20 rounded-xl focus:outline-none focus:border-green-400 text-green-400 placeholder:text-green-400/20"
                />
              </div>
              {/* Add Bad / Scrap */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-red-400 flex items-center gap-1">
                  <X className="w-3.5 h-3.5" />{isSet ? t('sfv.rejectTotal', { defaultValue: 'Rejected (total)' }) : t('sfv.addBadScrap')}
                </label>
                <input
                  type="number" inputMode="numeric" min={isSet ? 0 : undefined}
                  value={addScrap}
                  onChange={(e) => setAddScrap(e.target.value)}
                  placeholder="+0"
                  className="w-full h-14 text-2xl font-bold text-center tabular-nums bg-red-500/5 border border-red-500/20 rounded-xl focus:outline-none focus:border-red-400 text-red-400 placeholder:text-red-400/20"
                />
              </div>
            </div>

            {/* Live preview of new totals + quality impact */}
            {(gd > 0 || sd > 0) && (
              <div className="flex items-center justify-between text-[10px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-1.5">
                <span>{t('sfv.newTotals')} <span className="text-green-400 font-semibold tabular-nums">{newGood}</span> {t('sfv.goodLower')} · <span className="text-red-400 font-semibold tabular-nums">{newRejected}</span> {t('sfv.badLower')}</span>
                <span>{t('sfv.qualityArrow')} <span className={`font-bold tabular-nums ${newQuality >= 95 ? 'text-green-400' : newQuality >= 85 ? 'text-amber-400' : 'text-red-400'}`}>{newQuality.toFixed(1)}%</span></span>
              </div>
            )}

            {/* Scrap reason + category (only when adding bad qty) */}
            {sd > 0 && (
              <div className="space-y-2">
                <select
                  value={scrapCategory}
                  onChange={(e) => setScrapCategory(e.target.value)}
                  className="w-full h-11 px-3 text-sm bg-red-500/5 border border-red-500/20 rounded-xl focus:outline-none focus:border-red-400 text-red-300"
                >
                  {['QUALITY','SETUP','DAMAGE','OVERRUN','MATERIAL','MACHINE','OPERATOR','OTHER'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder={t('sfv.rejectReasonPlaceholder')}
                  value={scrapReason}
                  onChange={(e) => setScrapReason(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-red-500/5 border border-red-500/20 rounded-xl focus:outline-none focus:border-red-400 placeholder:text-muted-foreground/40"
                />
              </div>
            )}

            {/* Handover qty control */}
            {showHandover ? (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-brand-400 flex items-center gap-1 shrink-0">
                  <ArrowDownCircle className="w-3.5 h-3.5" />{t('sfv.handover')}
                </label>
                <input
                  type="number" inputMode="numeric" min={0}
                  value={handoverInput}
                  onChange={(e) => setHandoverInput(e.target.value)}
                  placeholder={String(jo.handoverQty ?? 0)}
                  className="flex-1 h-10 px-3 text-sm text-center tabular-nums bg-brand-500/5 border border-brand-400/30 rounded-xl focus:outline-none focus:border-brand-400 text-brand-400"
                />
                <button onClick={() => { setShowHandover(false); setHandoverInput(''); }} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setShowHandover(true); setHandoverInput(String(jo.handoverQty ?? '')); }}
                className="text-[11px] text-brand-400/80 hover:text-brand-400 flex items-center gap-1"
              >
                <ArrowDownCircle className="w-3.5 h-3.5" />{t('sfv.setHandoverQty')}
              </button>
            )}

            <button
              disabled={pending || nothing}
              onClick={submit}
              className="w-full h-12 rounded-xl bg-brand-500/20 hover:bg-brand-500/30 border border-brand-400/40 text-brand-400 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition-colors"
            >
              <TrendingUp className="w-4 h-4" />
              {t('sfv.record')} {gd > 0 && t('sfv.plusGood', { count: gd })}{gd > 0 && sd > 0 && ' · '}{sd > 0 && t('sfv.plusBad', { count: sd })}
            </button>
          </div>
        );
      })()}

      {/* ── Operator quick actions: live page · maintenance · stop/state · alarm ── */}
      <div className="px-5 py-2 border-t border-border/20 flex items-center gap-1.5 mt-auto">
        <button
          onClick={() => onOpenLive(jo)}
          className="flex-1 h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-400/30 text-brand-400 transition-colors"
          title={t('sfv.liveDashboardTooltip')}
        >
          <Activity className="w-3.5 h-3.5" />{t('sfv.live')}
        </button>
        <button
          onClick={() => onAction('maintenance', jo)}
          disabled={!jo.machine}
          className="flex-1 h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 text-amber-400 transition-colors disabled:opacity-30"
          title={t('sfv.requestMaintTooltip')}
        >
          <Wrench className="w-3.5 h-3.5" />{t('sfv.maint')}
        </button>
        <button
          onClick={() => onAction('state', jo)}
          disabled={!jo.machine}
          className="flex-1 h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-400/30 text-orange-400 transition-colors disabled:opacity-30"
          title={t('sfv.changeStateTooltip')}
        >
          <AlertTriangle className="w-3.5 h-3.5" />{t('sfv.stop')}
        </button>
        <button
          onClick={() => onAction('alarm', jo)}
          className="flex-1 h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 text-red-400 transition-colors"
          title={t('sfv.raiseAlarmTooltip')}
        >
          <BellRing className="w-3.5 h-3.5" />{t('sfv.alarm')}
        </button>
      </div>

      {/* ── Action buttons ── */}
      <div className="px-5 py-4 border-t border-border/20 flex gap-3">
        {jo.status === 'READY' && (
          <button
            disabled={pending}
            onClick={() => onTransition(jo.id, 'EXECUTING')}
            className="flex-1 h-14 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 transition-colors shadow-lg shadow-green-500/20"
          >
            <Play className="w-5 h-5 fill-current" />{t('sfv.start')}
          </button>
        )}

        {jo.status === 'EXECUTING' && (
          <>
            <button
              disabled={pending}
              onClick={() => onTransition(jo.id, 'PAUSED')}
              className="h-14 px-6 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 font-semibold flex items-center justify-center gap-2 disabled:opacity-40 transition-colors"
            >
              <Pause className="w-5 h-5" />
            </button>
            <button
              disabled={pending}
              onClick={() => onTransition(
                jo.id, 'COMPLETE',
                jo.actualQtyGood || jo.plannedQtyOut || 0,
              )}
              className="flex-1 h-14 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 transition-colors shadow-lg shadow-emerald-500/20"
            >
              <CheckSquare className="w-5 h-5" />{t('sfv.complete')}
            </button>
          </>
        )}

        {jo.status === 'PAUSED' && (
          <>
            <button
              disabled={pending}
              onClick={() => onTransition(jo.id, 'EXECUTING')}
              className="flex-1 h-14 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 transition-colors shadow-lg shadow-blue-500/20"
            >
              <Play className="w-5 h-5 fill-current" />{t('sfv.resume')}
            </button>
            <button
              disabled={pending}
              onClick={() => onTransition(
                jo.id, 'COMPLETE',
                jo.actualQtyGood || jo.plannedQtyOut || 0,
              )}
              className="flex-1 h-14 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 transition-colors shadow-lg shadow-emerald-500/20"
            >
              <CheckSquare className="w-5 h-5" />{t('sfv.complete')}
            </button>
          </>
        )}

        {jo.status === 'COMPLETE' && (
          <div className="flex-1 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold text-base flex items-center justify-center gap-2">
            <CheckSquare className="w-5 h-5" />{t('sfv.completedWith', { qty: jo.actualQtyGood, unit: jo.outputUnit ?? '' })}
          </div>
        )}

        {jo.status === 'SCHEDULED' && (
          <div className="flex-1 h-14 rounded-xl bg-muted/50 border border-border/30 text-muted-foreground font-medium text-sm flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {t('sfv.waitingForPredecessor', { op: jo.predecessor?.operationName ?? '—' })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// KPI bar
// ─────────────────────────────────────────────────────────────

function KpiBar({ jobs }: { jobs: ShopFloorJO[] }) {
  const { t } = useTranslation('production');
  const executing = jobs.filter((j) => j.status === 'EXECUTING').length;
  const ready     = jobs.filter((j) => j.status === 'READY').length;
  const paused    = jobs.filter((j) => j.status === 'PAUSED').length;
  const complete  = jobs.filter((j) => j.status === 'COMPLETE').length;

  const totalGood  = jobs.reduce((s, j) => s + j.actualQtyGood, 0);
  const totalScrap = jobs.reduce((s, j) => s + j.actualQtyRejected, 0);

  return (
    <div className="flex items-center gap-4 flex-wrap text-sm">
      {executing > 0 && (
        <span className="flex items-center gap-1.5 text-green-400 font-semibold">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {t('sfv.kpiExecuting', { count: executing })}
        </span>
      )}
      {ready > 0 && (
        <span className="flex items-center gap-1.5 text-blue-400">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          {t('sfv.kpiReady', { count: ready })}
        </span>
      )}
      {paused > 0 && (
        <span className="flex items-center gap-1.5 text-amber-400">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          {t('sfv.kpiPaused', { count: paused })}
        </span>
      )}
      {complete > 0 && (
        <span className="flex items-center gap-1.5 text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          {t('sfv.kpiDone', { count: complete })}
        </span>
      )}
      {(totalGood + totalScrap) > 0 && (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span className="text-green-400 font-mono">{totalGood} ✓</span>
          {totalScrap > 0 && <span className="text-red-400 font-mono">{totalScrap} ✗</span>}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function ShopFloorView() {
  const { t } = useTranslation('production');
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  // ── Smart filters: machines (multi) · production order · work order ──
  const [machineSel, setMachineSel] = useState<string[]>([]);
  const [poSel, setPoSel] = useState('');
  const [woSel, setWoSel] = useState('');

  // ── Action dialogs (maintenance / state / alarm) ──
  const [actionKind, setActionKind] = useState<'maintenance' | 'state' | 'alarm' | null>(null);
  const [actionTarget, setActionTarget] = useState<JOActionTarget | null>(null);

  const QK = ['shop-floor-jobs', statusFilter] as const;

  const { data: rawData, isLoading, dataUpdatedAt } = useQuery({
    queryKey: QK,
    queryFn: () => api.get('/production/job-orders'),
    refetchInterval: 10_000,
  });

  // Assignable users (role-scoped) — production roles can't call /users directly.
  const { data: usersData } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable'),
    staleTime: 300_000,
  });

  const { data: shiftAnalysis } = useQuery({
    queryKey: ['shift-analysis'],
    queryFn: () => api.get('/shifts/analysis'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const allJobs: ShopFloorJO[] = (rawData as any) ?? [];

  // Per-machine shift context (this shift) keyed by machineId → drives each card's shift band
  const shiftA: any = shiftAnalysis;
  const machineShiftMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const row of (shiftA?.machines ?? [])) m.set(row.id, row);
    return m;
  }, [shiftA]);
  const users: Operator[] = ((usersData as any) ?? []).map((u: any) => ({
    id: u.id, name: u.name, nameAr: u.nameAr,
  }));

  // ── Filter options derived from the live data (no mock lists) ──
  const machineOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string }>();
    for (const j of allJobs) {
      if (j.machine?.id) map.set(j.machine.id, { id: j.machine.id, name: j.machine.name, code: j.machine.code });
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [allJobs]);

  const poOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of allJobs) {
      const po = j.workOrder?.productionOrder;
      if (po?.id) map.set(po.id, po.orderNumber);
    }
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [allJobs]);

  const woOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of allJobs) {
      // Respect the PO filter so the WO list narrows intelligently
      if (poSel && j.workOrder?.productionOrder?.id !== poSel) continue;
      if (j.workOrder?.id) map.set(j.workOrder.id, j.workOrder.orderNumber);
    }
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [allJobs, poSel]);

  const hasFilters = machineSel.length > 0 || !!poSel || !!woSel;

  const filteredJobs = useMemo(() => {
    let jobs = allJobs;
    if (machineSel.length) jobs = jobs.filter((j) => j.machine?.id && machineSel.includes(j.machine.id));
    if (poSel) jobs = jobs.filter((j) => j.workOrder?.productionOrder?.id === poSel);
    if (woSel) jobs = jobs.filter((j) => j.workOrder?.id === woSel);
    if (statusFilter === 'ACTIVE') {
      return jobs.filter((j) => ['READY', 'EXECUTING', 'PAUSED'].includes(j.status));
    }
    if (statusFilter === 'ALL') return jobs;
    return jobs.filter((j) => j.status === statusFilter);
  }, [allJobs, statusFilter, machineSel, poSel, woSel]);

  const openLive = (jo: ShopFloorJO) => router.push(`/shop-floor/live/${jo.id}`);

  const openAction = (kind: 'maintenance' | 'state' | 'alarm', jo: ShopFloorJO) => {
    setActionTarget({
      jobOrderId: jo.id,
      workOrderId: jo.workOrder?.id,
      machineId: jo.machine?.id,
      machineName: jo.machine?.name,
      operationName: jo.operationName,
    });
    setActionKind(kind);
  };

  // Sort: EXECUTING first, then PAUSED, then READY, then others; within group by seq
  const sorted = useMemo(() => {
    const order: Record<string, number> = { EXECUTING: 0, PAUSED: 1, READY: 2, SCHEDULED: 3, COMPLETE: 4, CANCELLED: 5 };
    return [...filteredJobs].sort((a, b) => {
      const od = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      return od !== 0 ? od : a.sequenceOrder - b.sequenceOrder;
    });
  }, [filteredJobs]);

  // ── Pagination (keeps the grid manageable when there are many cards) ──
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [statusFilter, machineSel, poSel, woSel]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pagedJobs = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page],
  );

  const transitionMut = useMutation({
    mutationFn: ({ id, status, qty }: { id: string; status: JOStatus; qty?: number }) =>
      api.patch(`/production/job-orders/${id}/status`, {
        status,
        ...(qty !== undefined && { actualQtyGood: qty }),
      }),
    onSuccess: (_r, { status }) => {
      qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] });
      qc.invalidateQueries({ queryKey: ['job-orders'] });
      toast({ title: t('jo.toast.joArrow', { status }) });
    },
    onError: (e: any) => toast({
      variant: 'destructive',
      title: t('jo.toast.transitionFailed'),
      description: e?.response?.data?.message ?? t('jo.toast.depNotMet'),
    }),
  });

  const countMut = useMutation({
    mutationFn: ({ id, rec }: { id: string; rec: { goodDelta: number; scrapDelta: number; reason: string; category?: string; handoverQty?: number } }) =>
      api.patch(`/production/job-orders/${id}/add-count`, {
        goodDelta: rec.goodDelta,
        scrapDelta: rec.scrapDelta,
        scrapReason: rec.reason,
        scrapCategory: rec.category ?? 'OTHER',
        ...(rec.handoverQty !== undefined && { handoverQty: rec.handoverQty }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] });
      qc.invalidateQueries({ queryKey: ['job-orders'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['jo-live'] });
      toast({ title: t('sfv.toastRecorded') });
    },
    onError: (e: any) => toast({
      variant: 'destructive',
      title: t('sfv.toastFailedRecord'),
      description: e?.response?.data?.message,
    }),
  });

  // Correct the ABSOLUTE totals (fix a mis-count) — sets exact good/rejected.
  const correctMut = useMutation({
    mutationFn: ({ id, rec }: { id: string; rec: { actualQtyGood: number; actualQtyRejected: number; reason: string; category?: string } }) =>
      api.patch(`/production/job-orders/${id}/output`, {
        actualQtyGood: rec.actualQtyGood,
        actualQtyRejected: rec.actualQtyRejected,
        ...(rec.actualQtyRejected > 0 ? { scrapReason: rec.reason, scrapCategory: rec.category ?? 'OTHER' } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] });
      qc.invalidateQueries({ queryKey: ['job-orders'] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['jo-live'] });
      toast({ title: t('sfv.toastCorrected', { defaultValue: 'Count corrected' }) });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: t('sfv.toastFailedRecord'), description: e?.response?.data?.message }),
  });

  const operatorMut = useMutation({
    mutationFn: ({ id, operatorId }: { id: string; operatorId: string | null }) =>
      api.patch(`/production/job-orders/${id}/operator`, { operatorId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] }),
    onError: (e: any) => toast({
      variant: 'destructive',
      title: t('jo.toast.failedAssign'),
      description: e?.response?.data?.message,
    }),
  });

  const isPending = transitionMut.isPending || countMut.isPending || correctMut.isPending || operatorMut.isPending;

  const lastRefresh = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-background/90 backdrop-blur-lg border-b border-border/60 px-4 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between flex-wrap gap-3">
          {/* Brand + title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-500/20 border border-brand-400/30 flex items-center justify-center">
              <Factory className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-none">{t('sfv.title')}</h1>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t('sfv.realTimeExecution')} · {t('sfv.refreshLabel', { time: lastRefresh })}
              </p>
            </div>
          </div>

          {/* KPI + filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <KpiBar jobs={allJobs} />
          </div>

          {/* Filter tabs + refresh */}
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  statusFilter === f.value
                    ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'
                    : 'bg-muted text-muted-foreground hover:bg-muted/60'
                }`}
              >
                {t(f.labelKey)}
                {f.value === 'ACTIVE' && (
                  <span className="ml-1.5 opacity-60">
                    ({allJobs.filter((j) => ['READY', 'EXECUTING', 'PAUSED'].includes(j.status)).length})
                  </span>
                )}
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] })}
              disabled={isLoading}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
              {t('sfv.refresh')}
            </Button>
          </div>
        </div>

        {/* ── Smart filters: machines (multi) · PO · WO ── */}
        <div className="max-w-screen-2xl mx-auto mt-2.5">
          <JobFilterBar
            machines={machineOptions.map((m) => ({ ...m, count: allJobs.filter((j) => j.machine?.id === m.id).length }))}
            pos={poOptions}
            wos={woOptions}
            machineSel={machineSel}
            onMachineSel={setMachineSel}
            po={poSel}
            onPo={setPoSel}
            wo={woSel}
            onWo={setWoSel}
            right={
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="font-semibold text-foreground tabular-nums">{filteredJobs.length}</span>
                <span className="text-muted-foreground/60">{t('sfv.jobsCount', { count: allJobs.length })}</span>
              </span>
            }
          />
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="flex-1 p-4 max-w-screen-2xl mx-auto w-full space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shimmer h-80 rounded-2xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 glass-card rounded-2xl">
            <ClipboardList className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-base font-semibold text-muted-foreground">{t('sfv.noJobsToDisplay')}</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {statusFilter === 'ACTIVE'
                ? t('sfv.noActiveJobs')
                : t('sfv.generateToStart')}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pagedJobs.map((jo) => (
                <ShopFloorCard
                  key={jo.id}
                  jo={jo}
                  users={users}
                  pending={isPending}
                  onTransition={(id, status, qty) => transitionMut.mutate({ id, status, qty })}
                  onRecord={(id, rec) => countMut.mutate({ id, rec })}
                  onCorrect={(id, rec) => correctMut.mutate({ id, rec })}
                  onAssignOperator={(id, operatorId) => operatorMut.mutate({ id, operatorId })}
                  onOpenLive={openLive}
                  onAction={openAction}
                  shiftStatus={shiftA?.status}
                  machineShift={jo.machine?.id ? machineShiftMap.get(jo.machine.id) : undefined}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(1)}>« {t('sfv.first')}</Button>
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ {t('sfv.prev')}</Button>
                <span className="text-xs text-muted-foreground px-2 tabular-nums">
                  {t('sfv.page')} <span className="font-semibold text-foreground">{page}</span> / {totalPages}
                  <span className="text-muted-foreground/60 ml-2">{t('sfv.cardsCount', { count: sorted.length })}</span>
                </span>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>{t('sfv.next')} ›</Button>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(totalPages)}>{t('sfv.last')} »</Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Operator action dialogs ── */}
      <MaintenanceRequestDialog
        open={actionKind === 'maintenance'}
        onOpenChange={(v) => !v && setActionKind(null)}
        target={actionTarget}
      />
      <MachineStateDialog
        open={actionKind === 'state'}
        onOpenChange={(v) => !v && setActionKind(null)}
        target={actionTarget}
      />
      <AlarmDialog
        open={actionKind === 'alarm'}
        onOpenChange={(v) => !v && setActionKind(null)}
        target={actionTarget}
      />
    </div>
  );
}
