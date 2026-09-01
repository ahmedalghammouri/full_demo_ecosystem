import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  type Notification,
  NotificationType,
  NotificationCategory,
  NotificationSeverity,
  AlarmSeverity,
  UserRole,
} from '@prisma/client';

type Channel = 'email' | 'sms' | 'push' | 'in_app';

/** Low-level multi-channel send (legacy entry point, still used by auth/email flows). */
export interface SendNotificationDto {
  factoryId: string | null;
  userId?: string;
  type: string;
  title: string;
  message: string;
  channels: Channel[];
  metadata?: Record<string, unknown>;
}

/**
 * The unified notification entry point. Resolves recipients (explicit users +
 * roles + optionally everyone in the factory), persists one in-app row per
 * recipient (gated by their preferences) and emits `notification.created` so the
 * WebSocket gateway can push it live to that user's socket room.
 */
export interface DispatchInput {
  factoryId: string | null;
  type: NotificationType;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  link?: string;
  data?: Record<string, unknown>;
  // ── recipient resolution (union of the three) ──
  userIds?: string[];
  roles?: UserRole[];
  allInFactory?: boolean;
  // ── channel override; otherwise per-user preferences decide ──
  channels?: Channel[];
}

/** The shape sent to the client (REST + WebSocket). Enum values are lower-cased. */
export interface SerializedNotification {
  id: string;
  userId: string;
  factoryId: string | null;
  type: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  link: string | null;
  data: unknown;
  isRead: boolean;
  createdAt: string;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  INFO: 0,
  SUCCESS: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3,
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private mailer?: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.setupMailer();
  }

  private setupMailer() {
    const smtpHost = this.config.get<string>('smtp.host');
    if (!smtpHost) return;

    this.mailer = nodemailer.createTransport({
      host: smtpHost,
      port: this.config.get<number>('smtp.port', 587),
      secure: this.config.get<boolean>('smtp.secure', false),
      auth: {
        user: this.config.get<string>('smtp.user'),
        pass: this.config.get<string>('smtp.password'),
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // MAPPING HELPERS
  // ────────────────────────────────────────────────────────────

  /** Derive the UI category from the notification type when not given explicitly. */
  static typeToCategory(type: NotificationType): NotificationCategory {
    switch (type) {
      case NotificationType.ALARM:       return NotificationCategory.ALARM;
      case NotificationType.DOWNTIME:    return NotificationCategory.DOWNTIME;
      case NotificationType.PRODUCTION:  return NotificationCategory.PRODUCTION;
      case NotificationType.QUALITY:     return NotificationCategory.QUALITY;
      case NotificationType.MAINTENANCE: return NotificationCategory.MAINTENANCE;
      case NotificationType.ENERGY:      return NotificationCategory.ENERGY;
      default:                           return NotificationCategory.SYSTEM;
    }
  }

  /** Map UI severity → the legacy AlarmSeverity column so both stay consistent. */
  static severityToPriority(severity: NotificationSeverity): AlarmSeverity {
    switch (severity) {
      case NotificationSeverity.CRITICAL: return AlarmSeverity.CRITICAL;
      case NotificationSeverity.ERROR:    return AlarmSeverity.HIGH;
      case NotificationSeverity.WARNING:  return AlarmSeverity.MEDIUM;
      case NotificationSeverity.SUCCESS:  return AlarmSeverity.LOW;
      default:                            return AlarmSeverity.INFO;
    }
  }

  static serialize(n: Notification): SerializedNotification {
    return {
      id: n.id,
      userId: n.userId,
      factoryId: n.factoryId,
      type: n.type.toLowerCase(),
      category: n.category.toLowerCase(),
      severity: n.severity.toLowerCase(),
      title: n.title,
      message: n.message,
      link: n.link,
      data: n.data ?? null,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  // UNIFIED DISPATCH (persist + real-time, per recipient)
  // ────────────────────────────────────────────────────────────

  async dispatch(input: DispatchInput): Promise<void> {
    const category = input.category ?? NotificationsService.typeToCategory(input.type);
    const severity = input.severity ?? NotificationSeverity.INFO;

    const recipientIds = await this.resolveRecipients(input);
    if (recipientIds.length === 0) {
      this.logger.debug(`dispatch(${input.type}/${input.title}) — no recipients resolved`);
      return;
    }

    await Promise.allSettled(
      recipientIds.map((userId) =>
        this.deliverToUser(userId, { ...input, category, severity }),
      ),
    );
  }

  private async resolveRecipients(input: DispatchInput): Promise<string[]> {
    const ids = new Set<string>(input.userIds ?? []);

    const needRoleLookup = (input.roles && input.roles.length > 0) || input.allInFactory;
    if (needRoleLookup) {
      const factoryMatch: Prisma.UserWhereInput = input.allInFactory
        ? (input.factoryId ? { factoryId: input.factoryId } : {})
        : {
            ...(input.factoryId ? { factoryId: input.factoryId } : {}),
            role: { in: input.roles as UserRole[] },
          };

      const users = await this.prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            factoryMatch,
            // Platform super-admins have no factory of their own but oversee every
            // factory, so they always receive factory-scoped notifications.
            { role: UserRole.SUPER_ADMIN },
          ],
        },
        select: { id: true },
      });
      users.forEach((u) => ids.add(u.id));
    }

    return [...ids];
  }

  /** Dispatch a sample notification to a single user — used to verify the pipeline end-to-end. */
  async sendTestNotification(userId: string, factoryId: string | null): Promise<void> {
    await this.dispatch({
      factoryId,
      type: NotificationType.SYSTEM,
      category: NotificationCategory.SYSTEM,
      severity: NotificationSeverity.INFO,
      title: 'Test notification',
      message: 'If you can see this in the bell and on this page, notifications are working end-to-end.',
      link: '/notifications',
      userIds: [userId],
    });
  }

  private async deliverToUser(
    userId: string,
    input: DispatchInput & { category: NotificationCategory; severity: NotificationSeverity },
  ): Promise<void> {
    try {
      const pref = await this.prisma.notificationPreference.findUnique({
        where: { userId_category: { userId, category: input.category } },
      });

      // Severity gate — skip if below the user's configured minimum for this category.
      if (pref && SEVERITY_RANK[input.severity] < SEVERITY_RANK[pref.minSeverity]) return;

      const channels: Channel[] = input.channels ?? this.channelsFromPref(pref);
      const wantInApp = channels.includes('in_app');
      const wantEmail = channels.includes('email');

      if (wantInApp) {
        const created = await this.prisma.notification.create({
          data: {
            userId,
            factoryId: input.factoryId,
            type: input.type,
            category: input.category,
            severity: input.severity,
            title: input.title,
            message: input.message,
            link: input.link,
            data: input.data ? (input.data as Prisma.InputJsonValue) : undefined,
            priority: NotificationsService.severityToPriority(input.severity),
            emailSent: false,
            isRead: false,
          },
        });

        // Real-time push — the gateway listens and emits to `user:${userId}`.
        this.eventEmitter.emit('notification.created', {
          userId,
          factoryId: input.factoryId,
          notification: NotificationsService.serialize(created),
        });
      }

      if (wantEmail) {
        await this.sendEmail({
          factoryId: input.factoryId,
          userId,
          type: input.type,
          title: input.title,
          message: input.message,
          channels: ['email'],
          metadata: { ...input.data, link: input.link },
        }).catch((e) => this.logger.warn(`email delivery failed for ${userId}: ${e}`));
      }
    } catch (err) {
      this.logger.error(`Failed to deliver notification to ${userId}`, err as Error);
    }
  }

  private channelsFromPref(pref: { inApp: boolean; email: boolean; sms: boolean; push: boolean } | null): Channel[] {
    if (!pref) return ['in_app']; // default: in-app only when no preference saved
    const ch: Channel[] = [];
    if (pref.inApp) ch.push('in_app');
    if (pref.email) ch.push('email');
    if (pref.sms) ch.push('sms');
    if (pref.push) ch.push('push');
    return ch;
  }

  // ────────────────────────────────────────────────────────────
  // SEND (legacy multi-channel — email + simple in-app for a single user)
  // ────────────────────────────────────────────────────────────

  async send(dto: SendNotificationDto): Promise<void> {
    await Promise.allSettled(
      dto.channels.map((channel) => this.sendByChannel(dto, channel)),
    );
  }

  private async sendByChannel(dto: SendNotificationDto, channel: string): Promise<void> {
    try {
      switch (channel) {
        case 'email':
          await this.sendEmail(dto);
          break;
        case 'in_app':
          await this.saveInAppNotification(dto);
          break;
        default:
          this.logger.warn(`Channel ${channel} not yet implemented`);
      }
    } catch (error) {
      this.logger.error(`Failed to send ${channel} notification`, error as Error);
    }
  }

  async sendEmail(dto: SendNotificationDto): Promise<void> {
    if (!this.mailer) {
      this.logger.warn('SMTP not configured — email skipped');
      return;
    }

    const user = dto.userId
      ? await this.prisma.user.findUnique({ where: { id: dto.userId } })
      : null;

    if (!user?.email) return;

    await this.mailer.sendMail({
      from: this.config.get<string>('smtp.from', 'Industry360° <noreply@industry360.sa>'),
      to: user.email,
      subject: dto.title,
      html: this.buildEmailHtml(dto.title, dto.message, dto.metadata),
    });

    this.logger.log(`Email sent to ${user.email}: ${dto.title}`);
  }

  async sendPasswordResetEmail(email: string, resetToken: string, resetUrl: string): Promise<void> {
    if (!this.mailer) {
      this.logger.warn('SMTP not configured — password reset email skipped');
      return;
    }

    await this.mailer.sendMail({
      from: this.config.get<string>('smtp.from', 'Industry360° <noreply@industry360.sa>'),
      to: email,
      subject: 'Password Reset — Industry360°',
      html: this.buildEmailHtml(
        'Password Reset Request',
        `You requested a password reset. Click the link below to set a new password. This link expires in 1 hour.`,
        { resetUrl, action: { label: 'Reset Password', url: resetUrl } },
      ),
    });
  }

  private buildEmailHtml(title: string, message: string, metadata?: Record<string, unknown>): string {
    const actionButton = metadata?.action
      ? `<a href="${(metadata.action as any).url}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#6175f4;color:white;border-radius:6px;text-decoration:none;font-weight:bold;">${(metadata.action as any).label}</a>`
      : '';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a1f2e; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #6175f4; margin: 0; font-size: 18px;">Industry360°</h1>
          <p style="color: #888; margin: 4px 0 0;">Industrial Intelligence Ecosystem</p>
        </div>
        <div style="background: #f5f7ff; padding: 30px; border-radius: 0 0 8px 8px;">
          <h2 style="color: #1a1f2e; margin-top:0;">${title}</h2>
          <p style="color: #555; line-height: 1.6;">${message}</p>
          ${actionButton}
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0 20px;">
          <p style="color: #888; font-size: 12px; margin: 0;">
            This is an automated notification from i360 Platform.<br>
            © ${new Date().getFullYear()} Industry360° Demo Group
          </p>
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────
  // IN-APP NOTIFICATIONS
  // ────────────────────────────────────────────────────────────

  /** Persist a single in-app row for one user and push it live. */
  async saveInAppNotification(dto: SendNotificationDto): Promise<void> {
    if (!dto.userId) return;

    const type = this.coerceType(dto.type);
    await this.deliverToUser(dto.userId, {
      factoryId: dto.factoryId,
      type,
      category: NotificationsService.typeToCategory(type),
      severity: NotificationSeverity.INFO,
      title: dto.title,
      message: dto.message,
      data: dto.metadata,
      link: (dto.metadata?.link as string) ?? undefined,
      channels: ['in_app'],
    });
  }

  private coerceType(raw: string): NotificationType {
    const upper = (raw ?? '').toUpperCase();
    return (NotificationType as Record<string, NotificationType>)[upper] ?? NotificationType.INFO;
  }

  async findForUser(userId: string, factoryId: string | null, filters: {
    isRead?: boolean;
    type?: string;
    category?: string;
    severity?: string;
    page?: number;
    limit?: number;
  }) {
    const { isRead, type, category, severity, page = 1, limit = 20 } = filters;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(factoryId && { OR: [{ factoryId }, { factoryId: null }] }),
      ...(isRead !== undefined && { isRead }),
      ...(type && { type: type.toUpperCase() as NotificationType }),
      ...(category && { category: category.toUpperCase() as NotificationCategory }),
      ...(severity && { severity: severity.toUpperCase() as NotificationSeverity }),
    };

    const [total, rows, unreadCount] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      data: rows.map((n) => NotificationsService.serialize(n)),
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    const n = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!n) throw new NotFoundException('Notification not found');

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
    this.emitUnreadCount(userId);
    return NotificationsService.serialize(updated);
  }

  async markAllAsRead(userId: string, factoryId: string | null): Promise<void> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      isRead: false,
      ...(factoryId && { OR: [{ factoryId }, { factoryId: null }] }),
    };

    await this.prisma.notification.updateMany({
      where,
      data: { isRead: true, readAt: new Date() },
    });
    this.emitUnreadCount(userId);
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    const n = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!n) throw new NotFoundException('Notification not found');
    await this.prisma.notification.delete({ where: { id: notificationId } });
    this.emitUnreadCount(userId);
  }

  /** Tell the gateway to push the user's fresh unread count after a read/delete. */
  private emitUnreadCount(userId: string): void {
    this.getUnreadCount(userId)
      .then((count) => this.eventEmitter.emit('notification.unread-count', { userId, count }))
      .catch(() => undefined);
  }

  // ────────────────────────────────────────────────────────────
  // PREFERENCES (per-user, per-category channels)
  // ────────────────────────────────────────────────────────────

  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r]));

    // Return a complete matrix — one entry per category, defaulting unsaved ones.
    return Object.values(NotificationCategory).map((category) => {
      const r = byCategory.get(category);
      return {
        category: category.toLowerCase(),
        inApp: r?.inApp ?? true,
        email: r?.email ?? false,
        sms: r?.sms ?? false,
        push: r?.push ?? false,
        minSeverity: (r?.minSeverity ?? NotificationSeverity.INFO).toLowerCase(),
      };
    });
  }

  async updatePreference(userId: string, dto: {
    category: string;
    inApp?: boolean;
    email?: boolean;
    sms?: boolean;
    push?: boolean;
    minSeverity?: string;
  }) {
    const category = dto.category.toUpperCase() as NotificationCategory;
    if (!Object.values(NotificationCategory).includes(category)) {
      throw new NotFoundException(`Unknown category: ${dto.category}`);
    }
    const minSeverity = dto.minSeverity
      ? (dto.minSeverity.toUpperCase() as NotificationSeverity)
      : undefined;

    const saved = await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      create: {
        userId,
        category,
        inApp: dto.inApp ?? true,
        email: dto.email ?? false,
        sms: dto.sms ?? false,
        push: dto.push ?? false,
        minSeverity: minSeverity ?? NotificationSeverity.INFO,
      },
      update: {
        ...(dto.inApp !== undefined && { inApp: dto.inApp }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.sms !== undefined && { sms: dto.sms }),
        ...(dto.push !== undefined && { push: dto.push }),
        ...(minSeverity && { minSeverity }),
      },
    });

    return {
      category: saved.category.toLowerCase(),
      inApp: saved.inApp,
      email: saved.email,
      sms: saved.sms,
      push: saved.push,
      minSeverity: saved.minSeverity.toLowerCase(),
    };
  }

  // ────────────────────────────────────────────────────────────
  // NOTIFICATION RULES ENGINE
  // ────────────────────────────────────────────────────────────

  async findNotificationRules(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};
    return this.prisma.notificationRule.findMany({
      where: { ...factoryFilter },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createNotificationRule(factoryId: string | null, dto: {
    name: string;
    eventType: string;
    conditions?: Record<string, unknown>;
    channels: string[];
    recipientUserIds?: string[];
    recipientRoles?: string[];
    isActive?: boolean;
  }) {
    const resolvedFactoryId = factoryId ?? await this.getDefaultFactoryId();
    // Split eventType like "quality.ncr.critical" into module="quality" event="ncr.critical"
    const [module, ...eventParts] = dto.eventType.split('.');
    const event = eventParts.join('.') || dto.eventType;

    return this.prisma.notificationRule.create({
      data: {
        factoryId: resolvedFactoryId,
        name: dto.name,
        module,
        event,
        condition: (dto.conditions ?? {}) as Prisma.InputJsonValue,
        channels: dto.channels as Prisma.InputJsonValue,
        recipients: {
          userIds: dto.recipientUserIds ?? [],
          roles: dto.recipientRoles ?? [],
        } as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateNotificationRule(factoryId: string | null, ruleId: string, dto: {
    name?: string;
    conditions?: Record<string, unknown>;
    channels?: string[];
    recipientUserIds?: string[];
    recipientRoles?: string[];
    isActive?: boolean;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const rule = await this.prisma.notificationRule.findFirst({
      where: { id: ruleId, ...factoryFilter },
    });
    if (!rule) throw new NotFoundException('Notification rule not found');

    const existingRecipients = (rule.recipients as any) ?? { userIds: [], roles: [] };

    return this.prisma.notificationRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.conditions && { condition: dto.conditions as Prisma.InputJsonValue }),
        ...(dto.channels && { channels: dto.channels as Prisma.InputJsonValue }),
        ...((dto.recipientUserIds || dto.recipientRoles) && {
          recipients: {
            userIds: dto.recipientUserIds ?? existingRecipients.userIds,
            roles: dto.recipientRoles ?? existingRecipients.roles,
          } as Prisma.InputJsonValue,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteNotificationRule(factoryId: string | null, ruleId: string): Promise<void> {
    const factoryFilter = factoryId ? { factoryId } : {};
    const rule = await this.prisma.notificationRule.findFirst({
      where: { id: ruleId, ...factoryFilter },
    });
    if (!rule) throw new NotFoundException('Notification rule not found');
    await this.prisma.notificationRule.delete({ where: { id: ruleId } });
  }

  /**
   * Called by the event listener for custom rules. Returns the number of rules
   * that matched so the listener knows whether to also apply built-in defaults.
   */
  async evaluateRules(
    factoryId: string | null,
    eventType: string,
    eventData: Record<string, unknown>,
    base: { type: NotificationType; category: NotificationCategory; severity: NotificationSeverity; title: string; message: string; link?: string },
  ): Promise<number> {
    const factoryFilter = factoryId ? { factoryId } : {};
    const [module, ...eventParts] = eventType.split('.');
    const event = eventParts.join('.') || eventType;

    const rules = await this.prisma.notificationRule.findMany({
      where: { ...factoryFilter, module, event, isActive: true },
    });

    for (const rule of rules) {
      try {
        const channels = (rule.channels as Channel[]) ?? ['in_app'];
        const recipients = (rule.recipients as any) ?? { userIds: [], roles: [] };

        await this.dispatch({
          factoryId,
          type: base.type,
          category: base.category,
          severity: base.severity,
          title: this.interpolate(rule.name || base.title, eventData),
          message: this.interpolate(base.message, eventData),
          link: base.link,
          data: eventData,
          userIds: recipients.userIds ?? [],
          roles: (recipients.roles ?? []) as UserRole[],
          channels,
        });
      } catch (err) {
        this.logger.error(`Failed to evaluate rule ${rule.id}`, err as Error);
      }
    }

    return rules.length;
  }

  private interpolate(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ''));
  }

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    if (!factory) throw new NotFoundException('No factory found');
    return factory.id;
  }
}
