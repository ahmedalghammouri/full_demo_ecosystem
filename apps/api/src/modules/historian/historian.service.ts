import { Injectable, Logger } from '@nestjs/common';
import { Point } from '@influxdata/influxdb-client';

import { PrismaService } from '../../database/prisma.service';
import { InfluxService } from './influx.service';
import { oeeIdentityOf } from '../../common/oee-identity.util';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export interface OeeSample {
  factoryId: string;
  machineId: string;
  jobOrderId?: string;
  workOrderId?: string;
  availability: number | null;       // classic / schedule-based
  availabilityTimeBased: number | null; // Uptime / (Uptime + Downtime)
  performance: number | null;
  quality: number | null;
  oee: number | null;                 // classic
  oeeTimeBased: number | null;        // uses time-based availability
  good: number;
  rejected: number;
  runMin: number;
  downMin: number;
  utilizationPct: number | null;
  at?: Date;
}

/**
 * Historian — persists OEE / availability / production time-series to InfluxDB
 * (measurement `oee`). Two availability methods are recorded side by side:
 *   • availability           — classic schedule-based (operating ÷ planned time)
 *   • availabilityTimeBased  — Uptime ÷ (Uptime + Downtime)
 * and therefore two OEE values (oee, oeeTimeBased). A per-minute sampler builds
 * real history going forward; trends are read back with Flux aggregateWindow.
 */
@Injectable()
export class HistorianService {
  private readonly logger = new Logger(HistorianService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly influx: InfluxService,
  ) {}

  isEnabled() { return this.influx.isEnabled(); }

  // ── Write one OEE sample ──────────────────────────────────────
  private toPoint(s: OeeSample): Point {
    const p = new Point('oee')
      .tag('factoryId', s.factoryId)
      .tag('machineId', s.machineId)
      .tag('jobOrderId', s.jobOrderId ?? 'none')
      .tag('workOrderId', s.workOrderId ?? 'none')
      .intField('good', Math.round(s.good))
      .intField('rejected', Math.round(s.rejected))
      .floatField('runMin', round1(s.runMin))
      .floatField('downMin', round1(s.downMin));
    if (s.availability != null) p.floatField('availability', round1(s.availability));
    if (s.availabilityTimeBased != null) p.floatField('availabilityTb', round1(s.availabilityTimeBased));
    if (s.performance != null) p.floatField('performance', round1(s.performance));
    if (s.quality != null) p.floatField('quality', round1(s.quality));
    if (s.oee != null) p.floatField('oee', round1(s.oee));
    if (s.oeeTimeBased != null) p.floatField('oeeTb', round1(s.oeeTimeBased));
    if (s.utilizationPct != null) p.floatField('utilization', round1(s.utilizationPct));
    p.timestamp(s.at ?? new Date());
    return p;
  }

  async record(samples: OeeSample[]): Promise<number> {
    if (!samples.length) return 0;
    const ok = await this.influx.write(samples.map((s) => this.toPoint(s)));
    return ok ? samples.length : 0;
  }

  // ── Sample all active job orders right now ────────────────────
  async sampleActiveJobOrders(at = new Date()): Promise<number> {
    if (!this.influx.isEnabled()) return 0;
    const jos = await this.prisma.jobOrder.findMany({
      where: { status: { in: ['EXECUTING', 'PAUSED'] }, machineId: { not: null }, actualStart: { not: null } },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true,
        actualStart: true, plannedStart: true, plannedEnd: true,
        actualQtyGood: true, actualQtyRejected: true, idealCycleTimeSec: true,
      },
    });
    if (!jos.length) return 0;

    const machineIds = [...new Set(jos.map((j) => j.machineId!))];
    // Open + recent downtime per machine (since the earliest active JO start)
    const earliest = jos.reduce((m, j) => Math.min(m, j.actualStart!.getTime()), at.getTime());
    const events = await this.prisma.downtimeEvent.findMany({
      where: { machineId: { in: machineIds }, startTime: { lte: at }, OR: [{ endTime: null }, { endTime: { gte: new Date(earliest) } }] },
      select: { machineId: true, startTime: true, endTime: true, isPlanned: true },
    });

    const samples: OeeSample[] = jos.map((jo) => {
      const start = jo.actualStart!.getTime();
      const operatingMin = Math.max(0, (at.getTime() - start) / MIN);
      // Downtime overlapping this JO window, split planned vs unplanned
      let downMin = 0; let plannedMin = 0;
      for (const ev of events.filter((e) => e.machineId === jo.machineId)) {
        const from = Math.max(ev.startTime.getTime(), start);
        const to = Math.min((ev.endTime ?? at).getTime(), at.getTime());
        const m = Math.max(0, (to - from) / MIN);
        if (m <= 0) continue;
        if (ev.isPlanned) plannedMin += m; else downMin += m;
      }
      const runMin = Math.max(0, operatingMin - downMin - plannedMin);
      return this.computeSample(jo, operatingMin, runMin, downMin, plannedMin, at);
    });

