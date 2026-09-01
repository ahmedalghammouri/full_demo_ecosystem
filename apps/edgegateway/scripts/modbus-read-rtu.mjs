// Modbus-RTU (native serial) reader — the client-side sanity check for modbus-sim-rtu.mjs.
// Opens a COM port, reads one slave's PM5110 map exactly the way the edge gateway's
// MODBUS_RTU poller does (connectRTUBuffered, 8N1, Float32 BIG word order, Int64 energy),
// and prints decoded live values on a loop.
//
// Usage:  node scripts/modbus-read-rtu.mjs [comPort] [unitId] [baud] [parity]   (default COM2 1 9600 none)
//   e.g. sim on COM1 → reader on COM2 at real-PM5110 8E1:  node scripts/modbus-read-rtu.mjs COM2 1 19200 even
//   parity MUST match the sim / real meter (a real PM5110 defaults to 19200 8E1).
import pkg from 'modbus-serial';
const ModbusRTU = pkg.default ?? pkg;

const COM = process.argv[2] || 'COM2';
const UNIT = Number(process.argv[3] || 1);
const BAUD = Number(process.argv[4] || 9600);
const PARITY = process.argv[5] || 'none';   // none | even | odd

const client = new ModbusRTU();
client.setTimeout(3000);

// Decode 2 holding regs at `addr` as a BIG-word-order (ABCD) Float32 — the PM5110 format.
const f32 = async (addr) => {
  const { data } = await client.readHoldingRegisters(addr, 2);
  const b = Buffer.alloc(4); b.writeUInt16BE(data[0], 0); b.writeUInt16BE(data[1], 2);
  return b.readFloatBE(0);
};

async function pollOnce() {
  // Read sequentially — a serial RTU bus allows only ONE transaction in flight at a
  // time (this is exactly how the edge gateway's poller reads, tag by tag). Firing
  // these concurrently would collide on the wire and time out.
  const i = await f32(2999);            // current L1 (A)  — vendor doc 3000 −1 (0-based)
  const v = await f32(3027);            // voltage L1-N (V) — 3028 −1
  const p = await f32(3059);            // active power total (kW) — 3060 −1
  const pf = await f32(3191);           // power factor total (simple float) — 3192 −1
  const hz = await f32(3109);           // frequency (Hz) — 3110 −1
  const energyKWh = await f32(2699);    // active energy import (kWh, Float32) — 2700 −1
  const coil = await client.readCoils(0, 1).then((r) => r.data[0]);
  const t = new Date().toLocaleTimeString();
  console.log(
    `[${t}] V=${v.toFixed(1)}V  I=${i.toFixed(2)}A  P=${p.toFixed(3)}kW  PF=${pf.toFixed(3)}  ` +
    `f=${hz.toFixed(3)}Hz  E=${energyKWh.toFixed(3)}kWh  coil0=${coil ? 1 : 0}`,
  );
}

(async () => {
  const frame = `8${PARITY === 'none' ? 'N' : PARITY === 'even' ? 'E' : 'O'}1`;
  console.log(`Opening ${COM} @ ${BAUD} ${frame}, unitId=${UNIT} (RTU) …`);
  await client.connectRTUBuffered(COM, { baudRate: BAUD, parity: PARITY, dataBits: 8, stopBits: 1 });
  client.setID(UNIT);
  console.log(`Connected. Reading PM5110 map from slave ${UNIT} every 2s (Ctrl-C to stop):`);
  await pollOnce().catch((e) => console.error('read error:', e.message));
  setInterval(() => void pollOnce().catch((e) => console.error('read error:', e.message)), 2000);
})().catch((e) => { console.error('connect failed:', e.message); process.exit(1); });
