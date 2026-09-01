/**
 * The Application Suite module catalogue.
 *
 * The 64 modules the suite names, across four layers plus enterprise
 * transformation and emerging technologies, each with this platform's honest
 * build status.
 *
 * This lives in `src/`, not in `prisma/plant/`, and the distinction is not
 * filing: the plant model describes the *plant*, this describes the *product*.
 * It is also load-bearing for the build — the Nest build compiles `src/`, and a
 * single import reaching outside it moves the output to `dist/src/main.js` and
 * breaks the container's entrypoint.
 *
 * `prisma/plant/check-model.ts` imports this for its coverage report. That
 * script runs under tsx and is never compiled, so it may reach in here freely.
 */

/** Ecosystem layer a capability belongs to, per the Application Suite. */
export type EcosystemLayer =
  | 'L1_CONNECTIVITY' | 'L2_MES' | 'L3_SIMULATION' | 'L4_AI' | 'DX' | 'EMERGING';

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
