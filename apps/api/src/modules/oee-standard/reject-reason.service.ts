import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { toPieces, type SkuPackaging } from '../../common/units.util';

export interface RejectReason {
  reason: string;
  category: string;
  /** In PIECES. Raw quantities are not comparable across steps. */
  pieces: number;
  occurrence: number;
  /** Running share of the total, in rank order — the Pareto line. */
  cumulativePct: number;
  sharePct: number;
}

export interface RejectReasons {
  /** False when nothing is being logged, which is a configuration state and not a zero. */
  configured: boolean;
  totalPieces: number;
  occurrence: number;
  reasons: RejectReason[];
}

export interface RejectScope {
  machineId?: string;
  lineId?: string;
  areaId?: string;
}

/**
 * Why parts were rejected, ranked.
 *
 * ── The unit trap this exists to avoid ──────────────────────────────────────
 * Scrap is logged against a JOB ORDER, so it is counted in that step's own
 * output unit: the filler scraps inners, the palletiser scraps pallets. On this
 * line one pallet is 160 pieces, so adding the raw quantities makes a single
 * scrapped pallet look like a rounding error beside a hundred scrapped inners
 * when it is worth more than all of them. Everything is converted to pieces
 * before it is ranked, on the same ladder the engines use.
 *
 * ── Why "configured" is a field ─────────────────────────────────────────────
 * No rows means nobody is recording reasons, which is not the same as no
 * rejects. The page needs to say which of the two it is, and a bare empty chart
 * says the wrong one.
 */
@Injectable()
export class RejectReasonService {
  constructor(private readonly prisma: PrismaService) {}

  async topReasons(
    factoryId: string | null,
    from: Date,
    to: Date,
    scope: RejectScope = {},
    limit = 10,
  ): Promise<RejectReasons> {
    const filters: Prisma.Sql[] = [Prisma.sql`s."createdAt" >= ${from} AND s."createdAt" < ${to}`];
    if (factoryId) filters.push(Prisma.sql`s."factoryId" = ${factoryId}`);
    if (scope.machineId) filters.push(Prisma.sql`j."machineId" = ${scope.machineId}`);
    if (scope.lineId) filters.push(Prisma.sql`m."lineId" = ${scope.lineId}`);
    if (scope.areaId) {
      filters.push(Prisma.sql`(m."areaId" = ${scope.areaId} OR m."lineId" IN (
        SELECT l2.id FROM production_lines l2 WHERE l2."areaId" = ${scope.areaId}))`);
    }

    // Rows rather than a GROUP BY: the ladder conversion depends on each row's
    // own unit and its product's packaging, so the grouping has to happen after
    // the conversion, not before it.
    const rows = await this.prisma.$queryRaw<Array<{
      reason: string; category: string; qty: number; qtyUnit: string;
      unitsPerInner: number | null; innersPerCarton: number | null; cartonsPerPallet: number | null;
    }>>(Prisma.sql`
      SELECT s.reason, s.category::text AS category, s.qty, s."qtyUnit",
             k."unitsPerInner", k."innersPerCarton", k."cartonsPerPallet"
      FROM scrap_logs s
      JOIN job_orders j ON j.id = s."jobOrderId"
      LEFT JOIN machines m ON m.id = j."machineId"
      LEFT JOIN work_orders w ON w.id = s."workOrderId"
      LEFT JOIN skus k ON k.id = w."skuId"
      WHERE ${Prisma.join(filters, ' AND ')}
    `);

    if (rows.length === 0) {
      return { configured: false, totalPieces: 0, occurrence: 0, reasons: [] };
    }

    const grouped = new Map<string, { reason: string; category: string; pieces: number; occurrence: number }>();
    for (const r of rows) {
      const pkg: SkuPackaging = {
        unitsPerInner: r.unitsPerInner,
        innersPerCarton: r.innersPerCarton,
        cartonsPerPallet: r.cartonsPerPallet,
      };
      const pieces = toPieces(r.qty ?? 0, r.qtyUnit || 'PIECE', pkg);
      const key = `${r.category}:${r.reason}`;
      const hit = grouped.get(key) ?? { reason: r.reason, category: r.category, pieces: 0, occurrence: 0 };
      hit.pieces += pieces;
      hit.occurrence += 1;
      grouped.set(key, hit);
    }

    const ranked = [...grouped.values()].sort((a, b) => b.pieces - a.pieces);
    const totalPieces = ranked.reduce((a, r) => a + r.pieces, 0);

    // The cumulative line is built over the FULL ranked list before the limit is
    // applied, so the last bar shown carries its true share of everything rather
    // than of what happened to fit on the chart.
    let running = 0;
    const withCumulative = ranked.map((r) => {
      running += r.pieces;
      return {
        ...r,
        sharePct: totalPieces > 0 ? (r.pieces / totalPieces) * 100 : 0,
        cumulativePct: totalPieces > 0 ? (running / totalPieces) * 100 : 0,
      };
    });

    return {
      configured: true,
      totalPieces,
      occurrence: rows.length,
      reasons: withCumulative.slice(0, limit),
    };
  }
}
