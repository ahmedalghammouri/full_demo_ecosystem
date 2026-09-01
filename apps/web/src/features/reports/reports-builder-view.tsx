'use client';
import { useTranslation } from 'react-i18next';
import { toFactoryDayKey } from '@/lib/datetime';

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Download,
  RefreshCw,
  Factory,
  ShieldCheck,
  Wrench,
  Gauge,
  Package,
  Zap,
  Trash2,
  Clock,
  BarChart3,
  CheckCircle2,
  Search,
  FileSpreadsheet,
  FileDown,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';
import { type ExportColumn } from '@/lib/export-utils';
import {
  buildReportModel,
  DONUT_COLORS,
  type ReportModel,
  type ChartSpec,
  type Kpi,
} from './report-definitions';
import { exportReportPDF, exportReportExcel } from './report-export';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReportTypeConfig {
  id: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  descKey: string;
  endpoint: string | null;
  color: string;
  comingSoon?: boolean;
}

interface RecentReport {
  type: string;
  label: string;
  generatedAt: string;
  rowCount: number;
}

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPORT_TYPES: ReportTypeConfig[] = [
  { id: 'production', labelKey: 'reports.builder.type.production.label', icon: Factory, descKey: 'reports.builder.type.production.desc', endpoint: '/reports/production', color: 'blue' },
  { id: 'quality', labelKey: 'reports.builder.type.quality.label', icon: ShieldCheck, descKey: 'reports.builder.type.quality.desc', endpoint: '/reports/quality', color: 'green' },
  { id: 'maintenance', labelKey: 'reports.builder.type.maintenance.label', icon: Wrench, descKey: 'reports.builder.type.maintenance.desc', endpoint: '/reports/maintenance', color: 'orange' },
  { id: 'oee', labelKey: 'reports.builder.type.oee.label', icon: Gauge, descKey: 'reports.builder.type.oee.desc', endpoint: '/production/oee-records?limit=200', color: 'purple' },
  { id: 'scrap', labelKey: 'reports.builder.type.scrap.label', icon: Trash2, descKey: 'reports.builder.type.scrap.desc', endpoint: '/production/scrap-logs?limit=200', color: 'red' },
  { id: 'inventory', labelKey: 'reports.builder.type.inventory.label', icon: Package, descKey: 'reports.builder.type.inventory.desc', endpoint: '/inventory/overview', color: 'teal' },
  { id: 'energy', labelKey: 'reports.builder.type.energy.label', icon: Zap, descKey: 'reports.builder.type.energy.desc', endpoint: '/energy/consumption', color: 'yellow' },
];

const STORAGE_KEY = 'i360_recent_reports';
const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const colorBorder: Record<string, string> = {
  blue: 'border-blue-500', green: 'border-green-500', orange: 'border-orange-500',
  purple: 'border-purple-500', red: 'border-red-500', teal: 'border-teal-500', yellow: 'border-yellow-500',
};
const colorText: Record<string, string> = {
  blue: 'text-blue-400', green: 'text-green-400', orange: 'text-orange-400',
  purple: 'text-purple-400', red: 'text-red-400', teal: 'text-teal-400', yellow: 'text-yellow-400',
};
const colorBadgeBg: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400', green: 'bg-green-500/10 text-green-400',
  orange: 'bg-orange-500/10 text-orange-400', purple: 'bg-purple-500/10 text-purple-400',
  red: 'bg-red-500/10 text-red-400', teal: 'bg-teal-500/10 text-teal-400', yellow: 'bg-yellow-500/10 text-yellow-400',
};

