import { Module } from '@nestjs/common';
import { PowerQualityController } from './power-quality.controller';
import { PowerQualityService } from './power-quality.service';
import { PowerFactorService } from './power-factor.service';
import { SldService } from './sld.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [PowerQualityController],
  providers: [PowerQualityService, PowerFactorService, SldService],
  exports: [PowerQualityService, PowerFactorService, SldService],
})
export class PowerQualityModule {}