    const n = await this.record(samples);
    if (n) this.logger.debug(`Historian sampled ${n} job orders`);
    return n;
  }

  /** Shared metric maths — both availability methods + both OEE. */
  private computeSample(
    jo: any, operatingMin: number, runMin: number, downMin: number, plannedMin: number, at: Date,
  ): OeeSample {
    const good = jo.actualQtyGood ?? 0;
    const rejected = jo.actualQtyRejected ?? 0;
    const total = good + rejected;
    const ict = jo.idealCycleTimeSec ?? null;

    // Classic / schedule-based availability = operating ÷ planned window ELAPSED SO FAR.
    //
    // The planned window is the whole order — here 08 Aug → 24 Aug. Dividing 2h04m of
    // operating time by 16 days of plan produced Availability 0.7% on the shop-floor
    // dashboard while the KPI page showed 100% for the same machine at the same
    // moment. An order is not unavailable for days it has not reached yet; planned
    // production time accrues as the clock passes, so the window is clamped to `at`.
    //
    // `plannedStart` is NOT clamped: an order that should have started at 06:00 and
    // began at 08:00 really did lose two hours of availability, and that must show.
    let availability: number | null = null;
    if (jo.plannedStart && jo.plannedEnd) {
      const ps = new Date(jo.plannedStart).getTime();
      const pe = Math.min(new Date(jo.plannedEnd).getTime(), at.getTime());
      const plannedMins = Math.max(0, pe - ps) / MIN;
      if (plannedMins > 0) availability = Math.min(100, (operatingMin / plannedMins) * 100);
    }
    // Time-based availability = Uptime ÷ (Uptime + Downtime)
    const availabilityTimeBased = (runMin + downMin) > 0 ? (runMin / (runMin + downMin)) * 100 : null;

    const quality = total > 0 ? (good / total) * 100 : null;
    const idealProdMin = ict ? (ict * total) / 60 : null;
    const performance = idealProdMin != null && runMin > 0 ? Math.min(100, (idealProdMin / runMin) * 100) : null;

    const oee = availability != null && performance != null && quality != null
      ? oeeIdentityOf(availability, performance, quality) : null;
    const oeeTimeBased = availabilityTimeBased != null && performance != null && quality != null
      ? oeeIdentityOf(availabilityTimeBased, performance, quality) : null;

    const utilizationPct = operatingMin > 0 ? Math.min(100, ((operatingMin - plannedMin) / operatingMin) * 100) : null;

    return {
      factoryId: jo.factoryId, machineId: jo.machineId, jobOrderId: jo.id, workOrderId: jo.workOrderId,
      availability, availabilityTimeBased, performance, quality, oee, oeeTimeBased,
      good, rejected, runMin, downMin, utilizationPct, at,
    };
  }

  // ── Per-tag time-series (historian "tag" measurement) ─────────
  // Reads raw or window-aggregated numeric history for a single tag, as written
  // by the edge gateway (measurement `tag`, tagged by tagCode/factoryId, field
  // `value`). Used by the Historian Trend viewer. everyMin = 0 → raw samples.
  async getTagTrend(
    factoryId: string | null,
    tagCode: string,
    fromIso: string,
    toIso: string,
    everyMin = 0,
  ): Promise<{ time: string; value: number | null }[]> {
    if (!this.influx.isEnabled() || !tagCode) return [];
    const bucket = this.influx.getBucket();
    const factoryFilter = factoryId ? ` and r.factoryId == "${esc(factoryId)}"` : '';
    const agg = everyMin > 0
      ? `  |> aggregateWindow(every: ${everyMin}m, fn: mean, createEmpty: false)\n`
      : '';
    const flux = `
from(bucket: "${bucket}")
  |> range(start: ${fromIso}, stop: ${toIso})
  |> filter(fn: (r) => r._measurement == "tag" and r.tagCode == "${esc(tagCode)}"${factoryFilter})
  |> filter(fn: (r) => r._field == "value")
${agg}  |> sort(columns: ["_time"])
  |> limit(n: 5000)`;
    const rows = await this.influx.query<any>(flux);
    return rows.map((r) => ({ time: r._time, value: numP(r._value) }));
  }

  // ── Trend queries (Flux aggregateWindow) ──────────────────────

  async getOeeTrend(machineId: string, fromIso: string, toIso: string, everyMin = 30) {
    const bucket = this.influx.getBucket();
    const flux = `
from(bucket: "${bucket}")
  |> range(start: ${fromIso}, stop: ${toIso})
  |> filter(fn: (r) => r._measurement == "oee" and r.machineId == "${esc(machineId)}")
  |> filter(fn: (r) => r._field == "availability" or r._field == "availabilityTb" or r._field == "performance" or r._field == "quality" or r._field == "oee" or r._field == "oeeTb")
  |> aggregateWindow(every: ${everyMin}m, fn: mean, createEmpty: false)
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])`;
    const rows = await this.influx.query<any>(flux);
    if (rows.length > 0) {
      return rows.map((r) => ({
        time: r._time,
        availability: num(r.availability),
        availabilityTb: num(r.availabilityTb),
        performance: num(r.performance),
        quality: num(r.quality),
        oee: num(r.oee),
        oeeTb: num(r.oeeTb),
      }));
    }
    // Relational fallback — when InfluxDB is disabled/empty, reconstruct the trend (incl.
    // BOTH availability methods) from stored OEERecord rows so charts are never blank.
    return this.oeeTrendFromRecords(machineId, new Date(fromIso), new Date(toIso));
  }

  /** OEERecord-based OEE trend (schedule + time-based) used when the historian has no Influx data. */
  private async oeeTrendFromRecords(machineId: string, from: Date, to: Date) {
    const records = await this.prisma.oEERecord.findMany({
      where: { machineId, recordDate: { gte: from, lte: to } },
      orderBy: { recordDate: 'asc' },
      take: 1000,
      select: {
        recordDate: true, availability: true, performance: true, quality: true, oee: true,
        uptimeMin: true, downtimeMin: true,
      },
    });
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return records.map((r) => {
      const active = (r.uptimeMin ?? 0) + (r.downtimeMin ?? 0);
      const availabilityTb = active > 0 ? r1(((r.uptimeMin ?? 0) / active) * 100) : null;
      // NOTE: the `?? 0` treats a missing Performance or Quality as ZERO, which
      // reports 0.0% OEE-TB for a machine that simply had nothing counted. It is
      // preserved here deliberately — this commit unifies the arithmetic and
      // changes no number — and is one of the coercions the semantics pass will
      // remove, each with its own before/after diff.
      const oeeTb = availabilityTb != null
        ? r1(oeeIdentityOf(availabilityTb, r.performance ?? 0, r.quality ?? 0))
        : null;
      return {
        time: r.recordDate.toISOString(),
        availability: r.availability ?? null,
        availabilityTb,
        performance: r.performance ?? null,
        quality: r.quality ?? null,
        oee: r.oee ?? null,
        oeeTb,
      };
    });
  }

  async getProductionTrend(machineId: string, fromIso: string, toIso: string, everyMin = 30) {
    const bucket = this.influx.getBucket();
    const flux = `
from(bucket: "${bucket}")
  |> range(start: ${fromIso}, stop: ${toIso})
  |> filter(fn: (r) => r._measurement == "oee" and r.machineId == "${esc(machineId)}")
  |> filter(fn: (r) => r._field == "good" or r._field == "rejected")
  |> aggregateWindow(every: ${everyMin}m, fn: max, createEmpty: false)
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])`;
    const rows = await this.influx.query<any>(flux);
    if (rows.length > 0) {
      // rows hold cumulative good/rejected per window → derive deltas
      let prevGood = 0; let prevRej = 0;
      return rows.map((r, i) => {
        const good = num(r.good) ?? prevGood;
        const rejected = num(r.rejected) ?? prevRej;
        const goodDelta = i === 0 ? 0 : Math.max(0, good - prevGood);
        const scrapDelta = i === 0 ? 0 : Math.max(0, rejected - prevRej);
        prevGood = good; prevRej = rejected;
        return { time: r._time, good, rejected, goodDelta, scrapDelta };
      });
    }
    // Relational fallback — each OEERecord is already a per-period total (not cumulative).
    return this.productionTrendFromRecords(machineId, new Date(fromIso), new Date(toIso));
  }

  /** OEERecord-based production trend used when the historian has no Influx data. */
  private async productionTrendFromRecords(machineId: string, from: Date, to: Date) {
    const records = await this.prisma.oEERecord.findMany({
      where: { machineId, recordDate: { gte: from, lte: to } },
      orderBy: { recordDate: 'asc' },
      take: 1000,
      select: { recordDate: true, goodOutput: true, scrapOutput: true },
    });
    let cumGood = 0; let cumRej = 0;
    return records.map((r) => {
      const goodDelta = r.goodOutput ?? 0;
      const scrapDelta = r.scrapOutput ?? 0;
      cumGood += goodDelta; cumRej += scrapDelta;
      return { time: r.recordDate.toISOString(), good: cumGood, rejected: cumRej, goodDelta, scrapDelta };
    });
  }

  // ── Backfill realistic history into InfluxDB ──────────────────
  // Generates per-machine OEE samples across `days` at `stepMin` resolution so the
  // historian has real timestamped series immediately. Deterministic (no Math.random).
  async backfill(days = 14, stepMin = 30): Promise<number> {
    if (!this.influx.isEnabled()) {
      this.logger.warn('Backfill skipped — InfluxDB disabled.');
      return 0;
    }
    const jos = await this.prisma.jobOrder.findMany({
      where: { status: { in: ['EXECUTING', 'PAUSED', 'COMPLETE'] }, machineId: { not: null } },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true,
        actualQtyGood: true, actualQtyRejected: true, idealCycleTimeSec: true,
      },
      orderBy: { sequenceOrder: 'asc' },
    });
    if (!jos.length) return 0;
    // one representative JO per machine
    const byMachine = new Map<string, typeof jos[number]>();
    for (const j of jos) if (!byMachine.has(j.machineId!)) byMachine.set(j.machineId!, j);

    const now = Date.now();
    const start = now - days * DAY;
    const points: Point[] = [];
    let mi = 0;
    for (const [machineId, jo] of byMachine) {
      const seed = hash(machineId);
      // SYNTHETIC. This whole method fabricates a historian series from a PRNG
      // to populate a demo; the 30 is a seed for made-up numbers, not a default
      // cycle time. The real reference is `RoutingStep.cycleTimeSec` and the
      // measuring paths carry null rather than invent one — see line 126.
      const ict = jo.idealCycleTimeSec ?? 30;
      let cumGood = 0; let cumRej = 0;
      const stepMs = stepMin * MIN;
      const totalSteps = Math.floor((now - start) / stepMs);
      const goodPerStep = (jo.actualQtyGood ?? 0) / Math.max(1, totalSteps);
      const rejPerStep = (jo.actualQtyRejected ?? 0) / Math.max(1, totalSteps);

      for (let t = start, k = 0; t <= now; t += stepMs, k++) {
        const r = prng(seed + k);
        // Smooth daily cycle + noise → realistic availability/perf/quality
        const dayPhase = Math.sin((t / DAY) * Math.PI * 2 + mi) * 0.5 + 0.5;
        const availability = clamp(78 + dayPhase * 12 + (r() - 0.5) * 6, 60, 99);     // schedule-based
        const downFrac = (100 - availability) / 100;
        const performance = clamp(82 + (1 - dayPhase) * 10 + (r() - 0.5) * 6, 60, 99);
        const quality = clamp(96 + (r() - 0.5) * 3.5, 90, 99.8);
        // Time-based availability tends slightly higher (excludes planned stops)
        const availabilityTb = clamp(availability + 3 + (r() - 0.5) * 4, 62, 99.5);
        const oee = oeeIdentityOf(availability, performance, quality);
        const oeeTb = oeeIdentityOf(availabilityTb, performance, quality);
        const runMin = stepMin * (availability / 100);
        const downMin = stepMin * downFrac;
        cumGood += goodPerStep; cumRej += rejPerStep;

        const p = new Point('oee')
          .tag('factoryId', jo.factoryId)
          .tag('machineId', machineId)
          .tag('jobOrderId', jo.id)
          .tag('workOrderId', jo.workOrderId)
          .floatField('availability', round1(availability))
          .floatField('availabilityTb', round1(availabilityTb))
          .floatField('performance', round1(performance))
          .floatField('quality', round1(quality))
          .floatField('oee', round1(oee))
          .floatField('oeeTb', round1(oeeTb))
          .floatField('runMin', round1(runMin))
          .floatField('downMin', round1(downMin))
          .intField('good', Math.round(cumGood))
          .intField('rejected', Math.round(cumRej))
          .timestamp(new Date(t));
        points.push(p);
      }
      mi++;
    }
    // Write in chunks to avoid oversized payloads
    let written = 0;
    for (let i = 0; i < points.length; i += 2000) {
      const ok = await this.influx.write(points.slice(i, i + 2000));
      if (ok) written += Math.min(2000, points.length - i);
    }
    this.logger.log(`Historian backfill wrote ${written} points across ${byMachine.size} machines (${days}d @ ${stepMin}m).`);
    return written;
  }
}

// ── helpers ──
function round1(v: number) { return Math.round(v * 10) / 10; }
function num(v: any): number | null { return v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10; }
function numP(v: any): number | null { return v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 1000) / 1000; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function esc(s: string) { return s.replace(/["\\]/g, ''); }
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function prng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
