'use client';
import { useTranslation } from 'react-i18next';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Layers, Cpu, Activity, ChevronRight, ChevronDown, Circle,
  Plus, Pencil, Trash2, MoreVertical, X, Settings, AlertTriangle,
  LayoutDashboard, Monitor,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface HierarchyNode {
  id: string;
  name: string;
  type: 'FACTORY' | 'AREA' | 'PRODUCTION_LINE' | 'MACHINE';
  code?: string;
  machineType?: string;
  state?: string;
  oee?: number;
  // Editable attributes (surfaced by /hierarchy/tree for the Edit dialog)
  areaType?: string;
  lineType?: string;
  criticality?: string;
  manufacturer?: string | null;
  designCapacity?: number | null;
  downtimeThreshold?: number | null;
  areaId?: string | null;
  lineId?: string | null;
  oeeMethod?: 'ROLLUP' | 'BOTTLENECK';
  bottleneckMachineId?: string | null;
  outfeedMachineIds?: string[];
  children?: HierarchyNode[];
}

interface Area { id: string; name: string; code: string; type: string }
interface Line { id: string; name: string; code: string; type: string; areaId: string }

const TYPE_CFG = {
  FACTORY:         { icon: Building2, color: 'text-brand-400',  bg: 'bg-brand-500/20',  label: 'Factory'         },
  AREA:            { icon: Layers,    color: 'text-blue-400',   bg: 'bg-blue-500/20',   label: 'Area'            },
  PRODUCTION_LINE: { icon: Activity,  color: 'text-cyan-400',   bg: 'bg-cyan-500/20',   label: 'Production Line' },
  MACHINE:         { icon: Cpu,       color: 'text-green-400',  bg: 'bg-green-500/20',  label: 'Machine'         },
} as const;

const STATE_COLORS: Record<string, string> = {
  RUNNING: 'text-green-400', IDLE: 'text-amber-400', FAULT: 'text-red-400',
  MAINTENANCE: 'text-blue-400', OFFLINE: 'text-gray-400',
};

const AREA_TYPES = ['MAKING', 'PACKING', 'FILLING', 'UTILITY', 'WAREHOUSE', 'LABORATORY', 'OFFICE'];
const LINE_TYPES = ['PACKING', 'FILLING', 'MAKING', 'BLOW_MOLDING', 'BLOW_FILM', 'AEROSOL', 'CUTTING_SEALING', 'UTILITY'];
const MACHINE_TYPES = [
  'MACHINE', 'FILLING_MACHINE', 'CARTONING_MACHINE', 'CHECKWEIGHER', 'ROBOT', 'WRAPPING_MACHINE',
  'PALLETIZER', 'BLOW_MOLDING', 'CONVEYOR', 'COMPRESSOR', 'BOILER', 'TRANSFORMER',
  'CHILLER', 'PUMP', 'MIXER', 'REACTOR', 'SENSOR', 'GATEWAY', 'HMI',
];
const CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

type NodeType = 'AREA' | 'PRODUCTION_LINE' | 'MACHINE';

const EMPTY_FORM = {
  type: 'MACHINE' as NodeType,
  name: '', code: '',
  areaType: 'PACKING', lineType: 'PACKING',
  machineType: 'MACHINE', criticality: 'MEDIUM',
  areaId: '__none__', lineId: '__none__',
  manufacturer: '', designCapacity: '', downtimeThreshold: '',
  // Line OEE basis. ROLLUP = historic quantity-weighted aggregation of every
  // machine; BOTTLENECK = constraint A × constraint P × final-outfeed Q.
  oeeMethod: 'ROLLUP' as 'ROLLUP' | 'BOTTLENECK',
  bottleneckMachineId: '__none__',
  // Multi-select: a line can finish through several outfeeds. Empty = all machines.
  outfeedMachineIds: [] as string[],
};

