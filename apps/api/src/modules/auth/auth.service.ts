import {
  Injectable, UnauthorizedException, BadRequestException, Logger, ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { resolveRolePermissions } from '../../common/rbac/permission-cache';
import { KpiService, type MachineFactTotals } from '../production/kpi.service';
import type { User } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  enterpriseId: string;
  factoryId: string | null;
  factoryCode: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    // The landing page shows OEE, so it reads the OEE engine. Injected rather
    // than re-derived: see {@link getFactoriesOverview}.
    private readonly kpi: KpiService,
  ) {}

  // Validates credentials — factoryCode optional (SUPER_ADMIN can omit or specify any)
  async validateUser(email: string, password: string, factoryCode?: string): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });

    if (!user || !user.isActive) return null;

    // Check account lock
    if (user.lockedAt) {
      const lockDuration = 30 * 60 * 1000; // 30 minutes
      if (new Date().getTime() - user.lockedAt.getTime() < lockDuration) {
        return null;
      }
      // Auto-unlock after 30 min
      await this.prisma.user.update({ where: { id: user.id }, data: { lockedAt: null, failedLoginAttempts: 0 } });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await this.recordFailedLogin(user.id);
      return null;
    }

    // Factory validation — non-SUPER_ADMIN must belong to the requested factory
    if (factoryCode && user.role !== 'SUPER_ADMIN') {
      const factory = await this.prisma.factory.findUnique({ where: { code: factoryCode.toUpperCase() } });
      if (!factory || user.factoryId !== factory.id) {
        this.logger.warn(`User ${email} attempted login to factory ${factoryCode} but is assigned elsewhere`);
        return null;
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lastLoginAt: new Date() },
    });

    return user;
  }

  async login(
    user: User,
    factoryCode?: string,
  ): Promise<{ user: object; accessToken: string; refreshToken: string }> {
    // Determine effective factory for this session
    let effectiveFactoryId: string | null = user.factoryId;
    let effectiveFactoryCode: string | null = null;

    if (factoryCode) {
      const factory = await this.prisma.factory.findUnique({ where: { code: factoryCode.toUpperCase() } });
      if (factory) {
        effectiveFactoryId = factory.id;
        effectiveFactoryCode = factory.code;
      }
    } else if (user.factoryId) {
      const factory = await this.prisma.factory.findUnique({ where: { id: user.factoryId } });
      effectiveFactoryCode = factory?.code ?? null;
    }

    // SUPER_ADMIN without factoryCode → no factory context (sees enterprise dashboard)
    if (user.role === 'SUPER_ADMIN' && !effectiveFactoryCode) {
      effectiveFactoryId = null;
    }

    const tokens = await this.generateTokens(user, effectiveFactoryId, effectiveFactoryCode);
    await this.createSession(user.id, tokens.refreshToken, effectiveFactoryId);

    this.logger.log(`User ${user.email} logged in (factory: ${effectiveFactoryCode ?? 'all'})`);

    // Return enriched user profile with factory info + the role's permission set
    // (so the web app can gate nav / hard-lock hub roles immediately on login).
    const userWithFactory = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { factory: true, enterprise: true },
    });
    const permissions = await resolveRolePermissions(this.prisma, user.role);

    return {
      user: { ...this.sanitizeUser(userWithFactory!), permissions },
      ...tokens,
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens & { user: object }> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('jwt.refreshSecret'),
      });

      const sessions = await this.prisma.userSession.findMany({
        where: { userId: payload.sub, expiresAt: { gt: new Date() }, isRevoked: false },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // Verify token hash against stored sessions
      let validSession: typeof sessions[0] | null = null;
      for (const session of sessions) {
        const match = await bcrypt.compare(refreshToken, session.refreshToken);
        if (match) { validSession = session; break; }
      }

      if (!validSession) throw new UnauthorizedException('Invalid or expired refresh token');

      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: payload.sub },
        include: { factory: true, enterprise: true },
      });

      const tokens = await this.generateTokens(user, payload.factoryId, payload.factoryCode);

      // Rotate refresh token
      await this.prisma.userSession.update({
        where: { id: validSession.id },
        data: {
          refreshToken: await bcrypt.hash(tokens.refreshToken, 6),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const permissions = await resolveRolePermissions(this.prisma, user.role);
      return { user: { ...this.sanitizeUser(user), permissions }, ...tokens };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
    this.logger.log(`User ${userId} logged out`);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) throw new BadRequestException('Current password is incorrect');

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, passwordChangedAt: new Date() },
    });

    await this.prisma.userSession.updateMany({ where: { userId }, data: { isRevoked: true } });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null, isActive: true },
    });

    // Always return success to prevent user enumeration attacks
    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpiry: expiry,
      },
    });

    const baseUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    this.logger.log(`Password reset requested for ${email}, reset URL generated`);

    // Import lazily to avoid circular dep — notifications service sends the email
    this.eventEmitter.emit('auth.password-reset.requested', {
      email: user.email,
      name: user.name,
      resetToken,
      resetUrl,
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpiry: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiry: null,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedAt: null,
      },
    });

    // Revoke all sessions for security
    await this.prisma.userSession.updateMany({
      where: { userId: user.id },
      data: { isRevoked: true },
    });

    this.logger.log(`Password reset completed for user ${user.email}`);
  }

  // Returns list of factories available for login (for factory selector population)
  async getFactoriesForSelector(): Promise<Array<{
    id: string; code: string; name: string; nameAr: string | null;
    city: string | null; lat: number | null; lng: number | null;
    color: string; glowColor: string; isActive: boolean;
    metadata: unknown;
  }>> {
    return this.prisma.factory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, nameAr: true, city: true, lat: true, lng: true, color: true, glowColor: true, isActive: true, metadata: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Public landing-page overview: every active factory with REAL KPIs, plus a
   * network-wide summary. Powers the factory-selector map and the login panel.
   *
   * ── Why this was rewritten ──────────────────────────────────────────────
   * It read `oee_records`, and `oee_records` has never been written: it holds
   * zero rows on every database checked. Prisma's `_avg` over no rows returns
   * null, `round1` was `Math.round((n ?? 0) * 10) / 10`, and so the login page
   * greeted every visitor with "Overall OEE 0.0% / Quality Rate 0.0%" for a
   * plant that had run 14,040 measured minutes.
   *
   * That is the same `?? 0` fault this codebase has now paid for repeatedly:
   * an absent measurement rendered as a measured zero. A zero OEE is a claim —
   * it says the line produced nothing — and it is the most damaging thing a
   * landing page can say about a working factory.
   *
   * ── Where the numbers come from now ─────────────────────────────────────
   * `KpiService.machineFactTotals` and `factorsFromFacts` — the same engine
   * every other OEE surface reads, guarded by availability-one-engine.spec.
   * A landing tile computing its own OEE is exactly how two screens come to
   * disagree, and this endpoint had drifted so far it was reading a dead table.
   *
   * Summing a factory's machines is safe because that engine already filters
   * QUANTITY to the final routing step per work order — the upstream machines
   * carry time but zero parts, so a unit that crosses four stations is counted
   * once. Time is additive by nature. This is precisely the arithmetic the
   * engine exists to own.
   *
   * ── Null, never zero ────────────────────────────────────────────────────
   * `factorsFromFacts` returns null when a denominator is absent, and that null
   * travels all the way to the browser, where it renders as an em-dash. A
   * factory that has not run this month says so instead of claiming failure.
   */
  async getFactoriesOverview() {
    const factories = await this.prisma.factory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, nameAr: true, city: true, lat: true, lng: true, color: true, glowColor: true, isActive: true, metadata: true },
      orderBy: { code: 'asc' },
    });
    const ids = factories.map((f) => f.id);
    if (ids.length === 0) {
      return {
        windowDays: 30,
        factories: [],
        // Null, not 0: there is no network here to have an average.
        summary: { avgOEE: null, avgQuality: null, totalFactories: 0, totalEmployees: 0, totalActiveAlarms: 0 },
      };
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    // A landing tile needs a window wide enough that a plant which ran last
    // week still has something to show, and narrow enough that the figure
    // describes the factory as it is now. Thirty days is stated in the payload
    // as `windowDays` so the page can label what it is showing -- an unlabelled
    // percentage is the ambiguity that started the dashboard audit.
    const WINDOW_DAYS = 30;
    const now = new Date();
    const windowFrom = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

    const machines = await this.prisma.machine.findMany({
      where: { factoryId: { in: ids }, isActive: true, archivedAt: null },
      select: { id: true, factoryId: true },
    });
    const machinesOf = new Map<string, string[]>();
    for (const m of machines) {
      const list = machinesOf.get(m.factoryId) ?? [];
      list.push(m.id);
      machinesOf.set(m.factoryId, list);
    }
    const allMachineIds = machines.map((m) => m.id);

    const [windowFacts, todayFacts, employees, alarms, shifts] = await Promise.all([
      // The canonical engine, over the rolling window.
      this.kpi.machineFactTotals(allMachineIds, windowFrom, now),
      // Today's output, through the same final-step rule so it cannot disagree
      // with the production figure any other page shows.
      this.kpi.machineFactTotals(allMachineIds, dayStart, now),
      this.prisma.user.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids }, isActive: true, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.alarmEvent.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids }, resolvedAt: null },
        _count: { _all: true },
      }),
      this.prisma.shiftInstance.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids }, startTime: { gte: dayStart } },
        _count: { _all: true },
      }),
    ]);

    const empMap = new Map(employees.map((r) => [r.factoryId, r._count._all]));
    const alarmMap = new Map(alarms.map((r) => [r.factoryId, r._count._all]));
    const shiftMap = new Map(shifts.map((r) => [r.factoryId, r._count._all]));

    /**
     * One factory's machines added together.
     *
     * Returns undefined when the factory has no machine that reported anything
     * in the window -- which is a different fact from "reported zeros", and
     * `factorsFromFacts` turns it into nulls rather than into 0%.
     */
    const rollUp = (
      facts: Map<string, MachineFactTotals>,
      factoryId: string,
    ): MachineFactTotals | undefined => {
      const own = (machinesOf.get(factoryId) ?? [])
        .map((id) => facts.get(id))
        .filter((x): x is MachineFactTotals => x != null);
      if (own.length === 0) return undefined;
      return own.reduce((a, b) => ({
        plannedMin: a.plannedMin + b.plannedMin,
        runMin: a.runMin + b.runMin,
        downMin: a.downMin + b.downMin,
        plannedDownMin: a.plannedDownMin + b.plannedDownMin,
        externalMin: a.externalMin + b.externalMin,
        microStopMin: a.microStopMin + b.microStopMin,
        idealRunMin: a.idealRunMin + b.idealRunMin,
        unmeasuredMin: a.unmeasuredMin + b.unmeasuredMin,
        // Safe to add only because the engine already reduced quantity to the
        // final routing step per work order; upstream machines contribute 0.
        totalBase: a.totalBase + b.totalBase,
        goodBase: a.goodBase + b.goodBase,
        scrapBase: a.scrapBase + b.scrapBase,
      }));
    };

    const enriched = factories.map((f) => {
      const k = this.kpi.factorsFromFacts(rollUp(windowFacts, f.id));
      const today = rollUp(todayFacts, f.id);
      return {
        ...f,
        kpis: {
          oee: k.oee,
          availability: k.availability,
          performance: k.performance,
          quality: k.quality,
          // Uptime is the time-based availability, not the schedule-based one:
          // "while it was up, how much was productive" is what the word means.
          uptime: k.availabilityTb,
          production: today ? Math.round(today.goodBase) : null,
          employees: empMap.get(f.id) ?? 0,
          activeAlarms: alarmMap.get(f.id) ?? 0,
          shiftsToday: shiftMap.get(f.id) ?? 0,
        },
      };
    });

    // Averaged over the factories that HAVE a figure. A site that did not run
    // must not drag the network average toward zero -- it has no OEE to
    // contribute, which is not the same as contributing a bad one.
    const mean = (xs: Array<number | null>) => {
      const real = xs.filter((n): n is number => n != null);
      return real.length ? Math.round((real.reduce((s, n) => s + n, 0) / real.length) * 10) / 10 : null;
    };

    return {
      windowDays: WINDOW_DAYS,
      factories: enriched,
      summary: {
        avgOEE: mean(enriched.map((f) => f.kpis.oee)),
        avgQuality: mean(enriched.map((f) => f.kpis.quality)),
        totalFactories: factories.length,
        totalEmployees: enriched.reduce((s, f) => s + f.kpis.employees, 0),
        totalActiveAlarms: enriched.reduce((s, f) => s + f.kpis.activeAlarms, 0),
      },
    };
  }

  private async generateTokens(
    user: User,
    factoryId: string | null,
    factoryCode: string | null,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      enterpriseId: user.enterpriseId,
      factoryId,
      factoryCode,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? this.config.get<string>('jwt.expiresIn') ?? '8h',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? this.config.get<string>('jwt.refreshExpiresIn') ?? '30d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async createSession(userId: string, refreshToken: string, factoryId?: string | null): Promise<void> {
    const hashedToken = await bcrypt.hash(refreshToken, 6);
    await this.prisma.userSession.create({
      data: {
        userId,
        refreshToken: hashedToken,
        factoryId: factoryId ?? null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Clean expired / revoked sessions
    await this.prisma.userSession.deleteMany({
      where: {
        userId,
        OR: [{ expiresAt: { lt: new Date() } }, { isRevoked: true }],
      },
    });
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (user.failedLoginAttempts >= 5) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedAt: new Date() },
      });
      this.logger.warn(`Account locked for user ${userId} after 5 failed attempts`);
    }
  }

  sanitizeUser(user: any) {
    const { passwordHash, mfaSecret, ...safeUser } = user;
    return safeUser;
  }
}
