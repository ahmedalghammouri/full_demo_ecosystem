import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxDB, Point, WriteApi, QueryApi } from '@influxdata/influxdb-client';

/**
 * Thin wrapper around the InfluxDB 2.x time-series database (the `i360_timeseries`
 * bucket provisioned in docker-compose). All shop-floor / OEE history is persisted
 * here as real timestamped points — this is the project's historian / TSDB.
 *
 * Degrades gracefully: if Influx is unreachable or unconfigured, writes/queries
 * become no-ops and the rest of the app keeps working (the relational fallbacks
 * still serve current values).
 */
@Injectable()
export class InfluxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InfluxService.name);
  private client: InfluxDB | null = null;
  private writeApi: WriteApi | null = null;
  private queryApi: QueryApi | null = null;
  private org = 'industry360';
  private bucket = 'i360_timeseries';
  private enabled = false;
  private url: string | null = null;
  private token: string | null = null;
  private paused = false;

  constructor(private readonly config: ConfigService) {}

  /** Runtime kill-switch for ALL historian writes (used by System → Reset to keep
   *  the bucket empty after a wipe). Reads/queries are unaffected. In-memory only —
   *  resets to active on API restart. */
  setPaused(value: boolean) {
    this.paused = value;
    this.logger.warn(`Historian writes ${value ? 'PAUSED' : 'RESUMED'}.`);
  }

  isPaused() {
    return this.paused;
  }

  onModuleInit() {
    const url = this.config.get<string>('influx.url') ?? process.env.INFLUX_URL;
    const token = this.config.get<string>('influx.token') ?? process.env.INFLUX_TOKEN;
    this.url = url ?? null;
    this.token = token ?? null;
    this.org = this.config.get<string>('influx.org') ?? process.env.INFLUX_ORG ?? 'industry360';
    this.bucket = this.config.get<string>('influx.bucket') ?? process.env.INFLUX_BUCKET ?? 'i360_timeseries';

    if (!url || !token) {
      this.logger.warn('InfluxDB not configured (INFLUX_URL / INFLUX_TOKEN missing) — historian disabled.');
      return;
    }
    try {
      this.client = new InfluxDB({ url, token });
      this.writeApi = this.client.getWriteApi(this.org, this.bucket, 'ms');
      this.queryApi = this.client.getQueryApi(this.org);
      this.enabled = true;
      this.logger.log(`InfluxDB historian connected → ${url} (org=${this.org}, bucket=${this.bucket})`);
    } catch (err) {
      this.logger.error('Failed to init InfluxDB client — historian disabled.', err as any);
    }
  }

  async onModuleDestroy() {
    try { await this.writeApi?.close(); } catch { /* ignore */ }
  }

  isEnabled() {
    return this.enabled;
  }

  /** Write one or more points and flush. Never throws. */
  async write(points: Point | Point[]): Promise<boolean> {
    if (!this.enabled || !this.writeApi) return false;
    if (this.paused) return false; // historian ingestion paused via System console

    try {
      const arr = Array.isArray(points) ? points : [points];
      if (!arr.length) return true;
      this.writeApi.writePoints(arr);
      await this.writeApi.flush();
      return true;
    } catch (err) {
      this.logger.error('Influx write failed', err as any);
      return false;
    }
  }

  /** Run a Flux query and collect rows. Returns [] on any error / when disabled. */
  async query<T = any>(flux: string): Promise<T[]> {
    if (!this.enabled || !this.queryApi) return [];
    try {
      return (await this.queryApi.collectRows(flux)) as T[];
    } catch (err) {
      this.logger.error('Influx query failed', err as any);
      return [];
    }
  }

  getBucket() { return this.bucket; }

  /**
   * Approximate number of points currently stored in the historian bucket.
   * Returns null when Influx is disabled or the count query fails. Used by the
   * System / Danger-Zone status panel — never throws.
   */
  async countPoints(): Promise<number | null> {
    if (!this.enabled) return null;
    const flux = `from(bucket: "${this.bucket}")
  |> range(start: 0)
  |> group()
  |> count()
  |> sum()`;
    try {
      const rows = await this.query<{ _value: number }>(flux);
      if (!rows.length) return 0;
      return rows.reduce((acc, r) => acc + (Number(r._value) || 0), 0);
    } catch {
      return null;
    }
  }

  /**
   * DESTRUCTIVE — permanently deletes every point in the historian bucket
   * (full time-series reset). Uses the InfluxDB 2.x delete HTTP API across the
   * entire time range. Returns true on success. Owner-gated by the caller.
   */
  async wipeBucket(): Promise<boolean> {
    if (!this.enabled || !this.url || !this.token) {
      this.logger.warn('wipeBucket called but InfluxDB is disabled — skipped.');
      return false;
    }
    const endpoint = `${this.url.replace(/\/$/, '')}/api/v2/delete?org=${encodeURIComponent(this.org)}&bucket=${encodeURIComponent(this.bucket)}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // InfluxDB stores timestamps as int64 nanoseconds since epoch, so the
          // stop time must not exceed 2262-04-11T23:47:16.854775806Z (the max
          // representable instant). Anything later → HTTP 400 and a silent no-op.
          start: '1970-01-01T00:00:00Z',
          stop: '2262-04-11T23:47:16Z',
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(`Influx wipe failed (${res.status}): ${text}`);
        return false;
      }
      this.logger.warn(`Historian bucket "${this.bucket}" wiped (full range delete).`);
      return true;
    } catch (err) {
      this.logger.error('Influx wipe request failed', err as any);
      return false;
    }
  }
}
