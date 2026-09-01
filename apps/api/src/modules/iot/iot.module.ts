import { Module } from '@nestjs/common';
import { IotController } from './iot.controller';
import { IotService } from './iot.service';
import { MqttDriverService } from './drivers/mqtt-driver.service';
import { OpcuaDriverService } from './drivers/opcua-driver.service';
import { ModbusDriverService } from './drivers/modbus-driver.service';
import { IndustrialDriverFactory } from './drivers/driver-factory';
import { EnergyContextService } from './energy-context.service';
import { GatewayIngestService } from './gateway-ingest.service';
import { MqttMonitorService } from './mqtt-monitor.service';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [ProductionModule], // KpiService — reflect auto counts into WO/PO OEE + events
  controllers: [IotController],
  providers: [
    IotService,
    MqttDriverService,
    OpcuaDriverService,
    ModbusDriverService,
    IndustrialDriverFactory,
    EnergyContextService,
    GatewayIngestService,
    MqttMonitorService,
  ],
  exports: [IotService, IndustrialDriverFactory, EnergyContextService, MqttMonitorService],
})
export class IotModule {}
