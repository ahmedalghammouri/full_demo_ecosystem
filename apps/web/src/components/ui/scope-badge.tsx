'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Factory, LayoutGrid, GitBranch, Cpu, X } from 'lucide-react';
import { useScopeStore, type ScopeType } from '@/store/scope-store';
import { cn } from '@/lib/utils';

const TYPE_ICON: Record<ScopeType, React.ElementType> = {
  FACTORY: Factory, AREA: LayoutGrid, LINE: GitBranch, MACHINE: Cpu,
};
const TYPE_COLOR: Record<ScopeType, string> = {
  FACTORY: 'text-blue-400', AREA: 'text-violet-400', LINE: 'text-orange-400', MACHINE: 'text-green-400',
};

/**
 * Compact chip showing the active analysis scope (Whole factory / Area / Line /
 * Machine) — surfaces what the page is filtered to right in the toolbar, with a
 * one-click clear. Reads the same global scope store as the ScopePanel + useScope.
 */
export function ScopeBadge({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const scope = useScopeStore((s) => s.scope);
  const setScope = useScopeStore((s) => s.setScope);

  const isFactory = !scope || scope.type === 'FACTORY';
  const Icon = isFactory ? Factory : (TYPE_ICON[scope!.type] ?? Cpu);
  const color = isFactory ? 'text-blue-400' : (TYPE_COLOR[scope!.type] ?? 'text-foreground');

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 h-8 rounded-md border border-border/60 bg-card/60 px-2 text-xs',
        className,
      )}
      title={t('scope.title')}
    >
      <Icon size={13} className={cn('shrink-0', color)} />
      <span className="font-medium text-foreground max-w-[180px] truncate">
        {isFactory ? t('scope.wholeFactory') : scope!.name}
      </span>
      {!isFactory && (
        <>
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{scope!.type}</span>
          <button
            onClick={() => setScope(null)}
            title={t('scope.wholeFactory')}
            className="ms-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
}
