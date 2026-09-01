// Copies the canonical Prisma schema from the API into the gateway so the
// gateway generates its OWN client (needed for the standalone .exe) while
// keeping a single source of truth. Adds the Windows binary target required by
// the packaged executable.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../api/prisma/schema.prisma');
const destDir = resolve(here, '../prisma');
const dest = resolve(destDir, 'schema.prisma');

let schema = readFileSync(src, 'utf8');

// Ensure the windows query engine is generated for the packaged .exe.
schema = schema.replace(
  /binaryTargets\s*=\s*\[[^\]]*\]/,
  'binaryTargets   = ["native", "windows", "linux-musl-openssl-3.0.x"]',
);

// Dedicated output so the gateway's client never clobbers the MES API's shared
// @prisma/client (they have different schemas). The API schema has no `output`,
// so we re-inject it on every sync — otherwise this line gets wiped and the
// gateway's `import ... from '../generated/prisma'` breaks.
if (!/^\s*output\s*=/m.test(schema)) {
  const eol = schema.includes('\r\n') ? '\r\n' : '\n';
  schema = schema.replace(
    /(generator\s+client\s*\{\s*\r?\n\s*provider\s*=\s*"[^"]*"\r?\n)/,
    `$1  output          = "../src/generated/prisma"${eol}`,
  );
}

mkdirSync(destDir, { recursive: true });
writeFileSync(dest, schema);
console.log(`[sync-schema] ${src} -> ${dest}`);
