'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, MapPin, Package, X, Edit2, Trash2,
  Warehouse, FlaskConical, Settings, Truck, Layers,
  Eye, AlertTriangle, Boxes, Calendar, DollarSign,
  Hash, Archive, CheckCircle2, QrCode, Printer,
  ToggleLeft, ToggleRight, Info, RefreshCw,
  ChevronRight, MoreHorizontal, SlidersHorizontal, Plus as PlusIcon, Minus, Equal,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const ZONES = [
  { value: 'RAW_MATERIAL',   label: 'Raw Material Warehouse', short: 'Raw Material', icon: Package,     color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',     bar: 'bg-blue-400'   },
  { value: 'SPARE_PARTS',    label: 'Spare Parts Room',       short: 'Spare Parts',  icon: Settings,    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20',   bar: 'bg-amber-400'  },
  { value: 'FINISHED_GOODS', label: 'Finished Goods',         short: 'Finished',     icon: Warehouse,   color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20',   bar: 'bg-green-400'  },
  { value: 'QUARANTINE',     label: 'Quarantine / QC Hold',   short: 'Quarantine',   icon: FlaskConical,color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',       bar: 'bg-red-400'    },
  { value: 'PRODUCTION',     label: 'Production Floor',       short: 'Production',   icon: Layers,      color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', bar: 'bg-purple-400' },
  { value: 'DISPATCH',       label: 'Dispatch / Shipping',    short: 'Dispatch',     icon: Truck,       color: 'text-cyan-400',   bg: 'bg-cyan-500/10 border-cyan-500/20',     bar: 'bg-cyan-400'   },
];

const LOT_STATUS_CFG: Record<string, { labelKey: string; cls: string }> = {
  ACTIVE:     { labelKey: 'storageView.lotStatus.ACTIVE',     cls: 'bg-green-500/10 text-green-400 border-green-500/20' },
  EXPIRED:    { labelKey: 'storageView.lotStatus.EXPIRED',    cls: 'bg-red-500/10 text-red-400 border-red-500/20'       },
  QUARANTINE: { labelKey: 'storageView.lotStatus.QUARANTINE', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  CONSUMED:   { labelKey: 'storageView.lotStatus.CONSUMED',   cls: 'bg-muted text-muted-foreground'                     },
};

type Tab = 'summary' | 'raw' | 'lots' | 'parts' | 'skus' | 'fg';

/** Target descriptor for the unified stock-adjustment modal. */
interface AdjustTarget {
  entityType: 'RAW_MATERIAL' | 'SPARE_PART' | 'PRODUCT' | 'MATERIAL_LOT' | 'FINISHED_GOODS_LOT';
  entityId: string;
  code: string;
  name: string;
  current: number;
  unit?: string;
}

/* ------------------------------------------------------------------ */
/*  Interfaces                                                          */
/* ------------------------------------------------------------------ */

interface StorageLocation {
  id: string; code: string; name: string; zone: string;
  description?: string; capacity?: number; isActive: boolean;
  rawMaterialCount: number; materialLotCount: number; sparePartCount: number;
  totalItems: number; createdAt: string;
}

interface LocationContents {
  id: string; code: string; name: string; zone: string;
  description?: string; capacity?: number; isActive: boolean;
  stockValue: number;
  rawMaterials: {
    id: string; code: string; name: string; category?: string; unit: string;
    stockQty: number; minStockQty: number; unitCost?: number; isLowStock: boolean; stockValue: number;
  }[];
  materialLots: {
    id: string; lotNumber: string; materialCode: string; materialName: string;
    quantity: number; remainingQty?: number; unit: string; status: string;
    receivedAt: string; expiryDate?: string; binNumber?: string;
    rawMaterial?: { code: string; name: string; category?: string };
  }[];
  spareParts: {
    id: string; partNumber: string; name: string; category?: string;
    stockQty: number; minStockQty: number; unitCost?: number; binNumber?: string;
    isLowStock: boolean; stockValue: number;
  }[];
  skus: { id: string; code: string; name: string; itemNumber?: string; category?: string; currentStock?: number; baseUnit?: string }[];
  finishedGoodsLots?: {
    id: string; lotNumber: string; quantity: number; remainingQty: number; unit: string;
    producedQty?: number; producedUnit?: string; producedAt?: string; expiryDate?: string;
    sku?: { code: string; name: string; itemNumber?: string };
    workOrder?: { orderNumber: string };
  }[];
}

/* ------------------------------------------------------------------ */
/*  Main view                                                           */
/* ------------------------------------------------------------------ */

const EMPTY_FORM = { code: '', name: '', zone: '', description: '', capacity: '' };

export function StorageLocationsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editLocation, setEditLocation] = useState<StorageLocation | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<StorageLocation | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['storage-locations', zoneFilter, search],
    queryFn: () => api.get(`/inventory/storage-locations?zone=${zoneFilter}&search=${search}&limit=200`),
  });

  const locations: StorageLocation[] = (data as any)?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/inventory/storage-locations', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-locations'] });
      setFormOpen(false); setForm({ ...EMPTY_FORM });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) =>
      api.patch(`/inventory/storage-locations/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-locations'] });
      setEditLocation(null); setDeactivateTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/storage-locations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-locations'] }),
  });

  const handleSave = () => {
    if (!form.code || !form.name || !form.zone) return;
    const dto = {
      code: form.code.toUpperCase(), name: form.name, zone: form.zone,
      description: form.description || undefined,
      capacity: form.capacity ? parseFloat(form.capacity) : undefined,
    };
    if (editLocation) {
      updateMutation.mutate({ id: editLocation.id, dto });
    } else {
      createMutation.mutate(dto);
    }
  };

  const openEdit = (loc: StorageLocation) => {
    setEditLocation(loc);
    setForm({ code: loc.code, name: loc.name, zone: loc.zone, description: loc.description ?? '', capacity: loc.capacity?.toString() ?? '' });
    setFormOpen(true);
  };

  const groupedByZone = ZONES.map(zone => ({
    ...zone,
    locations: locations.filter(l => l.zone === zone.value),
  })).filter(z => !zoneFilter || z.value === zoneFilter);

  const totalItems = locations.reduce((s, l) => s + l.totalItems, 0);
  const activeCount = locations.filter(l => l.isActive).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{t('headers.storage.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('headers.storage.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw size={13} className="mr-1.5" /> {t('storageView.refresh')}
          </Button>
          <Button size="sm" onClick={() => { setEditLocation(null); setForm({ ...EMPTY_FORM }); setFormOpen(true); }}>
            <Plus size={14} className="mr-1.5" /> {t('storageView.newLocation')}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <KPIChip label={t('storageView.kpi.totalLocations')} value={locations.length} icon={MapPin} />
        <KPIChip label={t('storageView.kpi.active')} value={activeCount} icon={CheckCircle2} valueClass="text-green-400" />
        <KPIChip label={t('storage.itemsTracked')} value={totalItems} icon={Boxes} />
        {ZONES.map(z => {
          const c = locations.filter(l => l.zone === z.value).length;
          if (!c) return null;
          return <KPIChip key={z.value} label={t(`storage.zonesShort.${z.value}`, { defaultValue: z.short })} value={c} icon={z.icon} valueClass={z.color} />;
        })}
      </div>

      <InlineFormSlot />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t('storage.search')} value={search} onChange={e => setSearch(e.target.value)} className="ps-8 h-8 text-sm" />
        </div>
        <Select value={zoneFilter || '_all'} onValueChange={v => setZoneFilter(v === '_all' ? '' : v)}>
          <SelectTrigger className="h-8 w-52 text-sm">
            <SelectValue placeholder={t('storage.allZones')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">{t('storage.allZones')}</SelectItem>
            {ZONES.map(z => <SelectItem key={z.value} value={z.value}>{t(`storage.zones.${z.value}`, { defaultValue: z.label })}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Location grid */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground p-10 text-center">{t('storage.loading')}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {groupedByZone.map(zone =>
            zone.locations.length > 0 && (
              <section key={zone.value}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn('w-6 h-6 rounded flex items-center justify-center border', zone.bg)}>
                    <zone.icon size={12} className={zone.color} />
                  </div>
                  <span className="text-sm font-semibold">{t(`storage.zones.${zone.value}`, { defaultValue: zone.label })}</span>
                  <Badge variant="secondary" className="text-xs">{zone.locations.length}</Badge>
                  <span className="text-xs text-muted-foreground ms-1">
                    {zone.locations.reduce((s, l) => s + l.totalItems, 0)} {t('storage.itemsStored')}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {zone.locations.map(loc => (
                    <LocationCard
                      key={loc.id}
                      location={loc}
                      zone={zone}
                      onView={() => setSelectedId(loc.id)}
                      onEdit={() => openEdit(loc)}
                      onDeactivate={() => setDeactivateTarget(loc)}
                      onDelete={() => deleteMutation.mutate(loc.id)}
                    />
                  ))}
                </div>
              </section>
            )
          )}
          {groupedByZone.every(z => z.locations.length === 0) && (
            <div className="border rounded-xl p-16 text-center text-sm text-muted-foreground">
              <MapPin size={36} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium mb-1">{t('storage.noLocations')}</p>
              <p>{t('storageView.createFirst')}</p>
            </div>
          )}
        </div>
      )}

      {/* Contents drawer */}
      <LocationContentsSheet
        locationId={selectedId}
        onClose={() => setSelectedId(null)}
        onEdit={(loc) => { openEdit(loc); setSelectedId(null); }}
      />

      {/* Create / Edit — inline form */}
      <InlineFormPanel
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditLocation(null); }}
        icon={MapPin}
        title={editLocation ? t('sform.editTitle') : t('sform.createTitle')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => { setFormOpen(false); setEditLocation(null); }}>{t('sform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!form.code || !form.name || !form.zone || createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {createMutation.isPending || updateMutation.isPending ? t('sform.saving') : editLocation ? t('sform.saveChanges') : t('sform.createLocation')}
            </Button>
          </>
        )}
      >
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('sform.locationCode')} *</Label>
                    <Input
                      value={form.code}
                      onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                      placeholder={t('storageView.codePlaceholder')}
                      className="h-8 text-sm font-mono"
                      disabled={!!editLocation}
                    />
                    <span className="text-xs text-muted-foreground">{t('sform.codeHint')}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('sform.zone')} *</Label>
                    <Select value={form.zone} onValueChange={v => setForm(p => ({ ...p, zone: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t('sform.selectZone')} /></SelectTrigger>
                      <SelectContent>
                        {ZONES.map(z => <SelectItem key={z.value} value={z.value}>{t(`storage.zones.${z.value}`, { defaultValue: z.label })}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('sform.name')} *</Label>
                  <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t('sform.namePlaceholder')} className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('sform.description')}</Label>
                  <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder={t('sform.descPlaceholder')} className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('sform.capacity')}</Label>
                  <Input type="number" min="0" value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} placeholder={t('sform.capacityPlaceholder')} className="h-8 text-sm" />
                </div>
              </div>
      </InlineFormPanel>

      {/* Deactivate confirm */}
      <AnimatePresence>
        {deactivateTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border rounded-xl shadow-2xl w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <ToggleLeft size={16} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{t('sform.deactivateTitle')}</h3>
                  <p className="text-xs text-muted-foreground">{deactivateTarget.code} — {deactivateTarget.name}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-5">
                {t('sform.deactivateMsg')}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeactivateTarget(null)}>{t('sform.cancel')}</Button>
                <Button
                  size="sm" variant="destructive"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: deactivateTarget.id, dto: { isActive: false } })}
                >
                  {updateMutation.isPending ? t('sform.deactivating') : t('sform.deactivate')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Chip                                                            */
/* ------------------------------------------------------------------ */

function KPIChip({ label, value, icon: Icon, valueClass }: { label: string; value: number; icon: React.ElementType; valueClass?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border text-sm">
      <Icon size={13} className="text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className={cn('font-bold leading-none', valueClass ?? 'text-foreground')}>{value}</div>
        <div className="text-[10px] text-muted-foreground truncate mt-0.5">{label}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Location Card                                                       */
/* ------------------------------------------------------------------ */

function LocationCard({ location, zone, onView, onEdit, onDeactivate, onDelete }: {
  location: StorageLocation;
  zone: typeof ZONES[number];
  onView: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(['inventory', 'common']);
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = zone.icon;
  const usage = location.capacity && location.capacity > 0
    ? Math.min(100, (location.totalItems / location.capacity) * 100)
    : null;

  const chips = [
    location.rawMaterialCount > 0 && { label: t('storageView.chipRm', { count: location.rawMaterialCount }), cls: 'text-blue-400' },
    location.materialLotCount > 0 && { label: t('storageView.chipLots', { count: location.materialLotCount }), cls: 'text-violet-400' },
    location.sparePartCount > 0  && { label: t('storageView.chipParts', { count: location.sparePartCount }), cls: 'text-amber-400' },
  ].filter(Boolean) as { label: string; cls: string }[];

  return (
    <div
      className={cn(
        'relative border rounded-xl p-4 bg-card transition-all cursor-pointer group',
        'hover:shadow-md hover:border-foreground/20',
        !location.isActive && 'opacity-50',
      )}
      onClick={onView}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center border shrink-0', zone.bg)}>
            <Icon size={14} className={zone.color} />
          </div>
          <div>
            <div className="font-mono text-sm font-bold leading-tight">{location.code}</div>
            <div className="text-xs text-muted-foreground truncate max-w-[130px]">{location.name}</div>
          </div>
        </div>

        {/* Actions menu */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <Button
            variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => setMenuOpen(o => !o)}
          >
            <MoreHorizontal size={12} />
          </Button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-7 z-20 bg-background border rounded-lg shadow-xl w-44 py-1 text-sm"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left" onClick={() => { onView(); setMenuOpen(false); }}>
                  <Eye size={12} /> {t('storageView.menu.viewContents')}
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left" onClick={() => { onEdit(); setMenuOpen(false); }}>
                  <Edit2 size={12} /> {t('storageView.menu.editLocation')}
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left text-muted-foreground" onClick={() => { setMenuOpen(false); window.print?.(); }}>
                  <Printer size={12} /> {t('storageView.menu.printQr')}
                </button>
                <div className="border-t my-1" />
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left text-amber-400" onClick={() => { onDeactivate(); setMenuOpen(false); }}>
                  <ToggleLeft size={12} /> {t('storageView.menu.deactivate')}
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left text-destructive" onClick={() => { onDelete(); setMenuOpen(false); }}>
                  <Trash2 size={12} /> {t('storageView.menu.delete')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Item chips */}
      <div className="flex items-center gap-1.5 flex-wrap min-h-[20px] mb-2">
        {chips.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">{t('storageView.empty')}</span>
        ) : chips.map(c => (
          <span key={c.label} className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/60 border', c.cls)}>{c.label}</span>
        ))}
      </div>

      {/* Capacity bar */}
      {usage !== null ? (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>{t('storageView.capacityItems', { current: location.totalItems, capacity: location.capacity })}</span>
            <span className={cn(usage > 80 ? 'text-red-400' : usage > 60 ? 'text-amber-400' : 'text-green-400')}>
              {usage.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', usage > 80 ? 'bg-red-400' : usage > 60 ? 'bg-amber-400' : zone.bar)}
              style={{ width: `${usage}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground mt-1">
          {location.totalItems > 0 ? t('storageView.itemsCount', { count: location.totalItems }) : t('storageView.noCapacity')}
        </div>
      )}

      {/* View link */}
      <div className="flex items-center gap-1 mt-3 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
        <Eye size={10} />
        <span>{t('storageView.clickToView')}</span>
        <ChevronRight size={10} className="ml-auto" />
      </div>

      {!location.isActive && (
        <div className="absolute inset-0 rounded-xl flex items-center justify-center pointer-events-none">
          <span className="bg-background/80 px-2 py-0.5 rounded text-xs text-muted-foreground border">{t('storage.inactive')}</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Location Contents Sheet                                             */
/* ------------------------------------------------------------------ */

function LocationContentsSheet({ locationId, onClose, onEdit }: {
  locationId: string | null;
  onClose: () => void;
  onEdit: (loc: any) => void;
}) {
  const { t, i18n } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('summary');
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['location-contents', locationId],
    queryFn: () => api.get(`/inventory/storage-locations/${locationId}/contents`),
    enabled: !!locationId,
    staleTime: 15_000,
  });

  const adjustMutation = useMutation({
    mutationFn: (dto: { entityType: string; entityId: string; mode: string; quantity: number; reason?: string }) =>
      api.post('/inventory/adjust', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-contents', locationId] });
      queryClient.invalidateQueries({ queryKey: ['storage-locations'] });
      // Refresh any open inventory lists so on-hand stays consistent everywhere.
      queryClient.invalidateQueries({ queryKey: ['raw-materials'] });
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      setAdjustTarget(null);
    },
  });

  const contents = data as LocationContents | undefined;
  const zone = ZONES.find(z => z.value === contents?.zone) ?? ZONES[0];
  const fgLots = contents?.finishedGoodsLots ?? [];

  const tabs: { id: Tab; label: string; count: number; icon: React.ElementType }[] = [
    { id: 'summary', label: t('storage.tab.summary'), count: 0,                                icon: Info          },
    { id: 'raw',     label: t('storage.tab.raw'),     count: contents?.rawMaterials.length ?? 0, icon: Package       },
    { id: 'lots',    label: t('storage.tab.lots'),    count: contents?.materialLots.length ?? 0, icon: Archive       },
    { id: 'parts',   label: t('storage.tab.parts'),   count: contents?.spareParts.length ?? 0,   icon: Settings      },
    { id: 'skus',    label: t('storage.tab.skus'),    count: contents?.skus.length ?? 0,         icon: QrCode        },
    { id: 'fg',      label: t('storage.tab.fg', { defaultValue: 'Finished Goods' }), count: fgLots.length, icon: Warehouse },
  ];

  return (
    <Sheet open={!!locationId} onOpenChange={open => { if (!open) { onClose(); setTab('summary'); } }}>
      <SheetContent side={i18n.dir() === 'rtl' ? 'left' : 'right'} className="w-full sm:max-w-2xl p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="p-5 border-b shrink-0">
          {isLoading || !contents ? (
            <SheetTitle className="text-sm">{t('storage.loadingShort')}</SheetTitle>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center border', zone.bg)}>
                  <zone.icon size={18} className={zone.color} />
                </div>
                <div>
                  <SheetTitle className="text-base font-bold font-mono">{contents.code}</SheetTitle>
                  <p className="text-sm text-muted-foreground">{contents.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className={cn('text-[10px]', zone.bg, zone.color, 'border')}>{t(`storage.zonesShort.${zone.value}`, { defaultValue: zone.short })}</Badge>
                    {!contents.isActive && <Badge variant="secondary" className="text-[10px]">{t('storage.inactive')}</Badge>}
                    {contents.description && (
                      <span className="text-[10px] text-muted-foreground">{contents.description}</span>
                    )}
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => onEdit(contents)}>
                <Edit2 size={12} className="mr-1.5" /> {t('storageView.edit')}
              </Button>
            </div>
          )}
        </SheetHeader>

        {/* KPI bar */}
        {contents && (
          <div className="grid grid-cols-4 gap-px bg-border border-b shrink-0">
            {[
              { label: t('storageView.sheetKpi.totalItems'), value: (contents.rawMaterials.length + contents.materialLots.length + contents.spareParts.length + contents.skus.length).toString() },
              { label: t('storageView.sheetKpi.rawMaterials'), value: contents.rawMaterials.length.toString() },
              { label: t('storageView.sheetKpi.activeLots'), value: contents.materialLots.filter(l => l.status === 'ACTIVE').length.toString() },
              { label: t('storageView.sheetKpi.stockValue'), value: `SAR ${contents.stockValue.toLocaleString()}` },
            ].map(k => (
              <div key={k.label} className="bg-background px-3 py-2.5 text-center">
                <div className="text-sm font-bold">{k.value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 border-b shrink-0 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap',
                tab === t.id
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon size={11} />
              {t.label}
              {t.count > 0 && (
                <span className={cn('ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold', tab === t.id ? 'bg-primary/20 text-primary' : 'bg-muted')}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">{t('storageView.loadingContents')}</div>
          )}

          {!isLoading && contents && tab === 'summary' && <SummaryTab contents={contents} zone={zone} />}
          {!isLoading && contents && tab === 'raw'     && <RawMaterialsTab items={contents.rawMaterials} onAdjust={setAdjustTarget} />}
          {!isLoading && contents && tab === 'lots'    && <MaterialLotsTab items={contents.materialLots} onAdjust={setAdjustTarget} />}
          {!isLoading && contents && tab === 'parts'   && <SparePartsTab items={contents.spareParts} onAdjust={setAdjustTarget} />}
          {!isLoading && contents && tab === 'skus'    && <SKUsTab items={contents.skus} onAdjust={setAdjustTarget} />}
          {!isLoading && contents && tab === 'fg'      && <FinishedGoodsTab items={fgLots} onAdjust={setAdjustTarget} />}
        </div>

        {/* Unified stock-adjustment modal */}
        <AdjustStockModal
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSubmit={(dto) => adjustMutation.mutate(dto)}
          isPending={adjustMutation.isPending}
        />
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab — Summary                                                       */
/* ------------------------------------------------------------------ */

function SummaryTab({ contents, zone }: { contents: LocationContents; zone: typeof ZONES[number] }) {
  const { t } = useTranslation(['inventory', 'common']);
  const totalItems = contents.rawMaterials.length + contents.materialLots.length + contents.spareParts.length + contents.skus.length;
  const lowStock = [...contents.rawMaterials, ...contents.spareParts].filter(i => i.isLowStock).length;
  const expiredLots = contents.materialLots.filter(l => l.status === 'EXPIRED').length;
  const usage = contents.capacity && contents.capacity > 0
    ? Math.min(100, (totalItems / contents.capacity) * 100)
    : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Capacity gauge */}
      {usage !== null && (
        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="font-medium">{t('storageView.capacityUtilization')}</span>
            <span className={cn('font-bold', usage > 80 ? 'text-red-400' : usage > 60 ? 'text-amber-400' : 'text-green-400')}>
              {usage.toFixed(1)}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden mb-2">
            <div
              className={cn('h-full rounded-full transition-all', usage > 80 ? 'bg-red-400' : usage > 60 ? 'bg-amber-400' : zone.bar)}
              style={{ width: `${usage}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">{t('storageView.itemsCapacity', { items: totalItems, capacity: contents.capacity })}</div>
        </div>
      )}

      {/* Alerts */}
      {(lowStock > 0 || expiredLots > 0) && (
        <div className="flex flex-col gap-2">
          {lowStock > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
              <AlertTriangle size={14} />
              <span>{t('storageView.belowMin', { count: lowStock })}</span>
            </div>
          )}
          {expiredLots > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertTriangle size={14} />
              <span>{t('storageView.expiredLots', { count: expiredLots })}</span>
            </div>
          )}
        </div>
      )}

      {/* Category breakdown */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: t('storageView.breakdown.rawMaterials'),  count: contents.rawMaterials.length,  icon: Package,      color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
          { label: t('storageView.breakdown.materialLots'),  count: contents.materialLots.length,  icon: Archive,      color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
          { label: t('storageView.breakdown.spareParts'),    count: contents.spareParts.length,    icon: Settings,     color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
          { label: t('storageView.breakdown.products'),  count: contents.skus.length,          icon: QrCode,       color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
        ].map(c => (
          <div key={c.label} className={cn('border rounded-lg p-3 flex items-center gap-3', c.bg)}>
            <c.icon size={16} className={c.color} />
            <div>
              <div className={cn('text-lg font-bold leading-none', c.color)}>{c.count}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Stock value */}
      <div className="border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <DollarSign size={14} className="text-green-400" />
          <span className="text-sm font-medium">{t('storageView.estStockValue')}</span>
        </div>
        <div className="text-2xl font-bold text-green-400">SAR {contents.stockValue.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground mt-1">{t('storageView.stockValueBasis')}</div>
      </div>

      {totalItems === 0 && (
        <div className="border rounded-xl p-10 text-center text-sm text-muted-foreground">
          <Boxes size={32} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium">{t('storageView.emptyLocation')}</p>
          <p className="text-xs mt-1">{t('storageView.emptyLocationHint')}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab — Raw Materials                                                 */
/* ------------------------------------------------------------------ */

function RawMaterialsTab({ items, onAdjust }: { items: LocationContents['rawMaterials']; onAdjust: (t: AdjustTarget) => void }) {
  const { t } = useTranslation(['inventory', 'common']);
  if (items.length === 0) return <EmptyTab label={t('storageView.noRawAt')} />;
  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b">
          <tr>
            <th className="text-start px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storage.col.codeName')}</th>
            <th className="text-start px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storage.col.category')}</th>
            <th className="text-end px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storage.col.stockQty')}</th>
            <th className="text-end px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storage.col.value')}</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storage.col.status')}</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={r.id} className={cn('border-b last:border-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/10')}>
              <td className="px-3 py-2.5">
                <div className="font-mono text-xs font-bold text-blue-400">{r.code}</div>
                <div className="text-xs text-muted-foreground truncate max-w-[180px]">{r.name}</div>
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.category ?? '—'}</td>
              <td className="px-3 py-2.5 text-right">
                <span className="font-medium">{r.stockQty.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground ml-1">{r.unit}</span>
              </td>
              <td className="px-3 py-2.5 text-right text-xs font-medium">{r.stockValue.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-center">
                {r.isLowStock ? (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5">
                    <AlertTriangle size={9} /> {t('storageView.lowStock')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 rounded px-1.5 py-0.5">
                    <CheckCircle2 size={9} /> {t('storageView.ok')}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-end">
                <AdjustButton onClick={() => onAdjust({ entityType: 'RAW_MATERIAL', entityId: r.id, code: r.code, name: r.name, current: r.stockQty, unit: r.unit })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab — Material Lots                                                 */
/* ------------------------------------------------------------------ */

function MaterialLotsTab({ items, onAdjust }: { items: LocationContents['materialLots']; onAdjust: (t: AdjustTarget) => void }) {
  const { t } = useTranslation(['inventory', 'common']);
  if (items.length === 0) return <EmptyTab label={t('storageView.noLotsAt')} />;
  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b">
          <tr>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.lotsCol.lotMaterial')}</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.lotsCol.bin')}</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.lotsCol.qtyRemaining')}</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.lotsCol.received')}</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.lotsCol.status')}</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((lot, i) => {
            const cfg = LOT_STATUS_CFG[lot.status];
            const statusLabel = cfg ? t(cfg.labelKey) : lot.status;
            const statusCls = cfg ? cfg.cls : 'bg-muted text-muted-foreground';
            const pct = lot.quantity > 0 ? ((lot.remainingQty ?? 0) / lot.quantity) * 100 : 0;
            return (
              <tr key={lot.id} className={cn('border-b last:border-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/10')}>
                <td className="px-3 py-2.5">
                  <div className="font-mono text-xs font-bold text-violet-400">{lot.lotNumber}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[180px]">{lot.materialName}</div>
                </td>
                <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{lot.binNumber ?? '—'}</td>
                <td className="px-3 py-2.5 text-right">
                  <div className="text-xs font-medium">{(lot.remainingQty ?? 0).toLocaleString()} / {lot.quantity.toLocaleString()} {lot.unit}</div>
                  <div className="w-16 h-1 rounded-full bg-muted overflow-hidden ml-auto mt-1">
                    <div className={cn('h-full rounded-full', pct < 20 ? 'bg-red-400' : pct < 50 ? 'bg-amber-400' : 'bg-violet-400')} style={{ width: `${pct}%` }} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {new Date(lot.receivedAt).toLocaleDateString()}
                  {lot.expiryDate && (
                    <div className={cn('text-[10px]', new Date(lot.expiryDate) < new Date() ? 'text-red-400' : 'text-muted-foreground')}>
                      {t('storageView.lotsCol.exp')}: {new Date(lot.expiryDate).toLocaleDateString()}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded border', statusCls)}>{statusLabel}</span>
                </td>
                <td className="px-3 py-2.5 text-end">
                  <AdjustButton onClick={() => onAdjust({ entityType: 'MATERIAL_LOT', entityId: lot.id, code: lot.lotNumber, name: lot.materialName, current: lot.remainingQty ?? 0, unit: lot.unit })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab — Spare Parts                                                   */
/* ------------------------------------------------------------------ */

function SparePartsTab({ items, onAdjust }: { items: LocationContents['spareParts']; onAdjust: (t: AdjustTarget) => void }) {
  const { t } = useTranslation(['inventory', 'common']);
  if (items.length === 0) return <EmptyTab label={t('storageView.noPartsAt')} />;
  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b">
          <tr>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.partsCol.partNameHead')}</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.partsCol.binCategory')}</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.partsCol.stockQty')}</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.partsCol.value')}</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.partsCol.status')}</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((p, i) => (
            <tr key={p.id} className={cn('border-b last:border-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/10')}>
              <td className="px-3 py-2.5">
                <div className="font-mono text-xs font-bold text-amber-400">{p.partNumber}</div>
                <div className="text-xs text-muted-foreground truncate max-w-[180px]">{p.name}</div>
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                <div>{p.binNumber ?? '—'}</div>
                {p.category && <div className="text-[10px]">{p.category}</div>}
              </td>
              <td className="px-3 py-2.5 text-right font-medium">{p.stockQty.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-xs font-medium">{p.stockValue.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-center">
                {p.isLowStock ? (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5">
                    <AlertTriangle size={9} /> {t('storageView.lowStock')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 rounded px-1.5 py-0.5">
                    <CheckCircle2 size={9} /> {t('storageView.ok')}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-end">
                <AdjustButton onClick={() => onAdjust({ entityType: 'SPARE_PART', entityId: p.id, code: p.partNumber, name: p.name, current: p.stockQty })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab — SKUs / Products                                               */
/* ------------------------------------------------------------------ */

function SKUsTab({ items, onAdjust }: { items: LocationContents['skus']; onAdjust: (t: AdjustTarget) => void }) {
  const { t } = useTranslation(['inventory', 'common']);
  if (items.length === 0) return <EmptyTab label={t('storageView.noSkusAt')} />;
  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b">
          <tr>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.skusCol.skuCode')}</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.skusCol.name')}</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.skusCol.itemNo')}</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.skusCol.onHand')}</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((s, i) => (
            <tr key={s.id} className={cn('border-b last:border-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/10')}>
              <td className="px-3 py-2.5 font-mono text-xs font-bold text-green-400">{s.code}</td>
              <td className="px-3 py-2.5 text-xs truncate max-w-[160px]">{s.name}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{s.itemNumber ?? '—'}</td>
              <td className="px-3 py-2.5 text-right">
                <span className="font-medium">{(s.currentStock ?? 0).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground ml-1">{s.baseUnit ?? ''}</span>
              </td>
              <td className="px-3 py-2.5 text-end">
                <AdjustButton onClick={() => onAdjust({ entityType: 'PRODUCT', entityId: s.id, code: s.code, name: s.name, current: s.currentStock ?? 0, unit: s.baseUnit })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab — Finished Goods Lots                                          */
/* ------------------------------------------------------------------ */

function FinishedGoodsTab({ items, onAdjust }: { items: NonNullable<LocationContents['finishedGoodsLots']>; onAdjust: (t: AdjustTarget) => void }) {
  const { t } = useTranslation(['inventory', 'common']);
  if (items.length === 0) return <EmptyTab label={t('storageView.noFgAt')} />;
  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 border-b">
          <tr>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.fgCol.lotSku')}</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.fgCol.produced')}</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.fgCol.remaining')}</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{t('storageView.fgCol.producedAt')}</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((lot, i) => {
            const pct = lot.quantity > 0 ? ((lot.remainingQty ?? 0) / lot.quantity) * 100 : 0;
            return (
              <tr key={lot.id} className={cn('border-b last:border-0', i % 2 === 0 ? 'bg-background' : 'bg-muted/10')}>
                <td className="px-3 py-2.5">
                  <div className="font-mono text-xs font-bold text-green-400">{lot.lotNumber}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[180px]">{lot.sku ? `${lot.sku.code} — ${lot.sku.name}` : ''}</div>
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                  {lot.producedQty != null ? `${lot.producedQty.toLocaleString()} ${lot.producedUnit ?? ''}` : `${lot.quantity.toLocaleString()} ${lot.unit}`}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="text-xs font-medium">{(lot.remainingQty ?? 0).toLocaleString()} / {lot.quantity.toLocaleString()} {lot.unit}</div>
                  <div className="w-16 h-1 rounded-full bg-muted overflow-hidden ml-auto mt-1">
                    <div className={cn('h-full rounded-full', pct < 20 ? 'bg-red-400' : pct < 50 ? 'bg-amber-400' : 'bg-green-400')} style={{ width: `${pct}%` }} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {lot.producedAt ? new Date(lot.producedAt).toLocaleDateString() : '—'}
                  {lot.workOrder && <div className="text-[10px] font-mono">{lot.workOrder.orderNumber}</div>}
                </td>
                <td className="px-3 py-2.5 text-end">
                  <AdjustButton onClick={() => onAdjust({ entityType: 'FINISHED_GOODS_LOT', entityId: lot.id, code: lot.lotNumber, name: lot.sku?.name ?? lot.lotNumber, current: lot.remainingQty ?? 0, unit: lot.unit })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Adjust button + unified adjustment modal                            */
/* ------------------------------------------------------------------ */

function AdjustButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation(['inventory', 'common']);
  return (
    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
      <SlidersHorizontal size={11} className="me-1" /> {t('storageView.adjustBtn')}
    </Button>
  );
}

const ADJUST_MODES = [
  { value: 'SET',    icon: Equal,    labelKey: 'storageView.adjust.modeSet',    hintKey: 'storageView.adjust.modeSetHint'    },
  { value: 'ADD',    icon: PlusIcon, labelKey: 'storageView.adjust.modeAdd',    hintKey: 'storageView.adjust.modeAddHint'    },
  { value: 'REMOVE', icon: Minus,    labelKey: 'storageView.adjust.modeRemove', hintKey: 'storageView.adjust.modeRemoveHint' },
] as const;

function AdjustStockModal({ target, onClose, onSubmit, isPending }: {
  target: AdjustTarget | null;
  onClose: () => void;
  onSubmit: (dto: { entityType: string; entityId: string; mode: string; quantity: number; reason?: string }) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation(['inventory', 'common']);
  const [mode, setMode] = useState<'ADD' | 'REMOVE' | 'SET'>('SET');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');

  // Reset the form whenever a new target opens.
  React.useEffect(() => {
    if (target) {
      setMode('SET');
      setQuantity(String(target.current ?? 0));
      setReason('');
    }
  }, [target?.entityId]);

  if (!target) return null;

  const qtyNum = parseFloat(quantity);
  const valid = Number.isFinite(qtyNum) && qtyNum >= 0;
  const resulting = !valid ? target.current
    : mode === 'ADD' ? target.current + qtyNum
    : mode === 'REMOVE' ? target.current - qtyNum
    : qtyNum;
  const wouldGoNegative = resulting < 0;
  const activeMode = ADJUST_MODES.find(m => m.value === mode)!;

  return (
    <AnimatePresence>
      {target && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="bg-background border rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <SlidersHorizontal size={16} className="text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm">{t('storageView.adjust.title')}</h3>
                <p className="text-xs text-muted-foreground truncate">
                  <span className="font-mono">{target.code}</span> — {target.name}
                </p>
              </div>
            </div>

            {/* Mode selector */}
            <div className="flex flex-col gap-1.5 mb-4">
              <Label>{t('storageView.adjust.mode')}</Label>
              <div className="grid grid-cols-3 gap-2">
                {ADJUST_MODES.map(m => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={cn(
                      'flex items-center justify-center gap-1.5 h-9 rounded-lg border text-xs font-medium transition-colors',
                      mode === m.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <m.icon size={12} /> {t(m.labelKey)}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{t(activeMode.hintKey)}</span>
            </div>

            {/* Quantity */}
            <div className="flex flex-col gap-1.5 mb-4">
              <Label>{t('storageView.adjust.quantity')}{target.unit ? ` (${target.unit})` : ''}</Label>
              <Input
                type="number" min="0" step="any" autoFocus
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className="h-9 text-sm"
              />
            </div>

            {/* Current → Resulting preview */}
            <div className="flex items-center justify-between gap-3 mb-4 p-3 rounded-lg bg-muted/40 border text-sm">
              <div className="text-center flex-1">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('storageView.adjust.current')}</div>
                <div className="font-bold">{target.current.toLocaleString()}</div>
              </div>
              <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              <div className="text-center flex-1">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('storageView.adjust.resulting')}</div>
                <div className={cn('font-bold', wouldGoNegative ? 'text-red-400' : 'text-green-400')}>
                  {valid ? resulting.toLocaleString() : '—'}
                </div>
              </div>
            </div>

            {/* Reason */}
            <div className="flex flex-col gap-1.5 mb-5">
              <Label>{t('storageView.adjust.reason')}</Label>
              <Input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('storageView.adjust.reasonPlaceholder')}
                className="h-9 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>{t('storageView.adjust.cancel')}</Button>
              <Button
                size="sm"
                disabled={!valid || wouldGoNegative || isPending}
                onClick={() => onSubmit({
                  entityType: target.entityType,
                  entityId: target.entityId,
                  mode,
                  quantity: qtyNum,
                  reason: reason.trim() || undefined,
                })}
              >
                {isPending ? t('storageView.adjust.saving') : t('storageView.adjust.save')}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state helper                                                  */
/* ------------------------------------------------------------------ */

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm">
      <Boxes size={32} className="mb-3 opacity-20" />
      {label}
    </div>
  );
}
