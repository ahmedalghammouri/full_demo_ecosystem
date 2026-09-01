import { Injectable, Logger } from '@nestjs/common';
import type { IndustrialDriver, TagValue } from './driver-factory';

@Injectable()
export class ModbusDriverService implements IndustrialDriver {
  private readonly logger = new Logger(ModbusDriverService.name);
  private connected = false;
  private client: unknown = null;

  async connect(config: Record<string, unknown>): Promise<void> {
    try {
      const Modbus = await import('jsmodbus');
      const net = await import('net');

      const socket = new net.Socket();
      this.client = new (Modbus as unknown as { client: { TCP: new (...args: unknown[]) => unknown } }).client.TCP(socket);

      await new Promise<void>((resolve, reject) => {
        socket.connect({ host: String(config.host), port: Number(config.port || 502) }, () => {
          this.connected = true;
          this.logger.log(`Modbus TCP connected to ${config.host as string}:${config.port as number}`);
          resolve();
        });
        socket.on('error', reject);
        setTimeout(() => reject(new Error('Modbus connection timeout')), 5000);
      });
    } catch {
      this.logger.warn('Modbus TCP not available, running in simulation mode');
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.client = null;
  }

  async readTag(address: string): Promise<TagValue> {
    // Parse address format: FC:ADDR (e.g., "3:100" = Holding Register 100)
    const [fc, addr] = address.split(':').map(Number);

    if (!this.client) {
      // Simulation
      return { value: Math.floor(Math.random() * 4096), quality: 'GOOD', timestamp: new Date() };
    }

    try {
      const result = await (this.client as {
        readHoldingRegisters: (addr: number, count: number) => Promise<{ response: { body: { valuesAsArray: number[] } } }>;
      }).readHoldingRegisters(addr || 0, 1);
      return {
        value: result.response.body.valuesAsArray[0],
        quality: 'GOOD',
        timestamp: new Date(),
      };
    } catch {
      return { value: null, quality: 'BAD', timestamp: new Date() };
    }
  }

  async writeTags(tags: Array<{ address: string; value: unknown }>): Promise<void> {
    for (const tag of tags) {
      this.logger.log(`Modbus write: ${tag.address} = ${JSON.stringify(tag.value)}`);
    }
  }

  subscribeToTag(address: string, callback: (value: TagValue) => void): void {
    // Poll at 1 second
    setInterval(async () => {
      const value = await this.readTag(address);
      callback(value);
    }, 1000);
  }

  isConnected(): boolean {
    return this.connected;
  }
}
