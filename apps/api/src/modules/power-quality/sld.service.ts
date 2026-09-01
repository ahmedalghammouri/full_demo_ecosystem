import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * The single line diagram.
 *
 * One request returns the whole electrical tree with live values riding on each
 * node, because that is how the drawing is read: nobody wants the topology and
 * the measurements as two things to reconcile.
 *
 * The topology is stored as one `parent` per asset, so there is no separate
 * edge list that can disagree with it, and the tree is assembled here rather
 * than shipped flat for the client to rebuild.
 */
@Injectable()
export class SldService {
  constructor(private readonly prisma: PrismaService) {}

  async diagram(factoryId: string) {
    const factory = await this.prisma.factory.findUnique({
      where: { id: factoryId },
      select: { code: true, name: true, nameAr: true, metadata: true },
    });
    if (!factory) throw new ForbiddenException('Unknown factory');

    const caps = (factory.metadata as { capabilities?: string[] } | null)?.capabilities ?? [];
    if (!caps.includes('SINGLE_LINE_DIAGRAM')) {
      throw new ForbiddenException(
        `${factory.code} has no single line diagram. Its classification does not include an electrical distribution model.`,
      );
    }

    const [machines, meterRows, latest] = await Promise.all([
      this.prisma.machine.findMany({
        where: { factoryId, isActive: true, archivedAt: null },
        select: {
          id: true, code: true, name: true, nameAr: true, machineType: true,
          manufacturer: true, model: true, criticality: true, metadata: true,
          currentStatus: { select: { state: true } },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      // ELECTRICAL only. A node on this diagram carries volts and amps; the
      // site's water and compressed-air meters are also scoped to machines, and
      // picking one up gave the RO feed pump a reading of 0.0 kW with no power
      // factor — which draws as a dead feeder rather than an unmetered one.
      this.prisma.energyMeter.findMany({
        where: { factoryId, type: 'ELECTRICAL' },
        select: { meterNumber: true, machineId: true },
      }),
      // The latest reading per meter — the values that ride on the nodes.
      this.prisma.$queryRaw<Array<{
        meterNumber: string;
        powerKw: number | null;
        powerFactor: number | null;
        reactiveKvar: number | null;
        timestamp: Date;
      }>>`
        SELECT DISTINCT ON (m."meterNumber")
               m."meterNumber", r."powerKw", r."powerFactor", r."reactiveKvar", r.timestamp
        FROM energy_readings r
        JOIN energy_meters m ON m.id = r."meterId"
        WHERE r."factoryId" = ${factoryId}
        ORDER BY m."meterNumber", r.timestamp DESC`,
    ]);

    const readingBy = new Map(latest.map((r) => [r.meterNumber, r]));
    const meterOfMachine = new Map(
      meterRows.filter((m) => m.machineId).map((m) => [m.machineId as string, m.meterNumber]),
    );

    const nodes = machines
      .filter((m) => (m.metadata as Record<string, unknown> | null)?.electrical)
      .map((m) => {
        const meta = m.metadata as Record<string, unknown>;
        const el = meta.electrical as {
          voltageLevel: 'MV' | 'LV';
          parent?: string;
          ratedKva?: number;
          ratedKw?: number;
        };

        const meterNumber = meterOfMachine.get(m.id);
        const reading = meterNumber ? readingBy.get(meterNumber) : undefined;

        const ratedKva = el.ratedKva ?? null;
        const kw = reading?.powerKw ?? null;
        const pf = reading?.powerFactor ?? null;
        // S = P / pf. Loading against the node's own rating is the number a
        // single line diagram is actually read for.
        const kva = kw != null && pf ? kw / pf : null;
        const loadingPct =
          kva != null && ratedKva ? Math.round((kva / ratedKva) * 1000) / 10 : null;

        return {
          code: m.code,
          name: m.name,
          nameAr: m.nameAr,
          kind: m.machineType,
          manufacturer: m.manufacturer,
          model: m.model,
          criticality: m.criticality,
          state: m.currentStatus?.state ?? 'OFFLINE',
          voltageLevel: el.voltageLevel,
          parent: el.parent ?? null,
          ratedKva,
          ratedKw: el.ratedKw ?? null,
          // Null, not zero: an unmetered node is a different statement from one
          // measuring nothing, and a zero here would read as a dead feeder.
          live: reading
            ? {
                powerKw: round(kw, 1),
                powerFactor: pf != null ? round(pf, 3) : null,
                reactiveKvar: round(reading.reactiveKvar, 1),
                apparentKva: round(kva, 1),
                loadingPct,
                at: reading.timestamp,
              }
            : null,
          // Carried so the drawing can annotate a finding rather than hide it.
          note: (meta.condition as string) ?? (meta.note as string) ?? null,
        };
      });

    const childrenOf = new Map<string, string[]>();
    for (const n of nodes) {
      if (!n.parent) continue;
      childrenOf.set(n.parent, [...(childrenOf.get(n.parent) ?? []), n.code]);
    }

    const root = nodes.find((n) => !n.parent) ?? null;

    // Depth is computed here so the drawing cannot lay out a hierarchy that
    // disagrees with the topology it came from.
    const depthOf = new Map<string, number>();
    const walk = (code: string, depth: number) => {
      depthOf.set(code, depth);
      for (const c of childrenOf.get(code) ?? []) walk(c, depth + 1);
    };
    if (root) walk(root.code, 0);

    // Site demand is the sum of the METERED boards. Adding a transformer and
    // the boards beneath it would count the same power twice.
    const siteKw = nodes
      .filter((n) => n.live && n.voltageLevel === 'LV' && n.ratedKva)
      .reduce((s, n) => s + (n.live!.powerKw ?? 0), 0);

    return {
      factory: { code: factory.code, name: factory.name, nameAr: factory.nameAr },
      root: root?.code ?? null,
      nodes: nodes.map((n) => ({
        ...n,
        depth: depthOf.get(n.code) ?? 0,
        children: childrenOf.get(n.code) ?? [],
      })),
      totals: {
        siteKw: round(siteKw, 1),
        meteredNodes: nodes.filter((n) => n.live).length,
        totalNodes: nodes.length,
      },
    };
  }
}

function round(v: number | null | undefined, dp: number): number | null {
  if (v == null || Number.isNaN(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
