// ============================================================
// DASHBOARD EXPLAINERS — bilingual (EN/AR) help content shown by the
// <DashboardInfo id="…" /> info icon on each dashboard/analytics page.
//
// Each entry documents: what the page shows, how every metric is calculated,
// where the data comes from (API + source of truth), the world-class benchmark
// for each metric, and how to act on it. Keep formulas consistent with the
// backend engines (see docs/DASHBOARD-AUDIT.md and docs/DESIGN-oee-kpi-engine.md).
// ============================================================

export type Bi = { en: string; ar: string };

export interface ExplainerMetric {
  name: Bi;
  formula?: string;      // shown verbatim (language-neutral)
  desc: Bi;
  benchmark?: Bi;        // world-class target / how to read it
}

export interface Explainer {
  title: Bi;
  summary: Bi;
  metrics?: ExplainerMetric[];
  dataSources?: Bi[];
  howToUse?: Bi[];
  notes?: Bi[];
}

/**
 * Line OEE can be produced by two different bases. Every page that shows a
 * line-level figure includes this, so the same explanation travels with the
 * number wherever it appears instead of living in one card.
 */
export const LINE_OEE_BASIS: ExplainerMetric = {
  name: { en: 'Line OEE basis — Roll-up vs Bottleneck', ar: 'أساس OEE للخط — التجميع مقابل عنق الزجاجة' },
  formula: 'ROLLUP: A × P × Q from summed minutes/counts  ·  BOTTLENECK: bottleneck A × bottleneck P × final-outfeed Q',
  desc: {
    en: 'Each production line is measured on the basis configured for it in Plant Hierarchy → Edit Production Line, and the basis is labelled next to every line figure. ROLLUP sums the planned, run and earned minutes plus the counts of every machine and re-derives A, P and Q — it is not an average of percentages, and it answers "how did the assets perform". BOTTLENECK takes A and P from the constraint machine and Q from the final outfeed point(s) — it answers "how did the LINE perform", which is the fairer question for a synchronised line where downstream assets idle by design whenever the constraint stops. A line set to BOTTLENECK with no constraint resolvable falls back to ROLLUP and is marked with an asterisk.',
    ar: 'كل خط يُقاس بالأساس المُعدّ له من هيكل المصنع ← تعديل خط الإنتاج، والأساس مكتوب بجوار كل رقم خط. التجميع يجمع الدقائق المخططة والتشغيلية والمكتسبة وأعداد كل الماكينات ثم يعيد اشتقاق A وP وQ — وليس متوسط نسب — ويجيب: كيف كان أداء الأصول. وعنق الزجاجة يأخذ A وP من ماكينة القيد وQ من نقاط الإخراج النهائية — ويجيب: كيف كان أداء الخط، وهو السؤال الأعدل لخط متزامن تتوقف فيه الماكينات التالية بحكم التصميم كلما توقف القيد. والخط المضبوط على عنق الزجاجة دون قيد يمكن تحديده يرجع للتجميع ويُوسَم بنجمة.',
  },
};

const OEE_METRICS: ExplainerMetric[] = [
  {
    name: { en: 'OEE — Overall Equipment Effectiveness', ar: 'OEE — الفعالية الكلية للمعدّات' },
    formula: 'OEE = Availability × Performance × Quality',
    desc: {
      en: 'The single headline number for how effectively equipment runs. It multiplies the three loss buckets so a weakness in any one pulls OEE down.',
      ar: 'الرقم الرئيسي الذي يعبّر عن كفاءة تشغيل المعدّة. يضرب العوامل الثلاثة معًا، فأي ضعف في أحدها يخفض OEE.',
    },
    benchmark: { en: 'World-class ≥ 85%. 60% is typical, < 40% needs urgent action.', ar: 'عالمي ≥ 85%. المعتاد 60%، وأقل من 40% يستدعي تدخلاً عاجلاً.' },
  },
  {
    name: { en: 'Availability', ar: 'الجاهزية' },
    formula: 'Availability = Run Time ÷ Planned Production Time',
    desc: {
      en: 'Share of planned time the equipment was actually running. Lost to breakdowns, setups and unplanned stops.',
      ar: 'نسبة الوقت المخطط الذي كانت فيه المعدّة تعمل فعليًا. تُفقد بسبب الأعطال والتجهيز والتوقفات غير المخططة.',
    },
    benchmark: { en: 'World-class ≥ 90%.', ar: 'عالمي ≥ 90%.' },
  },
  {
    name: { en: 'Performance', ar: 'الأداء' },
    formula: 'Performance = (Ideal Cycle Time × Total Count) ÷ Run Time',
    desc: {
      en: 'How close the line ran to its ideal speed while running. Lost to minor stops and reduced speed.',
      ar: 'مدى اقتراب الخط من سرعته المثالية أثناء التشغيل. يُفقد بسبب التوقفات الصغيرة وانخفاض السرعة.',
    },
    benchmark: { en: 'World-class ≥ 95%.', ar: 'عالمي ≥ 95%.' },
  },
  {
    name: { en: 'Quality', ar: 'الجودة' },
    formula: 'Quality = Acceptance Count ÷ Total Count',
    desc: {
      en: 'Share of produced units that met spec the first time. Lost to scrap and rework.',
      ar: 'نسبة الوحدات المنتجة التي طابقت المواصفات من المرة الأولى. تُفقد بسبب الهدر وإعادة العمل.',
    },
    benchmark: { en: 'World-class ≥ 99%.', ar: 'عالمي ≥ 99%.' },
  },
];

