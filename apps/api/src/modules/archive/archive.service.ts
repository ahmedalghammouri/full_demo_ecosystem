import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ARCHIVE_ENTITIES, resolveArchiveEntity, type ArchiveEntityDef } from './archive.registry';

@Injectable()
export class ArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  private def(slug: string): ArchiveEntityDef {
    const def = resolveArchiveEntity(slug);
    if (!def) throw new BadRequestException(`'${slug}' is not an archivable entity`);
    return def;
  }

  private delegate(def: ArchiveEntityDef): any {
    const d = (this.prisma as any)[def.delegate];
    if (!d) throw new BadRequestException(`Entity '${def.slug}' is not available`);
    return d;
  }

  private scopeWhere(def: ArchiveEntityDef, factoryId: string | null) {
    return def.factoryScoped && factoryId ? { factoryId } : {};
  }

  /** The catalogue of archivable entities (for the UI to build its picker). */
  listEntities() {
    return Object.values(ARCHIVE_ENTITIES).map((e) => ({ slug: e.slug, label: e.label }));
  }

  /** Browse ARCHIVED rows of an entity (archivedAt != null). */
  async listArchived(factoryId: string | null, slug: string, filters: { search?: string; page?: number; limit?: number }) {
    const def = this.def(slug);
    const { search, page = 1, limit = 20 } = filters;
    const where: any = {
      ...this.scopeWhere(def, factoryId),
      archivedAt: { not: null },
      ...(search && def.searchFields.length
        ? { OR: def.searchFields.map((f) => ({ [f]: { contains: search, mode: 'insensitive' } })) }
        : {}),
    };

    const delegate = this.delegate(def);
    const [total, rows] = await Promise.all([
      delegate.count({ where }),
      delegate.findMany({ where, orderBy: { archivedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);

    return {
      entity: def.slug,
      label: def.label,
      data: rows.map((r: any) => ({
        id: r.id,
        primary: r[def.primaryField] ?? r.id,
        secondary: def.secondaryField ? r[def.secondaryField] ?? null : null,
        archivedAt: r.archivedAt,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  /** Counts of archived rows per entity — for badges / the archive landing page. */
  async counts(factoryId: string | null) {
    const out: Record<string, number> = {};
    await Promise.all(Object.values(ARCHIVE_ENTITIES).map(async (def) => {
      try {
        out[def.slug] = await this.delegate(def).count({
          where: { ...this.scopeWhere(def, factoryId), archivedAt: { not: null } },
        });
      } catch { out[def.slug] = 0; }
    }));
    return out;
  }

  async archive(factoryId: string | null, slug: string, id: string) {
    return this.setArchived(factoryId, slug, [id], true);
  }
  async restore(factoryId: string | null, slug: string, id: string) {
    return this.setArchived(factoryId, slug, [id], false);
  }
  async bulkArchive(factoryId: string | null, slug: string, ids: string[]) {
    return this.setArchived(factoryId, slug, ids, true);
  }
  async bulkRestore(factoryId: string | null, slug: string, ids: string[]) {
    return this.setArchived(factoryId, slug, ids, false);
  }

  private async setArchived(factoryId: string | null, slug: string, ids: string[], archived: boolean) {
    const def = this.def(slug);
    if (!ids?.length) throw new BadRequestException('No ids provided');
    const delegate = this.delegate(def);
    // Guard: only touch rows within the caller's factory scope.
    const where = { id: { in: ids }, ...this.scopeWhere(def, factoryId) };
    const existing = await delegate.count({ where });
    if (existing === 0) throw new NotFoundException('No matching records found');
    const result = await delegate.updateMany({
      where,
      data: { archivedAt: archived ? new Date() : null },
    });
    return { entity: def.slug, archived, count: result.count };
  }
}
