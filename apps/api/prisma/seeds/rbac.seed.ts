/**
 * RBAC seed — canonical permission catalog + the DEFAULT role→permission matrix.
 *
 * Design:
 *  • PERMISSIONS are upserted by `key` on every run (idempotent). New capabilities
 *    added in a later release appear automatically after deploy.
 *  • The ROLE MATRIX is only written when role_permissions is EMPTY (first boot).
 *    After that, edits made in the Access Control admin UI are the source of truth
 *    and are NEVER overwritten by a redeploy. Pass { force: true } to reset to
 *    defaults deliberately.
 *
 * Access model:
 *  • `platform:access` gates the desktop platform. Every desktop role has it.
 *    OPERATOR and MAINTENANCE_TECHNICIAN do NOT → the web route-guard hard-locks
 *    them to the tablet Operation Hub.
 *  • `hub:operate` grants the Operation Hub itself; `*floor:operate` the individual
 *    tablet surfaces.
 *  • The `resource:action` keys match the @RequirePermissions decorators already
 *    present in the controllers (production:write/execute/manage, quality:write/
 *    approve, maintenance:write/execute, notifications:manage, …).
 */
import type { PrismaClient, UserRole } from '@prisma/client';

type PermDef = { key: string; label: string; category: string; description?: string };

// ── Canonical permission catalog ────────────────────────────────────────────
// Grouped by category (the admin UI renders these buckets). resource:action.
export const PERMISSION_CATALOG: PermDef[] = [
  // Access / platform
  { key: 'platform:access', label: 'Access desktop platform', category: 'Access', description: 'Sign in to the full web platform (not just the tablet hub)' },
  { key: 'hub:operate', label: 'Operate Operation Hub', category: 'Access', description: 'Use the tablet-first Operation Hub' },
  { key: 'shopfloor:operate', label: 'Operate Shop Floor', category: 'Access' },
  { key: 'qualityfloor:operate', label: 'Operate Quality Floor', category: 'Access' },
  { key: 'maintenancefloor:operate', label: 'Operate Maintenance Floor', category: 'Access' },

  // Dashboards & insight
  { key: 'dashboard:read', label: 'View dashboards', category: 'Dashboards' },
  { key: 'analytics:read', label: 'View analytics', category: 'Dashboards' },
  { key: 'ai:read', label: 'Use AI intelligence', category: 'Dashboards' },
  { key: 'reports:read', label: 'View reports', category: 'Reports' },
  { key: 'reports:manage', label: 'Build & manage reports', category: 'Reports' },

  // Production
  { key: 'production:read', label: 'View production', category: 'Production' },
  { key: 'production:write', label: 'Create / edit production orders', category: 'Production' },
  { key: 'production:execute', label: 'Execute on the line (counts, downtime, job orders)', category: 'Production' },
  { key: 'production:manage', label: 'Manage production master data', category: 'Production' },
  { key: 'manufacturing:read', label: 'View manufacturing', category: 'Production' },
  { key: 'manufacturing:write', label: 'Edit processes & recipes', category: 'Production' },
  { key: 'manufacturing:execute', label: 'Operate control panel', category: 'Production' },
  { key: 'scheduling:read', label: 'View scheduling', category: 'Production' },
  { key: 'scheduling:write', label: 'Edit schedules', category: 'Production' },
  { key: 'scheduling:manage', label: 'Approve reschedule requests', category: 'Production' },
  { key: 'downtime:read', label: 'View downtime', category: 'Production' },
  { key: 'shifts:read', label: 'View shifts', category: 'Production' },
  { key: 'shifts:manage', label: 'Configure shifts', category: 'Production' },

  // Quality
  { key: 'quality:read', label: 'View quality', category: 'Quality' },
  { key: 'quality:write', label: 'Record inspections / NCRs', category: 'Quality' },
  { key: 'quality:approve', label: 'Approve quality dispositions / CAPA', category: 'Quality' },
  { key: 'traceability:read', label: 'View traceability', category: 'Quality' },

  // Maintenance
  { key: 'maintenance:read', label: 'View maintenance', category: 'Maintenance' },
  { key: 'maintenance:write', label: 'Create / edit maintenance orders', category: 'Maintenance' },
  { key: 'maintenance:execute', label: 'Execute maintenance work', category: 'Maintenance' },

  // Energy & assets
  { key: 'energy:read', label: 'View energy', category: 'Energy & Assets' },
  { key: 'energy:manage', label: 'Manage energy meters', category: 'Energy & Assets' },
  { key: 'iot:read', label: 'View IoT / connectivity', category: 'Energy & Assets' },
  { key: 'iot:manage', label: 'Manage IoT gateways', category: 'Energy & Assets' },
  // Separate from iot:manage on purpose. Managing a gateway is operational work;
  // this is the page that decides what a signal MEANS and what a stop COSTS —
  // switch "charged against OEE" off for changeover and every availability figure
  // in the plant changes, retroactively and silently. It is an engineering
  // decision with a paper trail, so it is granted rather than inherited.
  { key: 'iot:signals', label: 'Configure signal interpretation, state rules & alarm limits', category: 'Energy & Assets' },
  { key: 'inventory:read', label: 'View inventory', category: 'Energy & Assets' },
  { key: 'inventory:write', label: 'Move / adjust stock', category: 'Energy & Assets' },
  { key: 'plm:read', label: 'View PLM', category: 'Energy & Assets' },
  { key: 'plm:write', label: 'Edit PLM records', category: 'Energy & Assets' },

  // Alerts
  { key: 'alarms:read', label: 'View alarms', category: 'Alerts' },
  { key: 'alarms:manage', label: 'Manage alarms', category: 'Alerts' },
  { key: 'notifications:read', label: 'View notifications', category: 'Alerts' },
  { key: 'notifications:manage', label: 'Manage notification rules', category: 'Alerts' },

  // Administration
  { key: 'users:read', label: 'View users', category: 'Administration' },
  { key: 'users:manage', label: 'Create / edit / deactivate users', category: 'Administration' },
  { key: 'rbac:manage', label: 'Edit roles & permissions', category: 'Administration' },
  { key: 'settings:read', label: 'View settings', category: 'Administration' },
  { key: 'settings:manage', label: 'Manage settings', category: 'Administration' },

  { key: 'plant_dashboard:view', label: 'View plant live dashboards', category: 'Plant Dashboards' },
  { key: 'plant_dashboard:create', label: 'Create plant dashboards', category: 'Plant Dashboards' },
  { key: 'plant_dashboard:edit', label: 'Edit plant dashboards', category: 'Plant Dashboards' },
  { key: 'plant_dashboard:delete', label: 'Delete plant dashboards', category: 'Plant Dashboards' },
  { key: 'plant_dashboard:publish', label: 'Publish plant dashboards', category: 'Plant Dashboards' },
  { key: 'plant_dashboard:configure_cross_scope', label: 'Configure cross-plant dashboard scopes', category: 'Plant Dashboards' },
];

