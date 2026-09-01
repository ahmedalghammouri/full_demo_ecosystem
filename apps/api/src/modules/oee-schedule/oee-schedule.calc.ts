/**
 * The same time model, measured against the slot that was PROMISED.
 *
 * `oee-standard` divides by the time that went by. This divides by the time the
 * order was committed to:
 *
 *   committedFrom = min(plannedStart, actualStart)
 *   committedTo   = actualEnd == null ? max(now, plannedEnd)
 *                                     : max(actualEnd, plannedEnd)
 *
 * Everything below Operational time is identical — the same measured minutes,
 * classified the same way. Only the top of the model moves, and two kinds of
 * time appear that the standard engine has no room for:
 *
 *   not started      the slot was open and the machine had not begun
 *   not yet reached  the slot is still open and the order has not got there
 *
 * Both are slot minutes that produced nothing, so both are losses here and
 * neither exists there. That is the whole difference, and it is why the two
 * engines are not supposed to agree: one asks how well the equipment ran, the
 * other how much of a promise was kept.
 *
 * ── What this basis does to a reading, said plainly ─────────────────────────
 * An order one minute into an eight-hour slot has used one minute of four
 * hundred and eighty, so it reads near zero and climbs all day. That is not a
 * fault to be smoothed away — it is what "of the time we promised, how much have
 * we delivered" means at 08:01. Read it at the end of the slot, or read the
 * standard engine instead.
 */

import { oeeIdentityOf } from '../../common/oee-identity.util';

/** Summed primitives. Minutes except the counts. */
export interface ScheduleTotals {
  /** The committed slot, clipped to the query window. The denominator. */
  committedMin: number;
  /** Minutes that actually elapsed with the order on the machine. */
  elapsedMin: number;
  /** Slot minutes before the order started. */
  notStartedMin: number;
  plannedStopMin: number;
  availabilityLossMin: number;
  externalLossMin: number;
  unmeasuredMin: number;
  operatingMin: number;
  goodParts: number;
  rejectedParts: number;
  theoreticalParts: number;
}

export const EMPTY_SCHEDULE_TOTALS: ScheduleTotals = {
  committedMin: 0, elapsedMin: 0, notStartedMin: 0, plannedStopMin: 0,
  availabilityLossMin: 0, externalLossMin: 0, unmeasuredMin: 0, operatingMin: 0,
  goodParts: 0, rejectedParts: 0, theoreticalParts: 0,
};

export interface TimeModelBar {
  key: string;
  minutes: number;
  pct: number;
  kind: 'base' | 'loss' | 'result';
}

