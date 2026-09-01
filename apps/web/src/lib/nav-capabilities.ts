/**
 * Route → capability gating for the web client.
 *
 * Permissions answer "may this person see it". Capabilities answer a different
 * question: "does this factory have it at all". A quality engineer at the
 * detergent plant has every permission the vision-inspection screen needs, and
 * that plant still has no vision station — so the screen must not be offered.
 *
 * The two filters compose. A nav item survives only if the signed-in user is
 * allowed it AND the selected factory actually has the module behind it.
 *
 * The capability list itself is not decided here. It is computed once in the
 * plant model from the factory's classification, written onto the factory row
 * by the seeder, and returned with the factory by the API. This file only
 * decides which route each capability unlocks — and it has to agree with
 * `CAPABILITY_ROUTES` in `apps/api/prisma/plant/plant-model.ts`, which is the
 * source both sides derive from.
 */

export type FactoryCapability =
  | 'OEE' | 'DOWNTIME' | 'QUALITY' | 'MAINTENANCE' | 'SCHEDULING' | 'ENERGY_METERING'
  | 'SERIAL_GENEALOGY' | 'DIGITAL_TWIN' | 'VISION_INSPECTION' | 'MATERIAL_BATCH_TRACE'
  | 'LOT_GENEALOGY' | 'RECIPE_BATCH' | 'INVENTORY' | 'PLM'
  | 'POWER_QUALITY' | 'HARMONICS' | 'POWER_FACTOR' | 'SINGLE_LINE_DIAGRAM'
  | 'ENERGY_BASELINE' | 'COST_ALLOCATION' | 'SUSTAINABILITY' | 'PREDICTIVE_ASSETS'
  | 'ENVIRONMENT';

export type FactoryType = 'PROCESS_FMCG' | 'DISCRETE_ASSEMBLY' | 'CONTINUOUS_PROCESS';

/**
 * Routes that exist only when the factory declares the capability.
 *
 * Longest-prefix wins, same rule as the permission map. A route absent from
 * this table is available at every site — the shared MES core, administration,
 * the ecosystem home. Only the specialised modules appear here.
 */
const ROUTE_CAPABILITIES: Record<string, FactoryCapability> = {
  // Discrete serialised — the composite-cylinder story
  '/twin': 'DIGITAL_TWIN',
  '/vision': 'VISION_INSPECTION',
  '/materials': 'MATERIAL_BATCH_TRACE',

  // Batch / lot — the detergent story
  '/traceability/genealogy': 'LOT_GENEALOGY',
  '/production/recipes': 'RECIPE_BATCH',
  '/plm': 'PLM',

  // Continuous process with a heavy electrical load — the membrane story
  '/power-quality': 'POWER_QUALITY',
  '/harmonics': 'HARMONICS',
  '/power-factor': 'POWER_FACTOR',
  '/sld': 'SINGLE_LINE_DIAGRAM',
  '/energy/analytics': 'ENERGY_BASELINE',
  '/cost': 'COST_ALLOCATION',
  '/sustainability': 'SUSTAINABILITY',
  '/predictive': 'PREDICTIVE_ASSETS',
  '/environment': 'ENVIRONMENT',

  // Shared, but not universal
  '/inventory': 'INVENTORY',
};

const SORTED_PREFIXES = Object.keys(ROUTE_CAPABILITIES).sort((a, b) => b.length - a.length);

/** The capability a route needs, or null when every factory has it. */
export function routeCapability(href: string | undefined): FactoryCapability | null {
  if (!href) return null;
  for (const prefix of SORTED_PREFIXES) {
    if (href === prefix || href.startsWith(`${prefix}/`)) return ROUTE_CAPABILITIES[prefix];
  }
  return null;
}

type NavLike = {
  href?: string;
  section?: string;
  capability?: FactoryCapability;
  children?: NavLike[];
};

/**
 * Prune a nav tree to what the selected factory actually has.
 *
 * `capabilities` of `null` means no factory is selected yet — at the enterprise
 * level nothing is pruned, because the estate as a whole has every module even
 * though no single site does.
 */
export function filterNavByCapability<T extends NavLike>(
  items: T[],
  capabilities: FactoryCapability[] | null,
): T[] {
  if (!capabilities) return items;
  const has = (c: FactoryCapability) => capabilities.includes(c);

  const pruned: T[] = [];
  for (const item of items) {
    if (item.section) { pruned.push(item); continue; }

    if (item.children?.length) {
      const kids = filterNavByCapability(item.children as T[], capabilities);
      if (kids.length) pruned.push({ ...item, children: kids });
      continue;
    }

    const required = item.capability ?? routeCapability(item.href);
    if (!required || has(required)) pruned.push(item);
  }

  // Drop section headers left with nothing beneath them.
  return pruned.filter((item, i) => {
    if (!item.section) return true;
    const next = pruned[i + 1];
    return !!next && !next.section;
  });
}

/** Read the capability list off a factory record returned by the API. */
export function capabilitiesOfFactory(factory: unknown): FactoryCapability[] | null {
  if (!factory || typeof factory !== 'object') return null;
  const meta = (factory as { metadata?: unknown }).metadata;
  if (!meta || typeof meta !== 'object') return null;
  const caps = (meta as { capabilities?: unknown }).capabilities;
  return Array.isArray(caps) ? (caps as FactoryCapability[]) : null;
}

/** Read the classification off a factory record, for labels and badges. */
export function typeOfFactory(factory: unknown): { type: FactoryType; name: string; nameAr: string } | null {
  if (!factory || typeof factory !== 'object') return null;
  const meta = (factory as { metadata?: Record<string, unknown> }).metadata;
  if (!meta || typeof meta !== 'object') return null;
  const type = meta.type as FactoryType | undefined;
  if (!type) return null;
  return {
    type,
    name: (meta.typeName as string) ?? type,
    nameAr: (meta.typeNameAr as string) ?? type,
  };
}
