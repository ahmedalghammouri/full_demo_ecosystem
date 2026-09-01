'use client';

/**
 * FailureModeMultiSelect — searchable MULTI-select for linking several FMEA
 * failure modes to a maintenance work order. Selected modes show as removable
 * chips; the popover list toggles membership and stays open for fast multi-pick.
 *
 * Built on Radix Popover so it behaves correctly inside the maintenance form
 * popup (proper portal + z-index, never clipped).
 */

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown, Search, X, Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FailureModeOption {
  id: string;
  code: string;
  description: string;
  category: string;
  rpn: number;
}

interface Props {
  items: FailureModeOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  addLabel?: string;
  disabled?: boolean;
}

export function FailureModeMultiSelect({
  items, value, onChange,
  placeholder = 'Select failure modes…',
  searchPlaceholder = 'Search failure modes…',
  emptyText = 'No matches',
  addLabel = 'Add failure mode',
  disabled,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selectedSet = React.useMemo(() => new Set(value), [value]);
  const byId = React.useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => `${it.code} ${it.description} ${it.category}`.toLowerCase().includes(q));
  }, [items, search]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  const remove = (id: string) => onChange(value.filter((v) => v !== id));

  return (
    <div className="space-y-1.5">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const it = byId.get(id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 pl-2 pr-1 py-1 text-xs">
                <span className="font-mono text-[10px] text-muted-foreground">{it?.code ?? '—'}</span>
                <span className="truncate max-w-[200px]">{it?.description ?? id}</span>
                {it && <span className="text-[10px] text-muted-foreground">· RPN {it.rpn}</span>}
                <button type="button" disabled={disabled} onClick={() => remove(id)} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Add trigger */}
      <PopoverPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border border-input bg-background text-left shadow-sm ring-offset-background transition-colors h-9 text-sm px-3',
              'hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'data-[state=open]:ring-1 data-[state=open]:ring-ring data-[state=open]:border-primary/50',
            )}
          >
            <Plus size={14} className="shrink-0 text-muted-foreground" />
            <span className={cn('flex-1 truncate', value.length === 0 && 'text-muted-foreground')}>
              {value.length === 0 ? placeholder : addLabel}
            </span>
            <ChevronDown size={14} className="shrink-0 opacity-50" />
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className="z-[100] w-[var(--radix-popover-trigger-width)] min-w-[260px] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="p-2 border-b border-border/60">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full h-8 pl-8 pr-2 text-sm rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <div className="p-1 max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">{emptyText}</div>
              ) : (
                filtered.map((it) => {
                  const isSel = selectedSet.has(it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => toggle(it.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors',
                        isSel ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                      )}
                    >
                      <span className={cn('shrink-0 w-4 h-4 rounded border flex items-center justify-center', isSel ? 'bg-primary border-primary text-primary-foreground' : 'border-border')}>
                        {isSel && <Check size={11} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{it.code} — {it.description}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{it.category} · RPN {it.rpn}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
