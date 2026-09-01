// Shared types for the industrial-drivers package. Kept dependency-free so the
// counter/scaling logic is portable and unit-testable on its own.

/** Modbus register class. Mirrors TagDefinition.registerType strings. */
export type RegisterType = 'HOLDING' | 'INPUT' | 'COIL' | 'DISCRETE';

/** Tag value primitive type. Mirrors the Prisma TagDataType enum. */
export type ModbusDataType = 'BOOL' | 'INT' | 'FLOAT' | 'STRING' | 'TIMESTAMP';

/** Counter role. Mirrors the Prisma CounterRole enum. */
export type CounterRole = 'TOTAL' | 'GOOD' | 'BAD' | 'NONE';

/** Reading quality. Mirrors the Prisma TagQuality enum. */
export type Quality = 'GOOD' | 'BAD' | 'UNCERTAIN' | 'NOT_CONNECTED';

/** How an edge is detected for COUNTER tags. */
/**
 * How a counter tag turns readings into counts.
 *
 * RISING/FALLING/CHANGE watch a boolean LEVEL and count its transitions. They
 * can only see a pulse the gateway happens to sample while it is present, so
 * their accuracy is bounded by the poll rate — measured on this plant's line,
 * a pulse lasting one sample or less, which cannot be counted reliably at any
 * software setting.
 *
 * TOTALIZER reads a register the DEVICE accumulates, and counts the difference
 * between readings. The device sees every pulse in hardware, so the count does
 * not depend on when the gateway looks — poll it once a second or once a minute
 * and the total is the same. It is the only mode that is correct for a signal
 * faster than the transport.
 */
export type EdgeType = 'RISING' | 'FALLING' | 'CHANGE' | 'TOTALIZER';

/** Word order for multi-register (32-bit) values. */
export type WordOrder = 'BIG' | 'LITTLE';

/** A single acquisition binding: where to read a tag and how to interpret it. */
export interface TagBinding {
  id: string;
  code: string;
  /** Numeric register address (e.g. 100). 4xxxx/3xxxx prefixes are normalised by the caller. */
  address: number;
  registerType: RegisterType;
  dataType: ModbusDataType;
  /** 1 = single 16-bit register, 2 = 32-bit across two registers. */
  wordCount?: number;
  wordOrder?: WordOrder;
  scaleFactor?: number | null;
  offset?: number | null;
  counterRole?: CounterRole | null;
  edgeType?: EdgeType;
}

/** Result of reading one tag from a device. */
export interface ReadResult {
  /** Raw value before scaling (number for registers, boolean for coils/discretes). */
  raw: number | boolean | null;
  /** Scaled/coerced value ready to persist. */
  value: number | boolean | string | null;
  quality: Quality;
  timestamp: Date;
  /** On a failed read (quality !== GOOD), the underlying error message (e.g. "Timed out", "CRC error"). */
  error?: string;
}

/** Modbus transport: TCP, native serial (RTU), or RTU framing over a TCP socket. */
export type ModbusTransport = 'TCP' | 'RTU' | 'RTU_TCP';

/** Connection parameters for a Modbus device (TCP or serial). */
export interface ModbusOptions {
  transport?: ModbusTransport; // default TCP
  /** TCP / RTU-over-TCP */
  host?: string;
  port?: number;
  /** Native serial (RTU) */
  serialPort?: string; // COM3 | /dev/ttyUSB0
  baudRate?: number;
  parity?: 'none' | 'even' | 'odd';
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  /** Modbus unit / slave id. */
  unitId?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

/** @deprecated use ModbusOptions */
export type ModbusTcpOptions = ModbusOptions;