const kpiTone: Record<Kpi['tone'], { bg: string; text: string }> = {
  brand: { bg: 'bg-brand-500/15', text: 'text-brand-400' },
  green: { bg: 'bg-green-500/15', text: 'text-green-400' },
  amber: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  cyan: { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
  red: { bg: 'bg-red-500/15', text: 'text-red-400' },
  purple: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  blue: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  teal: { bg: 'bg-teal-500/15', text: 'text-teal-400' },
};

// ---------------------------------------------------------------------------
// CSV export helper (uses the same per-type ExportColumn defs)
// ---------------------------------------------------------------------------

function exportCSV(rows: Row[], columns: ExportColumn<Row>[], filename: string): void {
  if (!rows.length) return;
  const cell = (r: Row, c: ExportColumn<Row>) => {
    const raw = c.value ? c.value(r) : (r as any)[c.key];
    const str = raw == null ? '' : String(raw);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [
    columns.map((c) => c.label).join(','),
    ...rows.map((r) => columns.map((c) => cell(r, c)).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildUrl(endpoint: string, from: string, to: string): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  const params: string[] = [];
  if (from) params.push(`from=${encodeURIComponent(from)}`);
  if (to) params.push(`to=${encodeURIComponent(to)}`);
  return params.length > 0 ? `${endpoint}${separator}${params.join('&')}` : endpoint;
}

// ---------------------------------------------------------------------------
// Date preset helpers
// ---------------------------------------------------------------------------

function isoDay(d: Date): string {
  return toFactoryDayKey(d);
}

function presetRange(preset: string): { from: string; to: string } {
  const today = new Date();
  const to = isoDay(today);
  const start = new Date(today);
  switch (preset) {
    case 'today': return { from: to, to };
    case '7d': start.setDate(start.getDate() - 6); return { from: isoDay(start), to };
    case '30d': start.setDate(start.getDate() - 29); return { from: isoDay(start), to };
    case '90d': start.setDate(start.getDate() - 89); return { from: isoDay(start), to };
    case 'month': return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    default: return { from: '', to };
  }
}

const PRESETS = [
  { id: 'today', labelKey: 'reports.builder.preset.today' },
  { id: '7d', labelKey: 'reports.builder.preset.d7' },
  { id: '30d', labelKey: 'reports.builder.preset.d30' },
  { id: '90d', labelKey: 'reports.builder.preset.d90' },
  { id: 'month', labelKey: 'reports.builder.preset.month' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 bg-foreground/5 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="h-48 bg-foreground/5 rounded-lg" />
        <div className="h-48 bg-foreground/5 rounded-lg" />
      </div>
      <div className="h-40 bg-foreground/5 rounded-lg" />
    </div>
  );
}

function KpiCards({ kpis }: { kpis: Kpi[] }) {
  if (!kpis.length) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {kpis.map((k, i) => {
        const tone = kpiTone[k.tone];
        return (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3"
          >
            <p className="text-[11px] text-muted-foreground truncate" title={k.label}>{k.label}</p>
            <p className={cn('text-lg font-bold mt-0.5', tone.text)}>{k.value}</p>
          </motion.div>
        );
      })}
    </div>
  );
}

const AXIS = { fontSize: 11, fill: '#94a3b8' };
const TOOLTIP_STYLE = { background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 12 };

function ChartCard({ spec, t }: { spec: ChartSpec; t: (k: string) => string }) {
  const hasData = spec.data.length > 0;
  return (
    <div data-chart-id={spec.id} className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">{spec.title}</h3>
      {!hasData ? (
        <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
          {t(spec.emptyKey)}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          {spec.kind === 'area' ? (
            <AreaChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey={spec.xKey} tick={AXIS} />
              <YAxis tick={AXIS} unit={spec.unit} domain={spec.unit === '%' ? [0, 100] : undefined} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {spec.series.map((s) => (
                <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.18} strokeWidth={2} />
              ))}
            </AreaChart>
          ) : spec.kind === 'line' ? (
            <LineChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey={spec.xKey} tick={AXIS} />
              <YAxis tick={AXIS} unit={spec.unit} domain={spec.unit === '%' ? [0, 100] : undefined} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {spec.series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          ) : spec.kind === 'barH' ? (
            <BarChart data={spec.data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" tick={AXIS} unit={spec.unit} />
              <YAxis dataKey={spec.xKey} type="category" tick={{ fontSize: 10, fill: '#94a3b8' }} width={90} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {spec.series.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[0, 4, 4, 0]} />
              ))}
            </BarChart>
          ) : spec.kind === 'bar' ? (
            <BarChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={AXIS} unit={spec.unit} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {spec.series.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          ) : (
            <PieChart>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie
                data={spec.data}
                dataKey={spec.series[0].key}
                nameKey={spec.xKey}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={2}
              >
                {spec.data.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}

interface DataTableProps {
  rows: Row[];
  columns: ExportColumn<Row>[];
  t: (k: string, o?: Record<string, unknown>) => string;
}

function DataTable({ rows, columns, t }: DataTableProps) {
  const [page, setPage] = useState(0);
  const totalCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Reset / clamp the page whenever the (filtered) row set changes size.
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <BarChart3 className="h-8 w-8 opacity-40" />
        <p className="text-sm">{t('reports.builder.noData')}</p>
      </div>
    );
  }

  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, totalCount);
  const pageRows = rows.slice(start, end);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t('reports.builder.showingRange', { from: start + 1, to: end, total: totalCount })}</span>
      </div>
      <div className="rounded-lg border border-foreground/10 overflow-x-auto">
        <div className="max-h-[460px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-card border-b border-foreground/10">
                {columns.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap bg-foreground/5">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, i) => (
                <tr
                  key={start + i}
                  className={cn(
                    'border-b border-foreground/5 transition-colors hover:bg-foreground/5',
                    i % 2 === 0 ? 'bg-transparent' : 'bg-foreground/[0.02]'
                  )}
                >
                  {columns.map((col) => {
                    const display = col.value ? col.value(row) : (row as any)[col.key];
                    const str = display == null ? '—' : String(display);
                    return (
                      <td key={col.key} className="px-3 py-1.5 text-foreground/80 max-w-[220px] truncate" title={str}>
                        {str}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground">
            {t('reports.builder.pageOf', { page: safePage + 1, pages: pageCount })}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" className="h-7 w-7 p-0" disabled={safePage === 0}
              onClick={() => setPage(0)} title={t('reports.builder.first')}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="secondary" size="sm" className="h-7 w-7 p-0" disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))} title={t('reports.builder.prev')}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="secondary" size="sm" className="h-7 w-7 p-0" disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} title={t('reports.builder.next')}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="secondary" size="sm" className="h-7 w-7 p-0" disabled={safePage >= pageCount - 1}
              onClick={() => setPage(pageCount - 1)} title={t('reports.builder.last')}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ReportsBuilderView() {
  const { t } = useTranslation('modules');
  const [selectedType, setSelectedType] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>('');
  const [isGenerated, setIsGenerated] = useState<boolean>(false);
  const [reportData, setReportData] = useState<unknown>(null);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);

  // Client-side table filters
  const [tableSearch, setTableSearch] = useState<string>('');
  const [machineFilter, setMachineFilter] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Container holding the rendered charts — used to capture chart images for PDF.
  const chartsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setRecentReports(JSON.parse(stored) as RecentReport[]);
    } catch {
      // ignore
    }
  }, []);

  const selectedConfig = REPORT_TYPES.find((r) => r.id === selectedType) ?? null;

  const queryUrl =
    selectedConfig && selectedConfig.endpoint && isGenerated
      ? buildUrl(selectedConfig.endpoint, dateFrom, dateTo)
      : null;

  const { data: fetchedData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-builder', selectedType, dateFrom, dateTo, isGenerated],
    queryFn: async () => {
      if (!queryUrl) return null;
      return api.get(queryUrl);
    },
    enabled: isGenerated && !!selectedType && !!queryUrl,
  });

  // Build the per-type model (cards/charts/table/columns) from raw data.
  const model: ReportModel | null = useMemo(() => {
    if (reportData == null || !selectedType) return null;
    return buildReportModel(selectedType, reportData, t as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportData, selectedType]);

  // Sync fetched data + save recent
  useEffect(() => {
    if (fetchedData !== undefined && fetchedData !== null && isGenerated && selectedConfig) {
      setReportData(fetchedData);
      const built = buildReportModel(selectedConfig.id, fetchedData, t as any);
      const entry: RecentReport = {
        type: selectedConfig.id,
        label: t(selectedConfig.labelKey),
        generatedAt: new Date().toISOString(),
        rowCount: built.rows.length,
      };
      setRecentReports((prev) => {
        const updated = [entry, ...prev.filter((r) => r.type !== entry.type)].slice(0, 5);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedData, isGenerated, selectedConfig]);

  // Apply client-side machine + search filters to the table rows.
  const filteredRows = useMemo(() => {
    if (!model) return [];
    let rows = model.rows;
    if (machineFilter && model.machineKey) {
      rows = rows.filter((r) => String((r as any)[model.machineKey!]) === machineFilter);
    }
    if (tableSearch.trim()) {
      const q = tableSearch.trim().toLowerCase();
      rows = rows.filter((r) =>
        model.columns.some((c) => {
          const v = c.value ? c.value(r) : (r as any)[c.key];
          return String(v ?? '').toLowerCase().includes(q);
        })
      );
    }
    return rows;
  }, [model, machineFilter, tableSearch]);

  function resetView() {
    setIsGenerated(false);
    setReportData(null);
    setTableSearch('');
    setMachineFilter('');
  }

  function handleGenerate() {
    if (!selectedType) return;
    setReportData(null);
    setTableSearch('');
    setMachineFilter('');
    setIsGenerated(true);
  }

  function applyPreset(id: string) {
    const { from, to } = presetRange(id);
    setDateFrom(from);
    setDateTo(to);
    setActivePreset(id);
    setIsGenerated(false);
  }

  const exportTitle = useMemo(() => {
    if (!selectedConfig) return 'Report';
    const label = t(selectedConfig.labelKey);
    const range = dateFrom && dateTo ? ` — ${dateFrom} → ${dateTo}` : '';
    return `${label}${range}`;
  }, [selectedConfig, dateFrom, dateTo, t]);

  function handleExportCSV() {
    if (!model || !filteredRows.length) return;
    const filename = `${selectedType}-report-${toFactoryDayKey(new Date())}.csv`;
    exportCSV(filteredRows, model.columns, filename);
  }
  function handleExportExcel() {
    if (!model || !filteredRows.length) return;
    exportReportExcel({
      filename: `${selectedType}-report-${toFactoryDayKey(new Date())}`,
      model,
      rows: filteredRows,
      labels: {
        summary: t('reports.builder.sheetSummary'),
        detail: t('reports.builder.sheetDetail'),
        metric: t('reports.builder.col.metric'),
        value: t('reports.builder.col.value'),
      },
    });
  }
  async function handleExportPDF() {
    if (!model || !filteredRows.length || isExporting) return;
    setIsExporting(true);
    try {
      const nodes = chartsRef.current
        ? Array.from(chartsRef.current.querySelectorAll<HTMLElement>('[data-chart-id]'))
        : [];
      await exportReportPDF({
        title: exportTitle,
        subtitle: t('reports.builder.title'),
        model,
        rows: filteredRows,
        chartNodes: nodes,
        labels: {
          generated: t('reports.builder.generatedAt'),
          summary: t('reports.builder.sheetSummary'),
          details: t('reports.builder.sheetDetail'),
          records: t('reports.builder.recordsCountRaw'),
        },
      });
    } finally {
      setIsExporting(false);
    }
  }

  function handleRerun(recent: RecentReport) {
    setSelectedType(recent.type);
    setIsGenerated(false);
    setReportData(null);
    setTableSearch('');
    setMachineFilter('');
    setTimeout(() => setIsGenerated(true), 100);
  }

  const canExport = !!model && filteredRows.length > 0 && !isLoading && !isExporting;
  const showResults = isGenerated && !isLoading && !isError && reportData != null;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-start gap-3"
      >
        <div className="p-2 rounded-lg bg-brand-500/10">
          <FileText className="h-6 w-6 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('reports.builder.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('reports.builder.subtitle')}</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — Configuration */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="lg:col-span-1 space-y-5"
        >
          <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm p-4 space-y-5">
            {/* Select Report Type */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t('reports.builder.selectType')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {REPORT_TYPES.map((rt) => {
                  const Icon = rt.icon;
                  const isSelected = selectedType === rt.id;
                  const isDisabled = !!rt.comingSoon;
                  return (
                    <button
                      key={rt.id}
                      disabled={isDisabled}
                      onClick={() => {
                        if (isDisabled) return;
                        setSelectedType(rt.id);
                        resetView();
                      }}
                      className={cn(
                        'relative text-left rounded-lg border p-2.5 transition-all duration-150',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                        isDisabled && 'opacity-40 cursor-not-allowed',
                        isSelected
                          ? cn('border-2', colorBorder[rt.color] ?? 'border-brand-500', 'bg-foreground/5')
                          : 'border-foreground/10 hover:border-foreground/20 hover:bg-foreground/5 cursor-pointer'
                      )}
                    >
                      {rt.comingSoon && (
                        <span className="absolute top-1.5 right-1.5 text-[9px] font-bold bg-yellow-500/20 text-yellow-400 rounded px-1">
                          {t('reports.builder.soon')}
                        </span>
                      )}
                      <Icon className={cn('h-4 w-4 mb-1.5', isSelected ? colorText[rt.color] ?? 'text-brand-400' : 'text-muted-foreground')} />
                      <p className={cn('text-[11px] font-semibold leading-tight', isSelected ? 'text-foreground' : 'text-foreground/70')}>
                        {t(rt.labelKey)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-2">
                        {t(rt.descKey)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick presets */}
            {selectedType !== 'inventory' && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {t('reports.builder.quickRange')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[11px] font-medium border transition-colors',
                        activePreset === p.id
                          ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                          : 'border-foreground/10 text-muted-foreground hover:bg-foreground/5'
                      )}
                    >
                      {t(p.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Date Range */}
            {selectedType !== 'inventory' && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t('reports.builder.dateRange')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-medium">{t('reports.builder.from')}</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => { setDateFrom(e.target.value); setActivePreset(''); setIsGenerated(false); }}
                      className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-medium">{t('reports.builder.to')}</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => { setDateTo(e.target.value); setActivePreset(''); setIsGenerated(false); }}
                      className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              <Button className="w-full" onClick={handleGenerate} disabled={!selectedType}>
                <BarChart3 className="h-4 w-4 mr-2" />
                {t('reports.builder.generateReport')}
              </Button>

              <div className="grid grid-cols-3 gap-2">
                <Button variant="secondary" size="sm" onClick={handleExportPDF} disabled={!canExport} title={t('reports.builder.exportPdf')}>
                  <FileDown className="h-3.5 w-3.5 mr-1" />
                  {isExporting ? t('reports.builder.exporting') : t('reports.builder.pdf')}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportExcel} disabled={!canExport} title={t('reports.builder.exportExcel')}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                  {t('reports.builder.excel')}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleExportCSV} disabled={!canExport} title={t('reports.builder.exportCsv')}>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  {t('reports.builder.csv')}
                </Button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* RIGHT — Preview */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="lg:col-span-2"
        >
          <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm p-4 min-h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('reports.builder.preview')}
              </p>
              {isGenerated && selectedConfig && !isLoading && (
                <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 text-xs gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('reports.builder.refresh')}
                </Button>
              )}
            </div>

            {/* Empty state */}
            {!selectedType && (
              <div className="flex flex-col items-center justify-center h-72 text-muted-foreground gap-3">
                <FileText className="h-12 w-12 opacity-20" />
                <p className="text-sm font-medium">{t('reports.builder.emptyTitle')}</p>
                <p className="text-xs opacity-60">{t('reports.builder.emptyDesc')}</p>
              </div>
            )}

            {/* Not yet generated */}
            {selectedType && !isGenerated && (
              <div className="flex flex-col items-center justify-center h-72 text-muted-foreground gap-3">
                {selectedConfig && (
                  <>
                    <selectedConfig.icon className={cn('h-12 w-12 opacity-20', colorText[selectedConfig.color])} />
                    <p className="text-sm font-medium">{t(selectedConfig.labelKey)}</p>
                    <p className="text-xs opacity-60">{t('reports.builder.configureHint')}</p>
                  </>
                )}
              </div>
            )}

            {/* Loading */}
            {isGenerated && isLoading && (
              <div className="mt-2"><LoadingSkeleton /></div>
            )}

            {/* Error */}
            {isGenerated && isError && !isLoading && (
              <div className="flex flex-col items-center justify-center h-60 text-muted-foreground gap-3">
                <p className="text-sm text-red-400 font-medium">{t('reports.builder.loadFailed')}</p>
                <p className="text-xs opacity-60">{error instanceof Error ? error.message : t('reports.builder.unknownError')}</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  {t('reports.builder.retry')}
                </Button>
              </div>
            )}

            {/* Results */}
            {showResults && model && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-5"
              >
                {selectedConfig && (
                  <div className="flex items-center gap-2">
                    <selectedConfig.icon className={cn('h-4 w-4', colorText[selectedConfig.color])} />
                    <span className="text-sm font-semibold text-foreground">{t(selectedConfig.labelKey)}</span>
                    <span className={cn('text-xs rounded-full px-2 py-0.5 font-medium', colorBadgeBg[selectedConfig.color])}>
                      {t('reports.builder.rowsCount', { count: model.rows.length })}
                    </span>
                  </div>
                )}

                {/* KPI cards */}
                <KpiCards kpis={model.kpis} />

                {/* Charts */}
                {model.charts.length > 0 && (
                  <div ref={chartsRef} className={cn('grid gap-4', model.charts.length > 1 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1')}>
                    {model.charts.map((c) => (
                      <ChartCard key={c.id} spec={c} t={t} />
                    ))}
                  </div>
                )}

                {/* Table toolbar: search + machine dropdown */}
                {model.rows.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={tableSearch}
                        onChange={(e) => setTableSearch(e.target.value)}
                        placeholder={t('reports.builder.searchPlaceholder')}
                        className="w-full rounded-lg border border-foreground/10 bg-foreground/5 pl-8 pr-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    {model.machineNames && model.machineNames.length > 0 && (
                      <select
                        value={machineFilter}
                        onChange={(e) => setMachineFilter(e.target.value)}
                        className="rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        <option value="">{t('reports.builder.allMachines')}</option>
                        {model.machineNames.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* Table */}
                <DataTable rows={filteredRows} columns={model.columns} t={t} />
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Recent Reports */}
      {recentReports.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm p-4"
        >
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('reports.builder.recentReports')}
            </p>
          </div>
          <div className="space-y-2">
            {recentReports.slice(0, 5).map((report, i) => {
              const config = REPORT_TYPES.find((r) => r.id === report.type);
              const Icon = config?.icon ?? FileText;
              const color = config?.color ?? 'blue';
              const generatedDate = new Date(report.generatedAt);
              const displayDate = isNaN(generatedDate.getTime()) ? '—' : generatedDate.toLocaleString();
              return (
                <div key={i} className="flex items-center justify-between rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-2 hover:bg-foreground/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={cn('p-1.5 rounded-md', colorBadgeBg[color])}>
                      <Icon className={cn('h-3.5 w-3.5', colorText[color])} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{report.label}</p>
                      <p className="text-xs text-muted-foreground">{displayDate}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn('text-xs rounded-full px-2 py-0.5 font-medium', colorBadgeBg[color])}>
                      {t('reports.builder.rowsCount', { count: report.rowCount })}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleRerun(report)} className="h-7 text-xs gap-1.5">
                      <RefreshCw className="h-3 w-3" />
                      {t('reports.builder.rerun')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
