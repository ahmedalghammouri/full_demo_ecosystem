import { Global, Module } from '@nestjs/common';
import { InfluxService } from './influx.service';
import { MqttService } from './mqtt.service';
import { HistorianControlService } from './historian-control.service';

@Global()
@Module({
  providers: [InfluxService, MqttService, HistorianControlService],
  exports: [InfluxService, MqttService],
})
export class ServicesModule {}
