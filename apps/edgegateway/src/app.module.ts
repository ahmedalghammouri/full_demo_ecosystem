import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { ServicesModule } from './services/services.module';
import { ContextModule } from './context/context.module';
import { AcquisitionModule } from './acquisition/acquisition.module';
import { LocalApiModule } from './local-api/local-api.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ServicesModule,
    ContextModule,
    AcquisitionModule,
    LocalApiModule,
  ],
})
export class AppModule {}
