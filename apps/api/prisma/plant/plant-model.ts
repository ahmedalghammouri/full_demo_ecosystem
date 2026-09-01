/**
 * i360 Ecosystem Demo — the plant model.
 *
 * One enterprise, three factories, three manufacturing paradigms, one schema.
 * Everything the seeded system contains is described here or in the three
 * factory files this imports; the seeder reads this and writes it, and holds
 * no plant knowledge of its own.
 *
 * `validatePlantModel()` runs before the seeder writes anything. It is not
 * decoration: a mistyped `areaCode` or a tag pointing at a machine that does
 * not exist would otherwise seed cleanly and then fail hours later as an empty
 * screen, which is the worst possible time to discover it.
 */

import type { EnterpriseDef, FactoryDef, EcosystemLayer, FactoryCapability } from './types';
import { CAPABILITIES_BY_TYPE } from './types';
import { NPDF } from './factory-npdf';
import { AFCC } from './factory-afcc';
import { RMTC } from './factory-rmtc';

export * from './types';
export { NPDF, AFCC, RMTC };

// ────────────────────────────────────────────────────────────────────────────
// Capabilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * The modules a factory actually has: its type's defaults plus anything it
 * declares on top, de-duplicated and in a stable order.
 */
export function capabilitiesOf(f: FactoryDef): FactoryCapability[] {
  return [...new Set([...CAPABILITIES_BY_TYPE[f.type], ...(f.extraCapabilities ?? [])])];
}

export function hasCapability(f: FactoryDef, c: FactoryCapability): boolean {
  return capabilitiesOf(f).includes(c);
}

/**
 * Which route each capability unlocks, and what to call it in the sidebar.
 *
 * One table, read by the navigation, by the route guards and by the tests that
 * check the two agree. A route listed here with no capability behind it is a
 * dead link; a capability with no route is a claim with nothing to show.
 */
export const CAPABILITY_ROUTES: Record<FactoryCapability, { href: string; label: string; labelAr: string; group: string }> = {
  OEE:                  { href: '/oee-analysis',        label: 'OEE Analysis',        labelAr: 'تحليل الكفاءة الكلية', group: 'Analyse' },
  DOWNTIME:             { href: '/downtime',            label: 'Downtime',            labelAr: 'التوقّفات',            group: 'Analyse' },
  QUALITY:              { href: '/quality',             label: 'Quality',             labelAr: 'الجودة',               group: 'Quality' },
  MAINTENANCE:          { href: '/maintenance',         label: 'Maintenance',         labelAr: 'الصيانة',              group: 'Maintenance' },
  SCHEDULING:           { href: '/scheduling',          label: 'Scheduling',          labelAr: 'الجدولة',              group: 'Plan' },
  ENERGY_METERING:      { href: '/energy',              label: 'Energy',              labelAr: 'الطاقة',               group: 'Energy' },

  SERIAL_GENEALOGY:     { href: '/traceability',        label: 'Unit Traceability',   labelAr: 'تتبّع الوحدات',        group: 'Traceability' },
  DIGITAL_TWIN:         { href: '/twin',                label: 'Digital Twin',        labelAr: 'التوأم الرقمي',        group: 'Monitor' },
  VISION_INSPECTION:    { href: '/vision',              label: 'Vision Inspection',   labelAr: 'الفحص البصري',         group: 'Quality' },
  MATERIAL_BATCH_TRACE: { href: '/materials',           label: 'Material Batches',    labelAr: 'دفعات المواد',         group: 'Traceability' },

  LOT_GENEALOGY:        { href: '/traceability/genealogy', label: 'Lot Genealogy',    labelAr: 'نسب اللوطات',          group: 'Traceability' },
  RECIPE_BATCH:         { href: '/production/recipes',  label: 'Recipes & Batches',   labelAr: 'الوصفات والدفعات',     group: 'Plan' },
  INVENTORY:            { href: '/inventory',           label: 'Inventory',           labelAr: 'المخزون',              group: 'Materials' },
  PLM:                  { href: '/plm',                 label: 'PLM',                 labelAr: 'دورة حياة المنتج',     group: 'Engineering' },

  POWER_QUALITY:        { href: '/power-quality',       label: 'Power Quality',       labelAr: 'جودة القدرة',          group: 'Energy' },
  HARMONICS:            { href: '/harmonics',           label: 'Harmonics',           labelAr: 'التوافقيات',           group: 'Energy' },
  POWER_FACTOR:         { href: '/power-factor',        label: 'Power Factor',        labelAr: 'معامل القدرة',         group: 'Energy' },
  SINGLE_LINE_DIAGRAM:  { href: '/sld',                 label: 'Single Line Diagram', labelAr: 'المخطط الأحادي',       group: 'Energy' },
  ENERGY_BASELINE:      { href: '/energy/analytics',    label: 'Energy Baseline',     labelAr: 'خط أساس الطاقة',       group: 'Energy' },
  COST_ALLOCATION:      { href: '/cost',                label: 'Cost & Tariff',       labelAr: 'التكلفة والتعرفة',     group: 'Energy' },
  SUSTAINABILITY:       { href: '/sustainability',      label: 'Sustainability',      labelAr: 'الاستدامة',            group: 'Energy' },
  PREDICTIVE_ASSETS:    { href: '/predictive',          label: 'Predictive Health',   labelAr: 'الصحة التنبّؤية',      group: 'Maintenance' },
  ENVIRONMENT:          { href: '/environment',         label: 'Environment',         labelAr: 'البيئة',               group: 'Monitor' },
};

// ────────────────────────────────────────────────────────────────────────────
// The enterprise
// ────────────────────────────────────────────────────────────────────────────

export const ENTERPRISE: EnterpriseDef = {
  code: 'I360DG',
  name: 'Industry360 Demo Group',
  nameAr: 'مجموعة إندَستري360 التجريبية',
  industry: 'Diversified Manufacturing',
  country: 'SA',
  timezone: 'Asia/Riyadh',
  currency: 'SAR',
  factories: [NPDF, AFCC, RMTC],
};

export const FACTORIES: FactoryDef[] = ENTERPRISE.factories;

