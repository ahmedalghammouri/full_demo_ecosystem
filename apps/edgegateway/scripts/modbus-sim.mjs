// Modbus-TCP / RTU-over-TCP simulator for end-to-end testing of the edge gateway.
//
//  • Coil 0 pulses (false→true→false) ~every 1.5s            → rising edges for a GOOD/TOTAL counter
//  • Holding registers expose a Schneider PM5110 map (Float32 V/I/P/PF/Hz at the
//    template addresses + Int64 active-energy counters)        → drives an energy meter
//
// Usage:  node scripts/modbus-sim.mjs [port]   (default 1502; 502 needs admin on Windows)
import pkg from 'modbus-serial';
const { ServerTCP } = pkg;

const PORT = Number(process.argv[2] || process.env.SIM_PORT || 1502);
const SEED = PORT - 1502;          // per-instance offset so each port looks distinct

let coil0 = false;
let energyWh = 1_000_000 + SEED * 25_000;   // cumulative Wh (template scaleFactor 0.001 → kWh)
let exportWh = 50_000 + SEED * 1_000;

// register address → 16-bit word
const regs = {};
function setFloat(addr, val) {
  const b = Buffer.alloc(4); b.writeFloatBE(val, 0);
  regs[addr] = b.readUInt16BE(0); regs[addr + 1] = b.readUInt16BE(2); // BIG word order
}

function refresh() {
  const jitter = (x, pct) => x * (1 + (Math.sin(Date.now() / 3000 + SEED) * pct));
  const v = jitter(228 + (SEED % 5), 0.02), i = jitter(8 + (SEED * 1.7) % 14, 0.15), pf = 0.90 + (SEED % 6) * 0.015;
  const pPh = (v * i * pf) / 1000; // kW per phase
  // PM5110 (SCHNEIDER_PM5110) Float32 addresses — mirrors meter-templates.ts (vendor doc
  // register number − 1, i.e. the 0-based wire address on real METSEPM5110 hardware).
  setFloat(2999, i); setFloat(3001, i); setFloat(3003, i); setFloat(3009, i);          // currents L1/L2/L3/avg
  setFloat(3025, v * Math.SQRT2 * Math.sqrt(1.5));                                      // voltage L-L avg (≈ v·√3)
  setFloat(3027, v); setFloat(3029, v); setFloat(3031, v); setFloat(3035, v);          // voltages L-N + avg
  setFloat(3059, pPh * 3);                                                              // active power total kW
  setFloat(3067, pPh * 3 * 0.3); setFloat(3075, pPh * 3 / pf);                          // reactive / apparent
  setFloat(3109, jitter(50, 0.002));                                                    // frequency Hz
  setFloat(3191, pf);                                                                   // PF total (simple float)
  energyWh += (pPh * 3) * 1000 * (1.5 / 3600);  // integrate kW over the 1.5s tick → Wh
  setFloat(2699, energyWh / 1000); setFloat(2701, exportWh / 1000);                     // active energy import/export (kWh, Float32)
  coil0 = !coil0;
}
refresh();
setInterval(refresh, 1500);

const vector = {
  getCoil: (addr, _u, cb) => cb(null, addr === 0 ? coil0 : false),
  getDiscreteInput: (addr, _u, cb) => cb(null, addr === 0 ? coil0 : false),
  getInputRegister: (addr, _u, cb) => cb(null, regs[addr] || 0),
  getHoldingRegister: (addr, _u, cb) => cb(null, regs[addr] || 0),
  setCoil: (_a, _v, _u, cb) => cb(null),
  setRegister: (_a, _v, _u, cb) => cb(null),
};

const server = new ServerTCP(vector, { host: '0.0.0.0', port: PORT, debug: false, unitID: 1 });
server.on('socketError', (e) => console.error('sim socket error:', e?.message));
server.on('serverError', (e) => console.error('sim server error:', e?.message));
console.log(`Modbus simulator on 0.0.0.0:${PORT} — coil0 pulsing + PM5110 register map (V/I/P/PF/Hz + energy)`);
