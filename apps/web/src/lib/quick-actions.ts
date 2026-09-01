import type { LucideIcon } from 'lucide-react';
import {
  SlidersHorizontal, GitCommit, ClipboardList, Layers, Monitor, AlertTriangle,
  Boxes, CalendarRange, CalendarClock, Calendar, Factory, Gauge,
  ShieldCheck, ClipboardCheck, LineChart, FlaskConical,
  Wrench, PackageSearch, Cpu, BoxesIcon, GitMerge, Workflow, GitPullRequest, MapPin,
  GitBranch, Activity, Network, Radio, Zap, BarChart3, FileText, Sparkles, Bell,
  Cog, BookOpen, Truck, Layers3,
  Siren, Archive, LayoutDashboard, Router, History, Waves, PackageMinus, FileCheck,
  ScrollText, PackageX, ZapOff, PencilRuler, ArrowLeftRight, Package, FileBarChart, Users,
  TabletSmartphone, PauseCircle,
} from 'lucide-react';

export interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Tailwind text color class for the glyph. */
  tone: string;
  /** Open in a new browser tab (e.g. the live shop-floor board). */
  newTab?: boolean;
}

export interface QuickActionGroup {
  /** Category label shown above the group / in the dock separator. */
  category: string;
  /** Accent color class for the category header + separator. */
  accent: string;
  icon: LucideIcon;
  actions: QuickAction[];
}

/**
 * Single source of truth for the project-wide quick actions, organised into the
 * same mental model as the sidebar. Consumed by both the Home quick-launcher grid
 * and the global macOS-style dock so they never drift apart.
 */
