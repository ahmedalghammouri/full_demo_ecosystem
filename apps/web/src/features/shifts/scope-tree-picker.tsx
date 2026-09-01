'use client';

import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Search, Factory, Layers, Activity, Cpu, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api } from '@/services/api.client';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type NodeType = 'FACTORY' | 'AREA' | 'PRODUCTION_LINE' | 'MACHINE';

interface TreeNode {
  id: string;
  type: NodeType;
  code: string;
  name: string;
  children?: TreeNode[];
}

export type ScopeType = 'AREA' | 'LINE' | 'MACHINE';
export interface ScopeSelection {
  id: string;
  type: ScopeType;
  name: string;
  code: string;
}

const ICONS: Record<NodeType, React.ElementType> = {
  FACTORY: Factory, AREA: Layers, PRODUCTION_LINE: Activity, MACHINE: Cpu,
};
const COLORS: Record<NodeType, string> = {
  FACTORY: 'text-blue-400', AREA: 'text-purple-400', PRODUCTION_LINE: 'text-brand-400', MACHINE: 'text-green-400',
};
const TYPE_MAP: Partial<Record<NodeType, ScopeType>> = {
  AREA: 'AREA', PRODUCTION_LINE: 'LINE', MACHINE: 'MACHINE',
};

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  return nodes.reduce<TreeNode[]>((acc, node) => {
    const kids = node.children ? filterTree(node.children, q) : [];
    if (node.name.toLowerCase().includes(q) || node.code.toLowerCase().includes(q) || kids.length > 0) {
      acc.push({ ...node, children: kids });
    }
    return acc;
  }, []);
}

function Row({ node, depth, selectedId, expanded, onToggle, onPick, searchActive }: {
  node: TreeNode; depth: number; selectedId?: string;
  expanded: Set<string>; onToggle: (id: string) => void;
  onPick: (n: TreeNode) => void; searchActive: boolean;
}) {
  const isOpen = searchActive || expanded.has(node.id);
  const hasKids = (node.children?.length ?? 0) > 0;
  const selectable = node.type in TYPE_MAP;
  const isSel = selectedId === node.id;
  const Icon = ICONS[node.type];

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors',
          selectable ? 'cursor-pointer hover:bg-muted/60' : 'cursor-default hover:bg-muted/30',
          isSel && 'bg-primary/10 ring-1 ring-primary/30',
        )}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        onClick={() => { if (selectable) onPick(node); else if (hasKids) onToggle(node.id); }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(node.id); }}
          className={cn('w-4 h-4 shrink-0 flex items-center justify-center', !hasKids && 'opacity-0 pointer-events-none')}
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Icon size={13} className={cn('shrink-0', COLORS[node.type])} />
        <div className="flex-1 min-w-0">
          <div className={cn('text-xs font-medium truncate', !selectable && 'text-muted-foreground')}>{node.name}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{node.code}</div>
        </div>
        {selectable && <span className="text-[9px] uppercase text-muted-foreground/60 font-mono">{TYPE_MAP[node.type]}</span>}
        {isSel && <Check size={13} className="shrink-0 text-primary" />}
      </div>
      {isOpen && hasKids && node.children?.map((c) => (
        <Row key={c.id} node={c} depth={depth + 1} selectedId={selectedId}
          expanded={expanded} onToggle={onToggle} onPick={onPick} searchActive={searchActive} />
      ))}
    </>
  );
}

export function ScopeTreePicker({ value, onSelect }: {
  value?: ScopeSelection | null;
  onSelect: (sel: ScopeSelection) => void;
}) {
  const { t } = useTranslation('production');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: treeData, isLoading } = useQuery({
    queryKey: ['hierarchy', 'tree'],
    queryFn: () => api.get<TreeNode[]>('/hierarchy/tree'),
    staleTime: 60_000,
  });

  const tree: TreeNode[] = Array.isArray(treeData) ? treeData : [];
  const q = search.toLowerCase().trim();
  const display = useMemo(() => (q ? filterTree(tree, q) : tree), [tree, q]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const pick = (n: TreeNode) => {
    const type = TYPE_MAP[n.type];
    if (!type) return;
    onSelect({ id: n.id, type, name: n.name, code: n.code });
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="relative border-b border-border/60 p-2">
        <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('scopePicker.search')} className="h-8 pl-8 text-xs" />
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {isLoading ? (
          <div className="space-y-1.5 p-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-7 rounded" />)}</div>
        ) : display.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">{t('scopePicker.noHierarchy')}</div>
        ) : (
          display.map((root) => (
            <Row key={root.id} node={root} depth={0} selectedId={value?.id}
              expanded={expanded} onToggle={toggle} onPick={pick} searchActive={!!q} />
          ))
        )}
      </div>
      <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
        {t('scopePicker.hintPre')}<span className="text-purple-400">{t('scopePicker.hintArea')}</span>{t('scopePicker.hintAreaParen')}<span className="text-brand-400">{t('scopePicker.hintLine')}</span>{t('scopePicker.hintLineParen')}<span className="text-green-400">{t('scopePicker.hintMachine')}</span>{t('scopePicker.hintPost')}
      </div>
    </div>
  );
}
