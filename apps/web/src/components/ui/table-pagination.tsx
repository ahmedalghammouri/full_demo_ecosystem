'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TablePaginationProps {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  className?: string;
}

export function TablePagination({
  page,
  total,
  limit,
  onPageChange,
  isLoading = false,
  className,
}: TablePaginationProps) {
  const { t, i18n } = useTranslation('common');
  const isRtl = i18n.dir() === 'rtl';
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const FirstIcon = isRtl ? ChevronsRight : ChevronsLeft;
  const LastIcon = isRtl ? ChevronsLeft : ChevronsRight;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  if (total === 0 && !isLoading) return null;

  // Build visible page numbers with ellipsis
  const getPageNumbers = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | 'ellipsis')[] = [1];
    if (page > 3) pages.push('ellipsis');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className={cn('flex items-center justify-between px-4 py-2.5 border-t border-border/30 bg-muted/5', className)}>
      {/* Result count */}
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {isLoading ? (
          <span className="shimmer inline-block h-3 w-32 rounded" />
        ) : (
          <>
            {t('pagination.showing')} <span className="font-medium text-foreground">{from}–{to}</span> {t('pagination.of')}{' '}
            <span className="font-medium text-foreground">{total.toLocaleString()}</span> {t('pagination.results')}
          </>
        )}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-1">
        {/* First page */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(1)}
          disabled={page === 1 || isLoading}
          title={t('pagination.first')}
        >
          <FirstIcon size={13} />
        </Button>

        {/* Previous */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1 || isLoading}
          title={t('pagination.previous')}
        >
          <PrevIcon size={13} />
        </Button>

        {/* Page numbers */}
        <div className="flex items-center gap-0.5">
          {getPageNumbers().map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`e-${i}`} className="w-7 text-center text-[11px] text-muted-foreground">…</span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'default' : 'ghost'}
                size="icon"
                className={cn(
                  'h-7 w-7 text-[11px] font-medium',
                  p === page && 'pointer-events-none',
                )}
                onClick={() => onPageChange(p as number)}
                disabled={isLoading}
              >
                {p}
              </Button>
            ),
          )}
        </div>

        {/* Next */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages || isLoading}
          title={t('pagination.next')}
        >
          <NextIcon size={13} />
        </Button>

        {/* Last page */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages || isLoading}
          title={t('pagination.last')}
        >
          <LastIcon size={13} />
        </Button>
      </div>
    </div>
  );
}
