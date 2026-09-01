import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ECOSYSTEM_MODULES, LAYER_META, moduleCoverage } from './catalogue';

/**
 * Ecosystem coverage.
 *
 * The Application Suite names 64 modules across four layers plus DX and
 * emerging technologies. This reports where the platform actually stands
 * against that list — including, and especially, what is **not** built.
 *
 * The catalogue is not stored in the database. It is the plant model's own
 * declaration, read straight from source, because it describes the product
 * rather than the plant: a seeded copy would be one more thing to keep in step
 * and would let a stale row claim a module the code does not have.
 */
@Injectable()
export class EcosystemService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The whole catalogue, grouped by layer, with an honest coverage figure.
   *
   * Scoring is stated in the payload rather than assumed by the caller:
   * implemented = 1, partial = 0.5, locked = 0. It is an indicative measure of
   * functional maturity for prioritising work — not a field measurement, and
   * the response says so.
   */
  async overview() {
    const coverage = moduleCoverage();

    const layers = Object.entries(LAYER_META)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([key, meta]) => {
        const modules = ECOSYSTEM_MODULES.filter((m) => m.layer === key);
        const groups = [...new Set(modules.map((m) => m.group))].map((g) => ({
          name: g,
          nameAr: modules.find((m) => m.group === g)?.groupAr ?? g,
          modules: modules
            .filter((m) => m.group === g)
            .map((m) => ({
              code: m.code,
              name: m.name,
              nameAr: m.nameAr,
              status: m.status,
              href: m.href ?? null,
              summary: m.summary,
              summaryAr: m.summaryAr,
            })),
        }));

        return {
          key,
          order: meta.order,
          name: meta.name,
          nameAr: meta.nameAr,
          role: meta.role,
          roleAr: meta.roleAr,
          total: coverage[key as keyof typeof coverage].total,
          score: coverage[key as keyof typeof coverage].score,
          pct: coverage[key as keyof typeof coverage].pct,
          groups,
        };
      });

    const total = layers.reduce((n, l) => n + l.total, 0);
    const score = layers.reduce((n, l) => n + l.score, 0);

    return {
      scoring: {
        rule: 'implemented = 1, partial = 0.5, locked = 0',
        // Said plainly in the payload so no consumer can present this as a
        // measurement. It ranks what to build next; it does not grade a plant.
        caveat:
          'Indicative measure of functional maturity, for prioritising work. Not a field performance measurement.',
      },
      total,
      score,
      pct: total ? Math.round((score / total) * 100) : 0,
      counts: {
        active: ECOSYSTEM_MODULES.filter((m) => m.status === 'ACTIVE').length,
        partial: ECOSYSTEM_MODULES.filter((m) => m.status === 'PARTIAL').length,
        locked: ECOSYSTEM_MODULES.filter((m) => m.status === 'LOCKED').length,
      },
      layers,
    };
  }

  /**
   * What each site in the estate actually carries.
   *
   * The classification is the product's specialisation mechanism, so showing it
   * beside the module catalogue is the point: a reviewer can see that no single
   * factory has everything, and why.
   */
  async byFactory() {
    const factories = await this.prisma.factory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, nameAr: true, city: true, color: true, metadata: true },
      orderBy: { code: 'asc' },
    });

    return factories.map((f) => {
      // The seeder writes the classification's labels onto the factory row, so
      // they are read from there rather than re-derived — one source, and no
      // import reaching outside src.
      const meta = (f.metadata ?? {}) as {
        type?: string;
        typeName?: string;
        typeNameAr?: string;
        typeSummary?: string;
        capabilities?: string[];
        routes?: { capability: string; href?: string; label?: string }[];
        paradigm?: string;
        tagline?: string;
        taglineAr?: string;
      };
      const caps = meta.capabilities ?? [];

      return {
        id: f.id,
        code: f.code,
        name: f.name,
        nameAr: f.nameAr,
        city: f.city,
        color: f.color,
        paradigm: meta.paradigm ?? null,
        type: meta.type ?? null,
        typeName: meta.typeName ?? null,
        typeNameAr: meta.typeNameAr ?? null,
        typeSummary: meta.typeSummary ?? null,
        tagline: meta.tagline ?? null,
        taglineAr: meta.taglineAr ?? null,
        capabilityCount: caps.length,
        capabilities: caps.map((c) => ({
          code: c,
          ...(meta.routes?.find((r) => r.capability === c) ?? {}),
        })),
      };
    });
  }
}
