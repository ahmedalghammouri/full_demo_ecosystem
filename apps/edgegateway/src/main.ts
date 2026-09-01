import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

// Load `.env` sitting next to the executable / working dir.
dotenv.config();

// Edge resilience: a transient sink outage (DB/MQTT/Influx unreachable) must
// never take the gateway process down — acquisition keeps running and buffers
// to disk. Log and continue instead of letting Node terminate on an unhandled
// rejection/exception.
const resilienceLogger = new Logger('Resilience');
process.on('unhandledRejection', (reason) => {
  resilienceLogger.error(`Unhandled rejection (ignored): ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on('uncaughtException', (err) => {
  resilienceLogger.error(`Uncaught exception (ignored): ${err.message}`);
});

function resolvePublicDir(): string | null {
  const candidates = [
    join(__dirname, '..', 'public'),
    join(process.cwd(), 'public'),
    join(process.cwd(), 'apps', 'edgegateway', 'public'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

async function bootstrap() {
  const logger = new Logger('EdgeGateway');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({ origin: true, credentials: true });

  const publicDir = resolvePublicDir();
  if (publicDir) {
    app.useStaticAssets(publicDir);
    logger.log(`Dashboard served from ${publicDir}`);
  } else {
    logger.warn('Dashboard assets not found — API only');
  }

  const port = parseInt(process.env.GATEWAY_PORT || '4900', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`Industry360° Edge Gateway listening on http://0.0.0.0:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal: failed to start edge gateway', err);
  process.exit(1);
});
