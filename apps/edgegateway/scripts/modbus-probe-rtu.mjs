// Modbus-RTU addressing PROBE — for a real meter that responds but rejects reads
// (e.g. "Modbus exception 3: Illegal data value" on every register). It tries the
// same logical value ("Current A") under several addressing interpretations so you
// can see which one the physical meter actually accepts, then fix the tag addresses.
//
// The meter must be FREE — stop the edge service first so it isn't holding the port:
//   build\nssm.exe stop Industry360EdgeGateway
//
// Usage:  node scripts/modbus-probe-rtu.mjs [comPort] [unitId] [baud] [parity]
//   production PM Wrapping Machine 5:  node scripts/modbus-probe-rtu.mjs COM4 1 19200 even
import pkg from 'modbus-serial';
const ModbusRTU = pkg.default ?? pkg;

const COM = process.argv[2] || 'COM4';
const UNIT = Number(process.argv[3] || 1);
const BAUD = Number(process.argv[4] || 19200);
const PARITY = process.argv[5] || 'even';

const client = new ModbusRTU();
client.setTimeout(2000);

const f32 = (data) => { const b = Buffer.alloc(4); b.writeUInt16BE(data[0], 0); b.writeUInt16BE(data[1], 2); return b.readFloatBE(0); };

// One attempt: function code + address + quantity. Prints decoded value or the exact error.
async function tryRead(label, fc, addr, qty) {
  try {
    client.setID(UNIT);
    const res = fc === 4 ? await client.readInputRegisters(addr, qty) : await client.readHoldingRegisters(addr, qty);
    const val = qty >= 2 ? f32(res.data).toFixed(3) : res.data[0];
    console.log(`  OK   ${label.padEnd(28)} → ${val}   (raw ${JSON.stringify(res.data)})`);
  } catch (e) {
    const code = e?.modbusCode != null ? `exc ${e.modbusCode}` : (e?.message ?? String(e));
    console.log(`  FAIL ${label.padEnd(28)} → ${code}`);
  }
}

(async () => {
  const frame = `8${PARITY === 'none' ? 'N' : PARITY === 'even' ? 'E' : 'O'}1`;
  console.log(`Probing ${COM} @ ${BAUD} ${frame}, unit ${UNIT} — "Current A" under different addressing:\n`);
  await client.connectRTUBuffered(COM, { baudRate: BAUD, parity: PARITY, dataBits: 8, stopBits: 1 });

  // Candidate interpretations of Schneider "Current A" (documented register 3000, float32).
  await tryRead('FC03 @3000 qty2 (current)', 3, 3000, 2); // what the template uses now
  await tryRead('FC03 @2999 qty2 (−1, 0-based)', 3, 2999, 2); // the map doc\'s 1-based→0-based note
  await tryRead('FC03 @3001 qty2 (+1)', 3, 3001, 2);
  await tryRead('FC03 @3000 qty1 (single reg)', 3, 3000, 1);
  await tryRead('FC04 @3000 qty2 (input regs)', 4, 3000, 2);
  await tryRead('FC04 @2999 qty2 (input, −1)', 4, 2999, 2);
  // Energy (documented float32 kWh at 2700) under both bases:
  await tryRead('FC03 @2700 qty2 (energy imp)', 3, 2700, 2);
  await tryRead('FC03 @2699 qty2 (energy, −1)', 3, 2699, 2);

  await new Promise((r) => client.close(r));
  console.log('\nWhichever row returns OK with a sensible value is the addressing this meter uses.');
  process.exit(0);
})().catch((e) => { console.error('probe failed:', e.message); process.exit(1); });