export const EXPLAINERS: Record<string, Explainer> = {
  // ── Insights Studio (grouped analytics) ──────────────────────
  'insights-studio': {
    title: { en: 'Insights Studio', ar: 'استوديو التحليلات' },
    summary: {
      en: 'A single analytical canvas: pick a grouping dimension (Shift / Production Order / Work Order / Machine / Time) and every chart re-aggregates OEE, output, scrap and the A·P·Q breakdown for the selected period and scope.',
      ar: 'لوحة تحليلية موحّدة: اختر بُعد التجميع (وردية/أمر إنتاج/أمر عمل/آلة/زمن) فتُعيد كل الرسوم تجميع OEE والإنتاج والهدر وتفصيل A·P·Q للفترة والنطاق المختارين.',
    },
    metrics: [
      { name: { en: 'OEE by group', ar: 'OEE حسب المجموعة' }, formula: 'time-weighted rollup per group', desc: { en: 'Compare effectiveness across shifts/orders/machines to find the best and worst performers.', ar: 'قارن الفعالية بين الورديات/الأوامر/الآلات لإيجاد الأفضل والأسوأ.' }, benchmark: { en: 'World-class ≥ 85%.', ar: 'عالمي ≥ 85%.' } },
      { name: { en: 'Output (good vs scrap)', ar: 'الإنتاج (سليم مقابل هدر)' }, desc: { en: 'Produced quantity split into good and scrap per group — shows where quality losses concentrate.', ar: 'الكمية المنتَجة مقسّمة سليم/هدر لكل مجموعة — تُظهر أين تتركّز خسائر الجودة.' } },
      { name: { en: 'A·P·Q by group', ar: 'A·P·Q حسب المجموعة' }, desc: { en: 'The three OEE factors side by side per group — pinpoints whether availability, speed or quality is the constraint.', ar: 'عوامل OEE الثلاثة جنبًا إلى جنب لكل مجموعة — تحدّد ما إذا كان القيد في الجاهزية أو السرعة أو الجودة.' } },
    ],
    dataSources: [
      { en: 'GET /production/oee/calculate (period KPIs) + GET /production/oee/trend?groupBy=… (grouped rollups) — same time-weighted engine as every OEE page.', ar: 'GET /production/oee/calculate (مؤشرات الفترة) + GET /production/oee/trend?groupBy=… (تجميعات) — نفس المحرك المرجّح بالزمن لكل صفحات OEE.' },
    ],
    howToUse: [
      { en: 'Group by Shift to compare crews; by Work Order to audit a run; by Machine to rank equipment; by Time to see the trend.', ar: 'جمّع حسب الوردية لمقارنة الفرق؛ حسب أمر العمل لتدقيق تشغيلة؛ حسب الآلة لترتيب المعدّات؛ حسب الزمن لرؤية الاتجاه.' },
    ],
    notes: [
      { en: 'Everything here is PERIOD data (the badge marks it) — it responds to the time range and scope, unlike live machine-state cards elsewhere.', ar: 'كل ما هنا بيانات فترة (تُعلّمها الشارة) — تستجيب للفترة والنطاق، بخلاف بطاقات حالة الآلة اللحظية في صفحات أخرى.' },
    ],
  },
  // ── Production ───────────────────────────────────────────────
  'production-overview': {
    title: { en: 'Production Overview', ar: 'نظرة عامة على الإنتاج' },
    summary: {
      en: 'Live operational picture of the factory: real-time OEE and its three factors, plus the active work-order list with progress and status.',
      ar: 'صورة تشغيلية حيّة للمصنع: OEE اللحظي وعوامله الثلاثة، مع قائمة أوامر العمل النشطة وتقدّمها وحالتها.',
    },
    metrics: [
      ...OEE_METRICS,
      {
        name: { en: 'Work-order counts (Total / Completed / In Progress)', ar: 'أعداد أوامر العمل (الكل / المكتمل / الجاري)' },
        desc: { en: 'Status tally of work orders in the current scope. Drives the completion ratio.', ar: 'حصر حالات أوامر العمل ضمن النطاق الحالي. يحدد نسبة الإنجاز.' },
        benchmark: { en: 'Watch In-Progress vs capacity — a large backlog signals a bottleneck.', ar: 'راقب الجاري مقابل الطاقة — تراكم كبير يعني وجود اختناق.' },
      },
    ],
    dataSources: [
      { en: 'GET /production/kpis — OEE + order counts (engine rolls Job Order → Work Order → Production Order).', ar: 'GET /production/kpis — OEE وأعداد الأوامر (المحرك يجمّع من أمر التشغيل ← أمر العمل ← أمر الإنتاج).' },
      { en: 'GET /production/work-orders — the active work-order list (scoped, not date-windowed).', ar: 'GET /production/work-orders — قائمة أوامر العمل النشطة (حسب النطاق، دون نافذة زمنية).' },
    ],
    howToUse: [
      { en: 'If OEE is low, read which factor (A/P/Q) is lowest and act there first.', ar: 'إذا كان OEE منخفضًا، حدّد أي عامل (A/P/Q) هو الأدنى وعالجه أولاً.' },
      { en: 'Use the area/line/machine scope to localise a problem to one resource.', ar: 'استخدم نطاق المنطقة/الخط/الآلة لعزل المشكلة في مورد واحد.' },
    ],
    notes: [
      { en: 'OEE here matches the OEE page and the home dashboard — all read the same engine, so numbers are consistent across screens.', ar: 'قيمة OEE هنا تطابق صفحة OEE ولوحة البداية — جميعها تقرأ من نفس المحرك، فالأرقام متسقة عبر الشاشات.' },
    ],
  },

  'production-oee': {
    title: { en: 'OEE Analysis', ar: 'تحليل OEE' },
    summary: {
      en: 'Deep-dive into Overall Equipment Effectiveness: the A×P×Q breakdown, trend over time, and per-equipment ranking to find the biggest loss.',
      ar: 'تحليل معمّق للفعالية الكلية للمعدّات: تفصيل A×P×Q، والاتجاه عبر الزمن، وترتيب المعدّات لاكتشاف أكبر مصدر فقد.',
    },
    metrics: [...OEE_METRICS, LINE_OEE_BASIS],
    dataSources: [
      { en: 'GET /production/oee/calculate — current OEE, trend, and per-equipment breakdown for the selected timeframe.', ar: 'GET /production/oee/calculate — OEE الحالي والاتجاه وتفصيل كل معدّة للفترة المختارة.' },
      { en: 'Source of truth: OEERecord rows persisted at each job-order completion; the engine rolls them up the ISA-95 hierarchy.', ar: 'مصدر الحقيقة: سجلات OEERecord المحفوظة عند اكتمال كل أمر تشغيل؛ والمحرك يجمّعها عبر هرم ISA-95.' },
    ],
    howToUse: [
      { en: 'Rank equipment by OEE and attack the bottom of the list — that is where the gain is largest.', ar: 'رتّب المعدّات حسب OEE وعالج أسفل القائمة — هناك أكبر مكسب ممكن.' },
      { en: 'Compare the trend to a shift/process change to confirm whether an action worked.', ar: 'قارن الاتجاه بتغيير ورديّة/عملية للتأكد من نجاح أي إجراء.' },
    ],
  },

  'production-kpi': {
    title: { en: 'Production KPIs', ar: 'مؤشرات الإنتاج' },
    summary: {
      en: 'Key production indicators: OEE factors, throughput, schedule adherence and scrap — to judge plan vs actual at a glance.',
      ar: 'المؤشرات الرئيسية للإنتاج: عوامل OEE، الإنتاجية، الالتزام بالجدول، والهدر — لتقييم المخطط مقابل الفعلي بنظرة واحدة.',
    },
    metrics: [
      ...OEE_METRICS,
      {
        name: { en: 'Schedule adherence', ar: 'الالتزام بالجدول' },
        formula: 'Adherence = On-time Work Orders ÷ Total Due Work Orders',
        desc: { en: 'Share of work orders finished within their planned window.', ar: 'نسبة أوامر العمل المنجزة ضمن نافذتها المخططة.' },
        benchmark: { en: 'Target ≥ 95%.', ar: 'الهدف ≥ 95%.' },
      },
      {
        name: { en: 'Scrap rate', ar: 'نسبة الهدر' },
        formula: 'Scrap Rate = Scrap Qty ÷ Total Produced',
        desc: { en: 'Material lost to rejects across the run.', ar: 'المواد المفقودة كرفض خلال التشغيل.' },
        benchmark: { en: 'Lower is better; track against a per-product target.', ar: 'الأقل أفضل؛ قِسها مقابل هدف لكل منتج.' },
      },
    ],
    dataSources: [
      { en: 'GET /production/kpis and /production/oee/calculate — same engine as the overview, so values reconcile.', ar: 'GET /production/kpis و /production/oee/calculate — نفس محرك النظرة العامة، فالقيم متطابقة.' },
    ],
  },

  'production-downtime': {
    title: { en: 'Downtime Analysis', ar: 'تحليل التوقفات' },
    summary: {
      en: 'Where production time is lost. A Pareto of downtime by cause shows the vital few causes that drive most lost minutes.',
      ar: 'أين يُفقد وقت الإنتاج. مخطط باريتو للتوقفات حسب السبب يُظهر الأسباب القليلة الحيوية التي تسبب معظم الدقائق المفقودة.',
    },
    metrics: [
      {
        name: { en: 'Downtime by cause (Pareto)', ar: 'التوقف حسب السبب (باريتو)' },
        formula: 'Σ downtime minutes per cause, ranked desc + cumulative %',
        desc: { en: 'Total stopped minutes grouped by reason, ranked so the top bars are the priority.', ar: 'إجمالي دقائق التوقف مجمّعة حسب السبب ومرتّبة، فالأعمدة الأولى هي الأولوية.' },
        benchmark: { en: 'The top 20% of causes usually drive ~80% of downtime — fix those first.', ar: 'عادةً 20% من الأسباب تسبب ~80% من التوقف — عالجها أولاً.' },
      },
      {
        name: { en: 'MTTR (Mean Time To Repair) — equipment lens', ar: 'متوسط زمن الإصلاح — منظور المعدات' },
        formula: 'MTTR = Σ breakdown stop hours ÷ breakdown stop count',
        desc: { en: 'Average production time lost per equipment breakdown. Counts breakdown, mechanical, electrical and utility stops only — micro-stops, starved/blocked, material, operator and quality stops are excluded.', ar: 'متوسط زمن الإنتاج المفقود لكل عطل. يشمل توقفات الأعطال والتوقفات الميكانيكية والكهربائية وتوقفات المرافق فقط — وتُستبعد التوقفات القصيرة ونقص التغذية والانسداد وتوقفات المواد والمشغل والجودة.' },
        benchmark: { en: 'Lower is better; trend it downward over time.', ar: 'الأقل أفضل؛ اجعل اتجاهه نحو الانخفاض.' },
      },
      {
        name: { en: 'MTBF (Mean Time Between Failures) — equipment lens', ar: 'متوسط الزمن بين الأعطال — منظور المعدات' },
        formula: 'MTBF = (Capacity Hours − All Downtime Hours) ÷ breakdown stop count',
        desc: { en: 'Average running time between breakdowns. Capacity hours = window hours × active machines in scope.', ar: 'متوسط زمن التشغيل بين الأعطال. ساعات الطاقة = ساعات الفترة × عدد المكائن الفعالة في النطاق.' },
        benchmark: { en: 'Higher is better; trend upward.', ar: 'الأعلى أفضل؛ اجعل اتجاهه صاعدًا.' },
      },
    ],
    dataSources: [
      { en: 'GET /production/downtime — downtime events (cause, duration, machine) within the scope + time range.', ar: 'GET /production/downtime — أحداث التوقف (السبب، المدة، الآلة) ضمن النطاق والفترة.' },
    ],
    howToUse: [
      { en: 'Start a Kaizen on the #1 Pareto cause; re-check the chart after the fix to confirm it dropped.', ar: 'ابدأ تحسينًا (كايزن) على السبب الأول في باريتو؛ وأعد فحص المخطط بعد المعالجة للتأكد من انخفاضه.' },
    ],
    notes: [
      { en: 'This is the equipment lens (machine stops). The Maintenance Reports headline the maintenance lens (corrective/emergency work orders) — both are computed by one engine over the same window, and the Maintenance Reports page shows them side by side with the variance.', ar: 'هذا منظور المعدات (توقفات المكائن). أما تقارير الصيانة فتعرض منظور الصيانة (أوامر العمل التصحيحية والطارئة) — ويُحتسب المنظوران بمحرك واحد وعلى الفترة نفسها، وتعرضهما صفحة تقارير الصيانة جنباً إلى جنب مع الفرق بينهما.' },
    ],
  },

  // ── Maintenance ──────────────────────────────────────────────
  'maintenance-overview': {
    title: { en: 'Maintenance Overview', ar: 'نظرة عامة على الصيانة' },
    summary: {
      en: 'Reliability and workload health: open/overdue work orders, reliability (MTTR/MTBF), asset availability and PM compliance.',
      ar: 'صحة الموثوقية وحمل العمل: الأوامر المفتوحة/المتأخرة، الموثوقية (MTTR/MTBF)، جاهزية الأصول، والالتزام بالصيانة الوقائية.',
    },
    metrics: [
      {
        name: { en: 'MTBF (Mean Time Between Failures) — maintenance lens', ar: 'متوسط الزمن بين الأعطال — منظور الصيانة' },
        formula: 'MTBF = Operating Hours ÷ corrective + emergency WOs raised in window',
        desc: { en: 'Average uptime between breakdowns — the core reliability measure. Operating hours are the summed RUNNING machine-state hours, falling back to active machines × window hours when no state history exists.', ar: 'متوسط زمن التشغيل بين الأعطال — مقياس الموثوقية الأساسي. وساعات التشغيل هي مجموع ساعات حالة التشغيل الفعلية، وتُستبدل بعدد المكائن × ساعات الفترة عند غياب سجل الحالات.' },
        benchmark: { en: 'Higher is better; trend upward.', ar: 'الأعلى أفضل؛ اجعل اتجاهه صاعدًا.' },
      },
      {
        name: { en: 'MTTR (Mean Time To Repair) — maintenance lens', ar: 'متوسط زمن الإصلاح — منظور الصيانة' },
        formula: 'MTTR = Σ repair hours ÷ corrective + emergency WOs completed in window',
        desc: { en: 'Average technician time to restore a failed asset. Repair hours use the WO actual hours, falling back to started → completed elapsed time. Preventive, inspection and lubrication WOs are excluded.', ar: 'متوسط زمن الفني لإعادة الأصل للعمل. تُستخدم الساعات الفعلية لأمر العمل، أو الفارق بين البدء والإكمال عند غيابها. وتُستبعد أوامر الصيانة الوقائية والفحص والتزييت.' },
        benchmark: { en: 'Lower is better.', ar: 'الأقل أفضل.' },
      },
      {
        name: { en: 'Asset Availability', ar: 'جاهزية الأصل' },
        formula: 'Availability = MTBF ÷ (MTBF + MTTR)',
        desc: { en: 'Share of time an asset is ready to run — combines how often it fails and how fast it is fixed.', ar: 'نسبة جاهزية الأصل للعمل — تجمع تكرار العطل وسرعة الإصلاح.' },
        benchmark: { en: 'World-class ≥ 90%.', ar: 'عالمي ≥ 90%.' },
      },
      {
        name: { en: 'PM Compliance', ar: 'الالتزام بالصيانة الوقائية' },
        formula: 'PM Compliance = PMs Completed On-time ÷ PMs Scheduled',
        desc: { en: 'Discipline of preventive maintenance. Low compliance precedes more breakdowns.', ar: 'انضباط الصيانة الوقائية. الالتزام المنخفض يسبق زيادة الأعطال.' },
        benchmark: { en: 'Target ≥ 90%.', ar: 'الهدف ≥ 90%.' },
      },
      {
        name: { en: 'Open / Overdue Work Orders', ar: 'الأوامر المفتوحة / المتأخرة' },
        desc: { en: 'Current maintenance backlog and how much of it is past its due date.', ar: 'تراكم الصيانة الحالي وكم منه تجاوز تاريخ الاستحقاق.' },
        benchmark: { en: 'Overdue should trend to zero; a rising backlog signals under-capacity.', ar: 'المتأخر يجب أن يتجه للصفر؛ تراكم متزايد يعني نقص طاقة.' },
      },
    ],
    dataSources: [
      { en: 'GET /maintenance/kpis — MTTR, MTBF, availability, PM compliance, open/overdue counts.', ar: 'GET /maintenance/kpis — MTTR وMTBF والجاهزية والالتزام والأعداد المفتوحة/المتأخرة.' },
      { en: 'GET /maintenance/work-orders — the maintenance WO list.', ar: 'GET /maintenance/work-orders — قائمة أوامر الصيانة.' },
      { en: 'Reliability is computed from completed maintenance WOs and downtime events for the scoped assets.', ar: 'تُحسب الموثوقية من أوامر الصيانة المكتملة وأحداث التوقف للأصول ضمن النطاق.' },
    ],
    howToUse: [
      { en: 'Falling MTBF + rising MTTR = a deteriorating asset; schedule a deeper PM or overhaul.', ar: 'انخفاض MTBF مع ارتفاع MTTR = أصل يتدهور؛ جدوِل صيانة وقائية أعمق أو عُمرة.' },
    ],
    notes: [
      { en: 'MTTR/MTBF here use the same definitions as the reliability trend chart and the Analytics → Maintenance Reports page, so all three are reconcilable.', ar: 'تستخدم MTTR/MTBF هنا نفس تعريفات مخطط اتجاه الموثوقية وصفحة التحليلات ← تقارير الصيانة، فالثلاثة متطابقة.' },
      { en: 'These cards use a month-to-date window by design; the Maintenance Reports page uses the period you select there, so pick the same period to compare like for like.', ar: 'تستخدم هذه البطاقات فترة من بداية الشهر حتى اليوم؛ أما صفحة تقارير الصيانة فتستخدم الفترة التي تختارها فيها، لذا اختر الفترة نفسها للمقارنة العادلة.' },
      { en: 'The Downtime Command Center shows the equipment lens (machine stops) rather than the maintenance lens (work orders) — the Maintenance Reports page shows both side by side with the variance.', ar: 'يعرض مركز قيادة التوقفات منظور المعدات (توقفات المكائن) لا منظور الصيانة (أوامر العمل) — وتعرض صفحة تقارير الصيانة المنظورين جنباً إلى جنب مع الفرق بينهما.' },
    ],
  },

  // ── Quality ──────────────────────────────────────────────────
  'quality-overview': {
    title: { en: 'Quality Overview', ar: 'نظرة عامة على الجودة' },
    summary: {
      en: 'Conformance health: First Pass Yield, defect/scrap rate, open NCRs and CAPA progress — the voice of quality on the floor.',
      ar: 'صحة المطابقة: نسبة النجاح من المرة الأولى، معدل العيوب/الهدر، حالات عدم المطابقة المفتوحة، وتقدّم الإجراءات التصحيحية.',
    },
    metrics: [
      {
        name: { en: 'First Pass Yield (FPY)', ar: 'نسبة النجاح من المرة الأولى' },
        formula: 'FPY = Units Passing First Time ÷ Total Units Inspected',
        desc: { en: 'Share of output that passed inspection without rework — the cleanest quality signal.', ar: 'نسبة الإنتاج الذي اجتاز الفحص دون إعادة عمل — أنقى إشارة جودة.' },
        benchmark: { en: 'World-class ≥ 99%; below 95% means significant rework cost.', ar: 'عالمي ≥ 99%؛ أقل من 95% يعني تكلفة إعادة عمل كبيرة.' },
      },
      {
        name: { en: 'Defect / Scrap Rate', ar: 'معدل العيوب / الهدر' },
        formula: 'Defect Rate = Failed Qty ÷ Total Inspected',
        desc: { en: 'Proportion of inspected units rejected. The inverse pressure on FPY.', ar: 'نسبة الوحدات المرفوضة من المفحوصة. الضغط العكسي على FPY.' },
        benchmark: { en: 'Lower is better; track in PPM for mature lines.', ar: 'الأقل أفضل؛ تُقاس بالـ PPM للخطوط الناضجة.' },
      },
      {
        name: { en: 'Open NCRs', ar: 'حالات عدم المطابقة المفتوحة' },
        desc: { en: 'Non-conformance reports not yet resolved — unresolved quality risk.', ar: 'تقارير عدم المطابقة غير المغلقة — مخاطر جودة غير محلولة.' },
        benchmark: { en: 'Drive to closure; ageing NCRs are the risk, not the count alone.', ar: 'ادفعها للإغلاق؛ الخطر في تقادمها لا في عددها وحده.' },
      },
      {
        name: { en: 'CAPA Progress', ar: 'تقدّم الإجراءات التصحيحية' },
        desc: { en: 'Corrective/Preventive actions and their completion — closes the loop on root causes.', ar: 'الإجراءات التصحيحية/الوقائية ونسبة إنجازها — تغلق الحلقة على الأسباب الجذرية.' },
        benchmark: { en: 'On-time CAPA closure ≥ 90%.', ar: 'إغلاق الإجراءات في موعدها ≥ 90%.' },
      },
    ],
    dataSources: [
      { en: 'GET /quality/kpis — FPY, defect rate, NCR/CAPA counts.', ar: 'GET /quality/kpis — FPY ومعدل العيوب وأعداد NCR/CAPA.' },
      { en: 'Computed from InspectionResult (pass/fail), NCR and CAPA records for the scope.', ar: 'تُحسب من نتائج الفحص (نجاح/فشل) وسجلات NCR وCAPA ضمن النطاق.' },
    ],
    howToUse: [
      { en: 'A drop in FPY plus a spike on one defect type points to a specific process/parameter to correct.', ar: 'انخفاض FPY مع ارتفاع نوع عيب واحد يشير إلى عملية/معيار محدد لتصحيحه.' },
    ],
    notes: [
      { en: 'Quality% in OEE and FPY measure related but different things: OEE-Quality counts good vs total produced; FPY counts first-time-pass at inspection.', ar: 'الجودة في OEE وFPY يقيسان أمرين مترابطين لكن مختلفين: جودة OEE تحسب السليم مقابل المنتَج؛ وFPY يحسب النجاح من أول فحص.' },
    ],
  },

  // ── Inventory ────────────────────────────────────────────────
  'inventory-overview': {
    title: { en: 'Inventory Overview', ar: 'نظرة عامة على المخزون' },
    summary: {
      en: 'Stock health across materials, spare parts, products and lots: total value, low-stock exposure and movement at a glance.',
      ar: 'صحة المخزون عبر المواد وقطع الغيار والمنتجات والدفعات: القيمة الإجمالية، تعرّض المخزون المنخفض، والحركة بنظرة واحدة.',
    },
    metrics: [
      {
        name: { en: 'Stock Value', ar: 'قيمة المخزون' },
        formula: 'Σ (on-hand qty × unit cost) across items',
        desc: { en: 'Capital tied up in inventory — the working-capital view.', ar: 'رأس المال المحتجز في المخزون — منظور رأس المال العامل.' },
        benchmark: { en: 'Balance service level vs carrying cost; avoid both stock-outs and overstock.', ar: 'وازن مستوى الخدمة مقابل تكلفة الاحتفاظ؛ تجنّب النفاد والتكدّس معًا.' },
      },
      {
        name: { en: 'Low-stock items', ar: 'أصناف منخفضة المخزون' },
        formula: 'count where on-hand ≤ reorder point (or min stock)',
        desc: { en: 'Items at or below their reorder threshold — replenishment risk.', ar: 'أصناف عند أو تحت حد إعادة الطلب — خطر نفاد.' },
        benchmark: { en: 'Keep critical raw materials out of this list to avoid line stops.', ar: 'أبقِ المواد الخام الحرجة خارج هذه القائمة لتجنّب توقف الخطوط.' },
      },
      {
        name: { en: 'Available stock', ar: 'المخزون المتاح' },
        formula: 'Available = Current Stock − Reserved Stock',
        desc: { en: 'What is truly free to consume after soft-reservations by active work orders.', ar: 'ما هو متاح فعليًا للاستهلاك بعد الحجز المبدئي لأوامر العمل النشطة.' },
        benchmark: { en: 'This — not gross stock — is what the material-shortage gate checks.', ar: 'هذا — لا المخزون الإجمالي — هو ما تتحقق منه بوابة نقص المواد.' },
      },
    ],
    dataSources: [
      { en: 'GET /inventory/overview — value, counts and stock-health rollups.', ar: 'GET /inventory/overview — القيمة والأعداد وملخصات صحة المخزون.' },
      { en: 'Sources of truth: RawMaterial.currentStock/reservedStock, SparePart.stockQty, MaterialLot.remainingQty, SKU.currentStock.', ar: 'مصادر الحقيقة: RawMaterial.currentStock/reservedStock وSparePart.stockQty وMaterialLot.remainingQty وSKU.currentStock.' },
    ],
    howToUse: [
      { en: 'Clear the low-stock list before releasing work orders that consume those materials.', ar: 'عالج قائمة المخزون المنخفض قبل إطلاق أوامر عمل تستهلك تلك المواد.' },
    ],
  },

  // ── Energy ───────────────────────────────────────────────────
  'energy-overview': {
    title: { en: 'Energy Overview', ar: 'نظرة عامة على الطاقة' },
    summary: {
      en: 'Energy consumption and cost: total kWh and cost month-to-date, breakdown by type, and the consumption trend.',
      ar: 'استهلاك الطاقة وتكلفتها: إجمالي الكيلوواط·ساعة والتكلفة حتى تاريخه، التوزيع حسب النوع، واتجاه الاستهلاك.',
    },
    metrics: [
      {
        name: { en: 'Consumption (kWh)', ar: 'الاستهلاك (ك.و.س)' },
        formula: 'Σ meter readings over the period (per type)',
        desc: { en: 'Total energy used, optionally split by source (electricity, gas, water, steam…).', ar: 'إجمالي الطاقة المستهلكة، ويمكن تقسيمها حسب المصدر (كهرباء، غاز، ماء، بخار…).' },
      },
      {
        name: { en: 'Cost', ar: 'التكلفة' },
        formula: 'Cost = Σ (consumption × tariff)',
        desc: { en: 'Monetary cost using the configured tariffs — the financial lens on energy.', ar: 'التكلفة المالية وفق التعرفات المهيّأة — المنظور المالي للطاقة.' },
      },
      {
        name: { en: 'Energy intensity', ar: 'كثافة الطاقة' },
        formula: 'Intensity = Energy ÷ Units Produced',
        desc: { en: 'Energy per produced unit — normalises consumption against output so you compare like-for-like.', ar: 'الطاقة لكل وحدة منتجة — تطبّع الاستهلاك مقابل الإنتاج لمقارنة عادلة.' },
        benchmark: { en: 'Lower is better; rising intensity at flat output flags waste.', ar: 'الأقل أفضل؛ ارتفاع الكثافة مع ثبات الإنتاج يدل على هدر.' },
      },
    ],
    dataSources: [
      { en: 'GET /energy/overview and /energy/consumption — meter rollups + trend from the time-series store (InfluxDB) and EnergySummary.', ar: 'GET /energy/overview و /energy/consumption — ملخصات العدّادات والاتجاه من مخزن السلاسل الزمنية (InfluxDB) وEnergySummary.' },
    ],
    howToUse: [
      { en: 'Compare intensity across shifts/lines to find energy-inefficient operating modes.', ar: 'قارن الكثافة بين الورديات/الخطوط لاكتشاف أنماط تشغيل مُهدِرة للطاقة.' },
    ],
  },

  // ── Home / Factory dashboard ─────────────────────────────────
  'home-dashboard': {
    title: { en: 'Factory Dashboard', ar: 'لوحة المصنع' },
    summary: {
      en: 'The executive single-pane view: factory-wide OEE, production, downtime Pareto, quality and live status — aggregated across all lines.',
      ar: 'العرض التنفيذي الموحّد: OEE على مستوى المصنع، الإنتاج، باريتو التوقفات، الجودة والحالة الحيّة — مجمّعة عبر كل الخطوط.',
    },
    metrics: [...OEE_METRICS, LINE_OEE_BASIS],
    dataSources: [
      { en: 'Aggregates the same production/maintenance/quality/energy KPI endpoints, so the headline numbers equal the per-module pages.', ar: 'تجمع نفس مؤشرات الإنتاج/الصيانة/الجودة/الطاقة، فالأرقام الرئيسية تساوي صفحات كل وحدة.' },
    ],
    howToUse: [
      { en: 'Use it as the morning stand-up screen; drill into any module page for the root cause.', ar: 'استخدمها كشاشة اجتماع الصباح؛ ثم تعمّق في صفحة الوحدة للسبب الجذري.' },
    ],
  },

  // ── Traceability ─────────────────────────────────────────────
  'traceability': {
    title: { en: 'Traceability', ar: 'التتبّع' },
    summary: {
      en: 'Forward/backward genealogy and the platform event log: trace a finished lot back to its raw material lots, or a raw lot forward to every product it became.',
      ar: 'النسب الأمامي/الخلفي وسجل أحداث المنصة: تتبّع دفعة منتج نهائي رجوعًا إلى دفعات المواد الخام، أو دفعة خام أمامًا إلى كل منتج صُنع منها.',
    },
    metrics: [
      {
        name: { en: 'Backward trace', ar: 'التتبّع الخلفي' },
        desc: { en: 'From a finished-goods lot → work order → consumed material lots (recall scope).', ar: 'من دفعة منتج نهائي ← أمر العمل ← دفعات المواد المستهلكة (نطاق الاستدعاء).' },
      },
      {
        name: { en: 'Forward trace', ar: 'التتبّع الأمامي' },
        desc: { en: 'From a material lot → every work order and finished lot it fed (impact scope).', ar: 'من دفعة مادة ← كل أمر عمل ودفعة نهائية غذّتها (نطاق التأثير).' },
      },
    ],
    dataSources: [
      { en: 'GET /production/traceability/backward|forward and /traceability event feed; built from MaterialConsumption (FEFO lot links) + TraceabilityLink + TraceEvent.', ar: 'GET /production/traceability/backward|forward وتغذية أحداث /traceability؛ مبنية من MaterialConsumption (روابط الدفعات FEFO) وTraceabilityLink وTraceEvent.' },
    ],
    howToUse: [
      { en: 'On a recall, backward-trace the suspect finished lot to bound which raw lots/suppliers are implicated.', ar: 'عند الاستدعاء، تتبّع المنتج المشتبه خلفيًا لتحديد دفعات/موردي المواد المعنية.' },
    ],
  },

  // ── Downtime Command Center ──────────────────────────────────
  'downtime-center': {
    title: { en: 'Downtime Command Center', ar: 'مركز قيادة التوقفات' },
    summary: {
      en: 'Every machine stop in the window: how long, why, planned or not, and which stops actually cost availability. Reliability figures here are equipment-based (derived from stops), which is a different lens from the work-order-based figures in Maintenance Reports — both are correct and the difference is explained below.',
      ar: 'كل توقف للماكينات في الفترة: المدة والسبب ومخطط أم لا، وأي التوقفات كلّف الجاهزية فعلاً. مؤشرات الموثوقية هنا مبنية على التوقفات، وهي عدسة مختلفة عن تقارير الصيانة المبنية على أوامر العمل — كلاهما صحيح والفرق مشروح أدناه.',
    },
    metrics: [
      {
        name: { en: 'Unplanned vs planned minutes', ar: 'الدقائق غير المخططة مقابل المخططة' },
        desc: {
          en: 'A stop is planned when isPlanned is set, or its category is PLANNED_MAINTENANCE / PLANNED_CLEANING / PLANNED_BREAK / CHANGEOVER. Planned stops reduce planned production time; they are not availability losses.',
          ar: 'التوقف مخطط إذا كان isPlanned مفعّلاً، أو كانت فئته صيانة/تنظيفاً/استراحة مخططة أو تغيير منتج. التوقفات المخططة تقلّل زمن الإنتاج المخطط ولا تُحتسب خسارة جاهزية.',
        },
      },
      {
        name: { en: 'MTTR (equipment lens)', ar: 'MTTR — عدسة المعدّة' },
        formula: 'MTTR = Σ breakdown stop hours ÷ breakdown stop count',
        desc: {
          en: 'Average production time lost per breakdown. Only genuine equipment failures count: UNPLANNED_BREAKDOWN reason code, or MECHANICAL / ELECTRICAL / UTILITY category.',
          ar: 'متوسط زمن الإنتاج المفقود لكل عطل. تُحتسب الأعطال الحقيقية فقط: رمز العطل غير المخطط، أو فئة ميكانيكية/كهربائية/مرافق.',
        },
      },
      {
        name: { en: 'MTBF (equipment lens)', ar: 'MTBF — عدسة المعدّة' },
        formula: 'MTBF = (Capacity hours − all downtime hours) ÷ breakdown stop count',
        desc: {
          en: 'Average uptime between breakdowns. Capacity hours = window hours × active machines in scope.',
          ar: 'متوسط زمن التشغيل بين الأعطال. ساعات الطاقة = ساعات الفترة × الماكينات النشطة في النطاق.',
        },
      },
      {
        name: { en: 'Availability loss %', ar: 'نسبة خسارة الجاهزية' },
        formula: 'OEE-impacting downtime hours ÷ capacity hours × 100',
        desc: { en: 'Share of capacity consumed by stops that count against OEE.', ar: 'نسبة الطاقة التي استهلكتها التوقفات المحتسبة على OEE.' },
      },
    ],
    dataSources: [
      { en: 'GET /production/downtime/cockpit — DowntimeEvent rows clamped to the window; open stops are timed to now. Classification constants live in one place (reliability.service.ts) and are shared with Maintenance and Reports.', ar: 'GET /production/downtime/cockpit — سجلات التوقف مقصوصة على الفترة، والتوقفات المفتوحة تُحسب حتى الآن. ثوابت التصنيف في مكان واحد (reliability.service.ts) مشتركة مع الصيانة والتقارير.' },
    ],
    notes: [
      { en: 'Micro-stops, starved, blocked, material and operator stops are unplanned but are NOT equipment failures, so they are excluded from MTBF/MTTR while still counting as downtime. Including them was the cause of the earlier mismatch with Maintenance Reports.', ar: 'التوقفات القصيرة والانتظار والانسداد ونقص المواد وغياب المشغّل توقفات غير مخططة لكنها ليست أعطال معدّات، فتُستبعد من MTBF/MTTR مع بقائها ضمن التوقفات. إدراجها كان سبب الاختلاف السابق مع تقارير الصيانة.' },
    ],
  },

  // ── Maintenance Reliability (MTBF / MTTR) ────────────────────
  'maintenance-reliability': {
    title: { en: 'Reliability (MTBF / MTTR)', ar: 'الموثوقية (MTBF / MTTR)' },
    summary: {
      en: 'Asset reliability measured from maintenance work orders — the maintenance function\'s own view. The Downtime Command Center measures the same concepts from machine stops. Both come from one engine with one rule set; they differ because they answer different questions.',
      ar: 'موثوقية الأصول مقاسة من أوامر عمل الصيانة — رؤية وظيفة الصيانة نفسها. مركز قيادة التوقفات يقيس المفاهيم ذاتها من توقفات الماكينات. كلاهما من محرك واحد بقواعد واحدة، ويختلفان لأنهما يجيبان سؤالين مختلفين.',
    },
    metrics: [
      {
        name: { en: 'MTTR (maintenance lens)', ar: 'MTTR — عدسة الصيانة' },
        formula: 'MTTR = Σ repair hours ÷ completed corrective+emergency WOs',
        desc: {
          en: 'Technician wrench time per repair. Uses the WO\'s logged actual hours; when missing, the started→completed elapsed time. Preventive, inspection and lubrication work orders are excluded — they are not repairs.',
          ar: 'زمن الإصلاح الفعلي لكل عطل. يستخدم الساعات المسجّلة على أمر العمل، وعند غيابها الزمن بين البدء والإكمال. أوامر الصيانة الوقائية والفحص والتزييت مستبعدة لأنها ليست إصلاحاً.',
        },
      },
      {
        name: { en: 'MTBF (maintenance lens)', ar: 'MTBF — عدسة الصيانة' },
        formula: 'MTBF = Operating hours ÷ corrective+emergency WOs raised',
        desc: {
          en: 'Operating hours are actual RUNNING machine-state hours; when no state history exists it falls back to active machines × window hours, and says so.',
          ar: 'ساعات التشغيل هي ساعات حالة التشغيل الفعلية؛ وعند غياب سجل الحالات يُستخدم عدد الماكينات النشطة × ساعات الفترة، ويُصرَّح بذلك.',
        },
      },
    ],
    dataSources: [
      { en: 'ReliabilityService — one engine serving the Maintenance cockpit, the Downtime Command Center and the Analytics reports, so no two screens can disagree.', ar: 'ReliabilityService — محرك واحد يخدم قمرة الصيانة ومركز التوقفات وتقارير التحليلات، فلا يمكن أن تختلف شاشتان.' },
    ],
    notes: [
      { en: 'Why the two lenses differ: a stop cleared by the operator never becomes a work order, and a work order can be raised without a production stop. Equipment MTTR is production time lost; maintenance MTTR is wrench time. Maintenance KPI cards use month-to-date by design, while reports use the selected window.', ar: 'سبب اختلاف العدستين: التوقف الذي يعالجه المشغّل لا يصبح أمر عمل، وأمر العمل قد يُفتح دون توقف إنتاج. MTTR للمعدّة هو زمن الإنتاج المفقود، وMTTR للصيانة هو زمن الإصلاح. بطاقات الصيانة تستخدم الشهر حتى تاريخه بالتصميم، بينما التقارير تستخدم الفترة المختارة.' },
    ],
  },

  // ── Quality Intelligence ─────────────────────────────────────
  'quality-intelligence': {
    title: { en: 'Quality Intelligence', ar: 'ذكاء الجودة' },
    summary: {
      en: 'The quality command centre: first-pass yield trend, defect Pareto, NCR severity and status mix, inspection outcomes and the CAPA funnel — all for the selected scope and period.',
      ar: 'مركز قيادة الجودة: اتجاه النجاح من أول مرة، وباريتو العيوب، وتوزيع شدة وحالة عدم المطابقة، ونتائج الفحص، وقمع الإجراءات التصحيحية — للنطاق والفترة المختارين.',
    },
    metrics: [
      {
        name: { en: 'First Pass Yield (FPY)', ar: 'النجاح من أول مرة' },
        formula: 'FPY = Σ inspection pass qty ÷ Σ inspection total qty × 100',
        desc: { en: 'Units accepted at first inspection, before any rework. Not the same as the OEE Quality factor, which is based on produced good vs total output.', ar: 'الوحدات المقبولة من أول فحص قبل أي إعادة عمل. تختلف عن عامل الجودة في OEE المبني على الإنتاج السليم مقابل الإجمالي.' },
        benchmark: { en: 'World-class ≥ 99%.', ar: 'عالمي ≥ 99%.' },
      },
      {
        name: { en: 'Defect Rate / PPM', ar: 'معدل العيوب' },
        formula: 'Defect Rate = Σ fail qty ÷ Σ total qty × 100 ; PPM = ×1,000,000',
        desc: { en: 'The complement of FPY by construction: FPY + Defect Rate = 100.', ar: 'مكمّل FPY بحكم التعريف: FPY + معدل العيوب = 100.' },
      },
      {
        name: { en: 'Cpk', ar: 'Cpk' },
        desc: { en: 'Process capability from real SPC measurements against configured spec limits. Null when no characteristic has both limits set — it is never approximated.', ar: 'قدرة العملية من قياسات SPC الحقيقية مقابل حدود المواصفة المُعرَّفة. تكون فارغة إذا لم تُضبط الحدود، ولا تُقدَّر تقريبياً أبداً.' },
        benchmark: { en: '≥ 1.33 capable, ≥ 1.67 six-sigma.', ar: '≥ 1.33 قادرة، ≥ 1.67 ستة سيجما.' },
      },
    ],
    dataSources: [
      { en: 'GET /quality/cockpit and /quality/kpis — InspectionResult, NCR and CAPA. The Quality Reports page reads the same figures for the same scope, so the two must agree.', ar: 'GET /quality/cockpit و/quality/kpis — نتائج الفحص وعدم المطابقة والإجراءات التصحيحية. صفحة تقارير الجودة تقرأ الأرقام نفسها للنطاق نفسه، فيجب أن تتطابقا.' },
    ],
  },

  // ── Analytics & Reports hub ──────────────────────────────────
  'analytics-reports': {
    title: { en: 'Analytics & Reports', ar: 'التحليلات والتقارير' },
    summary: {
      en: 'Report packs for production, quality and maintenance over a chosen window, exportable to PDF, Excel and CSV. Every figure is produced by the same calculation engine as the live dashboards — a report and a cockpit must never disagree for the same scope and period.',
      ar: 'حزم تقارير للإنتاج والجودة والصيانة لفترة مختارة، قابلة للتصدير إلى PDF وExcel وCSV. كل رقم يأتي من محرك الحساب نفسه الذي يغذّي اللوحات الحية — فلا يجوز أن يختلف تقرير عن قمرة لنفس النطاق والفترة.',
    },
    metrics: [
      {
        name: { en: 'Master Schedule Attainment (MSA)', ar: 'الالتزام بالجدول الرئيسي' },
        formula: 'MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100',
        desc: {
          en: 'Each order is credited at most its scheduled quantity, so over-producing one order cannot mask a shortfall on another. 100% means every order met its plan — not that total output matched total plan.',
          ar: 'يُحتسب لكل أمر ما لا يتجاوز كميته المجدولة، فلا يمكن لزيادة إنتاج أمر أن تخفي نقص أمر آخر. 100% تعني أن كل أمر حقّق خطته، لا أن الإجمالي طابق الإجمالي.',
        },
      },
      {
        name: { en: 'Volume-Based Capacity Utilization', ar: 'استغلال الطاقة الإنتاجية' },
        formula: 'Actual Units Produced ÷ Maximum Designed Unit Capacity × 100',
        desc: {
          en: 'The rated capacity comes from the process routing step cycle time (3600 ÷ cycleTimeSec, converted to the SKU base unit) × calendar hours — the same master data that generates job orders, so capacity can never drift from the plan.',
          ar: 'الطاقة المقدَّرة تأتي من زمن دورة مرحلة التوجيه (3600 ÷ زمن الدورة، محوَّلاً لوحدة الأساس) × ساعات الفترة — نفس البيانات التي تُولَّد منها أوامر التشغيل، فلا تنفصل الطاقة عن الخطة.',
        },
      },
    ],
    dataSources: [
      { en: 'GET /reports/production|quality|maintenance, /production/kpi/master-schedule-attainment, /production/kpi/capacity-utilization.', ar: 'GET /reports/production|quality|maintenance و/production/kpi/master-schedule-attainment و/production/kpi/capacity-utilization.' },
    ],
    notes: [
      { en: 'Machines not assigned to any active routing step with a cycle time contribute nothing to the capacity denominator. The API lists them by name rather than silently shrinking the denominator, which would flatter the result.', ar: 'الماكينات غير المُسندة لأي مرحلة توجيه نشطة بزمن دورة لا تضيف شيئاً لمقام الطاقة. الـAPI يذكرها بالاسم بدل تصغير المقام بصمت، وهو ما كان سيجمّل النتيجة.' },
    ],
  },

  // ── Energy analytics + Scope 2 carbon ────────────────────────
  'energy-analytics': {
    title: { en: 'Energy Analytics & Carbon', ar: 'تحليلات الطاقة والكربون' },
    summary: {
      en: 'Energy resolved to the things that consume it — machine, work order, SKU, shift — plus the Scope 2 carbon footprint of the electricity used.',
      ar: 'الطاقة منسوبة إلى ما يستهلكها — الماكينة وأمر العمل والمنتج والوردية — مع البصمة الكربونية للنطاق ٢ للكهرباء المستهلكة.',
    },
    metrics: [
      {
        name: { en: 'Energy ratio', ar: 'نسبة الطاقة' },
        formula: 'kWh ÷ good output (also kWh/kg and kWh/running hour)',
        desc: { en: 'Energy per unit produced. Compared against the best ratio the same machine previously demonstrated for the same SKU, so drift is measured against proven performance rather than an arbitrary target.', ar: 'الطاقة لكل وحدة منتجة، تُقارن بأفضل نسبة سبق أن حققتها الماكينة نفسها للمنتج نفسه، فيُقاس الانحراف مقابل أداء مثبت لا هدف اعتباطي.' },
      },
      {
        name: { en: 'Scope 2 carbon footprint', ar: 'البصمة الكربونية — النطاق ٢' },
        formula: 'kg CO₂e = kWh purchased electricity × grid emission factor',
        desc: {
          en: 'Location-based Scope 2 per the GHG Protocol. The kWh is read from the same source as the energy cards, so carbon and energy can never disagree. The factor is stored configuration, versioned by effective date, and a defaulted factor is flagged rather than passed off as approved.',
          ar: 'النطاق ٢ حسب بروتوكول الغازات الدفيئة. الكيلوواط تُقرأ من مصدر بطاقات الطاقة نفسه، فلا يختلف الكربون عن الطاقة. المعامل إعداد مخزَّن مُصدَّر بالتاريخ الفعّال، والمعامل الافتراضي يُوسَم صراحةً ولا يُقدَّم كأنه معتمد.',
        },
      },
    ],
    dataSources: [
      { en: 'GET /energy/analytics, /energy/carbon/scope2, /energy/carbon/emission-factor. Consumption is derived from EnergyReading meter deltas.', ar: 'GET /energy/analytics و/energy/carbon/scope2 و/energy/carbon/emission-factor. الاستهلاك مشتق من فروق قراءات العدادات.' },
    ],
    notes: [
      { en: 'Scope 1 (on-site fuel combustion) and Scope 3 (value chain) are out of scope for this PoC — only purchased electricity is covered.', ar: 'النطاق ١ (احتراق الوقود بالموقع) والنطاق ٣ (سلسلة القيمة) خارج نطاق هذا الإثبات — المشمول هو الكهرباء المشتراة فقط.' },
    ],
  },

  // ── Quality report ───────────────────────────────────────────
  'quality-report': {
    title: { en: 'Quality Report', ar: 'تقرير الجودة' },
    summary: {
      en: 'Inspection and non-conformance performance for the selected period, exportable for review. The figures are computed by the same service as the Quality cockpit, so the report and the dashboard must show identical values for identical scope and dates.',
      ar: 'أداء الفحص وعدم المطابقة للفترة المختارة، قابل للتصدير للمراجعة. الأرقام تُحسب بنفس الخدمة التي تغذّي قمرة الجودة، فيجب أن يعرض التقرير واللوحة القيم ذاتها لنفس النطاق والتواريخ.',
    },
    metrics: [
      {
        name: { en: 'First Pass Yield (FPY)', ar: 'النجاح من أول مرة' },
        formula: 'FPY = Σ inspection pass qty ÷ Σ inspection total qty × 100',
        desc: { en: 'Units accepted at first inspection, before rework. Distinct from the OEE Quality factor, which is based on produced good vs total output — the two answer different questions and will not normally be equal.', ar: 'الوحدات المقبولة من أول فحص قبل إعادة العمل. تختلف عن عامل الجودة في OEE المبني على الإنتاج السليم مقابل الإجمالي — السؤالان مختلفان ولا يتساويان عادةً.' },
        benchmark: { en: 'World-class ≥ 99%.', ar: 'عالمي ≥ 99%.' },
      },
      {
        name: { en: 'Defect Rate / PPM', ar: 'معدل العيوب' },
        formula: 'Defect Rate = Σ fail qty ÷ Σ total qty × 100',
        desc: { en: 'FPY + Defect Rate = 100 by construction. The denominator is inspected units.', ar: 'FPY + معدل العيوب = 100 بحكم التعريف. المقام هو الوحدات المفحوصة.' },
      },
      {
        name: { en: 'NCRs and critical NCRs', ar: 'تقارير عدم المطابقة والحرجة منها' },
        desc: { en: 'Non-conformance records raised in the window, with the critical subset called out separately.', ar: 'سجلات عدم المطابقة المفتوحة في الفترة، مع إبراز الحرجة منها منفصلة.' },
      },
    ],
    dataSources: [
      { en: 'GET /reports/quality — InspectionResult and NCR filtered to the window and factory.', ar: 'GET /reports/quality — نتائج الفحص وعدم المطابقة مُرشَّحة على الفترة والمصنع.' },
    ],
  },

  // ── Maintenance report ───────────────────────────────────────
  'maintenance-report': {
    title: { en: 'Maintenance Report', ar: 'تقرير الصيانة' },
    summary: {
      en: 'Work-order completion, reliability and cost for the selected period. MTBF and MTTR here are the maintenance lens (work-order based). The Downtime Command Center shows the equipment lens (stop based); both come from one engine and the reason they differ is stated below.',
      ar: 'إنجاز أوامر العمل والموثوقية والتكلفة للفترة المختارة. MTBF وMTTR هنا بعدسة الصيانة (مبنية على أوامر العمل)، بينما مركز قيادة التوقفات يعرض عدسة المعدّة (مبنية على التوقفات). كلاهما من محرك واحد، وسبب الاختلاف مذكور أدناه.',
    },
    metrics: [
      {
        name: { en: 'MTTR', ar: 'متوسط زمن الإصلاح' },
        formula: 'MTTR = Σ repair hours ÷ completed corrective+emergency WOs',
        desc: { en: 'Preventive, inspection and lubrication work orders are excluded — they are planned work, not repairs.', ar: 'أوامر الصيانة الوقائية والفحص والتزييت مستبعدة — فهي عمل مخطط لا إصلاح.' },
      },
      {
        name: { en: 'MTBF', ar: 'متوسط الزمن بين الأعطال' },
        formula: 'MTBF = Operating hours ÷ corrective+emergency WOs raised',
        desc: { en: 'Operating hours are actual RUNNING machine-state hours, falling back to active machines × window hours when no state history exists.', ar: 'ساعات التشغيل هي ساعات حالة التشغيل الفعلية، ويُستعاض عنها بعدد الماكينات النشطة × ساعات الفترة عند غياب سجل الحالات.' },
      },
      {
        name: { en: 'Completion rate', ar: 'معدل الإنجاز' },
        formula: 'Completed WOs ÷ total WOs in window × 100',
        desc: { en: 'Share of work orders raised in the period that were finished.', ar: 'نسبة أوامر العمل المفتوحة في الفترة التي أُنجزت.' },
      },
    ],
    dataSources: [
      { en: 'GET /reports/maintenance, backed by ReliabilityService — the single MTBF/MTTR engine shared with the Maintenance cockpit and the Downtime Command Center.', ar: 'GET /reports/maintenance، مدعوماً بـReliabilityService — محرك MTBF/MTTR الوحيد المشترك مع قمرة الصيانة ومركز التوقفات.' },
    ],
    notes: [
      { en: 'Equipment MTTR measures production time lost; maintenance MTTR measures technician wrench time. A stop cleared by the operator never becomes a work order, and a work order can exist without a production stop — so the two lenses legitimately differ.', ar: 'MTTR للمعدّة يقيس زمن الإنتاج المفقود، وMTTR للصيانة يقيس زمن عمل الفني. التوقف الذي يعالجه المشغّل لا يصبح أمر عمل، وأمر العمل قد يوجد بلا توقف إنتاج — فالاختلاف بين العدستين مشروع.' },
    ],
  },

  // ── Production report ────────────────────────────────────────
  'production-report': {
    title: { en: 'Production Report', ar: 'تقرير الإنتاج' },
    summary: {
      en: 'Output, OEE and downtime for the selected period, sourced from the canonical job-order analytics — the same engine behind the Performance & KPI pages — so output is normalised to the product base unit and OEE is time-weighted rather than averaged.',
      ar: 'الإنتاج وOEE والتوقفات للفترة المختارة، مصدرها تحليلات أوامر التشغيل المعتمدة — نفس المحرك خلف صفحات الأداء والمؤشرات — فالإنتاج مُوحَّد على وحدة أساس المنتج وOEE مرجّح زمنياً لا متوسطاً.',
    },
    metrics: [
      {
        name: { en: 'Planned vs actual vs good', ar: 'المخطط مقابل الفعلي مقابل السليم' },
        desc: { en: 'Planned is the ideal output achievable in the run time at the ideal rate, so efficiency equals OEE Performance — a real bounded percentage, not a placeholder that always reads 100%.', ar: 'المخطط هو الإنتاج المثالي الممكن في زمن التشغيل بالمعدل المثالي، فتصبح الكفاءة مساوية لأداء OEE — نسبة حقيقية محدودة لا قيمة صورية تقرأ 100% دائماً.' },
      },
      {
        name: { en: 'Downtime minutes', ar: 'دقائق التوقف' },
        desc: { en: 'Unplanned, OEE-affecting stop minutes in the window.', ar: 'دقائق التوقفات غير المخططة المؤثرة على OEE في الفترة.' },
      },
    ],
    dataSources: [
      { en: 'GET /reports/production — KpiService job-order analytics plus DowntimeEvent aggregation.', ar: 'GET /reports/production — تحليلات أوامر التشغيل من KpiService مع تجميع أحداث التوقف.' },
    ],
  },

  // ── Command Center ───────────────────────────────────────────
  'command-center': {
    title: { en: 'Command Center', ar: 'مركز القيادة' },
    summary: {
      en: 'The single live operating picture: current OEE and its factors, output against plan, active alarms, machine states and the running work orders — all for the scope and period selected in the panel.',
      ar: 'الصورة التشغيلية الحية الموحّدة: OEE الحالي وعوامله، والإنتاج مقابل الخطة، والإنذارات النشطة، وحالات الماكينات، وأوامر العمل الجارية — للنطاق والفترة المختارين من اللوحة.',
    },
    metrics: [...OEE_METRICS, LINE_OEE_BASIS],
    dataSources: [
      { en: 'GET /dashboard/kpis and the live KPI socket feed. OEE comes from the same engine as every other surface, so the headline number here must equal the one on Performance & KPIs for the same scope and window.', ar: 'GET /dashboard/kpis وتغذية المؤشرات الحية. OEE يأتي من المحرك ذاته الذي يغذّي كل الشاشات، فالرقم هنا يجب أن يساوي نظيره في صفحة الأداء والمؤشرات لنفس النطاق والفترة.' },
    ],
  },
};

export const EXPLAINER_LABELS = {
  overview: { en: 'What this page shows', ar: 'ماذا تعرض هذه الصفحة' },
  metrics: { en: 'Metrics & how they are calculated', ar: 'المؤشرات وطريقة حسابها' },
  formula: { en: 'Formula', ar: 'المعادلة' },
  benchmark: { en: 'Target / how to read', ar: 'الهدف / كيف تُقرأ' },
  dataSources: { en: 'Data sources', ar: 'مصادر البيانات' },
  howToUse: { en: 'How to use it', ar: 'كيف تستفيد منها' },
  notes: { en: 'Consistency notes', ar: 'ملاحظات الاتساق' },
  open: { en: 'About this page', ar: 'عن هذه الصفحة' },
};