export function factory(code: string): FactoryDef {
  const f = FACTORIES.find((x) => x.code === code);
  if (!f) throw new Error(`Unknown factory code: ${code}`);
  return f;
}

// ────────────────────────────────────────────────────────────────────────────
// Demo users
//
// One account per role per factory, plus three enterprise-wide accounts. The
// password is deliberately uniform and published: these are demonstration
// accounts and must never survive into anything real.
// ────────────────────────────────────────────────────────────────────────────

export const DEMO_PASSWORD = 'Demo@2026';

export interface DemoUserDef {
  email: string;
  name: string;
  nameAr: string;
  role: string;
  jobTitle: string;
  /** Undefined means the account spans every factory. */
  factoryCode?: string;
}

const PER_FACTORY_ROLES: { role: string; key: string; title: string; name: string; nameAr: string }[] = [
  { role: 'FACTORY_ADMIN', key: 'admin', title: 'Factory Administrator', name: 'Factory Administrator', nameAr: 'مدير النظام بالمصنع' },
  { role: 'PLANT_MANAGER', key: 'plant', title: 'Plant Manager', name: 'Plant Manager', nameAr: 'مدير المصنع' },
  { role: 'PRODUCTION_MANAGER', key: 'production', title: 'Production Manager', name: 'Production Manager', nameAr: 'مدير الإنتاج' },
  { role: 'PRODUCTION_SUPERVISOR', key: 'supervisor', title: 'Shift Supervisor', name: 'Shift Supervisor', nameAr: 'مشرف الوردية' },
  { role: 'QUALITY_MANAGER', key: 'qmanager', title: 'Quality Manager', name: 'Quality Manager', nameAr: 'مدير الجودة' },
  { role: 'QUALITY_ENGINEER', key: 'quality', title: 'Quality Engineer', name: 'Quality Engineer', nameAr: 'مهندس الجودة' },
  { role: 'MAINTENANCE_MANAGER', key: 'mmanager', title: 'Maintenance Manager', name: 'Maintenance Manager', nameAr: 'مدير الصيانة' },
  { role: 'MAINTENANCE_TECHNICIAN', key: 'maintenance', title: 'Maintenance Technician', name: 'Maintenance Technician', nameAr: 'فني الصيانة' },
  { role: 'ENERGY_MANAGER', key: 'energy', title: 'Energy Manager', name: 'Energy Manager', nameAr: 'مدير الطاقة' },
  { role: 'OPERATOR', key: 'operator', title: 'Line Operator', name: 'Line Operator', nameAr: 'مشغّل الخط' },
  { role: 'VIEWER', key: 'viewer', title: 'Management Viewer', name: 'Management Viewer', nameAr: 'مطّلع إداري' },
];

export const DEMO_USERS: DemoUserDef[] = [
  { email: 'admin@industry360.sa', name: 'System Administrator', nameAr: 'مدير النظام',
    role: 'SUPER_ADMIN', jobTitle: 'Platform Administrator' },
  { email: 'executive@industry360.sa', name: 'Group Executive', nameAr: 'الإدارة التنفيذية',
    role: 'PLANT_MANAGER', jobTitle: 'Group Operations Director' },
  { email: 'viewer@industry360.sa', name: 'Group Viewer', nameAr: 'مطّلع المجموعة',
    role: 'VIEWER', jobTitle: 'Read-only Observer' },
  ...FACTORIES.flatMap((f) =>
    PER_FACTORY_ROLES.map((r) => ({
      email: `${r.key}.${f.code.toLowerCase()}@industry360.sa`,
      name: `${r.name} — ${f.code}`,
      nameAr: `${r.nameAr} — ${f.code}`,
      role: r.role,
      jobTitle: r.title,
      factoryCode: f.code,
    })),
  ),
];

// ────────────────────────────────────────────────────────────────────────────
// The ecosystem module catalogue
//
// The 64 modules the Application Suite names, across four layers plus DX and
// emerging technologies. `status` is the honest position of this platform, and
// the Ecosystem Home renders locked modules as locked rather than hiding them.
// ────────────────────────────────────────────────────────────────────────────

export type ModuleStatus = 'ACTIVE' | 'PARTIAL' | 'LOCKED';

export interface EcosystemModuleDef {
  code: string;
  name: string;
  nameAr: string;
  layer: EcosystemLayer;
  group: string;
  groupAr: string;
  status: ModuleStatus;
  /** In-app route when ACTIVE or PARTIAL. */
  href?: string;
  summary: string;
  summaryAr: string;
}

const L1 = 'L1_CONNECTIVITY' as const;
const L2 = 'L2_MES' as const;
const L3 = 'L3_SIMULATION' as const;
const L4 = 'L4_AI' as const;
const DX = 'DX' as const;
const EM = 'EMERGING' as const;