// Convenience groups used to compose the matrix below.
const ALL = PERMISSION_CATALOG.map((p) => p.key);
const READ_ONLY = ALL.filter((k) => k.endsWith(':read'));
// Plant-dashboard builder set (managers) vs read-only view (everyone monitoring).
const PD_BUILD = ['plant_dashboard:view', 'plant_dashboard:create', 'plant_dashboard:edit', 'plant_dashboard:delete', 'plant_dashboard:publish'];
const PD_VIEW = 'plant_dashboard:view';

// ── Default role → permission matrix ────────────────────────────────────────
// The two hub-locked roles (OPERATOR, MAINTENANCE_TECHNICIAN) intentionally have
// NO `platform:access` — that is what confines them to the Operation Hub.
export const ROLE_MATRIX: Record<UserRole, string[]> = {
  // Full bypass in the guard, but list all for a truthful admin UI.
  SUPER_ADMIN: ALL,
  FACTORY_ADMIN: ALL,

  PLANT_MANAGER: [
    'platform:access',
    'dashboard:read', 'analytics:read', 'ai:read', 'reports:read', 'reports:manage',
    'production:read', 'production:write', 'production:manage',
    'manufacturing:read', 'scheduling:read', 'scheduling:write', 'scheduling:manage',
    'downtime:read', 'shifts:read', 'shifts:manage',
    'quality:read', 'quality:approve', 'traceability:read',
    'maintenance:read', 'energy:read', 'iot:read', 'inventory:read', 'plm:read',
    'alarms:read', 'alarms:manage', 'notifications:read', 'users:read',
    ...PD_BUILD,
  ],

  PRODUCTION_MANAGER: [
    'platform:access',
    'dashboard:read', 'analytics:read', 'ai:read', 'reports:read', 'reports:manage',
    'production:read', 'production:write', 'production:execute', 'production:manage',
    'manufacturing:read', 'manufacturing:write', 'manufacturing:execute',
    'scheduling:read', 'scheduling:write', 'scheduling:manage',
    'downtime:read', 'shifts:read', 'shifts:manage',
    'quality:read', 'maintenance:read', 'energy:read', 'inventory:read', 'inventory:write',
    'traceability:read', 'alarms:read', 'notifications:read',
    ...PD_BUILD,
  ],

  PRODUCTION_SUPERVISOR: [
    'platform:access',
    'dashboard:read', 'reports:read',
    'production:read', 'production:write', 'production:execute',
    'manufacturing:read', 'manufacturing:execute',
    'scheduling:read', 'downtime:read', 'shifts:read',
    'quality:read', 'maintenance:read', 'inventory:read',
    'alarms:read', 'notifications:read',
    PD_VIEW,
  ],

  QUALITY_MANAGER: [
    'platform:access',
    'dashboard:read', 'analytics:read', 'ai:read', 'reports:read', 'reports:manage',
    'quality:read', 'quality:write', 'quality:approve', 'traceability:read',
    'production:read', 'maintenance:read', 'plm:read', 'plm:write',
    'alarms:read', 'alarms:manage', 'notifications:read',
    PD_VIEW,
  ],

  QUALITY_ENGINEER: [
    'platform:access', 'qualityfloor:operate',
    'dashboard:read', 'reports:read',
    'quality:read', 'quality:write', 'quality:approve', 'traceability:read',
    'production:read', 'alarms:read', 'notifications:read',
  ],

  MAINTENANCE_MANAGER: [
    'platform:access',
    'dashboard:read', 'analytics:read', 'ai:read', 'reports:read', 'reports:manage',
    'maintenance:read', 'maintenance:write', 'maintenance:execute',
    'production:read', 'energy:read', 'iot:read', 'iot:manage', 'inventory:read', 'inventory:write',
    'alarms:read', 'alarms:manage', 'notifications:read', 'notifications:manage',
    PD_VIEW,
  ],

  ENERGY_MANAGER: [
    'platform:access',
    'dashboard:read', 'analytics:read', 'ai:read', 'reports:read', 'reports:manage',
    'energy:read', 'energy:manage', 'iot:read', 'iot:manage',
    'production:read', 'maintenance:read', 'alarms:read', 'notifications:read',
    PD_VIEW,
  ],

  VIEWER: [
    'platform:access',
    ...READ_ONLY,
    PD_VIEW,
  ],

  // ── Hub-locked floor roles (NO platform:access) ──
  OPERATOR: [
    'hub:operate', 'shopfloor:operate',
    'production:read', 'production:execute',
    'downtime:read',
    // Shop-floor read access: machine states, alarm log + KPIs, and the operator's
    // own maintenance requests (all surfaced on the operator HMI dashboard).
    'iot:read', 'alarms:read', 'maintenance:read',
    PD_VIEW,
  ],

  MAINTENANCE_TECHNICIAN: [
    'hub:operate', 'maintenancefloor:operate',
    'maintenance:read', 'maintenance:execute',
  ],
};

