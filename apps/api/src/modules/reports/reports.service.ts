import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { KpiService } from '../production/kpi.service';
import { ReliabilityService } from '../reliability/reliability.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
    private readonly reliability: ReliabilityService,
  ) {}

  /**
   * Production report — sourced from the canonical JOB-ORDER analytics (the same
   * engine behind the Performance & KPIs pages), so OEE is time-weighted and output
   * is normalised to the product base unit (no mixed inners/cartons/pallets). Planned
   * output comes from the real production-order targets in the window (converted to
   * base units), so efficiency is meaningful instead of always 100%.
   */
  async getProductionReport(factoryId: string | null, from: Date, to: Date) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const [analytics, records, downtimeAgg] = await Promise.all([
      this.kpi.oeeAnalytics(factoryId, from, to, undefined, 'day'),
      this.kpi.oeeRecordsFromJobOrders(factoryId, from, to, undefined, 500),
      // Unplanned, OEE-affecting downtime minutes in the window
      this.prisma.downtimeEvent.aggregate({
        where: { ...factoryFilter, isPlanned: false, affectsOEE: true, startTime: { gte: from, lte: to } },
        _sum: { durationMinutes: true },
      }),
    ]);

    // In PIECES — the smallest rung of the packaging ladder. These used to be the
    // SKU inventory base unit (CARTON), which is why report totals read about a
    // quarter of the real output.
    const totalActual = Math.round(analytics.totalOutput);   // good + scrap, pieces
    const totalGood = Math.round(analytics.goodOutput);       // pieces
    const performance = analytics.current.performance ?? 0;
    // Planned = the ideal output achievable in the run time at the ideal rate; this
    // makes efficiency == OEE Performance (a real, bounded production-efficiency %),
    // instead of the old always-100% (planned == actual) placeholder.
    const totalPlanned = performance > 0 ? Math.round(totalActual / (performance / 100)) : totalActual;
    const downtimeMins = Math.round(downtimeAgg._sum.durationMinutes ?? 0);

    return {
      summary: {
        totalPlanned,
        totalActual,
        totalGood,
        totalScrap: Math.max(0, totalActual - totalGood),
        efficiency: parseFloat(performance.toFixed(1)),
        quality: parseFloat((analytics.current.quality ?? 0).toFixed(1)),
        availability: parseFloat((analytics.current.availability ?? 0).toFixed(1)),
        performance: parseFloat(performance.toFixed(1)),
        totalDowntime: downtimeMins,
        avgOEE: parseFloat((analytics.current.oee ?? 0).toFixed(1)),
        // Time-based (OEE-TB) variant for report consistency with the dashboards.
        avgOeeTb: parseFloat((analytics.current.oeeTb ?? 0).toFixed(1)),
        availabilityTb: parseFloat((analytics.current.availabilityTb ?? 0).toFixed(1)),
      },
      records: records.map((r) => ({
        date: new Date(r.recordDate).toISOString(),
        machine: r.machine?.name ?? '—',
        // Real planned vs actual (good + scrap) vs good — no longer planned == actual.
        plannedQty: Math.round((r as any).plannedOutput ?? 0),
        actualQty: r.totalOutput,
        goodQty: r.goodOutput,
        oee: r.oee,
        downtime: 0,
      })),
    };
  }

  /**
   * Quality report — inspection-based quality KPIs over [from, to].
   *
   * FPY and Defect Rate use exactly the same definitions as the Quality module KPI cards
   * (QualityService.getKPIs), so the Analytics report and the Quality cockpit agree:
   *
   *   FPY        = Σ passQty ÷ Σ totalQty × 100   (units accepted first time, no rework)
   *   Defect Rate= Σ failQty ÷ Σ totalQty × 100   (= 100 − FPY)
   *
   * Both are exposed at the top level (the report/KPI cards read these) and inside
   * `summary` (the report builder reads that), so no consumer has to reshape the payload.
   */
  async getQualityReport(factoryId: string | null, from: Date, to: Date) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const [inspections, ncrs] = await Promise.all([
      this.prisma.inspectionResult.findMany({
        where: { ...factoryFilter, inspectedAt: { gte: from, lte: to } },
        include: { inspector: { select: { name: true } } },
        orderBy: { inspectedAt: 'asc' },
      }),
      this.prisma.nCR.findMany({
        where: { ...factoryFilter, detectedAt: { gte: from, lte: to } },
        orderBy: { severity: 'desc' },
      }),
    ]);

    const totalInspected = inspections.reduce((s, i) => s + i.totalQty, 0);
    const totalPassed = inspections.reduce((s, i) => s + i.passQty, 0);
    const totalFailed = inspections.reduce((s, i) => s + i.failQty, 0);

    const r1 = (n: number) => parseFloat(n.toFixed(1));
    const fpy = totalInspected > 0 ? r1((totalPassed / totalInspected) * 100) : 0;
    const defectRate = totalInspected > 0 ? r1((totalFailed / totalInspected) * 100) : 0;
    const defectPpm = totalInspected > 0 ? Math.round((totalFailed / totalInspected) * 1_000_000) : 0;

    // Daily FPY / defect-rate trend so the report shows movement, not just a snapshot.
    const dayMs = 86_400_000;
    const trendMap = new Map<string, { pass: number; fail: number; total: number }>();
    for (const i of inspections) {
      const key = new Date(i.inspectedAt).toISOString().slice(0, 10);
      const b = trendMap.get(key) ?? { pass: 0, fail: 0, total: 0 };
      b.pass += i.passQty; b.fail += i.failQty; b.total += i.totalQty;
      trendMap.set(key, b);
    }
    const trend = [...trendMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, b]) => ({
        date,
        fpy: b.total > 0 ? r1((b.pass / b.total) * 100) : 0,
        defectRate: b.total > 0 ? r1((b.fail / b.total) * 100) : 0,
        inspected: b.total,
      }));

    // Defect Pareto from NCRs, weighted by affected quantity.
    const byCategory = new Map<string, { quantity: number; count: number }>();
    for (const n of ncrs) {
      const key = (n as any).defectCategory || 'OTHER';
      const e = byCategory.get(key) ?? { quantity: 0, count: 0 };
      e.quantity += (n as any).quantity ?? 0;
      e.count += 1;
      byCategory.set(key, e);
    }
    const defectPareto = [...byCategory.entries()]
      .map(([category, v]) => ({ category, quantity: v.quantity, count: v.count }))
      .sort((a, b) => b.quantity - a.quantity || b.count - a.count);

    const summary = {
      totalInspections: inspections.length,
      totalInspected,
      totalPassed,
      totalFailed,
      fpy,
      defectRate,
      defectPpm,
      // passRate is kept as an alias of FPY for existing consumers.
      passRate: fpy,
      totalNCRs: ncrs.length,
      criticalNCRs: ncrs.filter((n) => n.severity === 'CRITICAL').length,
      windowDays: Math.max(1, Math.round((to.getTime() - from.getTime()) / dayMs)),
    };

    return {
      // Flat KPIs — what the Quality Report cards bind to.
      fpy,
      defectRate,
      defectPpm,
      inspectionCount: inspections.length,
      ncrCount: ncrs.length,
      criticalNcrCount: summary.criticalNCRs,
      totalInspected,
      totalPassed,
      totalFailed,
      trend,
      defectPareto,
      methodology: {
        fpy: 'Σ inspection pass qty ÷ Σ inspection total qty × 100',
        defectRate: 'Σ inspection fail qty ÷ Σ inspection total qty × 100 (= 100 − FPY)',
        source: 'InspectionResult records with inspectedAt inside the report window',
        note: 'Identical to the Quality module KPI cards; NCR counts are informational and do not feed FPY.',
      },
      // Detail payload — unchanged shape for the report builder / exports.
      summary,
      inspections,
      ncrs,
    };
  }

  /**
   * Maintenance report — work-order completion, reliability (MTTR/MTBF) and cost,
   * plus by-type / by-status breakdowns, over [from, to]. Backs /reports/maintenance.
   *
   * MTTR/MTBF are delegated to the canonical ReliabilityService so this report, the
   * Maintenance cockpit and the Downtime Command Center all compute from one rule set.
   * The headline figures are the maintenance lens (work-order based); the equipment lens
   * (downtime-stop based, what the Downtime Command Center shows) is returned alongside
   * with the variance, so the two can be reconciled instead of merely compared.
   */
  async getMaintenanceReport(factoryId: string | null, from: Date, to: Date) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const [wos, reliability] = await Promise.all([
      this.prisma.maintenanceWO.findMany({
        where: { ...factoryFilter, deletedAt: null, createdAt: { gte: from, lte: to } },
        select: {
          type: true, status: true, actualHours: true, laborCost: true, partsCost: true,
          totalCost: true, createdAt: true, completedAt: true,
        },
      }),
      this.reliability.compute(factoryId, undefined, from, to),
    ]);

    const totalWO = wos.length;
    const completed = wos.filter((w) => w.status === 'COMPLETED');
    const completionRate = totalWO > 0 ? (completed.length / totalWO) * 100 : 0;

    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCost = 0;
    for (const w of wos) {
      byType[w.type] = (byType[w.type] ?? 0) + 1;
      byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
      totalCost += w.totalCost ?? ((w.laborCost ?? 0) + (w.partsCost ?? 0));
    }

    return {
      // Headline reliability — maintenance (work-order) lens.
      mtbf: reliability.maintenance.mtbfHours,
      mttr: reliability.maintenance.mttrHours,
      totalWO,
      completedWO: completed.length,
      completionRate: parseFloat(completionRate.toFixed(1)),
      failures: reliability.maintenance.failures,
      totalCost: parseFloat(totalCost.toFixed(2)),
      byType,
      byStatus,
      window: { from: from.toISOString(), to: to.toISOString() },
      // Full reliability picture: both lenses, their inputs, the variance and the rules.
      reliability,
    };
  }

  async getAvailableReports() {
    return [
      {
        id: 'production-summary',
        name: 'Production Summary',
        description: 'Daily/weekly production output, OEE, and efficiency',
        module: 'production',
        icon: 'Factory',
      },
      {
        id: 'quality-summary',
        name: 'Quality Summary',
        description: 'Inspection results, NCR trends, and FPY analysis',
        module: 'quality',
        icon: 'ShieldCheck',
      },
      {
        id: 'maintenance-summary',
        name: 'Maintenance Report',
        description: 'Work order completion, MTTR/MTBF, and PM compliance',
        module: 'maintenance',
        icon: 'Wrench',
      },
      {
        id: 'oee-analysis',
        name: 'OEE Deep Dive',
        description: 'Detailed OEE breakdown by machine, shift, and SKU',
        module: 'production',
        icon: 'Gauge',
      },
      {
        id: 'downtime-analysis',
        name: 'Downtime Pareto',
        description: 'Root cause analysis with Pareto charts',
        module: 'production',
        icon: 'BarChart3',
      },
    ];
  }
}
