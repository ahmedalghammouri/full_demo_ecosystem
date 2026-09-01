import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { OeeScheduleService } from './oee-schedule.service';
import { OeeScheduleWriter } from './oee-schedule.writer';
import { OeeScheduleController } from './oee-schedule.controller';
import { RejectReasonService } from '../oee-standard/reject-reason.service';
import { StateTimelineService } from '../oee-standard/state-timeline.service';
import { LineBasisService } from '../oee-standard/line-basis.service';

/**
 * The schedule-basis engine. Self-contained apart from the minute
 * classification, which it shares with the standard engine because it is
 * literally the same question — see minute-classification.ts.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [OeeScheduleController],
  providers: [OeeScheduleService, OeeScheduleWriter, StateTimelineService, RejectReasonService, LineBasisService],
  exports: [OeeScheduleService],
})
export class OeeScheduleModule {}
