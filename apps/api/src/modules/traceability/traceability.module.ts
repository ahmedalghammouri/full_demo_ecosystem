import { Module } from '@nestjs/common';
import { TraceabilityController } from './traceability.controller';
import { TraceabilityService } from './traceability.service';

@Module({
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
  // Export so MaintenanceService, ProductionService, etc. can inject it
  exports: [TraceabilityService],
})
export class TraceabilityModule {}
