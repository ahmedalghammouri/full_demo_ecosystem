import { Controller, Get, Put, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { UserRole } from '@prisma/client';

import { RbacService } from './rbac.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

/**
 * Access Control admin — read the permission catalog + role matrix and edit which
 * permissions each role holds. Every route requires `rbac:manage` (enforced by the
 * global RbacGuard), so only FACTORY_ADMIN / SUPER_ADMIN reach it by default.
 */
@ApiTags('Access Control')
@ApiBearerAuth('JWT-auth')
@Controller('rbac')
@RequirePermissions('rbac:manage')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  @ApiOperation({ summary: 'Permission catalog grouped by category + the role list' })
  catalog() {
    return this.rbac.getCatalog();
  }

  @Get('matrix')
  @ApiOperation({ summary: 'role → granted permissionIds' })
  matrix() {
    return this.rbac.getMatrix();
  }

  @Put('roles/:role')
  @ApiOperation({ summary: "Replace a role's entire permission set" })
  setRole(@Param('role') role: string, @Body() body: { permissionIds: string[] }) {
    return this.rbac.setRoleGrants(role as UserRole, body?.permissionIds ?? []);
  }

  @Patch('roles/:role/permissions/:permissionId')
  @ApiOperation({ summary: 'Grant or revoke a single permission for a role' })
  toggle(
    @Param('role') role: string,
    @Param('permissionId') permissionId: string,
    @Body() body: { granted: boolean },
  ) {
    return this.rbac.setGrant(role as UserRole, permissionId, !!body?.granted);
  }
}
