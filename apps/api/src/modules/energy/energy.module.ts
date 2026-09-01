import { Module } from '@nestjs/common';
import { EnergyController } from './energy.controller';
import { EnergyService } from './energy.service';
import { EnergyWoMachineService } from './energy-wo-machine.service';
import { EnergyAnalyticsService } from './energy-analytics.service';
import { CarbonService } from './carbon.service';

@Module({
  controllers: [EnergyController],
  providers: [EnergyService, EnergyWoMachineService, EnergyAnalyticsService, CarbonService],
  exports: [EnergyService, EnergyWoMachineService, EnergyAnalyticsService, CarbonService],
})
export class EnergyModule {}
