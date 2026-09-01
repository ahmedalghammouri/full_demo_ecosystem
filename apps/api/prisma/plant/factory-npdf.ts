/**
 * NPDF — Nahdah Powder & Detergents Factory, Dammam.
 *
 * The batch/lot process site, and the one that carries the deepest MES story:
 * production orders, work orders, OEE, downtime, quality, maintenance,
 * inventory and traceability at lot level.
 *
 * Rates are coherent by construction. The packaging ladder for the flagship SKU
 * is 1 CARTON = 4 INNER and 1 PALLET = 40 CARTON, and every machine's ideal
 * cycle is stated in the unit it actually counts. Normalised to INNER per hour:
 *
 *   M1 Powder Filler   2.0 s/INNER    1,800 INNER/h
 *   M3 Carton Packer  12.0 s/CARTON   1,200 INNER/h   ← the constraint
 *   M4 Shrink Wrapper 10.0 s/CARTON   1,440 INNER/h
 *   M5 Palletizer    400.0 s/PALLET   1,440 INNER/h
 *
 * The cartoner is therefore the line's bottleneck, which is why L1 uses the
 * BOTTLENECK OEE method: rolling up an average across five machines would hide
 * the only number that limits the line.
 */

import type { FactoryDef } from './types';

export const NPDF: FactoryDef = {
  code: 'NPDF',
  name: 'Nahdah Powder & Detergents Factory',
  nameAr: 'مصنع النهضة للمساحيق والمنظفات',
  city: 'Dammam',
  cityAr: 'الدمام',
  district: '2nd Industrial City',
  districtAr: 'المدينة الصناعية الثانية',
  lat: 26.3421,
  lng: 49.9587,
  color: '#00A88E',
  glowColor: 'rgba(0,168,142,0.30)',
  timezone: 'Asia/Riyadh',
  displayUnit: 'CARTON',
  paradigm: 'BATCH_LOT',
  type: 'PROCESS_FMCG',
  // L1 ladder: 1 CARTON = 4 INNER, 1 PALLET = 40 CARTON = 160 INNER.
  // L2 ladder: 1 CASE = 12 BOTTLE.
  unitFactors: { INNER: 1, CARTON: 4, PALLET: 160, BOTTLE: 1, CASE: 12 },
  tagline: 'Batch process manufacturing — OEE, quality and lot traceability',
  taglineAr: 'تصنيع بالدفعات — الكفاءة الكلية والجودة وتتبّع اللوطات',
  showcases: ['L1_CONNECTIVITY', 'L2_MES', 'L4_AI', 'DX'],

  areas: [
    { code: 'A-MAK', name: 'Making & Slurry', nameAr: 'التحضير والخلط', type: 'MAKING',
      description: 'Slurry preparation, spray drying and post-dosing' },
    { code: 'A-PCK', name: 'Powder Packing', nameAr: 'تعبئة المساحيق', type: 'PACKING' },
    { code: 'A-FIL', name: 'Liquid Filling', nameAr: 'تعبئة السوائل', type: 'FILLING' },
    { code: 'A-WHS', name: 'Warehouse', nameAr: 'المستودع', type: 'WAREHOUSE' },
    { code: 'A-UTL', name: 'Utilities', nameAr: 'المرافق', type: 'UTILITY' },
    { code: 'A-LAB', name: 'Quality Laboratory', nameAr: 'مختبر الجودة', type: 'LABORATORY' },
  ],

  lines: [
    { code: 'L1', name: 'Powder Packing Line 1', nameAr: 'خط تعبئة المساحيق ١',
      type: 'PACKING', areaCode: 'A-PCK', sortOrder: 1,
      oeeMethod: 'BOTTLENECK', bottleneckMachine: 'M3', outfeedMachines: ['M5'] },
    { code: 'L2', name: 'Liquid Filling Line 1', nameAr: 'خط تعبئة السوائل ١',
      type: 'FILLING', areaCode: 'A-FIL', sortOrder: 2,
      oeeMethod: 'BOTTLENECK', bottleneckMachine: 'M9', outfeedMachines: ['M9'] },
  ],

  machines: [
    // ── L1 Powder packing ────────────────────────────────────────────────
    { code: 'M1', name: 'Powder Filler', nameAr: 'ماكينة تعبئة المسحوق',
      type: 'FILLING_MACHINE', areaCode: 'A-PCK', lineCode: 'L1', sortOrder: 1,
      manufacturer: 'Volpak', model: 'SC-260', criticality: 'CRITICAL',
      designCapacity: 1800, idealCycleSeconds: 2.0, countUnit: 'INNER',
      downtimeThreshold: 60, installDate: '2021-03-14',
      metadata: { fillTargetGrams: 1000, tolerancePct: 1.5 } },
    { code: 'M2', name: 'Checkweigher', nameAr: 'ميزان المراقبة',
      type: 'CHECKWEIGHER', areaCode: 'A-PCK', lineCode: 'L1', sortOrder: 2,
      manufacturer: 'Ishida', model: 'DACS-G', criticality: 'HIGH',
      countUnit: 'INNER', downtimeThreshold: 60, installDate: '2021-03-14',
      metadata: { rejectsToLane: 'R1' } },
    { code: 'M3', name: 'Carton Packer', nameAr: 'ماكينة التعبئة الكرتونية',
      type: 'CARTONING_MACHINE', areaCode: 'A-PCK', lineCode: 'L1', sortOrder: 3,
      manufacturer: 'Marchesini', model: 'MC-820', criticality: 'CRITICAL',
      designCapacity: 300, idealCycleSeconds: 12.0, countUnit: 'CARTON',
      downtimeThreshold: 60, installDate: '2021-03-14',
      metadata: { note: 'Line constraint — 4 INNER per CARTON' } },
    { code: 'M4', name: 'Shrink Wrapper', nameAr: 'ماكينة التغليف الحراري',
      type: 'WRAPPING_MACHINE', areaCode: 'A-PCK', lineCode: 'L1', sortOrder: 4,
      manufacturer: 'Smipack', model: 'BP-800', criticality: 'HIGH',
      designCapacity: 360, idealCycleSeconds: 10.0, countUnit: 'CARTON',
      downtimeThreshold: 60, installDate: '2021-06-02' },
    { code: 'M5', name: 'Palletizer Robot', nameAr: 'روبوت التستيف',
      type: 'PALLETIZER', areaCode: 'A-PCK', lineCode: 'L1', sortOrder: 5,
      manufacturer: 'ABB', model: 'IRB-660', criticality: 'HIGH',
      designCapacity: 9, idealCycleSeconds: 400.0, countUnit: 'PALLET',
      downtimeThreshold: 90, installDate: '2021-06-02',
      metadata: { patternCartonsPerPallet: 40 } },

    // ── L2 Liquid filling ────────────────────────────────────────────────
    { code: 'M6', name: 'Liquid Filler', nameAr: 'ماكينة تعبئة السوائل',
      type: 'FILLING_MACHINE', areaCode: 'A-FIL', lineCode: 'L2', sortOrder: 1,
      manufacturer: 'Krones', model: 'Modulfill', criticality: 'CRITICAL',
      designCapacity: 3000, idealCycleSeconds: 1.2, countUnit: 'BOTTLE',
      downtimeThreshold: 60, installDate: '2022-01-20' },
    { code: 'M7', name: 'Capper', nameAr: 'ماكينة التغطية',
      type: 'MACHINE', areaCode: 'A-FIL', lineCode: 'L2', sortOrder: 2,
      manufacturer: 'Krones', model: 'Modulcap', criticality: 'HIGH',
      designCapacity: 3273, idealCycleSeconds: 1.1, countUnit: 'BOTTLE',
      downtimeThreshold: 60, installDate: '2022-01-20' },
    { code: 'M8', name: 'Labeller', nameAr: 'ماكينة اللصق',
      type: 'MACHINE', areaCode: 'A-FIL', lineCode: 'L2', sortOrder: 3,
      manufacturer: 'Sidel', model: 'Evolution', criticality: 'MEDIUM',
      designCapacity: 3130, idealCycleSeconds: 1.15, countUnit: 'BOTTLE',
      downtimeThreshold: 60, installDate: '2022-02-11' },
    { code: 'M9', name: 'Case Packer', nameAr: 'ماكينة التعبئة الصندوقية',
      type: 'CARTONING_MACHINE', areaCode: 'A-FIL', lineCode: 'L2', sortOrder: 4,
      manufacturer: 'Marchesini', model: 'MC-640', criticality: 'CRITICAL',
      designCapacity: 240, idealCycleSeconds: 15.0, countUnit: 'CASE',
      downtimeThreshold: 60, installDate: '2022-02-11',
      metadata: { note: 'L2 constraint — 12 BOTTLE per CASE' } },

    // ── Making area ──────────────────────────────────────────────────────
    { code: 'MX1', name: 'Slurry Mixer 1', nameAr: 'خلاط العجينة ١',
      type: 'MIXER', areaCode: 'A-MAK', sortOrder: 1,
      manufacturer: 'Ekato', model: 'Unimix', criticality: 'HIGH',
      downtimeThreshold: 120, installDate: '2020-11-05',
      metadata: { batchSizeKg: 8000 } },
    { code: 'SD1', name: 'Spray Dryer', nameAr: 'برج التجفيف',
      type: 'REACTOR', areaCode: 'A-MAK', sortOrder: 2,
      manufacturer: 'GEA', model: 'Tall-Form', criticality: 'CRITICAL',
      downtimeThreshold: 180, installDate: '2020-11-05' },

    // ── Utilities ────────────────────────────────────────────────────────
    { code: 'CMP1', name: 'Air Compressor 1', nameAr: 'ضاغط الهواء ١',
      type: 'COMPRESSOR', areaCode: 'A-UTL', sortOrder: 1,
      manufacturer: 'Atlas Copco', model: 'GA-90', criticality: 'CRITICAL',
      downtimeThreshold: 120, installDate: '2020-09-18',
      metadata: { ratedKw: 90, pressureBar: 7.5 } },
    { code: 'CHL1', name: 'Chiller 1', nameAr: 'المبرّد ١',
      type: 'CHILLER', areaCode: 'A-UTL', sortOrder: 2,
      manufacturer: 'Carrier', model: '30XA-802', criticality: 'HIGH',
      downtimeThreshold: 120, installDate: '2020-09-18',
      metadata: { ratedKw: 260 } },
    { code: 'BLR1', name: 'Steam Boiler', nameAr: 'مرجل البخار',
      type: 'BOILER', areaCode: 'A-UTL', sortOrder: 3,
      manufacturer: 'Bosch', model: 'UL-S', criticality: 'HIGH',
      downtimeThreshold: 180, installDate: '2020-09-18' },
  ],

  shifts: [
    { code: 'A', name: 'Shift A — Morning', nameAr: 'وردية أ — صباحية',
      startTime: '06:00', endTime: '14:00', crossesMidnight: false,
      shiftDurationHours: 8, plannedProductionHours: 7.0,
      breakMinutes: 45, cleaningMinutes: 15, days: [0, 1, 2, 3, 4],
      targetQtyPerShift: 2000, targetUnit: 'CARTON', efficiencyFactor: 1.0 },
    { code: 'B', name: 'Shift B — Evening', nameAr: 'وردية ب — مسائية',
      startTime: '14:00', endTime: '22:00', crossesMidnight: false,
      shiftDurationHours: 8, plannedProductionHours: 7.0,
      breakMinutes: 45, cleaningMinutes: 15, days: [0, 1, 2, 3, 4],
      targetQtyPerShift: 1950, targetUnit: 'CARTON', efficiencyFactor: 0.97 },
    { code: 'C', name: 'Shift C — Night', nameAr: 'وردية ج — ليلية',
      startTime: '22:00', endTime: '06:00', crossesMidnight: true,
      shiftDurationHours: 8, plannedProductionHours: 6.75,
      breakMinutes: 45, cleaningMinutes: 30, days: [0, 1, 2, 3, 4],
      targetQtyPerShift: 1750, targetUnit: 'CARTON', efficiencyFactor: 0.91 },
  ],

  // 3-level tree: Category (L1) → Sub-category (L2) → Specific reason (L3).
  // Only level-3 leaves are selectable by an operator; the levels above group
  // them for the Pareto and the OEE loss breakdown.
  downtimeCauses: [
    { code: 'L1-MECH', name: 'Mechanical', nameAr: 'ميكانيكي', category: 'MECHANICAL', isPlanned: false, level: 1 },
    { code: 'L2-MECH-JAM', name: 'Jams & blockages', nameAr: 'انحشار وانسداد', category: 'MECHANICAL', isPlanned: false, level: 2, parent: 'L1-MECH' },
    { code: 'MECH-CARTON-JAM', name: 'Carton jam at magazine', nameAr: 'انحشار كرتون في المخزن', category: 'MECHANICAL', isPlanned: false, level: 3, parent: 'L2-MECH-JAM', weight: 22, durationRange: [3, 14] },
    { code: 'MECH-FILM-BREAK', name: 'Shrink film break', nameAr: 'قطع فيلم التغليف', category: 'MECHANICAL', isPlanned: false, level: 3, parent: 'L2-MECH-JAM', weight: 11, durationRange: [4, 18] },
    { code: 'MECH-CONV-JAM', name: 'Conveyor blockage', nameAr: 'انسداد الناقل', category: 'MECHANICAL', isPlanned: false, level: 3, parent: 'L2-MECH-JAM', weight: 9, durationRange: [2, 9] },
    { code: 'L2-MECH-WEAR', name: 'Wear & breakage', nameAr: 'تآكل وكسر', category: 'MECHANICAL', isPlanned: false, level: 2, parent: 'L1-MECH' },
    { code: 'MECH-BELT', name: 'Belt replacement', nameAr: 'استبدال سير', category: 'MECHANICAL', isPlanned: false, level: 3, parent: 'L2-MECH-WEAR', weight: 5, durationRange: [20, 65] },
    { code: 'MECH-BEARING', name: 'Bearing failure', nameAr: 'عطل محمل', category: 'MECHANICAL', isPlanned: false, level: 3, parent: 'L2-MECH-WEAR', weight: 3, durationRange: [45, 180] },

    { code: 'L1-ELEC', name: 'Electrical', nameAr: 'كهربائي', category: 'ELECTRICAL', isPlanned: false, level: 1 },
    { code: 'L2-ELEC-SENS', name: 'Sensors & drives', nameAr: 'حسّاسات ومشغّلات', category: 'ELECTRICAL', isPlanned: false, level: 2, parent: 'L1-ELEC' },
    { code: 'ELEC-SENSOR', name: 'Photocell fault', nameAr: 'عطل خلية ضوئية', category: 'ELECTRICAL', isPlanned: false, level: 3, parent: 'L2-ELEC-SENS', weight: 8, durationRange: [5, 25] },
    { code: 'ELEC-VFD', name: 'VFD trip', nameAr: 'فصل محوّل التردد', category: 'ELECTRICAL', isPlanned: false, level: 3, parent: 'L2-ELEC-SENS', weight: 4, durationRange: [10, 45] },
    { code: 'ELEC-ESTOP', name: 'Emergency stop activated', nameAr: 'تفعيل إيقاف الطوارئ', category: 'ELECTRICAL', isPlanned: false, level: 3, parent: 'L2-ELEC-SENS', weight: 3, durationRange: [1, 8] },

    { code: 'L1-MAT', name: 'Material', nameAr: 'مواد', category: 'MATERIAL', isPlanned: false, level: 1 },
    { code: 'L2-MAT-SUP', name: 'Supply', nameAr: 'التوريد', category: 'MATERIAL', isPlanned: false, level: 2, parent: 'L1-MAT' },
    { code: 'MAT-NO-CARTON', name: 'Carton blanks starved', nameAr: 'نفاد الكرتون', category: 'MATERIAL', isPlanned: false, level: 3, parent: 'L2-MAT-SUP', weight: 10, durationRange: [5, 30] },
    { code: 'MAT-NO-POWDER', name: 'Powder supply starved', nameAr: 'نفاد المسحوق', category: 'MATERIAL', isPlanned: false, level: 3, parent: 'L2-MAT-SUP', weight: 6, durationRange: [8, 40] },
    { code: 'MAT-NO-FILM', name: 'Film roll change', nameAr: 'تغيير بكرة الفيلم', category: 'MATERIAL', isPlanned: false, level: 3, parent: 'L2-MAT-SUP', weight: 7, durationRange: [4, 12] },

    { code: 'L1-CHG', name: 'Changeover', nameAr: 'تغيير الإنتاج', category: 'CHANGEOVER', isPlanned: true, level: 1 },
    { code: 'L2-CHG-SKU', name: 'Product change', nameAr: 'تغيير المنتج', category: 'CHANGEOVER', isPlanned: true, level: 2, parent: 'L1-CHG' },
    { code: 'CHG-SKU', name: 'SKU changeover', nameAr: 'تغيير الصنف', category: 'CHANGEOVER', isPlanned: true, level: 3, parent: 'L2-CHG-SKU', weight: 6, durationRange: [25, 70] },
    { code: 'CHG-SIZE', name: 'Pack size change', nameAr: 'تغيير حجم العبوة', category: 'CHANGEOVER', isPlanned: true, level: 3, parent: 'L2-CHG-SKU', weight: 3, durationRange: [40, 95] },

    { code: 'L1-PLN', name: 'Planned', nameAr: 'مخطط', category: 'PLANNED_MAINTENANCE', isPlanned: true, level: 1 },
    { code: 'L2-PLN-PM', name: 'Preventive maintenance', nameAr: 'صيانة وقائية', category: 'PLANNED_MAINTENANCE', isPlanned: true, level: 2, parent: 'L1-PLN' },
    { code: 'PLN-PM', name: 'Scheduled PM window', nameAr: 'نافذة صيانة مجدولة', category: 'PLANNED_MAINTENANCE', isPlanned: true, level: 3, parent: 'L2-PLN-PM', weight: 4, durationRange: [60, 180] },
    { code: 'L2-PLN-CLN', name: 'Cleaning', nameAr: 'تنظيف', category: 'PLANNED_CLEANING', isPlanned: true, level: 2, parent: 'L1-PLN' },
    { code: 'PLN-CIP', name: 'Line cleaning', nameAr: 'تنظيف الخط', category: 'PLANNED_CLEANING', isPlanned: true, level: 3, parent: 'L2-PLN-CLN', weight: 5, durationRange: [15, 40] },
    { code: 'L2-PLN-BRK', name: 'Breaks', nameAr: 'استراحات', category: 'PLANNED_BREAK', isPlanned: true, level: 2, parent: 'L1-PLN' },
    { code: 'PLN-BREAK', name: 'Operator break', nameAr: 'استراحة المشغّل', category: 'PLANNED_BREAK', isPlanned: true, level: 3, parent: 'L2-PLN-BRK', weight: 8, durationRange: [15, 45] },

    { code: 'L1-QUA', name: 'Quality', nameAr: 'الجودة', category: 'QUALITY', isPlanned: false, level: 1 },
    { code: 'L2-QUA-HOLD', name: 'Quality hold', nameAr: 'إيقاف للجودة', category: 'QUALITY', isPlanned: false, level: 2, parent: 'L1-QUA' },
    { code: 'QUA-WEIGHT', name: 'Fill weight out of spec', nameAr: 'وزن التعبئة خارج المواصفة', category: 'QUALITY', isPlanned: false, level: 3, parent: 'L2-QUA-HOLD', weight: 6, durationRange: [10, 35] },
    { code: 'QUA-SEAL', name: 'Seal integrity check', nameAr: 'فحص سلامة اللحام', category: 'QUALITY', isPlanned: false, level: 3, parent: 'L2-QUA-HOLD', weight: 4, durationRange: [8, 20] },

    { code: 'L1-UTL', name: 'Utility', nameAr: 'المرافق', category: 'UTILITY', isPlanned: false, level: 1 },
    { code: 'L2-UTL-AIR', name: 'Air & power', nameAr: 'الهواء والطاقة', category: 'UTILITY', isPlanned: false, level: 2, parent: 'L1-UTL' },
    { code: 'UTL-AIR', name: 'Compressed air pressure low', nameAr: 'انخفاض ضغط الهواء', category: 'UTILITY', isPlanned: false, level: 3, parent: 'L2-UTL-AIR', weight: 3, durationRange: [6, 30] },
    { code: 'UTL-POWER', name: 'Power dip', nameAr: 'هبوط في الجهد', category: 'UTILITY', isPlanned: false, level: 3, parent: 'L2-UTL-AIR', weight: 2, durationRange: [3, 15] },
  ],

  products: [
    { code: 'NPD-1000', name: 'Nahdah Ultra Powder 1 kg', nameAr: 'نهضة ألترا مسحوق ١ كجم',
      category: 'Laundry Powder', brand: 'Nahdah Ultra', baseUnit: 'INNER',
      packagingLadder: [{ unit: 'INNER', perParent: 1 }, { unit: 'CARTON', perParent: 4 }, { unit: 'PALLET', perParent: 40 }],
      netWeightGrams: 1000, isActive: true },
    { code: 'NPD-2500', name: 'Nahdah Ultra Powder 2.5 kg', nameAr: 'نهضة ألترا مسحوق ٢٫٥ كجم',
      category: 'Laundry Powder', brand: 'Nahdah Ultra', baseUnit: 'INNER',
      packagingLadder: [{ unit: 'INNER', perParent: 1 }, { unit: 'CARTON', perParent: 4 }, { unit: 'PALLET', perParent: 30 }],
      netWeightGrams: 2500, isActive: true },
    { code: 'NPD-SFT-500', name: 'Nahdah Softener 500 ml', nameAr: 'نهضة منعّم ٥٠٠ مل',
      category: 'Fabric Softener', brand: 'Nahdah Care', baseUnit: 'BOTTLE',
      packagingLadder: [{ unit: 'BOTTLE', perParent: 1 }, { unit: 'CASE', perParent: 12 }, { unit: 'PALLET', perParent: 84 }],
      netWeightGrams: 500, isActive: true },
    { code: 'NPD-DSH-750', name: 'Nahdah Dish Liquid 750 ml', nameAr: 'نهضة سائل جلي ٧٥٠ مل',
      category: 'Dishwashing', brand: 'Nahdah Care', baseUnit: 'BOTTLE',
      packagingLadder: [{ unit: 'BOTTLE', perParent: 1 }, { unit: 'CASE', perParent: 12 }, { unit: 'PALLET', perParent: 84 }],
      netWeightGrams: 750, isActive: true },
  ],

  materials: [
    { code: 'RM-LAS', name: 'Linear Alkylbenzene Sulphonate', nameAr: 'حمض السلفونيك الخطي', type: 'RAW', unit: 'KG', criticalStock: 12000 },
    { code: 'RM-STPP', name: 'Sodium Tripolyphosphate', nameAr: 'ثلاثي بولي فوسفات الصوديوم', type: 'RAW', unit: 'KG', criticalStock: 9000 },
    { code: 'RM-SS', name: 'Sodium Sulphate', nameAr: 'كبريتات الصوديوم', type: 'RAW', unit: 'KG', criticalStock: 20000 },
    { code: 'RM-ENZ', name: 'Enzyme Blend', nameAr: 'خليط الإنزيمات', type: 'RAW', unit: 'KG', shelfLifeDays: 365, criticalStock: 400 },
    { code: 'RM-PRF', name: 'Fragrance Compound', nameAr: 'مركّب العطر', type: 'RAW', unit: 'KG', shelfLifeDays: 540, criticalStock: 250 },
    { code: 'PK-BAG', name: 'Printed Laminate Bag', nameAr: 'كيس مطبوع', type: 'PACKAGING', unit: 'PCS', criticalStock: 60000 },
    { code: 'PK-CTN', name: 'Carton Blank', nameAr: 'كرتون مسطّح', type: 'PACKAGING', unit: 'PCS', criticalStock: 25000 },
    { code: 'PK-FILM', name: 'Shrink Film Roll', nameAr: 'بكرة فيلم انكماش', type: 'PACKAGING', unit: 'ROLL', criticalStock: 60 },
    { code: 'PK-PAL', name: 'Wooden Pallet', nameAr: 'منصّة خشبية', type: 'PACKAGING', unit: 'PCS', criticalStock: 300 },
    { code: 'PK-BTL', name: 'HDPE Bottle 500 ml', nameAr: 'عبوة بلاستيك ٥٠٠ مل', type: 'PACKAGING', unit: 'PCS', criticalStock: 45000 },
    { code: 'PK-CAP', name: 'Screw Cap', nameAr: 'غطاء لولبي', type: 'PACKAGING', unit: 'PCS', criticalStock: 50000 },
    { code: 'PK-LBL', name: 'Wrap-around Label', nameAr: 'ملصق لاصق', type: 'PACKAGING', unit: 'PCS', criticalStock: 50000 },
  ],

  routing: [
    { sequence: 1, code: 'RS-FILL', name: 'Filling & Weighing', nameAr: 'التعبئة والوزن',
      machines: ['M1'], idealCycleSeconds: 2.0, consumes: ['RM-LAS', 'RM-STPP', 'RM-SS', 'RM-ENZ', 'RM-PRF', 'PK-BAG'], tests: ['QS-FILLWT'] },
    { sequence: 2, code: 'RS-CHECK', name: 'Check Weighing', nameAr: 'المراجعة الوزنية',
      machines: ['M2'], idealCycleSeconds: 2.0, tests: ['QS-FILLWT'] },
    { sequence: 3, code: 'RS-CART', name: 'Cartoning', nameAr: 'التعبئة الكرتونية',
      machines: ['M3'], idealCycleSeconds: 12.0, consumes: ['PK-CTN'], tests: ['QS-SEAL'] },
    { sequence: 4, code: 'RS-WRAP', name: 'Shrink Wrapping', nameAr: 'التغليف الحراري',
      machines: ['M4'], idealCycleSeconds: 10.0, consumes: ['PK-FILM'] },
    { sequence: 5, code: 'RS-PAL', name: 'Palletizing', nameAr: 'التستيف',
      machines: ['M5'], idealCycleSeconds: 400.0, consumes: ['PK-PAL'] },
  ],

  qualitySpecs: [
    { code: 'QS-FILLWT', name: 'Fill weight', nameAr: 'وزن التعبئة', stepCode: 'RS-FILL',
      unit: 'g', lsl: 985, usl: 1015, target: 1000, sampleRate: 1.0, baselinePassRate: 0.982 },
    { code: 'QS-SEAL', name: 'Seal integrity', nameAr: 'سلامة اللحام', stepCode: 'RS-CART',
      unit: 'N', lsl: 12, target: 18, sampleRate: 0.05, baselinePassRate: 0.994 },
    { code: 'QS-MOIST', name: 'Moisture content', nameAr: 'نسبة الرطوبة', stepCode: 'RS-FILL',
      unit: '%', usl: 3.5, target: 2.2, sampleRate: 0.02, baselinePassRate: 0.988 },
    { code: 'QS-BULK', name: 'Bulk density', nameAr: 'الكثافة الظاهرية', stepCode: 'RS-FILL',
      unit: 'g/L', lsl: 380, usl: 460, target: 420, sampleRate: 0.02, baselinePassRate: 0.991 },
  ],

  scrapCodes: [
    { code: 'SC-UNDERWT', name: 'Underweight pack', nameAr: 'عبوة ناقصة الوزن', stepCode: 'RS-FILL', weight: 28 },
    { code: 'SC-OVERWT', name: 'Overweight pack', nameAr: 'عبوة زائدة الوزن', stepCode: 'RS-FILL', weight: 14 },
    { code: 'SC-SEAL', name: 'Seal defect', nameAr: 'عيب في اللحام', stepCode: 'RS-CART', weight: 21 },
    { code: 'SC-PRINT', name: 'Print / date code illegible', nameAr: 'طباعة غير واضحة', stepCode: 'RS-CART', weight: 12 },
    { code: 'SC-CRUSH', name: 'Crushed carton', nameAr: 'كرتون مهروس', stepCode: 'RS-WRAP', weight: 15 },
    { code: 'SC-FILM', name: 'Film wrinkle', nameAr: 'تجعّد الفيلم', stepCode: 'RS-WRAP', weight: 10 },
  ],

  devices: [
    { code: 'EC-NPDF-01', name: 'Edge Counter — L1 Filling', protocol: 'MODBUS_TCP', port: 5021,
      unitId: 1, areaCode: 'A-PCK', lineCode: 'L1', pollMs: 100, tags: [
      { code: 'M1.STATUS', name: 'M1 Running', role: 'STATUS', ownerCode: 'M1', address: 0, dataType: 'BOOL', pollMs: 100 },
      { code: 'M1.TOTAL', name: 'M1 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M1', address: 1, dataType: 'BOOL', unit: 'INNER', pollMs: 100 },
      { code: 'M1.GOOD', name: 'M1 Good count', role: 'COUNTER_GOOD', ownerCode: 'M1', address: 2, dataType: 'BOOL', unit: 'INNER', pollMs: 100 },
      { code: 'M1.FILLWT', name: 'M1 Fill weight', role: 'PROCESS', ownerCode: 'M1', address: 100, dataType: 'FLOAT32', unit: 'g', scale: 1, pollMs: 1000, range: [960, 1040] },
      { code: 'M2.STATUS', name: 'M2 Running', role: 'STATUS', ownerCode: 'M2', address: 3, dataType: 'BOOL', pollMs: 100 },
      { code: 'M2.REJECT', name: 'M2 Reject count', role: 'COUNTER_REJECT', ownerCode: 'M2', address: 4, dataType: 'BOOL', unit: 'INNER', pollMs: 100 },
    ] },
    { code: 'EC-NPDF-02', name: 'Edge Counter — L1 Packing', protocol: 'MODBUS_TCP', port: 5022,
      unitId: 1, areaCode: 'A-PCK', lineCode: 'L1', pollMs: 100, tags: [
      { code: 'M3.STATUS', name: 'M3 Running', role: 'STATUS', ownerCode: 'M3', address: 0, dataType: 'BOOL', pollMs: 100 },
      { code: 'M3.TOTAL', name: 'M3 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M3', address: 1, dataType: 'BOOL', unit: 'CARTON', pollMs: 100 },
      { code: 'M3.GOOD', name: 'M3 Good count', role: 'COUNTER_GOOD', ownerCode: 'M3', address: 2, dataType: 'BOOL', unit: 'CARTON', pollMs: 100 },
      { code: 'M4.STATUS', name: 'M4 Running', role: 'STATUS', ownerCode: 'M4', address: 3, dataType: 'BOOL', pollMs: 100 },
      { code: 'M4.TOTAL', name: 'M4 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M4', address: 4, dataType: 'BOOL', unit: 'CARTON', pollMs: 100 },
      { code: 'M4.GOOD', name: 'M4 Good count', role: 'COUNTER_GOOD', ownerCode: 'M4', address: 5, dataType: 'BOOL', unit: 'CARTON', pollMs: 100 },
      { code: 'M4.SEALTEMP', name: 'M4 Seal bar temperature', role: 'PROCESS', ownerCode: 'M4', address: 102, dataType: 'FLOAT32', unit: '°C', pollMs: 1000, range: [140, 200] },
      { code: 'M5.STATUS', name: 'M5 Running', role: 'STATUS', ownerCode: 'M5', address: 6, dataType: 'BOOL', pollMs: 100 },
      { code: 'M5.TOTAL', name: 'M5 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M5', address: 7, dataType: 'BOOL', unit: 'PALLET', pollMs: 100 },
      { code: 'M5.GOOD', name: 'M5 Good count', role: 'COUNTER_GOOD', ownerCode: 'M5', address: 8, dataType: 'BOOL', unit: 'PALLET', pollMs: 100 },
    ] },
    { code: 'EC-NPDF-03', name: 'Edge Counter — L2 Liquids', protocol: 'MODBUS_TCP', port: 5023,
      unitId: 1, areaCode: 'A-FIL', lineCode: 'L2', pollMs: 100, tags: [
      { code: 'M6.STATUS', name: 'M6 Running', role: 'STATUS', ownerCode: 'M6', address: 0, dataType: 'BOOL', pollMs: 100 },
      { code: 'M6.TOTAL', name: 'M6 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M6', address: 1, dataType: 'BOOL', unit: 'BOTTLE', pollMs: 100 },
      { code: 'M6.GOOD', name: 'M6 Good count', role: 'COUNTER_GOOD', ownerCode: 'M6', address: 2, dataType: 'BOOL', unit: 'BOTTLE', pollMs: 100 },
      { code: 'M7.STATUS', name: 'M7 Running', role: 'STATUS', ownerCode: 'M7', address: 3, dataType: 'BOOL', pollMs: 100 },
      { code: 'M7.TOTAL', name: 'M7 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M7', address: 4, dataType: 'BOOL', unit: 'BOTTLE', pollMs: 100 },
      { code: 'M7.GOOD', name: 'M7 Good count', role: 'COUNTER_GOOD', ownerCode: 'M7', address: 5, dataType: 'BOOL', unit: 'BOTTLE', pollMs: 100 },
      { code: 'M8.STATUS', name: 'M8 Running', role: 'STATUS', ownerCode: 'M8', address: 6, dataType: 'BOOL', pollMs: 100 },
      { code: 'M8.TOTAL', name: 'M8 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M8', address: 7, dataType: 'BOOL', unit: 'BOTTLE', pollMs: 100 },
      { code: 'M8.GOOD', name: 'M8 Good count', role: 'COUNTER_GOOD', ownerCode: 'M8', address: 8, dataType: 'BOOL', unit: 'BOTTLE', pollMs: 100 },
      { code: 'M9.STATUS', name: 'M9 Running', role: 'STATUS', ownerCode: 'M9', address: 9, dataType: 'BOOL', pollMs: 100 },
      { code: 'M9.TOTAL', name: 'M9 Total count', role: 'COUNTER_TOTAL', ownerCode: 'M9', address: 10, dataType: 'BOOL', unit: 'CASE', pollMs: 100 },
      { code: 'M9.GOOD', name: 'M9 Good count', role: 'COUNTER_GOOD', ownerCode: 'M9', address: 11, dataType: 'BOOL', unit: 'CASE', pollMs: 100 },
      { code: 'M6.FILLVOL', name: 'M6 Fill volume', role: 'PROCESS', ownerCode: 'M6', address: 104, dataType: 'FLOAT32', unit: 'ml', pollMs: 1000, range: [480, 520] },
    ] },
    { code: 'PM-NPDF-L1', name: 'Power Meter — Line 1', protocol: 'MODBUS_TCP', port: 5024,
      unitId: 1, areaCode: 'A-PCK', lineCode: 'L1', pollMs: 5000, tags: [
      { code: 'EM-L1.KW', name: 'L1 Active power', role: 'ENERGY', ownerCode: 'EM-L1', address: 3000, dataType: 'FLOAT32', unit: 'kW', pollMs: 5000, range: [0, 180] },
      { code: 'EM-L1.KWH', name: 'L1 Energy total', role: 'ENERGY', ownerCode: 'EM-L1', address: 3002, dataType: 'FLOAT32', unit: 'kWh', pollMs: 5000 },
      { code: 'EM-L1.PF', name: 'L1 Power factor', role: 'ENERGY', ownerCode: 'EM-L1', address: 3004, dataType: 'FLOAT32', unit: '', pollMs: 5000, range: [0.7, 1.0] },
      { code: 'EM-L1.V', name: 'L1 Voltage L-L', role: 'ENERGY', ownerCode: 'EM-L1', address: 3006, dataType: 'FLOAT32', unit: 'V', pollMs: 5000, range: [380, 415] },
      { code: 'EM-L1.A', name: 'L1 Current', role: 'ENERGY', ownerCode: 'EM-L1', address: 3008, dataType: 'FLOAT32', unit: 'A', pollMs: 5000, range: [0, 320] },
    ] },
    { code: 'PM-NPDF-UTL', name: 'Power Meter — Utilities', protocol: 'MODBUS_TCP', port: 5025,
      unitId: 1, areaCode: 'A-UTL', pollMs: 5000, tags: [
      { code: 'EM-UTL.KW', name: 'Utilities active power', role: 'ENERGY', ownerCode: 'EM-UTL', address: 3000, dataType: 'FLOAT32', unit: 'kW', pollMs: 5000, range: [0, 450] },
      { code: 'EM-UTL.KWH', name: 'Utilities energy total', role: 'ENERGY', ownerCode: 'EM-UTL', address: 3002, dataType: 'FLOAT32', unit: 'kWh', pollMs: 5000 },
      { code: 'CMP1.PRESS', name: 'Compressed air pressure', role: 'PROCESS', ownerCode: 'CMP1', address: 200, dataType: 'FLOAT32', unit: 'bar', pollMs: 2000, range: [5.5, 8.5] },
      { code: 'CHL1.TEMP', name: 'Chilled water supply temp', role: 'PROCESS', ownerCode: 'CHL1', address: 202, dataType: 'FLOAT32', unit: '°C', pollMs: 2000, range: [4, 14] },
    ] },
  ],

  gateways: [
    { code: 'GW-NPDF-01', name: 'NPDF Edge Gateway — Packing Hall', location: 'Packing hall MCC room',
      devices: ['EC-NPDF-01', 'EC-NPDF-02', 'PM-NPDF-L1'] },
    { code: 'GW-NPDF-02', name: 'NPDF Edge Gateway — Filling & Utilities', location: 'Utilities substation',
      devices: ['EC-NPDF-03', 'PM-NPDF-UTL'] },
  ],

  energyMeters: [
    { code: 'EM-L1', meterNumber: 'NPDF-EM-001', name: 'Powder Packing Line 1', nameAr: 'خط تعبئة المساحيق ١',
      type: 'ELECTRICAL', unit: 'kWh', lineCode: 'L1', manufacturer: 'Schneider', model: 'PM5110', baselineKw: 118 },
    { code: 'EM-L2', meterNumber: 'NPDF-EM-002', name: 'Liquid Filling Line 1', nameAr: 'خط تعبئة السوائل ١',
      type: 'ELECTRICAL', unit: 'kWh', lineCode: 'L2', manufacturer: 'Schneider', model: 'PM5110', baselineKw: 74 },
    { code: 'EM-UTL', meterNumber: 'NPDF-EM-003', name: 'Utilities', nameAr: 'المرافق',
      type: 'ELECTRICAL', unit: 'kWh', areaCode: 'A-UTL', manufacturer: 'Siemens', model: 'PAC3200', baselineKw: 305 },
    { code: 'EM-MAK', meterNumber: 'NPDF-EM-004', name: 'Making & Spray Drying', nameAr: 'التحضير والتجفيف',
      type: 'ELECTRICAL', unit: 'kWh', areaCode: 'A-MAK', manufacturer: 'Siemens', model: 'PAC3200', baselineKw: 412 },
    { code: 'GM-BLR', meterNumber: 'NPDF-GM-001', name: 'Boiler Gas', nameAr: 'غاز المرجل',
      type: 'NATURAL_GAS', unit: 'm3', machineCode: 'BLR1', manufacturer: 'Elster', model: 'RVG-G65' },
    { code: 'WM-MAIN', meterNumber: 'NPDF-WM-001', name: 'Process Water', nameAr: 'مياه العمليات',
      type: 'WATER', unit: 'm3', areaCode: 'A-MAK', manufacturer: 'Itron', model: 'Woltex' },
  ],

  alarmRules: [
    { code: 'AL-FILLWT-HI', name: 'Fill weight above upper limit', nameAr: 'وزن التعبئة فوق الحد الأعلى',
      tagCode: 'M1.FILLWT', condition: 'GT', threshold: 1015, severity: 'WARNING', delaySeconds: 10, hysteresis: 3 },
    { code: 'AL-FILLWT-LO', name: 'Fill weight below lower limit', nameAr: 'وزن التعبئة تحت الحد الأدنى',
      tagCode: 'M1.FILLWT', condition: 'LT', threshold: 985, severity: 'CRITICAL', delaySeconds: 10, hysteresis: 3 },
    { code: 'AL-SEALTEMP-LO', name: 'Seal bar temperature low', nameAr: 'انخفاض حرارة قضيب اللحام',
      tagCode: 'M4.SEALTEMP', condition: 'LT', threshold: 150, severity: 'WARNING', delaySeconds: 30, hysteresis: 5 },
    { code: 'AL-AIR-LO', name: 'Compressed air pressure low', nameAr: 'انخفاض ضغط الهواء المضغوط',
      tagCode: 'CMP1.PRESS', condition: 'LT', threshold: 6.2, severity: 'CRITICAL', delaySeconds: 20, hysteresis: 0.3 },
    { code: 'AL-CHW-HI', name: 'Chilled water supply temperature high', nameAr: 'ارتفاع حرارة الماء المبرّد',
      tagCode: 'CHL1.TEMP', condition: 'GT', threshold: 11, severity: 'WARNING', delaySeconds: 60, hysteresis: 1 },
    { code: 'AL-L1-PF-LO', name: 'Line 1 power factor low', nameAr: 'انخفاض معامل القدرة للخط ١',
      tagCode: 'EM-L1.PF', condition: 'LT', threshold: 0.9, severity: 'WARNING', delaySeconds: 300, hysteresis: 0.02 },
  ],
};
