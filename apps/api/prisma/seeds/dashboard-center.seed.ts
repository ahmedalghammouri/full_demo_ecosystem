// ============================================================
// Industry360° — Dashboard Center seed
// Seeds system categories + a built-in catalog that points at the
// existing Industry360° module dashboards/analytics/reports, plus a few
// Grafana dashboard templates. Fully idempotent (slug-keyed upserts).
// ============================================================

import { PrismaClient, DashboardSource, DashboardType, DashboardVisibility } from '@prisma/client';

interface CategorySeed {
  key: string; name: string; icon: string; color: string; sortOrder: number;
}

interface DashboardSeed {
  slug: string;
  title: string;
  description: string;
  source: DashboardSource;
  type: DashboardType;
  categoryKey: string;
  icon: string;
  route?: string;
  grafanaUid?: string;
  grafanaSlug?: string;
  externalUrl?: string;
  tags: string[];
  isTemplate?: boolean;
  supportedScopes?: string[];
  visibility?: DashboardVisibility;
}

const CATEGORIES: CategorySeed[] = [
  { key: 'overview',     name: 'Overview',      icon: 'LayoutDashboard', color: '#6175f4', sortOrder: 1 },
  { key: 'production',   name: 'Production',    icon: 'Factory',         color: '#22c55e', sortOrder: 2 },
  { key: 'manufacturing',name: 'Manufacturing', icon: 'Cog',             color: '#14b8a6', sortOrder: 3 },
  { key: 'quality',      name: 'Quality',       icon: 'ShieldCheck',     color: '#a855f7', sortOrder: 4 },
  { key: 'maintenance',  name: 'Maintenance',   icon: 'Wrench',          color: '#f59e0b', sortOrder: 5 },
  { key: 'energy',       name: 'Energy',        icon: 'Zap',             color: '#eab308', sortOrder: 6 },
  { key: 'inventory',    name: 'Inventory',     icon: 'Package',         color: '#0ea5e9', sortOrder: 7 },
  { key: 'reports',      name: 'Reports',       icon: 'FileText',        color: '#64748b', sortOrder: 8 },
  { key: 'analytics',    name: 'Analytics',     icon: 'BarChart3',       color: '#ec4899', sortOrder: 9 },
  { key: 'iiot',         name: 'IIoT & Devices', icon: 'Cpu',            color: '#06b6d4', sortOrder: 10 },
  { key: 'traceability', name: 'Traceability',  icon: 'GitBranch',       color: '#f97316', sortOrder: 11 },
];

