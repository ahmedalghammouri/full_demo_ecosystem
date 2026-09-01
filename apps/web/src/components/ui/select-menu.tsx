'use client';

/**
 * SelectMenu — the canonical single-select dropdown for plain fields.
 *
 * Renders as an outline Button trigger + a themed popover menu with a checkmark
 * on the active option — the same look as the "Gantt View" menu in the Gantt
 * toolbar. Use this instead of a native <select> so every dropdown shares one
 * dark-theme style. For rich/searchable/async pickers use the Radix `Select`.
 *
 *   size="sm"  → compact toolbar filters (h-8, text-xs) — default
 *   size="md"  → form fields (h-9, text-sm); pair with `fullWidth`
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface SelectMenuOption {
  value: string;
  /** Rendered in the menu row (may include icons). */
  label: React.ReactNode;
  /** Plain-text shown in the trigger when `label` is a node. Defaults to `label`. */
  text?: string;
  disabled?: boolean;
}

export interface SelectMenuProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectMenuOption[];
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  /** Optional bold header inside the menu. */
  menuLabel?: React.ReactNode;
  size?: 'sm' | 'md';
  /** Stretch the trigger (and match the menu width) — for form fields. */
  fullWidth?: boolean;
  align?: 'start' | 'center' | 'end';
  /** Extra classes for the trigger button. */
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
}

export function SelectMenu({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  menuLabel,
  size = 'sm',
  fullWidth = false,
  align = 'start',
  className,
  contentClassName,
  disabled,
}: SelectMenuProps) {
  const selected = options.find((o) => o.value === value);
  const triggerText = selected ? selected.text ?? selected.label : placeholder;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'justify-between gap-1.5 font-normal',
            size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
            fullWidth && 'w-full',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronDown className="opacity-50 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn(
          'max-h-72 overflow-y-auto',
          fullWidth && 'w-[var(--radix-dropdown-menu-trigger-width)]',
          contentClassName,
        )}
      >
        {menuLabel && <DropdownMenuLabel className="text-xs">{menuLabel}</DropdownMenuLabel>}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            onCheckedChange={() => onValueChange(o.value)}
            className={size === 'sm' ? 'text-xs' : 'text-sm'}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
