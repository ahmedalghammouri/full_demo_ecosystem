'use client';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface RowAction {
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  variant?: 'default' | 'destructive' | 'warning' | 'success';
  separator?: boolean;
  hidden?: boolean;
}

interface TableRowActionsProps {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  extraActions?: RowAction[];
  editDisabled?: boolean;
  deleteDisabled?: boolean;
}

const VARIANT_CLS: Record<string, string> = {
  default: '',
  destructive: 'text-destructive focus:text-destructive',
  warning: 'text-yellow-400 focus:text-yellow-400',
  success: 'text-green-400 focus:text-green-400',
};

export function TableRowActions({
  onView,
  onEdit,
  onDelete,
  extraActions = [],
  editDisabled = false,
  deleteDisabled = false,
}: TableRowActionsProps) {
  const { t } = useTranslation('common');
  const allActions: RowAction[] = [
    ...(onView ? [{ label: t('actions.viewDetails'), icon: Eye, onClick: onView }] : []),
    ...(onEdit && !editDisabled ? [{ label: t('actions.edit'), icon: Pencil, onClick: onEdit }] : []),
    ...extraActions.filter(a => !a.hidden),
    ...(onDelete && !deleteDisabled ? [{ label: t('actions.delete'), icon: Trash2, onClick: onDelete, variant: 'destructive' as const, separator: true }] : []),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 data-[state=open]:bg-muted" onClick={e => e.stopPropagation()}>
          <MoreHorizontal size={14} />
          <span className="sr-only">{t('rowActions.label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {allActions.map((action, i) => {
          const Icon = action.icon;
          return (
            <React.Fragment key={action.label}>
              {action.separator && i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={action.onClick}
                className={cn('gap-2 text-xs cursor-pointer', VARIANT_CLS[action.variant ?? 'default'])}
              >
                {Icon && <Icon size={12} />}
                {action.label}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
