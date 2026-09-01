import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { activityLabel } from './activity-label';

import { PrismaService } from '../../database/prisma.service';
import {
  FALLBACK_VERDICTS, UNKNOWN_VERDICT, PRODUCING, merge, subtract, spanMinutes,
  type Span, type Verdict,
} from './minute-classification';
import { SCHEDULE_SOURCE } from './planned-stop-materializer.service';

/** How a segment is drawn and counted. Mirrors the classification the writers use. */
export type SegmentKind = 'running' | 'planned' | 'external' | 'downtime' | 'unmeasured';

export interface TimelineSegment {
  machineId: string;
  machineCode: string;
  state: string;
  kind: SegmentKind;
  from: Date;
  to: Date;
  minutes: number;
  /**
   * What this block IS, when the plant has a name for it.
   *
   * `state` is the machine's word — PLANNED_STOP — and on a schedule where
   * cleaning, a meal and a handover are all PLANNED_STOP, that word tells the
   * reader nothing: three different activities draw as one indistinguishable
   * blue band. The schedule already knows which is which, so the name travels
   * with the block. Absent for sensor records, which genuinely have only a
   * state.
   */
  label?: string;
}

export interface ProductionDetails {
  /** Episodes the plant would call a stop — one per state record, not per minute. */
  downtimeCount: number;
  downtimeMin: number;
  /** Named because the reference names it, and reported as zero because nothing measures it. */
  microstopCount: number;
  microstopMin: number;
  plannedStopCount: number;
  plannedStopMin: number;
  externalCount: number;
  externalMin: number;
  /** Mean time to repair — total downtime ÷ number of failures. Null with none. */
  mttrMin: number | null;
  /** Mean time between failures — total running time ÷ number of failures. */
  mtbfMin: number | null;
  runningMin: number;
}

/** One reason in the distribution: how long, how often, and how it spread. */
export interface ReasonSlice {
  key: string;
  label: string;
  kind: SegmentKind;
  minutes: number;
  occurrence: number;
  medianMin: number;
  averageMin: number;
  /** The states inside this category — the next level of the tree. */
  children?: ReasonSlice[];
}

export interface Distribution {
  occurrence: number;
  totalMin: number;
  medianMin: number;
  averageMin: number;
  reasons: ReasonSlice[];
}

/**
 * One row of the schedule-first breakdown.
 *
 * DISPLAY ONLY. Nothing here reaches an OEE figure, a fact row or a stored
 * minute — see {@link StateTimelineService.scheduleFirst}.
 */
export interface ScheduleFirstSlice {
  /** Stable key: the activity name for a booked block, the state otherwise. */
  key: string;
  label: string;
  kind: SegmentKind;
  /** Booked on the schedule, as opposed to reported by a sensor. */
  scheduled: boolean;
  /** Minutes this row owns once the schedule has taken its share. */
  minutes: number;
  /** What the machine reported under this state, before the schedule took any. */
  rawMin: number;
  /** rawMin − minutes: the part a booked stop had already claimed. */
  reclaimedMin: number;
}

export interface TimelineScope {
  machineId?: string;
  lineId?: string;
  areaId?: string;
}

/**
 * The machine-status timeline, and the episode counts that go with it.
 *
 * ── Why this reads state records rather than the minute stores ──────────────
 * A minute store answers "how much", and both engines already do that well. This
 * answers "when, and how many times", and those are episodes — a two-hour
 * breakdown is ONE downtime, not a hundred and twenty. Counting minutes and
 * calling the result a number of stops is the kind of arithmetic that makes a
 * Pareto chart meaningless.
 *
 * Classification is the same as the writers': the State Rules decide, with the
 * built-in table only as a fallback for a factory that has configured none. So a
 * segment drawn amber here is amber for the same reason the minute behind it was
 * charged to availability.
 */
