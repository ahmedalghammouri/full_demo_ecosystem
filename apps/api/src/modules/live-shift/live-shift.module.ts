import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { OeeStandardModule } from '../oee-standard/oee-standard.module';
import { OeeScheduleModule } from '../oee-schedule/oee-schedule.module';
import { LiveShiftService } from './live-shift.service';
import { LiveShiftController } from './live-shift.controller';

/**
 * The live shift screen.
 *
 * It imports BOTH engines rather than reimplementing either. That is the whole
 * design: the live page and the analysis page are windows onto the same two
 * stores, so "this shift" cannot mean two different things depending on which
 * screen is open — and the OEE / OEE-TB switch means the same thing on both.
 */
@Module({
  imports: [DatabaseModule, OeeStandardModule, OeeScheduleModule],
  controllers: [LiveShiftController],
  providers: [LiveShiftService],
  exports: [LiveShiftService],
})
export class LiveShiftModule {}
