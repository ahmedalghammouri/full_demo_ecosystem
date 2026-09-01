import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Append-only Modbus error log written to `<logDir>/modbus-error.log`.
 *
 * Read failures (timeouts, CRC errors, port errors) are swallowed by the driver
 * into a BAD quality so acquisition keeps running — but the operator still needs
 * a durable record to diagnose a wiring/RS485/parity fault. Every failure is
 * appended here as one timestamped line; the file rotates to `.1` past ~5 MB so
 * it can't grow unbounded on a device that's down for a long time.
 */
@Injectable()
export class ModbusLogService {
  private readonly logger = new Logger(ModbusLogService.name);
  private readonly dir: string;
  private readonly file: string;
  private readonly maxBytes = 5 * 1024 * 1024;

  constructor(config: ConfigService) {
    this.dir = config.get<string>('logDir') ?? './logs';
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      this.logger.warn(`Could not create log dir ${this.dir}: ${(err as Error).message}`);
    }
    this.file = join(this.dir, 'modbus-error.log');
  }

  /** Append one timestamped error line. Never throws (logging must not break polling). */
  log(device: string, context: string, message: string, extra?: Record<string, unknown>): void {
    const meta = extra && Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
    const line = `${new Date().toISOString()} [${device}] ${context}: ${message}${meta}\n`;
    try {
      this.rotateIfNeeded();
      appendFileSync(this.file, line);
    } catch (err) {
      this.logger.debug(`modbus-error.log write failed: ${(err as Error).message}`);
    }
  }

  /** Return the last `n` lines of the error log (for the dashboard). */
  tail(n = 200): string[] {
    try {
      if (!existsSync(this.file)) return [];
      return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-n);
    } catch {
      return [];
    }
  }

  path(): string {
    return this.file;
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.file).size > this.maxBytes) renameSync(this.file, this.file + '.1');
    } catch {
      /* file may not exist yet — nothing to rotate */
    }
  }
}
