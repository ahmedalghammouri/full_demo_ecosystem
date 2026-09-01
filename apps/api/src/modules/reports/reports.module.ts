import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [ProductionModule], // KpiService — canonical base-unit OEE/output source
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
