import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mqtt from 'mqtt';

/**
 * Thin MQTT publisher to the SAME broker the platform uses. Auto-reconnects.
 * Publishing is best-effort: when offline, `publish` returns false and the
 * caller buffers the payload to disk. (Mirrors the API's mqtt-driver pattern.)
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private readonly controlHandlers = new Map<string, (payload: any) => void>();

  constructor(private readonly config: ConfigService) {}

  /**
   * Subscribe to a control topic and run `cb` on each message. Survives
   * reconnects (re-subscribed on every 'connect'). Retained messages are
   * delivered immediately on subscribe, so the handler picks up current state.
   */
  onControlMessage(topic: string, cb: (payload: any) => void) {
    this.controlHandlers.set(topic, cb);
    if (this.client?.connected) this.client.subscribe(topic, { qos: 1 });
  }

  onModuleInit() {
    const brokerUrl = this.config.get<string>('mqtt.brokerUrl');
    if (!brokerUrl) {
      this.logger.warn('MQTT broker not configured — publishing disabled.');
      return;
    }
    this.client = mqtt.connect(brokerUrl, {
      clientId: `industry360-edge-${this.config.get<string>('gatewayName') ?? 'gw'}-${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      keepalive: 60,
    });
    this.client.on('connect', () => {
      this.connected = true;
      this.logger.log(`MQTT broker connected → ${brokerUrl}`);
      // (Re)subscribe to all registered control topics on every connect.
      for (const topic of this.controlHandlers.keys()) {
        this.client!.subscribe(topic, { qos: 1 });
      }
    });
    this.client.on('reconnect', () => this.logger.debug('MQTT reconnecting…'));
    this.client.on('error', (err) => this.logger.error(`MQTT error: ${err.message}`));
    this.client.on('close', () => { this.connected = false; });
    this.client.on('message', (topic, message) => {
      const cb = this.controlHandlers.get(topic);
      if (!cb) return;
      try {
        cb(JSON.parse(message.toString()));
      } catch (err) {
        this.logger.error(`Bad control message on ${topic}`, err as Error);
      }
    });
  }

  async onModuleDestroy() {
    await new Promise<void>((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, () => resolve());
    });
  }

  isConnected() {
    return this.connected;
  }

  /** Best-effort publish; returns false when the broker is unreachable. */
  publish(topic: string, payload: unknown, qos: 0 | 1 | 2 = 1): boolean {
    if (!this.client?.connected) return false;
    try {
      this.client.publish(topic, JSON.stringify(payload), { qos });
      return true;
    } catch (err) {
      this.logger.error(`MQTT publish failed on ${topic}`, err as Error);
      return false;
    }
  }
}