function TreeNode({
  node, depth = 0, onEdit, onDelete,
}: { node: HierarchyNode; depth?: number; onEdit: (n: HierarchyNode) => void; onDelete: (n: HierarchyNode) => void }) {
  const { t } = useTranslation('modules');
  const router = useRouter();
  const [expanded, setExpanded] = useState(depth < 2);
  const cfg = TYPE_CFG[node.type] ?? TYPE_CFG.MACHINE;
  const Icon = cfg.icon;
  const hasChildren = node.children && node.children.length > 0;
  // Hierarchy node type → dashboard entity type.
  const entityType = ({ FACTORY: 'plant', AREA: 'area', PRODUCTION_LINE: 'line', MACHINE: 'machine' } as Record<string, string>)[node.type] ?? 'machine';

  return (
    <div>
      <div
        className={cn('flex items-center gap-2 py-2 px-3 rounded-lg group cursor-pointer hover:bg-foreground/5 transition-colors')}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <span className="text-muted-foreground w-4 shrink-0">
          {hasChildren
            ? expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
            : null}
        </span>

        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', cfg.bg)}>
          <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{node.name}</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 shrink-0">{t(`hierarchy.hform.nodeType.${node.type}`, { defaultValue: cfg.label })}</Badge>
            {node.code && <span className="text-[10px] font-mono text-muted-foreground">{node.code}</span>}
          </div>
          {node.machineType && (
            <div className="text-[11px] text-muted-foreground mt-0.5">{node.machineType.replace(/_/g, ' ')}</div>
          )}
        </div>

        {node.state && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Circle className={cn('w-2 h-2 fill-current', STATE_COLORS[node.state] ?? 'text-gray-400')} />
            {node.oee != null && (
              <span className="text-[10px] text-muted-foreground font-mono">{node.oee.toFixed(1)}%</span>
            )}
          </div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0">
              <MoreVertical className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs">
            {/* Configure Live Dashboard / Open Live View — for Plant, Area, Line, Machine */}
            <DropdownMenuItem onClick={e => { e.stopPropagation(); router.push(`/plant-hierarchy/dashboard-builder/${entityType}/${node.id}`); }}>
              <LayoutDashboard className="w-3 h-3 mr-2 text-brand-400" /> {t('hierarchy.configureDashboard', { defaultValue: 'Configure Live Dashboard' })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => { e.stopPropagation(); router.push(`/plant-live-view/${entityType}/${node.id}`); }}>
              <Monitor className="w-3 h-3 mr-2 text-emerald-400" /> {t('hierarchy.openLiveView', { defaultValue: 'Open Live View' })}
            </DropdownMenuItem>
            {node.type !== 'FACTORY' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={e => { e.stopPropagation(); onEdit(node); }}>
                  <Pencil className="w-3 h-3 mr-2" /> {t('hierarchy.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={e => { e.stopPropagation(); onDelete(node); }} className="text-destructive">
                  <Trash2 className="w-3 h-3 mr-2" /> {t('hierarchy.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map(child => (
            <TreeNode key={child.id} node={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HierarchyView() {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editNode, setEditNode] = useState<HierarchyNode | null>(null);
  const [deleteNode, setDeleteNode] = useState<HierarchyNode | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['hierarchy-tree'],
    queryFn: () => api.get('/hierarchy/tree'),
    staleTime: 30_000,
  });

  const { data: areasData } = useQuery({
    queryKey: ['hierarchy', 'areas'],
    queryFn: () => api.get('/hierarchy/areas'),
    staleTime: 60_000,
    enabled: formOpen,
  });

  const { data: linesData } = useQuery({
    queryKey: ['hierarchy', 'lines', form.areaId],
    queryFn: () => api.get('/hierarchy/lines', { params: { areaId: form.areaId || undefined } }),
    staleTime: 60_000,
    enabled: formOpen && form.type === 'MACHINE',
  });

  // Machines on the line being edited — the candidates for the bottleneck and the
  // final outfeed point. Only meaningful once the line exists, so it is skipped
  // while creating (a new line has no machines yet).
  const { data: lineMachinesData } = useQuery({
    queryKey: ['hierarchy', 'machines', editNode?.id],
    queryFn: () => api.get('/hierarchy/machines', { params: { lineId: editNode?.id } }),
    staleTime: 60_000,
    enabled: formOpen && form.type === 'PRODUCTION_LINE' && !!editNode?.id,
  });

  const areas: Area[] = (areasData as any) ?? [];
  const lines: Line[] = (linesData as any) ?? [];
  const lineMachines: { id: string; name: string; code: string }[] = (lineMachinesData as any) ?? [];

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/hierarchy', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hierarchy-tree'] });
      qc.invalidateQueries({ queryKey: ['hierarchy', 'areas'] });
      qc.invalidateQueries({ queryKey: ['hierarchy', 'lines'] });
      toast({ title: t('hierarchy.toastCreated') });
      setFormOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: any) => toast({ title: t('hierarchy.toastCreateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/hierarchy/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hierarchy-tree'] });
      qc.invalidateQueries({ queryKey: ['hierarchy', 'areas'] });
      toast({ title: t('hierarchy.toastUpdated') });
      setEditNode(null);
    },
    onError: (e: any) => toast({ title: t('hierarchy.toastUpdateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: string }) =>
      api.delete(`/hierarchy/${id}`, { data: { type } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hierarchy-tree'] });
      toast({ title: t('hierarchy.toastRemoved') });
      setDeleteNode(null);
    },
    onError: (e: any) => toast({ title: t('hierarchy.toastDeleteFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const openCreate = () => {
    setEditNode(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (node: HierarchyNode) => {
    setEditNode(node);
    setForm({
      ...EMPTY_FORM,
      type: node.type as NodeType,
      name: node.name,
      code: node.code ?? '',
      areaType: node.areaType ?? 'PACKING',
      lineType: node.lineType ?? 'PACKING',
      machineType: node.machineType ?? 'MACHINE',
      criticality: node.criticality ?? 'MEDIUM',
      areaId: node.areaId ?? '__none__',
      lineId: node.lineId ?? '__none__',
      manufacturer: node.manufacturer ?? '',
      designCapacity: node.designCapacity != null ? String(node.designCapacity) : '',
      downtimeThreshold: node.downtimeThreshold != null ? String(node.downtimeThreshold) : '',
      oeeMethod: node.oeeMethod ?? 'ROLLUP',
      bottleneckMachineId: node.bottleneckMachineId ?? '__none__',
      outfeedMachineIds: node.outfeedMachineIds ?? [],
    });
    setFormOpen(true);
  };

  const none = '__none__';
  const val = (v: string) => (v === none || v === '' ? undefined : v);

  const handleSubmit = () => {
    const dto: any = { type: form.type, name: form.name };
    if (!editNode) dto.code = form.code;

    if (form.type === 'AREA') {
      dto.areaType = form.areaType;
    } else if (form.type === 'PRODUCTION_LINE') {
      dto.lineType = form.lineType;
      dto.areaId = val(form.areaId);
      dto.oeeMethod = form.oeeMethod;
      // Always send both — '' / [] clear the nomination back to automatic, which is a
      // meaningful choice and must not be collapsed into "leave unchanged".
      dto.bottleneckMachineId = val(form.bottleneckMachineId) ?? '';
      dto.outfeedMachineIds = form.outfeedMachineIds;
    } else if (form.type === 'MACHINE') {
      dto.machineType = form.machineType;
      dto.criticality = form.criticality;
      if (val(form.areaId)) dto.areaId = val(form.areaId);
      if (val(form.lineId)) dto.lineId = val(form.lineId);
      if (form.manufacturer) dto.manufacturer = form.manufacturer;
      if (form.designCapacity) dto.designCapacity = form.designCapacity;
      if (form.downtimeThreshold) dto.downtimeThreshold = form.downtimeThreshold;
    }

    if (editNode) {
      updateMutation.mutate({ id: editNode.id, dto });
    } else {
      createMutation.mutate(dto);
    }
  };

  const isValid = !!form.name && (editNode ? true : !!form.code) &&
    (form.type !== 'PRODUCTION_LINE' || (!!form.areaId && form.areaId !== none));

  const nodes: HierarchyNode[] = Array.isArray(tree)
    ? tree as HierarchyNode[]
    : tree ? [tree as HierarchyNode] : [];

  const nodeTypeLabel = (t: NodeType) => TYPE_CFG[t]?.label ?? t;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('hierarchy.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('hierarchy.subtitle')}</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" /> {t('hierarchy.addNode')}
        </Button>
      </div>

      <InlineFormSlot />

      {/* Tree */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t('hierarchy.tree')}</h2>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {(Object.keys(TYPE_CFG) as (keyof typeof TYPE_CFG)[]).map(type => {
              const cfg = TYPE_CFG[type];
              const Icon = cfg.icon;
              return (
                <div key={type} className="flex items-center gap-1.5">
                  <Icon className={cn('w-3 h-3', cfg.color)} />
                  <span>{t(`hierarchy.hform.nodeType.${type}`, { defaultValue: cfg.label })}</span>
                </div>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-10 rounded" />)}
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">{t('hierarchy.noHierarchy')}</p>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {nodes.map(node => (
              <TreeNode key={node.id} node={node} depth={0} onEdit={openEdit} onDelete={setDeleteNode} />
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit — inline form */}
      <InlineFormPanel
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditNode(null); }}
        icon={Settings}
        title={editNode ? t('hierarchy.hform.editTitle', { type: t(`hierarchy.hform.nodeType.${editNode.type}`, { defaultValue: nodeTypeLabel(editNode.type as NodeType) }) }) : t('hierarchy.hform.createTitle')}
        description={editNode
          ? t('hierarchy.hform.editDesc', { name: editNode.name })
          : t('hierarchy.hform.createDesc')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => { setFormOpen(false); setEditNode(null); }}>{t('hierarchy.hform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!isValid || createMutation.isPending || updateMutation.isPending}
              onClick={handleSubmit}
            >
              {createMutation.isPending || updateMutation.isPending
                ? (editNode ? t('hierarchy.hform.saving') : t('hierarchy.hform.creating'))
                : (editNode ? t('hierarchy.hform.saveChanges') : t('hierarchy.hform.createNode'))}
            </Button>
          </>
        )}
      >
          <div className="space-y-4">
            {/* Node Type — only when creating */}
            {!editNode && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('hierarchy.hform.nodeTypeField')} <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-3 gap-2">
                  {(['AREA', 'PRODUCTION_LINE', 'MACHINE'] as NodeType[]).map(nt => {
                    const cfg = TYPE_CFG[nt];
                    const Icon = cfg.icon;
                    return (
                      <button
                        key={nt}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, type: nt }))}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all',
                          form.type === nt
                            ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                            : 'border-border hover:border-border/70 text-muted-foreground hover:bg-muted/30',
                        )}
                      >
                        <Icon className={cn('w-5 h-5', form.type === nt ? cfg.color : '')} />
                        {t(`hierarchy.hform.nodeType.${nt}`, { defaultValue: cfg.label })}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Common: Name + Code (Code is read-only when editing — it's the immutable node key) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('hierarchy.hform.name')} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={form.type === 'AREA' ? t('hierarchy.hform.namePhArea') : form.type === 'PRODUCTION_LINE' ? t('hierarchy.hform.namePhLine') : t('hierarchy.hform.namePhMachine')}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {t('hierarchy.hform.code')} {!editNode && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder={form.type === 'AREA' ? 'PACKING' : form.type === 'PRODUCTION_LINE' ? 'PL-01' : 'M1-001'}
                  className="h-9 font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={!!editNode}
                  title={editNode ? t('hierarchy.hform.codeRO') : undefined}
                />
              </div>
            </div>

            {/* AREA specific */}
            {form.type === 'AREA' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('hierarchy.hform.areaType')}</Label>
                <Select value={form.areaType} onValueChange={v => setForm(f => ({ ...f, areaType: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AREA_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* PRODUCTION_LINE specific */}
            {form.type === 'PRODUCTION_LINE' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t('hierarchy.hform.area')} <span className="text-destructive">*</span></Label>
                  <EntityPicker
                    items={areas}
                    value={form.areaId || null}
                    onChange={id => setForm(f => ({ ...f, areaId: id ?? '' }))}
                    getId={a => a.id}
                    getPrimary={a => a.name}
                    placeholder={t('hierarchy.hform.selectArea')}
                    searchPlaceholder={t('hierarchy.hform.searchAreas')}
                    emptyText={t('hierarchy.hform.noAreas')}
                    clearable={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t('hierarchy.hform.lineType')}</Label>
                  <Select value={form.lineType} onValueChange={v => setForm(f => ({ ...f, lineType: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LINE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* PRODUCTION_LINE — Overall Line OEE basis.
                A packaging line runs at the speed of its constraint, so line OEE takes
                Availability and Performance from the bottleneck and Quality from the
                final outfeed. Only offered when editing: a new line has no machines yet. */}
            {form.type === 'PRODUCTION_LINE' && editNode && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                <div>
                  <p className="text-xs font-semibold">{t('hierarchy.hform.oeeBasisTitle')}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t('hierarchy.hform.oeeBasisDesc')}
                  </p>
                </div>
                {/* Method — both options are first-class; ROLLUP stays the default. */}
                <div className="grid grid-cols-2 gap-2">
                  {(['ROLLUP', 'BOTTLENECK'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, oeeMethod: m }))}
                      className={cn(
                        'rounded-lg border p-2.5 text-left transition-all',
                        form.oeeMethod === m
                          ? 'border-brand-500 bg-brand-500/10'
                          : 'border-border hover:border-border/70 hover:bg-muted/30',
                      )}
                    >
                      <span className={cn('block text-xs font-semibold',
                        form.oeeMethod === m ? 'text-brand-400' : 'text-foreground')}>
                        {t(`hierarchy.hform.oeeMethod.${m}`)}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                        {t(`hierarchy.hform.oeeMethodDesc.${m}`)}
                      </span>
                    </button>
                  ))}
                </div>

                {form.oeeMethod === 'BOTTLENECK' && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">{t('hierarchy.hform.bottleneckMachine')}</Label>
                      <EntityPicker
                        items={lineMachines}
                        value={form.bottleneckMachineId === none ? null : form.bottleneckMachineId}
                        onChange={id => setForm(f => ({ ...f, bottleneckMachineId: id ?? none }))}
                        getId={m => m.id}
                        getPrimary={m => m.name}
                        getSecondary={m => m.code}
                        placeholder={t('hierarchy.hform.autoLowestCapacity')}
                        searchPlaceholder={t('hierarchy.hform.searchMachines')}
                        emptyText={t('hierarchy.hform.noMachines')}
                        clearable
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {t('hierarchy.hform.bottleneckHint')}
                      </p>
                    </div>

                    {/* Outfeed is multi-select: a line can finish through several
                        points, and none selected means every machine counts. */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">{t('hierarchy.hform.outfeedMachine')}</Label>
                        {form.outfeedMachineIds.length > 0 && (
                          <button
                            type="button"
                            className="text-[10px] text-brand-400 hover:underline"
                            onClick={() => setForm(f => ({ ...f, outfeedMachineIds: [] }))}
                          >
                            {t('hierarchy.hform.selectAllMachines')}
                          </button>
                        )}
                      </div>
                      {lineMachines.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">{t('hierarchy.hform.noMachines')}</p>
                      ) : (
                        <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-border/60 p-2">
                          {lineMachines.map(m => {
                            const checked = form.outfeedMachineIds.includes(m.id);
                            return (
                              <label
                                key={m.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/40"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setForm(f => ({
                                    ...f,
                                    outfeedMachineIds: checked
                                      ? f.outfeedMachineIds.filter(x => x !== m.id)
                                      : [...f.outfeedMachineIds, m.id],
                                  }))}
                                  className="h-3.5 w-3.5 accent-current text-brand-500"
                                />
                                <span className="text-xs">{m.name}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">{m.code}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        {form.outfeedMachineIds.length === 0
                          ? t('hierarchy.hform.outfeedAllHint')
                          : t('hierarchy.hform.outfeedHint')}
                      </p>
                    </div>
                  </>
                )}

                <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
                  {form.oeeMethod === 'BOTTLENECK'
                    ? t('hierarchy.hform.oeeBasisFormula')
                    : t('hierarchy.hform.oeeRollupFormula')}
                </p>
              </div>
            )}

            {/* MACHINE specific */}
            {form.type === 'MACHINE' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.machineType')}</Label>
                    <Select value={form.machineType} onValueChange={v => setForm(f => ({ ...f, machineType: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-52">
                        {MACHINE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.criticality')}</Label>
                    <Select value={form.criticality} onValueChange={v => setForm(f => ({ ...f, criticality: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CRITICALITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.area')}</Label>
                    <EntityPicker
                      items={areas}
                      value={form.areaId === '__none__' ? null : (form.areaId || null)}
                      onChange={id => setForm(f => ({ ...f, areaId: id ?? '__none__', lineId: '__none__' }))}
                      getId={a => a.id}
                      getPrimary={a => a.name}
                      placeholder={t('hierarchy.hform.selectArea')}
                      searchPlaceholder={t('hierarchy.hform.searchAreas')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.productionLine')}</Label>
                    <EntityPicker
                      items={lines}
                      value={form.lineId === '__none__' ? null : (form.lineId || null)}
                      onChange={id => setForm(f => ({ ...f, lineId: id ?? '__none__' }))}
                      getId={l => l.id}
                      getPrimary={l => l.name}
                      placeholder={form.areaId ? t('hierarchy.hform.selectLine') : t('hierarchy.hform.selectAreaFirst')}
                      searchPlaceholder={t('hierarchy.hform.searchLines')}
                      disabled={!form.areaId}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.manufacturer')}</Label>
                    <Input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} className="h-9" placeholder={t('hierarchy.hform.manufacturerPh')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.designCapacity')}</Label>
                    <Input type="number" value={form.designCapacity} onChange={e => setForm(f => ({ ...f, designCapacity: e.target.value }))} className="h-9" placeholder="e.g. 2700" />
                  </div>
                  {/*
                    The microstop boundary. A stop shorter than this is counted as
                    a microstop — reported as a subset of the availability loss so
                    no OEE figure moves, but it is what separates "the line keeps
                    hiccuping" from "the line broke down", and the two call for
                    different work. It belongs to the machine, not to a global
                    constant, because a filler and a palletiser do not agree on
                    what counts as brief.
                  */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.microStop')}</Label>
                    <Input
                      type="number" min={0} step={5}
                      value={form.downtimeThreshold}
                      onChange={e => setForm(f => ({ ...f, downtimeThreshold: e.target.value }))}
                      className="h-9" placeholder="60"
                    />
                    <p className="text-[11px] text-muted-foreground">{t('hierarchy.hform.microStopHelp')}</p>
                  </div>
                </div>
              </>
            )}
          </div>

      </InlineFormPanel>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteNode} onOpenChange={open => !open && setDeleteNode(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" /> {t('hierarchy.hform.removeTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('hierarchy.hform.removeConfirmPre')} <strong>{deleteNode?.name}</strong> {t('hierarchy.hform.removeConfirmPost')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteNode(null)}>{t('hierarchy.hform.cancel')}</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteNode && deleteMutation.mutate({ id: deleteNode.id, type: deleteNode.type })}
            >
              {deleteMutation.isPending ? t('hierarchy.hform.removing') : t('hierarchy.hform.removeNode')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
