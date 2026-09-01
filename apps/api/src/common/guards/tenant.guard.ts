import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { factoryId: string | null };
      headers: Record<string, string>;
      factoryId?: string | null;
    }>();
    const user = request.user;
    if (!user) return true;

    // factoryId is null for SUPER_ADMIN (access all factories)
    const factoryId = user.factoryId ?? request.headers['x-factory-id'] ?? null;
    request.factoryId = factoryId;

    return true;
  }
}
