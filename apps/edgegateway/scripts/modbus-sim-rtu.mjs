// Modbus-RTU (native serial / RS-485) simulator for end-to-end testing of the
// edge gateway over a real serial line — the serial counterpart of modbus-sim.mjs.
//
// Unlike the TCP farm (one ServerTCP per port), a serial RTU bus is a single
// COM port shared by many slaves (RS-485 multidrop). So this is ONE process
// bound to ONE COM port that answers for N slave addresses (unit IDs 1..count),
// each exposing its own live Schneider PM5110 register map:
//
//  • Coil 0 pulses (false→true→false) ~every 1.5s            → rising edges for a GOOD/TOTAL counter
//  • Holding registers expose a PM5110 map (Float32 V/I/P/PF/Hz at the template
//    addresses + Int64 active-energy counters)                → drives an energy meter
//
// PREREQUISITE (Windows — a virtual loopback is needed since the sim and the
// gateway are two processes on one machine, and a COM port can't be opened by
// both). The `serialport` module modbus-serial needs is already resolvable via
// the workspace, so the only setup is the port pair:
//   • Install com0com (https://sourceforge.net/projects/com0com/) and create a
//     virtual pair, e.g. COM3 <-> COM4. Run this sim on one end (COM3) and point
//     the gateway at the other (COM4). Anything written to one appears on the other.
//
// GATEWAY DEVICE CONFIG (protocol MODBUS_RTU):
//   serialPort=COM4  baudRate=9600  parity=none  dataBits=8  stopBits=1  unitId=1
//
// Usage:  node scripts/modbus-sim-rtu.mjs [comPort] [count] [baud] [parity]   (default COM3 1 9600 none)
//   A real PM5110 defaults to 19200 8E1 — to mirror it, run e.g. `... COM3 1 19200 even`.
//   The parity here MUST match the gateway device's parity or every read fails on framing.
import pkg from 'modbus-serial';
const { ServerSerial } = pkg;

const COM = process.argv[2] || process.env.SIM_SERIAL_PORT || 'COM3';
const COUNT = Number(process.argv[3] || process.env.SIM_COUNT || 1);
const BAUD = Number(process.argv[4] || process.env.SIM_BAUD || 9600);
const PARITY = process.argv[5] || process.env.SIM_PARITY || 'none';   // none | even | odd

// One independent PM5110 state per slave address on the bus.
function makeMeter(seed) {
  const regs = {};                                   // register address → 16-bit word
  let coil0 = false;
  let energyWh = 1_000_000 + seed * 25_000;          // cumulative Wh (template scaleFactor 0.001 → kWh)
  let exportWh = 50_000 + seed * 1_000;

  const setFloat = (addr, val) => {
    const b = Buffer.alloc(4); b.writeFloatBE(val, 0);
    regs[addr] = b.readUInt16BE(0); regs[addr + 1] = b.readUInt16BE(2); // BIG word order
  };

  const refresh = () => {
    const jitter = (x, pct) => x * (1 + (Math.sin(Date.now() / 3000 + seed) * pct));
    const v = jitter(228 + (seed % 5), 0.02), i = jitter(8 + (seed * 1.7) % 14, 0.15), pf = 0.90 + (seed % 6) * 0.015;
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
  };
  refresh();

  return { regs, refresh, getCoil: () => coil0 };
}

// slave unit ID → PM5110 state
const meters = new Map();
for (let u = 1; u <= COUNT; u++) meters.set(u, makeMeter(u - 1));
setInterval(() => { for (const m of meters.values()) m.refresh(); }, 1500);

const bit = (addr, u) => {
  const m = meters.get(u);
  return addr === 0 && m ? m.getCoil() : false;
};
const word = (addr, u) => meters.get(u)?.regs[addr] || 0;

const vector = {
  getCoil: (addr, u, cb) => cb(null, bit(addr, u)),
  getDiscreteInput: (addr, u, cb) => cb(null, bit(addr, u)),
  getInputRegister: (addr, u, cb) => cb(null, word(addr, u)),
  getHoldingRegister: (addr, u, cb) => cb(null, word(addr, u)),
  setCoil: (_a, _v, _u, cb) => cb(null),
  setRegister: (_a, _v, _u, cb) => cb(null),
};

// unitID 255 ⇒ answer for every slave address on the bus; route by unit in the vector.
const frame = `8${PARITY === 'none' ? 'N' : PARITY === 'even' ? 'E' : 'O'}1`;
const server = new ServerSerial(vector, { port: COM, baudRate: BAUD, parity: PARITY, unitID: 255, debug: false });
server.on('initialized', () => console.log(   // ServerSerial fires "initialized" (not "open") once the COM port is up
  `Modbus-RTU simulator on ${COM} @ ${BAUD} ${frame} — slave IDs 1..${COUNT}, coil0 pulsing + PM5110 map (V/I/P/PF/Hz + energy)`,
));
server.on('socketError', (e) => console.error('sim socket error:', e?.message));
server.on('error', (e) => console.error('sim error:', e?.message));
