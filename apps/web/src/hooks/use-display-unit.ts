'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/services/api.client';

/**
 * The factory's DISPLAY unit for quantities.
 *
 * ── Why quantities need this at all ─────────────────────────────────────────
 * Routing steps count in different packaging units — the filler in inners, the
 * cartoner in cartons, the palletiser in pallets. They can only be added after
 * conversion, so the API stores and returns every quantity in PIECES (the
 * smallest rung, where conversion is exact). This setting decides which rung the
 * user READS those totals on. It can never change a computed value.
 *
 * ── The honest limit ────────────────────────────────────────────────────────
 * Converting pieces to inners/cartons/pallets needs the SKU's packaging, and a
 * total that spans several SKUs has no single conversion factor. So:
 *   • single-SKU quantity  → converted to the display unit
 *   • mixed/aggregate total → stays in pieces and is labelled as such
 * `formatQty` enforces that rather than inventing a factor.
 */
export interface SkuPackaging {
  unitsPerInner?: number | null;
  innersPerCarton?: number | null;
  cartonsPerPallet?: number | null;
}

const LADDER = ['PIECE', 'INNER', 'CARTON', 'PALLET'] as const;
export type LadderUnit = (typeof LADDER)[number];

function piecesPer(pkg: SkuPackaging | null | undefined): Record<LadderUnit, number> {
  const inner = Math.max(1, pkg?.unitsPerInner || 1);
  const carton = Math.max(1, pkg?.innersPerCarton || 1) * inner;
  const pallet = Math.max(1, pkg?.cartonsPerPallet || 1) * carton;
  return { PIECE: 1, INNER: inner, CARTON: carton, PALLET: pallet };
}

export function useDisplayUnit() {
  const { t } = useTranslation('common');

  const { data } = useQuery({
    queryKey: ['system', 'display-unit'],
    queryFn: () => api.get<{ displayUnit: string; ladder: string[] }>('/system/display-unit'),
    staleTime: 5 * 60_000,
  });

  const displayUnit = (data?.displayUnit ?? 'PIECE').toUpperCase() as LadderUnit;

  /** Short label for a unit, translated. Falls back to the raw code. */
  const unitLabel = (unit: string = displayUnit) =>
    t(`units.${unit.toLowerCase()}`, { defaultValue: unit.toLowerCase() });

  /**
   * Render a piece-denominated quantity.
   *
   * Pass the SKU packaging when the figure belongs to ONE product; without it the
   * value stays in pieces, because there is no correct factor for a total that
   * mixes products.
   */
  const formatQty = (
    pieces: number | null | undefined,
    pkg?: SkuPackaging | null,
  ): { value: number; unit: LadderUnit; label: string; exact: boolean } => {
    const p = pieces ?? 0;
    if (!pkg || displayUnit === 'PIECE') {
      return { value: Math.round(p), unit: 'PIECE', label: unitLabel('PIECE'), exact: true };
    }
    const factor = piecesPer(pkg)[displayUnit];
    const converted = p / factor;
    return {
      value: Math.round(converted * 100) / 100,
      unit: displayUnit,
      label: unitLabel(displayUnit),
      // Flagged when the conversion does not land on a whole unit, so a partial
      // pallet is never silently presented as a round number.
      exact: Number.isInteger(converted),
    };
  };

  return { displayUnit, ladder: (data?.ladder ?? [...LADDER]) as LadderUnit[], unitLabel, formatQty };
}
