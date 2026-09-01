'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useViewModeStore, type ViewMode } from '@/store/view-mode-store';
import { PageTabs } from './page-tabs';

/**
 * The view-mode contract, and the sub-tab strip for a wholly analytical page.
 *
 * ── What used to live here ──────────────────────────────────────────────────
 * A LiveAnalyticsTabs shell that gave every subject a Now tab and an Analytics
 * tab. That arrangement is gone: the nine OEE subject pages became one live
 * page and two analytical ones, so nothing pairs the two readings on a single
 * route any more. The shell went with its last caller rather than sitting here
 * as a component nothing renders.
 *
 * What survives is the part that was never about tabs. Declaring the view mode
 * is what hides or shows the period control, so a live screen cannot offer a
 * date range it has no way to honour — and that rule outlived the shell.
 */

const STORAGE_KEY = 'industry360-view-mode';

/**
 * One analytical view, when a subject has more than one.
 *
 * Two pages that answer the same question with different charts are two pages a
 * reader has to reconcile. Folding them into sub-tabs under one subject keeps
 * every view that existed while leaving exactly one place to look — which is the
 * whole point of the consolidation, and why the answer was tabs and not a
 * deletion: no chart anybody relied on disappears.
 */
export interface AnalyticsPanel {
  id: string;
  label: string;
  node: React.ReactNode;
}

/**
 * For a page that is wholly live or wholly analytical.
 *
 * Declaring the mode is what hides or shows the period control, so a page that
 * skips this gets whatever the last page set — which is how a live screen ends up
 * offering a date range it cannot honour.
 */
export function useDeclareViewMode(mode: ViewMode) {
  const setMode = useViewModeStore((s) => s.setMode);
  React.useEffect(() => { setMode(mode); }, [mode, setMode]);
}

/**
 * Sub-tabs for a page that is wholly analytical.
 *
 * Some subjects have several period views and no live one — the KPI sheets and
 * the report packs. They were separate routes with separate menu entries,
 * answering one question in several layouts, which reads as several questions.
 * This gives them the same "one subject, several cuts" shape as the tabbed pages
 * without inventing a live half that has nothing to show.
 *
 * It declares the analytics view mode itself, so the period control stays
 * available — that is the whole point of these pages.
 */
export function AnalyticsViewTabs({ views, storageKey }: { views: AnalyticsPanel[]; storageKey: string }) {
  const { t } = useTranslation(['production', 'common']);
  useDeclareViewMode('analytics');
  const store = `${STORAGE_KEY}:sub:${storageKey}`;
  const [sub, setSub] = React.useState<string | null>(null);

  React.useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(store); } catch { /* private mode */ }
    setSub(views.some((v) => v.id === saved) ? saved : views[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, views.length]);

  const choose = (id: string) => {
    setSub(id);
    try { window.localStorage.setItem(store, id); } catch { /* private mode */ }
  };

  if (views.length === 0) return null;
  if (views.length === 1) return <>{views[0].node}</>;
  const current = views.find((v) => v.id === sub) ?? views[0];

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 shrink-0">
        <PageTabs
          label={t('live.viewsLabel')}
          value={current.id}
          onChange={choose}
          tabs={views.map((v) => ({ key: v.id, label: v.label }))}
        />
      </div>
      <div className="flex-1 overflow-auto">{current.node}</div>
    </div>
  );
}
