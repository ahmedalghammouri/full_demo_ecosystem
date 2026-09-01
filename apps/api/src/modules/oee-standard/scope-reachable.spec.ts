import * as fs from 'fs';
import * as path from 'path';

/**
 * Every filter the engine understands is reachable from its endpoint.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `OeeScope` carried `workOrderId`, and `where()` built a predicate for it. The
 * controller never read it. So `?workOrderId=…` was accepted, ignored, and the
 * page came back with the unfiltered figures — a filter that reports success and
 * does nothing, which is worse than one that errors: the reader believes the
 * narrowing happened and reads the whole plant's numbers as one order's.
 *
 * It survived because nothing connects the two files. The service compiles, the
 * controller compiles, and a dropped query parameter is not a type error — the
 * scope object is simply built without that key, which is legal.
 *
 * This holds the two together: for every optional key on the scope interface,
 * the controller must both DECLARE it as a query parameter and PASS it into the
 * scope it builds. Declaring without passing is the same silent failure wearing
 * a Swagger entry.
 */

const SRC = path.resolve(__dirname, '..', '..');

interface Pair {
  label: string;
  service: string;
  iface: string;
  controller: string;
  /** Keys that are legitimately not query parameters on this endpoint. */
  exempt?: string[];
}

const PAIRS: Pair[] = [
  {
    label: 'OEE standard',
    service: 'modules/oee-standard/oee-standard.service.ts',
    iface: 'OeeScope',
    controller: 'modules/oee-standard/oee-standard.controller.ts',
  },
  {
    label: 'OEE schedule',
    service: 'modules/oee-schedule/oee-schedule.service.ts',
    iface: 'ScheduleScope',
    controller: 'modules/oee-schedule/oee-schedule.controller.ts',
  },
  {
    label: 'Live shift',
    service: 'modules/oee-standard/oee-standard.service.ts',
    iface: 'OeeScope',
    controller: 'modules/live-shift/live-shift.controller.ts',
    // The live endpoint owns these two rather than taking them from the caller:
    // the shift is the one the clock says we are in, and the job order is
    // whatever is open inside it. Accepting either would let the page be pointed
    // somewhere its own header contradicts.
    exempt: ['shiftTemplateId', 'jobOrderId'],
  },
];

/**
 * Scope keys that are set INSIDE the API and must never be caller-supplied.
 *
 * `machineIds` is how `LineBasisService` asks an engine for "the outfeed points"
 * or "the constraint" while it computes a line's score. Exposing it as a query
 * parameter would let a caller narrow the page to an arbitrary set of machines
 * and still be told it was looking at the line — the line basis would be
 * computed over whatever they picked. It is exempt because it is deliberately
 * unreachable, not because it was forgotten, and this list is where that
 * distinction is recorded.
 */
const INTERNAL_ONLY = ['machineIds'];

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** The optional keys declared on an exported scope interface. */
function scopeKeys(source: string, iface: string): string[] {
  const m = new RegExp(`export interface ${iface}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!m) throw new Error(`interface ${iface} not found`);
  return [...m[1].matchAll(/^\s*(\w+)\?:/gm)].map((x) => x[1]);
}

describe('Every scope filter is reachable from its endpoint', () => {
  for (const p of PAIRS) {
    describe(p.label, () => {
      const keys = scopeKeys(read(p.service), p.iface);
      const controller = read(p.controller);

      it('declares scope keys to check', () => {
        expect(keys.length).toBeGreaterThan(3);
      });

      for (const key of INTERNAL_ONLY.filter((k) => keys.includes(k))) {
        it(`${key} is NOT exposed as a query parameter`, () => {
          expect(controller).not.toContain(`@Query('${key}')`);
        });
      }

      for (const key of keys) {
        const skip = p.exempt?.includes(key) || INTERNAL_ONLY.includes(key);

        (skip ? it.skip : it)(`${key} is accepted as a query parameter`, () => {
          expect(controller).toContain(`@Query('${key}')`);
        });

        (skip ? it.skip : it)(`${key} is passed into the scope, not just declared`, () => {
          // Either shorthand in a scope literal, or `key: something` on a line
          // that assigns it. Declaring a parameter and never using it is the
          // exact failure mode this guards.
          const used = new RegExp(`(^|[\\s{,])${key}\\s*[,}:]`, 'm').test(
            controller.replace(new RegExp(`@Query\\('${key}'\\)\\s*${key}\\?:\\s*string,`, 'g'), ''),
          );
          expect(used).toBe(true);
        });
      }
    });
  }
});
