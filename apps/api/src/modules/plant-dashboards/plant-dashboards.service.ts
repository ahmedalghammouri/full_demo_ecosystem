import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { KpiService } from '../production/kpi.service';
import { EnergyService } from '../energy/energy.service';
import { StorageService } from '../storage/storage.service';
import { currentShiftStart, currentShiftWindow } from '../../common/shift-window.util';

/** End of the plant day a moment falls in — the fallback slot end. */
function endOfToday(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}
import type {
  CreatePlantDashboardDto, UpdatePlantDashboardDto, WidgetDto, LiveSubscriptionDto,
} from './dto/plant-dashboard.dto';

type Actor = { id: string; factoryId: string | null; role: string };

/** Curated KPI catalog — metadata only (no values). Powers the card KPI picker. */
const KPI_CATALOG = [
  { code: 'OEE', label: 'OEE', category: 'OEE', unit: '%', decimals: 1 },
  { code: 'AVAILABILITY', label: 'Availability', category: 'OEE', unit: '%', decimals: 1 },
  { code: 'PERFORMANCE', label: 'Performance', category: 'OEE', unit: '%', decimals: 1 },
  { code: 'QUALITY', label: 'Quality', category: 'OEE', unit: '%', decimals: 1 },
  { code: 'OEE_TB', label: 'OEE (time-based)', category: 'OEE', unit: '%', decimals: 1 },
  { code: 'AVAILABILITY_TB', label: 'Availability (time-based)', category: 'OEE', unit: '%', decimals: 1 },
  { code: 'TOTAL_PRODUCTION', label: 'Total Production', category: 'Production', unit: '', decimals: 0 },
  { code: 'GOOD_COUNT', label: 'Good Count', category: 'Production', unit: '', decimals: 0 },
  { code: 'REJECT_COUNT', label: 'Reject Count', category: 'Quality', unit: '', decimals: 0 },
  { code: 'DOWNTIME', label: 'Downtime', category: 'Production', unit: 'min', decimals: 0 },
  { code: 'ACTIVE_ALARMS', label: 'Active Alarms', category: 'Alarms', unit: '', decimals: 0 },
  { code: 'ENERGY_CONSUMPTION', label: 'Energy Consumption', category: 'Energy', unit: 'kWh', decimals: 1 },
  { code: 'SPEED', label: 'Current Speed', category: 'Production', unit: '/hr', decimals: 0 },
] as const;
const KPI_CODES = new Set<string>(KPI_CATALOG.map((k) => k.code));

