import { Module } from '@nestjs/common';

import { ShiftService } from './shift.service';
import { PlannedStopService } from './planned-stop.service';
import { WorkOrderStopService } from './work-order-stop.service';
import { ShiftController } from './shift.controller';
import { PlannedStopController } from './planned-stop.controller';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [ProductionModule], // KpiService → fact-store OEE reads
  controllers: [ShiftController, PlannedStopController],
  providers: [ShiftService, PlannedStopService, WorkOrderStopService],
  // WorkOrderStopService is exported so the production module can fire
  // work-order stop rules when a job order starts — that is the only moment the
  // system can see both the incoming order and what ran before it.
  exports: [ShiftService, PlannedStopService, WorkOrderStopService],
})
export class ShiftModule {}
