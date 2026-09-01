import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { invalidatePermissionCache } from '../../common/rbac/permission-cache';

/** All roles in enum order — the columns of the admin matrix. */
const ROLES: UserRole[] = [
  'SUPER_ADMIN', 'FACTORY_ADMIN', 'PLANT_MANAGER', 'PRODUCTION_MANAGER',
  'PRODUCTION_SUPERVISOR', 'QUALITY_MANAGER', 'QUALITY_ENGINEER',
  'MAINTENANCE_MANAGER', 'MAINTENANCE_TECHNICIAN', 'ENERGY_MANAGER',
  'OPERATOR', 'VIEWER',
];

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /** The full permission catalog, grouped by category for the admin UI. */
  async getCatalog() {
    const perms = await this.prisma.permission.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, key: true, label: true, description: true, category: true, resource: true, action: true },
    });
    const categories: { category: string; permissions: typeof perms }[] = [];
    for (const p of perms) {
      let bucket = categories.find((c) => c.category === p.category);
      if (!bucket) { bucket = { category: p.category, permissions: [] }; categories.push(bucket); }
      bucket.permissions.push(p);
    }
    return { roles: ROLES, categories, total: perms.length };
  }

  /** role → Set of granted permissionIds, as a plain map the UI can index. */
  async getMatrix(): Promise<Record<string, string[]>> {
    const grants = await this.prisma.rolePermission.findMany({
      select: { role: true, permissionId: true },
    });
    const matrix: Record<string, string[]> = {};
    for (const role of ROLES) matrix[role] = [];
    for (const g of grants) (matrix[g.role] ??= []).push(g.permissionId);
    return matrix;
  }

  /** Toggle a single (role, permission) grant. SUPER_ADMIN/FACTORY_ADMIN are not
   *  editable here — they always hold everything (guardrail against self-lockout). */
  async setGrant(role: UserRole, permissionId: string, granted: boolean) {
    this.assertEditable(role);
    const perm = await this.prisma.permission.findUnique({ where: { id: permissionId } });
    if (!perm) throw new NotFoundException('Permission not found');

    if (granted) {
      await this.prisma.rolePermission.upsert({
        where: { role_permissionId: { role, permissionId } },
        create: { role, permissionId },
        update: {},
      });
    } else {
      await this.prisma.rolePermission.deleteMany({ where: { role, permissionId } });
    }
    invalidatePermissionCache(role);
    return { role, permissionId, granted };
  }

  /** Replace a role's ENTIRE grant set with the given permission ids (bulk save). */
  async setRoleGrants(role: UserRole, permissionIds: string[]) {
    this.assertEditable(role);
    const valid = await this.prisma.permission.findMany({
      where: { id: { in: permissionIds } }, select: { id: true },
    });
    const ids = valid.map((v) => v.id);
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { role } }),
      this.prisma.rolePermission.createMany({
        data: ids.map((permissionId) => ({ role, permissionId })),
        skipDuplicates: true,
      }),
    ]);
    invalidatePermissionCache(role);
    return { role, count: ids.length };
  }

  private assertEditable(role: UserRole) {
    if (role === 'SUPER_ADMIN' || role === 'FACTORY_ADMIN') {
      throw new ForbiddenException(`${role} permissions are fixed and cannot be edited`);
    }
  }
}
