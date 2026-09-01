/**
 * Central route → permission map for nav/route gating on the web client.
 *
 * A single source of truth: the sidebar filters items through `routePermission`,
 * and any page-level guard can reuse it. Matching is longest-prefix, so
 * `/production/oee` inherits `/production`'s permission unless a more specific
 * entry exists. Routes with no entry are treated as "always visible" (to any
 * signed-in platform user) — e.g. `/apps`, `/notifications`, profile pages.
 *
 * Keys must match the backend permission catalog (prisma/seeds/rbac.seed.ts).
 */

// Longest-prefix wins. Order here is irrelevant; the matcher sorts by length.
const ROUTE_PERMISSIONS: Record<string, string> = {
  // Dashboards & insight
  '/command-center': 'dashboard:read',
  '/dashboard': 'dashboard:read',
  '/dashboard-center': 'dashboard:read',
  '/executive': 'dashboard:read',
  '/downtime': 'dashboard:read', // Downtime Command Center
  '/analytics': 'analytics:read',
  '/ai': 'ai:read',
  '/reports': 'reports:read',

  // Production family
  '/production': 'production:read',
  // Both OEE engines answer to production:read on the API, so the menu entry
  // must too — otherwise it shows to someone who will only get a 403.
  '/oee-analysis': 'production:read',
  '/live-shift': 'production:read',
  '/oee-breakdown': 'production:read',
  '/manufacturing': 'manufacturing:read',
  '/scheduling': 'scheduling:read',
  '/production/scheduling': 'scheduling:read',
  '/production/shifts': 'shifts:read',

  // Quality
  '/quality': 'quality:read',
  '/traceability': 'traceability:read',

  // Maintenance
  '/maintenance': 'maintenance:read',

  // Energy & assets
  '/energy': 'energy:read',
  '/inventory': 'inventory:read',
  '/iot': 'iot:read',
  // Deliberately NOT iot:read. This page decides what a signal means and what a
  // stop costs — switching "charged against OEE" off for changeover rewrites
  // every availability figure in the plant. iot:read is held by OPERATOR, who
  // needs to see machine states on the HMI and must not be able to do that.
  '/iot/signal-rules': 'iot:signals',
  '/plm': 'plm:read',

  // Alerts
  '/alarms': 'alarms:read',

  // Administration
  '/users': 'users:read',
  '/settings': 'settings:read',

  // Tablet floor surfaces (also reachable from the Operation Hub)
  '/shop-floor': 'shopfloor:operate',
  '/quality-floor': 'qualityfloor:operate',
  '/maintenance-floor': 'maintenancefloor:operate',
};

const SORTED_PREFIXES = Object.keys(ROUTE_PERMISSIONS).sort((a, b) => b.length - a.length);

/** The permission required to view a route, or null when the route is ungated. */
export function routePermission(href: string | undefined): string | null {
  if (!href) return null;
  for (const prefix of SORTED_PREFIXES) {
    if (href === prefix || href.startsWith(`${prefix}/`)) return ROUTE_PERMISSIONS[prefix];
  }
  return null;
}

type NavLike = {
  href?: string;
  section?: string;
  permission?: string;
  children?: NavLike[];
};

/**
 * Prune a nav tree to what `has(permission)` allows:
 *  • a leaf (href, no children) is kept only if its route permission is granted;
 *  • a group is kept only if at least one descendant survives;
 *  • a section header is kept only if a real item follows it before the next section.
 */
export function filterNavByPermission<T extends NavLike>(items: T[], has: (perm: string) => boolean): T[] {
  const pruned: T[] = [];
  for (const item of items) {
    if (item.section) { pruned.push(item); continue; } // decide sections in the post-pass

    if (item.children?.length) {
      const kids = filterNavByPermission(item.children as T[], has);
      if (kids.length) pruned.push({ ...item, children: kids });
      continue;
    }

    const required = item.permission ?? routePermission(item.href);
    if (!required || has(required)) pruned.push(item);
  }

  // Drop section headers that ended up with no visible items beneath them
  // (i.e. the next entry is another section header, or the list ends).
  return pruned.filter((item, i) => {
    if (!item.section) return true;
    const next = pruned[i + 1];
    return !!next && !next.section;
  });
}
