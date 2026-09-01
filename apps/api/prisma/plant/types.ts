/**
 * i360 Ecosystem Demo — plant model types.
 *
 * The whole demo estate is described by data in this folder and nowhere else.
 * A reviewer can read `plant-model.ts` and know exactly what the running system
 * contains without opening the seeder, which is the point: the plant is data,
 * not code.
 *
 * Three factories sit under one enterprise, deliberately chosen so the estate
 * exercises three different manufacturing paradigms on one schema:
 *
 *   NPDF  batch / lot process   — detergent powder and liquids
 *   AFCC  discrete serialised   — Type-IV composite LPG cylinders
 *   RMTC  continuous web + EMS  — RO membrane, energy and power quality
 *
 * Every identity here is fictional. No customer name, site, coordinate or
 * measurement report appears anywhere in this model.
 */

export type AreaType =
  | 'MAKING' | 'PACKING' | 'FILLING' | 'UTILITY' | 'WAREHOUSE' | 'LABORATORY' | 'OFFICE';

export type LineType =
  | 'PACKING' | 'FILLING' | 'MAKING' | 'BLOW_MOLDING' | 'BLOW_FILM'
  | 'AEROSOL' | 'CUTTING_SEALING' | 'UTILITY';

export type MachineType =
  | 'MACHINE' | 'PRODUCTION_LINE' | 'CONVEYOR' | 'ROBOT' | 'PALLETIZER'
  | 'CHECKWEIGHER' | 'FILLING_MACHINE' | 'CARTONING_MACHINE' | 'WRAPPING_MACHINE'
  | 'BLOW_MOLDING' | 'BLOW_FILM' | 'COMPRESSOR' | 'BOILER' | 'TRANSFORMER'
  | 'CHILLER' | 'ENERGY_METER' | 'PUMP' | 'MIXER' | 'REACTOR' | 'HMI'
  | 'GATEWAY' | 'SENSOR';

export type Criticality = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type OeeMethod = 'ROLLUP' | 'BOTTLENECK';
export type EnergyType =
  | 'ELECTRICAL' | 'NATURAL_GAS' | 'COMPRESSED_AIR' | 'WATER' | 'STEAM' | 'CHILLED_WATER';

export type DowntimeCategory =
  | 'MECHANICAL' | 'ELECTRICAL' | 'PROCESS' | 'MATERIAL' | 'OPERATOR' | 'CHANGEOVER'
  | 'UTILITY' | 'QUALITY' | 'PLANNED_MAINTENANCE' | 'PLANNED_CLEANING'
  | 'PLANNED_BREAK' | 'STARTUP' | 'EXTERNAL' | 'OTHER';

/**
 * Which manufacturing paradigm a factory follows.
 *
 * This is the field that lets one schema carry three industries: the API and
 * the navigation read it to decide whether a site tracks lots or serial units,
 * and whether the energy and power-quality module is its primary story or a
 * supporting one.
 */
export type ProductionParadigm = 'BATCH_LOT' | 'DISCRETE_SERIAL' | 'CONTINUOUS_WEB';

/**
 * The factory's classification — what kind of plant it is.
 *
 * This is the field the whole product specialises on. `paradigm` describes the
 * physics of how units move; `type` describes what the plant is *for*, and it
 * is what decides which modules a site gets. A composite-cylinder plant needs
 * per-unit genealogy and a vision station; a membrane plant needs harmonics and
 * an energy baseline. Giving every site every screen would be dishonest — half
 * of them would have nothing behind them.
 */
export type FactoryType =
  /** Batch/lot process manufacturing — detergents, food, chemicals, pharma. */
  | 'PROCESS_FMCG'
  /** Discrete serialised assembly — cylinders, appliances, automotive parts. */
  | 'DISCRETE_ASSEMBLY'
  /** Continuous web with a heavy electrical load — membrane, film, paper, textile. */
  | 'CONTINUOUS_PROCESS';

/**
 * A module a factory can have.
 *
 * Navigation, the API and the ecosystem home all read this list. A capability
 * a site does not declare is not merely hidden — its routes refuse, because a
 * screen that renders an empty state is worse than a screen that is not there.
 */
