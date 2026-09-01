'use client';

import { useState, useCallback, useMemo } from 'react';

/**
 * Generic multi-row selection state for any table of `{ id }` rows.
 * Selection is keyed by id so it survives re-sorts; it auto-prunes ids that
 * leave the current row set (e.g. after a page change or filter).
 */
export function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const visibleSelected = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected]);

  const allSelected = ids.length > 0 && visibleSelected.length === ids.length;
  const someSelected = visibleSelected.length > 0 && !allSelected;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const everyVisibleSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (everyVisibleSelected) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }, [ids]);

  const clear = useCallback(() => setSelected(new Set()), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return {
    selectedIds: visibleSelected,
    count: visibleSelected.length,
    allSelected,
    someSelected,
    isSelected,
    toggle,
    toggleAll,
    clear,
  };
}
