/**
 * i360 Ecosystem Demo — transactional history.
 *
 * Master data says what the plant IS. This says what it DID. Both are
 * evaluated from the same deterministic signal engine, so the seeded past and
 * the live feed agree: a trend that ends "now" joins the live values without a
 * seam, and re-running this produces byte-identical history.
 *
 *   pnpm prisma:seed          master data (run this first)
 *   pnpm prisma:seed:history  this file
 *
 * ── The one table that matters ──────────────────────────────────────────────
 *
 * `oee_minutes` is the platform's single store of measured minutes. Every OEE
 * figure on every screen is a projection of it, joined to `job_orders`. Fill it
 * correctly and the KPI tiles, the loss waterfall, the shift comparison and the
 * machine wall all populate from one fact. Fill it loosely and they disagree
 * with each other, which is worse than leaving them empty.
 *
 * So the minute rows are written first and everything else is folded FROM them:
 * a work order's good count is the sum of its job orders' minutes, and a shift's
 * OEE is computed from the minutes inside it. Nothing is asserted twice.
 *
 * ── Volume ─────────────────────────────────────────────────────────────────
 *
 * Minutes are written only for machines on a line, and only while a shift is
 * scheduled — an unscheduled hour is not availability loss, it is not the
 * plant's time at all. That is roughly 420k rows for the default 14 days across
 * the three factories. Daily rollups are not generated here: the platform's own
 * writers derive them, and duplicating that logic would create a second opinion
 * about what a day's OEE was.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { FACTORIES, capabilitiesOf } from './plant/plant-model';
import type { FactoryDef, MachineDef, ShiftDef } from './plant/types';
import {
  MINUTE, HOUR, DAY, shiftAt, isScheduled, machineStateAt, throughputFactor,
  lineConstraint, qualityRateAt, scrapCount, processStress, machineHealth,
  pickDowntimeReason, tagValue, meterLoadKw, qualityResult, pickScrapCode,
  rand, round, clamp, startOfDay, lotFor, serialFor,
  pqEventsInWindow, harmonicSpectrum, meterVoltageThd, meterCurrentThd,
} from './plant/signal-engine';

const prisma = new PrismaClient();

const HISTORY_DAYS = Number(process.env.SEED_HISTORY_DAYS ?? 14);
const RESET = process.env.SEED_RESET === 'true';
const CHUNK = 5_000;

const log = (m: string) => console.log(m);
const step = (m: string) => console.log(`  · ${m}`);

/** Insert in batches. One 400k-row createMany exhausts the connection's memory. */
async function insertMany<T>(name: string, rows: T[], fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await fn(rows.slice(i, i + CHUNK));
  }
  return rows.length;
}

// ────────────────────────────────────────────────────────────────────────────

interface Ctx {
  factoryId: string;
  machineId: Map<string, string>;
  lineId: Map<string, string>;
  skuId: Map<string, string>;
  shiftTemplateId: Map<string, string>;
  causeId: Map<string, string>;
  meterId: Map<string, string>;
  alarmDefId: Map<string, string>;
  routingStepId: Map<string, string>;
  qualityPlanId: Map<string, string>;
  userIds: string[];
}

async function loadCtx(f: FactoryDef): Promise<Ctx> {
  const factory = await prisma.factory.findUniqueOrThrow({ where: { code: f.code } });
  const [machines, lines, skus, shifts, causes, meters, alarms, steps, plans, users] = await Promise.all([
    prisma.machine.findMany({ where: { factoryId: factory.id }, select: { id: true, code: true } }),
    prisma.productionLine.findMany({ where: { factoryId: factory.id }, select: { id: true, code: true } }),
    prisma.sKU.findMany({ where: { factoryId: factory.id }, select: { id: true, code: true } }),
    prisma.shiftTemplate.findMany({ where: { factoryId: factory.id }, select: { id: true, code: true } }),
    prisma.downtimeCause.findMany({ where: { factoryId: factory.id }, select: { id: true, code: true } }),
    prisma.energyMeter.findMany({ where: { factoryId: factory.id }, select: { id: true, meterNumber: true } }),
    prisma.alarmDefinition.findMany({ where: { factoryId: factory.id }, select: { id: true, code: true } }),
    prisma.routingStep.findMany({ select: { id: true, stepNumber: true, process: { select: { factoryId: true } } } }),
    prisma.qualityPlan.findMany({ where: { factoryId: factory.id }, select: { id: true, code: true } }),
    prisma.user.findMany({ where: { factoryId: factory.id }, select: { id: true } }),
  ]);

  const meterByCode = new Map<string, string>();
  for (const m of f.energyMeters) {
    const row = meters.find((x) => x.meterNumber === m.meterNumber);
    if (row) meterByCode.set(m.code, row.id);
  }

  return {
    factoryId: factory.id,
    machineId: new Map(machines.map((m) => [m.code, m.id])),
    lineId: new Map(lines.map((l) => [l.code, l.id])),
    skuId: new Map(skus.map((s) => [s.code, s.id])),
    shiftTemplateId: new Map(shifts.map((s) => [s.code, s.id])),
    causeId: new Map(causes.map((c) => [c.code, c.id])),
    meterId: meterByCode,
    alarmDefId: new Map(alarms.map((a) => [a.code, a.id])),
    routingStepId: new Map(
      steps.filter((s) => s.process.factoryId === factory.id).map((s) => [String(s.stepNumber), s.id]),
    ),
    qualityPlanId: new Map(plans.map((p) => [p.code, p.id])),
    userIds: users.map((u) => u.id),
  };
}

