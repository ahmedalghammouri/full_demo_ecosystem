// Export historized tag data from InfluxDB to a JSON file, plus a per-tag
// verification summary — use it to prove the gateway is historizing correctly
// (no gaps, sane sampling rate, expected value ranges).
//
// Connection is resolved in this order (first hit wins):
//   1. CLI flags / env vars  (INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET)
//   2. ./gateway-config.json  (whatever THIS gateway writes to — the usual case)
//   3. ./.env
// Secrets are never hard-coded here; nothing is written to the DB (read-only).
//
// Usage (from apps/edgegateway):
//   node scripts/influx-export.mjs                          # last 24h → influx-export.json
//   node scripts/influx-export.mjs --range -7d              # last 7 days
//   node scripts/influx-export.mjs --range -2h --tag pm5110M05_V_BN
//   node scripts/influx-export.mjs --out C:\tmp\hist.json --limit 200000
//   node scripts/influx-export.mjs --summary-only           # just the report, no points file
//
// Override the target explicitly:
//   INFLUX_URL=http://demo.industry360.sa:8086 INFLUX_TOKEN=xxx node scripts/influx-export.mjs
import { InfluxDB } from '@influxdata/influxdb-client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);

const RANGE = arg('range', '-24h');       // Flux duration, e.g. -24h, -7d, -30m
const TAG = arg('tag', null);             // optional tagCode filter
const OUT = arg('out', 'influx-export.json');
const LIMIT = Number(arg('limit', 500_000));
const SUMMARY_ONLY = has('summary-only');

// ── connection: env → gateway-config.json → .env ────────────────────────────
function fromGatewayConfig() {
  const f = join(process.cwd(), 'gateway-config.json');
  if (!existsSync(f)) return {};
  try {
    const c = JSON.parse(readFileSync(f, 'utf8'));
    return { url: c.influxUrl, token: c.influxToken, org: c.influxOrg, bucket: c.influxBucket };
  } catch { return {}; }
}
function fromDotEnv() {
  const f = join(process.cwd(), '.env');
  if (!existsSync(f)) return {};
  const out = {};
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return { url: out.INFLUX_URL, token: out.INFLUX_TOKEN, org: out.INFLUX_ORG, bucket: out.INFLUX_BUCKET };
}
const cfg = fromGatewayConfig();
const env = fromDotEnv();
const URL_ = arg('url', process.env.INFLUX_URL || cfg.url || env.url);
const TOKEN = process.env.INFLUX_TOKEN || cfg.token || env.token;
const ORG = arg('org', process.env.INFLUX_ORG || cfg.org || env.org || 'industry360');
const BUCKET = arg('bucket', process.env.INFLUX_BUCKET || cfg.bucket || env.bucket || 'i360_timeseries');

if (!URL_ || !TOKEN) {
  console.error('✖ Missing Influx URL/token. Set INFLUX_URL + INFLUX_TOKEN, or run from a folder with gateway-config.json/.env');
  process.exit(1);
}

// ── query ───────────────────────────────────────────────────────────────────
const flux = `
from(bucket: "${BUCKET}")
  |> range(start: ${RANGE})
  |> filter(fn: (r) => r._measurement == "tag")
  ${TAG ? `|> filter(fn: (r) => r.tagCode == "${TAG}")` : ''}
  |> sort(columns: ["_time"])
  |> limit(n: ${LIMIT})
`;

const source = process.env.INFLUX_URL || argv.includes('--url') ? 'env/CLI' : (cfg.url ? 'gateway-config.json' : '.env');
console.log(`Querying ${URL_}  org=${ORG} bucket=${BUCKET} range=${RANGE}${TAG ? ` tag=${TAG}` : ''}`);
console.log(`  (connection from: ${source} — pass --url / INFLUX_URL to target a different server)\n`);

const queryApi = new InfluxDB({ url: URL_, token: TOKEN }).getQueryApi(ORG);

