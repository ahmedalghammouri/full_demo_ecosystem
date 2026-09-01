import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import type { OeeScope } from './oee-standard.service';
import { oeeIdentityOf } from '../../common/oee-identity.util';

export type LineMethod = 'ROLLUP' | 'BOTTLENECK';
export type ScopeLevel = 'MACHINE' | 'LINE' | 'AREA' | 'FACTORY';

/** What one aggregate over a scope looks like, whichever engine produced it. */
export interface Aggregate {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
}

/** A closure bound to one engine and one window. The rule below is engine-agnostic. */
export type AggregateFn = (scope: OeeScope) => Promise<Aggregate>;

export interface LineConfig {
  lineId: string;
  lineName: string;
  lineCode: string;
  areaId: string | null;
  areaName: string | null;
  /** The method actually used, after the request override and any fallback. */
  method: LineMethod;
  /** What the line itself is set to, kept so the page can say when it was overridden. */
  configured: LineMethod;
  bottleneckId: string | null;
  bottleneckName: string | null;
  outfeedIds: string[];
  outfeedNames: string[];
  outfeedResolvedBy: 'CONFIGURED' | 'ALL_MACHINES_ON_LINE';
  machineCount: number;
  /** Set when BOTTLENECK was asked for and could not be honoured. */
  fallbackReason: string | null;
}

export interface LineResult extends LineConfig, Aggregate {
  oee: number | null;
  /** Minutes this line contributes when an area or a factory averages its lines. */
  weightMin: number;
}

export interface HierarchyOee extends Aggregate {
  applies: boolean;
  level: ScopeLevel;
  requested: LineMethod | null;
  oee: number | null;
  lines: LineResult[];
  formula: string;
  note: string;
}

const clamp = (n: number | null): number | null =>
  n == null ? null : Math.max(0, Math.min(100, n));
const r1 = (n: number | null): number | null => (n == null ? null : Math.round(n * 10) / 10);

const productOf = (a: number | null, p: number | null, q: number | null): number | null =>
  a == null || p == null || q == null ? null : oeeIdentityOf(a, p, q);

/**
 * What a LINE, an AREA or the FACTORY scored — as opposed to what its machines did.
 *
 * ── The question this answers ───────────────────────────────────────────────
 * A line runs at the speed of its constraint, so a line's OEE is not a property
 * of its machines taken together. Averaging four machines that each ran 80% does
 * not tell you the line ran 80%: three of them were waiting on the fourth, and
 * their idle time was not a loss they caused. `ProductionLine` already carries
 * the plant's answer — which method, which machine is the constraint, where
 * saleable units are counted — and the first engine already honours it in
 * `KpiService.lineOeeFromJos`. The two newer engines did not, so the same line
 * had a defined OEE on one page and an undefined one on the next.
 *
 * This is that rule for the minute stores. It is deliberately engine-agnostic:
 * it never touches a table, it asks for aggregates through `AggregateFn`, so the
 * standard engine, the schedule engine and the live screen share ONE definition
 * of what a line scored rather than three that drift.
 *
 * ── BOTTLENECK ─────────────────────────────────────────────────────────────
 *   Line OEE = Bottleneck Availability × Bottleneck Performance × Line Quality
 *
 * Availability and Performance come from the constraint alone, with all of its
 * time and all of its stops, planned and unplanned — that is what "the line runs
 * at the speed of its constraint" means arithmetically.
 *
 * The QUANTITIES do not follow the time. Good and theoretical are counted at the
 * line's last station — the final routing step among the configured outfeed
 * points — because that is where saleable units actually leave, and counting
 * them anywhere upstream counts material that has not been made into product
 * yet. Scrap is summed across EVERY machine, because a unit binned at the filler
 * is a real loss to the line even though the last station never saw it. So:
 *
 *   Line Quality = Last-station good ÷ (Last-station good + scrap everywhere)
 *
 * Both sides are in pieces, the common rung the packaging ladder converts to, so
 * the ratio compares like with like and is reported in pieces for the same reason.
 *
 * The consequence to know about: over a SHORT window the last station may not
 * have output anything yet — material still sitting in the buffers between
 * stations — and Quality then reads 0.0% on a line that is plainly working. That
 * is a true statement about saleable output in that window, not an error, and
 * the live screen says so in words rather than leaving the reader to guess.
 * Widening the window to the whole shift is what makes it meaningful again.
 *
 * ── ROLLUP ─────────────────────────────────────────────────────────────────
 * The line re-derived from the summed minutes and counts of all its machines —
 * NOT an average of their percentages. Averaging percentages weights a machine
 * that ran ten minutes the same as one that ran ten hours. The engines already
 * do this when asked for a line-scoped total, so ROLLUP is simply that total.
 *
 * ── AREA and FACTORY ───────────────────────────────────────────────────────
 * Above a line there is no common quantity basis to re-derive from: a line on
 * the bottleneck method reports its constraint's minutes, and adding those to
 * another line's roll-up minutes would sum two different things. So an area
 * averages its LINES, weighted by how long each line was actually occupied.
 * Weighted, because an unweighted mean lets a line that ran for twenty minutes
 * pull the plant down as hard as one that ran all shift.
 */
