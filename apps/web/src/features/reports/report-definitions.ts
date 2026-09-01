'use client';

import type { ExportColumn } from '@/lib/export-utils';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type TFn = (key: string, opts?: Record<string, unknown>) => string;

export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const pct = (v: unknown, digits = 1): string => `${num(v).toFixed(digits)}%`;

export const int = (v: unknown): string => Math.round(num(v)).toLocaleString();

export const dec = (v: unknown, digits = 1): string => num(v).toLocaleString(undefined, {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

export const sar = (v: unknown): string => `${num(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} SAR`;

export const fmtDate = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};

export const fmtDateTime = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

/** Resolve a possibly-nested machine/product/sku object to its display name. */
export const resolveName = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return String(o.name ?? o.code ?? o.title ?? o.label ?? '—');
  }
  return String(v);
};

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface Kpi {
  label: string;
  value: string;
  tone: 'brand' | 'green' | 'amber' | 'cyan' | 'red' | 'purple' | 'blue' | 'teal';
}

export interface ChartSpec {
  id: string;
  title: string;
  /** Chart variant the view knows how to render. */
  kind: 'line' | 'area' | 'bar' | 'barH' | 'donut';
  data: Array<Record<string, unknown>>;
  /** category axis key */
  xKey: string;
  /** one or more series keys with display names */
  series: Array<{ key: string; name: string; color: string }>;
  unit?: string;
  emptyKey: string;
}

export interface ReportModel {
  kpis: Kpi[];
  charts: ChartSpec[];
  /** Flat, display-ready rows for the table + exports. */
  rows: Row[];
  /** Column defs shared by the table, Excel and PDF. */
  columns: ExportColumn<Row>[];
  /** Names available for the machine dropdown (row-array reports). */
  machineNames?: string[];
  /** Key used to read the machine name off a row for the dropdown filter. */
  machineKey?: string;
}

const COLORS = {
  brand: '#4c7571',
  cyan: '#06b6d4',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
  blue: '#3b82f6',
  teal: '#14b8a6',
};

export const DONUT_COLORS = ['#4c7571', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#3b82f6', '#14b8a6', '#ec4899', '#84cc16'];

// ---------------------------------------------------------------------------
// Per-type model builders
// ---------------------------------------------------------------------------

function buildProduction(data: any, t: TFn): ReportModel {
  const summary = data?.summary ?? {};
  const records: any[] = Array.isArray(data?.records) ? data.records : [];

  const kpis: Kpi[] = [
    { label: t('reports.builder.kpi.avgOee'), value: pct(summary.avgOEE), tone: 'brand' },
    { label: t('reports.builder.kpi.availability'), value: pct(summary.availability), tone: 'cyan' },
    { label: t('reports.builder.kpi.performance'), value: pct(summary.performance), tone: 'blue' },
    { label: t('reports.builder.kpi.quality'), value: pct(summary.quality), tone: 'green' },
    { label: t('reports.builder.kpi.output'), value: int(summary.totalActual), tone: 'teal' },
    { label: t('reports.builder.kpi.downtime'), value: int(summary.totalDowntime), tone: 'amber' },
  ];

  // OEE trend + output good vs scrap aggregated by day
  const byDay: Record<string, { oeeSum: number; oeeCount: number; good: number; actual: number }> = {};
  for (const r of records) {
    const day = String(r.date ?? '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { oeeSum: 0, oeeCount: 0, good: 0, actual: 0 };
    byDay[day].oeeSum += num(r.oee);
    byDay[day].oeeCount += 1;
    byDay[day].good += num(r.goodQty);
    byDay[day].actual += num(r.actualQty);
  }
  const days = Object.keys(byDay).sort();
  const oeeTrend = days.map((d) => ({
    date: d.slice(5),
    oee: parseFloat((byDay[d].oeeSum / Math.max(1, byDay[d].oeeCount)).toFixed(1)),
  }));
  const outputTrend = days.map((d) => ({
    date: d.slice(5),
    good: Math.round(byDay[d].good),
    scrap: Math.round(Math.max(0, byDay[d].actual - byDay[d].good)),
  }));

  const charts: ChartSpec[] = [
    {
      id: 'oeeTrend', title: t('reports.builder.chart.oeeTrend'), kind: 'area', data: oeeTrend,
      xKey: 'date', unit: '%', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'oee', name: t('reports.builder.kpi.avgOee'), color: COLORS.brand }],
    },
    {
      id: 'output', title: t('reports.builder.chart.outputGoodScrap'), kind: 'bar', data: outputTrend,
      xKey: 'date', emptyKey: 'reports.builder.chart.noData',
      series: [
        { key: 'good', name: t('reports.builder.chart.good'), color: COLORS.green },
        { key: 'scrap', name: t('reports.builder.chart.scrap'), color: COLORS.red },
      ],
    },
  ];

  const rows: Row[] = records.map((r) => ({
    date: r.date, machine: resolveName(r.machine), plannedQty: num(r.plannedQty),
    actualQty: num(r.actualQty), goodQty: num(r.goodQty), oee: r.oee, downtime: num(r.downtime),
  }));

  const columns: ExportColumn<Row>[] = [
    { key: 'date', label: t('reports.builder.col.date'), value: (r) => fmtDate(r.date) },
    { key: 'machine', label: t('reports.builder.col.machine'), value: (r) => String(r.machine) },
    { key: 'plannedQty', label: t('reports.builder.col.planned'), value: (r) => int(r.plannedQty) },
    { key: 'actualQty', label: t('reports.builder.col.actual'), value: (r) => int(r.actualQty) },
    { key: 'goodQty', label: t('reports.builder.col.good'), value: (r) => int(r.goodQty) },
    { key: 'oee', label: t('reports.builder.col.oee'), value: (r) => (r.oee == null ? '—' : pct(r.oee)) },
    { key: 'downtime', label: t('reports.builder.col.downtimeMin'), value: (r) => int(r.downtime) },
  ];

  return { kpis, charts, rows, columns };
}

