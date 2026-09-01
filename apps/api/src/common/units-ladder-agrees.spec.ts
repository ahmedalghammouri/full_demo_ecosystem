import * as api from './units.util';
import * as shared from '../../../../packages/shared/src/units';

/**
 * THE PACKAGING LADDER EXISTS TWICE. THIS IS WHAT KEEPS THE TWO HONEST.
 *
 * ── Why there are two ───────────────────────────────────────────────────────
 * The gateway now shows a material balance across the line on its own
 * dashboard — the filler's inners against the cartoner's cartons against the
 * palletiser's pallets — and that needs exactly the arithmetic in
 * `units.util.ts`. The obvious move was to lift it into `@i360/shared` and
 * import it from both.
 *
 * It does not survive the deploy. The API image is built with `apps/api` as its
 * Docker context (see docker-compose.hostinger.yml), so `packages/` is not
 * there to copy and `pnpm install` cannot resolve a `workspace:*` dependency.
 * The API has never had one. Widening that context is a rewrite of a working
 * production build, and not something to slip in underneath a feature request.
 *
 * So the gateway has its copy in `@i360/shared` — which pkg CAN bundle — and
 * the API keeps its own. Two copies of "how many inners are in a carton" is
 * exactly the kind of split that this codebase has spent a long time removing,
 * and the only reason it is tolerable here is that it cannot drift quietly:
 *
 * This test runs both implementations over the same inputs and fails the moment
 * they disagree. Editing one and not the other breaks the build.
 *
 * If the API's Docker context is ever widened to the repo root, delete the
 * duplicate, import `@i360/shared` in both, and delete this file with it.
 */
describe('the two copies of the packaging ladder agree', () => {
  /** Real the pilot site master data, plus a ladder where every rung differs so a ×1 cannot hide a bug. */
  const PACKAGINGS = [
    { unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' },
    { unitsPerInner: 6, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' },
    { unitsPerInner: 12, innersPerCarton: 6, cartonsPerPallet: 25, baseUnit: 'PIECE' },
    {},
    null,
  ];

  const UNITS = [
    'PIECE', 'PIECES', 'PC', 'EA', 'INNER', 'BAG', 'CARTON', 'CTN', 'BOX', 'CASE',
    'PALLET', 'PLT', 'carton', ' Pallet ', 'KG', 'LITRE', '', null, undefined,
  ];

  const QUANTITIES = [0, 1, 7, 240, 1280, 0.5, -3];

  it('exports the same surface', () => {
    const surface = (m: Record<string, unknown>) =>
      Object.keys(m).filter((k) => typeof m[k] === 'function').sort();
    // A function present in one and missing from the other is drift too — and
    // would otherwise show up only as an import error in whichever app added it.
    expect(surface(shared as any)).toEqual(expect.arrayContaining(surface(api as any)));
  });

  it('builds the same ladder from the same packaging', () => {
    for (const pkg of PACKAGINGS) {
      expect(shared.piecesPer(pkg as any)).toEqual(api.piecesPer(pkg as any));
    }
  });

  it('normalises units identically, including what it refuses', () => {
    for (const u of UNITS) {
      expect(shared.normaliseUnit(u as any)).toBe(api.normaliseUnit(u as any));
      expect(shared.isConvertibleUnit(u as any)).toBe(api.isConvertibleUnit(u as any));
    }
  });

  it('converts identically across every rung, packaging and quantity', () => {
    for (const pkg of PACKAGINGS) {
      for (const u of UNITS) {
        for (const q of QUANTITIES) {
          expect(shared.toPieces(q, u as any, pkg as any))
            .toBe(api.toPieces(q, u as any, pkg as any));
          expect(shared.fromPieces(q, u as any, pkg as any))
            .toBe(api.fromPieces(q, u as any, pkg as any));
          expect(shared.toBaseUnits(q, u as any, pkg as any))
            .toBe(api.toBaseUnits(q, u as any, pkg as any));
        }
      }
    }
  });

  it('converts between rungs identically', () => {
    const rungs = ['PIECE', 'INNER', 'CARTON', 'PALLET'];
    for (const pkg of PACKAGINGS) {
      for (const from of rungs) {
        for (const to of rungs) {
          expect(shared.convertUnits(97, from, to, pkg as any))
            .toBe(api.convertUnits(97, from, to, pkg as any));
        }
      }
    }
  });

  it('picks the same smallest rung', () => {
    for (const pkg of PACKAGINGS) {
      expect(shared.smallestLadderUnit(pkg as any)).toBe(api.smallestLadderUnit(pkg as any));
    }
  });

  it('agrees on the ladder itself', () => {
    expect(shared.UNIT_LADDER).toEqual(api.UNIT_LADDER);
  });
});
