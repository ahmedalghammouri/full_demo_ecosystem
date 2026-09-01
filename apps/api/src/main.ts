import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WinstonModule } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import * as winston from 'winston';

import { AppModule } from './app.module';
import { corsOriginCallback, getCorsOrigins } from './common/cors.util';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, context }) => {
            return `${timestamp as string} [${level}] ${context ? `[${context as string}] ` : ''}${message as string}`;
          }),
        ),
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
    ],
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  const configService = app.get(ConfigService);

  // Security
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
      },
    },
  }));
  app.use(compression());

  // CORS — policy shared with the WebSocket gateway (see common/cors.util.ts)
  const corsOrigins = getCorsOrigins(configService.get<string>('CORS_ORIGINS'));
  const appLogger = new Logger('Bootstrap');
  appLogger.log(`CORS allow-list: ${corsOrigins.join(', ')} (+ LAN ranges & *.industry360/*.industry360 .com/.sa)`);
  app.enableCors({
    origin: corsOriginCallback(corsOrigins),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Request-ID'],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Global prefix
  const apiPrefix = configService.get<string>('API_PREFIX', '/api/v1');
  app.setGlobalPrefix(apiPrefix, { exclude: ['/health', '/metrics'] });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters and interceptors
  app.useGlobalFilters(new HttpExceptionFilter());
  // AuditInterceptor is registered via APP_INTERCEPTOR in AppModule (needs DI).
  app.useGlobalInterceptors(new TransformInterceptor());

  // Trust proxy
  app.set('trust proxy', 1);

  // Swagger API Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('i360 Platform API')
    .setDescription(
      'Enterprise Manufacturing Execution System REST API. ' +
      'Provides endpoints for production, quality, maintenance, IIoT, and analytics.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT-auth',
    )
    .addTag('Authentication', 'User authentication and authorization')
    .addTag('Dashboard', 'Real-time operations dashboard')
    .addTag('Production', 'Production orders, batches, and OEE')
    .addTag('Quality', 'Quality management, NCR, CAPA, SPC')
    .addTag('Maintenance', 'CMMS/EAM work orders and assets')
    .addTag('IIoT', 'Industrial IoT devices and connectivity')
    .addTag('Reports', 'Reporting and analytics')
    .addTag('Users', 'User and role management')
    .addTag('Hierarchy', 'Plant hierarchy and equipment')
    .addServer(`http://localhost:${configService.get('API_PORT', '4001')}`, 'Development')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  });

  const port = configService.get<number>('API_PORT', 4001);
  await app.listen(port);

  appLogger.log(`🚀 i360 API running on port ${port}`);
  appLogger.log(`📚 Swagger docs: http://localhost:${port}${apiPrefix}/docs`);
  appLogger.log(`🌍 Environment: ${configService.get('NODE_ENV', 'development')}`);
}

void bootstrap();
