import {
  normaliseUnit, isConvertibleUnit, piecesPer, toPieces, fromPieces,
  convertUnits, toBaseUnits, sumInPieces, smallestLadderUnit,
} from './units.util';

/**
 * The the pilot site packaging ladder, taken from real master data:
 *   1 INNER  = 1 piece (a 2 kg bag)
 *   1 CARTON = 4 inners
 *   1 PALLET = 40 cartons = 160 inners
 */
const GENTO = { unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' };

/** A ladder where every rung differs, so unit bugs cannot hide behind a ×1. */
const MULTI = { unitsPerInner: 6, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' };

describe('units.util', () => {
  describe('piecesPer', () => {
    it('builds the ladder cumulatively', () => {
      expect(piecesPer(GENTO)).toEqual({ PIECE: 1, INNER: 1, CARTON: 4, PALLET: 160 });
      expect(piecesPer(MULTI)).toEqual({ PIECE: 1, INNER: 6, CARTON: 24, PALLET: 960 });
    });

    it('defaults every missing rung to 1 rather than 0', () => {
      // A zero anywhere would make every conversion collapse to zero.
      expect(piecesPer({})).toEqual({ PIECE: 1, INNER: 1, CARTON: 1, PALLET: 1 });
      expect(piecesPer(null)).toEqual({ PIECE: 1, INNER: 1, CARTON: 1, PALLET: 1 });
      expect(piecesPer({ unitsPerInner: 0, innersPerCarton: 0, cartonsPerPallet: 0 }))
        .toEqual({ PIECE: 1, INNER: 1, CARTON: 1, PALLET: 1 });
    });
  });

  describe('normaliseUnit / isConvertibleUnit', () => {
    it('accepts ladder rungs and their aliases, case-insensitively', () => {
      expect(normaliseUnit('carton')).toBe('CARTON');
      expect(normaliseUnit('CTN')).toBe('CARTON');
      expect(normaliseUnit('BOX')).toBe('CARTON');   // the UI offers BOX
      expect(normaliseUnit('pcs')).toBe('PIECE');
      expect(normaliseUnit('EA')).toBe('PIECE');
      expect(normaliseUnit(' Pallet ')).toBe('PALLET');
    });

    it('rejects units that are not on the packaging ladder', () => {
      // KG is a weight, not a count — converting it would be nonsense. The old
      // code silently treated it as PIECE and produced wrong order quantities.
      expect(normaliseUnit('KG')).toBeNull();
      expect(normaliseUnit('LITRE')).toBeNull();
      expect(isConvertibleUnit('KG')).toBe(false);
      expect(isConvertibleUnit('CARTON')).toBe(true);
      expect(isConvertibleUnit(null)).toBe(false);
    });
  });

  describe('toPieces / fromPieces', () => {
    it('converts every rung to pieces', () => {
      expect(toPieces(1, 'INNER', GENTO)).toBe(1);
      expect(toPieces(1, 'CARTON', GENTO)).toBe(4);
      expect(toPieces(1, 'PALLET', GENTO)).toBe(160);
      expect(toPieces(1, 'PALLET', MULTI)).toBe(960);
    });

    it('round-trips exactly', () => {
      for (const u of ['PIECE', 'INNER', 'CARTON', 'PALLET']) {
        expect(fromPieces(toPieces(7, u, MULTI), u, MULTI)).toBe(7);
      }
    });
  });

  describe('convertUnits', () => {
    it('matches the client-stated ladder: 1 pallet = 40 cartons = 160 inners', () => {
      expect(convertUnits(1, 'PALLET', 'CARTON', GENTO)).toBe(40);
      expect(convertUnits(1, 'PALLET', 'INNER', GENTO)).toBe(160);
      expect(convertUnits(160, 'INNER', 'PALLET', GENTO)).toBe(1);
    });

    it('is symmetric across the ladder', () => {
      expect(convertUnits(convertUnits(5, 'CARTON', 'PIECE', MULTI), 'PIECE', 'CARTON', MULTI)).toBe(5);
    });
  });

  describe('toBaseUnits (inventory only)', () => {
    it('expresses a quantity in the SKU declared base unit', () => {
      expect(toBaseUnits(1, 'PALLET', GENTO)).toBe(40);   // baseUnit CARTON
      expect(toBaseUnits(4, 'INNER', GENTO)).toBe(1);
    });
  });

  describe('sumInPieces — the safe aggregation', () => {
    type Row = { qty: number; unit: string | null };
    const rows: Row[] = [
      { qty: 401, unit: 'INNER' },
      { qty: 430, unit: 'CARTON' },
      { qty: 4851, unit: 'PALLET' },
    ];
    const sum = (rs: Row[]) => sumInPieces(rs, (r) => r.qty, (r) => r.unit, () => GENTO);

    it('converts before adding instead of summing raw numbers', () => {
      // The bug this replaces produced 401 + 430 + 4851 = 5682 "of nothing".
      const { pieces } = sum(rows);
      expect(pieces).toBe(401 * 1 + 430 * 4 + 4851 * 160);
      expect(pieces).not.toBe(5682);
    });

    it('skips off-ladder rows and reports the count instead of guessing', () => {
      const { pieces, skipped } = sum([...rows, { qty: 900, unit: 'KG' }]);
      expect(skipped).toBe(1);
      expect(pieces).toBe(401 * 1 + 430 * 4 + 4851 * 160); // KG contributed nothing
    });

    it('treats a null unit as pieces without flagging it', () => {
      const { pieces, skipped } = sum([{ qty: 10, unit: null }]);
      expect(pieces).toBe(10);
      expect(skipped).toBe(0);
    });

    it('returns zero for an empty set rather than NaN', () => {
      expect(sum([])).toEqual({ pieces: 0, skipped: 0 });
    });
  });
});

/**
 * The label a quantity carries. Internally everything is pieces, but "pcs" is only
 * the honest word when a piece is genuinely the smallest thing the plant handles.
 */
describe('smallestLadderUnit', () => {
  it('calls it an INNER when one inner holds exactly one piece', () => {
    // SDPF's detergent: 1 piece per inner, 4 inners per carton, 40 cartons per pallet.
    expect(smallestLadderUnit({ unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40 }))
      .toBe('INNER');
  });

  it('stays on PIECE when an inner really does hold several pieces', () => {
    expect(smallestLadderUnit({ unitsPerInner: 6, innersPerCarton: 4, cartonsPerPallet: 40 }))
      .toBe('PIECE');
  });

  it('does not climb past a rung that holds more than one piece', () => {
    // 1 piece/inner but 1 inner/carton too — a carton IS a piece, so CARTON is right.
    expect(smallestLadderUnit({ unitsPerInner: 1, innersPerCarton: 1, cartonsPerPallet: 40 }))
      .toBe('CARTON');
  });

  it('falls back to PIECE when the packaging is unknown', () => {
    expect(smallestLadderUnit(null)).toBe('PIECE');
  });
});
