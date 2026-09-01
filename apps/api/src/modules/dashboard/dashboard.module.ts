import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ProductionModule } from '../production/production.module';
import { ShiftModule } from '../shift/shift.module';
import { EnergyModule } from '../energy/energy.module';

@Module({
  // KpiService (OEE engine) + ShiftService (current-shift analysis) + EnergyService
  // (consumption/cost/live power) — composed by the Command Center cockpit.
  imports: [ProductionModule, ShiftModule, EnergyModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