function buildOee(data: any, t: TFn): ReportModel {
  // /production/oee-records is paginated → unwrap { data, total }; also accept a raw array.
  const records: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  const avg = (sel: (r: any) => number) =>
    records.length ? records.reduce((s, r) => s + sel(r), 0) / records.length : 0;
  const machineSet = new Set(records.map((r) => resolveName(r.machine)));

  const kpis: Kpi[] = [
    { label: t('reports.builder.kpi.avgOee'), value: pct(avg((r) => num(r.oee))), tone: 'brand' },
    { label: t('reports.builder.kpi.avgAtOee'), value: pct(avg((r) => num(r.oeeTb))), tone: 'cyan' },
    { label: t('reports.builder.kpi.avgAvailability'), value: pct(avg((r) => num(r.availability))), tone: 'blue' },
    { label: t('reports.builder.kpi.machines'), value: int(machineSet.size), tone: 'purple' },
    { label: t('reports.builder.kpi.records'), value: int(records.length), tone: 'teal' },
  ];

  // trend by recordDate
  const byDay: Record<string, { sum: number; count: number }> = {};
  for (const r of records) {
    const day = String(r.recordDate ?? '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { sum: 0, count: 0 };
    byDay[day].sum += num(r.oee);
    byDay[day].count += 1;
  }
  const oeeTrend = Object.keys(byDay).sort().map((d) => ({
    date: d.slice(5),
    oee: parseFloat((byDay[d].sum / Math.max(1, byDay[d].count)).toFixed(1)),
  }));

  // by machine average
  const byMachine: Record<string, { sum: number; count: number }> = {};
  for (const r of records) {
    const m = resolveName(r.machine);
    if (!byMachine[m]) byMachine[m] = { sum: 0, count: 0 };
    byMachine[m].sum += num(r.oee);
    byMachine[m].count += 1;
  }
  const machineAvg = Object.entries(byMachine)
    .map(([machine, v]) => ({ machine, oee: parseFloat((v.sum / Math.max(1, v.count)).toFixed(1)) }))
    .sort((a, b) => b.oee - a.oee);

  const charts: ChartSpec[] = [
    {
      id: 'oeeTrend', title: t('reports.builder.chart.oeeTrend'), kind: 'area', data: oeeTrend,
      xKey: 'date', unit: '%', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'oee', name: t('reports.builder.kpi.avgOee'), color: COLORS.purple }],
    },
    {
      id: 'byMachine', title: t('reports.builder.chart.byMachine'), kind: 'barH', data: machineAvg,
      xKey: 'machine', unit: '%', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'oee', name: t('reports.builder.kpi.avgOee'), color: COLORS.brand }],
    },
  ];

  const rows: Row[] = records.map((r) => ({
    recordDate: r.recordDate, machine: resolveName(r.machine), oee: r.oee, availability: r.availability,
    performance: r.performance, quality: r.quality, oeeTb: r.oeeTb,
    plannedOutput: num(r.plannedOutput), totalOutput: num(r.totalOutput), goodOutput: num(r.goodOutput),
  }));

  const columns: ExportColumn<Row>[] = [
    { key: 'recordDate', label: t('reports.builder.col.date'), value: (r) => fmtDate(r.recordDate) },
    { key: 'machine', label: t('reports.builder.col.machine'), value: (r) => String(r.machine) },
    { key: 'oee', label: t('reports.builder.col.oee'), value: (r) => pct(r.oee) },
    { key: 'availability', label: t('reports.builder.col.availability'), value: (r) => pct(r.availability) },
    { key: 'performance', label: t('reports.builder.col.performance'), value: (r) => pct(r.performance) },
    { key: 'quality', label: t('reports.builder.col.quality'), value: (r) => pct(r.quality) },
    { key: 'oeeTb', label: t('reports.builder.col.atOee'), value: (r) => pct(r.oeeTb) },
    { key: 'goodOutput', label: t('reports.builder.col.good'), value: (r) => int(r.goodOutput) },
  ];

  return {
    kpis, charts, rows, columns,
    machineNames: [...machineSet].sort(),
    machineKey: 'machine',
  };
}

