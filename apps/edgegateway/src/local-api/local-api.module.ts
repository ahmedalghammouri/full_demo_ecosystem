import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AcquisitionModule } from '../acquisition/acquisition.module';
import { LocalApiController } from './local-api.controller';
import { AuthService } from './auth.service';
import { CountBalanceService } from './count-balance.service';
import { LineBalanceService } from './line-balance.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    AcquisitionModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwtSecret'),
      }),
    }),
  ],
  controllers: [LocalApiController],
  providers: [AuthService, JwtAuthGuard, CountBalanceService, LineBalanceService],
})
export class LocalApiModule {}
