import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';
import { GrafanaService } from './grafana.service';

@Module({
  controllers: [DashboardsController],
  providers: [DashboardsService, GrafanaService],
  exports: [DashboardsService, GrafanaService],
})
export class DashboardsModule {}