function buildScrap(data: any, t: TFn): ReportModel {
  const records: any[] = Array.isArray(data) ? data : [];

  const totalQty = records.reduce((s, r) => s + num(r.qty), 0);
  const byCat: Record<string, number> = {};
  for (const r of records) {
    const c = String(r.category ?? 'OTHER');
    byCat[c] = (byCat[c] ?? 0) + num(r.qty);
  }
  const categories = Object.keys(byCat);
  const topCat = categories.sort((a, b) => byCat[b] - byCat[a])[0] ?? '—';

  const kpis: Kpi[] = [
    { label: t('reports.builder.kpi.scrapEvents'), value: int(records.length), tone: 'red' },
    { label: t('reports.builder.kpi.totalScrapQty'), value: int(totalQty), tone: 'amber' },
    { label: t('reports.builder.kpi.categories'), value: int(categories.length), tone: 'purple' },
    { label: t('reports.builder.kpi.topCategory'), value: topCat, tone: 'brand' },
  ];

  // Pareto by reason (fallback category), sorted desc
  const byReason: Record<string, number> = {};
  for (const r of records) {
    const key = String(r.reason || r.category || t('reports.builder.chart.unspecified'));
    byReason[key] = (byReason[key] ?? 0) + num(r.qty);
  }
  const pareto = Object.entries(byReason)
    .map(([reason, qty]) => ({ reason, qty: Math.round(qty) }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const machineSet = new Set(
    records.map((r) => resolveName(r.workOrder?.sku ?? r.product ?? r.machine)).filter((n) => n !== '—'),
  );

  const charts: ChartSpec[] = [
    {
      id: 'pareto', title: t('reports.builder.chart.scrapPareto'), kind: 'bar', data: pareto,
      xKey: 'reason', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'qty', name: t('reports.builder.col.qty'), color: COLORS.red }],
    },
  ];

  const rows: Row[] = records.map((r) => ({
    createdAt: r.createdAt,
    category: r.category,
    qty: num(r.qty),
    product: resolveName(r.workOrder?.sku ?? r.product),
    operation: resolveName(r.jobOrder?.operationName ?? r.jobOrder ?? r.operation),
    operator: resolveName(r.operator),
    reason: r.reason ?? '—',
  }));

  const columns: ExportColumn<Row>[] = [
    { key: 'createdAt', label: t('reports.builder.col.date'), value: (r) => fmtDateTime(r.createdAt) },
    { key: 'category', label: t('reports.builder.col.category'), value: (r) => String(r.category ?? '—') },
    { key: 'qty', label: t('reports.builder.col.qty'), value: (r) => int(r.qty) },
    { key: 'product', label: t('reports.builder.col.product'), value: (r) => String(r.product) },
    { key: 'operation', label: t('reports.builder.col.operation'), value: (r) => String(r.operation) },
    { key: 'operator', label: t('reports.builder.col.operator'), value: (r) => String(r.operator) },
    { key: 'reason', label: t('reports.builder.col.reason'), value: (r) => String(r.reason) },
  ];

  return {
    kpis, charts, rows, columns,
    machineNames: [...machineSet].sort(),
    machineKey: 'product',
  };
}