const points = [];
try {
  for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
    const o = tableMeta.toObject(values);
    points.push({
      time: o._time,
      tagCode: o.tagCode,
      field: o._field,          // "value" (numeric) | "valueStr" (string)
      value: o._value,
      quality: o.quality ?? null,
      machineId: o.machineId ?? null,
      deviceId: o.deviceId ?? null,
      factoryId: o.factoryId ?? null,
    });
  }
} catch (err) {
  // influxdb-client throws HttpError (statusCode/body) or a bare socket error —
  // .message is often empty, so surface every field we can.
  const e = /** @type {any} */ (err) ?? {};
  const detail = [
    e.statusCode ? `HTTP ${e.statusCode}` : null,
    e.code || null,
    e.message || null,
    typeof e.body === 'string' ? e.body.slice(0, 300) : null,
  ].filter(Boolean).join('  |  ');
  console.error(`✖ Query failed: ${detail || String(err)}`);
  if (e.statusCode === 401) console.error('  → 401: the token is not valid for this Influx server/org.');
  if (e.code === 'ECONNREFUSED') console.error(`  → nothing is listening on ${URL_} (wrong host, or Influx is down).`);
  if (e.statusCode === 404) console.error(`  → 404: org "${ORG}" or bucket "${BUCKET}" does not exist on this server.`);
  process.exit(1);
}

if (!points.length) {
  console.log('⚠ No points returned — nothing historized in this range (or the filter excluded everything).');
  process.exit(0);
}

// ── per-tag verification summary ────────────────────────────────────────────
const byTag = new Map();
for (const p of points) {
  if (!byTag.has(p.tagCode)) byTag.set(p.tagCode, []);
  byTag.get(p.tagCode).push(p);
}

const summary = [...byTag.entries()].map(([tagCode, ps]) => {
  ps.sort((a, b) => new Date(a.time) - new Date(b.time));
  const times = ps.map((p) => new Date(p.time).getTime());
  const nums = ps.map((p) => p.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
  // gaps between consecutive samples → spot missing history
  let maxGapSec = 0;
  for (let i = 1; i < times.length; i++) maxGapSec = Math.max(maxGapSec, (times[i] - times[i - 1]) / 1000);
  const spanSec = (times[times.length - 1] - times[0]) / 1000;
  return {
    tagCode,
    count: ps.length,
    first: ps[0].time,
    last: ps[ps.length - 1].time,
    spanMin: +(spanSec / 60).toFixed(1),
    avgIntervalSec: ps.length > 1 ? +(spanSec / (ps.length - 1)).toFixed(2) : null,
    maxGapSec: +maxGapSec.toFixed(1),
    min: nums.length ? +Math.min(...nums).toFixed(4) : null,
    max: nums.length ? +Math.max(...nums).toFixed(4) : null,
    badQuality: ps.filter((p) => p.quality && p.quality !== 'GOOD').length,
  };
}).sort((a, b) => b.count - a.count);

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${points.length} point(s) across ${summary.length} tag(s)\n`);
console.log('TAG                        COUNT   AVG_INT(s)  MAX_GAP(s)   MIN        MAX        BAD');
console.log('─'.repeat(92));
for (const s of summary) {
  console.log(
    `${String(s.tagCode).padEnd(26)} ${String(s.count).padStart(5)}   ${String(s.avgIntervalSec ?? '—').padStart(9)}   ${String(s.maxGapSec).padStart(9)}   ${String(s.min ?? '—').padStart(9)}  ${String(s.max ?? '—').padStart(9)}  ${String(s.badQuality).padStart(3)}`,
  );
}
// Flag suspicious gaps: > 10x the tag's own average sampling interval.
const suspect = summary.filter((s) => s.avgIntervalSec && s.maxGapSec > Math.max(60, s.avgIntervalSec * 10));
if (suspect.length) {
  console.log(`\n⚠ Possible history GAPS (max gap >> average interval):`);
  for (const s of suspect) console.log(`   ${s.tagCode}: max gap ${s.maxGapSec}s vs avg ${s.avgIntervalSec}s`);
} else {
  console.log('\n✔ No unusual gaps — sampling looks continuous for every tag.');
}

// ── write file ──────────────────────────────────────────────────────────────
if (!SUMMARY_ONLY) {
  const doc = {
    meta: { url: URL_, org: ORG, bucket: BUCKET, range: RANGE, tag: TAG, exportedAt: new Date().toISOString(), pointCount: points.length },
    summary,
    points,
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 2));
  console.log(`\n→ wrote ${OUT} (${(JSON.stringify(doc).length / 1024 / 1024).toFixed(2)} MB)`);
} else {
  console.log('\n(--summary-only: no file written)');
}
