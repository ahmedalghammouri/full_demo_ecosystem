'use client';
/**
 * Production reports — one pack, three sheets.
 *
 * ── What this merged ────────────────────────────────────────────────────────
 * Three routes produced production reports: a shift-and-line pack, a
 * manufacturing pack, and a single-endpoint report page. They overlapped on five
 * endpoints, so the same figure was printed by three sheets that a reader had to
 * find separately and could not tell apart by name.
 *
 * One pack, three sheets. Every sheet survives; all three URLs still resolve.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { AnalyticsViewTabs } from '@/components/layout/live-analytics-tabs';
import ManufacturingReportsView from '@/features/manufacturing/manufacturing-reports-view';
import { ProductionReportView } from '@/features/reports/production-report-view';
import ProductionReportsView from './production-reports-view';

export function ReportsPage() {
  const { t } = useTranslation(['production', 'common']);
  return (
    <AnalyticsViewTabs
      storageKey="production-reports"
      views={[
        { id: 'shift', label: t('live.repViewShift'), node: <ProductionReportsView /> },
        { id: 'manufacturing', label: t('live.repViewManufacturing'), node: <ManufacturingReportsView /> },
        { id: 'summary', label: t('live.repViewSummary'), node: <ProductionReportView /> },
      ]}
    />
  );
}
