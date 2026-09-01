'use client';

import { useLineBasisStore, type LineBasis } from '@/store/line-basis-store';
import { useScope } from './use-scope';

/**
 * The line-OEE basis, and whether it means anything for the current scope.
 *
 * `applies` is false for a single machine: a machine has no constraint to be
 * measured by — it IS the thing being measured — so the control is hidden rather
 * than shown and quietly ignored. Every caller reads it through here so no page
 * can end up sending the parameter while hiding the control, or the reverse.
 */
export function useLineBasis(): {
  basis: LineBasis;
  applies: boolean;
  /** Spread into API params. Empty when the scope is a single machine. */
  param: { lineBasis?: LineBasis };
  key: string;
} {
  const basis = useLineBasisStore((s) => s.basis);
  const { scope } = useScope();
  const applies = !scope || scope.type !== 'MACHINE';

  return {
    basis,
    applies,
    param: applies ? { lineBasis: basis } : {},
    key: applies ? basis : 'machine',
  };
}
