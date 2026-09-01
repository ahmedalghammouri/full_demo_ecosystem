import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [ProductionModule], // KpiService → fact-store OEE reads
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
