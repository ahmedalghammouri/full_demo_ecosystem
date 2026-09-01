import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions && !requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest<{ user: { role: string; permissions: string[] } }>();

    if (!user) throw new ForbiddenException('Access denied');

    // Super admin bypasses all checks
    if (user.role === 'SUPER_ADMIN') return true;

    if (requiredRoles && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(`Required role: ${requiredRoles.join(' or ')}`);
    }

    if (requiredPermissions) {
      const hasAll = requiredPermissions.every((perm) => user.permissions?.includes(perm));
      if (!hasAll) throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
