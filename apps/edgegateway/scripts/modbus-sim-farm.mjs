// Modbus-TCP simulator FARM — launches N independent PM5110 simulators, each in
// its OWN child process (one ServerTCP per process), one per port.
//
// modbus-serial's ServerTCP keeps module-level state, so multiple servers in a
// single process interfere. Forking one process per port keeps them isolated —
// every meter/PLC bound to its own port reads distinct live values.
//
// Usage:  node scripts/modbus-sim-farm.mjs [basePort] [count]   (default 1502 12)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIM = join(__dirname, 'modbus-sim.mjs');
const BASE = Number(process.argv[2] || 1502);
const COUNT = Number(process.argv[3] || 12);

console.log(`Modbus simulator FARM — ${COUNT} PM5110 instances (one process each) on ports ${BASE}..${BASE + COUNT - 1}`);

const children = [];
for (let k = 0; k < COUNT; k++) {
  const port = BASE + k;
  const child = spawn(process.execPath, [SIM, String(port)], { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code) => console.error(`  sim :${port} exited (code ${code})`));
  children.push(child);
}

const shutdown = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
