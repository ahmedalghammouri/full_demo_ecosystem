import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { GrafanaService } from './grafana.service';
import {
  CreateDashboardDto, UpdateDashboardDto, ListDashboardsQueryDto,
  CreateCategoryDto, GrantPermissionDto, EmbedQueryDto,
  DashboardSource, DashboardVisibility, DashboardPermissionLevel,
} from './dto/dashboard.dto';

/** The shape attached to request.user by JwtStrategy. */
export interface RequestUser {
  id: string;
  role: UserRole;
  factoryId: string | null;
  factoryCode?: string | null;
  enterpriseId?: string | null;
  email?: string;
  name?: string;
}

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grafana: GrafanaService,
  ) {}

  private isSuperAdmin(user: RequestUser): boolean {
    return user.role === UserRole.SUPER_ADMIN;
  }

  private isAdmin(user: RequestUser): boolean {
    const admins: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.FACTORY_ADMIN, UserRole.PLANT_MANAGER];
    return admins.includes(user.role);
  }

  /** Prisma OR-clauses describing what a user is allowed to see. */
  private visibilityWhere(user: RequestUser): Prisma.DashboardWhereInput {
    if (this.isSuperAdmin(user)) return {};
    return {
      AND: [
        // Factory scope: global dashboards (null factory) + own factory only
        { OR: [{ factoryId: null }, { factoryId: user.factoryId }] },
        // Visibility / explicit grant
        {
          OR: [
            { visibility: DashboardVisibility.PUBLIC },
            { visibility: DashboardVisibility.ENTERPRISE },
            {
              visibility: DashboardVisibility.FACTORY,
              OR: [{ factoryId: user.factoryId }, { factoryId: null }],
            },
            { visibility: DashboardVisibility.PRIVATE, createdById: user.id },
            {
              permissions: {
                some: { OR: [{ userId: user.id }, { role: user.role }] },
              },
            },
          ],
        },
      ],
    };
  }

  // ──────────────────────────────────────────────────────────────
  // CATALOG — list / search / filter
  // ──────────────────────────────────────────────────────────────

  async list(user: RequestUser, query: ListDashboardsQueryDto) {
    const wantFavorites = query.favorites === 'true';
    const wantTemplates = query.templates === 'true';

    const filters: Prisma.DashboardWhereInput = {
      deletedAt: null,
      isPublished: true,
      isTemplate: wantTemplates ? true : false,
      /**
       * Custom (Grafana) dashboards are not part of the catalogue.
       *
       * Excluded HERE and not only in the UI, because the filter chip was only
       * ever a filter: with it removed the 63 rows in this database would have
       * stayed visible under "All Sources", and the removal would have been
       * cosmetic. Excluding at the query means it holds for any database the
       * image is deployed against, which is what shipping it with the build
       * has to mean.
       *
       * The rows are left in place rather than deleted: they carry somebody's
       * saved panels, and hiding a catalogue entry is reversible where dropping
       * it is not.
       */
      source: { not: DashboardSource.GRAFANA },
    };

    // A caller asking for GRAFANA explicitly gets nothing — not "everything
    // else". Dropping the filter and letting the exclusion above stand returned
    // all 20 remaining rows, which reads as though the request was ignored.
    // `list` returns an ARRAY; an object here type-checks only because the
    // return type is inferred as a union, and would have reached the client as
    // a shape nothing renders.
    if (query.source === DashboardSource.GRAFANA) return [];
    if (query.source) filters.source = query.source;
    if (query.type) filters.type = query.type as never;

    if (query.category) {
      // accept either category id or key
      const cat = await this.prisma.dashboardCategory.findFirst({
        where: { OR: [{ id: query.category }, { key: query.category }] },
        select: { id: true },
      });
      filters.categoryId = cat?.id ?? '__none__';
    }

    if (query.search) {
      const s = query.search;
      filters.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { tags: { has: s.toLowerCase() } },
      ];
    }

    if (query.tags) {
      const tagList = query.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (tagList.length) filters.tags = { hasSome: tagList };
    }

    if (wantFavorites) {
      filters.favorites = { some: { userId: user.id } };
    }

    const where: Prisma.DashboardWhereInput = {
      AND: [filters, this.visibilityWhere(user)],
    };

    const rows = await this.prisma.dashboard.findMany({
      where,
      include: {
        category: { select: { id: true, key: true, name: true, icon: true, color: true } },
        favorites: { where: { userId: user.id }, select: { id: true } },
        _count: { select: { favorites: true } },
      },
      orderBy: [{ viewCount: 'desc' }, { title: 'asc' }],
      take: 500,
    });

    return rows.map((d) => this.toCatalogItem(d, user));
  }

  async getById(user: RequestUser, id: string) {
    const d = await this.prisma.dashboard.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: { select: { id: true, key: true, name: true, icon: true, color: true } },
        favorites: { where: { userId: user.id }, select: { id: true } },
        permissions: true,
        _count: { select: { favorites: true } },
      },
    });
    if (!d) throw new NotFoundException('Dashboard not found');
    if (!(await this.canView(user, d))) throw new ForbiddenException('No access to this dashboard');
    return this.toCatalogItem(d, user, true);
  }

  // ──────────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────────

  async create(user: RequestUser, dto: CreateDashboardDto) {
    let categoryId = dto.categoryId;
    if (categoryId) categoryId = await this.resolveCategoryId(categoryId);

    const dashboard = await this.prisma.dashboard.create({
      data: {
        factoryId: dto.visibility === DashboardVisibility.ENTERPRISE ? null : user.factoryId,
        enterpriseId: user.enterpriseId ?? null,
        categoryId,
        slug: dto.title ? slugify(dto.title) : null,
        title: dto.title,
        titleAr: dto.titleAr,
        description: dto.description,
        source: dto.source as never,
        type: (dto.type ?? 'OPERATIONAL') as never,
        visibility: (dto.visibility ?? DashboardVisibility.FACTORY) as never,
        route: dto.route,
        externalUrl: dto.externalUrl,
        grafanaUid: dto.grafanaUid,
        grafanaSlug: dto.grafanaSlug,
        grafanaOrgId: dto.grafanaOrgId,
        grafanaFolder: dto.grafanaFolder,
        icon: dto.icon,
        thumbnailUrl: dto.thumbnailUrl,
        tags: (dto.tags ?? []).map((t) => t.toLowerCase()),
        isFactoryAware: dto.isFactoryAware ?? true,
        supportedScopes: dto.supportedScopes ?? [],
        defaultTimeRange: dto.defaultTimeRange ?? 'now-24h',
        refreshInterval: dto.refreshInterval ?? '30s',
        isTemplate: dto.isTemplate ?? false,
        isSystem: false,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    return dashboard;
  }

  async update(user: RequestUser, id: string, dto: UpdateDashboardDto) {
    const existing = await this.requireManage(user, id);
    if (existing.isSystem && !this.isSuperAdmin(user)) {
      throw new ForbiddenException('System dashboards cannot be edited');
    }
    let categoryId = dto.categoryId;
    if (categoryId) categoryId = await this.resolveCategoryId(categoryId);

    return this.prisma.dashboard.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title, slug: slugify(dto.title) }),
        ...(dto.titleAr !== undefined && { titleAr: dto.titleAr }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type as never }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility as never }),
        ...(categoryId !== undefined && { categoryId }),
        ...(dto.route !== undefined && { route: dto.route }),
        ...(dto.externalUrl !== undefined && { externalUrl: dto.externalUrl }),
        ...(dto.grafanaUid !== undefined && { grafanaUid: dto.grafanaUid }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.thumbnailUrl !== undefined && { thumbnailUrl: dto.thumbnailUrl }),
        ...(dto.tags !== undefined && { tags: dto.tags.map((t) => t.toLowerCase()) }),
        ...(dto.isFactoryAware !== undefined && { isFactoryAware: dto.isFactoryAware }),
        ...(dto.supportedScopes !== undefined && { supportedScopes: dto.supportedScopes }),
        ...(dto.defaultTimeRange !== undefined && { defaultTimeRange: dto.defaultTimeRange }),
        ...(dto.refreshInterval !== undefined && { refreshInterval: dto.refreshInterval }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
        updatedById: user.id,
      },
    });
  }

  async remove(user: RequestUser, id: string) {
    const existing = await this.requireManage(user, id);
    if (existing.isSystem) throw new ForbiddenException('System dashboards cannot be deleted');
    await this.prisma.dashboard.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** Clone a template (or any viewable dashboard) into a new private dashboard owned by the user. */
  async cloneTemplate(user: RequestUser, id: string) {
    const src = await this.prisma.dashboard.findFirst({ where: { id, deletedAt: null } });
    if (!src) throw new NotFoundException('Template not found');
    if (!(await this.canView(user, src))) throw new ForbiddenException('No access');

    return this.prisma.dashboard.create({
      data: {
        factoryId: user.factoryId,
        enterpriseId: user.enterpriseId ?? null,
        categoryId: src.categoryId,
        slug: slugify(`${src.title}-copy`),
        title: `${src.title} (Copy)`,
        titleAr: src.titleAr,
        description: src.description,
        source: src.source,
        type: src.type,
        visibility: DashboardVisibility.PRIVATE as never,
        route: src.route,
        externalUrl: src.externalUrl,
        grafanaUid: src.grafanaUid,
        grafanaSlug: src.grafanaSlug,
        grafanaOrgId: src.grafanaOrgId,
        grafanaFolder: src.grafanaFolder,
        icon: src.icon,
        thumbnailUrl: src.thumbnailUrl,
        tags: src.tags,
        isFactoryAware: src.isFactoryAware,
        supportedScopes: src.supportedScopes,
        defaultTimeRange: src.defaultTimeRange,
        refreshInterval: src.refreshInterval,
        isTemplate: false,
        templateOfId: src.id,
        isSystem: false,
        createdById: user.id,
        updatedById: user.id,
      },
    });
  }

  // ──────────────────────────────────────────────────────────────
  // FAVORITES
  // ──────────────────────────────────────────────────────────────

  async toggleFavorite(user: RequestUser, id: string) {
    const d = await this.prisma.dashboard.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw new NotFoundException('Dashboard not found');
    if (!(await this.canView(user, d))) throw new ForbiddenException('No access');

    const existing = await this.prisma.dashboardFavorite.findUnique({
      where: { dashboardId_userId: { dashboardId: id, userId: user.id } },
    });
    if (existing) {
      await this.prisma.dashboardFavorite.delete({ where: { id: existing.id } });
      return { favorite: false };
    }
    await this.prisma.dashboardFavorite.create({ data: { dashboardId: id, userId: user.id } });
    return { favorite: true };
  }

  // ──────────────────────────────────────────────────────────────
  // CATEGORIES
  // ──────────────────────────────────────────────────────────────

  async listCategories(user: RequestUser) {
    const cats = await this.prisma.dashboardCategory.findMany({
      where: { OR: [{ factoryId: null }, { factoryId: user.factoryId }] },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            dashboards: { where: { deletedAt: null, isPublished: true, isTemplate: false } },
          },
        },
      },
    });
    return cats.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      nameAr: c.nameAr,
      icon: c.icon,
      color: c.color,
      sortOrder: c.sortOrder,
      isSystem: c.isSystem,
      dashboardCount: c._count.dashboards,
    }));
  }

  async createCategory(user: RequestUser, dto: CreateCategoryDto) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Only admins can create categories');
    const key = dto.key ? slugify(dto.key) : slugify(dto.name);
    return this.prisma.dashboardCategory.create({
      data: {
        factoryId: user.factoryId,
        key, name: dto.name, nameAr: dto.nameAr, description: dto.description,
        icon: dto.icon, color: dto.color, sortOrder: dto.sortOrder ?? 0, isSystem: false,
      },
    });
  }

  // ──────────────────────────────────────────────────────────────
  // PERMISSIONS
  // ──────────────────────────────────────────────────────────────

  async listPermissions(user: RequestUser, id: string) {
    await this.requireManage(user, id);
    return this.prisma.dashboardPermission.findMany({ where: { dashboardId: id } });
  }

  async grantPermission(user: RequestUser, id: string, dto: GrantPermissionDto) {
    await this.requireManage(user, id);
    if (!dto.role && !dto.userId) throw new BadRequestException('Provide either role or userId');
    if (dto.role && dto.userId) throw new BadRequestException('Provide only one of role or userId');

    return this.prisma.dashboardPermission.create({
      data: {
        dashboardId: id,
        role: dto.role ? (dto.role as UserRole) : null,
        userId: dto.userId ?? null,
        level: dto.level as never,
      },
    });
  }

  async revokePermission(user: RequestUser, id: string, permissionId: string) {
    await this.requireManage(user, id);
    await this.prisma.dashboardPermission.deleteMany({ where: { id: permissionId, dashboardId: id } });
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────
  // EMBED / LAUNCH — resolves how to open a dashboard with factory context
  // ──────────────────────────────────────────────────────────────

  async getEmbed(user: RequestUser, id: string, q: EmbedQueryDto) {
    const d = await this.prisma.dashboard.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw new NotFoundException('Dashboard not found');
    if (!(await this.canView(user, d))) throw new ForbiddenException('No access to this dashboard');

    // Record the view (non-blocking semantics, but awaited for simplicity).
    await this.prisma.dashboard.update({
      where: { id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });

    // Resolve factory context: explicit override → user's factory.
    const factoryId = q.factoryId ?? user.factoryId ?? null;
    let factoryCode = user.factoryCode ?? null;
    if (factoryId && factoryId !== user.factoryId) {
      const f = await this.prisma.factory.findUnique({ where: { id: factoryId }, select: { code: true } });
      factoryCode = f?.code ?? null;
    }

    const context = {
      factoryId, factoryCode,
      areaId: q.areaId ?? null, lineId: q.lineId ?? null, machineId: q.machineId ?? null,
      shiftId: q.shiftId ?? null, productId: q.productId ?? null, batchId: q.batchId ?? null,
      from: q.from ?? null, to: q.to ?? null, theme: q.theme ?? null,
    };

    if (d.source === DashboardSource.GRAFANA) {
      const url = this.grafana.buildEmbedUrl(d, context);
      return {
        kind: 'grafana' as const,
        embeddable: !!url,
        url,
        grafanaConfigured: this.grafana.isConfigured(),
        dashboard: this.publicShape(d),
        context,
      };
    }

    if (d.source === DashboardSource.Industry360_NATIVE || d.source === DashboardSource.REPORT) {
      return {
        kind: 'native' as const,
        embeddable: false,
        route: d.route,
        dashboard: this.publicShape(d),
        context,
      };
    }

    if (d.source === DashboardSource.EXTERNAL) {
      const url = this.appendContext(d.externalUrl, context, d);
      return { kind: 'external' as const, embeddable: true, url, dashboard: this.publicShape(d), context };
    }

    // TEMPLATE
    return { kind: 'template' as const, embeddable: false, dashboard: this.publicShape(d), context };
  }

  // ──────────────────────────────────────────────────────────────
  // GRAFANA discovery (for admins importing dashboards into the catalog)
  // ──────────────────────────────────────────────────────────────

  async listGrafanaDashboards(user: RequestUser, query?: string, tag?: string) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Only admins can browse Grafana');
    const items = await this.grafana.searchDashboards(query, tag);
    return { configured: this.grafana.isApiEnabled(), items };
  }

  async grafanaHealth() {
    return this.grafana.health();
  }

  // ──────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────

  private async canView(user: RequestUser, d: { factoryId: string | null; visibility: string; createdById: string | null; id: string }): Promise<boolean> {
    if (this.isSuperAdmin(user)) return true;
    if (d.factoryId && d.factoryId !== user.factoryId) {
      // factory-specific dashboard from another factory — only via explicit grant
    } else {
      if (d.visibility === DashboardVisibility.PUBLIC) return true;
      if (d.visibility === DashboardVisibility.ENTERPRISE) return true;
      if (d.visibility === DashboardVisibility.FACTORY) return true;
      if (d.visibility === DashboardVisibility.PRIVATE && d.createdById === user.id) return true;
    }
    const grant = await this.prisma.dashboardPermission.findFirst({
      where: { dashboardId: d.id, OR: [{ userId: user.id }, { role: user.role }] },
    });
    return !!grant;
  }

  /** Ensure the user can manage (edit/delete/permission) a dashboard. */
  private async requireManage(user: RequestUser, id: string) {
    const d = await this.prisma.dashboard.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw new NotFoundException('Dashboard not found');
    if (this.isSuperAdmin(user)) return d;
    if (d.createdById === user.id) return d;
    if (this.isAdmin(user) && (d.factoryId === user.factoryId || d.factoryId === null)) return d;
    const grant = await this.prisma.dashboardPermission.findFirst({
      where: {
        dashboardId: id,
        level: { in: [DashboardPermissionLevel.MANAGE] as never },
        OR: [{ userId: user.id }, { role: user.role }],
      },
    });
    if (!grant) throw new ForbiddenException('You cannot manage this dashboard');
    return d;
  }

  private async resolveCategoryId(idOrKey: string): Promise<string | undefined> {
    const cat = await this.prisma.dashboardCategory.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey }] }, select: { id: true },
    });
    return cat?.id;
  }

  private appendContext(url: string | null, ctx: { factoryId: string | null; factoryCode: string | null }, d: { isFactoryAware: boolean }): string | null {
    if (!url) return null;
    if (!d.isFactoryAware || (!ctx.factoryId && !ctx.factoryCode)) return url;
    const sep = url.includes('?') ? '&' : '?';
    const params = new URLSearchParams();
    if (ctx.factoryCode) params.set('factory', ctx.factoryCode);
    if (ctx.factoryId) params.set('factoryId', ctx.factoryId);
    return `${url}${sep}${params.toString()}`;
  }

  private publicShape(d: Record<string, any>) {
    return {
      id: d.id, title: d.title, titleAr: d.titleAr, description: d.description,
      source: d.source, type: d.type, icon: d.icon, route: d.route,
      isFactoryAware: d.isFactoryAware, supportedScopes: d.supportedScopes,
      defaultTimeRange: d.defaultTimeRange, refreshInterval: d.refreshInterval,
      grafanaUid: d.grafanaUid,
    };
  }

  private toCatalogItem(d: Record<string, any>, user: RequestUser, detailed = false) {
    return {
      id: d.id,
      title: d.title,
      titleAr: d.titleAr,
      description: d.description,
      source: d.source,
      type: d.type,
      visibility: d.visibility,
      category: d.category
        ? { id: d.category.id, key: d.category.key, name: d.category.name, icon: d.category.icon, color: d.category.color }
        : null,
      route: d.route,
      externalUrl: d.externalUrl,
      grafanaUid: d.grafanaUid,
      icon: d.icon,
      thumbnailUrl: d.thumbnailUrl,
      tags: d.tags ?? [],
      isFactoryAware: d.isFactoryAware,
      supportedScopes: d.supportedScopes ?? [],
      isTemplate: d.isTemplate,
      isSystem: d.isSystem,
      isFavorite: Array.isArray(d.favorites) ? d.favorites.length > 0 : false,
      favoriteCount: d._count?.favorites ?? 0,
      viewCount: d.viewCount ?? 0,
      canManage: this.isSuperAdmin(user) || d.createdById === user.id
        || (this.isAdmin(user) && (d.factoryId === user.factoryId || d.factoryId === null)),
      ...(detailed && { permissions: d.permissions ?? [] }),
    };
  }
}
