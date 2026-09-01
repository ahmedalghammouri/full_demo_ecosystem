'use client';

/**
 * Shared smart filter bar (Machines multi-select · Production Order · Work Order)
 * used by both the Shop Floor grid and the Live Dashboard. Controlled component —
 * the parent owns the state and the option lists (derived from live job data).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Cpu, ChevronDown, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { SelectMenu } from '@/components/ui/select-menu';

export interface MachineOption { id: string; name: string; code: string; count?: number }
export interface Opt { value: string; label: string }

export function JobFilterBar({
  machines, pos, wos,
  machineSel, onMachineSel,
  po, onPo, wo, onWo,
  right,
}: {
  machines: MachineOption[];
  pos: Opt[];
  wos: Opt[];
  machineSel: string[];
  onMachineSel: (ids: string[]) => void;
  po: string;
  onPo: (v: string) => void;
  wo: string;
  onWo: (v: string) => void;
  right?: React.ReactNode;
}) {
  const { t } = useTranslation('production');
  const hasFilters = machineSel.length > 0 || !!po || !!wo;

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground pr-1">
        <Filter className="w-3.5 h-3.5 text-brand-400" />{t('jfb.filters')}
      </span>
      <span className="h-5 w-px bg-border/60" />

      {/* Machine multi-select */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{t('sf.machines')}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={`h-8 text-xs ${machineSel.length ? 'border-brand-400/60 text-brand-400 bg-brand-500/5' : ''}`}>
              <Cpu className="w-3.5 h-3.5 mr-1.5" />
              {machineSel.length === 0
                ? t('jfb.all')
                : machineSel.length === 1
                ? machines.find((m) => m.id === machineSel[0])?.code ?? '1'
                : t('jfb.selectedCount', { count: machineSel.length })}
              <ChevronDown className="w-3 h-3 ml-1.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="text-xs p-0">
                {t('jfb.filterByMachine')}
                <span className="ml-1.5 text-muted-foreground/60 font-normal">({machines.length})</span>
              </DropdownMenuLabel>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  className="text-brand-400 hover:underline disabled:opacity-40"
                  disabled={machineSel.length === machines.length}
                  onClick={(e) => { e.preventDefault(); onMachineSel(machines.map((m) => m.id)); }}
                >
                  {t('jfb.all')}
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  disabled={machineSel.length === 0}
                  onClick={(e) => { e.preventDefault(); onMachineSel([]); }}
                >
                  {t('jfb.clear')}
                </button>
              </div>
            </div>
            <DropdownMenuSeparator />
            {machines.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">{t('sf.noMachines')}</div>
            )}
            <div className="max-h-72 overflow-y-auto">
              {machines.map((m) => (
                <DropdownMenuCheckboxItem
                  key={m.id}
                  checked={machineSel.includes(m.id)}
                  onCheckedChange={(checked) =>
                    onMachineSel(checked ? [...machineSel, m.id] : machineSel.filter((id) => id !== m.id))
                  }
                  onSelect={(e) => e.preventDefault()}
                  className="gap-2"
                >
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{m.code}</span>
                  <span className="flex-1 truncate">{m.name}</span>
                  {m.count != null && <span className="text-[10px] text-muted-foreground/60 tabular-nums">{m.count}</span>}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Production order */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">PO</span>
        <SelectMenu
          value={po}
          onValueChange={(v) => { onPo(v); onWo(''); }}
          options={[{ value: '', label: t('sf.allPos') }, ...pos]}
          placeholder={t('sf.allPos')}
          size="sm"
        />
      </div>

      {/* Work order */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">WO</span>
        <SelectMenu
          value={wo}
          onValueChange={onWo}
          options={[{ value: '', label: t('sf.allWos') }, ...wos]}
          placeholder={t('sf.allWos')}
          size="sm"
        />
      </div>

      {hasFilters && (
        <button
          onClick={() => { onMachineSel([]); onPo(''); onWo(''); }}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-400 hover:bg-red-500/10 border border-red-400/30"
        >
          <X className="w-3 h-3" />{t('jfb.clearAll')}
        </button>
      )}

      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}
