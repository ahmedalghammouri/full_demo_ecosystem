import { Module } from '@nestjs/common';

import { InfluxService } from './influx.service';
import { HistorianService } from './historian.service';
import { HistorianScheduler } from './historian.scheduler';
import { HistorianController } from './historian.controller';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';

@Module({
  controllers: [HistorianController],
  // SystemOwnerGuard is provided here too (not only in SystemModule) because the
  // snapshot rebuild endpoint rewrites the fact store and must be gated the same way
  // as the Danger Zone it belongs to.
  providers: [InfluxService, HistorianService, HistorianScheduler, SystemOwnerGuard],
  exports: [HistorianService, InfluxService],
})
export class HistorianModule {}