function buildMaintenance(data: any, t: TFn): ReportModel {
  const d = data ?? {};
  const kpis: Kpi[] = [
    { label: t('reports.builder.kpi.mttr'), value: dec(d.mttr), tone: 'amber' },
    { label: t('reports.builder.kpi.mtbf'), value: dec(d.mtbf), tone: 'cyan' },
    { label: t('reports.builder.kpi.completionRate'), value: pct(d.completionRate), tone: 'green' },
    { label: t('reports.builder.kpi.workOrders'), value: int(d.totalWO), tone: 'blue' },
    { label: t('reports.builder.kpi.totalCost'), value: sar(d.totalCost), tone: 'brand' },
    { label: t('reports.builder.kpi.failures'), value: int(d.failures), tone: 'red' },
  ];

  const byType = d.byType ?? {};
  const byStatus = d.byStatus ?? {};
  const typeData = Object.entries(byType).map(([k, v]) => ({ name: k, count: num(v) }));
  const statusData = Object.entries(byStatus).map(([k, v]) => ({ name: k, count: num(v) }));

  const charts: ChartSpec[] = [
    {
      id: 'byType', title: t('reports.builder.chart.byType'), kind: 'bar', data: typeData,
      xKey: 'name', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'count', name: t('reports.builder.col.count'), color: COLORS.brand }],
    },
    {
      id: 'byStatus', title: t('reports.builder.chart.byStatus'), kind: 'donut', data: statusData,
      xKey: 'name', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'count', name: t('reports.builder.col.count'), color: COLORS.cyan }],
    },
  ];

  // Combined breakdown table (type + status counts)
  const rows: Row[] = [
    ...typeData.map((r) => ({ group: t('reports.builder.chart.byType'), name: r.name, count: r.count })),
    ...statusData.map((r) => ({ group: t('reports.builder.chart.byStatus'), name: r.name, count: r.count })),
  ];
  const columns: ExportColumn<Row>[] = [
    { key: 'group', label: t('reports.builder.col.group'), value: (r) => String(r.group) },
    { key: 'name', label: t('reports.builder.col.name'), value: (r) => String(r.name) },
    { key: 'count', label: t('reports.builder.col.count'), value: (r) => int(r.count) },
  ];

  return { kpis, charts, rows, columns };
}

