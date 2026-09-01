import { Injectable } from '@nestjs/common';
import { oeeIdentityOf } from '../../common/oee-identity.util';

export interface OEEInput {
  plannedProductionTime: number; // minutes
  downtime: number; // minutes
  idealCycleTime: number; // minutes per unit
  totalCount: number;
  goodCount: number;
}

export interface OEEResult {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  actualRunTime: number;
}

/**
 * Six-big-losses input (ISO 22400). `plannedProductionTime` must already EXCLUDE
 * planned stops (breaks, cleaning, planned maintenance). Only unplanned losses
 * are passed in here.
 */
export interface OEEDetailedInput {
  plannedProductionTime: number; // PPT, minutes (already net of planned stops)
  unplannedDowntime: number;     // minutes — availability loss owned by THIS machine (breakdown, setup)
  /**
   * External / process-constraint minutes (STARVED, BLOCKED). Removed from PPT before
   * A and P are derived, so a machine idled by an upstream or downstream constraint is
   * not penalised for it — see EXTERNAL_LOSS_STATES.
   */
  externalLoss?: number;
  microStopMinutes?: number;     // minutes — informational performance-loss bucket
  idealCycleTime: number;        // minutes per unit
  totalCount: number;
  goodCount: number;
}

export interface OEEBreakdown {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // raw minutes — carried so parents can roll up consistently
  ppt: number;            // planned production time, NET of external loss
  runTime: number;        // ppt − unplanned downtime
  idealRunTime: number;   // idealCycleTime × totalCount (the "earned" run minutes)
  externalLoss: number;   // starved + blocked minutes removed from PPT
  totalCount: number;
  goodCount: number;
  losses: {
    availabilityLossMin: number;
    performanceLossMin: number;
    qualityLossMin: number;
    /** Reported separately — it is a line-balance loss, not a machine loss. */
    externalLossMin: number;
  };
}

/** A child contribution for a weighted roll-up (JO→WO→PO, Machine→Line→Area→Plant). */
export interface RollupChild {
  ppt: number;          // planned production minutes (gross; external loss removed during rollup)
  runTime: number;      // running minutes
  idealRunTime: number; // idealCycleTime × totalCount minutes
  externalLoss?: number; // starved / blocked minutes inside this child's window
  totalCount: number;
  goodCount: number;
}

/** Machine-state segment (shape of MachineStateRecord) for time-based availability. */
export interface StateSegment {
  state: string;            // RUNNING | IDLE | PLANNED_STOP | BREAKDOWN | SETUP | CHANGEOVER | STARVED | BLOCKED | OFFLINE | MAINTENANCE
  durationMinutes: number;
  isPlannedStop?: boolean;
}

const PLANNED_STATES = new Set(['PLANNED_STOP', 'MAINTENANCE']);
const RUNNING_STATES = new Set(['RUNNING']);

/**
 * External / process-constraint states. A machine that is STARVED (no product from
 * upstream) or BLOCKED (downstream cannot accept output) is healthy and available —
 * the constraint belongs to the line, not to the asset. ISO 22400 treats these as
 * external losses, so they are removed from Planned Production Time before
 * Availability and Performance are derived; otherwise a downstream machine such as
 * a palletizer shows a low OEE purely because it waits on the bottleneck.
 *
 * They remain visible as `losses.externalLossMin` — excluded, never hidden.
 */
export const EXTERNAL_LOSS_STATES = new Set(['STARVED', 'BLOCKED']);

const round1 = (n: number) => Math.round(n * 10) / 10;
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

