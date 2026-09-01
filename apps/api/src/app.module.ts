import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '@nestjs/cache-manager';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ProductionModule } from './modules/production/production.module';
import { OeeStandardModule } from './modules/oee-standard/oee-standard.module';
import { LiveShiftModule } from './modules/live-shift/live-shift.module';
import { OeeScheduleModule } from './modules/oee-schedule/oee-schedule.module';
import { QualityModule } from './modules/quality/quality.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ReliabilityModule } from './modules/reliability/reliability.module';
import { IotModule } from './modules/iot/iot.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HierarchyModule } from './modules/hierarchy/hierarchy.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { EnergyModule } from './modules/energy/energy.module';
import { PowerQualityModule } from './modules/power-quality/power-quality.module';
import { EcosystemModule } from './modules/ecosystem/ecosystem.module';
import { TraceabilityModule } from './modules/traceability/traceability.module';
import { AiModule } from './modules/ai/ai.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { ShiftModule } from './modules/shift/shift.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { ApsModule } from './modules/aps/aps.module';
import { PlmModule } from './modules/plm/plm.module';
import { WebSocketGatewayModule } from './gateways/websocket.module';
import { HealthModule } from './modules/health/health.module';
import { ArchiveModule } from './modules/archive/archive.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AlarmsModule } from './modules/alarms/alarms.module';
import { PlantDashboardsModule } from './modules/plant-dashboards/plant-dashboards.module';
import { HistorianModule } from './modules/historian/historian.module';
import { SystemModule } from './modules/system/system.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RbacGuard } from './common/guards/rbac.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { configuration } from './config/configuration';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),

    // Throttler (rate limiting)
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
            // The old default of 100/60s was lower than the cost of a single
            // dashboard load, so ordinary navigation tripped it and KPI cards
            // rendered 0 from failed requests. The limit is keyed per IP and every
            // browser behind Docker shares one, so it must budget for the whole
            // plant, not one user. Override with THROTTLE_LIMIT.
            limit: config.get<number>('THROTTLE_LIMIT', 2000),
          },
        ],
      }),
    }),

    // Redis Cache
    //
    // `redisStore` takes ioredis `RedisOptions`, which has no `url` key — a URL
    // is only accepted as the positional argument to `new Redis(url)`. Passing
    // `{ url }` here was silently dropped and ioredis fell back to its default
    // 127.0.0.1:6379, so the cache never connected anywhere but localhost and
    // the only symptom was an endless stream of unhandled ECONNREFUSED events.
    // Parse REDIS_URL into the fields the store actually reads.
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const raw = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        let host = config.get<string>('REDIS_HOST', 'localhost');
        let port = config.get<number>('REDIS_PORT', 6379);
        let password = config.get<string>('REDIS_PASSWORD') || undefined;
        try {
          const u = new URL(raw);
          host = u.hostname || host;
          port = u.port ? Number(u.port) : port;
          password = u.password || password;
        } catch {
          // A malformed REDIS_URL falls back to the discrete host/port vars
          // rather than taking the library's localhost default.
        }
        return {
          store: await import('cache-manager-ioredis-yet').then((m) => m.redisStore),
          host,
          port,
          password,
          ttl: 60_000,
        };
      },
    }),

    // Bull Queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),

    // Scheduler
    ScheduleModule.forRoot(),

    // Event emitter
    EventEmitterModule.forRoot({ wildcard: true, delimiter: ':' }),

    // Core modules
    DatabaseModule,
    AuthModule,
    UsersModule,
    RbacModule,
    DashboardModule,
    ReliabilityModule, // canonical MTBF/MTTR engine — global, consumed by production/maintenance/reports
    ProductionModule,
    OeeStandardModule,
    LiveShiftModule,
    OeeScheduleModule,
    QualityModule,
    MaintenanceModule,
    IotModule,
    ReportsModule,
    NotificationsModule,
    HierarchyModule,
    InventoryModule,
    EnergyModule,
    // Served only to factories whose classification grants the capability;
    // the service refuses rather than returning an empty set.
    PowerQualityModule,
    // Reports the platform against the Application Suite, locked modules included.
    EcosystemModule,
    TraceabilityModule,
    AiModule,
    DashboardsModule,
    ShiftModule,
    SchedulingModule,
    ApsModule,
    PlmModule,
    AlarmsModule,
    PlantDashboardsModule,
    HistorianModule,
    SystemModule,
    WebSocketGatewayModule,
    HealthModule,
    ArchiveModule,
    AttachmentsModule,
  ],
  providers: [
    // Global guards — order matters: authenticate (sets req.user + permissions),
    // resolve tenant, then enforce RBAC (@Roles / @RequirePermissions), then throttle.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Global audit-trail interceptor (DI-provided so Reflector + Prisma inject)
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Request logging middleware
  }
}