export const QUICK_ACTION_GROUPS: QuickActionGroup[] = [
  {
    category: 'Dashboards',
    accent: 'text-indigo-400',
    icon: Gauge,
    actions: [
      { label: 'Command Center',          href: '/command-center',        icon: Gauge,           tone: 'text-primary' },
      { label: 'Downtime Command Center', href: '/downtime',              icon: PauseCircle,     tone: 'text-rose-400' },
      { label: 'Energy Command Center',   href: '/energy/command-center', icon: Zap,             tone: 'text-yellow-400' },
      { label: 'Executive Multi-Plant',   href: '/executive',             icon: Factory,         tone: 'text-cyan-400' },
      { label: 'Dashboard Center',        href: '/dashboard-center',      icon: LayoutDashboard, tone: 'text-fuchsia-400' },
    ],
  },
  {
    category: 'OEE',
    accent: 'text-fuchsia-400',
    icon: Gauge,
    actions: [
      // The nine OEE routes became three. The six tiles that pointed at the
      // others were still here after the routes were deleted — a launcher is a
      // second copy of the navigation, and a copy is what goes stale.
      { label: 'Live Shift',    href: '/live-shift',    icon: Activity,  tone: 'text-emerald-400' },
      { label: 'OEE Analysis',  href: '/oee-analysis',  icon: LineChart, tone: 'text-fuchsia-400' },
      { label: 'OEE Breakdown', href: '/oee-breakdown', icon: Layers,    tone: 'text-violet-400' },
    ],
  },
  {
    category: 'Analytics & Reports',
    accent: 'text-pink-400',
    icon: BarChart3,
    actions: [
      // Factory Analytics and the two KPI sheets are tabs on the OEE pages now;
      // Insights Studio explored the same trend those pages chart.
      { label: 'Reports',           href: '/reports',            icon: FileText,  tone: 'text-purple-400' },
      { label: 'Report Builder',    href: '/reports/builder',    icon: FileBarChart, tone: 'text-violet-400' },
    ],
  },
  {
    category: 'AI & Benchmarks',
    accent: 'text-pink-400',
    icon: Sparkles,
    actions: [
      { label: 'AI Intelligence', href: '/ai', icon: Sparkles, tone: 'text-pink-400' },
    ],
  },
  {
    category: 'Planning',
    accent: 'text-cyan-400',
    icon: CalendarRange,
    actions: [
      { label: 'General Schedule',    href: '/scheduling',                       icon: CalendarRange,  tone: 'text-cyan-400' },
      { label: 'Production Schedule', href: '/scheduling/production',            icon: Factory,        tone: 'text-sky-400' },
      { label: 'Order Scheduling',    href: '/production/scheduling',            icon: Calendar,       tone: 'text-blue-400' },
      { label: 'Reschedule Req.',     href: '/scheduling/reschedule-requests',   icon: CalendarClock,  tone: 'text-indigo-400' },
      { label: 'Planned DT',          href: '/scheduling/planned-downtime',      icon: CalendarClock,  tone: 'text-amber-400' },
      { label: 'Unplanned DT',        href: '/scheduling/unplanned-downtime',    icon: ZapOff,         tone: 'text-red-400' },
      { label: 'Shift Config',        href: '/production/shifts',                icon: Calendar,       tone: 'text-teal-400' },
    ],
  },
  {
    category: 'Production',
    accent: 'text-emerald-400',
    icon: Factory,
    actions: [
      { label: 'Overview',       href: '/production',                    icon: Gauge,             tone: 'text-emerald-400' },
      { label: 'New PO',         href: '/production/production-orders',  icon: GitCommit,         tone: 'text-sky-400' },
      { label: 'Work Orders',    href: '/production/orders',             icon: ClipboardList,     tone: 'text-indigo-400' },
      { label: 'Dispatch (JO)',  href: '/production/job-orders',         icon: Layers,            tone: 'text-violet-400' },
      { label: 'Scrap Log',      href: '/production/scrap-log',          icon: PackageX,          tone: 'text-rose-400' },
      { label: 'Batches & Lots', href: '/production/batches',            icon: Boxes,             tone: 'text-blue-400' },
    ],
  },
  {
    category: 'Manufacturing',
    accent: 'text-indigo-400',
    icon: Cog,
    actions: [
      { label: 'Manufacturing Hub', href: '/manufacturing',         icon: Cog,               tone: 'text-indigo-400' },
      { label: 'Control Panel',     href: '/manufacturing/control', icon: SlidersHorizontal, tone: 'text-primary' },
      { label: 'Processes',         href: '/production/processes',  icon: Workflow,          tone: 'text-violet-400' },
      { label: 'Recipes',           href: '/production/recipes',    icon: FlaskConical,      tone: 'text-fuchsia-400' },
    ],
  },
  {
    category: 'Downtime',
    accent: 'text-rose-400',
    icon: PauseCircle,
    actions: [
      { label: 'Downtime Command Center', href: '/downtime',            icon: PauseCircle,   tone: 'text-rose-400' },
      { label: 'Downtime Management',     href: '/production/downtime', icon: AlertTriangle, tone: 'text-red-400' },
    ],
  },
  {
    category: 'Energy',
    accent: 'text-yellow-400',
    icon: Zap,
    actions: [
      { label: 'Energy Dashboard',      href: '/energy',                icon: Zap,      tone: 'text-yellow-400' },
      { label: 'Energy Command Center', href: '/energy/command-center', icon: Gauge,    tone: 'text-amber-400' },
      { label: 'Energy Analytics',      href: '/energy/reports',        icon: BarChart3, tone: 'text-orange-400' },
      { label: 'Energy Meters',         href: '/energy/meters',         icon: Zap,      tone: 'text-yellow-300' },
      { label: 'Energy Live',           href: '/energy/live',           icon: Activity, tone: 'text-amber-400' },
    ],
  },
  {
    category: 'Operation Hub',
    accent: 'text-emerald-400',
    icon: TabletSmartphone,
    actions: [
      { label: 'Shop Floor',        href: '/shop-floor',            icon: Monitor,           tone: 'text-emerald-400', newTab: true },
      { label: 'Control Panel',     href: '/manufacturing/control', icon: SlidersHorizontal, tone: 'text-primary' },
      { label: 'Maintenance Floor', href: '/maintenance-floor',     icon: Wrench,            tone: 'text-orange-400' },
      { label: 'Quality Floor',     href: '/quality-floor',         icon: ClipboardCheck,    tone: 'text-green-400' },
    ],
  },
  {
    category: 'Maintenance',
    accent: 'text-orange-400',
    icon: Wrench,
    actions: [
      { label: 'Reliability Center', href: '/maintenance/reliability', icon: Activity,      tone: 'text-rose-400' },
      { label: 'Maint. Orders',      href: '/maintenance/work-orders', icon: ClipboardList, tone: 'text-orange-400' },
      { label: 'Preventive',         href: '/maintenance/preventive',  icon: Calendar,      tone: 'text-amber-400' },
      { label: 'Maint. Scheduling',  href: '/maintenance/scheduling',  icon: CalendarClock, tone: 'text-yellow-400' },
      { label: 'Maint. Logs',        href: '/maintenance/log',         icon: ScrollText,    tone: 'text-orange-300' },
      { label: 'Spare Parts',        href: '/maintenance/spare-parts', icon: PackageSearch, tone: 'text-yellow-400' },
      { label: 'Assets',             href: '/maintenance/assets',      icon: Cpu,           tone: 'text-rose-400' },
    ],
  },
  {
    category: 'Quality',
    accent: 'text-green-400',
    icon: ShieldCheck,
    actions: [
      { label: 'Quality Intelligence', href: '/quality/intelligence', icon: LineChart,      tone: 'text-emerald-400' },
      { label: 'Quality Plans',        href: '/quality/plans',        icon: ClipboardList,  tone: 'text-green-400' },
      { label: 'Inspections',          href: '/quality/inspections',  icon: ClipboardCheck, tone: 'text-emerald-400' },
      { label: 'Non-Conformance',      href: '/quality/ncr',          icon: AlertTriangle,  tone: 'text-red-400' },
      { label: 'CAPA',                 href: '/quality/capa',         icon: ShieldCheck,    tone: 'text-teal-400' },
      { label: 'SPC Charts',           href: '/quality/spc',          icon: LineChart,      tone: 'text-sky-400' },
      { label: 'Quality Records',      href: '/quality/records',      icon: FileCheck,      tone: 'text-lime-400' },
    ],
  },
  {
    category: 'Inventory & Materials',
    accent: 'text-blue-400',
    icon: Package,
    actions: [
      { label: 'Products',        href: '/inventory/products',          icon: BoxesIcon,      tone: 'text-blue-400' },
      { label: 'Raw Materials',   href: '/inventory/raw-materials',     icon: FlaskConical,   tone: 'text-cyan-400' },
      { label: 'Material Lots',   href: '/inventory/materials',         icon: Layers3,        tone: 'text-teal-400' },
      { label: 'Stock Movements', href: '/inventory/stock-movements',   icon: ArrowLeftRight, tone: 'text-sky-400' },
      { label: 'Spare Stock',     href: '/inventory/spare-parts',       icon: Package,        tone: 'text-amber-400' },
      { label: 'Storage',         href: '/inventory/storage-locations', icon: MapPin,         tone: 'text-lime-400' },
      { label: 'BOM',             href: '/inventory/bom',               icon: GitMerge,       tone: 'text-rose-400' },
    ],
  },
  {
    category: 'Traceability',
    accent: 'text-lime-400',
    icon: GitBranch,
    actions: [
      { label: 'Trace Log',    href: '/traceability',             icon: GitBranch,    tone: 'text-lime-400' },
      { label: 'Genealogy',    href: '/traceability/genealogy',   icon: Network,      tone: 'text-emerald-400' },
      { label: 'Consumption',  href: '/traceability/consumption', icon: PackageMinus, tone: 'text-amber-400' },
    ],
  },
  {
    category: 'Integration & IIoT',
    accent: 'text-sky-400',
    icon: Radio,
    actions: [
      { label: 'IoT Devices',   href: '/iot/devices',     icon: Cpu,     tone: 'text-sky-400' },
      { label: 'Tag Browser',   href: '/iot/tags',        icon: Network, tone: 'text-cyan-400' },
      { label: 'Drivers',       href: '/iot/drivers',     icon: Radio,   tone: 'text-blue-400' },
      { label: 'Gateways',      href: '/iot/gateways',    icon: Router,  tone: 'text-indigo-400' },
      { label: 'Streams',       href: '/iot/streams',     icon: Waves,   tone: 'text-teal-400' },
      { label: 'MQTT Client',   href: '/iot/mqtt-client', icon: Radio,   tone: 'text-violet-400' },
      { label: 'Historian',     href: '/iot/historian',   icon: History, tone: 'text-emerald-400' },
    ],
  },
  {
    category: 'PLM & Engineering',
    accent: 'text-purple-400',
    icon: BookOpen,
    actions: [
      { label: 'PLM Overview',    href: '/plm',                 icon: BookOpen,       tone: 'text-purple-400' },
      { label: 'Change Requests', href: '/plm/change-requests', icon: GitPullRequest, tone: 'text-pink-400' },
      { label: 'PLM Design',      href: '/plm/design',          icon: PencilRuler,    tone: 'text-purple-400' },
      { label: 'Processes',       href: '/production/processes', icon: Workflow,      tone: 'text-violet-400' },
      { label: 'BOM',             href: '/inventory/bom',       icon: GitMerge,       tone: 'text-rose-400' },
      { label: 'Recipes',         href: '/production/recipes',  icon: FlaskConical,   tone: 'text-fuchsia-400' },
    ],
  },
  {
    category: 'Plant & Monitoring',
    accent: 'text-teal-400',
    icon: GitBranch,
    actions: [
      { label: 'Plant Hierarchy', href: '/hierarchy',     icon: GitBranch, tone: 'text-teal-400' },
      { label: 'Alarms',          href: '/alarms',        icon: Siren,     tone: 'text-red-400' },
      { label: 'Notifications',   href: '/notifications', icon: Bell,      tone: 'text-orange-400' },
      { label: 'Archive',         href: '/archive',       icon: Archive,   tone: 'text-slate-400' },
      { label: 'Users & Roles',   href: '/users',         icon: Users,     tone: 'text-blue-400' },
    ],
  },
];

