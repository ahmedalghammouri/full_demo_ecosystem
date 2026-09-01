import { Module } from '@nestjs/common';
import { PlantDashboardsController } from './plant-dashboards.controller';
import { PlantDashboardsService } from './plant-dashboards.service';
import { ProductionModule } from '../production/production.module';
import { EnergyModule } from '../energy/energy.module';
import { StorageModule } from '../storage/storage.module';

// PrismaService comes from the @Global DatabaseModule; ProductionModule +
// EnergyModule export the KpiService / EnergyService the live-data engine reuses;
// StorageModule stores background images.
@Module({
  imports: [ProductionModule, EnergyModule, StorageModule],
  controllers: [PlantDashboardsController],
  providers: [PlantDashboardsService],
  exports: [PlantDashboardsService],
})
export class PlantDashboardsModule {}