function buildQuality(data: any, t: TFn): ReportModel {
  const summary = data?.summary ?? {};
  const ncrs: any[] = Array.isArray(data?.ncrs) ? data.ncrs : [];

  const passed = num(summary.totalPassed);
  const inspected = num(summary.totalInspected);
  const failed = Math.max(0, inspected - passed);

  const kpis: Kpi[] = [
    { label: t('reports.builder.kpi.inspections'), value: int(summary.totalInspections), tone: 'blue' },
    { label: t('reports.builder.kpi.passRate'), value: pct(summary.passRate), tone: 'green' },
    { label: t('reports.builder.kpi.ncrs'), value: int(summary.totalNCRs), tone: 'amber' },
    { label: t('reports.builder.kpi.criticalNcrs'), value: int(summary.criticalNCRs), tone: 'red' },
  ];

  const passFail = [
    { name: t('reports.builder.chart.passed'), count: Math.round(passed) },
    { name: t('reports.builder.chart.failed'), count: Math.round(failed) },
  ];

  const bySeverity: Record<string, number> = {};
  for (const n of ncrs) {
    const s = String(n.severity ?? 'UNKNOWN');
    bySeverity[s] = (bySeverity[s] ?? 0) + 1;
  }
  const severityData = Object.entries(bySeverity).map(([name, count]) => ({ name, count }));

  const charts: ChartSpec[] = [
    {
      id: 'passFail', title: t('reports.builder.chart.passFail'), kind: 'donut', data: passFail,
      xKey: 'name', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'count', name: t('reports.builder.col.count'), color: COLORS.green }],
    },
    {
      id: 'ncrSeverity', title: t('reports.builder.chart.ncrBySeverity'), kind: 'bar', data: severityData,
      xKey: 'name', emptyKey: 'reports.builder.chart.noData',
      series: [{ key: 'count', name: t('reports.builder.col.count'), color: COLORS.red }],
    },
  ];

  const rows: Row[] = ncrs.map((n) => ({
    ncrNumber: n.ncrNumber, title: n.title, severity: n.severity, status: n.status, detectedAt: n.detectedAt,
  }));
  const columns: ExportColumn<Row>[] = [
    { key: 'ncrNumber', label: t('reports.builder.col.ncrNumber'), value: (r) => String(r.ncrNumber ?? '—') },
    { key: 'title', label: t('reports.builder.col.title'), value: (r) => String(r.title ?? '—') },
    { key: 'severity', label: t('reports.builder.col.severity'), value: (r) => String(r.severity ?? '—') },
    { key: 'status', label: t('reports.builder.col.status'), value: (r) => String(r.status ?? '—') },
    { key: 'detectedAt', label: t('reports.builder.col.detectedAt'), value: (r) => fmtDateTime(r.detectedAt) },
  ];

  return { kpis, charts, rows, columns };
}

function buildInventory(data: any, t: TFn): ReportModel {
  const d = data ?? {};
  // Support both prompt-spec names and the actual API shape.
  const totalSkus = d.totalSkus ?? d.totalSKUs ?? d.products?.total ?? 0;
  const totalRaw = d.totalRawMaterials ?? d.rawMaterials?.total ?? 0;
  const totalSpare = d.totalSpareparts ?? d.totalSpareParts ?? d.spareParts?.total ?? 0;
  const lowStock = d.lowStockItems ?? d.lowStockCount ?? 0;
  const totalLots = d.totalLocations ?? d.totalMaterialLots ?? d.materialLots?.active ?? 0;
  const stockValue = d.stockValue ?? d.totalStockValue ?? 0;

  const kpis: Kpi[] = [
    { label: t('reports.builder.kpi.totalSkus'), value: int(totalSkus), tone: 'brand' },
    { label: t('reports.builder.kpi.rawMaterials'), value: int(totalRaw), tone: 'teal' },
    { label: t('reports.builder.kpi.spareParts'), value: int(totalSpare), tone: 'blue' },
    { label: t('reports.builder.kpi.lowStock'), value: int(lowStock), tone: 'red' },
    { label: t('reports.builder.kpi.materialLots'), value: int(totalLots), tone: 'purple' },
    { label: t('reports.builder.kpi.stockValue'), value: sar(stockValue), tone: 'green' },
  ];

  const rows: Row[] = kpis.map((k) => ({ metric: k.label, value: k.value }));
  const columns: ExportColumn<Row>[] = [
    { key: 'metric', label: t('reports.builder.col.metric'), value: (r) => String(r.metric) },
    { key: 'value', label: t('reports.builder.col.value'), value: (r) => String(r.value) },
  ];

  return { kpis, charts: [], rows, columns };
}