export const ECOSYSTEM_MODULES: EcosystemModuleDef[] = [
  // ── Layer 01 — Connectivity & Data Foundation (15) ───────────────────────
  { code: 'DEVICE_MGMT', name: 'Device Management', nameAr: 'إدارة الأجهزة', layer: L1, group: 'Applications', groupAr: 'التطبيقات', status: 'ACTIVE', href: '/iot/devices', summary: 'Centralised registry and lifecycle for every field device', summaryAr: 'سجل مركزي ودورة حياة لكل جهاز ميداني' },
  { code: 'DAQ', name: 'DAQ System', nameAr: 'نظام جمع البيانات', layer: L1, group: 'Applications', groupAr: 'التطبيقات', status: 'ACTIVE', href: '/iot/gateways', summary: 'Edge acquisition over Modbus, OPC-UA and MQTT with store-and-forward', summaryAr: 'استحواذ طرفي عبر Modbus و OPC-UA و MQTT مع تخزين وإعادة إرسال' },
  { code: 'SCADA', name: 'SCADA System', nameAr: 'نظام الإشراف والتحكم', layer: L1, group: 'Applications', groupAr: 'التطبيقات', status: 'PARTIAL', href: '/plant-live-view', summary: 'Supervisory monitoring; setpoint write-back is out of demo scope', summaryAr: 'مراقبة إشرافية؛ الكتابة للقيم المرجعية خارج نطاق الديمو' },
  { code: 'EDGE_ANALYTICS', name: 'Edge Analytics', nameAr: 'تحليلات طرفية', layer: L1, group: 'Applications', groupAr: 'التطبيقات', status: 'ACTIVE', href: '/iot/signal-rules', summary: 'State inference, counter totalisation and debounce at the machine', summaryAr: 'استنتاج الحالة وتجميع العدّادات عند الآلة' },
  { code: 'FIREWALL', name: 'Industrial Firewall', nameAr: 'جدار ناري صناعي', layer: L1, group: 'Cybersecurity', groupAr: 'الأمن السيبراني', status: 'LOCKED', summary: 'OT-aware network segmentation', summaryAr: 'تجزئة شبكية واعية بالتقنيات التشغيلية' },
  { code: 'OT_SECURITY', name: 'OT Security Platform', nameAr: 'منصّة أمن التقنيات التشغيلية', layer: L1, group: 'Cybersecurity', groupAr: 'الأمن السيبراني', status: 'LOCKED', summary: 'Continuous threat detection across the OT estate', summaryAr: 'كشف مستمر للتهديدات في البيئة التشغيلية' },
  { code: 'IDS', name: 'IDS Platform', nameAr: 'منصّة كشف التسلل', layer: L1, group: 'Cybersecurity', groupAr: 'الأمن السيبراني', status: 'LOCKED', summary: 'Unauthorised access detection', summaryAr: 'كشف الوصول غير المصرّح به' },
  { code: 'IAM', name: 'IAM Control', nameAr: 'إدارة الهوية والوصول', layer: L1, group: 'Cybersecurity', groupAr: 'الأمن السيبراني', status: 'ACTIVE', href: '/users/access-control', summary: 'Role-based access, permission matrix, sessions and audit trail', summaryAr: 'صلاحيات حسب الدور ومصفوفة أذونات وجلسات وسجل تدقيق' },
  { code: 'API_MGMT', name: 'API Management', nameAr: 'إدارة الواجهات البرمجية', layer: L1, group: 'Integration', groupAr: 'التكامل', status: 'PARTIAL', summary: 'Documented REST surface with rate limiting; no external gateway', summaryAr: 'واجهات REST موثّقة مع تحديد المعدّل؛ بلا بوّابة خارجية' },
  { code: 'IPAAS', name: 'iPaaS Platform', nameAr: 'منصّة تكامل سحابية', layer: L1, group: 'Integration', groupAr: 'التكامل', status: 'LOCKED', summary: 'Links OT, IT and enterprise systems', summaryAr: 'ربط الأنظمة التشغيلية والمعلوماتية والمؤسسية' },
  { code: 'ETL', name: 'ETL Pipelines', nameAr: 'مسارات نقل البيانات', layer: L1, group: 'Integration', groupAr: 'التكامل', status: 'LOCKED', summary: 'Structured data movement between platforms', summaryAr: 'نقل منظّم للبيانات بين المنصّات' },
  { code: 'KAFKA', name: 'Kafka Streaming', nameAr: 'بثّ الأحداث', layer: L1, group: 'Integration', groupAr: 'التكامل', status: 'LOCKED', summary: 'Real-time event flows at enterprise scale', summaryAr: 'تدفّق أحداث لحظي على مستوى المؤسسة' },
  { code: 'TSDB', name: 'Time-Series DB', nameAr: 'قاعدة السلاسل الزمنية', layer: L1, group: 'Data Platforms', groupAr: 'منصّات البيانات', status: 'ACTIVE', href: '/iot/historian', summary: 'High-frequency tag history with compression and rollups', summaryAr: 'تاريخ عالي التردد للإشارات مع ضغط وتجميع' },
  { code: 'DATA_LAKE', name: 'Data Lake', nameAr: 'بحيرة البيانات', layer: L1, group: 'Data Platforms', groupAr: 'منصّات البيانات', status: 'LOCKED', summary: 'Scalable raw data storage', summaryAr: 'تخزين قابل للتوسّع للبيانات الخام' },
  { code: 'DWH', name: 'Data Warehouse', nameAr: 'مستودع البيانات', layer: L1, group: 'Data Platforms', groupAr: 'منصّات البيانات', status: 'LOCKED', summary: 'Structured store for business intelligence', summaryAr: 'مخزن منظّم لذكاء الأعمال' },

  // ── Layer 02 — MES (16) ──────────────────────────────────────────────────
  { code: 'PROD_SCHED', name: 'Production Scheduling', nameAr: 'جدولة الإنتاج', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/scheduling', summary: 'Digital line and shift scheduling with a Gantt view', summaryAr: 'جدولة رقمية للخطوط والورديات بمخطط جانت' },
  { code: 'DISPATCH', name: 'Dispatching & Execution', nameAr: 'الإصدار والتنفيذ', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/manufacturing/control', summary: 'Real-time work order release and shop-floor execution', summaryAr: 'إصدار أوامر العمل والتنفيذ اللحظي في الصالة' },
  { code: 'WO_MGMT', name: 'Work Order Management', nameAr: 'إدارة أوامر العمل', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/production/orders', summary: 'End-to-end digital work order lifecycle', summaryAr: 'دورة حياة رقمية كاملة لأمر العمل' },
  { code: 'WIP', name: 'WIP Tracking', nameAr: 'تتبّع العمل الجاري', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/live/production', summary: 'Visibility of work in progress across every stage', summaryAr: 'رؤية للعمل الجاري عبر كل المراحل' },
  { code: 'TRACE', name: 'Traceability & Genealogy', nameAr: 'التتبّع والنسب', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/traceability', summary: 'Raw material to finished good, by lot or by serial unit', summaryAr: 'من المادة الخام إلى المنتج النهائي، باللوط أو بالوحدة المسلسلة' },
  { code: 'QMS_CORE', name: 'Quality Management', nameAr: 'إدارة الجودة', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/quality', summary: 'Inline checks, SPC, non-conformance and defect capture', summaryAr: 'فحوص مباشرة وضبط إحصائي وعدم مطابقة ورصد العيوب' },
  { code: 'DOWNTIME', name: 'Downtime Management', nameAr: 'إدارة التوقّفات', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/downtime', summary: 'Automated capture with a three-level root cause tree', summaryAr: 'رصد آلي مع شجرة أسباب من ثلاثة مستويات' },
  { code: 'LABOR', name: 'Labor Management', nameAr: 'إدارة العمالة', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'LOCKED', summary: 'Attendance and productivity per operator', summaryAr: 'الحضور والإنتاجية لكل مشغّل' },
  { code: 'RECIPE', name: 'Recipe & Batch', nameAr: 'الوصفات والدفعات', layer: L2, group: 'MES Core', groupAr: 'جوهر التنفيذ', status: 'ACTIVE', href: '/production/recipes', summary: 'ISA-88 style recipes and batch records', summaryAr: 'وصفات وسجلات دفعات على نمط ISA-88' },
  { code: 'APS', name: 'APS Module', nameAr: 'الجدولة المتقدّمة', layer: L2, group: 'Smart Manufacturing', groupAr: 'التصنيع الذكي', status: 'ACTIVE', href: '/scheduling/production', summary: 'Constraint-based scheduling optimisation', summaryAr: 'تحسين الجدولة وفق القيود' },
  { code: 'OEE', name: 'OEE Monitoring', nameAr: 'مراقبة الكفاءة الكلية', layer: L2, group: 'Smart Manufacturing', groupAr: 'التصنيع الذكي', status: 'ACTIVE', href: '/oee-analysis', summary: 'Measured availability, performance and quality with loss breakdown', summaryAr: 'جاهزية وأداء وجودة مقيسة مع تفصيل الخسائر' },
  { code: 'RT_DASH', name: 'Real-Time Dashboards', nameAr: 'لوحات لحظية', layer: L2, group: 'Smart Manufacturing', groupAr: 'التصنيع الذكي', status: 'ACTIVE', href: '/command-center', summary: 'Live line and machine status across the estate', summaryAr: 'حالة الخطوط والآلات مباشرةً عبر المنشآت' },
  { code: 'EMS', name: 'EMS Platform', nameAr: 'منصّة إدارة الطاقة', layer: L2, group: 'Smart Manufacturing', groupAr: 'التصنيع الذكي', status: 'ACTIVE', href: '/energy', summary: 'Consumption tracking, baseline, cost allocation and power quality', summaryAr: 'تتبّع الاستهلاك وخط الأساس وتخصيص التكلفة وجودة القدرة' },
  { code: 'QMS_INT', name: 'QMS Integration', nameAr: 'تكامل نظام الجودة', layer: L2, group: 'Smart Manufacturing', groupAr: 'التصنيع الذكي', status: 'ACTIVE', href: '/quality/capa', summary: 'Audits, CAPA and compliance records', summaryAr: 'تدقيق وإجراءات تصحيحية وسجلات امتثال' },
  { code: 'CMMS', name: 'CMMS', nameAr: 'إدارة الصيانة', layer: L2, group: 'Smart Manufacturing', groupAr: 'التصنيع الذكي', status: 'ACTIVE', href: '/maintenance/work-orders', summary: 'Maintenance work orders and preventive schedules', summaryAr: 'أوامر الصيانة والجداول الوقائية' },
  { code: 'APM', name: 'APM System', nameAr: 'إدارة أداء الأصول', layer: L2, group: 'Smart Manufacturing', groupAr: 'التصنيع الذكي', status: 'ACTIVE', href: '/maintenance/reliability', summary: 'Asset health, MTBF and MTTR reliability analysis', summaryAr: 'صحة الأصول وتحليل الموثوقية' },

  // ── Layer 03 — Simulation & Optimization (10) ────────────────────────────
  { code: 'PRODUCT_TWIN', name: 'Product Twin', nameAr: 'التوأم الرقمي للمنتج', layer: L3, group: 'Digital Twin', groupAr: 'التوأم الرقمي', status: 'PARTIAL', href: '/plm', summary: 'Specification and lifecycle model per product', summaryAr: 'نموذج المواصفات ودورة الحياة لكل منتج' },
  { code: 'PROCESS_TWIN', name: 'Process Twin', nameAr: 'التوأم الرقمي للعملية', layer: L3, group: 'Digital Twin', groupAr: 'التوأم الرقمي', status: 'PARTIAL', href: '/twin', summary: 'Live mirror of process parameters per cell', summaryAr: 'مرآة حيّة لمعاملات العملية لكل خلية' },
  { code: 'FACTORY_TWIN', name: 'Factory Twin', nameAr: 'التوأم الرقمي للمصنع', layer: L3, group: 'Digital Twin', groupAr: 'التوأم الرقمي', status: 'ACTIVE', href: '/twin', summary: '2.5D plant floor with live data overlaid on every cell', summaryAr: 'أرضية مصنع ثنائية ونصف الأبعاد ببيانات حيّة على كل خلية' },
  { code: 'SIM_ENGINE', name: 'Simulation Engine', nameAr: 'محرّك المحاكاة', layer: L3, group: 'Digital Twin', groupAr: 'التوأم الرقمي', status: 'PARTIAL', summary: 'Deterministic signal engine drives the estate; discrete-event modelling is out of scope', summaryAr: 'محرّك إشارة حتمي يشغّل المنشآت؛ محاكاة الأحداث المنفصلة خارج النطاق' },
  { code: 'SYNC_ENGINE', name: 'Sync Engine', nameAr: 'محرّك المزامنة', layer: L3, group: 'Digital Twin', groupAr: 'التوأم الرقمي', status: 'PARTIAL', summary: 'Sub-second synchronisation between physical and virtual', summaryAr: 'مزامنة دون الثانية بين الواقعي والافتراضي' },
  { code: 'WHATIF', name: 'What-If Analysis', nameAr: 'تحليل السيناريوهات', layer: L3, group: 'Digital Twin', groupAr: 'التوأم الرقمي', status: 'PARTIAL', href: '/scenarios', summary: 'Scenario comparison against the running baseline', summaryAr: 'مقارنة السيناريوهات مقابل خط الأساس العامل' },
  { code: 'CAPACITY', name: 'Capacity Planning', nameAr: 'تخطيط الطاقة الإنتاجية', layer: L3, group: 'Optimization', groupAr: 'التحسين', status: 'ACTIVE', href: '/scheduling/production', summary: 'Capacity and headroom across shifts and lines', summaryAr: 'الطاقة والهامش المتاح عبر الورديات والخطوط' },
  { code: 'BOTTLENECK', name: 'Bottleneck Analysis', nameAr: 'تحليل الاختناقات', layer: L3, group: 'Optimization', groupAr: 'التحسين', status: 'ACTIVE', href: '/oee-breakdown', summary: 'Identifies the constraint that actually limits each line', summaryAr: 'تحديد القيد الذي يحدّ فعلاً كل خط' },
  { code: 'ENERGY_OPT', name: 'Energy Optimization', nameAr: 'تحسين الطاقة', layer: L3, group: 'Optimization', groupAr: 'التحسين', status: 'PARTIAL', href: '/energy/analytics', summary: 'Load balancing and consumption reduction analysis', summaryAr: 'موازنة الأحمال وتحليل خفض الاستهلاك' },
  { code: 'VIRTUAL_COMM', name: 'Virtual Commissioning', nameAr: 'التشغيل الافتراضي', layer: L3, group: 'Optimization', groupAr: 'التحسين', status: 'PARTIAL', href: '/iot/gateways', summary: 'The Virtual Plant serves real Modbus devices the gateway polls unmodified', summaryAr: 'المصنع الافتراضي يخدم أجهزة Modbus حقيقية تستطلعها البوّابة دون تعديل' },

  // ── Layer 04 — AI & Intelligence (13) ────────────────────────────────────
  { code: 'PDM', name: 'Predictive Maintenance', nameAr: 'الصيانة التنبّؤية', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'PARTIAL', href: '/maintenance/reliability', summary: 'Asset health projection to an intervention threshold', summaryAr: 'إسقاط صحة الأصل حتى عتبة التدخّل' },
  { code: 'VISION', name: 'Computer Vision', nameAr: 'الرؤية الحاسوبية', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'ACTIVE', href: '/vision', summary: 'Automated visual inspection with annotated rejects', summaryAr: 'فحص بصري آلي مع توثيق المرفوضات' },
  { code: 'DEMAND', name: 'Demand Forecasting', nameAr: 'التنبّؤ بالطلب', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'LOCKED', summary: 'AI-driven procurement and production planning', summaryAr: 'تخطيط الشراء والإنتاج بالذكاء الاصطناعي' },
  { code: 'AI_SCHED', name: 'AI Scheduling', nameAr: 'الجدولة الذكية', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'PARTIAL', href: '/scheduling/production', summary: 'Changeover minimisation within the APS solver', summaryAr: 'تقليل زمن التغيير ضمن محرّك الجدولة' },
  { code: 'PROC_OPT', name: 'Process Optimization', nameAr: 'تحسين العمليات', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'LOCKED', summary: 'Live parameter recommendations to the operator', summaryAr: 'توصيات لحظية بالمعاملات للمشغّل' },
  { code: 'ANOMALY', name: 'Anomaly Detection', nameAr: 'كشف الشذوذ', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'ACTIVE', href: '/ai', summary: 'Continuous scan across process, quality and energy signals', summaryAr: 'مسح مستمر لإشارات العملية والجودة والطاقة' },
  { code: 'ROBOTICS', name: 'Autonomous Robotics', nameAr: 'الروبوتات الذاتية', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'LOCKED', summary: 'AI-guided material handling', summaryAr: 'مناولة مواد موجّهة بالذكاء الاصطناعي' },
  { code: 'CHATBOT', name: 'AI Chatbots', nameAr: 'مساعد ذكي', layer: L4, group: 'Core AI', groupAr: 'تطبيقات الذكاء', status: 'LOCKED', summary: 'Operator troubleshooting assistant', summaryAr: 'مساعد استكشاف الأعطال للمشغّل' },
  { code: 'SMART_MON', name: 'Smart Monitoring', nameAr: 'المراقبة الذكية', layer: L4, group: 'AIoT & Analytics', groupAr: 'التحليلات', status: 'ACTIVE', href: '/notifications/rules', summary: 'Intelligent alert filtering and escalation rules', summaryAr: 'تصفية ذكية للتنبيهات وقواعد التصعيد' },
  { code: 'DECISION', name: 'Auto Decision Engine', nameAr: 'محرّك القرار الآلي', layer: L4, group: 'AIoT & Analytics', groupAr: 'التحليلات', status: 'PARTIAL', href: '/iot/signal-rules', summary: 'Rule execution on live signals; ML-driven actions are out of scope', summaryAr: 'تنفيذ القواعد على الإشارات الحيّة؛ الإجراءات المبنية على التعلّم خارج النطاق' },
  { code: 'STREAM_ANALYTICS', name: 'Streaming Analytics', nameAr: 'تحليلات التدفّق', layer: L4, group: 'AIoT & Analytics', groupAr: 'التحليلات', status: 'ACTIVE', href: '/iot/streams', summary: 'Inference on live data as it arrives', summaryAr: 'استدلال على البيانات لحظة وصولها' },
  { code: 'BIGDATA', name: 'Big Data & Models', nameAr: 'البيانات الضخمة والنماذج', layer: L4, group: 'AIoT & Analytics', groupAr: 'التحليلات', status: 'PARTIAL', href: '/energy/analytics', summary: 'Regression baselines and CUSUM tracking; no managed ML pipeline', summaryAr: 'خطوط أساس انحدارية وتتبّع تراكمي؛ بلا مسار تعلّم مُدار' },
  { code: 'KPI_COCKPIT', name: 'KPI Cockpits', nameAr: 'قمرات المؤشّرات', layer: L4, group: 'AIoT & Analytics', groupAr: 'التحليلات', status: 'ACTIVE', href: '/executive', summary: 'Executive cockpits with operational drill-down', summaryAr: 'قمرات تنفيذية مع تعمّق تشغيلي' },

  // ── DX — Digital Transformation (5) ──────────────────────────────────────
  { code: 'ERP', name: 'ERP Systems', nameAr: 'أنظمة تخطيط الموارد', layer: DX, group: 'Enterprise', groupAr: 'المؤسسة', status: 'PARTIAL', href: '/integration', summary: 'Bi-directional message queue; no live ERP connected in the demo', summaryAr: 'طابور رسائل ثنائي الاتجاه؛ بلا ربط فعلي في الديمو' },
  { code: 'CRM', name: 'CRM Integrations', nameAr: 'تكامل إدارة العملاء', layer: DX, group: 'Enterprise', groupAr: 'المؤسسة', status: 'LOCKED', summary: 'Customer order visibility and delivery performance', summaryAr: 'رؤية طلبات العملاء وأداء التسليم' },
  { code: 'DMS', name: 'DMS (Documents)', nameAr: 'إدارة الوثائق', layer: DX, group: 'Enterprise', groupAr: 'المؤسسة', status: 'PARTIAL', href: '/archive', summary: 'Document control for SOPs and compliance records', summaryAr: 'ضبط وثائق الإجراءات وسجلات الامتثال' },
  { code: 'BPM', name: 'BPM & Workflows', nameAr: 'إدارة العمليات', layer: DX, group: 'Enterprise', groupAr: 'المؤسسة', status: 'PARTIAL', href: '/plm/change-requests', summary: 'Approval workflows triggered by production events', summaryAr: 'مسارات اعتماد تُطلقها أحداث الإنتاج' },
  { code: 'BI', name: 'BI Ecosystem', nameAr: 'منظومة ذكاء الأعمال', layer: DX, group: 'Enterprise', groupAr: 'المؤسسة', status: 'ACTIVE', href: '/dashboard-center', summary: 'Executive dashboards and a self-service report builder', summaryAr: 'لوحات تنفيذية ومنشئ تقارير ذاتي' },

  // ── Emerging Technologies (5) ────────────────────────────────────────────
  { code: 'BLOCKCHAIN', name: 'Blockchain Tracking', nameAr: 'التتبّع بالبلوكتشين', layer: EM, group: 'Emerging', groupAr: 'الناشئة', status: 'LOCKED', summary: 'Immutable supply-chain verification records', summaryAr: 'سجلات تحقّق غير قابلة للتغيير لسلسلة التوريد' },
  { code: 'ARVR', name: 'AR/VR Maintenance', nameAr: 'صيانة بالواقع المعزّز', layer: EM, group: 'Emerging', groupAr: 'الناشئة', status: 'LOCKED', summary: 'Augmented overlays for equipment repair', summaryAr: 'طبقات معزّزة لإصلاح المعدّات' },
  { code: 'REMOTE_ASSIST', name: 'Remote Assist', nameAr: 'المساندة عن بُعد', layer: EM, group: 'Emerging', groupAr: 'الناشئة', status: 'LOCKED', summary: 'Expert-guided troubleshooting over live video', summaryAr: 'استكشاف أعطال بإرشاد خبير عبر بثّ حيّ' },
  { code: 'AUTONOMOUS', name: 'Autonomous Factory', nameAr: 'المصنع المستقل', layer: EM, group: 'Emerging', groupAr: 'الناشئة', status: 'LOCKED', summary: 'Self-regulating material flow and production lines', summaryAr: 'تدفّق مواد وخطوط إنتاج ذاتية التنظيم' },
  { code: 'GREEN', name: 'Green Manufacturing', nameAr: 'التصنيع الأخضر', layer: EM, group: 'Emerging', groupAr: 'الناشئة', status: 'ACTIVE', href: '/sustainability', summary: 'Carbon footprint tracking, intensity and ESG scorecard', summaryAr: 'تتبّع البصمة الكربونية والكثافة وبطاقة الاستدامة' },
];

export const LAYER_META: Record<EcosystemLayer, { order: number; name: string; nameAr: string; role: string; roleAr: string }> = {
  L1_CONNECTIVITY: { order: 1, name: 'Connectivity & Data Foundation', nameAr: 'الاتصال وأساس البيانات', role: 'Collect, connect, secure and transport industrial data', roleAr: 'جمع البيانات الصناعية وربطها وتأمينها ونقلها' },
  L2_MES: { order: 2, name: 'MES Layer', nameAr: 'طبقة التنفيذ التصنيعي', role: 'Execute, control and optimise manufacturing operations', roleAr: 'تنفيذ عمليات التصنيع والتحكم بها وتحسينها' },
  L3_SIMULATION: { order: 3, name: 'Simulation & Optimization', nameAr: 'المحاكاة والتحسين', role: 'Simulate and optimise processes before execution', roleAr: 'محاكاة العمليات وتحسينها قبل التنفيذ' },
  L4_AI: { order: 4, name: 'AI & Intelligence', nameAr: 'الذكاء الاصطناعي', role: 'Analyse, predict and automate decisions', roleAr: 'التحليل والتنبّؤ وأتمتة القرار' },
  DX: { order: 5, name: 'Digital Transformation', nameAr: 'التحوّل المؤسسي', role: 'Business management and decision-making layer', roleAr: 'طبقة إدارة الأعمال واتخاذ القرار' },
  EMERGING: { order: 6, name: 'Emerging Technologies', nameAr: 'التقنيات الناشئة', role: 'Future-proof innovation ready for deployment', roleAr: 'ابتكار جاهز للنشر ومستعد للمستقبل' },
};

export function moduleCoverage(): Record<EcosystemLayer, { total: number; score: number; pct: number }> {
  const out = {} as Record<EcosystemLayer, { total: number; score: number; pct: number }>;
  for (const layer of Object.keys(LAYER_META) as EcosystemLayer[]) {
    const mods = ECOSYSTEM_MODULES.filter((m) => m.layer === layer);
    const score = mods.reduce((s, m) => s + (m.status === 'ACTIVE' ? 1 : m.status === 'PARTIAL' ? 0.5 : 0), 0);
    out[layer] = { total: mods.length, score, pct: mods.length ? Math.round((score / mods.length) * 100) : 0 };
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  factory: string;
  severity: 'ERROR' | 'WARN';
  message: string;
}

/**
 * Check every cross-reference in the model before the seeder writes anything.
 *
 * The rules enforced here are the ones that would otherwise corrupt the
 * numbers rather than merely fail: a machine may carry at most one status tag
 * and one tag per counter role, because two status tags race to set the machine
 * state and two GOOD counters double the shift's output.
 */
export function validatePlantModel(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (f: string, message: string) => issues.push({ factory: f, severity: 'ERROR', message });
  const warn = (f: string, message: string) => issues.push({ factory: f, severity: 'WARN', message });

  const factoryCodes = new Set<string>();
  for (const f of FACTORIES) {
    if (factoryCodes.has(f.code)) err(f.code, `duplicate factory code ${f.code}`);
    factoryCodes.add(f.code);

    const areas = new Set(f.areas.map((a) => a.code));
    const lines = new Set(f.lines.map((l) => l.code));
    const machines = new Set(f.machines.map((m) => m.code));
    const meters = new Set(f.energyMeters.map((m) => m.code));
    const steps = new Set(f.routing.map((r) => r.code));
    const specs = new Set(f.qualitySpecs.map((q) => q.code));
    const causes = new Set(f.downtimeCauses.map((d) => d.code));
    const materials = new Set(f.materials.map((m) => m.code));
    const devices = new Set(f.devices.map((d) => d.code));

    if (f.areas.length !== areas.size) err(f.code, 'duplicate area code');
    if (f.lines.length !== lines.size) err(f.code, 'duplicate line code');
    if (f.machines.length !== machines.size) err(f.code, 'duplicate machine code');

    for (const l of f.lines) {
      if (!areas.has(l.areaCode)) err(f.code, `line ${l.code} references unknown area ${l.areaCode}`);
      if (l.oeeMethod === 'BOTTLENECK') {
        if (!l.bottleneckMachine) err(f.code, `line ${l.code} uses BOTTLENECK but names no bottleneck machine`);
        else if (!machines.has(l.bottleneckMachine)) err(f.code, `line ${l.code} bottleneck ${l.bottleneckMachine} is not a machine`);
      }
      for (const o of l.outfeedMachines ?? []) {
        if (!machines.has(o)) err(f.code, `line ${l.code} outfeed ${o} is not a machine`);
      }
    }

    for (const m of f.machines) {
      if (!areas.has(m.areaCode)) err(f.code, `machine ${m.code} references unknown area ${m.areaCode}`);
      if (m.lineCode && !lines.has(m.lineCode)) err(f.code, `machine ${m.code} references unknown line ${m.lineCode}`);
      // designCapacity and idealCycleSeconds must agree, or Performance is a fiction.
      if (m.designCapacity && m.idealCycleSeconds) {
        const implied = 3600 / m.idealCycleSeconds;
        const drift = Math.abs(implied - m.designCapacity) / m.designCapacity;
        if (drift > 0.02) {
          warn(f.code, `machine ${m.code}: designCapacity ${m.designCapacity}/h disagrees with idealCycleSeconds ${m.idealCycleSeconds}s (implies ${implied.toFixed(1)}/h)`);
        }
      }
    }

    for (const d of f.downtimeCauses) {
      if (d.parent && !causes.has(d.parent)) err(f.code, `downtime cause ${d.code} references unknown parent ${d.parent}`);
      if (d.level === 3 && !d.parent) err(f.code, `level-3 downtime cause ${d.code} has no parent`);
      if (d.level === 3 && !d.weight) warn(f.code, `level-3 downtime cause ${d.code} has no weight; the simulator will never pick it`);
    }

    for (const r of f.routing) {
      for (const mc of r.machines) if (!machines.has(mc)) err(f.code, `routing ${r.code} references unknown machine ${mc}`);
      for (const c of r.consumes ?? []) if (!materials.has(c)) err(f.code, `routing ${r.code} consumes unknown material ${c}`);
      for (const t of r.tests ?? []) if (!specs.has(t)) err(f.code, `routing ${r.code} references unknown quality spec ${t}`);
    }

    for (const q of f.qualitySpecs) {
      if (q.stepCode && !steps.has(q.stepCode)) err(f.code, `quality spec ${q.code} references unknown step ${q.stepCode}`);
      if (q.lsl !== undefined && q.usl !== undefined && q.lsl >= q.usl) err(f.code, `quality spec ${q.code} has lsl >= usl`);
    }

    for (const s of f.scrapCodes) {
      if (s.stepCode && !steps.has(s.stepCode)) err(f.code, `scrap code ${s.code} references unknown step ${s.stepCode}`);
    }

    // Tag bindings — the rules that protect the numbers.
    const statusPerOwner = new Map<string, number>();
    const counterPerOwner = new Map<string, number>();
    const tagCodes = new Set<string>();
    for (const d of f.devices) {
      if (d.areaCode && !areas.has(d.areaCode)) err(f.code, `device ${d.code} references unknown area ${d.areaCode}`);
      if (d.lineCode && !lines.has(d.lineCode)) err(f.code, `device ${d.code} references unknown line ${d.lineCode}`);
      for (const t of d.tags) {
        if (tagCodes.has(t.code)) err(f.code, `duplicate tag code ${t.code}`);
        tagCodes.add(t.code);
        const known = machines.has(t.ownerCode) || meters.has(t.ownerCode);
        if (!known) err(f.code, `tag ${t.code} is owned by unknown machine or meter ${t.ownerCode}`);
        if (t.role === 'STATUS') {
          const n = (statusPerOwner.get(t.ownerCode) ?? 0) + 1;
          statusPerOwner.set(t.ownerCode, n);
          if (n > 1) err(f.code, `machine ${t.ownerCode} carries ${n} status tags; two status tags race to set the machine state`);
        }
        if (t.role.startsWith('COUNTER_')) {
          const key = `${t.ownerCode}::${t.role}`;
          const n = (counterPerOwner.get(key) ?? 0) + 1;
          counterPerOwner.set(key, n);
          if (n > 1) err(f.code, `machine ${t.ownerCode} carries ${n} ${t.role} tags; duplicate counters double the shift's output`);
        }
      }
    }

    for (const g of f.gateways) {
      for (const dc of g.devices) if (!devices.has(dc)) err(f.code, `gateway ${g.code} references unknown device ${dc}`);
    }
    const claimed = new Set(f.gateways.flatMap((g) => g.devices));
    for (const d of f.devices) if (!claimed.has(d.code)) warn(f.code, `device ${d.code} is not polled by any gateway`);

    for (const m of f.energyMeters) {
      const scopes = [m.machineCode, m.lineCode, m.areaCode].filter(Boolean);
      if (scopes.length !== 1) err(f.code, `energy meter ${m.code} must scope exactly one of machine, line or area (has ${scopes.length})`);
      if (m.machineCode && !machines.has(m.machineCode)) err(f.code, `energy meter ${m.code} references unknown machine ${m.machineCode}`);
      if (m.lineCode && !lines.has(m.lineCode)) err(f.code, `energy meter ${m.code} references unknown line ${m.lineCode}`);
      if (m.areaCode && !areas.has(m.areaCode)) err(f.code, `energy meter ${m.code} references unknown area ${m.areaCode}`);
    }

    for (const a of f.alarmRules) {
      if (!tagCodes.has(a.tagCode)) err(f.code, `alarm rule ${a.code} references unknown tag ${a.tagCode}`);
    }

    // Every machine that should be counted needs a counter, or its OEE is empty.
    for (const m of f.machines) {
      if (!m.lineCode) continue;
      const hasTotal = [...counterPerOwner.keys()].includes(`${m.code}::COUNTER_TOTAL`);
      const hasStatus = statusPerOwner.has(m.code);
      if (!hasStatus) warn(f.code, `machine ${m.code} is on a line but has no status tag; it can never leave OFFLINE`);
      if (!hasTotal && m.designCapacity) warn(f.code, `machine ${m.code} has a design capacity but no TOTAL counter; its performance cannot be measured`);
    }

    // Ports must be unique across the whole estate — the Virtual Plant serves
    // them all from one process.
    for (const s of f.shifts) {
      if (s.plannedProductionHours > s.shiftDurationHours) {
        err(f.code, `shift ${s.code} plans ${s.plannedProductionHours}h of production in a ${s.shiftDurationHours}h shift`);
      }
    }
  }

  // Capability wiring. A capability with no route is a claim with nothing
  // behind it, and a factory whose story needs a module its class does not
  // grant would render an empty screen instead of failing loudly here.
  for (const f of FACTORIES) {
    const caps = capabilitiesOf(f);
    if (!caps.length) err(f.code, `type ${f.type} grants no capabilities`);
    for (const c of caps) {
      if (!CAPABILITY_ROUTES[c]) err(f.code, `capability ${c} has no route in CAPABILITY_ROUTES`);
    }
    // The paradigm and the classification have to tell the same story.
    const expected: Record<string, string> = {
      BATCH_LOT: 'PROCESS_FMCG',
      DISCRETE_SERIAL: 'DISCRETE_ASSEMBLY',
      CONTINUOUS_WEB: 'CONTINUOUS_PROCESS',
    };
    if (expected[f.paradigm] !== f.type) {
      warn(f.code, `paradigm ${f.paradigm} normally pairs with type ${expected[f.paradigm]}, not ${f.type}`);
    }
    // A site that declares serial genealogy must actually have routing stages
    // to trace a unit through, or the screen has nothing to show.
    if (caps.includes('SERIAL_GENEALOGY') && f.routing.length < 2) {
      err(f.code, 'declares SERIAL_GENEALOGY but has fewer than two routing steps');
    }
    // Power quality needs meters carrying the electrical tags it reads.
    if (caps.includes('POWER_QUALITY') || caps.includes('HARMONICS')) {
      const hasPq = f.devices.some((d) => d.tags.some((t) => /THD|\.PF$/.test(t.code)));
      if (!hasPq) err(f.code, `declares power-quality capability but no meter exposes THD or PF tags`);
    }
    // The twin draws the plant as it is laid out, so a missing or overlapping
    // footprint is survey data being wrong — which shows up as a cell sitting on
    // top of another, at which point nobody trusts the rest of the screen.
    if (caps.includes('DIGITAL_TWIN')) {
      const placed = f.machines.filter((m) => m.grid);
      if (!placed.length) err(f.code, 'declares DIGITAL_TWIN but no machine has a floor-plan footprint');
      for (const m of f.machines) {
        if (!m.grid) { warn(f.code, `machine ${m.code} has no footprint and will not appear on the twin`); continue; }
        const { x, y, w, h } = m.grid;
        if (w <= 0 || h <= 0) err(f.code, `machine ${m.code} has a footprint with no area`);
        if (x < 0 || y < 0) err(f.code, `machine ${m.code} sits outside the floor plan`);
      }
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i].grid!, b = placed[j].grid!;
          const overlaps =
            a.x < b.x + b.w && b.x < a.x + a.w &&
            a.y < b.y + b.h && b.y < a.y + a.h;
          if (overlaps) err(f.code, `machines ${placed[i].code} and ${placed[j].code} occupy the same floor space`);
        }
      }
    }

    if (caps.includes('VISION_INSPECTION') && !f.machines.some((m) => m.type === 'SENSOR')) {
      warn(f.code, 'declares VISION_INSPECTION but no machine is modelled as the inspection station');
    }
  }

  const ports = new Map<number, string>();
  for (const f of FACTORIES) {
    for (const d of f.devices) {
      if (d.port === undefined) continue;
      const taken = ports.get(d.port);
      if (taken) err(f.code, `device ${d.code} wants TCP port ${d.port}, already used by ${taken}`);
      ports.set(d.port, `${f.code}/${d.code}`);
    }
  }

  return issues;
}

/** Summary counts, printed by the seeder so the estate is legible at a glance. */
export function plantSummary() {
  return FACTORIES.map((f) => ({
    code: f.code,
    name: f.name,
    paradigm: f.paradigm,
    areas: f.areas.length,
    lines: f.lines.length,
    machines: f.machines.length,
    products: f.products.length,
    materials: f.materials.length,
    routingSteps: f.routing.length,
    qualitySpecs: f.qualitySpecs.length,
    devices: f.devices.length,
    tags: f.devices.reduce((n, d) => n + d.tags.length, 0),
    meters: f.energyMeters.length,
    alarmRules: f.alarmRules.length,
    downtimeCauses: f.downtimeCauses.filter((d) => d.level === 3).length,
    type: f.type,
    capabilities: capabilitiesOf(f).length,
  }));
}
