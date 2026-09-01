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
// The ecosystem module catalogue lives in src/modules/ecosystem/catalogue.ts.
// It describes the product, not the plant — and the Nest build compiles only
// `src`, so a plant-model import of it would move dist/main.js.
// ────────────────────────────────────────────────────────────────────────────

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
