import { Injectable } from '@nestjs/common';
import { MqttDriverService } from './mqtt-driver.service';
import { OpcuaDriverService } from './opcua-driver.service';
import { ModbusDriverService } from './modbus-driver.service';

export interface IndustrialDriver {
  connect(config: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  readTag(address: string): Promise<TagValue>;
  writeTags(tags: Array<{ address: string; value: unknown }>): Promise<void>;
  subscribeToTag(address: string, callback: (value: TagValue) => void): void;
  isConnected(): boolean;
}

export interface TagValue {
  value: unknown;
  quality: 'GOOD' | 'BAD' | 'UNCERTAIN';
  timestamp: Date;
}

export type ProtocolType = 'MQTT' | 'OPCUA' | 'MODBUS' | 'HTTP' | 'S7' | 'FINS';

@Injectable()
export class IndustrialDriverFactory {
  constructor(
    private readonly mqtt: MqttDriverService,
    private readonly opcua: OpcuaDriverService,
    private readonly modbus: ModbusDriverService,
  ) {}

  getDriver(protocol: ProtocolType): IndustrialDriver {
    switch (protocol) {
      case 'MQTT': return this.mqtt;
      case 'OPCUA': return this.opcua;
      case 'MODBUS': return this.modbus;
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  getSupportedProtocols(): ProtocolType[] {
    return ['MQTT', 'OPCUA', 'MODBUS', 'HTTP', 'S7', 'FINS'];
  }
}
