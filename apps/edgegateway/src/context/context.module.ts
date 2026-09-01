import { Global, Module } from '@nestjs/common';
import { GatewayContextService } from './gateway-context.service';
import { HeartbeatService } from './heartbeat.service';

@Global()
@Module({
  providers: [GatewayContextService, HeartbeatService],
  exports: [GatewayContextService],
})
export class ContextModule {}
