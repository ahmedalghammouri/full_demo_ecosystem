'use client';

import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SortableHeaderProps {
  column: string;
  label: string;
  sortCol: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  className?: string;
}

export function SortableHeader({
  column,
  label,
  sortCol,
  sortDir,
  onSort,
  className,
}: SortableHeaderProps) {
  const active = sortCol === column;
  return (
    <th
      // A clickable <th> is invisible to the keyboard and to a screen reader:
      // there is nothing to tab to and nothing announcing that the column can be
      // sorted or which way it currently is. `aria-sort` is the property a
      // reader announces, and it has to be on the header cell itself.
      scope="col"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'cursor-pointer select-none whitespace-nowrap',
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        'hover:text-foreground hover:bg-muted/30 transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      role="button"
      tabIndex={0}
      onClick={() => onSort(column)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort(column);
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="inline-flex flex-col">
          <ChevronUp
            size={9}
            className={cn(
              'transition-colors',
              active && sortDir === 'asc' ? 'text-primary' : 'text-muted-foreground/30',
            )}
          />
          <ChevronDown
            size={9}
            className={cn(
              '-mt-0.5 transition-colors',
              active && sortDir === 'desc' ? 'text-primary' : 'text-muted-foreground/30',
            )}
          />
        </span>
      </span>
    </th>
  );
}
