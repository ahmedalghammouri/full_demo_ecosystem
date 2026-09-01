'use client';

import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { exportToExcel, exportToPDF, type ExportColumn } from '@/lib/export-utils';

interface ExportMenuProps<T> {
  /** Base file name (no extension) and PDF document title. */
  filename: string;
  title: string;
  subtitle?: string;
  rows: T[];
  columns: ExportColumn<T>[];
  disabled?: boolean;
  size?: 'sm' | 'default';
  label?: string;
}

/** Drop-in "Export ▾" button offering Excel (.xlsx) and PDF output for a table. */
export function ExportMenu<T>({ filename, title, subtitle, rows, columns, disabled, size = 'sm', label }: ExportMenuProps<T>) {
  const { t } = useTranslation('common');
  const empty = !rows || rows.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className="gap-1.5 h-8 text-xs" disabled={disabled || empty}>
          <Download size={13} /> {label ?? t('actions.export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="gap-2 text-xs" onClick={() => exportToExcel(filename, rows, columns)}>
          <FileSpreadsheet size={13} className="text-green-500" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 text-xs" onClick={() => exportToPDF(title, rows, columns, subtitle)}>
          <FileText size={13} className="text-red-500" /> PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