export type FactoryCapability =
  // ── Core. Every factory has these. ────────────────────────────────────────
  | 'OEE'                  // availability/performance/quality, loss breakdown
  | 'DOWNTIME'             // event capture and the three-level reason tree
  | 'QUALITY'              // plans, inspections, SPC, non-conformance
  | 'MAINTENANCE'          // work orders, preventive plans, reliability
  | 'SCHEDULING'           // shift and order scheduling
  | 'ENERGY_METERING'      // consumption per meter, per line, per area

  // ── Discrete serialised — the composite-cylinder story. ───────────────────
  | 'SERIAL_GENEALOGY'     // per-unit forward trace across every routing stage
  | 'DIGITAL_TWIN'         // 2.5D plant floor with live values on each cell
  | 'VISION_INSPECTION'    // automated visual inspection with annotated rejects
  | 'MATERIAL_BATCH_TRACE' // backward trace: which units carry a material lot

  // ── Batch/lot process — the detergent story. ──────────────────────────────
  | 'LOT_GENEALOGY'        // batch records and lot-level trace
  | 'RECIPE_BATCH'         // recipes and batch execution
  | 'INVENTORY'            // materials, stock movements, storage locations
  | 'PLM'                  // product lifecycle and change control

  // ── Continuous process with a heavy load — the membrane story. ────────────
  | 'POWER_QUALITY'        // sags, swells, interruptions on a ride-through plot
  | 'HARMONICS'            // spectra against EN 50160 and IEEE 519
  | 'POWER_FACTOR'         // PF trend, capacitor banks, reactive surcharge
  | 'SINGLE_LINE_DIAGRAM'  // live SLD with values riding on each node
  | 'ENERGY_BASELINE'      // ISO 50001 / IPMVP regression and CUSUM
  | 'COST_ALLOCATION'      // tariff reconstruction and cost per area
  | 'SUSTAINABILITY'       // Scope 1/2/3, intensity, ESG scorecard
  | 'PREDICTIVE_ASSETS'    // health projection to an intervention threshold
  | 'ENVIRONMENT';         // environmental and utility monitoring

/**
 * What each classification gets by default.
 *
 * A factory may add to this but the base set is a property of the type, so a
 * fourth site of an existing type inherits the right modules without anyone
 * remembering to tick them.
 */
export const CAPABILITIES_BY_TYPE: Record<FactoryType, FactoryCapability[]> = {
  PROCESS_FMCG: [
    'OEE', 'DOWNTIME', 'QUALITY', 'MAINTENANCE', 'SCHEDULING', 'ENERGY_METERING',
    'LOT_GENEALOGY', 'RECIPE_BATCH', 'INVENTORY', 'PLM',
  ],
  DISCRETE_ASSEMBLY: [
    'OEE', 'DOWNTIME', 'QUALITY', 'MAINTENANCE', 'SCHEDULING', 'ENERGY_METERING',
    'SERIAL_GENEALOGY', 'DIGITAL_TWIN', 'VISION_INSPECTION', 'MATERIAL_BATCH_TRACE',
    'INVENTORY', 'ENVIRONMENT', 'PREDICTIVE_ASSETS',
  ],
  CONTINUOUS_PROCESS: [
    'OEE', 'DOWNTIME', 'QUALITY', 'MAINTENANCE', 'SCHEDULING', 'ENERGY_METERING',
    'POWER_QUALITY', 'HARMONICS', 'POWER_FACTOR', 'SINGLE_LINE_DIAGRAM',
    'ENERGY_BASELINE', 'COST_ALLOCATION', 'SUSTAINABILITY', 'PREDICTIVE_ASSETS',
    'ENVIRONMENT', 'INVENTORY',
  ],
};

export const FACTORY_TYPE_META: Record<FactoryType, { name: string; nameAr: string; summary: string; summaryAr: string }> = {
  PROCESS_FMCG: {
    name: 'Process / FMCG',
    nameAr: 'عمليات ومنتجات استهلاكية',
    summary: 'Batch and lot manufacturing — recipes, batch records, lot traceability',
    summaryAr: 'تصنيع بالدفعات واللوطات — وصفات وسجلات دفعات وتتبّع لوطات',
  },
  DISCRETE_ASSEMBLY: {
    name: 'Discrete Assembly',
    nameAr: 'تجميع منفصل',
    summary: 'Serialised units — per-unit genealogy, vision inspection, digital twin',
    summaryAr: 'وحدات مُسلسَلة — تتبّع لكل وحدة وفحص بصري وتوأم رقمي',
  },
  CONTINUOUS_PROCESS: {
    name: 'Continuous Process',
    nameAr: 'عمليات مستمرة',
    summary: 'Continuous web with a heavy electrical load — power quality and energy',
    summaryAr: 'إنتاج مستمر بحمل كهربائي عالٍ — جودة القدرة والطاقة',
  },
};

/** Ecosystem layer a capability belongs to, per the Application Suite. */
export type EcosystemLayer = 'L1_CONNECTIVITY' | 'L2_MES' | 'L3_SIMULATION' | 'L4_AI' | 'DX' | 'EMERGING';

