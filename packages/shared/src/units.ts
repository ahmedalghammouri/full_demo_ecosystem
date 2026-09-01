/**
 * PACKAGING-LADDER UNIT CONVERSION — the single source of truth for quantities.
 *
 * A product (SKU) defines how its packaging rolls up:
 *
 *     PIECE → INNER (×unitsPerInner) → CARTON (×innersPerCarton) → PALLET (×cartonsPerPallet)
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 * Different routing steps record output in DIFFERENT units: the filler counts
 * inners, the cartoner counts cartons, the palletiser counts pallets. Adding
 * those raw numbers is meaningless — "401 inners + 430 cartons + 4851 pallets"
 * is not 5682 of anything. Every aggregation MUST convert to a common unit first.
 *
 * That common unit is PIECE: the smallest rung, so conversion is always exact and
 * never divides. Internal maths is in pieces; PRESENTATION converts to the
 * factory's configured display unit (Factory.displayUnit). Changing the display
 * unit can therefore never alter a computed value.
 *
 * SKU.baseUnit is a DIFFERENT concept — it governs inventory stock levels. Do not
 * use it as a display unit and do not repurpose it; `toBaseUnits` is kept only for
 * the inventory paths that legitimately need it.
 */

export interface SkuPackaging {
  unitsPerInner?: number | null;
  innersPerCarton?: number | null;
  cartonsPerPallet?: number | null;
  baseUnit?: string | null;
}

/** Canonical rungs, smallest first. */
export const UNIT_LADDER = ['PIECE', 'INNER', 'CARTON', 'PALLET'] as const;
export type LadderUnit = (typeof UNIT_LADDER)[number];

/**
 * Aliases seen in master data and UI dropdowns. Anything not on the ladder and not
 * aliased here CANNOT be converted — `isConvertibleUnit` reports that rather than
 * letting it silently fall through to PIECE (which is how BOX and KG selections
 * used to produce wrong order quantities with no error).
 */
const ALIASES: Record<string, LadderUnit> = {
  PIECE: 'PIECE', PIECES: 'PIECE', PC: 'PIECE', PCS: 'PIECE', EA: 'PIECE', EACH: 'PIECE', UNIT: 'PIECE', UNITS: 'PIECE',
  INNER: 'INNER', INNERS: 'INNER', BAG: 'INNER', POUCH: 'INNER',
  CARTON: 'CARTON', CARTONS: 'CARTON', CTN: 'CARTON', BOX: 'CARTON', CASE: 'CARTON',
  PALLET: 'PALLET', PALLETS: 'PALLET', PLT: 'PALLET',
};

/** Normalise a free-text unit to a ladder rung, or null when it is off-ladder. */
export function normaliseUnit(unit: string | null | undefined): LadderUnit | null {
  if (!unit) return null;
  return ALIASES[unit.trim().toUpperCase()] ?? null;
}

/** True when this unit can take part in packaging arithmetic (KG/L cannot). */
export function isConvertibleUnit(unit: string | null | undefined): boolean {
  return normaliseUnit(unit) !== null;
}

/** Pieces contained in one of each packaging unit, for this SKU. */
export function piecesPer(pkg: SkuPackaging | null | undefined): Record<LadderUnit, number> {
  const inner = Math.max(1, pkg?.unitsPerInner || 1);
  const carton = Math.max(1, pkg?.innersPerCarton || 1) * inner;
  const pallet = Math.max(1, pkg?.cartonsPerPallet || 1) * carton;
  return { PIECE: 1, INNER: inner, CARTON: carton, PALLET: pallet };
}

/**
 * The name of the smallest REAL rung of this product's packaging ladder.
 *
 * All internal arithmetic is done in PIECES, but "piece" is an abstraction: for a
 * product packed as 1 piece per inner, a piece IS an inner, and the shop floor
 * calls it an inner. Labelling those quantities "pcs" reads as a different — and
 * therefore wrong — number to the people using the screen.
 *
 * Derived from the SKU's own packaging rather than configured anywhere, so a
 * product that genuinely has several pieces per inner still reports PIECE.
 */
export function smallestLadderUnit(pkg: SkuPackaging | null | undefined): LadderUnit {
  // With no packaging every rung defaults to a factor of 1, which would let the walk
  // below climb all the way to PALLET and label a piece count "pallets". Unknown
  // packaging means unknown ladder, so say the one thing that is always true.
  if (!pkg || (!pkg.unitsPerInner && !pkg.innersPerCarton && !pkg.cartonsPerPallet)) return 'PIECE';
  const per = piecesPer(pkg);
  // The HIGHEST rung that is still worth exactly one piece. PIECE always qualifies,
  // so this returns INNER only when an inner really does hold a single piece.
  let smallest: LadderUnit = 'PIECE';
  for (const rung of UNIT_LADDER) {
    if (per[rung] === 1) smallest = rung;
  }
  return smallest;
}

/**
 * Quantity in PIECES — the canonical unit for all internal arithmetic.
 * An unrecognised unit is treated as PIECE and is the caller's cue to have
 * validated with `isConvertibleUnit` first.
 */
export function toPieces(qty: number, fromUnit: string | null | undefined, pkg: SkuPackaging | null | undefined): number {
  const rung = normaliseUnit(fromUnit) ?? 'PIECE';
  return qty * piecesPer(pkg)[rung];
}

/** Pieces → a packaging unit. The inverse of {@link toPieces}. */
export function fromPieces(pieces: number, toUnit: string | null | undefined, pkg: SkuPackaging | null | undefined): number {
  const rung = normaliseUnit(toUnit) ?? 'PIECE';
  return pieces / piecesPer(pkg)[rung];
}

/** Convert between two packaging units of the same SKU. */
export function convertUnits(qty: number, fromUnit: string, toUnit: string, pkg: SkuPackaging | null | undefined): number {
  return fromPieces(toPieces(qty, fromUnit, pkg), toUnit, pkg);
}

/**
 * Quantity in the SKU's declared base unit.
 *
 * INVENTORY ONLY — stock levels are held in this unit. Analytics and dashboards
 * must use pieces internally and the factory display unit for presentation;
 * baseUnit varies per SKU, so it cannot give a consistent cross-product total.
 */
export function toBaseUnits(qty: number, fromUnit: string | null | undefined, pkg: SkuPackaging | null | undefined): number {
  return convertUnits(qty, fromUnit ?? 'PIECE', pkg?.baseUnit ?? 'PIECE', pkg);
}

/**
 * Sum quantities recorded in mixed units, safely.
 *
 * This is the helper every roll-up should reach for. Rows whose unit is off-ladder
 * are EXCLUDED and reported in `skipped`, so an un-convertible value degrades to a
 * visible gap rather than a silently wrong total.
 */
export function sumInPieces<T>(
  rows: T[],
  qtyOf: (row: T) => number | null | undefined,
  unitOf: (row: T) => string | null | undefined,
  pkgOf: (row: T) => SkuPackaging | null | undefined,
): { pieces: number; skipped: number } {
  let pieces = 0;
  let skipped = 0;
  for (const row of rows) {
    const qty = qtyOf(row) ?? 0;
    if (!qty) continue;
    const unit = unitOf(row);
    if (unit != null && !isConvertibleUnit(unit)) { skipped += 1; continue; }
    pieces += toPieces(qty, unit, pkgOf(row));
  }
  return { pieces, skipped };
}
