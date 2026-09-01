import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runtime config overrides persisted to `gateway-config.json` next to the
 * executable/working dir. These take precedence over `.env` and are editable
 * from the dashboard Settings page (applied on restart). Keeping them in a
 * separate file means the dashboard can rewrite config without touching `.env`.
 */
export interface StoredConfig {
  gatewayName?: string;
  factoryCode?: string;
  databaseUrl?: string;
  mqttBrokerUrl?: string;
  influxUrl?: string;
  influxToken?: string;
  influxOrg?: string;
  influxBucket?: string;
  mesPlatformUrl?: string;
  defaultPollIntervalMs?: number;
  /**
   * Per-machine counting limits, keyed by machine id.
   *
   * Lives in the gateway's own config rather than the database on purpose: a
   * plant tuning a tolerance mid-shift must not need the platform to be
   * reachable, and these govern what the gateway is willing to REPORT — which
   * is the gateway's own business.
   */
  machineLimits?: Record<string, { debounceMs?: number; tolerancePerMin?: number | null }>;
}

export function configPath(): string {
  return process.env.GATEWAY_CONFIG_FILE || resolve(process.cwd(), 'gateway-config.json');
}

export function readConfigFile(): StoredConfig {
  try {
    return existsSync(configPath()) ? (JSON.parse(readFileSync(configPath(), 'utf8')) as StoredConfig) : {};
  } catch {
    return {};
  }
}

export function writeConfigFile(patch: StoredConfig): StoredConfig {
  const merged = { ...readConfigFile(), ...patch };
  writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  return merged;
}
