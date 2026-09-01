import { Module } from '@nestjs/common';

import { PlmController } from './plm.controller';
import { PlmService } from './plm.service';

@Module({
  controllers: [PlmController],
  providers: [PlmService],
  exports: [PlmService],
})
export class PlmModule {}