/** A stable operator for a machine on a shift, so the same name recurs. */
function operatorFor(ctx: Ctx, machineCode: string, dayIndex: number): string | undefined {
  if (!ctx.userIds.length) return undefined;
  const i = Math.floor(rand(`op:${machineCode}`, dayIndex) * ctx.userIds.length);
  return ctx.userIds[Math.min(i, ctx.userIds.length - 1)];
}

// ────────────────────────────────────────────────────────────────────────────
// One factory's history
// ────────────────────────────────────────────────────────────────────────────

async function seedFactoryHistory(f: FactoryDef, now: Date) {
  log(`\n▸ ${f.code} — ${f.name}`);
  const ctx = await loadCtx(f);
  const caps = capabilitiesOf(f);

  const lineMachines = f.machines.filter((m) => m.lineCode && m.designCapacity);
  const from = startOfDay(new Date(now.getTime() - HISTORY_DAYS * DAY));

  // ── Shift instances ─────────────────────────────────────────────────────
  type ShiftRow = {
    id: string; code: string; lineCode: string; start: Date; end: Date;
    shift: ShiftDef; dayIndex: number;
  };
  const shiftRows: ShiftRow[] = [];
  const shiftCreates: Prisma.ShiftInstanceCreateManyInput[] = [];

  for (let d = 0; d < HISTORY_DAYS; d++) {
    const day = new Date(from.getTime() + d * DAY);
    for (const s of f.shifts) {
      if (!s.days.includes(day.getDay())) continue;
      const [sh, sm] = s.startTime.split(':').map(Number);
      const start = new Date(day); start.setHours(sh, sm, 0, 0);
      const end = new Date(start.getTime() + s.shiftDurationHours * HOUR);
      if (start >= now) continue;

      for (const l of f.lines) {
        const id = crypto.randomUUID();
        shiftRows.push({ id, code: s.code, lineCode: l.code, start, end, shift: s, dayIndex: d });
        shiftCreates.push({
          id,
          factoryId: ctx.factoryId,
          shiftTemplateId: ctx.shiftTemplateId.get(s.code)!,
          lineId: ctx.lineId.get(l.code)!,
          shiftDate: startOfDay(start),
          startTime: start,
          endTime: end <= now ? end : null,
          targetQty: s.targetQtyPerShift ?? null,
          status: end <= now ? 'COMPLETED' : 'IN_PROGRESS',
        });
      }
    }
  }
  await insertMany('shiftInstance', shiftCreates, (b) =>
    prisma.shiftInstance.createMany({ data: b, skipDuplicates: true }));
  step(`${shiftCreates.length} shift instances`);

  // ── Orders: one production order per SKU per week, one work order per
  //    shift per line, one job order per routing step. The minute rows hang
  //    off the job orders, so this scaffolding has to exist first.
  const poCreates: Prisma.ProductionOrderCreateManyInput[] = [];
  const woCreates: Prisma.WorkOrderCreateManyInput[] = [];
  const joCreates: Prisma.JobOrderCreateManyInput[] = [];
  /** machineCode + shiftRow.id → jobOrderId, for the minute writer. */
  const jobOf = new Map<string, string>();

  const weeks = Math.ceil(HISTORY_DAYS / 7);
  const poIds: string[] = [];
  for (let w = 0; w < weeks; w++) {
    const p = f.products[w % f.products.length];
    const start = new Date(from.getTime() + w * 7 * DAY);
    const end = new Date(Math.min(start.getTime() + 7 * DAY, now.getTime()));
    const id = crypto.randomUUID();
    poIds.push(id);
    poCreates.push({
      id,
      factoryId: ctx.factoryId,
      orderNumber: `PO-${f.code}-${String(1000 + w)}`,
      skuId: ctx.skuId.get(p.code) ?? null,
      targetQty: 20_000,
      unit: f.displayUnit,
      status: end < now ? 'COMPLETED' : 'IN_PROGRESS',
      plannedStart: start,
      plannedEnd: new Date(start.getTime() + 7 * DAY),
      actualStart: start,
      actualEnd: end < now ? end : null,
      priority: 'MEDIUM',
    });
  }

  let woSeq = 0;
  for (const sr of shiftRows) {
    const machinesOnLine = lineMachines.filter((m) => m.lineCode === sr.lineCode);
    if (!machinesOnLine.length) continue;

    const week = Math.floor(sr.dayIndex / 7);
    const product = f.products[week % f.products.length];
    const woId = crypto.randomUUID();
    woSeq++;

    woCreates.push({
      id: woId,
      factoryId: ctx.factoryId,
      productionOrderId: poIds[Math.min(week, poIds.length - 1)],
      lineId: ctx.lineId.get(sr.lineCode)!,
      skuId: ctx.skuId.get(product.code) ?? null,
      shiftInstanceId: sr.id,
      orderNumber: `WO-${f.code}-${String(10_000 + woSeq)}`,
      status: sr.end <= now ? 'COMPLETED' : 'IN_PROGRESS',
      plannedQty: sr.shift.targetQtyPerShift ?? 1000,
      qtyUnit: f.displayUnit,
      plannedStart: sr.start,
      plannedEnd: sr.end,
      actualStart: sr.start,
      actualEnd: sr.end <= now ? sr.end : null,
    });

    for (const [i, m] of machinesOnLine.entries()) {
      const joId = crypto.randomUUID();
      jobOf.set(`${m.code}|${sr.id}`, joId);
      const routeStep = f.routing.find((r) => r.machines.includes(m.code));
      joCreates.push({
        id: joId,
        factoryId: ctx.factoryId,
        workOrderId: woId,
        machineId: ctx.machineId.get(m.code)!,
        routingStepId: routeStep ? ctx.routingStepId.get(String(routeStep.sequence)) ?? null : null,
        sequenceOrder: routeStep?.sequence ?? i + 1,
        operationName: routeStep?.name ?? m.name,
        status: sr.end <= now ? 'COMPLETE' : 'EXECUTING',
        plannedStart: sr.start,
        plannedEnd: sr.end,
        actualStart: sr.start,
        actualEnd: sr.end <= now ? sr.end : null,
        idealCycleTimeSec: m.idealCycleSeconds ?? null,
        outputUnit: m.countUnit ?? f.displayUnit,
        operatorId: operatorFor(ctx, m.code, sr.dayIndex) ?? null,
      });
    }
  }

  await insertMany('productionOrder', poCreates, (b) => prisma.productionOrder.createMany({ data: b, skipDuplicates: true }));
  await insertMany('workOrder', woCreates, (b) => prisma.workOrder.createMany({ data: b, skipDuplicates: true }));
  await insertMany('jobOrder', joCreates, (b) => prisma.jobOrder.createMany({ data: b, skipDuplicates: true }));
  step(`${poCreates.length} production orders · ${woCreates.length} work orders · ${joCreates.length} job orders`);

  // ── The minute store ────────────────────────────────────────────────────
  //
  // One row per machine per minute of scheduled time. Each row records how that
  // minute was spent — operating, planned stop, availability loss — and what it
  // produced. Everything downstream is folded from these.
  const minuteRows: Prisma.OeeMinuteCreateManyInput[] = [];
  /** Running totals folded back onto the job order and work order. */
  const joTotals = new Map<string, { good: number; rejected: number }>();

  for (const sr of shiftRows) {
    const machinesOnLine = lineMachines.filter((m) => m.lineCode === sr.lineCode);
    const constraint = lineConstraint(f, sr.lineCode);

    for (const m of machinesOnLine) {
      const joId = jobOf.get(`${m.code}|${sr.id}`);
      if (!joId) continue;
      const ratePerHour = constraint.shareOf(m);
      const idealSec = m.idealCycleSeconds ?? 60;

      const end = Math.min(sr.end.getTime(), now.getTime());
      for (let t = sr.start.getTime(); t < end; t += MINUTE) {
        const state = machineStateAt(f, m, t);
        const perf = throughputFactor(f, t);

        // How this minute is classified. Planned stops and unscheduled time are
        // kept out of the availability denominator: charging a break to
        // availability is the fastest way to make OEE meaningless.
        let operating = 0, plannedStop = 0, availLoss = 0;
        if (state === 'RUNNING') operating = 1;
        else if (state === 'PLANNED_STOP' || state === 'MAINTENANCE') plannedStop = 1;
        else availLoss = 1;

        // Parts only accrue while actually running.
        let good = 0, rejected = 0;
        let theoretical = 0;
        if (operating) {
          const perMinute = (ratePerHour * perf) / 60;
          theoretical = ratePerHour / 60;
          const q = qualityRateAt(f, m, t);
          // Resolve the fraction deterministically so low-rate machines still
          // accumulate scrap instead of reporting a permanent 100% quality.
          const exact = perMinute;
          const whole = Math.floor(exact);
          const extra = rand(`min:${f.code}:${m.code}`, Math.floor(t / MINUTE)) < exact - whole ? 1 : 0;
          const total = whole + extra;
          rejected = scrapCount(f, m, t, total, q);
          good = total - rejected;
        }

        const tot = joTotals.get(joId) ?? { good: 0, rejected: 0 };
        tot.good += good; tot.rejected += rejected;
        joTotals.set(joId, tot);

        minuteRows.push({
          bucketStart: new Date(t),
          isFinalized: true,
          factoryId: ctx.factoryId,
          machineId: ctx.machineId.get(m.code)!,
          jobOrderId: joId,
          shiftTemplateId: ctx.shiftTemplateId.get(sr.code) ?? null,
          shiftCode: sr.code,
          machineState: state,
          jobOrderStatus: sr.end <= now ? 'COMPLETE' : 'EXECUTING',
          totalMin: 1,
          plannedStopMin: plannedStop,
          availabilityLossMin: availLoss,
          externalLossMin: 0,
          unmeasuredMin: 0,
          operatingMin: operating,
          microStopMin: operating ? round(1 - perf, 4) : 0,
          goodParts: good,
          rejectedParts: rejected,
          theoreticalParts: round(theoretical, 4),
          designSpeedPph: m.designCapacity ?? null,
        });
      }
    }
  }

  await insertMany('oeeMinute', minuteRows, (b) => prisma.oeeMinute.createMany({ data: b, skipDuplicates: true }));
  step(`${minuteRows.length.toLocaleString()} measured minutes`);

  // ── Fold the minutes back onto the orders ───────────────────────────────
  // The order totals are not a second opinion: they are the sum of the minutes.
  for (const [joId, t] of joTotals) {
    await prisma.jobOrder.update({
      where: { id: joId },
      data: { actualQtyGood: t.good, actualQtyRejected: t.rejected },
    });
  }
  await prisma.$executeRaw`
    UPDATE work_orders w SET
      "goodQty"   = COALESCE(s.good, 0),
      "scrapQty"  = COALESCE(s.bad, 0),
      "actualQty" = COALESCE(s.good, 0) + COALESCE(s.bad, 0)
    FROM (
      SELECT j."workOrderId" AS id,
             SUM(j."actualQtyGood")::int AS good,
             SUM(j."actualQtyRejected")::int AS bad
      FROM job_orders j
      WHERE j."factoryId" = ${ctx.factoryId}
      GROUP BY j."workOrderId"
    ) s
    WHERE w.id = s.id`;
  step('order quantities folded from the minute store');

  // ── Shift KPI, computed from the same minutes ───────────────────────────
  await prisma.$executeRaw`
    UPDATE shift_instances si SET
      "goodQty"  = COALESCE(s.good, 0),
      "scrapQty" = COALESCE(s.bad, 0),
      "actualQty" = COALESCE(s.good, 0) + COALESCE(s.bad, 0),
      "downtimeMinutes" = COALESCE(s.loss, 0),
      "plannedDowntime" = COALESCE(s.planned, 0),
      "availability" = CASE WHEN COALESCE(s.acct,0) > 0 THEN ROUND((s.op / s.acct * 100)::numeric, 1) ELSE NULL END,
      "performance"  = CASE WHEN COALESCE(s.op,0)   > 0 THEN ROUND((LEAST(s.theo / s.op, 1) * 100)::numeric, 1) ELSE NULL END,
      "quality"      = CASE WHEN COALESCE(s.good,0) + COALESCE(s.bad,0) > 0
                            THEN ROUND((s.good / (s.good + s.bad) * 100)::numeric, 1) ELSE NULL END,
      "oee" = CASE WHEN COALESCE(s.acct,0) > 0 AND COALESCE(s.op,0) > 0 AND COALESCE(s.good,0) + COALESCE(s.bad,0) > 0
                   THEN ROUND(((s.op / s.acct) * LEAST(s.theo / s.op, 1) * (s.good / (s.good + s.bad)) * 100)::numeric, 1)
                   ELSE NULL END
    FROM (
      SELECT w."shiftInstanceId" AS id,
             SUM(o."goodParts")           AS good,
             SUM(o."rejectedParts")       AS bad,
             SUM(o."operatingMin")        AS op,
             SUM(o."availabilityLossMin") AS loss,
             SUM(o."plannedStopMin")      AS planned,
             SUM(o."operatingMin") + SUM(o."availabilityLossMin") AS acct,
             SUM(o."theoreticalParts")    AS theo
      FROM oee_minutes o
      JOIN job_orders j ON j.id = o."jobOrderId"
      JOIN work_orders w ON w.id = j."workOrderId"
      WHERE o."factoryId" = ${ctx.factoryId} AND w."shiftInstanceId" IS NOT NULL
      GROUP BY w."shiftInstanceId"
    ) s
    WHERE si.id = s.id`;
  step('shift KPI computed from the same minutes');

  // ── Machine state records and downtime events ───────────────────────────
  //
  // Compressed from the minute states: consecutive minutes in one state are a
  // single record, which is what a state timeline is. Writing one record per
  // minute would be the same information at 60x the row count.
  const stateRows: Prisma.MachineStateRecordCreateManyInput[] = [];
  const downRows: Prisma.DowntimeEventCreateManyInput[] = [];

  for (const sr of shiftRows) {
    for (const m of lineMachines.filter((x) => x.lineCode === sr.lineCode)) {
      const end = Math.min(sr.end.getTime(), now.getTime());
      let runStart = sr.start.getTime();
      let runState = machineStateAt(f, m, runStart);

      const flush = (at: number) => {
        const mins = (at - runStart) / MINUTE;
        if (mins < 1) return;
        const isPlanned = runState === 'PLANNED_STOP' || runState === 'MAINTENANCE';
        stateRows.push({
          factoryId: ctx.factoryId,
          machineId: ctx.machineId.get(m.code)!,
          shiftInstanceId: sr.id,
          state: runState as any,
          startTime: new Date(runStart),
          endTime: new Date(at),
          durationMinutes: round(mins, 2),
          isPlannedStop: isPlanned,
        });

        // A stop longer than the machine's threshold becomes a coded event.
        const threshold = m.downtimeThreshold ?? 60;
        if (runState !== 'RUNNING' && runState !== 'STARTUP' && mins * 60 >= threshold) {
          const reason = pickDowntimeReason(f, runState, m.code, Math.floor(runStart / (15 * MINUTE)));
          const cause = reason ? f.downtimeCauses.find((c) => c.code === reason.code) : undefined;
          downRows.push({
            factoryId: ctx.factoryId,
            machineId: ctx.machineId.get(m.code)!,
            shiftInstanceId: sr.id,
            causeId: reason ? ctx.causeId.get(reason.code) ?? null : null,
            reason: cause?.name ?? runState,
            category: (cause?.category ?? 'OTHER') as any,
            startTime: new Date(runStart),
            endTime: new Date(at),
            durationMinutes: round(mins, 2),
            isPlanned,
            affectsOEE: !isPlanned,
            acknowledged: true,
            operatorId: operatorFor(ctx, m.code, sr.dayIndex) ?? null,
          });
        }
      };

      for (let t = runStart + MINUTE; t <= end; t += MINUTE) {
        const s = machineStateAt(f, m, t);
        if (s !== runState) { flush(t); runStart = t; runState = s; }
      }
      flush(end);
    }
  }
  await insertMany('machineStateRecord', stateRows, (b) => prisma.machineStateRecord.createMany({ data: b, skipDuplicates: true }));
  await insertMany('downtimeEvent', downRows, (b) => prisma.downtimeEvent.createMany({ data: b, skipDuplicates: true }));
  step(`${stateRows.length.toLocaleString()} state records · ${downRows.length.toLocaleString()} downtime events`);

  // ── Energy readings, hourly ─────────────────────────────────────────────
  const energyRows: Prisma.EnergyReadingCreateManyInput[] = [];
  for (const meter of f.energyMeters) {
    const id = ctx.meterId.get(meter.code);
    if (!id) continue;
    for (let t = from.getTime(); t < now.getTime(); t += HOUR) {
      const kw = meterLoadKw(f, meter.code, t);
      if (!kw && meter.type === 'ELECTRICAL') continue;
      energyRows.push({
        meterId: id,
        factoryId: ctx.factoryId,
        machineId: meter.machineCode ? ctx.machineId.get(meter.machineCode) ?? null : null,
        lineId: meter.lineCode ? ctx.lineId.get(meter.lineCode) ?? null : null,
        timestamp: new Date(t),
        // One hour at this load, in the meter's own unit.
        value: round(kw, 3),
        powerKw: kw,
        unit: meter.unit,
        source: 'AUTO',
        quality: 'GOOD',
      });
    }
  }
  await insertMany('energyReading', energyRows, (b) => prisma.energyReading.createMany({ data: b, skipDuplicates: true }));
  step(`${energyRows.length.toLocaleString()} energy readings`);

  // ── Alarm events ────────────────────────────────────────────────────────
  //
  // Raised from the same tag values the trend screens draw, so an alarm always
  // has a visible excursion behind it rather than appearing from nowhere.
  const alarmRows: Prisma.AlarmEventCreateManyInput[] = [];
  for (const rule of f.alarmRules) {
    const tag = f.devices.flatMap((d) => d.tags).find((t) => t.code === rule.tagCode);
    if (!tag) continue;
    const owner = f.machines.find((m) => m.code === tag.ownerCode);
    for (let t = from.getTime(); t < now.getTime(); t += 15 * MINUTE) {
      if (!isScheduled(f, t)) continue;
      const v = tagValue(f, tag.ownerCode, tag, t);
      const breached = rule.condition === 'GT' ? v > rule.threshold
        : rule.condition === 'LT' ? v < rule.threshold
        : rule.condition === 'EQ' ? v === rule.threshold : v !== rule.threshold;
      if (!breached) continue;
      // Only open one event per breach window, not one per sample.
      if (rand(`alarm:${rule.code}`, Math.floor(t / (15 * MINUTE))) > 0.22) continue;

      const dur = 3 + rand(`alarmdur:${rule.code}`, Math.floor(t / HOUR)) * 40;
      const resolved = new Date(t + dur * MINUTE);
      alarmRows.push({
        factoryId: ctx.factoryId,
        alarmDefinitionId: ctx.alarmDefId.get(rule.code) ?? null,
        machineId: owner ? ctx.machineId.get(owner.code) ?? null : null,
        code: rule.code,
        description: rule.name,
        severity: (rule.severity === 'CRITICAL' ? 'CRITICAL' : rule.severity === 'WARNING' ? 'MEDIUM' : 'INFO') as any,
        category: 'PROCESS',
        value: v,
        threshold: rule.threshold,
        triggeredAt: new Date(t),
        acknowledgedAt: new Date(t + 2 * MINUTE),
        resolvedAt: resolved <= now ? resolved : null,
        durationMinutes: resolved <= now ? round(dur, 1) : null,
      });
    }
  }
  await insertMany('alarmEvent', alarmRows, (b) => prisma.alarmEvent.createMany({ data: b, skipDuplicates: true }));
  step(`${alarmRows.length.toLocaleString()} alarm events`);


  // ── Power quality ───────────────────────────────────────────────────────
  //
  // Only for a site whose classification declares it. A factory without the
  // capability gets no rows at all rather than empty ones, so a screen that
  // should not exist cannot be reached and then found blank.
  let pqCount = 0, harmCount = 0, enCount = 0;
  if (caps.includes('POWER_QUALITY') || caps.includes('HARMONICS')) {
    const electrical = f.energyMeters.filter((m) => m.type === 'ELECTRICAL' && m.baselineKw);

    // Voltage events, judged against the ITIC ride-through envelope.
    const pqRows: Prisma.PqEventCreateManyInput[] = [];
    for (const meter of electrical) {
      const id = ctx.meterId.get(meter.code);
      if (!id) continue;
      for (const e of pqEventsInWindow(f, meter.code, from.getTime(), now.getTime())) {
        pqRows.push({
          factoryId: ctx.factoryId,
          meterId: id,
          machineId: meter.machineCode ? ctx.machineId.get(meter.machineCode) ?? null : null,
          type: e.type as any,
          severity: e.severity as any,
          startedAt: e.startedAt,
          endedAt: new Date(e.startedAt.getTime() + e.durationMs),
          durationMs: e.durationMs,
          magnitudePct: e.magnitudePct,
          phase: e.phase,
          nominalV: e.nominalV,
          minV: e.minV,
          maxV: e.maxV,
          iticZone: e.iticZone as any,
          standard: 'EN 50160',
          // A deep event on a running line is what actually costs product.
          causedScrap: e.iticZone !== 'NO_INTERRUPTION' && isScheduled(f, e.startedAt),
        });
      }
    }
    await insertMany('pqEvent', pqRows, (b) => prisma.pqEvent.createMany({ data: b, skipDuplicates: true }));
    pqCount = pqRows.length;

    // Harmonic spectra, one snapshot per phase every 15 minutes.
    const harmRows: Prisma.HarmonicSnapshotCreateManyInput[] = [];
    for (const meter of electrical) {
      const id = ctx.meterId.get(meter.code);
      if (!id) continue;
      for (let t = from.getTime(); t < now.getTime(); t += 15 * MINUTE) {
        for (const phase of ['A', 'B', 'C'] as const) {
          const h = harmonicSpectrum(f, meter.code, t, phase);
          harmRows.push({
            factoryId: ctx.factoryId,
            meterId: id,
            time: new Date(t),
            phase,
            vHarmonics: h.vHarmonics,
            iHarmonics: h.iHarmonics,
            vThd: h.vThd,
            iThd: h.iThd,
            tdd: h.tdd,
          });
        }
      }
    }
    await insertMany('harmonicSnapshot', harmRows, (b) => prisma.harmonicSnapshot.createMany({ data: b, skipDuplicates: true }));
    harmCount = harmRows.length;

    // Weekly EN 50160 assessment — the structure a consultant already reports in.
    const enRows: Prisma.En50160AssessmentCreateManyInput[] = [];
    for (const meter of electrical) {
      const id = ctx.meterId.get(meter.code);
      if (!id) continue;
      for (let w = new Date(from); w < now; w = new Date(w.getTime() + 7 * DAY)) {
        const weekEnd = new Date(Math.min(w.getTime() + 7 * DAY, now.getTime()));
        const mid = w.getTime() + 3.5 * DAY;
        const thdA = meterVoltageThd(f, meter.code, mid);
        const thdB = round(thdA * (1 + 0.06 * (rand(`thdB:${meter.code}`, w.getTime()) - 0.5)), 2);
        const thdC = round(thdA * (1 + 0.06 * (rand(`thdC:${meter.code}`, w.getTime()) - 0.5)), 2);

        // EN 50160 judges the 95% value of 10-minute windows, so a board can sit
        // above the limit for hours and still pass the week — which is exactly
        // the nuance a raw THD trend hides.
        const worst = Math.max(thdA, thdB, thdC);
        const voltageCompliance = round(clamp(100 - Math.max(0, worst - 5) * 6, 82, 100), 1);
        const spectrum = harmonicSpectrum(f, meter.code, mid, 'A');
        const harmonicResults: Record<string, unknown> = {};
        const limits: Record<number, number> = { 3: 5, 5: 6, 7: 5, 9: 1.5, 11: 3.5, 13: 3, 15: 0.5, 17: 2, 19: 1.5, 21: 0.5, 23: 1.5, 25: 1.5 };
        const failed: string[] = [];
        for (let h = 2; h <= 25; h++) {
          const v = spectrum.vHarmonics[h - 2] ?? 0;
          const limit = limits[h] ?? 0.5;
          const pass = v <= limit;
          const key = `H${String(h).padStart(2, '0')}`;
          harmonicResults[key] = { a: v, b: round(v * 1.02, 3), c: round(v * 0.98, 3), limit, pass };
          if (!pass) failed.push(key);
        }
        if (worst > 8) failed.push('THD');

        enRows.push({
          factoryId: ctx.factoryId,
          meterId: id,
          weekStart: new Date(w),
          weekEnd,
          nominalV: 230,
          freqCompliance: 100,
          voltageCompliance,
          unbalanceCompliance: round(clamp(99.6 - rand(`unb:${meter.code}`, w.getTime()) * 2.2, 95, 100), 1),
          flickerCompliance: round(clamp(99 - rand(`flk:${meter.code}`, w.getTime()) * 3, 93, 100), 1),
          thdA, thdB, thdC,
          harmonicResults: harmonicResults as Prisma.InputJsonValue,
          overallPass: failed.length === 0,
          failedItems: failed,
        });
      }
    }
    await insertMany('en50160', enRows, (b) => prisma.en50160Assessment.createMany({ data: b, skipDuplicates: true }));
    enCount = enRows.length;
    step(`${pqCount} PQ events · ${harmCount.toLocaleString()} harmonic snapshots · ${enCount} EN 50160 weeks`);
  }

  // ── SPC measurements ────────────────────────────────────────────────────
  //
  // Drawn through the same process-stress term that decides scrap, so a drifting
  // control chart and a rising Pareto bar describe one event rather than two.
  const spcRows: Prisma.SPCMeasurementCreateManyInput[] = [];
  for (const spec of f.qualitySpecs) {
    const stepDef = f.routing.find((r) => r.code === spec.stepCode);
    const mCode = stepDef?.machines[0];
    const machine = f.machines.find((m) => m.code === mCode);
    if (!machine) continue;
    let n = 0;
    for (let t = from.getTime(); t < now.getTime(); t += 30 * MINUTE) {
      if (!isScheduled(f, t)) continue;
      if (machineStateAt(f, machine, t) !== 'RUNNING') continue;
      const stress = processStress(f, machine, t);
      const r = qualityResult(f, spec.code, `${spec.code}:${t}`, stress);
      const out = (spec.lsl !== undefined && r.value < spec.lsl) || (spec.usl !== undefined && r.value > spec.usl);
      spcRows.push({
        factoryId: ctx.factoryId,
        machineId: ctx.machineId.get(machine.code)!,
        parameterName: spec.name,
        parameterUnit: spec.unit,
        value: r.value,
        sampleSize: 1,
        subgroupNumber: Math.floor(n / 5) + 1,
        measuredAt: new Date(t),
        isOutOfControl: out,
      });
      n++;
    }
  }
  await insertMany('spcMeasurement', spcRows, (b) => prisma.sPCMeasurement.createMany({ data: b, skipDuplicates: true }));
  step(`${spcRows.length.toLocaleString()} SPC measurements`);


  // ── Current status ──────────────────────────────────────────────────────
  //
  // `machine_current_status` is written by the edge gateway in a live plant.
  // Nothing writes it here yet — the Virtual Plant that feeds the real gateway
  // is not built — so every cell read OFFLINE and the twin showed a dead floor.
  //
  // The engine is deterministic, so rather than copying the last *recorded*
  // state (which is whatever the machine happened to be doing when the history
  // window ended — usually an end-of-shift planned stop) we simply ask it what
  // each machine is doing at this instant. That is the same function the
  // history was written from, so the floor agrees with the timeline behind it.
  //
  // It goes stale as the clock moves on. That is the Virtual Plant's job, and
  // until it lands this is honest rather than fabricated.
  const todayStart = startOfDay(now);
  const todayTotals = await prisma.oeeMinute.groupBy({
    by: ['machineId'],
    where: { factoryId: ctx.factoryId, bucketStart: { gte: todayStart } },
    _sum: { goodParts: true, rejectedParts: true, operatingMin: true, availabilityLossMin: true },
  });
  const totalsBy = new Map(todayTotals.map((t) => [t.machineId, t._sum]));

  for (const m of f.machines) {
    const id = ctx.machineId.get(m.code);
    if (!id) continue;
    const t = totalsBy.get(id);
    await prisma.machineCurrentStatus.update({
      where: { machineId: id },
      data: {
        state: machineStateAt(f, m, now) as any,
        goodCount: Math.round(t?.goodParts ?? 0),
        rejectCount: Math.round(t?.rejectedParts ?? 0),
        runtimeMinutes: t?.operatingMin ?? 0,
        downtimeMinutes: t?.availabilityLossMin ?? 0,
        lastEventAt: now,
      },
    }).catch(() => undefined);
  }
  step(`current status set for ${f.machines.length} machines from the engine`);

  return {
    shifts: shiftCreates.length,
    minutes: minuteRows.length,
    states: stateRows.length,
    downtime: downRows.length,
    energy: energyRows.length,
    alarms: alarmRows.length,
    spc: spcRows.length,
    pq: pqCount,
    harmonics: harmCount,
  };
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  log('\n╔══════════════════════════════════════════════════════════════╗');
  log('║  i360 Ecosystem Demo — transactional history                 ║');
  log('╚══════════════════════════════════════════════════════════════╝');
  log(`\n  window: ${HISTORY_DAYS} days${RESET ? '  ·  SEED_RESET — existing history will be dropped' : ''}`);

  const existing = await prisma.oeeMinute.count();
  if (existing > 0 && !RESET) {
    log(`\n  ${existing.toLocaleString()} measured minutes already present — nothing to do.`);
    log('  Set SEED_RESET=true to rebuild the history from the current plant model.\n');
    return;
  }

  if (RESET && existing > 0) {
    log('\n  Dropping existing history…');
    // Order matters: children before parents.
    await prisma.oeeMinute.deleteMany({});
    await prisma.pqEvent.deleteMany({});
    await prisma.harmonicSnapshot.deleteMany({});
    await prisma.en50160Assessment.deleteMany({});
    await prisma.sPCMeasurement.deleteMany({});
    await prisma.alarmEvent.deleteMany({});
    await prisma.energyReading.deleteMany({});
    await prisma.downtimeEvent.deleteMany({});
    await prisma.machineStateRecord.deleteMany({});
    await prisma.jobOrder.deleteMany({});
    await prisma.workOrder.deleteMany({});
    await prisma.productionOrder.deleteMany({});
    await prisma.shiftInstance.deleteMany({});
    step('cleared');
  }

  const now = new Date();
  const totals: Record<string, unknown>[] = [];
  for (const f of FACTORIES) {
    const t = await seedFactoryHistory(f, now);
    totals.push({ factory: f.code, ...t });
  }

  log('\n╔══════════════════════════════════════════════════════════════╗');
  log('║  History complete                                            ║');
  log('╚══════════════════════════════════════════════════════════════╝\n');
  console.table(totals);
}

main()
  .catch((e) => { console.error('\n✖ History seed failed:\n', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
