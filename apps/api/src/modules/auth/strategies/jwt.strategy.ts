import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../../database/prisma.service';
import type { JwtPayload } from '../auth.service';
import { resolveRolePermissions } from '../../../common/rbac/permission-cache';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, isActive: true },
    });

    if (!user) throw new UnauthorizedException('User account is not active');

    // Resolve the role's live permission set (cached) so the global RbacGuard can
    // enforce @RequirePermissions. SUPER_ADMIN bypasses in the guard regardless.
    const permissions = await resolveRolePermissions(this.prisma, user.role);

    // Attach full payload so guards can read factoryId, role and permissions
    return {
      ...user,
      factoryId: payload.factoryId,
      factoryCode: payload.factoryCode,
      enterpriseId: payload.enterpriseId,
      permissions,
    };
  }
}
