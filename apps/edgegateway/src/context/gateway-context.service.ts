import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'node:os';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves this gateway's identity in the shared DB: finds its factory, then
 * upserts a `Gateway` row (by GATEWAY_ID, or by name+factory). Exposes the
 * resolved ids to the poller/heartbeat. Safe to call repeatedly — used to
 * (re)establish identity after a DB outage.
 */
@Injectable()
export class GatewayContextService implements OnModuleInit {
  private readonly logger = new Logger(GatewayContextService.name);
  private gatewayId: string | null = null;
  private factoryId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.resolve();
  }

  getGatewayId() { return this.gatewayId; }
  getFactoryId() { return this.factoryId; }
  isReady() { return !!this.gatewayId; }

  async resolve(): Promise<boolean> {
    try {
      const code = this.config.get<string>('factoryCode');
      const factory = code
        ? await this.prisma.factory.findUnique({ where: { code: code.toUpperCase() } })
        : await this.prisma.factory.findFirst({ where: { isActive: true } });
      if (!factory) {
        this.logger.warn(`Factory not found (code=${code ?? 'any'}) — retrying later`);
        return false;
      }
      this.factoryId = factory.id;

      const name = this.config.get<string>('gatewayName') ?? 'Edge Gateway';
      const envId = this.config.get<string>('gatewayId');
      const base = {
        factoryId: factory.id,
        name,
        hostname: os.hostname(),
        version: process.env.npm_package_version ?? '1.0.0',
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
        isActive: true,
      };

      let gw;
      if (envId) {
        gw = await this.prisma.gateway.upsert({
          where: { id: envId },
          create: { id: envId, ...base },
          update: { status: 'ONLINE', lastHeartbeatAt: base.lastHeartbeatAt, hostname: base.hostname, version: base.version },
        });
      } else {
        gw = await this.prisma.gateway.findFirst({ where: { factoryId: factory.id, name } });
        gw = gw
          ? await this.prisma.gateway.update({ where: { id: gw.id }, data: { status: 'ONLINE', lastHeartbeatAt: base.lastHeartbeatAt, hostname: base.hostname } })
          : await this.prisma.gateway.create({ data: base });
      }
      this.gatewayId = gw.id;
      this.logger.log(`Gateway identity ready: ${gw.name} (${gw.id}) @ factory ${factory.code}`);
      return true;
    } catch (err) {
      this.logger.error('Failed to resolve gateway identity', err as Error);
      return false;
    }
  }
}
