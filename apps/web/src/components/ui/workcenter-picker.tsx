'use client';

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Factory, LayoutGrid, GitBranch, Cpu, X, Search } from 'lucide-react';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

export interface WorkCenterNode {
  id: string;
  code: string;
  name: string;
  level: 'PLANT' | 'AREA' | 'LINE' | 'CELL';
  parentId: string | null;
  children: WorkCenterNode[];
  _count?: { routingSteps: number };
}

const LEVEL_ICON: Record<string, React.ElementType> = {
  PLANT: Factory,
  AREA: LayoutGrid,
  LINE: GitBranch,
  CELL: Cpu,
};

const LEVEL_COLOR: Record<string, string> = {
  PLANT: 'text-blue-500',
  AREA: 'text-violet-500',
  LINE: 'text-orange-500',
  CELL: 'text-green-500',
};

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: WorkCenterNode;
  depth: number;
  selectedId: string | null;
  onSelect: (node: WorkCenterNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const Icon = LEVEL_ICON[node.level] ?? Cpu;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-sm transition-colors select-none',
          selectedId === node.id
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-muted',
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            className="shrink-0 p-0.5 rounded hover:bg-black/10"
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Icon size={13} className={cn('shrink-0', selectedId === node.id ? 'text-primary-foreground' : LEVEL_COLOR[node.level])} />
        <span className="font-medium truncate">{node.name}</span>
        <span className={cn('text-[10px] ml-auto shrink-0', selectedId === node.id ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {node.code}
        </span>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface WorkCenterPickerProps {
  value: string | null;
  onChange: (id: string | null, node: WorkCenterNode | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function WorkCenterPicker({
  value,
  onChange,
  placeholder = 'Select work center...',
  className,
  disabled,
}: WorkCenterPickerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: tree = [] } = useQuery<WorkCenterNode[]>({
    queryKey: ['workcenter-tree'],
    queryFn: () => api.get('/hierarchy/workcenters/tree') as any,
    staleTime: 60_000,
  });

  // Flat list for search
  const flat = useMemo(() => {
    const acc: WorkCenterNode[] = [];
    (function flatten(nodes: WorkCenterNode[]) {
      for (const n of nodes) { acc.push(n); flatten(n.children); }
    })(tree);
    return acc;
  }, [tree]);

  const selected = flat.find(n => n.id === value) ?? null;
  const filtered = search
    ? flat.filter(n =>
        n.name.toLowerCase().includes(search.toLowerCase()) ||
        n.code.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  const handleSelect = (node: WorkCenterNode) => {
    onChange(node.id, node);
    setOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null, null);
  };

  const Icon = selected ? (LEVEL_ICON[selected.level] ?? Cpu) : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'w-full h-8 px-2.5 flex items-center gap-2 rounded-md border border-input bg-background text-sm text-left transition-colors',
            'hover:border-primary/50 focus:outline-none focus:ring-1 focus:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'data-[state=open]:ring-1 data-[state=open]:ring-ring data-[state=open]:border-primary/50',
            className,
          )}
        >
          {Icon && <Icon size={13} className={LEVEL_COLOR[selected!.level]} />}
          <span className={cn('flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected ? `${selected.name} (${selected.code})` : placeholder}
          </span>
          {selected && !disabled && (
            <span role="button" tabIndex={-1} onClick={handleClear} className="p-0.5 rounded hover:bg-muted">
              <X size={11} />
            </span>
          )}
          <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-[100] w-[var(--radix-popover-trigger-width)] min-w-[240px] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="p-2 border-b border-border/60">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('picker.searchWorkCenters')}
                className="w-full h-7 pl-6 pr-2 text-xs rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="p-1 max-h-72 overflow-y-auto">
            {filtered ? (
              filtered.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">{t('picker.noResults')}</div>
              ) : (
                filtered.map(node => {
                  const NIcon = LEVEL_ICON[node.level] ?? Cpu;
                  return (
                    <div
                      key={node.id}
                      onClick={() => handleSelect(node)}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer text-sm hover:bg-muted',
                        value === node.id && 'bg-primary text-primary-foreground',
                      )}
                    >
                      <NIcon size={12} className={value === node.id ? 'text-primary-foreground' : LEVEL_COLOR[node.level]} />
                      <span className="flex-1 truncate font-medium">{node.name}</span>
                      <span className="text-[10px] text-muted-foreground">{node.level}</span>
                    </div>
                  );
                })
              )
            ) : (
              tree.map(root => (
                <TreeNode
                  key={root.id}
                  node={root}
                  depth={0}
                  selectedId={value}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