function buildEnergy(data: any, t: TFn): ReportModel {
  const summaries: any[] = Array.isArray(data?.summaries) ? data.summaries : [];
  const chart: any[] = Array.isArray(data?.chart) ? data.chart : [];

  // Energy type keys present in the chart series (everything except the date axis).
  const typeKeys = Array.from(
    chart.reduce((set: Set<string>, row: any) => {
      Object.keys(row ?? {}).forEach((k) => { if (k !== 'date') set.add(k); });
      return set;
    }, new Set<string>()),
  );

  // Total consumption = Σ of all numeric series values across every chart row.
  let totalConsumption = 0;
  let peakDay = '—';
  let peakValue = -Infinity;
  for (const row of chart) {
    let dayTotal = 0;
    for (const k of typeKeys) dayTotal += num(row[k]);
    totalConsumption += dayTotal;
    if (dayTotal > peakValue) {
      peakValue = dayTotal;
      peakDay = String(row.date ?? '—');
    }
  }

  const meterSet = new Set(summaries.map((s) => resolveName(s.meter?.name ?? s.meter)).filter((n) => n !== '—'));
  const hasCost = summaries.some((s) => s.cost != null);
  const totalCost = summaries.reduce((acc, s) => acc + num(s.cost), 0);

  const kpis: Kpi[] = [
    { label: t('reports.builder.kpi.totalConsumption'), value: `${int(totalConsumption)} kWh`, tone: 'brand' },
    { label: t('reports.builder.kpi.peakDay'), value: peakDay, tone: 'amber' },
    { label: t('reports.builder.kpi.meters'), value: int(meterSet.size), tone: 'cyan' },
    { label: t('reports.builder.kpi.energyTypes'), value: int(typeKeys.length), tone: 'purple' },
  ];
  if (hasCost) {
    kpis.push({ label: t('reports.builder.kpi.totalCost'), value: sar(totalCost), tone: 'green' });
  }

  const charts: ChartSpec[] = [
    {
      id: 'energyTrend', title: t('reports.builder.chart.energyConsumption'), kind: 'area', data: chart,
      xKey: 'date', unit: ' kWh', emptyKey: 'reports.builder.chart.noData',
      series: typeKeys.map((k, i) => ({
        key: k,
        name: t(`reports.builder.energyType.${k}`, { defaultValue: k }),
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      })),
    },
  ];

  const rows: Row[] = summaries.map((s) => ({
    periodStart: s.periodStart,
    meter: resolveName(s.meter?.name ?? s.meter),
    type: resolveName(s.meter?.type),
    consumption: num(s.totalConsumption),
    unit: s.meter?.unit ?? 'kWh',
    cost: s.cost,
  }));

  const columns: ExportColumn<Row>[] = [
    { key: 'periodStart', label: t('reports.builder.col.date'), value: (r) => fmtDate(r.periodStart) },
    { key: 'meter', label: t('reports.builder.col.meter'), value: (r) => String(r.meter) },
    { key: 'type', label: t('reports.builder.col.type'), value: (r) => String(r.type) },
    { key: 'consumption', label: t('reports.builder.col.consumptionKwh'), value: (r) => `${int(r.consumption)} ${String(r.unit ?? 'kWh')}` },
  ];
  if (hasCost) {
    columns.push({ key: 'cost', label: t('reports.builder.col.costSar'), value: (r) => (r.cost == null ? '—' : sar(r.cost)) });
  }

  return {
    kpis, charts, rows, columns,
    machineNames: [...meterSet].sort(),
    machineKey: 'meter',
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function buildReportModel(type: string, data: unknown, t: TFn): ReportModel {
  switch (type) {
    case 'production': return buildProduction(data, t);
    case 'oee': return buildOee(data, t);
    case 'scrap': return buildScrap(data, t);
    case 'maintenance': return buildMaintenance(data, t);
    case 'quality': return buildQuality(data, t);
    case 'inventory': return buildInventory(data, t);
    case 'energy': return buildEnergy(data, t);
    default: return { kpis: [], charts: [], rows: [], columns: [] };
  }
}