@Injectable()
export class PlantDashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
    private readonly energy: EnergyService,
    private readonly storage: StorageService,
  ) {}

  // ── Background image (stored via StorageService, streamed with auth) ─────────
  private static ALLOWED_IMG = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

  async setBackground(actor: Actor, id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const d = await this.getById(actor, id);
    if (!file) throw new BadRequestException('No file provided');
    if (!PlantDashboardsService.ALLOWED_IMG.has(file.mimetype)) {
      throw new BadRequestException('Unsupported image type (allowed: PNG, JPG, WEBP)');
    }
    // Remove the previous file if any.
    const prevKey = (d.backgroundSettings as any)?.storageKey as string | undefined;
    const storageKey = await this.storage.save(actor.factoryId, file.originalname, file.buffer);
    const settings = { ...((d.backgroundSettings as object) ?? {}), storageKey, mime: file.mimetype };
    await this.prisma.plantDashboard.update({
      where: { id },
      data: {
        backgroundImageUrl: `plant-dashboards/${id}/background`,
        backgroundSettings: settings as Prisma.InputJsonValue,
        updatedById: actor.id,
      },
    });
    if (prevKey) await this.storage.delete(prevKey).catch(() => {});
    return { backgroundImageUrl: `plant-dashboards/${id}/background` };
  }

  async removeBackground(actor: Actor, id: string) {
    const d = await this.getById(actor, id);
    const key = (d.backgroundSettings as any)?.storageKey as string | undefined;
    const settings = { ...((d.backgroundSettings as object) ?? {}) };
    delete (settings as any).storageKey;
    await this.prisma.plantDashboard.update({
      where: { id },
      data: { backgroundImageUrl: null, backgroundSettings: settings as Prisma.InputJsonValue, updatedById: actor.id },
    });
    if (key) await this.storage.delete(key).catch(() => {});
    return { ok: true };
  }

  /** Resolve the storage key + mime for streaming (Live View / builder <img>). */
  async backgroundStream(actor: Actor, id: string) {
    const d = await this.getById(actor, id);
    const key = (d.backgroundSettings as any)?.storageKey as string | undefined;
    if (!key) throw new NotFoundException('No background image');
    return { stream: this.storage.stream(key), mime: (d.backgroundSettings as any)?.mime ?? 'image/png' };
  }

  // ── Scope resolution (entity → machine ids) ────────────────────────────────
  private async resolveMachineIds(factoryId: string | null, scopeType: string, scopeId: string): Promise<string[]> {
    const where: Prisma.MachineWhereInput = { ...(factoryId ? { factoryId } : {}), isActive: true };
    if (scopeType === 'machine') where.id = scopeId;
    else if (scopeType === 'line') where.lineId = scopeId;
    else if (scopeType === 'area') where.line = { areaId: scopeId };
    else if (scopeType === 'plant') where.factoryId = scopeId; // entityId is the factory id
    const ms = await this.prisma.machine.findMany({ where, select: { id: true } });
    return ms.map((m) => m.id);
  }

  /** Confirm the scoped entity exists and (for non-super users) belongs to the caller's factory. */
  private async assertEntityInScope(actor: Actor, entityType: string, entityId: string, crossScope = false) {
    const factoryId = actor.role === 'SUPER_ADMIN' || crossScope ? null : actor.factoryId;
    const guard = factoryId ? { factoryId } : {};
    let ok = false;
    if (entityType === 'plant') ok = !!(await this.prisma.factory.findFirst({ where: { id: entityId, ...(actor.role === 'SUPER_ADMIN' ? {} : { id: actor.factoryId ?? '__none__' }) }, select: { id: true } }));
    else if (entityType === 'area') ok = !!(await this.prisma.area.findFirst({ where: { id: entityId, ...guard }, select: { id: true } }));
    else if (entityType === 'line') ok = !!(await this.prisma.productionLine.findFirst({ where: { id: entityId, ...guard }, select: { id: true } }));
    else if (entityType === 'machine') ok = !!(await this.prisma.machine.findFirst({ where: { id: entityId, ...guard }, select: { id: true } }));
    if (!ok) throw new BadRequestException(`Hierarchy ${entityType} ${entityId} not found or out of scope`);
  }

  private factoryOf(actor: Actor): string {
    if (!actor.factoryId) throw new BadRequestException('A factory context is required to create a plant dashboard');
    return actor.factoryId;
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────
  async listByEntity(actor: Actor, entityType: string, entityId: string) {
    return this.prisma.plantDashboard.findMany({
      where: { entityType, entityId, deletedAt: null, ...(actor.role === 'SUPER_ADMIN' ? {} : { factoryId: actor.factoryId ?? '__none__' }) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, entityType: true, entityId: true, status: true, version: true, updatedAt: true, backgroundImageUrl: true },
    });
  }

  /** All published dashboards (optionally filtered by entity type) for the picker index. */
  async listPublished(actor: Actor, entityType?: string) {
    return this.prisma.plantDashboard.findMany({
      where: {
        status: 'published', deletedAt: null,
        ...(entityType ? { entityType } : {}),
        ...(actor.role === 'SUPER_ADMIN' ? {} : { factoryId: actor.factoryId ?? '__none__' }),
      },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, name: true, entityType: true, entityId: true, publishedAt: true, backgroundImageUrl: true, isDefault: true },
    });
  }

  async getById(actor: Actor, id: string) {
    const d = await this.prisma.plantDashboard.findFirst({
      where: { id, deletedAt: null, ...(actor.role === 'SUPER_ADMIN' ? {} : { factoryId: actor.factoryId ?? '__none__' }) },
      include: { widgets: true },
    });
    if (!d) throw new NotFoundException('Dashboard not found');
    return d;
  }

  async create(actor: Actor, dto: CreatePlantDashboardDto) {
    await this.assertEntityInScope(actor, dto.entityType, dto.entityId);
    const factoryId = this.factoryOf(actor);
    return this.prisma.plantDashboard.create({
      data: {
        factoryId, name: dto.name, entityType: dto.entityType, entityId: dto.entityId,
        backgroundImageUrl: dto.backgroundImageUrl,
        backgroundSettings: (dto.backgroundSettings ?? {}) as Prisma.InputJsonValue,
        canvasSettings: (dto.canvasSettings ?? { width: 1920, height: 1080, grid: 10, snap: true }) as Prisma.InputJsonValue,
        createdById: actor.id, updatedById: actor.id,
        widgets: dto.widgets?.length ? { create: dto.widgets.map((w) => this.widgetData(w)) } : undefined,
      },
      include: { widgets: true },
    });
  }

  private widgetData(w: WidgetDto): Prisma.PlantDashboardWidgetCreateWithoutDashboardInput {
    return {
      widgetType: w.widgetType, title: w.title,
      x: w.x, y: w.y, width: w.width, height: w.height,
      zIndex: w.zIndex ?? 1, rotation: w.rotation ?? 0,
      locked: w.locked ?? false, visible: w.visible ?? true,
      scopeConfig: (w.scopeConfig ?? {}) as Prisma.InputJsonValue,
      dataConfig: (w.dataConfig ?? {}) as Prisma.InputJsonValue,
      displayConfig: (w.displayConfig ?? {}) as Prisma.InputJsonValue,
      refreshConfig: (w.refreshConfig ?? {}) as Prisma.InputJsonValue,
      thresholdConfig: (w.thresholdConfig ?? {}) as Prisma.InputJsonValue,
    };
  }

  /** Save the working (draft) dashboard: header/settings + full widget set (replace). */
  async update(actor: Actor, id: string, dto: UpdatePlantDashboardDto) {
    const existing = await this.getById(actor, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.plantDashboard.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.backgroundImageUrl !== undefined ? { backgroundImageUrl: dto.backgroundImageUrl } : {}),
          // MERGE background settings so the server-managed storageKey/mime survive a
          // save that only sends display keys (fit/opacity/position).
          ...(dto.backgroundSettings !== undefined
            ? { backgroundSettings: { ...((existing.backgroundSettings as object) ?? {}), ...dto.backgroundSettings } as Prisma.InputJsonValue }
            : {}),
          ...(dto.canvasSettings !== undefined ? { canvasSettings: dto.canvasSettings as Prisma.InputJsonValue } : {}),
          status: 'draft', updatedById: actor.id,
        },
      });
      if (dto.widgets) {
        // Replace this dashboard's own widget set (scoped delete → recreate, atomic).
        await tx.plantDashboardWidget.deleteMany({ where: { dashboardId: id } });
        if (dto.widgets.length) {
          await tx.plantDashboardWidget.createMany({
            data: dto.widgets.map((w) => ({ dashboardId: id, ...this.widgetData(w) })) as Prisma.PlantDashboardWidgetCreateManyInput[],
          });
        }
      }
      return tx.plantDashboard.findUnique({ where: { id }, include: { widgets: true } });
    });
  }

  async remove(actor: Actor, id: string) {
    await this.getById(actor, id);
    await this.prisma.plantDashboard.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.id } });
    return { ok: true };
  }

  // ── Publish validation ───────────────────────────────────────────────────────
  private static NEEDS_SCOPE = new Set(['kpiValue', 'multiKpi', 'oeeSummary', 'productionSummary', 'equipmentStatus', 'lineStatus', 'trendChart', 'activeAlarms']);
  private static NEEDS_KPI = new Set(['kpiValue', 'trendChart']);

  /** Structural + binding + bounds validation. Returns per-widget errors ([] = ok). */
  async validate(actor: Actor, id: string): Promise<Array<{ widgetId: string; message: string }>> {
    const d = await this.getById(actor, id);
    const canvas: any = d.canvasSettings ?? { width: 1920, height: 1080 };
    const errors: Array<{ widgetId: string; message: string }> = [];
    for (const w of d.widgets) {
      const data: any = w.dataConfig ?? {}; const scope: any = w.scopeConfig ?? {}; const disp: any = w.displayConfig ?? {};
      if (PlantDashboardsService.NEEDS_SCOPE.has(w.widgetType) && (!scope.scopeType || !scope.scopeId)) {
        errors.push({ widgetId: w.id, message: `${w.widgetType}: scope not set` });
      }
      if (PlantDashboardsService.NEEDS_KPI.has(w.widgetType) && !data.kpiCode) {
        errors.push({ widgetId: w.id, message: `${w.widgetType}: KPI not selected` });
      }
      if (w.widgetType === 'multiKpi' && !((data.kpis ?? []).some((k: any) => k.kpiCode))) {
        errors.push({ widgetId: w.id, message: 'Multi-KPI: add at least one KPI row' });
      }
      if (w.widgetType === 'navButton' && !disp.href) {
        errors.push({ widgetId: w.id, message: 'Navigation button: link not set' });
      }
      if (w.width <= 0 || w.height <= 0) errors.push({ widgetId: w.id, message: 'Invalid size' });
      if (w.x < 0 || w.y < 0 || w.x + w.width > canvas.width + 2 || w.y + w.height > canvas.height + 2) {
        errors.push({ widgetId: w.id, message: 'Card is outside the canvas' });
      }
      const iv = (w.refreshConfig as any)?.intervalSec;
      if (iv != null && (iv < 1 || iv > 3600)) errors.push({ widgetId: w.id, message: 'Refresh interval out of range' });
    }
    // Validate that referenced scope entities still exist.
    const pairs = [...new Set(d.widgets.filter((w) => (w.scopeConfig as any)?.scopeId).map((w) => `${(w.scopeConfig as any).scopeType}:${(w.scopeConfig as any).scopeId}`))];
    for (const p of pairs) {
      const [type, sid] = p.split(':');
      const ok = await this.entityExists(actor, type, sid);
      if (!ok) for (const w of d.widgets) if ((w.scopeConfig as any)?.scopeId === sid) errors.push({ widgetId: w.id, message: `Scope ${type} no longer exists` });
    }
    return errors;
  }

  private async entityExists(actor: Actor, type: string, id: string): Promise<boolean> {
    const guard = actor.role === 'SUPER_ADMIN' ? {} : { factoryId: actor.factoryId ?? '__none__' };
    if (type === 'plant') return !!(await this.prisma.factory.findFirst({ where: { id }, select: { id: true } }));
    if (type === 'area') return !!(await this.prisma.area.findFirst({ where: { id, ...guard }, select: { id: true } }));
    if (type === 'line') return !!(await this.prisma.productionLine.findFirst({ where: { id, ...guard }, select: { id: true } }));
    if (type === 'machine') return !!(await this.prisma.machine.findFirst({ where: { id, ...guard }, select: { id: true } }));
    return false;
  }

  /** Publish: snapshot the current draft (settings + widgets) into publishedSnapshot. */
  async publish(actor: Actor, id: string) {
    const errors = await this.validate(actor, id);
    if (errors.length) {
      throw new BadRequestException({ message: 'Dashboard has validation errors', errors });
    }
    const d = await this.getById(actor, id);
    const snapshot = {
      backgroundImageUrl: d.backgroundImageUrl,
      backgroundSettings: d.backgroundSettings,
      canvasSettings: d.canvasSettings,
      widgets: d.widgets,
      capturedAt: new Date().toISOString(),
    };
    return this.prisma.plantDashboard.update({
      where: { id },
      data: {
        status: 'published',
        publishedSnapshot: snapshot as Prisma.InputJsonValue,
        publishedVersion: (d.version ?? 1),
        publishedAt: new Date(),
        version: (d.version ?? 1) + 1,
        updatedById: actor.id,
      },
    });
  }

  async duplicate(actor: Actor, id: string) {
    const d = await this.getById(actor, id);
    return this.prisma.plantDashboard.create({
      data: {
        factoryId: d.factoryId, name: `${d.name} (copy)`, entityType: d.entityType, entityId: d.entityId,
        backgroundImageUrl: d.backgroundImageUrl,
        backgroundSettings: (d.backgroundSettings ?? {}) as Prisma.InputJsonValue,
        canvasSettings: (d.canvasSettings ?? {}) as Prisma.InputJsonValue,
        status: 'draft', createdById: actor.id, updatedById: actor.id,
        widgets: { create: d.widgets.map((w) => this.widgetData(w as unknown as WidgetDto)) },
      },
      include: { widgets: true },
    });
  }

  /** Read-only published dashboard for the Live View. */
  async getPublished(actor: Actor, entityType: string, entityId: string) {
    const d = await this.prisma.plantDashboard.findFirst({
      where: {
        entityType, entityId, status: 'published', deletedAt: null,
        ...(actor.role === 'SUPER_ADMIN' ? {} : { factoryId: actor.factoryId ?? '__none__' }),
      },
      orderBy: { publishedAt: 'desc' },
    });
    if (!d) throw new NotFoundException('No published dashboard for this entity');
    return { id: d.id, name: d.name, entityType: d.entityType, entityId: d.entityId, ...(d.publishedSnapshot as object) };
  }

  // ── Default landing view (one per factory) ─────────────────────────────────
  /** Mark a published dashboard as the factory's default landing live view. */
  async setDefault(actor: Actor, id: string) {
    const d = await this.getById(actor, id);
    if (d.status !== 'published') throw new BadRequestException('Only a published dashboard can be the default view');
    await this.prisma.$transaction([
      this.prisma.plantDashboard.updateMany({ where: { factoryId: d.factoryId, isDefault: true }, data: { isDefault: false } }),
      this.prisma.plantDashboard.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { ok: true };
  }

  async clearDefault(actor: Actor, id: string) {
    await this.getById(actor, id);
    await this.prisma.plantDashboard.update({ where: { id }, data: { isDefault: false } });
    return { ok: true };
  }

  /** The factory's default landing view (entity to route to), or null. */
  async getDefault(actor: Actor) {
    const d = await this.prisma.plantDashboard.findFirst({
      where: {
        isDefault: true, status: 'published', deletedAt: null,
        ...(actor.role === 'SUPER_ADMIN' ? {} : { factoryId: actor.factoryId ?? '__none__' }),
      },
      select: { id: true, name: true, entityType: true, entityId: true },
    });
    return d ?? null;
  }

  // ── Metadata endpoints ─────────────────────────────────────────────────────
  kpiCatalog() { return KPI_CATALOG; }

  /** Hierarchy options for the scope pickers (factory → areas → lines → machines). */
  async scopeOptions(actor: Actor) {
    const factoryWhere = actor.role === 'SUPER_ADMIN' ? { isActive: true } : { id: actor.factoryId ?? '__none__', isActive: true };
    const factories = await this.prisma.factory.findMany({
      where: factoryWhere,
      select: {
        id: true, code: true, name: true,
        areas: {
          where: { isActive: true },
          select: {
            id: true, code: true, name: true,
            productionLines: {
              where: { isActive: true },
              select: {
                id: true, code: true, name: true,
                machines: { where: { isActive: true }, select: { id: true, code: true, name: true } },
              },
            },
          },
        },
      },
    });
    return factories;
  }

  // ── Live data (batched) ────────────────────────────────────────────────────
  /**
   * The window a card asks for, and how far its committed slot reaches.
   *
   * `slotTo` is not `to`. `to` is now, because rows only exist once time has
   * passed; the schedule basis needs the opposite bound, since the part of a
   * slot an order has not reached yet is what makes that reading climb to true.
   *
   * Left unset, the KPI layer guessed it as the end of the plant day — and for
   * a card set to `shift` that put the slot end at 23:59 on a shift ending at
   * 07:30, so Availability read 0.1% on a running line and OEE read 0%.
   */
  private windowFor(timeRange?: string): Promise<{ from: Date; to: Date; slotTo: Date }> | { from: Date; to: Date; slotTo: Date } {
    const now = new Date();
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    switch ((timeRange ?? 'today').toLowerCase()) {
      case 'shift':
        return (async () => {
          const shift = await currentShiftWindow(this.prisma, null).catch(() => null);
          const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
          // The slot a shift's orders were committed to runs to the END of the shift.
          return { from: shift?.start ?? startToday, to: now, slotTo: shift?.end ?? endToday };
        })();
      case 'week': { const f = new Date(now); f.setDate(f.getDate() - 7); return { from: f, to: now, slotTo: endOfToday(now) }; }
      case 'month': { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: f, to: now, slotTo: endOfToday(now) }; }
      case 'current':
      case 'today':
      default: return { from: startToday, to: now, slotTo: endOfToday(now) };
    }
  }

  async liveData(actor: Actor, subscriptions: LiveSubscriptionDto[]) {
    const factoryId = actor.role === 'SUPER_ADMIN' ? null : actor.factoryId;
    const results = await Promise.all(subscriptions.map(async (s) => {
      try {
        const machineIds = await this.resolveMachineIds(factoryId, s.scopeType, s.scopeId);
        const now = () => new Date().toISOString();
        // STATE is a string channel (for equipment/line status cards), not a numeric KPI.
        if (s.kpiCode === 'STATE') {
          return { widgetId: s.widgetId, kpiCode: 'STATE', text: await this.resolveState(machineIds), at: now(), quality: 'GOOD' as const };
        }
        // ALARMS returns a list; TREND:<metric> returns a time series.
        if (s.kpiCode === 'ALARMS') {
          return { widgetId: s.widgetId, kpiCode: 'ALARMS', alarms: await this.resolveAlarms(factoryId, machineIds), at: now(), quality: 'GOOD' as const };
        }
        if (s.kpiCode.startsWith('TREND')) {
          const metric = s.kpiCode.split(':')[1] || 'OEE';
          const win = await this.windowFor(s.timeRange);
          return { widgetId: s.widgetId, kpiCode: s.kpiCode, series: await this.resolveTrend(factoryId, metric, machineIds, win, s.timeRange, s.scopeType, s.scopeId), at: now(), quality: 'GOOD' as const };
        }
        if (!KPI_CODES.has(s.kpiCode)) return { widgetId: s.widgetId, error: `Unknown KPI ${s.kpiCode}` };
        const win = await this.windowFor(s.timeRange);
        const value = await this.resolveKpi(factoryId, s.kpiCode, s.scopeType, s.scopeId, machineIds, win);
        return { widgetId: s.widgetId, kpiCode: s.kpiCode, value, at: new Date().toISOString(), quality: 'GOOD' as const };
      } catch (e) {
        return { widgetId: s.widgetId, kpiCode: s.kpiCode, error: (e as Error).message, quality: 'BAD' as const };
      }
    }));
    return { data: results, at: new Date().toISOString() };
  }

  /** Aggregate machine state for a scope: BREAKDOWN if any down, else RUNNING if any
   *  running, else the most common remaining state (IDLE/OFFLINE/…). */
  private async resolveState(machineIds: string[]): Promise<string> {
    if (!machineIds.length) return 'DISCONNECTED';
    const rows = await this.prisma.machineCurrentStatus.findMany({
      where: { machineId: { in: machineIds } }, select: { state: true },
    });
    if (!rows.length) return 'DISCONNECTED';
    const states = rows.map((r) => r.state as string);
    if (states.includes('BREAKDOWN')) return 'BREAKDOWN';
    if (states.includes('RUNNING')) return 'RUNNING';
    const counts = new Map<string, number>();
    for (const s of states) counts.set(s, (counts.get(s) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] ?? 'IDLE';
  }

  /** Active (unresolved) alarms for the scope — most severe/recent first. */
  private async resolveAlarms(factoryId: string | null, machineIds: string[]) {
    const rows = await this.prisma.alarmEvent.findMany({
      where: { ...(factoryId ? { factoryId } : {}), resolvedAt: null, ...(machineIds.length ? { machineId: { in: machineIds } } : {}) },
      orderBy: [{ severity: 'desc' }, { triggeredAt: 'desc' }],
      take: 8,
      include: { machine: { select: { code: true, name: true } } },
    });
    return rows.map((a) => ({
      id: a.id, severity: a.severity, message: a.description,
      machine: a.machine?.code ?? a.machine?.name ?? '',
      at: a.triggeredAt.toISOString(), acknowledged: !!a.acknowledgedAt,
    }));
  }

  private static TREND_FIELD: Record<string, string> = {
    OEE: 'oee', OEE_TB: 'oeeTb', AVAILABILITY: 'availability', AVAILABILITY_TB: 'availabilityTb',
    PERFORMANCE: 'performance', QUALITY: 'quality',
    TOTAL_PRODUCTION: 'output', GOOD_COUNT: 'good', REJECT_COUNT: 'scrap', DOWNTIME: 'down',
  };

  /** Time series for a metric over the window (points for the trend-chart card).
   *  Each KPI plots its OWN metric — not just OEE. */
  private async resolveTrend(
    factoryId: string | null, metric: string, machineIds: string[],
    win: { from: Date; to: Date; slotTo: Date }, timeRange?: string, scopeType?: string, scopeId?: string,
  ): Promise<Array<{ x: string; y: number }>> {
    // Energy has its own daily series from the energy service.
    if (metric === 'ENERGY_CONSUMPTION') {
      const scope = scopeType === 'machine' ? { machineId: scopeId! }
        : scopeType === 'line' ? { lineId: scopeId! }
        : scopeType === 'area' ? { areaId: scopeId! } : undefined;
      const e = await this.energy.getOverview(factoryId, scope).catch(() => null);
      return (e?.trend ?? []).map((t: any) => ({ x: t.date, y: Math.round((t.value ?? 0) * 10) / 10 }));
    }
    const field = PlantDashboardsService.TREND_FIELD[metric];
    if (!field) return []; // SPEED and unknowns have no historical series → card shows "No data"
    const bucket: 'hour' | 'day' = ['week', 'month'].includes((timeRange ?? '').toLowerCase()) ? 'day' : 'hour';
    const a = await this.kpi.oeeAnalytics(factoryId, win.from, win.to, machineIds.length ? machineIds : undefined, bucket);
    return (a.trend ?? []).map((t: any) => ({ x: t.period, y: Math.round(((t[field] ?? 0) as number) * 10) / 10 }));
  }

  private async resolveKpi(
    factoryId: string | null, code: string, scopeType: string, scopeId: string,
    machineIds: string[], win: { from: Date; to: Date; slotTo: Date },
  ): Promise<number> {
    const ids = machineIds.length ? machineIds : undefined;
    switch (code) {
      case 'OEE': case 'AVAILABILITY': case 'PERFORMANCE': case 'QUALITY':
      case 'OEE_TB': case 'AVAILABILITY_TB': case 'TOTAL_PRODUCTION': case 'GOOD_COUNT': case 'DOWNTIME': {
        const a = await this.kpi.oeeAnalytics(factoryId, win.from, win.to, ids, 'hour', { slotTo: win.slotTo });
        switch (code) {
          case 'OEE': return a.current.oee;
          case 'AVAILABILITY': return a.current.availability;
          case 'PERFORMANCE': return a.current.performance;
          case 'QUALITY': return a.current.quality;
          case 'OEE_TB': return a.current.oeeTb;
          case 'AVAILABILITY_TB': return a.current.availabilityTb;
          case 'TOTAL_PRODUCTION': return Math.round(a.totalOutput);
          case 'GOOD_COUNT': return Math.round(a.goodOutput);
          case 'DOWNTIME': return Math.round(a.downtimeMin ?? 0);
        }
        return 0;
      }
      case 'REJECT_COUNT': {
        const a = await this.kpi.oeeAnalytics(factoryId, win.from, win.to, ids, 'hour');
        return Math.max(0, Math.round(a.totalOutput - a.goodOutput));
      }
      case 'ACTIVE_ALARMS':
        return this.prisma.alarmEvent.count({
          where: { ...(factoryId ? { factoryId } : {}), resolvedAt: null, ...(ids ? { machineId: { in: ids } } : {}) },
        });
      case 'SPEED': {
        /**
         * Current speed, from the minutes actually measured.
         *
         * It used to sum `machineCurrentStatus.actualSpeed`, which is NULL for
         * every machine on this plant — nothing has ever written it — so the
         * widget read 0 on a line that was running, and read it confidently.
         *
         * A rate needs a window: the last fifteen minutes of the one store.
         * Short enough to mean "now" on a card that says Current, long enough
         * that a machine between cartons does not read zero.
         */
        if (!ids || ids.length === 0) return 0;
        const since = new Date(Date.now() - 15 * 60_000);
        const [row] = await this.prisma.$queryRaw<Array<{ parts: number; mins: number }>>(Prisma.sql`
          SELECT COALESCE(SUM(o."goodParts" + o."rejectedParts"), 0)::float8 AS parts,
                 COALESCE(SUM(o."operatingMin"), 0)::float8                  AS mins
          FROM oee_minutes o
          WHERE o."machineId" IN (${Prisma.join(ids)})
            AND o."bucketStart" >= ${since}
        `);
        // Per RUNNING minute, not per wall-clock minute: a machine stopped for
        // ten of the fifteen was not running slowly, it was stopped — and the
        // state indicator beside this number already says so.
        const mins = row?.mins ?? 0;
        return mins > 0 ? Math.round(((row?.parts ?? 0) / mins) * 60) : 0;
      }
      case 'ENERGY_CONSUMPTION': {
        const scope = scopeType === 'machine' ? { machineId: scopeId }
          : scopeType === 'line' ? { lineId: scopeId }
          : scopeType === 'area' ? { areaId: scopeId } : undefined;
        const e = await this.energy.getOverview(factoryId, scope).catch(() => null);
        return e?.totalConsumptionToday ?? 0;
      }
      default: return 0;
    }
  }
}
