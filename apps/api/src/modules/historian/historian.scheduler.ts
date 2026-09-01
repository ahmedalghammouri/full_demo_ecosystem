import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { HistorianService } from './historian.service';

/**
 * Every minute, snapshot the OEE / availability / production of every active job
 * order into the InfluxDB historian. Over time this builds the real time-series
 * the dashboards plot. Failures are swallowed — sampling must never disrupt run.
 */
@Injectable()
export class HistorianScheduler {
  private readonly logger = new Logger(HistorianScheduler.name);

  constructor(private readonly historian: HistorianService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (!this.historian.isEnabled()) return;
    try {
      await this.historian.sampleActiveJobOrders();
    } catch (err) {
      this.logger.error('Historian sampling tick failed', err as any);
    }
  }
}
