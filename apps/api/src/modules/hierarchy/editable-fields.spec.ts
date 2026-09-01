import * as fs from 'fs';
import * as path from 'path';

/**
 * A field you can SET when creating a machine, you can also CORRECT.
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 * `createNode` accepted `designCapacity` and `downtimeThreshold`. `updateNode`
 * silently ignored both — not rejected, ignored: the dialog saved, the toast
 * said success, and the value did not move. A machine created with the wrong
 * design speed kept it forever, and the only route to a correction was SQL
 * against the production database.
 *
 * Those two are not trivia. `designCapacity` is the DENOMINATOR of Performance,
 * so a wrong one bends every OEE figure that machine appears in; and
 * `downtimeThreshold` is the microstop boundary, which decides whether the plant
 * is reading "the line keeps hiccuping" or "the line broke down".
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Whatever `createNode` accepts for a machine, `updateNode` must accept too. A
 * write-once field is a data-entry mistake with no exit.
 */

const SVC = path.resolve(__dirname, 'hierarchy.service.ts');

/** The body of `case 'MACHINE':` inside the named method. */
function machineCase(src: string, method: string): string {
  const m = src.indexOf(`async ${method}(`);
  expect(m).toBeGreaterThan(-1);
  const body = src.slice(m, src.indexOf('\n  async ', m + 10));
  const c = body.indexOf("case 'MACHINE'");
  expect(c).toBeGreaterThan(-1);
  const next = body.indexOf('\n      case ', c);
  return body.slice(c, next === -1 ? body.length : next);
}

describe('machine attributes are editable, not write-once', () => {
  const src = fs.readFileSync(SVC, 'utf8');
  const create = machineCase(src, 'createNode');
  const update = machineCase(src, 'updateNode');

  /** `data.foo` — the DTO keys each branch actually consumes. */
  const keysOf = (s: string) => new Set([...s.matchAll(/\bdata\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]));

  it('reads both branches', () => {
    expect(keysOf(create).size).toBeGreaterThan(5);
    expect(keysOf(update).size).toBeGreaterThan(4);
  });

  it('every field settable at create is settable at update', () => {
    const missing = [...keysOf(create)]
      .filter((k) => !keysOf(update).has(k))
      .filter((k) => ![
        // Fixed by the route, not offered on the form.
        'factoryId',
        // Deliberately write-once. The machine CODE is the key the edge gateway
        // binds its tags to — `EDGE_COUNTER_M04_DI2` names M04 by code — so
        // renaming a machine here would silently unbind its counters and the
        // line would read zero production with nothing in any log to say why.
        // Re-coding a machine is a migration, not an edit.
        'code',
      ].includes(k));
    expect(missing).toEqual([]);
  });

  it('the two OEE-bearing numbers are named explicitly', () => {
    // Spelled out rather than left to the set comparison: if this file is ever
    // relaxed, these two must still be caught by name.
    expect(update).toContain('designCapacity');
    expect(update).toContain('downtimeThreshold');
  });

  it('a zero is a value, not an omission', () => {
    // `if (data.x)` would drop a deliberate 0 — for a threshold that means
    // "count nothing as a microstop", which is a real setting.
    for (const field of ['designCapacity', 'downtimeThreshold']) {
      expect(update).toContain(`data.${field} !== undefined`);
      // And `if (data.x)` alone must not be the gate.
      expect(update).not.toMatch(new RegExp(`\bif \(data\.${field}\)`));
    }
  });

  it('the machine node carries them back so the form can pre-fill', () => {
    // A field the edit dialog cannot READ is one the user overwrites blind.
    const node = src.slice(src.indexOf('toMachineNode'), src.indexOf('toMachineNode') + 700);
    expect(node).toContain('designCapacity');
    expect(node).toContain('downtimeThreshold');
  });
});