/** Seed the permission catalog (always) + the default matrix (first boot only). */
export async function seedRbac(prisma: PrismaClient, opts: { force?: boolean } = {}) {
  // 1) Upsert the canonical permission catalog.
  const byKey = new Map<string, string>(); // key → id
  for (let i = 0; i < PERMISSION_CATALOG.length; i++) {
    const p = PERMISSION_CATALOG[i];
    const [resource, action] = p.key.split(':');
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, resource, action, label: p.label, description: p.description ?? null, category: p.category, sortOrder: i, isSystem: true },
      update: { resource, action, label: p.label, description: p.description ?? null, category: p.category, sortOrder: i },
    });
    byKey.set(p.key, row.id);
  }

  // 2) Blanket-access roles get every permission, including ones added later.
  //
  // This runs even on a configured install, and it is not a contradiction of the
  // rule below. SUPER_ADMIN and FACTORY_ADMIN are defined as "all permissions";
  // a capability added in a later release that reached neither of them would
  // lock the factory administrator out of a page they own — and because
  // SUPER_ADMIN bypasses the guard entirely, nobody would notice until a real
  // customer admin tried to use it. Granting a NEW key to a role that already
  // holds every other key is maintaining the invariant, not overwriting a choice.
  // No other role is touched here.
  let backfilled = 0;
  for (const role of ['SUPER_ADMIN', 'FACTORY_ADMIN'] as UserRole[]) {
    for (const permissionId of byKey.values()) {
      const had = await prisma.rolePermission.findUnique({
        where: { role_permissionId: { role, permissionId } },
        select: { role: true },
      });
      if (had) continue;
      await prisma.rolePermission.create({ data: { role, permissionId } });
      backfilled++;
    }
  }

  // 3) Default matrix — first boot only (never clobber admin edits).
  const existing = await prisma.rolePermission.count();
  if (existing > backfilled && !opts.force) {
    return {
      permissions: byKey.size,
      grants: `skipped (already configured); ${backfilled} admin backfill(s)` as const,
    };
  }
  if (opts.force) await prisma.rolePermission.deleteMany({});

  let grants = 0;
  for (const [role, keys] of Object.entries(ROLE_MATRIX)) {
    for (const key of keys) {
      const permissionId = byKey.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role: role as UserRole, permissionId } },
        create: { role: role as UserRole, permissionId },
        update: {},
      });
      grants++;
    }
  }
  return { permissions: byKey.size, grants };
}
