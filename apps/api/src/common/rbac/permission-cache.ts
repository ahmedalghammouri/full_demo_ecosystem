import type { PrismaService } from '../../database/prisma.service';
import type { UserRole } from '@prisma/client';

/**
 * Resolves the live permission-key set for a role from the DB-backed RBAC tables,
 * with a short in-memory TTL cache so we don't hit Postgres on every request. The
 * set is NOT baked into the JWT — resolving per request (cached) means edits in the
 * Access Control admin UI take effect within `TTL_MS`, without forcing a re-login.
 *
 * `invalidate()` is called by the RBAC admin controller after any grant change so
 * updates are effectively immediate.
 */
const TTL_MS = 30_000;
const cache = new Map<UserRole, { keys: string[]; expires: number }>();

export async function resolveRolePermissions(prisma: PrismaService, role: UserRole): Promise<string[]> {
  const hit = cache.get(role);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.keys;

  const grants = await prisma.rolePermission.findMany({
    where: { role },
    select: { permission: { select: { key: true } } },
  });
  const keys = grants.map((g) => g.permission.key);
  cache.set(role, { keys, expires: now + TTL_MS });
  return keys;
}

/** Drop the cache (all roles, or one) so the next request re-reads from the DB. */
export function invalidatePermissionCache(role?: UserRole): void {
  if (role) cache.delete(role);
  else cache.clear();
}