const NATIVE: DashboardSeed[] = [
  // Overview
  { slug: 'command-center', title: 'Command Center', description: 'Unified flagship cockpit — production OEE, energy & utilities, losses and an executive cross-unit rollup in one scope-aware screen.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.EXECUTIVE, categoryKey: 'overview', icon: 'Gauge', route: '/command-center', tags: ['oee', 'energy', 'executive', 'realtime', 'cockpit'], supportedScopes: ['FACTORY', 'AREA', 'LINE', 'MACHINE'] },
  { slug: 'executive-multiplant', title: 'Executive Multi-Plant', description: 'Enterprise rollup across factories — OEE, output, energy cost, alarms, NCRs and maintenance backlog with factory comparison.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.EXECUTIVE, categoryKey: 'overview', icon: 'Factory', route: '/executive', tags: ['executive', 'multiplant', 'enterprise', 'oee'], supportedScopes: ['FACTORY'] },
  { slug: 'ai-intelligence', title: 'AI Intelligence', description: 'Rule-based insights, anomaly detection, equipment health.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.ANALYTICS, categoryKey: 'analytics', icon: 'Sparkles', route: '/ai', tags: ['ai', 'insights', 'predictive'] },

  // Production
  { slug: 'production-overview', title: 'Production Overview', description: 'Work orders, batches and OEE monitoring.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.PRODUCTION, categoryKey: 'production', icon: 'Gauge', route: '/production', tags: ['production', 'work-orders'] },
  // ── The OEE section, as it actually exists ────────────────────────────────
  // Nine pages became three. These three entries used to point at
  // /production/kpi, /production/oee and /manufacturing/oee, all deleted —
  // so the catalogue offered three cards that led to a 404, and offered none
  // of the pages that replaced them.
  //
  // The SLUGS are kept. A slug is the upsert key, so reusing them carries any
  // favourite or permission somebody set on the old card onto the page that
  // took its job, instead of orphaning it.
  { slug: 'production-kpi', title: 'Live Shift', description: 'The running shift as it happens — machines, job orders, output and OEE from the start of the shift to now. No time filter: the window is the shift.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.OPERATIONAL, categoryKey: 'production', icon: 'Radio', route: '/live-shift', tags: ['live', 'shift', 'oee', 'realtime'], supportedScopes: ['FACTORY', 'AREA', 'LINE', 'MACHINE'] },
  { slug: 'production-oee', title: 'OEE Analysis', description: 'The time model and both bases side by side — availability, performance, quality, losses, downtime, equipment, schedule and the factory tree, over any period.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.ANALYTICS, categoryKey: 'production', icon: 'LineChart', route: '/oee-analysis', tags: ['oee', 'analytics', 'availability', 'performance', 'quality', 'teep'], supportedScopes: ['FACTORY', 'AREA', 'LINE', 'MACHINE'] },
  { slug: 'production-downtime', title: 'Downtime Analytics', description: 'Downtime Pareto and loss analysis.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.ANALYTICS, categoryKey: 'production', icon: 'AlertTriangle', route: '/production/downtime', tags: ['downtime', 'losses'] },

  // Manufacturing
  { slug: 'manufacturing-overview', title: 'Manufacturing Overview', description: 'Execution, dispatch and shop-floor status.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.OPERATIONAL, categoryKey: 'manufacturing', icon: 'Cog', route: '/manufacturing', tags: ['mrp', 'execution'] },
  { slug: 'manufacturing-oee', title: 'OEE Breakdown', description: 'The same window cut by machine, job order and shift, with the KPI sheet beside it — which asset, which order or which crew is holding the line back.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.ANALYTICS, categoryKey: 'production', icon: 'Table2', route: '/oee-breakdown', tags: ['oee', 'breakdown', 'machines', 'shifts', 'job-orders'], supportedScopes: ['FACTORY', 'AREA', 'LINE', 'MACHINE'] },

  // Quality
  { slug: 'quality-overview', title: 'Quality Overview', description: 'Inspections, NCR, CAPA and SPC.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.QUALITY, categoryKey: 'quality', icon: 'ShieldCheck', route: '/quality', tags: ['quality', 'spc', 'ncr'] },
  { slug: 'quality-intelligence', title: 'Quality Intelligence', description: 'FPY trend, defect Pareto, NCR severity & status mix, CAPA funnel and inspection outcomes.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.QUALITY, categoryKey: 'quality', icon: 'TrendingUp', route: '/quality/intelligence', tags: ['quality', 'fpy', 'defects', 'ncr', 'capa'], supportedScopes: ['FACTORY', 'AREA', 'LINE', 'MACHINE'] },
  { slug: 'quality-spc', title: 'SPC Charts', description: 'Statistical process control charts.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.ANALYTICS, categoryKey: 'quality', icon: 'LineChart', route: '/quality/spc', tags: ['spc', 'control'] },

  // Maintenance
  { slug: 'maintenance-overview', title: 'Maintenance Overview', description: 'Work orders, MTTR/MTBF and PM compliance.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.MAINTENANCE, categoryKey: 'maintenance', icon: 'Wrench', route: '/maintenance', tags: ['maintenance', 'mttr', 'mtbf'] },
  { slug: 'reliability-cockpit', title: 'Reliability Command Center', description: 'Asset reliability, MTTR/MTBF trend, PM compliance, WO workload & top failure modes by RPN.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.MAINTENANCE, categoryKey: 'maintenance', icon: 'Activity', route: '/maintenance/reliability', tags: ['maintenance', 'reliability', 'mttr', 'mtbf', 'fmea', 'rpn'], supportedScopes: ['FACTORY', 'AREA', 'LINE', 'MACHINE'] },

  // Energy
  { slug: 'energy-overview', title: 'Energy Overview', description: 'Consumption, cost and waste analysis.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.ENERGY, categoryKey: 'energy', icon: 'Zap', route: '/energy', tags: ['energy', 'kwh', 'cost'] },
  { slug: 'energy-command-center', title: 'Energy Command Center', description: 'Live power, multi-utility consumption trend, standby waste, energy split (running/idle/downtime) and specific energy (kWh/unit).', source: DashboardSource.Industry360_NATIVE, type: DashboardType.ENERGY, categoryKey: 'energy', icon: 'Zap', route: '/energy/command-center', tags: ['energy', 'power', 'cost', 'waste', 'kwh-per-unit'], supportedScopes: ['FACTORY', 'AREA', 'LINE', 'MACHINE'] },

  // Inventory
  { slug: 'inventory-overview', title: 'Inventory Overview', description: 'Stock, spare parts and storage.', source: DashboardSource.Industry360_NATIVE, type: DashboardType.OPERATIONAL, categoryKey: 'inventory', icon: 'Package', route: '/inventory', tags: ['inventory', 'stock'] },

  // Reports
  { slug: 'report-production', title: 'Production Report', description: 'Production reporting & exports.', source: DashboardSource.REPORT, type: DashboardType.REPORT, categoryKey: 'reports', icon: 'Factory', route: '/reports/production', tags: ['report', 'production'] },
  { slug: 'report-quality', title: 'Quality Report', description: 'Quality reporting & exports.', source: DashboardSource.REPORT, type: DashboardType.REPORT, categoryKey: 'reports', icon: 'ShieldCheck', route: '/reports/quality', tags: ['report', 'quality'] },
  { slug: 'report-maintenance', title: 'Maintenance Report', description: 'Maintenance reporting & exports.', source: DashboardSource.REPORT, type: DashboardType.REPORT, categoryKey: 'reports', icon: 'Wrench', route: '/reports/maintenance', tags: ['report', 'maintenance'] },
];

// Grafana dashboards — the provisioned Industry360° Grafana suite (grafana/dashboards/*,
// generate.mjs is source of truth). Cataloged by real UID so they are published and
// launchable from the Dashboard Center. Folder → category; tags carried from the JSON.
/**
 * The Grafana suite is no longer seeded.
 *
 * Sixty-six rows were re-inserted on EVERY deploy — prod-init runs this seed
 * unconditionally so the catalogue picks up new dashboards — which meant the
 * Custom source could be excluded at the API and still be back in the database
 * the next time the image shipped.
 *
 * Removing it here is what makes that removal hold. Existing rows are left
 * alone: they carry saved panels, and the read path already excludes them, so
 * nothing surfaces them and nothing is destroyed.
 */
const GRAFANA_DASHBOARDS: DashboardSeed[] = [];

export async function seedDashboardCenter(prisma: PrismaClient) {
  // 1. Categories (global / enterprise-wide → factoryId null).
  // Use findFirst (not composite upsert) because the unique includes a nullable
  // factoryId, which Postgres treats as distinct → not reliably idempotent.
  const catIdByKey = new Map<string, string>();
  for (const c of CATEGORIES) {
    const existing = await prisma.dashboardCategory.findFirst({
      where: { factoryId: null, key: c.key },
    });
    const cat = existing
      ? await prisma.dashboardCategory.update({
          where: { id: existing.id },
          data: { name: c.name, icon: c.icon, color: c.color, sortOrder: c.sortOrder, isSystem: true },
        })
      : await prisma.dashboardCategory.create({
          data: { factoryId: null, key: c.key, name: c.name, icon: c.icon, color: c.color, sortOrder: c.sortOrder, isSystem: true },
        });
    catIdByKey.set(c.key, cat.id);
  }

  // 2. Built-in dashboards — keyed by slug, global (factoryId null), system, published.
  const all = [...NATIVE, ...GRAFANA_DASHBOARDS];
  let created = 0;
  for (const d of all) {
    const existing = await prisma.dashboard.findFirst({ where: { slug: d.slug, isSystem: true } });
    const data = {
      factoryId: null,
      categoryId: catIdByKey.get(d.categoryKey) ?? null,
      slug: d.slug,
      title: d.title,
      description: d.description,
      source: d.source,
      type: d.type,
      visibility: d.visibility ?? DashboardVisibility.PUBLIC,
      route: d.route ?? null,
      externalUrl: d.externalUrl ?? null,
      grafanaUid: d.grafanaUid || null,
      grafanaSlug: d.grafanaSlug ?? null,
      icon: d.icon,
      tags: d.tags,
      isFactoryAware: true,
      supportedScopes: d.supportedScopes ?? ['FACTORY'],
      isTemplate: d.isTemplate ?? false,
      // Grafana entries without a UID are parked as unpublished until mapped.
      isPublished: d.source === DashboardSource.GRAFANA ? !!d.grafanaUid : true,
      isSystem: true,
    };
    if (existing) {
      await prisma.dashboard.update({ where: { id: existing.id }, data });
    } else {
      await prisma.dashboard.create({ data });
      created++;
    }
  }

  console.log(`  📊 Dashboard Center: ${CATEGORIES.length} categories, ${all.length} catalog entries (${created} new)`);
}
