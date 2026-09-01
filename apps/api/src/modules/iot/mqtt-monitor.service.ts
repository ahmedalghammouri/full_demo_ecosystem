import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { MqttDriverService } from './drivers/mqtt-driver.service';

export interface MqttMessage {
  topic: string;
  payload: unknown;
  quality?: string;
  receivedAt: string;
}

/**
 * Live MQTT monitor — subscribes to the whole `industry360/#` namespace so the in-app
 * "MQTT Client" can show every message the edge gateways publish. Keeps a capped
 * in-memory ring buffer for history and re-emits each message (`iot.mqtt.message`)
 * for the WebSocket gateway to stream to the browser.
 *
 * NOTE: this is a live monitor only — nothing here is persisted to Postgres
 * (high-frequency telemetry lives in InfluxDB), so it adds no DB load.
 */
@Injectable()
export class MqttMonitorService implements OnModuleInit {
  private readonly logger = new Logger(MqttMonitorService.name);
  private readonly buffer: MqttMessage[] = [];
  private readonly MAX = 1000;
  /** Distinct topics seen (for the topic tree), capped. */
  private readonly topics = new Set<string>();

  constructor(
    private readonly mqtt: MqttDriverService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    try {
      // Broaden the broker subscription to the full platform namespace; every
      // received message already fans out as `iot.tag.value`, which we capture below.
      this.mqtt.subscribeToTag('industry360/#', () => undefined);
      this.logger.log('MQTT monitor subscribed to industry360/#');
    } catch (err) {
      this.logger.warn(`MQTT monitor could not subscribe: ${(err as Error).message}`);
    }
  }

  @OnEvent('iot.tag.value')
  capture(payload: { topic: string; value: unknown; quality?: string; timestamp?: Date }) {
    if (!payload?.topic) return;
    const msg: MqttMessage = {
      topic: payload.topic,
      payload: payload.value,
      quality: payload.quality,
      receivedAt: (payload.timestamp instanceof Date ? payload.timestamp : new Date()).toISOString(),
    };
    this.buffer.push(msg);
    if (this.buffer.length > this.MAX) this.buffer.shift();
    if (this.topics.size < 2000) this.topics.add(payload.topic);
    // Stream to the browser monitor.
    this.eventEmitter.emit('iot.mqtt.message', msg);
  }

  /** Recent messages, newest first, optionally filtered by a topic substring. */
  getMessages(filter?: string, limit = 200): MqttMessage[] {
    let rows = this.buffer;
    if (filter) {
      const f = filter.toLowerCase();
      rows = rows.filter((m) => m.topic.toLowerCase().includes(f));
    }
    return rows.slice(-limit).reverse();
  }

  /** Distinct topics seen this session (for building a topic tree). */
  getTopics(): string[] {
    return [...this.topics].sort();
  }

  /** Publish a message to the broker (manual control plane / testing). */
  publish(topic: string, payload: unknown, retain = false): void {
    this.mqtt.publish(topic, payload, 1, retain);
  }

  stats() {
    return { buffered: this.buffer.length, topics: this.topics.size, connected: this.mqtt.isConnected() };
  }
}
