import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { GatewayContextService } from './gateway-context.service';

/**
 * Periodically stamps the gateway's `lastHeartbeatAt` so the cloud dashboard can
 * show ONLINE/OFFLINE. Also re-resolves identity if it wasn't ready (e.g. DB was
 * down at startup).
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: GatewayContextService,
    private readonly config: ConfigService,
  ) {}

  @Interval('gateway-heartbeat', 15_000)
  async beat() {
    if (!this.ctx.isReady()) {
      await this.ctx.resolve();
      return;
    }
    const id = this.ctx.getGatewayId();
    if (!id) return;
    try {
      await this.prisma.gateway.update({
        where: { id },
        data: { status: 'ONLINE', lastHeartbeatAt: new Date(), lastError: null },
      });
    } catch (err) {
      this.logger.debug(`Heartbeat failed: ${(err as Error).message}`);
    }
  }
}
