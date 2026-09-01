import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * Every Prisma delegate the Danger Zone deletes from must actually exist.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The reset endpoint returned a 500 in production:
 *
 *     Cannot read properties of undefined (reading 'deleteMany')
 *
 * `tx.inventoryTransaction` was undefined — there has never been such a model.
 * Two more were wrong in the same way: `maintenanceTask` (the model is `PMTask`,
 * whose delegate is `pMTask`) and `maintenanceRequest` (no such thing at all).
 *
 * A wrong delegate name is invisible to the compiler, because the transaction
 * client is typed `any` — it has to be, since these deletes must tolerate a model
 * being absent from a deployment. So the type system cannot help here and a test
 * has to. This one reads the source, extracts every `tx.<model>.deleteMany` it
 * finds, and checks each against the generated client.
 *
 * It fails on the NAME, not on running a delete, so it needs no database.
 */
describe('Danger Zone — Prisma delegates', () => {
  // Comments are stripped first: the fix's own doc block names
  // `tx.someModel.deleteMany` as an illustration, and a scan that counted prose
  // as code would fail on the explanation rather than on the code.
  const source = readFileSync(join(__dirname, 'system.service.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  /** Every `tx.foo.deleteMany` / `p.foo.count` the reset code addresses. */
  const referenced = [
    ...new Set(
      [...source.matchAll(/\b(?:tx|p)\.([a-zA-Z][a-zA-Z0-9]*)\.(?:deleteMany|count)\b/g)]
        .map((m) => m[1]),
    ),
  ].sort();

  /**
   * Delegates the generated client exposes, taken from the DMMF rather than from
   * `new PrismaClient()`. The name list is all this test needs, and instantiating a
   * client here left a live handle in the worker that slowed the whole suite to a
   * timeout when it ran alongside the other system specs.
   *
   * Prisma lowercases only the FIRST character of a model name, which is why
   * `PMTask` becomes `pMTask` and not `pmTask`.
   */
  const delegates = new Set(
    Prisma.dmmf.datamodel.models.map((m) => m.name[0].toLowerCase() + m.name.slice(1)),
  );

  it('addresses at least the models the Danger Zone is documented to clear', () => {
    // Guards the regex itself: if it silently stopped matching, every assertion
    // below would pass over an empty list and prove nothing.
    expect(referenced.length).toBeGreaterThan(20);
  });

  it.each([
    ['stockMovement', 'inventory'],
    ['pMTask', 'maintenance'],
    ['maintenanceWO', 'maintenance'],
    ['alarmEvent', 'alarms'],
    ['downtimeEvent', 'downtime'],
    ['machineStateRecord', 'downtime'],
    ['shiftInstance', 'shifts'],
    ['notification', 'notifications'],
  ])('still clears %s (%s scope)', (model) => {
    expect(referenced).toContain(model);
  });

  it('names no delegate the Prisma client does not have', () => {
    const missing = referenced.filter((name) => !delegates.has(name));
    // Named in the message so a failure says WHICH one, and what the near
    // matches are — the three real ones were all near-misses of a real model.
    const hint = missing.map((m) => {
      const stem = m.toLowerCase().slice(0, 6);
      const near = [...delegates].filter((d) => d.toLowerCase().includes(stem));
      return `${m}${near.length ? ` (did you mean: ${near.join(', ')}?)` : ' (no similar model)'}`;
    });
    expect(hint).toEqual([]);
  });

  it('does not reference the three names that caused the 500', () => {
    for (const gone of ['inventoryTransaction', 'maintenanceTask', 'maintenanceRequest']) {
      expect(referenced).not.toContain(gone);
    }
  });
});