@Injectable()
export class OEEService {
  calculate(input: OEEInput): OEEResult {
    const { plannedProductionTime, downtime, idealCycleTime, totalCount, goodCount } = input;

    const actualRunTime = plannedProductionTime - downtime;

    // Availability = Actual Run Time / Planned Production Time
    const availability = plannedProductionTime > 0
      ? (actualRunTime / plannedProductionTime) * 100
      : 0;

    // Performance = (Ideal Cycle Time × Total Count) / Actual Run Time
    const performance = actualRunTime > 0
      ? ((idealCycleTime * totalCount) / actualRunTime) * 100
      : 0;

    // Quality = Good Count / Total Count
    const quality = totalCount > 0 ? (goodCount / totalCount) * 100 : 0;

    // OEE = Availability × Performance × Quality
    const oee = oeeIdentityOf(availability, performance, quality);

    return {
      oee: Math.min(Math.round(oee * 10) / 10, 100),
      availability: Math.min(Math.round(availability * 10) / 10, 100),
      performance: Math.min(Math.round(performance * 10) / 10, 100),
      quality: Math.min(Math.round(quality * 10) / 10, 100),
      actualRunTime,
    };
  }

  /**
   * Standards-based OEE from six-loss inputs. Returns percentages AND the raw
   * minute quantities so the same result can be fed into `rollup`.
   */
  calculateDetailed(input: OEEDetailedInput): OEEBreakdown {
    const grossPpt = Math.max(0, input.plannedProductionTime);
    // External constraints (starved/blocked) are carved out of PPT first — the machine
    // is not accountable for time it was ready but the line could not feed or drain it.
    const externalLoss = Math.min(grossPpt, Math.max(0, input.externalLoss ?? 0));
    const ppt = Math.max(0, grossPpt - externalLoss);
    const runTime = Math.max(0, ppt - Math.max(0, input.unplannedDowntime));
    const idealRunTime = Math.max(0, input.idealCycleTime * input.totalCount);

    const availability = ppt > 0 ? clampPct((runTime / ppt) * 100) : 0;
    const performance = runTime > 0 ? clampPct((idealRunTime / runTime) * 100) : 0;
    const quality = input.totalCount > 0 ? clampPct((input.goodCount / input.totalCount) * 100) : 0;
    const oee = oeeIdentityOf(availability, performance, quality);

    return {
      oee: round1(oee),
      availability: round1(availability),
      performance: round1(performance),
      quality: round1(quality),
      ppt,
      runTime,
      idealRunTime,
      externalLoss: round1(externalLoss),
      totalCount: input.totalCount,
      goodCount: input.goodCount,
      losses: {
        availabilityLossMin: round1(ppt - runTime),
        performanceLossMin: round1(Math.max(0, runTime - idealRunTime)),
        qualityLossMin: round1(input.totalCount > 0 ? (input.idealCycleTime * (input.totalCount - input.goodCount)) : 0),
        externalLossMin: round1(externalLoss),
      },
    };
  }

  /**
   * Time-segmented availability from MachineStateRecord-shaped rows.
   * Planned stops are excluded from PPT (not counted as loss). Availability =
   * running minutes / PPT.
   */
  availabilityFromSegments(segments: StateSegment[]): {
    ppt: number; runTime: number; plannedDowntime: number; unplannedDowntime: number;
    externalLoss: number; availability: number;
  } {
    let scheduled = 0, planned = 0, run = 0, external = 0;
    for (const s of segments) {
      const d = s.durationMinutes ?? 0;
      scheduled += d;
      const isPlanned = s.isPlannedStop || PLANNED_STATES.has(s.state);
      if (isPlanned) planned += d;
      else if (EXTERNAL_LOSS_STATES.has(s.state)) external += d;
      else if (RUNNING_STATES.has(s.state)) run += d;
    }
    // PPT excludes planned stops AND external constraints; what remains is the time
    // this machine was genuinely accountable for.
    const ppt = Math.max(0, scheduled - planned - external);
    const unplanned = Math.max(0, ppt - run);
    return {
      ppt: round1(ppt),
      runTime: round1(run),
      plannedDowntime: round1(planned),
      unplannedDowntime: round1(unplanned),
      externalLoss: round1(external),
      availability: ppt > 0 ? round1(clampPct((run / ppt) * 100)) : 0,
    };
  }

