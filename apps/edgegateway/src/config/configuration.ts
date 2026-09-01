import { readConfigFile } from './config-store';

export interface GatewayConfig {
  gatewayId: string | null;
  gatewayName: string;
  factoryCode: string | null;
  port: number;
  databaseUrl: string | undefined;
  mqtt: { brokerUrl: string | undefined };
  influx: {
    url: string | undefined;
    token: string | undefined;
    org: string;
    bucket: string;
  };
  mesPlatformUrl: string | undefined;
  jwtSecret: string;
  defaultPollIntervalMs: number;
  heartbeatIntervalMs: number;
  bufferDir: string;
  logDir: string;
}

export default (): GatewayConfig => {
  // gateway-config.json (editable from the dashboard) overrides .env.
  const f = readConfigFile();
  // DATABASE_URL is consumed by Prisma directly from the env, so mirror any
  // stored override back onto process.env before the client connects.
  if (f.databaseUrl) process.env.DATABASE_URL = f.databaseUrl;

  return {
    gatewayId: process.env.GATEWAY_ID || null,
    gatewayName: f.gatewayName || process.env.GATEWAY_NAME || 'Edge Gateway',
    factoryCode: f.factoryCode || process.env.GATEWAY_FACTORY_CODE || null,
    port: parseInt(process.env.GATEWAY_PORT || '4900', 10),
    databaseUrl: f.databaseUrl || process.env.DATABASE_URL,
    mqtt: { brokerUrl: f.mqttBrokerUrl || process.env.MQTT_BROKER_URL },
    influx: {
      url: f.influxUrl || process.env.INFLUX_URL,
      token: f.influxToken || process.env.INFLUX_TOKEN,
      org: f.influxOrg || process.env.INFLUX_ORG || 'industry360',
      bucket: f.influxBucket || process.env.INFLUX_BUCKET || 'i360_timeseries',
    },
    mesPlatformUrl: f.mesPlatformUrl || process.env.MES_PLATFORM_URL,
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production-min-32-characters',
    defaultPollIntervalMs: f.defaultPollIntervalMs ?? parseInt(process.env.DEFAULT_POLL_INTERVAL_MS || '1000', 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '15000', 10),
    bufferDir: process.env.BUFFER_DIR || './buffer',
    logDir: process.env.LOG_DIR || './logs',
  };
};
