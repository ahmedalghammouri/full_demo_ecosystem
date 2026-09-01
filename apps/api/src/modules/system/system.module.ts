import { Module } from '@nestjs/common';

import { HistorianModule } from '../historian/historian.module';
import { IotModule } from '../iot/iot.module';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  imports: [HistorianModule, IotModule],
  controllers: [SystemController, BackupController],
  providers: [SystemService, BackupService, SystemOwnerGuard],
})
export class SystemModule {}