/** Flat list of every quick action (handy for search / counts). */
export const QUICK_ACTIONS: QuickAction[] = QUICK_ACTION_GROUPS.flatMap((g) => g.actions);

/**
 * CORE actions — the primary, daily operational shortcuts shown in the global dock.
 * The full catalogue lives on the Apps page (/apps); the dock stays focused.
 */
export const CORE_QUICK_ACTIONS: QuickAction[] = [
  { label: 'Apps',              href: '/apps',                  icon: Layers3,           tone: 'text-primary' },
  { label: 'Control Panel',     href: '/manufacturing/control', icon: SlidersHorizontal, tone: 'text-primary' },
  { label: 'New PO',            href: '/production/production-orders', icon: GitCommit,   tone: 'text-sky-400' },
  { label: 'Work Orders',       href: '/production/orders',      icon: ClipboardList,     tone: 'text-indigo-400' },
  { label: 'Dispatch (JO)',     href: '/production/job-orders',  icon: Layers,            tone: 'text-violet-400' },
  { label: 'Shop Floor',        href: '/shop-floor',            icon: Monitor,           tone: 'text-emerald-400', newTab: true },
  { label: 'Maintenance Floor', href: '/maintenance-floor',     icon: Wrench,            tone: 'text-orange-400' },
  { label: 'Quality Floor',     href: '/quality-floor',         icon: ClipboardCheck,    tone: 'text-green-400' },
  { label: 'Downtime',          href: '/production/downtime',    icon: AlertTriangle,     tone: 'text-red-400' },
  { label: 'OEE Analysis',      href: '/oee-analysis',          icon: BarChart3,         tone: 'text-fuchsia-400' },
];
