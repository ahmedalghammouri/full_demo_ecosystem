/**
 * Registry of entities that support soft-archive (archive / restore) via the
 * generic ArchiveController. Each entry maps a URL slug to its Prisma delegate
 * name (key on PrismaService), a human label, the fields used to build a
 * display label, and the fields searched when browsing the archive.
 *
 * Only first-class ENTITY tables are listed here — never event / ledger / audit
 * tables (stock movements, production_events, audit logs, SPC, trace events),
 * where archive/restore has no meaning and would break integrity.
 */
export interface ArchiveEntityDef {
  slug: string;
  delegate: string;       // PrismaService property (e.g. 'workOrder')
  label: string;          // plural human label
  primaryField: string;   // code/number shown as the title
  secondaryField?: string;// title/name shown as the subtitle
  searchFields: string[];
  /** Whether the model is factory-scoped (filter by factoryId). */
  factoryScoped: boolean;
}

export const ARCHIVE_ENTITIES: Record<string, ArchiveEntityDef> = {
  'work-orders':       { slug: 'work-orders',       delegate: 'workOrder',        label: 'Work Orders',        primaryField: 'orderNumber',     secondaryField: 'status',     searchFields: ['orderNumber'],                 factoryScoped: true },
  'production-orders': { slug: 'production-orders', delegate: 'productionOrder',  label: 'Production Orders',  primaryField: 'orderNumber',     secondaryField: 'status',     searchFields: ['orderNumber'],                 factoryScoped: true },
  'ncrs':              { slug: 'ncrs',              delegate: 'nCR',              label: 'NCRs',               primaryField: 'ncrNumber',       secondaryField: 'title',      searchFields: ['ncrNumber', 'title'],          factoryScoped: true },
  'capas':             { slug: 'capas',             delegate: 'cAPA',             label: 'CAPAs',              primaryField: 'capaNumber',      secondaryField: 'title',      searchFields: ['capaNumber', 'title'],         factoryScoped: true },
  'inspections':       { slug: 'inspections',       delegate: 'inspectionResult', label: 'Inspections',        primaryField: 'inspectionNumber',secondaryField: 'type',       searchFields: ['inspectionNumber'],            factoryScoped: true },
  'raw-materials':     { slug: 'raw-materials',     delegate: 'rawMaterial',      label: 'Raw Materials',      primaryField: 'code',            secondaryField: 'name',       searchFields: ['code', 'name'],                factoryScoped: true },
  'spare-parts':       { slug: 'spare-parts',       delegate: 'sparePart',        label: 'Spare Parts',        primaryField: 'partNumber',      secondaryField: 'name',       searchFields: ['partNumber', 'name'],          factoryScoped: true },
  'products':          { slug: 'products',          delegate: 'sKU',              label: 'Products / SKUs',    primaryField: 'code',            secondaryField: 'name',       searchFields: ['code', 'name'],                factoryScoped: true },
  'machines':          { slug: 'machines',          delegate: 'machine',          label: 'Machines',           primaryField: 'code',            secondaryField: 'name',       searchFields: ['code', 'name'],                factoryScoped: true },
  'maintenance-orders':{ slug: 'maintenance-orders',delegate: 'maintenanceWO',    label: 'Maintenance Orders', primaryField: 'woNumber',        secondaryField: 'title',      searchFields: ['woNumber', 'title'],           factoryScoped: true },
  'material-lots':     { slug: 'material-lots',     delegate: 'materialLot',      label: 'Material Lots',      primaryField: 'lotNumber',       secondaryField: 'status',     searchFields: ['lotNumber'],                   factoryScoped: true },
  'quality-plans':     { slug: 'quality-plans',     delegate: 'qualityPlan',      label: 'Quality Plans',      primaryField: 'code',            secondaryField: 'name',       searchFields: ['code', 'name'],                factoryScoped: true },
  'pm-plans':          { slug: 'pm-plans',          delegate: 'pMPlan',           label: 'PM Plans',           primaryField: 'code',            secondaryField: 'name',       searchFields: ['code', 'name'],                factoryScoped: true },
};

export function resolveArchiveEntity(slug: string): ArchiveEntityDef | undefined {
  return ARCHIVE_ENTITIES[slug];
}
