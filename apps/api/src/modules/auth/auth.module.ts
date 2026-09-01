import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
// The public landing overview reports OEE, and there is exactly one engine that
// computes OEE. Nothing imports AuthModule except itself, so this direction is
// safe -- verified before adding it, because a cycle here breaks every guard.
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [
    ProductionModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? config.get<string>('jwt.expiresIn') ?? '8h',
          issuer: 'industry360',
          audience: 'industry360-users',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
