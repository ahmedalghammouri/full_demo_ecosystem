// After `pkg` builds edgegateway.exe, copy the runtime assets that must live
// NEXT TO the exe (not embedded): the Prisma Windows query-engine library, the
// schema, a sample .env, the dashboard, and the service scripts. This produces
// a self-contained `build/` folder ready to drop on a plant PC.
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const monorepoRoot = resolve(root, '..', '..');
const build = join(root, 'build');
mkdirSync(build, { recursive: true });

// Locate the generated Prisma client dir holding the native query engine.
// Under pnpm the client is generated into the virtual store, not into a flat
// node_modules/.prisma — so check both layouts before giving up.
function findPrismaClientDir() {
  const direct = [
    join(root, 'node_modules', '.prisma', 'client'),
    join(monorepoRoot, 'node_modules', '.prisma', 'client'),
  ];
  for (const d of direct) {
    if (existsSync(d) && readdirSync(d).some((f) => f.startsWith('query_engine-windows') && f.endsWith('.node'))) return d;
  }
  // pnpm virtual store: node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client
  const pnpmDir = join(monorepoRoot, 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    for (const pkg of readdirSync(pnpmDir)) {
      if (!pkg.startsWith('@prisma+client@')) continue;
      const d = join(pnpmDir, pkg, 'node_modules', '.prisma', 'client');
      if (existsSync(d) && readdirSync(d).some((f) => f.startsWith('query_engine-windows') && f.endsWith('.node'))) return d;
    }
  }
  return null;
}

// Prisma query engine (windows) — pkg cannot snapshot the native .node reliably,
// so ship it beside the exe and point PRISMA_QUERY_ENGINE_LIBRARY at it.
const prismaDir = findPrismaClientDir();
if (prismaDir) {
  let copied = 0;
  for (const f of readdirSync(prismaDir)) {
    // Windows engine only; skip the linux .so.node and stale *.node.tmpNNNN files.
    if (f.startsWith('query_engine-windows') && f.endsWith('.node')) {
      copyFileSync(join(prismaDir, f), join(build, f));
      copied++;
    }
  }
  if (!copied) throw new Error(`[copy-runtime-assets] no windows query engine found in ${prismaDir}`);
} else {
  throw new Error('[copy-runtime-assets] could not locate the generated Prisma client (run prisma:generate first)');
}

// serialport native binding (@serialport/bindings-cpp) — pkg cannot snapshot the
// native .node either. node-gyp-build has a built-in fallback: when the in-snapshot
// lookup fails it searches `prebuilds/<platform>-<arch>/` NEXT TO the executable
// (path.dirname(process.execPath)). So stage the win32-x64 prebuild under
// build/prebuilds/win32-x64/ and it loads from disk — enabling Modbus RTU (RS485).
function findSerialportPrebuild() {
  const rel = join('@serialport', 'bindings-cpp', 'prebuilds', 'win32-x64');
  const candidates = [
    join(root, 'node_modules', rel),
    join(monorepoRoot, 'node_modules', rel),
  ];
  for (const d of candidates) {
    if (existsSync(d) && readdirSync(d).some((f) => f.endsWith('.node'))) return d;
  }
  const pnpmDir = join(monorepoRoot, 'node_modules', '.pnpm');
  if (existsSync(pnpmDir)) {
    for (const pkg of readdirSync(pnpmDir)) {
      if (!pkg.startsWith('@serialport+bindings-cpp@')) continue;
      const d = join(pnpmDir, pkg, 'node_modules', rel);
      if (existsSync(d) && readdirSync(d).some((f) => f.endsWith('.node'))) return d;
    }
  }
  return null;
}

const spDir = findSerialportPrebuild();
if (spDir) {
  const dest = join(build, 'prebuilds', 'win32-x64');
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const f of readdirSync(spDir)) {
    if (f.endsWith('.node')) { copyFileSync(join(spDir, f), join(dest, f)); copied++; }
  }
  if (!copied) throw new Error(`[copy-runtime-assets] no serialport .node found in ${spDir}`);
} else {
  throw new Error('[copy-runtime-assets] could not locate @serialport/bindings-cpp win32-x64 prebuild');
}

// Schema + dashboard + env template.
const copies = [
  ['prisma/schema.prisma', 'schema.prisma'],
  ['.env.example', '.env.example'],
];
for (const [src, dst] of copies) {
  const s = join(root, src);
  if (existsSync(s)) copyFileSync(s, join(build, dst));
}

// The .env is CONFIGURATION — database credentials, the broker, the JWT secret,
// the gateway's identity. Rebuilding must never overwrite it: this folder is the
// one that gets carried to a plant PC, and a build that quietly replaced a
// working config with the sample would take the gateway off the line on the next
// restart, with the cause invisible in the diff. Seeded once, then left alone.
const envPath = join(build, '.env');
if (!existsSync(envPath) && existsSync(join(root, '.env.example'))) {
  copyFileSync(join(root, '.env.example'), envPath);
  console.log('[copy-runtime-assets] seeded build/.env from .env.example — fill it in before deploying');
}
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), join(build, 'public'), { recursive: true });

// Service scripts.
for (const f of ['install-service.bat', 'uninstall-service.bat', 'update-service.bat', 'README.md']) {
  const s = join(here, '..', 'deploy', f);
  if (existsSync(s)) copyFileSync(s, join(build, f));
}

console.log(`[copy-runtime-assets] runtime files staged in ${build}`);
