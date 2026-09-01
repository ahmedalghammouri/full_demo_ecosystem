'use client';

/**
 * MasterDataSelect — dropdown backed by a managed lookup table
 * (product categories, brands, packaging types, base units, base weights)
 * with an inline manager dialog to add / rename / delete values.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, Plus, Pencil, Trash2, Check, X } from 'lucide-react';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectMenu } from '@/components/ui/select-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

export type MasterEntity = 'categories' | 'brands' | 'packaging-types' | 'base-units' | 'base-weights';

export interface MasterItem {
  id: string;
  name?: string;
  nameAr?: string | null;
  code?: string;
  value?: number;
  unit?: string;
  label?: string | null;
  isActive: boolean;
}

export interface ProductMasterData {
  categories: MasterItem[];
  brands: MasterItem[];
  packagingTypes: MasterItem[];
  baseUnits: MasterItem[];
  baseWeights: MasterItem[];
}

const ENTITY_KEY: Record<MasterEntity, keyof ProductMasterData> = {
  'categories': 'categories',
  'brands': 'brands',
  'packaging-types': 'packagingTypes',
  'base-units': 'baseUnits',
  'base-weights': 'baseWeights',
};

export function useProductMasterData() {
  return useQuery({
    queryKey: ['inventory', 'master'],
    queryFn: () => api.get<ProductMasterData>('/inventory/master'),
    staleTime: 60_000,
  });
}

export function masterItemLabel(entity: MasterEntity, it: MasterItem): string {
  if (entity === 'base-weights') return it.label ?? `${it.value} ${it.unit ?? 'kg'}`;
  if (entity === 'base-units') return it.code ?? it.name ?? '';
  return it.name ?? '';
}

interface MasterDataSelectProps {
  entity: MasterEntity;
  label: string;
  value: string | null | undefined;        // selected item id
  onChange: (id: string | null, item: MasterItem | null) => void;
  placeholder?: string;
  required?: boolean;
}

export function MasterDataSelect({ entity, label, value, onChange, placeholder, required }: MasterDataSelectProps) {
  const { data } = useProductMasterData();
  const [manageOpen, setManageOpen] = useState(false);
  const items = (data?.[ENTITY_KEY[entity]] ?? []).filter((i) => i.isActive || i.id === value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}{required && ' *'}</label>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          title={`Manage ${label.toLowerCase()}`}
        >
          <Settings2 size={13} />
        </button>
      </div>
      <SelectMenu
        size="md"
        fullWidth
        value={value ?? ''}
        onValueChange={(id) => onChange(id || null, items.find((i) => i.id === id) ?? null)}
        placeholder={placeholder ?? `Select ${label.toLowerCase()}…`}
        options={[
          { value: '', label: placeholder ?? `Select ${label.toLowerCase()}…` },
          ...items.map((it) => ({ value: it.id, label: masterItemLabel(entity, it) })),
        ]}
      />

      <MasterDataManager entity={entity} label={label} open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}

// ── Manager dialog (add / rename / delete) ───────────────────────────────────

function MasterDataManager({ entity, label, open, onOpenChange }: {
  entity: MasterEntity; label: string; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('common');
  const qc = useQueryClient();
  const { data } = useProductMasterData();
  const items = data?.[ENTITY_KEY[entity]] ?? [];
  const [newValue, setNewValue] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory', 'master'] });
  const errMsg = (e: unknown) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Operation failed';

  const buildPayload = (raw: string) => {
    const v = raw.trim();
    if (entity === 'base-weights') {
      const num = parseFloat(v);
      if (!Number.isFinite(num) || num <= 0) throw new Error('Enter a numeric weight, e.g. 2.25');
      return { value: num, unit: 'kg', name: `${num} Kg` };
    }
    if (entity === 'base-units') return { code: v.toUpperCase(), name: v.toUpperCase() };
    return { name: v };
  };

  const createMut = useMutation({
    mutationFn: (raw: string) => api.post<MasterItem>(`/inventory/master/${entity}`, buildPayload(raw)),
    onSuccess: () => { invalidate(); setNewValue(''); toast({ title: `${label} added` }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, raw }: { id: string; raw: string }) =>
      api.patch<MasterItem>(`/inventory/master/${entity}/${id}`, buildPayload(raw)),
    onSuccess: () => { invalidate(); setEditId(null); toast({ title: `${label} updated` }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted?: boolean; disabled?: boolean; usedBy?: number }>(`/inventory/master/${entity}/${id}`),
    onSuccess: (res) => {
      invalidate();
      toast(res?.disabled
        ? { title: `${label} disabled`, description: `In use by ${res.usedBy} product(s) — hidden from new selections.` }
        : { title: `${label} deleted` });
    },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });

  const inputPlaceholder = entity === 'base-weights' ? 'e.g. 2.25' : entity === 'base-units' ? 'e.g. PCS' : `New ${label.toLowerCase()}…`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t('picker.manage', { label })}</DialogTitle>
        </DialogHeader>

        {/* Add new */}
        <div className="flex gap-2">
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={inputPlaceholder}
            className="h-9"
            onKeyDown={(e) => { if (e.key === 'Enter' && newValue.trim()) createMut.mutate(newValue); }}
          />
          <Button size="sm" className="h-9" disabled={!newValue.trim() || createMut.isPending} onClick={() => createMut.mutate(newValue)}>
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto space-y-1 -mx-1 px-1">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">{t('picker.noneDefined', { label: label.toLowerCase() })}</p>
          )}
          {items.map((it) => (
            <div key={it.id} className={`flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 ${!it.isActive ? 'opacity-50' : ''}`}>
              {editId === it.id ? (
                <>
                  <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-7 text-sm flex-1"
                    onKeyDown={(e) => { if (e.key === 'Enter' && editValue.trim()) updateMut.mutate({ id: it.id, raw: editValue }); }}
                    autoFocus />
                  <button className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded" onClick={() => editValue.trim() && updateMut.mutate({ id: it.id, raw: editValue })}>
                    <Check size={14} />
                  </button>
                  <button className="p-1 text-muted-foreground hover:bg-muted rounded" onClick={() => setEditId(null)}>
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{masterItemLabel(entity, it)}{!it.isActive && ' (disabled)'}</span>
                  <button className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                    onClick={() => { setEditId(it.id); setEditValue(entity === 'base-weights' ? String(it.value ?? '') : masterItemLabel(entity, it)); }}>
                    <Pencil size={13} />
                  </button>
                  <button className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded"
                    onClick={() => deleteMut.mutate(it.id)}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