export interface ScheduleResult {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  teep: number | null;
  utilization: number | null;
  /** How much of the committed slot has gone by. 100% once the slot has passed. */
  slotElapsedPct: number | null;
  totals: ScheduleTotals;
  time: {
    committedMin: number;
    notStartedMin: number;
    notYetReachedMin: number;
    plannedStopMin: number;
    externalLossMin: number;
    unmeasuredMin: number;
    operationalMin: number;
    availabilityLossMin: number;
    netProductionMin: number;
    performanceLossMin: number;
    microstopLossMin: number;
    netOperationalMin: number;
    qualityLossMin: number;
    usedOperationalMin: number;
  };
  counts: { good: number; rejected: number; total: number; theoretical: number };
  bars: TimeModelBar[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function ratio(num: number, den: number): number | null {
  if (!(den > 0)) return null;
  return (num / den) * 100;
}

export function computeSchedule(t: ScheduleTotals, opts: { cap?: boolean } = {}): ScheduleResult {
  const cap = opts.cap !== false;
  const clamp = (n: number | null) => (n == null ? null : cap ? Math.min(100, n) : n);

  const committedMin = t.committedMin;

  // Slot minutes with no order on the machine. Exact by construction: the rows
  // only exist inside the slot, so elapsed can never exceed committed.
  const slotNotWorked = Math.max(0, committedMin - t.elapsedMin);
  // Whatever is not at the front is at the back — either the order finished
  // early inside its slot, or the slot has not been reached yet.
  const notStartedMin = Math.min(t.notStartedMin, slotNotWorked);
  const notYetReachedMin = Math.max(0, slotNotWorked - notStartedMin);

  // Planned stops and external loss leave the denominator for the same reasons
  // they do in the standard engine: the first was never ours to produce in, the
  // second belongs to the line rather than to this machine. Unmeasured leaves
  // because silence is not evidence in either direction.
  const operationalMin = Math.max(
    0,
    committedMin - t.plannedStopMin - t.externalLossMin - t.unmeasuredMin,
  );
  const netProductionMin = t.operatingMin;

  /**
   * Has anything actually been observed in this window?
   *
   * ── The defect this closes ──────────────────────────────────────────────
   * The committed slot runs to the END of the promise, so a bucket covering an
   * hour that has not begun still has a real `operationalMin`. Dividing zero
   * running minutes by it gives Availability = 0% for an hour nothing has
   * happened in — and on the trend chart that drew a line along the floor from
   * now until the end of the day, which reads as a breakdown that never
   * happened.
   *
   * Performance and Quality already declined to answer there, because their
   * denominators are genuinely zero. Availability was the odd one out,
   * asserting a measurement from an absence. This makes the three agree: no
   * elapsed minutes, no factors.
   *
   * The committed minutes are still reported in full, so the time model and the
   * trend still sum to the headline — the slot is charged, it just is not
   * described as 0% available.
   */
  const observed = t.elapsedMin > 0;
  const availability = observed ? clamp(ratio(netProductionMin, operationalMin)) : null;
  const totalParts = t.goodParts + t.rejectedParts;
  const performance = clamp(ratio(totalParts, t.theoreticalParts));
  const quality = clamp(ratio(t.goodParts, totalParts));

  const netOperationalMin = performance != null ? netProductionMin * (performance / 100) : netProductionMin;
  const performanceLossMin = Math.max(0, netProductionMin - netOperationalMin);
  const usedOperationalMin = quality != null ? netOperationalMin * (quality / 100) : netOperationalMin;
  const qualityLossMin = Math.max(0, netOperationalMin - usedOperationalMin);

  const oee =
    availability != null && performance != null && quality != null
      ? oeeIdentityOf(availability, performance, quality)
      : null;

  const utilization = ratio(operationalMin, committedMin);
  const teep = oee != null && utilization != null ? (oee / 100) * utilization : null;
  // How far through the promise we are. Printed beside OEE because a low figure
  // early in a slot means "not yet", and a low figure at 100% elapsed means
  // "missed" — the same number, two different conversations.
  const slotElapsedPct = ratio(t.elapsedMin, committedMin);

  const pct = (m: number) => (committedMin > 0 ? r2((m / committedMin) * 100) : 0);
  const bar = (key: string, minutes: number, kind: TimeModelBar['kind']): TimeModelBar => ({
    key, minutes: r1(minutes), pct: pct(minutes), kind,
  });

  return {
    availability: availability == null ? null : r1(availability),
    performance: performance == null ? null : r1(performance),
    quality: quality == null ? null : r1(quality),
    oee: oee == null ? null : r1(oee),
    teep: teep == null ? null : r1(teep),
    utilization: utilization == null ? null : r1(utilization),
    slotElapsedPct: slotElapsedPct == null ? null : r1(slotElapsedPct),
    totals: t,
    time: {
      committedMin: r1(committedMin),
      notStartedMin: r1(notStartedMin),
      notYetReachedMin: r1(notYetReachedMin),
      plannedStopMin: r1(t.plannedStopMin),
      externalLossMin: r1(t.externalLossMin),
      unmeasuredMin: r1(t.unmeasuredMin),
      operationalMin: r1(operationalMin),
      availabilityLossMin: r1(t.availabilityLossMin),
      netProductionMin: r1(netProductionMin),
      performanceLossMin: r1(performanceLossMin),
      microstopLossMin: 0,
      netOperationalMin: r1(netOperationalMin),
      qualityLossMin: r1(qualityLossMin),
      usedOperationalMin: r1(usedOperationalMin),
    },
    counts: {
      good: r1(t.goodParts),
      rejected: r1(t.rejectedParts),
      total: r1(totalParts),
      theoretical: r1(t.theoreticalParts),
    },
    bars: [
      bar('committedTime', committedMin, 'base'),
      bar('plannedStops', t.plannedStopMin, 'loss'),
      bar('externalLoss', t.externalLossMin, 'loss'),
      bar('unmeasured', t.unmeasuredMin, 'loss'),
      bar('operationalTime', operationalMin, 'base'),
      bar('notStarted', notStartedMin, 'loss'),
      bar('notYetReached', notYetReachedMin, 'loss'),
      bar('availabilityLosses', t.availabilityLossMin, 'loss'),
      bar('netProductionTime', netProductionMin, 'base'),
      bar('performanceLosses', performanceLossMin, 'loss'),
      bar('microstopLosses', 0, 'loss'),
      bar('netOperationalTime', netOperationalMin, 'base'),
      bar('qualityLosses', qualityLossMin, 'loss'),
      bar('usedOperationalTime', usedOperationalMin, 'result'),
    ],
  };
}

/**
 * Does the slot add up?
 *
 * Two identities. The first says the committed slot is fully accounted for; the
 * second says Operational time really is the three losses plus what ran. Checked
 * rather than assumed for the same reason as in the standard engine — minutes
 * that go missing here raise no error, they raise Availability.
 */
export function auditSchedule(t: ScheduleTotals): {
  ok: boolean;
  bucketsMin: number;
  bucketDriftMin: number;
  identityDriftMin: number;
} {
  const slotNotWorked = Math.max(0, t.committedMin - t.elapsedMin);
  const buckets =
    slotNotWorked + t.plannedStopMin + t.externalLossMin + t.unmeasuredMin +
    t.availabilityLossMin + t.operatingMin;
  const bucketDrift = t.committedMin - buckets;

  const operationalMin = Math.max(
    0,
    t.committedMin - t.plannedStopMin - t.externalLossMin - t.unmeasuredMin,
  );
  const identityDrift = operationalMin - t.availabilityLossMin - t.operatingMin - slotNotWorked;

  const TOL = 0.1;
  return {
    ok: Math.abs(bucketDrift) <= TOL && Math.abs(identityDrift) <= TOL,
    bucketsMin: r1(buckets),
    bucketDriftMin: r1(bucketDrift),
    identityDriftMin: r1(identityDrift),
  };
}

/**
 * The committed slot for one job order, as the writer stamps it on every row.
 *
 * Written exactly as the plant stated it, including the `max`/`min` pairs — the
 * point of those is that neither the plan nor the actual alone bounds the slot.
 * A job order that starts before its planned start still opens the slot early;
 * one that runs past its planned end still holds it open.
 */
export function committedSlot(
  jo: { plannedStart: Date | null; plannedEnd: Date | null; actualStart: Date | null; actualEnd: Date | null },
  now: Date,
): { from: Date; to: Date } | null {
  const starts = [jo.plannedStart, jo.actualStart].filter((d): d is Date => d != null);
  if (starts.length === 0) return null; // nothing anchors the slot

  const from = new Date(Math.min(...starts.map((d) => d.getTime())));
  const openEnd = jo.actualEnd ?? now;
  const to = new Date(Math.max(openEnd.getTime(), jo.plannedEnd?.getTime() ?? openEnd.getTime()));

  // A slot that ends before it starts is not a slot. Returning null rather than
  // a negative span keeps the nonsense out of the aggregate instead of letting
  // it cancel some other order's minutes.
  return to > from ? { from, to } : null;
}
