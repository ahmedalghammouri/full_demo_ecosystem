import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MaintStatus, MaintType, NCRStatus, Severity } from '@prisma/client';
import { KpiService } from '../production/kpi.service';

export type InsightType = 'anomaly' | 'optimization' | 'prediction' | 'energy';
export type InsightSeverity = 'high' | 'medium' | 'low';

export interface AiInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  recommendation: string;
  confidence: number;
  impact: string;
  equipmentId: string;
  detectedAt: string;
}

export interface EquipmentHealth {
  machineId: string;
  name: string;
  health: number;
  trend: 'improving' | 'declining' | 'stable';
  risk: 'High' | 'Medium' | 'Low';
}

export interface AiMetric {
  label: string;
  value: string;
  sub: string;
}

export interface AiDetector {
  name: string;
  type: string;
  coverage: string;
  status: 'active' | 'idle';
}

const DAY_MS = 86_400_000;

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  /** Resolve an analysis scope (area/line/machine) to the machine ids it covers (undefined = whole factory). */
  private async scopeMachineIds(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ): Promise<string[] | undefined> {
    if (!scope || (!scope.areaId && !scope.lineId && !scope.machineId)) return undefined;
    if (scope.machineId) return [scope.machineId];
    const ms = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
        ...(scope.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true },
    });
    return ms.map((m) => m.id);
  }

  /**
   * Derives real, rule-based intelligence from operational data across modules.
   * No external ML — these are deterministic detectors over live MES data.
   * When `scope` is set, the machine query and every per-machine `where` clause
   * is restricted to the machines that scope covers (area/line/machine).
   */
  async getInsights(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since15 = new Date(now.getTime() - 15 * DAY_MS);
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const prev7 = new Date(now.getTime() - 14 * DAY_MS);

    // Scope → machine-id set applied to every machine-bound query (undefined = whole factory).
    const machineIds = await this.scopeMachineIds(factoryId, scope);
    // Filters scoped to the machine set. NCRs/SPC carry a nullable machineId, so a
    // machine-scoped filter must still allow `null` would exclude unattributed rows —
    // we intentionally restrict those to the scoped machines only when a scope is set.
    const machineScope = machineIds ? { machineId: { in: machineIds } } : {};
    const machineIdScope = machineIds ? { id: { in: machineIds } } : {};

    const machines = await this.prisma.machine.findMany({
      where: { ...factoryFilter, ...machineIdScope, isActive: true },
      select: { id: true, code: true, name: true },
    });
    const machineMap = new Map(machines.map((m) => [m.id, m]));

    const [downtime30, openCorrective, overdueWOs, oocSpc, openNcrs, oeeRecent, oeePrior] =
      await Promise.all([
        this.prisma.downtimeEvent.findMany({
          where: { ...factoryFilter, ...machineScope, startTime: { gte: since30 }, affectsOEE: true },
          select: { machineId: true, durationMinutes: true, startTime: true },
        }),
        this.prisma.maintenanceWO.findMany({
          where: {
            ...factoryFilter, ...machineScope,
            type: { in: [MaintType.CORRECTIVE, MaintType.EMERGENCY] },
            status: { notIn: [MaintStatus.COMPLETED, MaintStatus.CANCELLED] },
            deletedAt: null,
          },
          select: { id: true, machineId: true, title: true, priority: true, createdAt: true },
        }),
        this.prisma.maintenanceWO.findMany({
          where: {
            ...factoryFilter, ...machineScope,
            status: { notIn: [MaintStatus.COMPLETED, MaintStatus.CANCELLED] },
            dueDate: { lt: now },
            deletedAt: null,
          },
          select: { id: true, machineId: true, title: true, dueDate: true },
        }),
        this.prisma.sPCMeasurement.findMany({
          where: { ...factoryFilter, ...machineScope, isOutOfControl: true, measuredAt: { gte: since7 } },
          select: {
            id: true, machineId: true, parameterName: true, parameterUnit: true,
            value: true, controlViolation: true, measuredAt: true,
          },
          orderBy: { measuredAt: 'desc' },
        }),
        this.prisma.nCR.findMany({
          where: {
            ...factoryFilter, ...machineScope,
            status: { notIn: [NCRStatus.RESOLVED, NCRStatus.CLOSED] },
          },
          select: {
            id: true, ncrNumber: true, title: true, severity: true,
            defectCategory: true, machineId: true, quantity: true, detectedAt: true,
          },
          orderBy: { detectedAt: 'desc' },
        }),
        this.kpi.snapshotsEnabled()
          ? this.kpi.snapshotScope(factoryId, since7, now, machineIds).then((b) => ({ _avg: { oee: b.oee } }))
          : this.prisma.oEERecord.aggregate({ where: { ...factoryFilter, ...machineScope, recordDate: { gte: since7 } }, _avg: { oee: true } }),
        this.kpi.snapshotsEnabled()
          ? this.kpi.snapshotScope(factoryId, prev7, since7, machineIds).then((b) => ({ _avg: { oee: b.oee } }))
          : this.prisma.oEERecord.aggregate({ where: { ...factoryFilter, ...machineScope, recordDate: { gte: prev7, lt: since7 } }, _avg: { oee: true } }),
      ]);

    // ── Per-machine downtime aggregation (recent vs previous half) ──
    const dtRecent = new Map<string, number>();
    const dtPrev = new Map<string, number>();
    for (const e of downtime30) {
      const mins = e.durationMinutes ?? 0;
      if (e.startTime >= since15) {
        dtRecent.set(e.machineId, (dtRecent.get(e.machineId) ?? 0) + mins);
      } else {
        dtPrev.set(e.machineId, (dtPrev.get(e.machineId) ?? 0) + mins);
      }
    }

    const correctiveByMachine = new Map<string, number>();
    for (const wo of openCorrective) {
      correctiveByMachine.set(wo.machineId, (correctiveByMachine.get(wo.machineId) ?? 0) + 1);
    }
    const overdueByMachine = new Map<string, number>();
    for (const wo of overdueWOs) {
      if (wo.machineId) overdueByMachine.set(wo.machineId, (overdueByMachine.get(wo.machineId) ?? 0) + 1);
    }

    // ── Equipment health ──
    const equipmentHealth: EquipmentHealth[] = machines.map((m) => {
      const recent = dtRecent.get(m.id) ?? 0;
      const prev = dtPrev.get(m.id) ?? 0;
      const corrective = correctiveByMachine.get(m.id) ?? 0;
      const overdue = overdueByMachine.get(m.id) ?? 0;

      const downtimePenalty = Math.min((recent / 60) * 2, 40);
      const maintPenalty = Math.min(corrective * 8 + overdue * 5, 40);
      const health = Math.round(clamp(100 - downtimePenalty - maintPenalty, 0, 100));

      let trend: EquipmentHealth['trend'] = 'stable';
      if (recent > prev * 1.2 && recent - prev > 30) trend = 'declining';
      else if (prev > recent * 1.2 && prev - recent > 30) trend = 'improving';

      const risk: EquipmentHealth['risk'] = health < 60 ? 'High' : health < 80 ? 'Medium' : 'Low';

      return { machineId: m.id, name: `${m.name} (${m.code})`, health, trend, risk };
    });
    equipmentHealth.sort((a, b) => a.health - b.health);

    // ── Insights (rule-based detectors) ──
    const insights: AiInsight[] = [];

    // 1. Predictive maintenance: machines with degrading health
    for (const eq of equipmentHealth) {
      if (eq.health >= 70 && eq.trend !== 'declining') continue;
      const recent = dtRecent.get(eq.machineId) ?? 0;
      const corrective = correctiveByMachine.get(eq.machineId) ?? 0;
      if (recent < 30 && corrective === 0) continue;

      const severity: InsightSeverity = eq.health < 55 ? 'high' : eq.health < 75 ? 'medium' : 'low';
      const confidence = clamp(60 + (100 - eq.health) / 2, 60, 96);
      insights.push({
        id: `pm-${eq.machineId}`,
        type: eq.trend === 'declining' ? 'anomaly' : 'prediction',
        severity,
        title: `${eq.name} reliability degradation detected`,
        description:
          `Health index at ${eq.health}% with ${Math.round(recent)} min of unplanned downtime in the last 15 days` +
          `${corrective > 0 ? ` and ${corrective} open corrective work order${corrective === 1 ? '' : 's'}` : ''}. ` +
          `Trend is ${eq.trend}.`,
        recommendation:
          corrective > 0
            ? 'Prioritise the open corrective work order and inspect for recurring failure mode.'
            : 'Schedule a preventive inspection during the next planned shutdown.',
        confidence: Math.round(confidence),
        impact: `Avoid ~${Math.max(2, Math.round(recent / 60))}h projected unplanned downtime`,
        equipmentId: eq.name.split(' (')[0],
        detectedAt: relativeTime(now),
      });
    }

    // 2. Quality: SPC out-of-control clusters
    const spcByParam = new Map<string, typeof oocSpc>();
    for (const s of oocSpc) {
      const key = `${s.machineId}::${s.parameterName}`;
      if (!spcByParam.has(key)) spcByParam.set(key, []);
      spcByParam.get(key)!.push(s);
    }
    for (const [key, group] of spcByParam) {
      if (group.length === 0) continue;
      const latest = group[0];
      const machine = latest.machineId ? machineMap.get(latest.machineId) : undefined;
      const eqLabel = machine ? `${machine.name} (${machine.code})` : 'Process';
      const severity: InsightSeverity = group.length >= 3 ? 'high' : group.length === 2 ? 'medium' : 'low';
      insights.push({
        id: `spc-${key}`,
        type: 'prediction',
        severity,
        title: `Process drift on ${latest.parameterName} (${eqLabel})`,
        description:
          `${group.length} out-of-control measurement${group.length === 1 ? '' : 's'} in the last 7 days` +
          `${latest.controlViolation ? ` (${latest.controlViolation})` : ''}. ` +
          `Latest reading ${latest.value.toFixed(2)}${latest.parameterUnit ? ` ${latest.parameterUnit}` : ''}.`,
        recommendation: 'Verify calibration and review process parameters before the next run.',
        confidence: clamp(65 + group.length * 7, 65, 95),
        impact: 'Prevents potential NCR and downstream rework',
        equipmentId: machine?.code ?? latest.parameterName,
        detectedAt: relativeTime(latest.measuredAt),
      });
    }

    // 3. Quality: open critical/major NCRs
    for (const ncr of openNcrs.filter((n) => n.severity !== Severity.MINOR).slice(0, 5)) {
      const machine = ncr.machineId ? machineMap.get(ncr.machineId) : undefined;
      insights.push({
        id: `ncr-${ncr.id}`,
        type: 'anomaly',
        severity: ncr.severity === Severity.CRITICAL ? 'high' : 'medium',
        title: `Open ${ncr.severity.toLowerCase()} NCR: ${ncr.title}`,
        description:
          `${ncr.ncrNumber} — ${ncr.defectCategory} affecting ${ncr.quantity} unit${ncr.quantity === 1 ? '' : 's'}` +
          `${machine ? ` on ${machine.name} (${machine.code})` : ''}.`,
        recommendation: 'Assign a CAPA owner and complete root-cause analysis before disposition.',
        confidence: 90,
        impact: `${ncr.quantity} unit${ncr.quantity === 1 ? '' : 's'} at risk of scrap/rework`,
        equipmentId: machine?.code ?? 'Quality',
        detectedAt: relativeTime(ncr.detectedAt),
      });
    }

    // Order: high severity first, then by confidence
    const sevRank: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2 };
    insights.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.confidence - a.confidence);

    // ── Metrics ──
    const anomaliesDetected = insights.filter((i) => i.severity === 'high').length;
    const avgConfidence = insights.length
      ? Math.round(insights.reduce((s, i) => s + i.confidence, 0) / insights.length)
      : 0;
    const oeeNow = oeeRecent._avg.oee ?? null;
    const oeeBefore = oeePrior._avg.oee ?? null;
    const oeeDelta = oeeNow != null && oeeBefore != null ? oeeNow - oeeBefore : null;

    const metrics: AiMetric[] = [
      { label: 'Active Insights', value: String(insights.length), sub: 'Live detectors' },
      { label: 'Anomalies Detected', value: String(anomaliesDetected), sub: 'High severity' },
      {
        label: 'OEE Trend (7d)',
        value: oeeDelta != null ? `${oeeDelta >= 0 ? '+' : ''}${oeeDelta.toFixed(1)}%` : '—',
        sub: 'vs previous week',
      },
      { label: 'Avg. Confidence', value: insights.length ? `${avgConfidence}%` : '—', sub: 'Detector certainty' },
    ];

    // ── Detectors (real, deterministic — replaces fictional "ML models") ──
    const detectors: AiDetector[] = [
      {
        name: 'Reliability Degradation',
        type: 'Downtime + maintenance rules',
        coverage: `${machines.length} machines`,
        status: 'active',
      },
      {
        name: 'SPC Drift Detector',
        type: 'Western Electric rules',
        coverage: `${oocSpc.length} OOC points (7d)`,
        status: oocSpc.length > 0 ? 'active' : 'idle',
      },
      {
        name: 'NCR Risk Monitor',
        type: 'Open non-conformance scan',
        coverage: `${openNcrs.length} open NCRs`,
        status: openNcrs.length > 0 ? 'active' : 'idle',
      },
      {
        name: 'OEE Trend Analyzer',
        type: 'Week-over-week aggregation',
        coverage: oeeNow != null ? `${oeeNow.toFixed(1)}% avg OEE` : 'No OEE data',
        status: oeeNow != null ? 'active' : 'idle',
      },
    ];

    return { metrics, insights, equipmentHealth: equipmentHealth.slice(0, 8), detectors };
  }
}
