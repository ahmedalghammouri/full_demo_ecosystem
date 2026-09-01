'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type InspectionType = 'IN_PROCESS' | 'INCOMING' | 'FINAL' | 'AUDIT';
type InspectionResult = 'PASS' | 'FAIL' | 'CONDITIONAL';
type InspectionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type NcrSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';
type NcrStatus = 'OPEN' | 'UNDER_REVIEW' | 'CLOSED';

interface Inspection {
  id: string;
  inspectionNumber: string;
  type: InspectionType;
  status: InspectionStatus;
  result: InspectionResult;
  passCount: number;
  totalCount: number;
  batchId: string;
  skuId: string;
  sku: { name: string };
  batch: { batchNumber: string };
  inspector: { firstName: string; lastName: string };
  createdAt: string;
  plannedDate: string;
}

interface NCR {
  id: string;
  ncrNumber: string;
  title: string;
  severity: NcrSeverity;
  status: NcrStatus;
  product: { name: string };
  detectedAt: string;
}

interface InspectionsResponse {
  data: Inspection[];
  total: number;
}

interface NcrResponse {
  data: NCR[];
  total: number;
}

// ─── Config maps ──────────────────────────────────────────────────────────────

const INSPECTION_TYPE_CONFIG: Record<
  InspectionType,
  { labelKey: string; className: string }
> = {
  IN_PROCESS: {
    labelKey: 'recordsView.type.IN_PROCESS',
    className:
      'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  INCOMING: {
    labelKey: 'recordsView.type.INCOMING',
    className:
      'bg-purple-500/15 text-purple-400 border-purple-500/30',
  },
  FINAL: {
    labelKey: 'recordsView.type.FINAL',
    className:
      'bg-green-500/15 text-green-400 border-green-500/30',
  },
  AUDIT: {
    labelKey: 'recordsView.type.AUDIT',
    className:
      'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
};

const RESULT_CONFIG: Record<
  InspectionResult,
  { labelKey: string; className: string; icon: React.ElementType }
> = {
  PASS: {
    labelKey: 'recordsView.result.PASS',
    className:
      'bg-green-500/15 text-green-400 border-green-500/30',
    icon: CheckCircle2,
  },
  FAIL: {
    labelKey: 'recordsView.result.FAIL',
    className:
      'bg-red-500/15 text-red-400 border-red-500/30',
    icon: XCircle,
  },
  CONDITIONAL: {
    labelKey: 'recordsView.result.CONDITIONAL',
    className:
      'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    icon: AlertTriangle,
  },
};

const INSPECTION_STATUS_CONFIG: Record<
  InspectionStatus,
  { labelKey: string; className: string }
> = {
  PLANNED: {
    labelKey: 'recordsView.status.PLANNED',
    className: 'bg-muted/50 text-muted-foreground border-border/40',
  },
  IN_PROGRESS: {
    labelKey: 'recordsView.status.IN_PROGRESS',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  COMPLETED: {
    labelKey: 'recordsView.status.COMPLETED',
    className: 'bg-green-500/15 text-green-400 border-green-500/30',
  },
  CANCELLED: {
    labelKey: 'recordsView.status.CANCELLED',
    className: 'bg-muted/30 text-muted-foreground/60 border-border/30',
  },
};

const NCR_SEVERITY_CONFIG: Record<
  NcrSeverity,
  { labelKey: string; className: string }
> = {
  MINOR: {
    labelKey: 'recordsView.ncrSeverity.MINOR',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  MAJOR: {
    labelKey: 'recordsView.ncrSeverity.MAJOR',
    className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  },
  CRITICAL: {
    labelKey: 'recordsView.ncrSeverity.CRITICAL',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
};

const NCR_STATUS_CONFIG: Record<
  NcrStatus,
  { labelKey: string; className: string }
> = {
  OPEN: {
    labelKey: 'recordsView.ncrStatus.OPEN',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  UNDER_REVIEW: {
    labelKey: 'recordsView.ncrStatus.UNDER_REVIEW',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  CLOSED: {
    labelKey: 'recordsView.ncrStatus.CLOSED',
    className: 'bg-green-500/15 text-green-400 border-green-500/30',
  },
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function InspectionTypeBadge({ type }: { type: InspectionType }) {
  const { t } = useTranslation('quality');
  const cfg = INSPECTION_TYPE_CONFIG[type];
  const label = cfg ? t(cfg.labelKey) : type;
  const className = cfg?.className ?? 'bg-muted/30 text-muted-foreground border-border/30';
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
        className,
      )}
    >
      {label}
    </span>
  );
}

function ResultBadge({ result }: { result: InspectionResult }) {
  const { t } = useTranslation('quality');
  const cfg = RESULT_CONFIG[result];
  if (!cfg) return <span className="text-xs text-muted-foreground">—</span>;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border',
        cfg.className,
      )}
    >
      <Icon size={10} />
      {t(cfg.labelKey)}
    </span>
  );
}

function InspectionStatusBadge({ status }: { status: InspectionStatus }) {
  const { t } = useTranslation('quality');
  const cfg = INSPECTION_STATUS_CONFIG[status];
  const label = cfg ? t(cfg.labelKey) : status;
  const className = cfg?.className ?? 'bg-muted/30 text-muted-foreground border-border/30';
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
        className,
      )}
    >
      {label}
    </span>
  );
}

