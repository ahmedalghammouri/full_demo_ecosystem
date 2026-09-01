import ModbusRTU from 'modbus-serial';
import type {
  ModbusOptions, ReadResult, RegisterType, TagBinding,
} from './types';
import { applyScaling, coerce } from './scaling';
import { decodeNumeric } from './decode';
import { planBlocks, type ReadBlock } from './block-planner';

/**
 * Reconnecting Modbus client (one per device) over three transports:
 *  - TCP      → connectTCP            (networked PLC/meter)
 *  - RTU      → connectRTUBuffered    (native serial / RS-485 COM port)
 *  - RTU_TCP  → connectTcpRTUBuffered (RTU framing over a serial-to-Ethernet gateway)
 *
 * Register reads + per-tag scaling/coercion are transport-independent.
 */
export class ModbusClient {
  private client = new ModbusRTU();
  private connected = false;
  private connecting: Promise<void> | null = null;

  constructor(private readonly opts: ModbusOptions) {}

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Best-effort close of the current client, releasing its serial/TCP handle.
   * Serial (RS-485) ports are exclusive on Windows: if a prior handle is left
   * open, the next connectRTUBuffered fails with "Access denied". So we must
   * close before reopening. Guarded with a timeout since modbus-serial's close
   * may never invoke its callback when the port isn't actually open.
   */
  private async closeQuietly(): Promise<void> {
    const c = this.client as unknown as { isOpen?: boolean; close?: (cb: () => void) => void };
    if (!c?.isOpen) return; // nothing open — avoid a needless delay on first connect
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try { c.close!(finish); } catch { finish(); }
      setTimeout(finish, 1500);
    });
  }

  /** Connect (idempotent). Concurrent callers share one in-flight attempt. */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.closeQuietly(); // release any leaked handle before reopening (prevents "Access denied")
      this.client = new ModbusRTU();
      this.client.setTimeout(this.opts.timeoutMs ?? 3000);
      const transport = this.opts.transport ?? 'TCP';
      const host = this.opts.host ?? '127.0.0.1';
      const port = this.opts.port ?? 502;
      if (transport === 'RTU') {
        await this.client.connectRTUBuffered(this.opts.serialPort ?? 'COM1', {
          baudRate: this.opts.baudRate ?? 9600,
          parity: this.opts.parity ?? 'none',
          dataBits: this.opts.dataBits ?? 8,
          stopBits: this.opts.stopBits ?? 1,
        });
      } else if (transport === 'RTU_TCP') {
        await this.client.connectTcpRTUBuffered(host, { port });
      } else {
        await this.client.connectTCP(host, { port });
      }
      this.client.setID(this.opts.unitId ?? 1);
      this.connected = true;
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.closeQuietly();
  }

  private async readRaw(registerType: RegisterType, address: number, count: number): Promise<number[] | boolean[]> {
    switch (registerType) {
      case 'HOLDING':  return (await this.client.readHoldingRegisters(address, count)).data;
      case 'INPUT':    return (await this.client.readInputRegisters(address, count)).data;
      case 'COIL':     return (await this.client.readCoils(address, count)).data;
      case 'DISCRETE': return (await this.client.readDiscreteInputs(address, count)).data;
      default:         throw new Error(`Unsupported register type: ${registerType}`);
    }
  }

  /** Decode a slice of a raw read into a tag's raw + scaled/coerced value. */
  private decodeTag(tag: TagBinding, data: number[] | boolean[], offset: number, span: number, timestamp: Date): ReadResult {
    const isBit = tag.registerType === 'COIL' || tag.registerType === 'DISCRETE';
    let raw: number | boolean | null;
    if (isBit) {
      raw = Boolean((data as boolean[])[offset]);
    } else {
      raw = decodeNumeric((data as number[]).slice(offset, offset + span), tag.dataType, span, tag.wordOrder ?? 'BIG');
    }
    const scaled = applyScaling(raw, { scaleFactor: tag.scaleFactor, offset: tag.offset });
    const value = coerce(scaled, tag.dataType);
    return { raw, value, quality: 'GOOD', timestamp };
  }

  /**
   * Classify a read failure. A Modbus EXCEPTION response (illegal data
   * value/address/function) means the link is healthy but that register is
   * unsupported — keep the connection. A genuine TRANSPORT error (timeout,
   * port/CRC, closed socket) marks us disconnected so the next read reconnects.
   */
  private handleReadError(err: unknown): string {
    const e = err as { message?: string; modbusCode?: number };
    const message = e?.message ?? String(err);
    const isProtocolException = e?.modbusCode != null || /modbus exception/i.test(message);
    if (!isProtocolException) this.connected = false;
    return message;
  }

  /**
   * Read one tag → raw + scaled/coerced value with quality. Never throws — a
   * failed read yields `{ raw: null, value: null, quality: 'BAD' }` and flips
   * the connection to disconnected so the poller reconnects.
   */
  async readTag(tag: TagBinding): Promise<ReadResult> {
    const timestamp = new Date();
    try {
      if (!this.connected) await this.connect();
      const isBit = tag.registerType === 'COIL' || tag.registerType === 'DISCRETE';
      const count = isBit ? 1 : Math.max(1, tag.wordCount ?? 1);
      const data = await this.readRaw(tag.registerType, tag.address, count);
      return this.decodeTag(tag, data, 0, count, timestamp);
    } catch (err) {
      return { raw: null, value: null, quality: 'BAD', timestamp, error: this.handleReadError(err) };
    }
  }

  /**
   * Read many tags in the fewest possible Modbus requests by coalescing them
   * into contiguous per-register-type blocks (see {@link planBlocks}), then
   * slicing each response back out per tag. Slashes round-trips vs. one request
   * per tag — the key to fast counter polling and light meter reads. Never
   * throws: a failed block yields BAD quality for its members and (for a
   * transport error) flips the connection so the next cycle reconnects. Returns
   * results keyed by tag id.
   */
  async readTagsBlocked(tags: TagBinding[]): Promise<Map<string, ReadResult>> {
    const results = new Map<string, ReadResult>();
    if (!tags.length) return results;
    const blocks: ReadBlock[] = planBlocks(tags);
    if (!this.connected) {
      try { await this.connect(); } catch (err) {
        const error = this.handleReadError(err);
        const ts = new Date();
        for (const t of tags) results.set(t.id, { raw: null, value: null, quality: 'BAD', timestamp: ts, error });
        return results;
      }
    }
    for (const block of blocks) {
      const timestamp = new Date();
      try {
        const data = await this.readRaw(block.registerType, block.start, block.count);
        for (const m of block.members) results.set(m.tag.id, this.decodeTag(m.tag, data, m.offset, m.span, timestamp));
      } catch (err) {
        const error = this.handleReadError(err);
        for (const m of block.members) results.set(m.tag.id, { raw: null, value: null, quality: 'BAD', timestamp, error });
        // Transport error dropped the connection — remaining blocks would just
        // time out; bail and let the next poll cycle reconnect.
        if (!this.connected) {
          const ts = new Date();
          for (const t of tags) if (!results.has(t.id)) results.set(t.id, { raw: null, value: null, quality: 'BAD', timestamp: ts, error });
          break;
        }
      }
    }
    return results;
  }
}
