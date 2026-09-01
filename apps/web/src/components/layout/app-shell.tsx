'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { ScopePanel } from './scope-panel';
import { QuickDock } from './quick-dock';
import { useSidebarStore } from '@/store/ui-store';
import { NavigationProgress } from '@/components/ui/navigation-progress';
import { useLiveKpi } from '@/hooks/use-live-kpi';
import { useNotificationFeed } from '@/hooks/use-websocket';

interface AppShellProps {
  children: React.ReactNode;
}

// Pages where selecting a hierarchy node actually re-scopes the data (backend filter wired).
//
// Keep this list honest — it is verified by the page audit (docs/Industry360-Web-Page-Audit.xlsx).
// A route listed here whose page does NOT read `useScope` is the worst failure mode: the
// filter looks operative and silently does nothing. A route missing from here whose page
// DOES filter is nearly as bad — the panel renders passive, so nobody uses a control that
// works. Re-run the audit after touching this list.
const SCOPE_EXACT = new Set([
  '/dashboard', '/command-center', '/production', '/manufacturing',
  '/production/kpi', '/production/oee', '/manufacturing/kpi', '/manufacturing/oee',
  '/production/downtime', '/production/orders', '/production/production-orders',
  '/production/reports', '/quality/reports',
  '/maintenance/reliability', '/quality/intelligence',
  '/downtime', // Downtime Command Center
  '/energy', '/energy/command-center', '/energy/analytics',
  '/ai', // AI Intelligence — all panels re-scope by area/line/machine
  // ── Added after the page audit: these pages already filtered by scope, but were
  // rendering the panel as passive, so the working control looked disabled.
  '/analytics', '/analytics/insights',
  '/energy/live', '/energy/reports',
  '/executive',
  '/maintenance', // Maintenance overview — KPI cards are scope-aware
  '/shop-floor',
  // ── Quality: listed individually, NOT by prefix. A blanket '/quality' rule also
  // caught /quality/capa and /quality/records, whose APIs take no scope parameter,
  // so the panel advertised a filter those two pages could never honour.
  '/quality', '/quality/inspections', '/quality/ncr', '/quality/plans', '/quality/spc',
  // ── Scheduling: same reasoning. The three ScheduleView routes filter; the APS
  // board and the reschedule-request queue do not.
  '/scheduling', '/scheduling/planned-downtime', '/scheduling/unplanned-downtime',
]);

// Single-record pages: a hierarchy filter cannot mean anything on one CAPA / NCR /
// inspection / job order, so they are never marked active.
const DETAIL_ROUTE = /\/[0-9a-f-]{8,}(?:\/|$)|\[/i;

function isScopeRoute(pathname: string): boolean {
  if (DETAIL_ROUTE.test(pathname)) return false;
  return SCOPE_EXACT.has(pathname);
}

export function AppShell({ children }: AppShellProps) {
  const { isCollapsed } = useSidebarStore();
  const pathname = usePathname();
  useLiveKpi(); // live JO→WO→PO OEE/status updates
  useNotificationFeed(); // live per-user notification toasts + bell badge

  // The scope tree is shown on every platform page for a consistent shell.
  // On routes wired to a backend filter it actively re-scopes data; elsewhere it
  // is "passive" (selection persists globally and applies once you reach an
  // analytics/dashboard page) — see ScopePanel.
  const scopeActive = isScopeRoute(pathname ?? '');

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <NavigationProgress />
      <Sidebar />
      <div
        className="flex flex-1 overflow-hidden transition-[margin] duration-300 ease-in-out"
        style={{ marginInlineStart: isCollapsed ? '64px' : '260px' }}
      >
        <ScopePanel passive={!scopeActive} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="relative flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>

      {/* Global macOS-style quick-action dock — available on every page */}
      <QuickDock />
    </div>
  );
}