  /**
   * Bottleneck-based OVERALL LINE OEE.
   *
   *   Line OEE = Bottleneck Availability × Bottleneck Performance × Final Outfeed Quality
   *
   * A packaging line runs at the speed of its constraint. Averaging or rolling up the
   * OEE of every machine misrepresents the line: downstream assets (palletizer,
   * wrapper) idle by design whenever the bottleneck is down, so their individual
   * numbers say nothing about line output. This method therefore takes A and P from
   * the nominated bottleneck only, and Q from the FINAL outfeed — the last point where
   * a saleable unit is counted — so every downstream reject (checkweigher, cartoner,
   * palletizer, wrapper) is captured exactly once and never double-counted.
   */
  lineOee(input: {
    /** A and P source — the constraint machine (e.g. Powder Filler). */
    bottleneck: { availability: number; performance: number; machineId?: string; machineName?: string };
    /** Q source — units counted at the line's last outfeed point. */
    finalOutfeed: { totalCount: number; goodCount: number; pointName?: string };
  }): {
    oee: number; availability: number; performance: number; quality: number;
    basis: {
      method: 'BOTTLENECK';
      bottleneckMachineId?: string; bottleneckMachineName?: string;
      outfeedPointName?: string; outfeedTotal: number; outfeedGood: number;
    };
  } {
    const availability = clampPct(input.bottleneck.availability ?? 0);
    const performance = clampPct(input.bottleneck.performance ?? 0);
    const total = Math.max(0, input.finalOutfeed.totalCount ?? 0);
    const good = Math.max(0, Math.min(total, input.finalOutfeed.goodCount ?? 0));
    const quality = total > 0 ? clampPct((good / total) * 100) : 0;
    const oee = oeeIdentityOf(availability, performance, quality);

    return {
      oee: round1(oee),
      availability: round1(availability),
      performance: round1(performance),
      quality: round1(quality),
      basis: {
        method: 'BOTTLENECK',
        bottleneckMachineId: input.bottleneck.machineId,
        bottleneckMachineName: input.bottleneck.machineName,
        outfeedPointName: input.finalOutfeed.pointName,
        outfeedTotal: total,
        outfeedGood: good,
      },
    };
  }

  /**
   * Consistent ISO roll-up: sums the underlying minute/count quantities of the
   * children and recomputes A/P/Q from the totals (NOT a naive average of
   * percentages). The single primitive for JO→WO→PO and Machine→Line→Area→Plant.
   */
  rollup(children: RollupChild[]): OEEBreakdown {
    const sum = children.reduce<{
      ppt: number; runTime: number; idealRunTime: number;
      externalLoss: number; totalCount: number; goodCount: number;
    }>(
      (a, c) => ({
        ppt: a.ppt + Math.max(0, c.ppt || 0),
        runTime: a.runTime + Math.max(0, c.runTime || 0),
        idealRunTime: a.idealRunTime + Math.max(0, c.idealRunTime || 0),
        externalLoss: a.externalLoss + Math.max(0, c.externalLoss || 0),
        totalCount: a.totalCount + Math.max(0, c.totalCount || 0),
        goodCount: a.goodCount + Math.max(0, c.goodCount || 0),
      }),
      { ppt: 0, runTime: 0, idealRunTime: 0, externalLoss: 0, totalCount: 0, goodCount: 0 },
    );

    // Children carry GROSS ppt; calculateDetailed nets the external loss out once, so
    // the parent's A/P are derived on the same accountable time base as each child.
    const netPpt = Math.max(0, sum.ppt - sum.externalLoss);
    return this.calculateDetailed({
      plannedProductionTime: sum.ppt,
      externalLoss: sum.externalLoss,
      unplannedDowntime: Math.max(0, netPpt - sum.runTime),
      idealCycleTime: sum.totalCount > 0 ? sum.idealRunTime / sum.totalCount : 0,
      totalCount: sum.totalCount,
      goodCount: sum.goodCount,
    });
  }

  getClassification(oee: number): 'world-class' | 'good' | 'acceptable' | 'poor' {
    if (oee >= 85) return 'world-class';
    if (oee >= 65) return 'good';
    if (oee >= 45) return 'acceptable';
    return 'poor';
  }
}