function NcrSeverityBadge({ severity }: { severity: NcrSeverity }) {
  const { t } = useTranslation('quality');
  const cfg = NCR_SEVERITY_CONFIG[severity];
  const label = cfg ? t(cfg.labelKey) : severity;
  const className = cfg?.className ?? 'bg-muted/30 text-muted-foreground border-border/30';
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
        className,
      )}
    >
      {label}
    </span>
  );
}

function NcrStatusBadge({ status }: { status: NcrStatus }) {
  const { t } = useTranslation('quality');
  const cfg = NCR_STATUS_CONFIG[status];
  const label = cfg ? t(cfg.labelKey) : status;
  const className = cfg?.className ?? 'bg-muted/30 text-muted-foreground border-border/30';
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
        className,
      )}
    >
      {label}
    </span>
  );
}

// ─── Filter state type ────────────────────────────────────────────────────────

interface FilterState {
  search: string;
  type: string;
  result: string;
  dateFrom: string;
  dateTo: string;
}

const INITIAL_FILTERS: FilterState = {
  search: '',
  type: 'ALL',
  result: 'ALL',
  dateFrom: '',
  dateTo: '',
};

const PAGE_SIZE = 10;

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  valueClassName,
  delay,
}: {
  label: string;
  value: string | number;
  sub?: string;
  valueClassName?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: delay ?? 0 }}
      className="industrial-card p-4 flex flex-col gap-1"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums', valueClassName)}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </motion.div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  showTypeFilter,
  showResultFilter,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  showTypeFilter: boolean;
  showResultFilter: boolean;
}) {
  const { t } = useTranslation('quality');
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          placeholder={t('records.search')}
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="h-8 ps-7 w-44 text-xs"
        />
      </div>

      {showTypeFilter && (
        <Select
          value={filters.type}
          onValueChange={(v) => onChange({ ...filters, type: v })}
        >
          <SelectTrigger className="h-8 w-36 text-xs gap-1">
            <Filter size={12} className="text-muted-foreground shrink-0" />
            <SelectValue placeholder={t('records.type')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('records.allTypes')}</SelectItem>
            <SelectItem value="IN_PROCESS">{t('records.typeOpt.IN_PROCESS')}</SelectItem>
            <SelectItem value="INCOMING">{t('records.typeOpt.INCOMING')}</SelectItem>
            <SelectItem value="FINAL">{t('records.typeOpt.FINAL')}</SelectItem>
            <SelectItem value="AUDIT">{t('records.typeOpt.AUDIT')}</SelectItem>
          </SelectContent>
        </Select>
      )}

      {showResultFilter && (
        <Select
          value={filters.result}
          onValueChange={(v) => onChange({ ...filters, result: v })}
        >
          <SelectTrigger className="h-8 w-36 text-xs gap-1">
            <Filter size={12} className="text-muted-foreground shrink-0" />
            <SelectValue placeholder={t('records.result')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('records.allResults')}</SelectItem>
            <SelectItem value="PASS">{t('records.resultOpt.PASS')}</SelectItem>
            <SelectItem value="FAIL">{t('records.resultOpt.FAIL')}</SelectItem>
            <SelectItem value="CONDITIONAL">{t('records.resultOpt.CONDITIONAL')}</SelectItem>
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t('common.from')}</span>
        <Input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          className="h-8 w-36 text-xs"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t('common.to')}</span>
        <Input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          className="h-8 w-36 text-xs"
        />
      </div>

      {(filters.search ||
        filters.type !== 'ALL' ||
        filters.result !== 'ALL' ||
        filters.dateFrom ||
        filters.dateTo) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={() => onChange(INITIAL_FILTERS)}
        >
          {t('common.clear')}
        </Button>
      )}
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation('quality');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/30">
      <span className="text-xs text-muted-foreground">
        {t('recordsView.showing', { start: total === 0 ? 0 : start, end, total })}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={13} />
        </Button>
        <span className="text-xs px-2 tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={13} />
        </Button>
      </div>
    </div>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows({
  cols,
  rows = 6,
}: {
  cols: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i} className="border-border/20">
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <div className="shimmer h-3.5 rounded w-20" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ─── Inspections Table ────────────────────────────────────────────────────────

function InspectionsTable({
  inspections,
  isLoading,
  total,
  page,
  onPageChange,
}: {
  inspections: Inspection[];
  isLoading: boolean;
  total: number;
  page: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation('quality');
  return (
    <>
      <div className="rounded-lg border border-border/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/30">
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colInspection')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colType')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colProduct')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colBatch')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colResult')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colPassTotal')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colInspector')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colDate')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colStatus')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={10} />
            ) : inspections.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="text-center py-10 text-muted-foreground text-sm"
                >
                  {t('recordsView.noInspections')}
                </TableCell>
              </TableRow>
            ) : (
              inspections.map((ins) => (
                <TableRow
                  key={ins.id}
                  className="border-border/20 hover:bg-muted/20"
                >
                  <TableCell className="font-mono text-xs font-semibold text-primary">
                    {ins.inspectionNumber}
                  </TableCell>
                  <TableCell>
                    <InspectionTypeBadge type={ins.type} />
                  </TableCell>
                  <TableCell className="text-xs max-w-[120px] truncate">
                    {ins.sku?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {ins.batch?.batchNumber ?? '—'}
                  </TableCell>
                  <TableCell>
                    <ResultBadge result={ins.result} />
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    <span className="text-green-400 font-semibold">
                      {ins.passCount}
                    </span>
                    <span className="text-muted-foreground mx-0.5">/</span>
                    <span>{ins.totalCount}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {ins.inspector
                      ? `${ins.inspector.firstName} ${ins.inspector.lastName}`
                      : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(ins.plannedDate ?? ins.createdAt)}
                  </TableCell>
                  <TableCell>
                    <InspectionStatusBadge status={ins.status} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/quality/inspections/${ins.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                      >
                        {t('common.view')}
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={onPageChange}
      />
    </>
  );
}

// ─── NCR Table ────────────────────────────────────────────────────────────────

function NcrTable({
  ncrs,
  isLoading,
  total,
  page,
  onPageChange,
}: {
  ncrs: NCR[];
  isLoading: boolean;
  total: number;
  page: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation('quality');
  return (
    <>
      <div className="rounded-lg border border-border/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/30">
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colNcr')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colTitle')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colSeverity')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colProduct')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colStatus')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colDetected')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={7} />
            ) : ncrs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-10 text-muted-foreground text-sm"
                >
                  {t('recordsView.noNcrs')}
                </TableCell>
              </TableRow>
            ) : (
              ncrs.map((ncr) => (
                <TableRow
                  key={ncr.id}
                  className="border-border/20 hover:bg-muted/20"
                >
                  <TableCell className="font-mono text-xs font-semibold text-primary">
                    {ncr.ncrNumber}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 max-w-[200px]">
                      {ncr.severity === 'CRITICAL' && (
                        <AlertTriangle
                          size={11}
                          className="text-red-400 shrink-0"
                        />
                      )}
                      <span className="text-xs truncate">{ncr.title}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <NcrSeverityBadge severity={ncr.severity} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                    {ncr.product?.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    <NcrStatusBadge status={ncr.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(ncr.detectedAt)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/quality/ncr/${ncr.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                      >
                        {t('common.view')}
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={onPageChange}
      />
    </>
  );
}

// ─── All Records merged table ─────────────────────────────────────────────────

type MergedRecord =
  | { kind: 'inspection'; record: Inspection }
  | { kind: 'ncr'; record: NCR };

function AllRecordsTable({
  records,
  isLoading,
  total,
  page,
  onPageChange,
}: {
  records: MergedRecord[];
  isLoading: boolean;
  total: number;
  page: number;
  onPageChange: (p: number) => void;
}) {
  const { t } = useTranslation('quality');
  return (
    <>
      <div className="rounded-lg border border-border/30 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/30">
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colRecordType')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colNumber')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colDetails')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colTypeSeverity')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colResultStatus')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colProduct')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colDate')}</TableHead>
              <TableHead className="text-[11px] font-semibold">{t('recordsView.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={8} />
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-10 text-muted-foreground text-sm"
                >
                  {t('recordsView.noRecords')}
                </TableCell>
              </TableRow>
            ) : (
              records.map((item) => {
                if (item.kind === 'inspection') {
                  const ins = item.record;
                  return (
                    <TableRow
                      key={`insp-${ins.id}`}
                      className="border-border/20 hover:bg-muted/20"
                    >
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-500/15 text-blue-400 border-blue-500/30">
                          {t('recordsView.kindInspection')}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-primary">
                        {ins.inspectionNumber}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t('recordsView.batchPrefix', { value: ins.batch?.batchNumber ?? '—' })}
                      </TableCell>
                      <TableCell>
                        <InspectionTypeBadge type={ins.type} />
                      </TableCell>
                      <TableCell>
                        <ResultBadge result={ins.result} />
                      </TableCell>
                      <TableCell className="text-xs max-w-[120px] truncate text-muted-foreground">
                        {ins.sku?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(ins.plannedDate ?? ins.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/quality/inspections/${ins.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2"
                          >
                            {t('common.view')}
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                }

                const ncr = item.record;
                return (
                  <TableRow
                    key={`ncr-${ncr.id}`}
                    className="border-border/20 hover:bg-muted/20"
                  >
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-red-500/15 text-red-400 border-red-500/30">
                        {t('recordsView.kindNcr')}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-primary">
                      {ncr.ncrNumber}
                    </TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">
                      {ncr.title}
                    </TableCell>
                    <TableCell>
                      <NcrSeverityBadge severity={ncr.severity} />
                    </TableCell>
                    <TableCell>
                      <NcrStatusBadge status={ncr.status} />
                    </TableCell>
                    <TableCell className="text-xs max-w-[120px] truncate text-muted-foreground">
                      {ncr.product?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(ncr.detectedAt)}
                    </TableCell>
                    <TableCell>
                      <Link href={`/quality/ncr/${ncr.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2"
                        >
                          {t('common.view')}
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={onPageChange}
      />
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QualityRecordsView() {
  const { t } = useTranslation(['quality', 'common']);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [inspPage, setInspPage] = useState(1);
  const [ncrPage, setNcrPage] = useState(1);
  const [allPage, setAllPage] = useState(1);
  const [activeTab, setActiveTab] = useState('all');

  // Reset page when filters change
  const handleFiltersChange = (f: FilterState) => {
    setFilters(f);
    setInspPage(1);
    setNcrPage(1);
    setAllPage(1);
  };

  // ── API calls ──────────────────────────────────────────────────────────────

  const { data: inspData, isLoading: inspLoading } =
    useQuery<InspectionsResponse>({
      queryKey: ['quality', 'inspections', 'records-view'],
      queryFn: () =>
        api.get('/quality/inspections', {
          params: { limit: 50, page: 1 },
        }) as Promise<InspectionsResponse>,
      refetchInterval: 30_000,
      staleTime: 25_000,
    });

  const { data: ncrData, isLoading: ncrLoading } = useQuery<NcrResponse>({
    queryKey: ['quality', 'ncr', 'records-view'],
    queryFn: () =>
      api.get('/quality/ncr', {
        params: { status: 'OPEN', limit: 50 },
      }) as Promise<NcrResponse>,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const allInspections: Inspection[] = (inspData as any)?.data ?? [];
  const allNcrs: NCR[] = (ncrData as any)?.data ?? [];

  // ── KPI calculations ───────────────────────────────────────────────────────

  const totalInspections = (inspData as any)?.total ?? allInspections.length;
  const totalNcrs = (ncrData as any)?.total ?? allNcrs.length;

  const passRate = useMemo(() => {
    const completed = allInspections.filter(
      (i) => i.totalCount > 0,
    );
    if (completed.length === 0) return 0;
    const totalPass = completed.reduce((s, i) => s + i.passCount, 0);
    const totalQty = completed.reduce((s, i) => s + i.totalCount, 0);
    return totalQty > 0 ? Math.round((totalPass / totalQty) * 100) : 0;
  }, [allInspections]);

  const openNcrs = allNcrs.filter((n) => n.status === 'OPEN').length;

  const pendingInspections = allInspections.filter(
    (i) => i.status === 'PLANNED' || i.status === 'IN_PROGRESS',
  ).length;

  // ── Client-side filtering ──────────────────────────────────────────────────

  const filteredInspections = useMemo(() => {
    let list = allInspections;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (i) =>
          i.inspectionNumber.toLowerCase().includes(q) ||
          i.sku?.name?.toLowerCase().includes(q) ||
          i.batch?.batchNumber?.toLowerCase().includes(q),
      );
    }
    if (filters.type !== 'ALL') {
      list = list.filter((i) => i.type === filters.type);
    }
    if (filters.result !== 'ALL') {
      list = list.filter((i) => i.result === filters.result);
    }
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      list = list.filter(
        (i) => new Date(i.plannedDate ?? i.createdAt).getTime() >= from,
      );
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo).getTime() + 86_400_000;
      list = list.filter(
        (i) => new Date(i.plannedDate ?? i.createdAt).getTime() <= to,
      );
    }
    return list;
  }, [allInspections, filters]);

  const filteredNcrs = useMemo(() => {
    let list = allNcrs;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (n) =>
          n.ncrNumber.toLowerCase().includes(q) ||
          n.title.toLowerCase().includes(q) ||
          n.product?.name?.toLowerCase().includes(q),
      );
    }
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      list = list.filter(
        (n) => new Date(n.detectedAt).getTime() >= from,
      );
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo).getTime() + 86_400_000;
      list = list.filter((n) => new Date(n.detectedAt).getTime() <= to);
    }
    return list;
  }, [allNcrs, filters]);

  // Paginated slices
  const pagedInspections = useMemo(() => {
    const start = (inspPage - 1) * PAGE_SIZE;
    return filteredInspections.slice(start, start + PAGE_SIZE);
  }, [filteredInspections, inspPage]);

  const pagedNcrs = useMemo(() => {
    const start = (ncrPage - 1) * PAGE_SIZE;
    return filteredNcrs.slice(start, start + PAGE_SIZE);
  }, [filteredNcrs, ncrPage]);

  const mergedRecords: MergedRecord[] = useMemo(() => {
    const inspRecords: MergedRecord[] = filteredInspections.map((r) => ({
      kind: 'inspection',
      record: r,
    }));
    const ncrRecords: MergedRecord[] = filteredNcrs.map((r) => ({
      kind: 'ncr',
      record: r,
    }));
    // Interleave by date descending
    return [...inspRecords, ...ncrRecords].sort((a, b) => {
      const dateA =
        a.kind === 'inspection'
          ? new Date(a.record.plannedDate ?? a.record.createdAt).getTime()
          : new Date(a.record.detectedAt).getTime();
      const dateB =
        b.kind === 'inspection'
          ? new Date(b.record.plannedDate ?? b.record.createdAt).getTime()
          : new Date(b.record.detectedAt).getTime();
      return dateB - dateA;
    });
  }, [filteredInspections, filteredNcrs]);

  const pagedMerged = useMemo(() => {
    const start = (allPage - 1) * PAGE_SIZE;
    return mergedRecords.slice(start, start + PAGE_SIZE);
  }, [mergedRecords, allPage]);

  const isLoading = inspLoading || ncrLoading;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2.5">
          <ClipboardCheck size={20} className="text-primary" />
          <div>
            <h1 className="text-lg font-bold">{t('headers.records.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('headers.records.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/quality/inspections?new=1">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
              <ClipboardCheck size={13} />
              {t('recordsView.newInspection')}
            </Button>
          </Link>
          <Link href="/quality/ncr?new=1">
            <Button size="sm" className="h-8 text-xs gap-1.5">
              <AlertTriangle size={13} />
              {t('recordsView.newNcr')}
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label={t('recordsView.totalInspections')}
            value={totalInspections}
            sub={t('recordsView.totalInspectionsSub')}
            delay={0}
          />
          <KpiCard
            label={t('recordsView.passRate')}
            value={`${passRate}%`}
            sub={t('recordsView.passRateSub')}
            valueClassName={
              passRate >= 95
                ? 'text-green-400'
                : passRate >= 80
                ? 'text-amber-400'
                : 'text-red-400'
            }
            delay={0.05}
          />
          <KpiCard
            label={t('recordsView.openNcrs')}
            value={openNcrs}
            sub={t('recordsView.openNcrsSub')}
            valueClassName={openNcrs > 0 ? 'text-red-400' : undefined}
            delay={0.1}
          />
          <KpiCard
            label={t('recordsView.pendingInspections')}
            value={pendingInspections}
            sub={t('recordsView.pendingInspectionsSub')}
            valueClassName={pendingInspections > 0 ? 'text-amber-400' : undefined}
            delay={0.15}
          />
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v);
            handleFiltersChange(INITIAL_FILTERS);
          }}
        >
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs h-7 px-3">
              {t('recordsView.tabAll')}
            </TabsTrigger>
            <TabsTrigger value="inspections" className="text-xs h-7 px-3">
              {t('recordsView.tabInspections')}
              {filteredInspections.length > 0 && (
                <span className="ml-1.5 bg-primary/20 text-primary text-[10px] px-1.5 py-0.5 rounded-full tabular-nums">
                  {filteredInspections.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="ncrs" className="text-xs h-7 px-3">
              {t('recordsView.tabNcrs')}
              {filteredNcrs.length > 0 && (
                <span className="ml-1.5 bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded-full tabular-nums">
                  {filteredNcrs.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* All Records */}
          <TabsContent value="all" className="mt-4">
            <div className="industrial-card p-4">
              <FilterBar
                filters={filters}
                onChange={handleFiltersChange}
                showTypeFilter={false}
                showResultFilter={false}
              />
              <AllRecordsTable
                records={pagedMerged}
                isLoading={isLoading}
                total={mergedRecords.length}
                page={allPage}
                onPageChange={setAllPage}
              />
            </div>
          </TabsContent>

          {/* Inspections */}
          <TabsContent value="inspections" className="mt-4">
            <div className="industrial-card p-4">
              <FilterBar
                filters={filters}
                onChange={handleFiltersChange}
                showTypeFilter
                showResultFilter
              />
              <InspectionsTable
                inspections={pagedInspections}
                isLoading={inspLoading}
                total={filteredInspections.length}
                page={inspPage}
                onPageChange={setInspPage}
              />
            </div>
          </TabsContent>

          {/* NCRs */}
          <TabsContent value="ncrs" className="mt-4">
            <div className="industrial-card p-4">
              <FilterBar
                filters={filters}
                onChange={handleFiltersChange}
                showTypeFilter={false}
                showResultFilter={false}
              />
              <NcrTable
                ncrs={pagedNcrs}
                isLoading={ncrLoading}
                total={filteredNcrs.length}
                page={ncrPage}
                onPageChange={setNcrPage}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
