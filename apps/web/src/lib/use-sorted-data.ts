import { useState, useMemo, useCallback } from 'react';

export type SortDir = 'asc' | 'desc';

export function useSortedData<T extends object>(
  data: T[],
  defaultCol = 'createdAt',
  defaultDir: SortDir = 'desc',
) {
  const [sortCol, setSortCol] = useState(defaultCol);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const handleSort = useCallback((col: string) => {
    setSortCol(prev => {
      if (prev === col) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDir('desc');
      return col;
    });
  }, []);

  const sortedData = useMemo(() => {
    if (!data?.length) return data ?? [];
    return [...data].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortCol];
      const bv = (b as Record<string, unknown>)[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortCol, sortDir]);

  return { sortedData, sortCol, sortDir, handleSort };
}
