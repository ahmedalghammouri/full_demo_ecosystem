import { Module } from '@nestjs/common';
import { PowerQualityController } from './power-quality.controller';
import { PowerQualityService } from './power-quality.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [PowerQualityController],
  providers: [PowerQualityService],
  exports: [PowerQualityService],
})
export class PowerQualityModule {}
