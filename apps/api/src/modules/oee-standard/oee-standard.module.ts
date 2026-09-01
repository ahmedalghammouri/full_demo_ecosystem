import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { OeeStandardService } from './oee-standard.service';
import { OeeStandardWriter } from './oee-standard.writer';
import { OeeStandardController } from './oee-standard.controller';
import { RejectReasonService } from './reject-reason.service';
import { StateTimelineService } from './state-timeline.service';
import { LineBasisService } from './line-basis.service';
import { PlannedStopMaterializerService } from './planned-stop-materializer.service';

/**
 * The standard OEE engine — self-contained on purpose.
 *
 * It shares the raw data with the rest of the system and nothing else: no
 * service, no helper, no cached total. That isolation is what makes the two
 * engines a comparison rather than a shared assumption wearing two names.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [OeeStandardController],
  providers: [
    OeeStandardService, OeeStandardWriter, StateTimelineService,
    RejectReasonService, LineBasisService, PlannedStopMaterializerService,
  ],
  exports: [
    OeeStandardService, StateTimelineService, RejectReasonService,
    LineBasisService, PlannedStopMaterializerService,
  ],
})
export class OeeStandardModule {}
