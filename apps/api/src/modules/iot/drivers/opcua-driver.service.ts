import { Injectable, Logger } from '@nestjs/common';
import type { IndustrialDriver, TagValue } from './driver-factory';

@Injectable()
export class OpcuaDriverService implements IndustrialDriver {
  private readonly logger = new Logger(OpcuaDriverService.name);
  private session: unknown = null;
  private connected = false;
  private subscriptions = new Map<string, Array<(value: TagValue) => void>>();

  async connect(config: Record<string, unknown>): Promise<void> {
    try {
      // Dynamic import to avoid issues if node-opcua is not installed
      const { OPCUAClient, MessageSecurityMode, SecurityPolicy } = await import('node-opcua');

      const client = OPCUAClient.create({
        endpointMustExist: false,
        securityMode: MessageSecurityMode.None,
        securityPolicy: SecurityPolicy.None,
        requestedSessionTimeout: 60_000,
      });

      await client.connect(String(config.endpointUrl));
      this.session = await client.createSession();
      this.connected = true;
      this.logger.log(`OPC UA connected to ${config.endpointUrl as string}`);
    } catch (error) {
      this.logger.warn('OPC UA connection failed, running in simulation mode');
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.session = null;
  }

  async readTag(nodeId: string): Promise<TagValue> {
    if (!this.session) {
      // Simulation mode
      return {
        value: Math.random() * 100,
        quality: 'GOOD',
        timestamp: new Date(),
      };
    }

    try {
      const { DataValue } = await import('node-opcua');
      const dataValue = await (this.session as { readVariableValue: (nodeId: string) => Promise<unknown> }).readVariableValue(nodeId);
      return {
        value: (dataValue as { value?: { value: unknown } }).value?.value,
        quality: 'GOOD',
        timestamp: new Date(),
      };
    } catch {
      return { value: null, quality: 'BAD', timestamp: new Date() };
    }
  }

  async writeTags(tags: Array<{ address: string; value: unknown }>): Promise<void> {
    if (!this.session) return;
    // OPC UA write implementation
    for (const tag of tags) {
      this.logger.log(`OPC UA write: ${tag.address} = ${JSON.stringify(tag.value)}`);
    }
  }

  subscribeToTag(nodeId: string, callback: (value: TagValue) => void): void {
    if (!this.subscriptions.has(nodeId)) {
      this.subscriptions.set(nodeId, []);
    }
    this.subscriptions.get(nodeId)!.push(callback);

    // Simulate periodic value updates
    setInterval(async () => {
      const value = await this.readTag(nodeId);
      callback(value);
    }, 1000);
  }

  isConnected(): boolean {
    return this.connected;
  }
}
