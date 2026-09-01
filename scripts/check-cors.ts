import { isOriginAllowed, getCorsOrigins, PUBLIC_ORIGIN } from '../apps/api/src/common/cors.util';

const list = getCorsOrigins('http://localhost:3000,https://i360.industry360.cloud');
const cases: [string | undefined, boolean][] = [
  ['https://i360.industry360.cloud', true],
  ['https://lpg.industry360.cloud', true],
  ['https://demo.industry360.sa', true],
  ['https://app.industry360.com', true],
  ['http://localhost:3000', true],
  ['http://192.168.1.44:8100', true],
  [undefined, true],
  ['https://evil.example.com', false],
  ['https://industry360.cloud.evil.com', false],
];
let bad = 0;
for (const [origin, want] of cases) {
  const got = isOriginAllowed(origin, list);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(origin).padEnd(38)} allowed=${got} expected=${want}`);
}
console.log(bad ? `\n${bad} case(s) wrong` : '\nall CORS cases correct');
process.exit(bad ? 1 : 0);
