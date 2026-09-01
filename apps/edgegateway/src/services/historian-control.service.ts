import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { InfluxService } from './influx.service';
import { MqttService } from './mqtt.service';

/** Broker-wide control topic published (retained) by the platform's System console. */
const HISTORIAN_CONTROL_TOPIC = 'industry360/control/historian';

/**
 * Lets the platform pause/resume this gateway's direct InfluxDB writes remotely.
 * The API's System → Reset console publishes `{ paused: boolean }` (retained) to
 * `industry360/control/historian`; we subscribe and flip the InfluxService kill-switch
 * so the historian bucket can be kept empty after a wipe.
 */
@Injectable()
export class HistorianControlService implements OnModuleInit {
  private readonly logger = new Logger(HistorianControlService.name);

  constructor(
    private readonly mqtt: MqttService,
    private readonly influx: InfluxService,
  ) {}

  onModuleInit() {
    this.mqtt.onControlMessage(HISTORIAN_CONTROL_TOPIC, (payload) => {
      const paused = !!payload?.paused;
      this.influx.setPaused(paused);
      this.logger.log(`Remote historian control → ${paused ? 'PAUSED' : 'ACTIVE'}`);
    });
    this.logger.log(`Listening for historian control on ${HISTORIAN_CONTROL_TOPIC}`);
  }
}