@Injectable()
export class LineBasisService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which level the scope sits at.
   *
   * A single machine has no line basis to choose — it IS the thing being
   * measured — which is why the control is hidden there rather than shown and
   * ignored.
   */
  levelOf(scope: OeeScope): ScopeLevel {
    if (scope.machineId) return 'MACHINE';
    if (scope.lineId) return 'LINE';
    if (scope.areaId) return 'AREA';
    return 'FACTORY';
  }

  /** Every line inside the scope, with the config the plant set on it. */
  async linesInScope(
    factoryId: string | null,
    scope: OeeScope,
    requested: LineMethod | null,
  ): Promise<LineConfig[]> {
    const lines = await this.prisma.productionLine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        isActive: true,
        ...(scope.lineId ? { id: scope.lineId } : {}),
        ...(scope.areaId ? { areaId: scope.areaId } : {}),
      },
      select: {
        id: true, name: true, code: true, areaId: true,
        oeeMethod: true, bottleneckMachineId: true, outfeedMachineIds: true,
        area: { select: { name: true } },
        machines: {
          where: { isActive: true, archivedAt: null },
          select: { id: true, name: true, code: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return lines
      .filter((l) => l.machines.length > 0)
      .map((l) => {
        const configured: LineMethod = l.oeeMethod === 'BOTTLENECK' ? 'BOTTLENECK' : 'ROLLUP';
        // The request decides the METHOD; the line still decides which machine is
        // the constraint and where units are counted. Those are facts about the
        // plant, not a view preference, and a screen has no business overriding
        // them.
        const wanted: LineMethod = requested ?? configured;

        const bottleneck = l.machines.find((m) => m.id === l.bottleneckMachineId) ?? null;
        const configuredOutfeeds = l.machines.filter((m) =>
          (l.outfeedMachineIds ?? []).includes(m.id));
        // An empty list means the whole line is the outfeed — the same convention
        // the schema documents and the form offers as "use all machines".
        const outfeeds = configuredOutfeeds.length > 0 ? configuredOutfeeds : l.machines;

        const canBottleneck = wanted === 'BOTTLENECK' && bottleneck != null;
        return {
          lineId: l.id,
          lineName: l.name,
          lineCode: l.code,
          areaId: l.areaId,
          areaName: l.area?.name ?? null,
          method: canBottleneck ? 'BOTTLENECK' as const : 'ROLLUP' as const,
          configured,
          bottleneckId: bottleneck?.id ?? null,
          bottleneckName: bottleneck?.name ?? null,
          outfeedIds: outfeeds.map((m) => m.id),
          outfeedNames: outfeeds.map((m) => m.name),
          outfeedResolvedBy: (configuredOutfeeds.length > 0
            ? 'CONFIGURED' : 'ALL_MACHINES_ON_LINE') as LineConfig['outfeedResolvedBy'],
          machineCount: l.machines.length,
          // Stated rather than silently swallowed: a line showing a roll-up when
          // the reader chose the bottleneck method has to say why.
          fallbackReason: wanted === 'BOTTLENECK' && !bottleneck
            ? 'No bottleneck machine is nominated on this line, so it cannot be measured by its '
              + 'constraint. Set one in Edit Production Line.'
            : null,
        };
      });
  }

  /** One line's score, on its own method. */
  async lineResult(cfg: LineConfig, agg: AggregateFn, scope: OeeScope): Promise<LineResult> {
    const lineScope: OeeScope = {
      ...scope, lineId: cfg.lineId, areaId: undefined, machineId: undefined, machineIds: undefined,
    };

    if (cfg.method === 'ROLLUP') {
      const whole = await agg(lineScope);
      return {
        ...cfg, ...whole,
        oee: r1(productOf(whole.availability, whole.performance, whole.quality)),
        weightMin: topMin(whole.time),
      };
    }

    const [bn, outfeed, whole] = await Promise.all([
      agg({ ...lineScope, machineId: cfg.bottleneckId ?? undefined }),
      agg({ ...lineScope, machineIds: cfg.outfeedIds }),
      agg(lineScope),
    ]);

    // Good where saleable units leave the line; scrap from every machine,
    // because it is a loss to the line wherever it happened.
    const good = outfeed.counts.good;
    const rejected = whole.counts.rejected;
    const total = good + rejected;
    const quality = total > 0 ? clamp((good / total) * 100) : null;

    const availability = clamp(bn.availability);
    const performance = clamp(bn.performance);

    return {
      ...cfg,
      // The constraint's time IS the line's time under this method — its stops,
      // planned and unplanned, are what the line was subject to.
      time: bn.time,
      availability: r1(availability),
      performance: r1(performance),
      quality: r1(quality),
      oee: r1(productOf(availability, performance, quality)),
      counts: {
        good, rejected, total,
        // Theoretical follows GOOD, not the time: it is the ceiling for the
        // units being counted, so it has to be the ceiling of the station that
        // counted them. Taking it from the constraint while taking good from the
        // last station would divide one machine's output by another machine's
        // capacity.
        theoretical: outfeed.counts.theoretical,
      },
      weightMin: topMin(whole.time),
    };
  }

  /**
   * The scope's own score: one line, or the weighted average of several.
   *
   * Returns `applies: false` for a single machine, so a caller can show the
   * engine's own figures unchanged rather than inventing a line basis for
   * something that is not a line.
   */
  async forScope(
    factoryId: string | null,
    scope: OeeScope,
    requested: LineMethod | null,
    agg: AggregateFn,
    fallback: Aggregate,
  ): Promise<HierarchyOee> {
    const level = this.levelOf(scope);
    const base = {
      level, requested,
      lines: [] as LineResult[],
      ...fallback,
      oee: r1(productOf(fallback.availability, fallback.performance, fallback.quality)),
    };

    if (level === 'MACHINE') {
      return {
        ...base, applies: false,
        formula: 'OEE = A × P × Q for this machine',
        note: 'A single machine has no line basis — it is the thing being measured.',
      };
    }

    const configs = await this.linesInScope(factoryId, scope, requested);
    if (configs.length === 0) {
      return {
        ...base, applies: false,
        formula: 'OEE = A × P × Q',
        note: 'No production line with active machines is in scope, so the figures are the '
          + "engine's own aggregate.",
      };
    }

    const lines = await Promise.all(configs.map((c) => this.lineResult(c, agg, scope)));

    if (level === 'LINE' || lines.length === 1) {
      const l = lines[0];
      return {
        applies: true, level, requested, lines,
        availability: l.availability, performance: l.performance, quality: l.quality,
        oee: l.oee, time: l.time, counts: l.counts,
        formula: l.method === 'BOTTLENECK'
          ? 'Line OEE = Bottleneck Availability × Bottleneck Performance × Line Quality'
          : 'Line OEE = A × P × Q, re-derived from the summed minutes and counts of every '
            + 'machine (not an average of their percentages)',
        note: l.method === 'BOTTLENECK'
          ? `Availability, Performance and all of the time come from ${l.bottleneckName} alone. `
            + 'Good and theoretical are counted at the line’s last station, and scrap at every '
            + `machine on the line, both in pieces.`
          : `Every one of the ${l.machineCount} machines contributes its own minutes and counts.`,
      };
    }

    // ── Above a line ────────────────────────────────────────────────────────
    // Weighted by occupancy, because the lines below may be on different methods
    // and therefore have no common quantity basis to re-derive from.
    const weight = lines.reduce((a, l) => a + Math.max(0, l.weightMin), 0);
    const mean = (pick: (l: LineResult) => number | null): number | null => {
      const usable = lines.filter((l) => pick(l) != null && l.weightMin > 0);
      if (usable.length === 0) return null;
      const w = usable.reduce((a, l) => a + l.weightMin, 0);
      if (w <= 0) return null;
      return usable.reduce((a, l) => a + (pick(l) as number) * l.weightMin, 0) / w;
    };

    const availability = r1(mean((l) => l.availability));
    const performance = r1(mean((l) => l.performance));
    const quality = r1(mean((l) => l.quality));
    const label = level === 'AREA' ? 'Area' : 'Factory';

    return {
      applies: true, level, requested, lines,
      availability, performance, quality,
      oee: r1(productOf(availability, performance, quality)),
      // Time and counts stay ADDITIVE — minutes and pieces sum across lines even
      // when the percentages cannot, and a table that shows them has to add up.
      time: sumTimes(lines.map((l) => l.time)),
      counts: {
        good: lines.reduce((a, l) => a + l.counts.good, 0),
        rejected: lines.reduce((a, l) => a + l.counts.rejected, 0),
        total: lines.reduce((a, l) => a + l.counts.total, 0),
        theoretical: lines.reduce((a, l) => a + l.counts.theoretical, 0),
      },
      formula: `${label} OEE = A × P × Q, each averaged across its lines and weighted by how `
        + 'long each line was occupied',
      note: `${lines.length} lines, ${Math.round(weight)} line-minutes in total. Each line was `
        + 'scored on its own method first — ' + lines.map((l) => `${l.lineCode}: ${l.method}`).join(', ')
        + ' — because a line on the bottleneck method reports its constraint’s minutes, and '
        + 'those cannot be added to another line’s roll-up minutes.',
    };
  }
}

/** The top bar, whichever engine produced it. See the note in use-live-shift.ts. */
const topMin = (time: Record<string, number> | undefined): number =>
  time?.totalMin ?? time?.committedMin ?? 0;

function sumTimes(all: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of all) {
    for (const [k, v] of Object.entries(t ?? {})) {
      out[k] = (out[k] ?? 0) + (Number.isFinite(v) ? v : 0);
    }
  }
  return out;
}
