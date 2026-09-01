'use client';

/**
 * EntityPicker — the canonical searchable single-select for entity-reference
 * fields (product / SKU, raw material, spare part, lot, location, …).
 *
 * A trigger button opens a popover with a search box and a scrollable list of
 * rows: a bold primary line, an optional muted/mono secondary line, and an
 * optional right-aligned meta (e.g. "2 in stock"). Same visual language as the
 * spare-parts picker in the maintenance order form.
 *
 * Built on Radix Popover so it works correctly inside dialogs (proper portal,
 * focus management and pointer handling) and is never clipped by overflow.
 *
 *   <EntityPicker
 *     items={skus} value={skuId} onChange={(id) => setSkuId(id ?? '')}
 *     getId={(s) => s.id}
 *     getPrimary={(s) => s.name}
 *     getSecondary={(s) => s.code}
 *     getMeta={(s) => `${s.stock} in stock`}
 *     placeholder="Select product…" searchPlaceholder="Search by name or code…"
 *   />
 */

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EntityPickerProps<T> {
  items: T[];
  value: string | null | undefined;
  onChange: (id: string | null, item: T | null) => void;
  getId: (item: T) => string;
  getPrimary: (item: T) => React.ReactNode;
  /** Muted secondary line (usually a mono code/number). */
  getSecondary?: (item: T) => React.ReactNode;
  /** Right-aligned meta (e.g. stock / cost). */
  getMeta?: (item: T) => React.ReactNode;
  /** Text matched against the search box. Defaults to primary+secondary text. */
  searchText?: (item: T) => string;
  /** Leading icon shown in trigger + rows. */
  icon?: React.ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Allow clearing back to null (default true). */
  clearable?: boolean;
  size?: 'sm' | 'md';
  /** Extra classes for the trigger button. */
  className?: string;
  /** id for label association. */
  id?: string;
  /** Max rows rendered (perf). Default 50. */
  maxResults?: number;
}

const SIZES = {
  sm: 'h-8 text-xs px-2.5',
  md: 'h-9 text-sm px-3',
} as const;

export function EntityPicker<T>({
  items,
  value,
  onChange,
  getId,
  getPrimary,
  getSecondary,
  getMeta,
  searchText,
  icon,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  clearable = true,
  size = 'md',
  className,
  id,
  maxResults = 50,
}: EntityPickerProps<T>) {
  const { t } = useTranslation('common');
  const placeholderText = placeholder ?? t('picker.select');
  const searchPlaceholderText = searchPlaceholder ?? t('picker.search');
  const emptyTextLabel = emptyText ?? t('picker.noMatches');
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selected = React.useMemo(
    () => items.find((it) => getId(it) === value) ?? null,
    [items, value, getId],
  );

  const matchText = React.useCallback(
    (it: T) => {
      if (searchText) return searchText(it);
      const a = getSecondary ? String(getSecondary(it) ?? '') : '';
      return `${String(getPrimary(it) ?? '')} ${a}`;
    },
    [searchText, getPrimary, getSecondary],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? items.filter((it) => matchText(it).toLowerCase().includes(q)) : items;
    return list.slice(0, maxResults);
  }, [items, search, matchText, maxResults]);

  const choose = (it: T) => {
    onChange(getId(it), it);
    setOpen(false);
    setSearch('');
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null, null);
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch('');
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-input bg-background text-left shadow-sm ring-offset-background transition-colors',
            'hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'data-[state=open]:ring-1 data-[state=open]:ring-ring data-[state=open]:border-primary/50',
            SIZES[size],
            className,
          )}
        >
          {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
          <span className={cn('flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected ? (
              <>
                {getPrimary(selected)}
                {getSecondary && (
                  <span className="ml-1.5 text-muted-foreground font-mono text-[0.85em]">
                    {getSecondary(selected)}
                  </span>
                )}
              </>
            ) : (
              placeholderText
            )}
          </span>
          {clearable && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={clear}
              className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground"
            >
              <X size={size === 'sm' ? 11 : 13} />
            </span>
          )}
          <ChevronDown size={size === 'sm' ? 12 : 14} className="shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-[100] w-[var(--radix-popover-trigger-width)] min-w-[260px] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            // keep native focus flow but land on the search input below
            e.preventDefault();
          }}
        >
          <div className="p-2 border-b border-border/60">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholderText}
                className="w-full h-8 pl-8 pr-2 text-sm rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="p-1 max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">{emptyTextLabel}</div>
            ) : (
              filtered.map((it) => {
                const itemId = getId(it);
                const isSel = itemId === value;
                return (
                  <button
                    key={itemId}
                    type="button"
                    onClick={() => choose(it)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors',
                      isSel ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                    )}
                  >
                    {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{getPrimary(it)}</div>
                      {getSecondary && (
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          {getSecondary(it)}
                        </div>
                      )}
                    </div>
                    {getMeta && <div className="shrink-0 ml-2 text-right text-xs">{getMeta(it)}</div>}
                    {isSel && <Check size={14} className="shrink-0 ml-1 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
