/**
 * Odoo-style archive filtering for list queries.
 *
 * `archived` query param:
 *   - undefined / 'active' → only NON-archived rows (default)
 *   - 'archived'           → only archived rows
 *   - 'all'                → both
 *
 * Spread the result into a Prisma `where` clause:
 *   where: { ...factoryFilter, ...archivedWhere(filters.archived), ... }
 */
export function archivedWhere(archived?: string): { archivedAt?: null | { not: null } } {
  if (archived === 'archived') return { archivedAt: { not: null } };
  if (archived === 'all') return {};
  return { archivedAt: null };
}
