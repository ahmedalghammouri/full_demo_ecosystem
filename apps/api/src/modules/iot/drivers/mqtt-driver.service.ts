import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as mqtt from 'mqtt';
import type { IndustrialDriver, TagValue } from './driver-factory';

@Injectable()
export class MqttDriverService implements IndustrialDriver, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttDriverService.name);
  private client: mqtt.MqttClient | null = null;
  private subscriptions = new Map<string, Array<(value: TagValue) => void>>();
  private connected = false;

  constructor(
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    const brokerUrl = this.config.get<string>('mqtt.brokerUrl');
    if (!brokerUrl) return;

    try {
      await this.connect({
        brokerUrl,
        username: this.config.get<string>('mqtt.username'),
        password: this.config.get<string>('mqtt.password'),
        clientId: this.config.get<string>('mqtt.clientId', 'industry360'),
      });
    } catch (error) {
      this.logger.warn('MQTT broker not available, running in offline mode');
    }
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async connect(config: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: mqtt.IClientOptions = {
        clientId: String(config.clientId || 'industry360'),
        username: config.username as string | undefined,
        password: config.password as string | undefined,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        keepalive: 60,
      };

      this.client = mqtt.connect(String(config.brokerUrl), options);

      this.client.on('connect', () => {
        this.connected = true;
        this.logger.log('MQTT broker connected');
        resolve();
      });

      this.client.on('error', (err) => {
        this.logger.error('MQTT error:', err.message);
        if (!this.connected) reject(err);
      });

      this.client.on('reconnect', () => {
        this.logger.log('MQTT reconnecting...');
      });

      this.client.on('message', (topic: string, payload: Buffer) => {
        this.handleMessage(topic, payload);
      });
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.client) { resolve(); return; }
      this.client.end(false, {}, () => {
        this.connected = false;
        resolve();
      });
    });
  }

  async readTag(topic: string): Promise<TagValue> {
    return new Promise((resolve, reject) => {
      if (!this.client?.connected) {
        reject(new Error('MQTT not connected'));
        return;
      }
      // Subscribe temporarily and get next value
      const handler = (value: TagValue) => {
        resolve(value);
        this.subscriptions.get(topic)?.splice(
          this.subscriptions.get(topic)!.indexOf(handler), 1,
        );
      };
      this.subscribeToTag(topic, handler);
      setTimeout(() => reject(new Error('Read timeout')), 5000);
    });
  }

  async writeTags(tags: Array<{ address: string; value: unknown }>): Promise<void> {
    if (!this.client?.connected) throw new Error('MQTT not connected');
    for (const tag of tags) {
      await new Promise<void>((resolve, reject) => {
        this.client!.publish(
          `${tag.address}/set`,
          JSON.stringify(tag.value),
          { qos: 1 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    }
  }

  subscribeToTag(topic: string, callback: (value: TagValue) => void): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
      this.client?.subscribe(topic, { qos: 1 });
    }
    this.subscriptions.get(topic)!.push(callback);
  }

  publish(topic: string, payload: unknown, qos: 0 | 1 | 2 = 1, retain = false): void {
    if (!this.client?.connected) return;
    this.client.publish(topic, JSON.stringify(payload), { qos, retain });
  }

  isConnected(): boolean {
    return this.connected && (this.client?.connected ?? false);
  }

  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const rawValue = payload.toString();
      let parsedValue: unknown = rawValue;
      try { parsedValue = JSON.parse(rawValue); } catch {}

      const tagValue: TagValue = {
        value: parsedValue,
        quality: 'GOOD',
        timestamp: new Date(),
      };

      // Invoke topic subscribers
      this.subscriptions.get(topic)?.forEach((cb) => cb(tagValue));

      // Emit event for other modules
      this.eventEmitter.emit('iot.tag.value', { topic, ...tagValue });
    } catch (error) {
      this.logger.error(`Error processing MQTT message on ${topic}`, error);
    }
  }
}
