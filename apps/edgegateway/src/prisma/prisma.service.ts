import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
// Gateway-private generated client (output = src/generated/prisma) — kept separate
// from the MES API's shared @prisma/client so the two schemas never collide.
import { PrismaClient } from '../generated/prisma';

/**
 * Prisma client for the gateway. Connects to the SAME shared Postgres as the API
 * (DATABASE_URL points at the server). Generated from the API's schema via
 * `pnpm prisma:sync` into this package's own client.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connected to shared Postgres');
    } catch (err) {
      // Don't crash the service — the poller keeps reading and buffers to disk.
      this.logger.error('Postgres connection failed (will retry on use)', err as Error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