// ────────────────────────────────────────────────────────────────────────────
// Physical hierarchy
// ────────────────────────────────────────────────────────────────────────────

export interface AreaDef {
  code: string;
  name: string;
  nameAr: string;
  type: AreaType;
  description?: string;
}

export interface MachineDef {
  code: string;
  name: string;
  nameAr: string;
  type: MachineType;
  areaCode: string;
  /** Omitted for utility assets that belong to an area but not a line. */
  lineCode?: string;
  sortOrder: number;
  manufacturer?: string;
  model?: string;
  criticality: Criticality;
  /** Units per hour in this machine's own counting unit. */
  designCapacity?: number;
  /** Ideal seconds per unit. Drives Performance; must agree with designCapacity. */
  idealCycleSeconds?: number;
  /** The unit this machine counts in — a carton counter is not a piece counter. */
  countUnit?: string;
  /** Seconds a stop must persist before it opens a downtime event. */
  downtimeThreshold?: number;
  installDate?: string;
  /** Free-form, surfaced on the asset screen. */
  metadata?: Record<string, unknown>;
}

export interface LineDef {
  code: string;
  name: string;
  nameAr: string;
  type: LineType;
  areaCode: string;
  sortOrder: number;
  /**
   * BOTTLENECK is the honest method for a serial line: the line cannot run
   * faster than its slowest machine, so rolling up an average hides the
   * constraint. ROLLUP suits a cell group with no single constraint.
   */
  oeeMethod: OeeMethod;
  /** Required when oeeMethod is BOTTLENECK. Machine code, not id. */
  bottleneckMachine?: string;
  /** Machine codes whose GOOD count is the line's output. Usually the last step. */
  outfeedMachines?: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Operating model
// ────────────────────────────────────────────────────────────────────────────

export interface ShiftDef {
  code: string;
  name: string;
  nameAr: string;
  /** 24h "HH:mm" local to the factory timezone. */
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  shiftDurationHours: number;
  plannedProductionHours: number;
  breakMinutes: number;
  cleaningMinutes: number;
  /** 0 = Sunday … 6 = Saturday. KSA working week is Sun–Thu. */
  days: number[];
  targetQtyPerShift?: number;
  targetUnit?: string;
  /**
   * Relative pace of this shift, 1.0 = the day-shift baseline. Nights run
   * slower in every real plant; making that a property of the shift rather
   * than noise is what makes the shift comparison screen meaningful.
   */
  efficiencyFactor: number;
}

export interface DowntimeCauseDef {
  code: string;
  name: string;
  nameAr: string;
  category: DowntimeCategory;
  isPlanned: boolean;
  /** Parent code in the 3-level tree. Level 1 nodes have none. */
  parent?: string;
  level: 1 | 2 | 3;
  /** Relative likelihood when the simulator picks a reason for a stop. */
  weight?: number;
  /** Typical stop length in minutes — [min, max]. */
  durationRange?: [number, number];
}

// ────────────────────────────────────────────────────────────────────────────
// Products and materials
// ────────────────────────────────────────────────────────────────────────────

export interface ProductDef {
  code: string;
  name: string;
  nameAr: string;
  category: string;
  brand: string;
  /** Smallest sellable unit held in stock. */
  baseUnit: string;
  /** Packaging ladder, smallest first, e.g. PIECE → INNER → CARTON → PALLET. */
  packagingLadder: { unit: string; perParent: number }[];
  netWeightGrams?: number;
  isActive: boolean;
}

export interface MaterialDef {
  code: string;
  name: string;
  nameAr: string;
  /** RAW, PACKAGING, CONSUMABLE, INTERMEDIATE */
  type: 'RAW' | 'PACKAGING' | 'CONSUMABLE' | 'INTERMEDIATE';
  unit: string;
  /** Shelf life in days; undefined means non-perishable. */
  shelfLifeDays?: number;
  criticalStock?: number;
}

export interface RoutingStepDef {
  sequence: number;
  code: string;
  name: string;
  nameAr: string;
  /** Machine codes that can perform this step. First is the default. */
  machines: string[];
  /** Ideal seconds per unit at this step. */
  idealCycleSeconds: number;
  /** Material codes consumed here. */
  consumes?: string[];
  /** Quality tests performed at this step. */
  tests?: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Quality
// ────────────────────────────────────────────────────────────────────────────

export interface QualitySpecDef {
  code: string;
  name: string;
  nameAr: string;
  /** The step or machine the test belongs to. */
  stepCode?: string;
  unit: string;
  /** Lower and upper acceptance limits. */
  lsl?: number;
  usl?: number;
  target?: number;
  /** Share of units tested, 0..1. 1 = every unit. */
  sampleRate: number;
  /** Baseline pass rate before process stress is applied. */
  baselinePassRate: number;
}

export interface ScrapCodeDef {
  code: string;
  name: string;
  nameAr: string;
  /** The step that most often produces this defect. */
  stepCode?: string;
  /** Relative weight in the Pareto before process coupling. */
  weight: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Connectivity — Layer 01
// ────────────────────────────────────────────────────────────────────────────

export type TagRole =
  | 'STATUS' | 'COUNTER_TOTAL' | 'COUNTER_GOOD' | 'COUNTER_REJECT'
  | 'PROCESS' | 'ENERGY' | 'ENVIRONMENT';

export interface TagDef {
  code: string;
  name: string;
  role: TagRole;
  /** Machine or meter this tag belongs to. */
  ownerCode: string;
  /** Modbus address within the device. */
  address: number;
  dataType: 'BOOL' | 'INT16' | 'UINT16' | 'INT32' | 'UINT32' | 'FLOAT32';
  unit?: string;
  scale?: number;
  pollMs: number;
  /** Engineering range, used by the simulator and by alarm defaults. */
  range?: [number, number];
}

export interface DeviceDef {
  code: string;
  name: string;
  protocol: 'MODBUS_TCP' | 'MODBUS_RTU' | 'OPC_UA' | 'MQTT';
  /** TCP port the Virtual Plant serves this device on. */
  port?: number;
  unitId?: number;
  areaCode?: string;
  lineCode?: string;
  pollMs: number;
  tags: TagDef[];
}

export interface GatewayDef {
  code: string;
  name: string;
  /** Where the gateway physically sits, for the topology screen. */
  location: string;
  devices: string[];
}

export interface EnergyMeterDef {
  code: string;
  meterNumber: string;
  name: string;
  nameAr: string;
  type: EnergyType;
  unit: string;
  /** Exactly one of these three scopes. */
  machineCode?: string;
  lineCode?: string;
  areaCode?: string;
  manufacturer?: string;
  model?: string;
  /** Baseline average load in kW, used by the signal engine. */
  baselineKw?: number;
}

export interface AlarmRuleDef {
  code: string;
  name: string;
  nameAr: string;
  tagCode: string;
  condition: 'GT' | 'LT' | 'EQ' | 'NEQ';
  threshold: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Seconds the condition must hold before the alarm raises. */
  delaySeconds: number;
  hysteresis?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// The factory
// ────────────────────────────────────────────────────────────────────────────

export interface FactoryDef {
  code: string;
  name: string;
  nameAr: string;
  city: string;
  cityAr: string;
  district?: string;
  districtAr?: string;
  /** Fictional coordinates inside the correct industrial city. */
  lat: number;
  lng: number;
  color: string;
  glowColor: string;
  timezone: string;
  /** How quantities are presented. Arithmetic is always done in PIECE. */
  displayUnit: string;
  paradigm: ProductionParadigm;
  /** What kind of plant this is. Decides which modules the site gets. */
  type: FactoryType;
  /**
   * Modules beyond the type's defaults. Use this for a site that genuinely
   * has something its class normally would not — never to paper over a
   * classification that is simply wrong.
   */
  extraCapabilities?: FactoryCapability[];
  /**
   * How many base units one counting unit contains, within its own family.
   *
   * A counter pulse means "one unit in THIS machine's counting unit", so a
   * cartoner's 300/h and a filler's 1,800/h cannot be compared until both are
   * expressed in the same rung of the ladder. Without this the line's
   * constraint cannot be found and every downstream rate is wrong.
   */
  unitFactors: Record<string, number>;
  /** One line, shown on the factory selector and the ecosystem home. */
  tagline: string;
  taglineAr: string;
  /** Which ecosystem capabilities this site demonstrates. */
  showcases: EcosystemLayer[];

  areas: AreaDef[];
  lines: LineDef[];
  machines: MachineDef[];
  shifts: ShiftDef[];
  downtimeCauses: DowntimeCauseDef[];
  products: ProductDef[];
  materials: MaterialDef[];
  routing: RoutingStepDef[];
  qualitySpecs: QualitySpecDef[];
  scrapCodes: ScrapCodeDef[];
  devices: DeviceDef[];
  gateways: GatewayDef[];
  energyMeters: EnergyMeterDef[];
  alarmRules: AlarmRuleDef[];
}

export interface EnterpriseDef {
  code: string;
  name: string;
  nameAr: string;
  industry: string;
  country: string;
  timezone: string;
  currency: string;
  factories: FactoryDef[];
}
