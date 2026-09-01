import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny append-only disk buffer (JSONL) used when a downstream sink is offline.
 * Records are appended on failure and replayed (drained) when connectivity
 * returns, so no counts/history are lost during an outage.
 */
@Injectable()
export class BufferService {
  private readonly logger = new Logger(BufferService.name);
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = config.get<string>('bufferDir') ?? './buffer';
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private file(kind: string) {
    return join(this.dir, `${kind}.jsonl`);
  }

  enqueue(kind: string, payload: unknown): void {
    try {
      appendFileSync(this.file(kind), JSON.stringify(payload) + '\n');
    } catch (err) {
      this.logger.error(`Buffer write failed for ${kind}`, err as Error);
    }
  }

  size(kind: string): number {
    const f = this.file(kind);
    if (!existsSync(f)) return 0;
    return readFileSync(f, 'utf8').split('\n').filter(Boolean).length;
  }

  /**
   * Replay buffered records. `handler` should return true on success. Records
   * that fail are kept for the next drain; the rest are dropped from the file.
   */
  async drain(kind: string, handler: (payload: unknown) => Promise<boolean>): Promise<number> {
    const f = this.file(kind);
    if (!existsSync(f)) return 0;
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    if (!lines.length) return 0;

    const remaining: string[] = [];
    let drained = 0;

    /**
     * Drained in BATCHES, not one record at a time.
     *
     * This awaited each record in turn, so clearing a backlog cost the number of
     * records TIMES the round-trip to the sink. A gateway that fell behind could
     * not catch up — records arrived faster than a serial drain cleared them, and
     * the file grew regardless of link speed, which is why a fast connection did
     * not help.
     *
     * The batch is bounded so a large file cannot open thousands of concurrent
     * writes and take down the sink it is trying to reach.
     */
    const BATCH = 50;
    let refused = false;
    for (let i = 0; i < lines.length; i += BATCH) {
      if (refused) { remaining.push(...lines.slice(i)); break; }
      const slice = lines.slice(i, i + BATCH);
      const outcomes = await Promise.all(slice.map(async (line) => {
        try { return [line, await handler(JSON.parse(line))] as const; }
        catch { return [line, false] as const; }
      }));
      for (const [line, ok] of outcomes) {
        if (ok) drained += 1;
        else { remaining.push(line); refused = true; }
      }
    }

    writeFileSync(f, remaining.length ? remaining.join('\n') + '\n' : '');
    if (drained) this.logger.log(`Drained ${drained} buffered ${kind} record(s)`);
    return drained;
  }
}