@Injectable()
export class StateTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve every (machine, state) pair in one query.
   *
   * A rule for THIS machine beats the factory-wide rule, which beats the
   * built-in default. Loaded once for the window rather than per segment: a
   * shift can hold hundreds of segments and per-segment lookups turn a chart
   * into a query storm.
   */
  private async loadVerdicts(
    factoryId: string | null,
    machineIds: string[],
  ): Promise<(machineId: string, state: string) => Verdict> {
    let rows: Array<{ machineId: string | null; state: string; isDowntime: boolean; isPlanned: boolean; affectsOEE: boolean }> = [];
    try {
      rows = await this.prisma.machineStateRule.findMany({
        where: {
          isActive: true,
          ...(factoryId ? { factoryId } : {}),
          OR: [{ machineId: { in: machineIds } }, { machineId: null }],
        },
        select: { machineId: true, state: true, isDowntime: true, isPlanned: true, affectsOEE: true },
      });
    } catch {
      // A configuration read must never blank the chart.
      rows = [];
    }

    const specific = new Map<string, Verdict>();
    const factoryWide = new Map<string, Verdict>();
    for (const r of rows) {
      const v: Verdict = { isDowntime: r.isDowntime, isPlanned: r.isPlanned, affectsOEE: r.affectsOEE };
      if (r.machineId) specific.set(`${r.machineId}:${r.state}`, v);
      else factoryWide.set(r.state, v);
    }
    return (machineId, state) =>
      specific.get(`${machineId}:${state}`) ?? factoryWide.get(state) ?? FALLBACK_VERDICTS[state] ?? UNKNOWN_VERDICT;
  }

  private kindOf(state: string, v: Verdict): SegmentKind {
    if (PRODUCING.has(state)) return 'running';
    if (v.isDowntime && v.isPlanned) return 'planned';
    if (v.isDowntime && !v.affectsOEE) return 'external';
    return 'downtime';
  }

  /**
   * Segments overlapping [from, to), clipped to it.
   *
   * Clipped rather than filtered: a breakdown that began before the window is
   * still downtime inside it, and dropping it would leave a hole in the bar and
   * an undercount in the tally.
   */
  async segments(
    factoryId: string | null,
    from: Date,
    to: Date,
    scope: TimelineScope = {},
    limit = 4000,
  ): Promise<TimelineSegment[]> {
    const machineFilter: Prisma.Sql[] = [];
    if (scope.machineId) machineFilter.push(Prisma.sql`m.id = ${scope.machineId}`);
    if (scope.lineId) machineFilter.push(Prisma.sql`m."lineId" = ${scope.lineId}`);
    if (scope.areaId) {
      machineFilter.push(Prisma.sql`(m."areaId" = ${scope.areaId} OR m."lineId" IN (
        SELECT l2.id FROM production_lines l2 WHERE l2."areaId" = ${scope.areaId}))`);
    }
    if (factoryId) machineFilter.push(Prisma.sql`m."factoryId" = ${factoryId}`);
    const where = machineFilter.length
      ? Prisma.sql`AND ${Prisma.join(machineFilter, ' AND ')}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{
      machineId: string; machineCode: string; state: string; from: Date; to: Date; source: string; notes: string | null;
    }>>(Prisma.sql`
      SELECT r."machineId", m.code AS "machineCode", r.state::text AS state, r.source, r.notes,
             GREATEST(r."startTime", ${from}) AS "from",
             LEAST(COALESCE(r."endTime", ${to}), ${to}) AS "to"
      FROM machine_state_records r
      JOIN machines m ON m.id = r."machineId"
      WHERE r."startTime" < ${to}
        AND (r."endTime" IS NULL OR r."endTime" > ${from})
        ${where}
      ORDER BY r."machineId", r."startTime"
      LIMIT ${limit}
    `);
    if (rows.length === 0) return [];

    const verdictFor = await this.loadVerdicts(factoryId, [...new Set(rows.map((r) => r.machineId))]);
    return this.scheduleWins(rows)
      .map((r) => {
        const minutes = (r.to.getTime() - r.from.getTime()) / 60_000;
        return {
          machineId: r.machineId,
          machineCode: r.machineCode,
          state: r.state,
          // The activity name a person wrote, with the machine's own markers
          // stripped out — see activity-label.ts for why the column holds both.
          label: activityLabel(r.notes),
          kind: this.kindOf(r.state, verdictFor(r.machineId, r.state)),
          from: r.from,
          to: r.to,
          minutes,
        };
      })
      .filter((s) => s.minutes > 0);
  }

  /**
   * The SCHEDULE for the same window — what the plant intended, not what the
   * machine did.
   *
   * A second track drawn above the state track, so "we planned to run here and
   * clean there" sits directly over "here is what actually happened". Reading
   * those two against each other is the question a shift review actually asks,
   * and until now it needed two screens and a good memory.
   *
   * Built from planned downtime EVENTS rather than templates, because events
   * are what a plant that schedules day by day actually books — and every gap
   * between them is time the line was expected to produce, which is why the
   * gaps are returned as segments too rather than left blank. Blank would read
   * as "nothing known", and here it means something precise.
   */
  async plannedSegments(
    factoryId: string | null,
    from: Date,
    to: Date,
    scope: TimelineScope = {},
  ): Promise<TimelineSegment[]> {
    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        isPlanned: true,
        startTime: { lt: to },
        OR: [{ endTime: null }, { endTime: { gt: from } }],
        ...(scope.machineId ? { machineId: scope.machineId } : {}),
        ...(scope.lineId || scope.areaId
          ? {
            machine: {
              ...(scope.lineId ? { lineId: scope.lineId } : {}),
              ...(scope.areaId ? { areaId: scope.areaId } : {}),
            },
          }
          : {}),
      },
      select: {
        machineId: true, reason: true, category: true, affectsOEE: true,
        startTime: true, endTime: true,
        machine: { select: { code: true } },
      },
      orderBy: [{ machineId: 'asc' }, { startTime: 'asc' }],
    });

    // Group per machine so the production gaps can be worked out row by row —
    // one machine's cleaning window says nothing about another's.
    const byMachine = new Map<string, { code: string; stops: Array<{ from: number; to: number; label: string; charged: boolean }> }>();
    for (const e of events) {
      const hit = byMachine.get(e.machineId) ?? { code: e.machine?.code ?? '', stops: [] };
      hit.stops.push({
        from: Math.max(+e.startTime, +from),
        to: Math.min(e.endTime ? +e.endTime : +to, +to),
        label: e.reason ?? String(e.category),
        // A planned stop that still costs the reading — changeover, startup —
        // is drawn differently from one that leaves the denominator, because
        // the two mean different things to whoever is reading the row.
        charged: e.affectsOEE,
      });
      byMachine.set(e.machineId, hit);
    }

    // The hours a WORK ORDER was actually planned to run on each machine.
    //
    // ── What this used to be, and why it was wrong ─────────────────────────
    // It was the manned shift hours: every minute a shift covered, minus the
    // booked stops, was drawn as scheduled production. On a 24-hour plant that
    // paints the whole week green and claims the line was expected to produce
    // continuously — which is not a schedule, it is an opening time.
    //
    // Production is scheduled by an ORDER. Where an order is planned, the plant
    // intended to produce; where none is, it intended nothing, and that is a
    // fact worth seeing rather than a gap to fill with green. The band is left
    // blank there, so "we had no plan for this time" and "we planned to run and
    // did not" stop looking identical.
    const scheduled = await this.plannedProduction(factoryId, from, to, scope);

    // A machine can appear in EITHER source. One with a planned order and no
    // booked stops still has a plan to draw — the early return that skipped it
    // was a leftover from when this function only knew about stops, and it made
    // the commonest case of all draw nothing.
    for (const [machineId, spans] of scheduled) {
      if (spans.length > 0 && !byMachine.has(machineId)) {
        byMachine.set(machineId, { code: '', stops: [] });
      }
    }
    if (byMachine.size === 0) return [];

    const out: TimelineSegment[] = [];
    for (const [machineId, v] of byMachine) {
      const stops = v.stops
        .filter((x) => x.to > x.from)
        .sort((a, b) => a.from - b.from);

      const push = (a: number, b: number, state: string, label: string, kind: SegmentKind) => {
        if (b <= a) return;
        out.push({
          machineId, machineCode: v.code, state, label, kind,
          from: new Date(a), to: new Date(b), minutes: (b - a) / 60_000,
        });
      };

      // Scheduled production is the manned hours MINUS what was booked out of
      // them. Taken with the interval algebra rather than by walking a cursor,
      // so two stops booked over the same minutes cost that time once — the
      // same union rule a finish estimate uses, and for the same reason.
      const plannedForMachine = scheduled.get(machineId) ?? [];
      for (const [a, b] of subtract(plannedForMachine, merge(stops.map((x) => [x.from, x.to] as Span)))) {
        push(a, b, 'PRODUCTION', 'Production', 'running');
      }
      // Every booked stop is drawn as itself, named, whether or not it falls in
      // a manned hour: somebody booked it, and hiding it would make the record
      // disagree with the schedule screen it was entered on.
      for (const st of stops) {
        push(st.from, st.to, 'PLANNED_STOP', st.label, st.charged ? 'downtime' : 'planned');
      }
    }
    return out;
  }

  /**
   * The manned hours inside a window, from the shift templates.
   *
   * Occurrences are laid out day by day and merged, which handles a shift that
   * crosses midnight without special-casing it: the previous day's occurrence
   * simply reaches past 00:00 and merges with what follows.
   *
   * No templates at all means the plant has not told the system its calendar.
   * The whole window is treated as manned then — the behaviour before this
   * existed — because refusing to draw a schedule the plant demonstrably keeps
   * would be a worse answer than the one assumption we can name.
   */
  /**
   * When each machine was planned to be PRODUCING, per its work orders.
   *
   * Keyed per machine, because two machines on one line can carry different
   * steps of different orders — the palletiser's window is not the filler's.
   * Returned merged, so two orders that overlap on a machine cost their time
   * once.
   *
   * A machine with no order in the window gets an empty span list and its plan
   * track draws nothing but its booked stops. That silence is the point: it
   * says the plant scheduled no production here, which is different from
   * scheduling production that then failed.
   */
  private async plannedProduction(
    factoryId: string | null, from: Date, to: Date, scope: TimelineScope,
  ): Promise<Map<string, Span[]>> {
    const jos = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { not: null },
        // Anything that has not been cancelled still represents an intention.
        status: { notIn: ['CANCELLED'] },
        plannedStart: { lt: to },
        plannedEnd: { gt: from },
        ...(scope.machineId ? { machineId: scope.machineId } : {}),
        ...(scope.lineId || scope.areaId
          ? {
            machine: {
              ...(scope.lineId ? { lineId: scope.lineId } : {}),
              ...(scope.areaId ? { areaId: scope.areaId } : {}),
            },
          }
          : {}),
      },
      select: { machineId: true, plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true },
    });

    const out = new Map<string, Span[]>();
    for (const jo of jos) {
      // A step with no planned window states no intention, so it contributes
      // none. Guessing one from its actual times would turn what HAPPENED into
      // what was planned — the exact conflation these two bands exist to keep
      // apart.
      if (!jo.machineId || !jo.plannedStart || !jo.plannedEnd) continue;
      // The PLANNED window is what the plan track is about. Where an order ran
      // beyond it, that overrun is not something the plant planned — it is what
      // the state track underneath is for.
      const a = Math.max(+jo.plannedStart, +from);
      const b = Math.min(+jo.plannedEnd, +to);
      if (b <= a) continue;
      const list = out.get(jo.machineId) ?? [];
      list.push([a, b]);
      out.set(jo.machineId, list);
    }
    for (const [k, v] of out) out.set(k, merge(v));
    return out;
  }

  private async scheduledHours(factoryId: string | null, from: Date, to: Date): Promise<Span[]> {
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { startTime: true, endTime: true, crossesMidnight: true },
    });
    if (templates.length === 0) return [[+from, +to]];

    const hhmm = (v: string) => {
      const [h, m] = v.split(':').map(Number);
      return h * 60 + (m || 0);
    };

    const spans: Span[] = [];
    // Start a day early so an overnight occurrence that began before the window
    // still contributes the part of itself that falls inside it.
    const day = new Date(from);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - 1);
    const last = new Date(to);
    last.setHours(0, 0, 0, 0);

    for (; day <= last; day.setDate(day.getDate() + 1)) {
      for (const t of templates) {
        const s = hhmm(t.startTime), e = hhmm(t.endTime);
        const lengthMin = t.crossesMidnight ? (24 * 60 - s) + e : e - s;
        if (lengthMin <= 0) continue;
        const start = new Date(day);
        start.setHours(Math.floor(s / 60), s % 60, 0, 0);
        const a = Math.max(+start, +from);
        const b = Math.min(+start + lengthMin * 60_000, +to);
        if (b > a) spans.push([a, b]);
      }
    }
    return merge(spans);
  }

  /**
   * The same minutes, re-read with the SCHEDULE taking precedence.
   *
   * ── The reading this fixes ──────────────────────────────────────────────
   * The sensor sees one thing: a machine that is not turning. It cannot see
   * why. So a line stopped from 07:30 to 08:51 arrives as eighty-one minutes
   * of BREAKDOWN — even though the plant had booked cleaning until 08:00 and
   * startup until 08:30, and only the last twenty-one minutes are a fault
   * anyone should be asked about. Ranked against the other losses, that stop
   * is four times its real size and points a shift review at the wrong thing.
   *
   * Here every minute is awarded to exactly one owner: a booked stop if one
   * covers it, the machine's own state otherwise. `rawMin` and `reclaimedMin`
   * travel with each row so the arithmetic is visible rather than asserted —
   * a reader can see that BREAKDOWN was 81, that 60 of it was booked, and
   * that 21 is what is left.
   *
   * ── What this deliberately does NOT do ──────────────────────────────────
   * It changes no equation. Availability, OEE, the fact store and every
   * exported figure are computed exactly as before, from `classifyMinute` and
   * the minute rows. This is one panel's way of reading time, kept separate on
   * purpose until the scenarios it raises have been worked through — chief
   * among them what happens to a changeover booked for 10:00 when the order
   * before it has not finished. Until that is settled, a projection that
   * quietly moved the numbers would be answering a question nobody has agreed
   * on yet.
   *
   * Pure, and over arrays the caller already holds: no query, no store, and
   * nothing it could reach into even by accident.
   */
  scheduleFirst(segments: TimelineSegment[], planned: TimelineSegment[]): ScheduleFirstSlice[] {
    // ── 1. What the schedule claims, first come first served ───────────────
    // Two stops booked over the same minutes on one machine cost that minute
    // once, and it belongs to whichever was booked to start first. Anything
    // else and the panel's total exceeds the time that actually elapsed.
    const claimed = new Map<string, Span[]>();
    const booked = new Map<string, ScheduleFirstSlice>();

    const stops = planned
      // A gap between booked stops is not itself a booked stop. Through
      // scheduled production the sensor's account stands, which is the whole
      // reason RUNNING, STARVED and BREAKDOWN still appear below.
      .filter((p) => p.state !== 'PRODUCTION')
      .sort((a, b) => +a.from - +b.from);

    for (const p of stops) {
      const taken = claimed.get(p.machineId) ?? [];
      const mine = subtract([[+p.from, +p.to]], taken);
      if (mine.length === 0) continue;
      const key = p.label || p.state;
      const hit = booked.get(key) ?? {
        key, label: key, kind: p.kind, scheduled: true,
        minutes: 0, rawMin: 0, reclaimedMin: 0,
      };
      const mins = spanMinutes(mine);
      hit.minutes += mins;
      hit.rawMin += mins;
      booked.set(key, hit);
      claimed.set(p.machineId, merge([...taken, ...mine]));
    }

    // ── 2. What the machines reported, minus what the schedule took ────────
    const states = new Map<string, ScheduleFirstSlice>();
    for (const seg of segments) {
      const key = seg.state;
      const hit = states.get(key) ?? {
        key, label: key, kind: seg.kind, scheduled: false,
        minutes: 0, rawMin: 0, reclaimedMin: 0,
      };
      const left = subtract([[+seg.from, +seg.to]], claimed.get(seg.machineId) ?? []);
      hit.rawMin += seg.minutes;
      hit.minutes += spanMinutes(left);
      states.set(key, hit);
    }
    for (const v of states.values()) {
      // Floating point: two ways of measuring the same span can disagree in the
      // twelfth decimal, and a bar of −0.0000001 minutes renders as a glitch.
      v.reclaimedMin = Math.max(0, Math.round((v.rawMin - v.minutes) * 1000) / 1000);
    }

    // A state wholly absorbed by a booked stop keeps its row at zero minutes
    // rather than vanishing: "STARVED — all 60 min of it was booked cleaning"
    // is a finding, and a row that disappears tells the reader nothing.
    return [...booked.values(), ...states.values()]
      .filter((v) => v.minutes > 0.0001 || v.reclaimedMin > 0.0001)
      .sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
  }

  /**
   * Where the schedule and the sensor both claim a minute, the schedule wins.
   *
   * The SAME precedence `classifyMinute` applies to the arithmetic:
   *
   *   const planned   = merge([...scheduledStops, ...])
   *   const operating = subtract(merge(byKind.operating), planned)
   *
   * Applying it here too is the whole point of materialising the schedule into
   * state records. Before, the maths excluded a scheduled break while this
   * chart drew whatever the sensor reported through it — the same minute, two
   * accounts, and no way for a reader to reconcile them.
   *
   * The sensor's record is trimmed for DISPLAY only; nothing is deleted. A
   * machine that ran straight through its own cleaning window still has that
   * measurement on file — it simply is not drawn as production, because for
   * every other purpose in the system those minutes were not production.
   */
  private scheduleWins<T extends { machineId: string; from: Date; to: Date; source: string }>(
    rows: T[],
  ): T[] {
    const planned = rows.filter((r) => r.source === SCHEDULE_SOURCE);
    if (planned.length === 0) return rows;

    const byMachine = new Map<string, Array<[number, number]>>();
    for (const p of planned) {
      const list = byMachine.get(p.machineId) ?? [];
      list.push([p.from.getTime(), p.to.getTime()]);
      byMachine.set(p.machineId, list);
    }
    for (const [k, v] of byMachine) byMachine.set(k, merge(v));

    const out: T[] = [];
    for (const r of rows) {
      if (r.source === SCHEDULE_SOURCE) { out.push(r); continue; }
      const taken = byMachine.get(r.machineId);
      if (!taken) { out.push(r); continue; }
      // What survives of the sensor's record once the schedule has taken its
      // share. A record straddling a break becomes the two pieces either side.
      for (const [s, e] of subtract([[r.from.getTime(), r.to.getTime()]], taken)) {
        out.push({ ...r, from: new Date(s), to: new Date(e) });
      }
    }
    return out;
  }

  /**
   * The counts under the chart: how many stops, and how long in total.
   *
   * Derived from the same segments the chart draws, so a reader who counts the
   * red blocks and a reader who reads the number are looking at one fact.
   */
  details(segments: TimelineSegment[]): ProductionDetails {
    const sum = (k: SegmentKind) =>
      segments.filter((s) => s.kind === k).reduce((a, s) => a + s.minutes, 0);
    const count = (k: SegmentKind) => segments.filter((s) => s.kind === k).length;

    const downtimeCount = count('downtime');
    const downtimeMin = sum('downtime');
    const runningMin = sum('running');

    return {
      downtimeCount,
      downtimeMin,
      // The reference names microstops as their own level. Nothing in this plant
      // measures them yet, so they are reported as an explicit zero rather than
      // folded into downtime, where they would look measured.
      microstopCount: 0,
      microstopMin: 0,
      plannedStopCount: count('planned'),
      plannedStopMin: sum('planned'),
      externalCount: count('external'),
      externalMin: sum('external'),
      // MTTR = Σ downtime ÷ number of failures. MTBF = Σ uptime ÷ the same count:
      // the reference states it as Σ(start of downtime − start of uptime), which
      // is the running time between failures, and that is what `running` sums to.
      //
      // Only UNPLANNED stops count as failures. A break is not a breakdown, and
      // counting one lowers MTTR and raises MTBF at once — the two figures then
      // both look better because the plant took a scheduled lunch.
      mttrMin: downtimeCount > 0 ? downtimeMin / downtimeCount : null,
      mtbfMin: downtimeCount > 0 ? runningMin / downtimeCount : null,
      runningMin,
    };
  }

  /**
   * Where the time went, by reason, two levels deep.
   *
   * Level one is the time model — running, planned, external, unplanned — because
   * that is the level a plant argues about. Level two is the machine states
   * inside each, which is as far as the reason tree goes until downtime causes
   * are being recorded against events.
   *
   * Median as well as average, because stopped time is not normally distributed:
   * one four-hour breakdown among forty two-minute stops drags the average to
   * somewhere no individual stop ever was, and the median says which of the two
   * numbers to believe.
   */
  distribution(segments: TimelineSegment[]): Distribution {
    const median = (xs: number[]) => {
      if (xs.length === 0) return 0;
      const a = [...xs].sort((x, y) => x - y);
      const m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const stat = (key: string, label: string, kind: SegmentKind, segs: TimelineSegment[]): ReasonSlice => {
      const durations = segs.map((s) => s.minutes);
      const minutes = durations.reduce((a, b) => a + b, 0);
      return {
        key, label, kind, minutes,
        occurrence: segs.length,
        medianMin: median(durations),
        averageMin: segs.length ? minutes / segs.length : 0,
      };
    };

    const KIND_LABEL: Record<SegmentKind, string> = {
      running: 'Run',
      downtime: 'Unplanned downtime',
      planned: 'Planned stop',
      external: 'Starved / blocked',
      unmeasured: 'Not reported',
    };

    const byKind = new Map<SegmentKind, TimelineSegment[]>();
    for (const s of segments) {
      const arr = byKind.get(s.kind) ?? [];
      arr.push(s);
      byKind.set(s.kind, arr);
    }

    const reasons = [...byKind.entries()]
      .map(([kind, segs]) => {
        const byState = new Map<string, TimelineSegment[]>();
        for (const s of segs) {
          const arr = byState.get(s.state) ?? [];
          arr.push(s);
          byState.set(s.state, arr);
        }
        return {
          ...stat(kind, KIND_LABEL[kind], kind, segs),
          children: [...byState.entries()]
            .map(([state, ss]) => stat(`${kind}:${state}`, state, kind, ss))
            .sort((a, b) => b.minutes - a.minutes),
        };
      })
      .sort((a, b) => b.minutes - a.minutes);

    const all = segments.map((s) => s.minutes);
    const totalMin = all.reduce((a, b) => a + b, 0);
    return {
      occurrence: segments.length,
      totalMin,
      medianMin: median(all),
      averageMin: segments.length ? totalMin / segments.length : 0,
      reasons,
    };
  }
}
