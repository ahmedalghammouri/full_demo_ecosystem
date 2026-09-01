import { Global, Module } from '@nestjs/common';
import { ReliabilityService } from './reliability.service';

/**
 * Canonical MTBF/MTTR engine. Global so every KPI surface (maintenance cockpit,
 * downtime command center, analytics reports) resolves the same instance and the
 * same definitions — see ReliabilityService for the classification rules.
 */
@Global()
@Module({
  providers: [ReliabilityService],
  exports: [ReliabilityService],
})
export class ReliabilityModule {}
