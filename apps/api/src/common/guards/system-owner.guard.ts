import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Hard gate for the System / Danger-Zone area (database & historian reset).
 *
 * Access is restricted to the single highest-privilege account:
 *   1. The user must carry the SUPER_ADMIN role.
 *   2. The user's email must match SYSTEM_OWNER_EMAIL (defaults to the seeded
 *      owner `admin@industry360.sa`). Set SYSTEM_OWNER_EMAIL='' to allow any
 *      SUPER_ADMIN instead of a single designated owner.
 *
 * This guard is applied explicitly via @UseGuards — it does NOT depend on the
 * project's (currently unwired) global RbacGuard, so it is enforced regardless.
 */
@Injectable()
export class SystemOwnerGuard implements CanActivate {
  private readonly ownerEmail = (process.env.SYSTEM_OWNER_EMAIL ?? 'admin@industry360.sa').toLowerCase().trim();

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: { role?: string; email?: string } }>();

    if (!user) throw new ForbiddenException('Authentication required');

    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('System administration requires the SUPER_ADMIN role');
    }

    if (this.ownerEmail && user.email?.toLowerCase() !== this.ownerEmail) {
      throw new ForbiddenException('Only the designated system owner may access this area');
    }

    return true;
  }

  /** Non-throwing check used by the owner-probe endpoint to drive the UI. */
  isOwner(user?: { role?: string; email?: string }): boolean {
    if (!user || user.role !== 'SUPER_ADMIN') return false;
    if (this.ownerEmail && user.email?.toLowerCase() !== this.ownerEmail) return false;
    return true;
  }

  getOwnerEmail(): string | null {
    return this.ownerEmail || null;
  }
}
