import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { GatewayContextService } from '../context/gateway-context.service';
import {
  piecesPer, toPieces, fromPieces, normaliseUnit, smallestLadderUnit,
  type LadderUnit, type SkuPackaging,
} from '@i360/shared';

/** One routing step's output, in its own unit and in the line's common one. */
export interface BalanceStep {
  jobOrderId: string;
  sequenceOrder: number;
  operationName: string;
  machineId: string | null;
  machineCode: string | null;
  machineName: string | null;
  /** The unit THIS machine counts in — what its own panel shows. */
  unit: string;
  good: number;
  reject: number;
  total: number;
  /** The same three, converted to the line's common unit. */
  goodCommon: number;
  rejectCommon: number;
  totalCommon: number;
  /**
   * Upstream good output minus this step's total handled, in the common unit.
   *
   * Positive: the machine before it made more than this one has accounted for —
   * work in progress inside the machine, or units lost between them.
   * Negative: this step reports MORE than it was fed, which cannot happen to
   * material and therefore points at a count rather than at the line.
   * Null on the first step, which has nothing upstream to be compared with.
   */
  diffFromPrev: number | null;
  /** True when this step's unit is off the packaging ladder and cannot convert. */
  unconvertible: boolean;
}

export interface BalanceRun {
  workOrderId: string;
  orderNumber: string | null;
  skuCode: string | null;
  skuName: string | null;
  packaging: SkuPackaging;
  /** Pieces per rung — what the conversions are made of, exposed so they can be checked. */
  ladder: Record<LadderUnit, number>;
  commonUnit: LadderUnit;
  steps: BalanceStep[];
}

/**
 * WHAT EACH MACHINE MADE, IN ONE UNIT — the line's material balance.
 *
 * Every machine on a packing line counts in whatever its sensor sees. The
 * filler counts inners, the cartoner counts cartons, the palletiser counts
 * pallets. Read straight off their panels the numbers look unrelated — 1000,
 * 240, 6 — and cannot be compared. Put through the product's packaging ladder
 * they are the same material, and the question worth asking becomes answerable:
 * did what came out of one machine go into the next?
 *
 * That question is how a miscounting sensor is caught. A counter that misses
 * pulses does not announce itself. It quietly reports less than the machine
 * before it fed, shift after shift, and the gap is the only evidence there is.
 *
 * The common unit is the SMALLEST rung the line actually uses, so no conversion
 * ever divides and no remainder is hidden: 240 cartons is exactly 960 inners,
 * where 962 inners would be 240.5 cartons and would round the odd 2 away.
 */
@Injectable()
export class CountBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: GatewayContextService,
  ) {}

  async balance(): Promise<BalanceRun[]> {
    const factoryId = this.ctx.getFactoryId();

    const jobs = await this.prisma.jobOrder.findMany({
      where: { ...(factoryId ? { factoryId } : {}), status: 'EXECUTING' },
      select: {
        id: true, workOrderId: true, sequenceOrder: true, operationName: true,
        machineId: true, outputUnit: true,
        actualQtyGood: true, actualQtyRejected: true,
        balanceAdjGood: true, balanceAdjRejected: true,
        machine: { select: { code: true, name: true } },
        workOrder: {
          select: {
            orderNumber: true,
            sku: {
              select: {
                code: true, name: true, baseUnit: true,
                unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true,
              },
            },
          },
        },
      },
      orderBy: [{ workOrderId: 'asc' }, { sequenceOrder: 'asc' }],
      take: 200,
    });

    const byOrder = new Map<string, typeof jobs>();
    for (const j of jobs) {
      const bucket = byOrder.get(j.workOrderId);
      if (bucket) bucket.push(j);
      else byOrder.set(j.workOrderId, [j]);
    }

    const runs: BalanceRun[] = [];
    for (const [workOrderId, group] of byOrder) {
      const sku = group[0]?.workOrder?.sku ?? null;
      const packaging: SkuPackaging = {
        unitsPerInner: sku?.unitsPerInner ?? 1,
        innersPerCarton: sku?.innersPerCarton ?? 1,
        cartonsPerPallet: sku?.cartonsPerPallet ?? 1,
        baseUnit: sku?.baseUnit ?? null,
      };
      const ladder = piecesPer(packaging);

      // The smallest rung ANY step on this line counts in. Choosing the smallest
      // is what keeps every conversion a multiplication.
      const used = group
        .map((j) => normaliseUnit(j.outputUnit))
        .filter((u): u is LadderUnit => u !== null);
      const commonUnit: LadderUnit = used.length
        ? used.reduce((a, b) => (ladder[b] < ladder[a] ? b : a))
        : smallestLadderUnit(packaging);

      const steps: BalanceStep[] = [];
      let prevGoodCommon: number | null = null;

      for (const j of [...group].sort((a, b) => a.sequenceOrder - b.sequenceOrder)) {
        const unit = j.outputUnit ?? '';
        const rung = normaliseUnit(unit);
        // THE MEASURED figure — the balance's own correction taken back out.
        //
        // `actualQtyGood` carries raw counts, manual entries AND whatever the
        // line balancer has already added. Reconciling against that number would
        // read its own correction as production and settle to zero, then undo
        // itself, then correct again: a value oscillating every fifteen seconds
        // for no reason visible to anyone watching it.
        //
        // A balance is only meaningful over what the sensors actually reported,
        // so the adjustment is removed here and recomputed from scratch each
        // pass. That is also what makes the correction converge instead of
        // accumulating.
        const good = (j.actualQtyGood ?? 0) - (j.balanceAdjGood ?? 0);
        const reject = (j.actualQtyRejected ?? 0) - (j.balanceAdjRejected ?? 0);
        const total = good + reject;

        // An off-ladder unit (KG, a blank) cannot be compared with the rest of
        // the line. Say so, rather than converting it as though it were pieces —
        // which is how a wrong number acquires a confident label.
        const conv = (q: number) =>
          rung === null ? 0 : fromPieces(toPieces(q, rung, packaging), commonUnit, packaging);

        const goodCommon = conv(good);
        const totalCommon = conv(total);

        steps.push({
          jobOrderId: j.id,
          sequenceOrder: j.sequenceOrder,
          operationName: j.operationName,
          machineId: j.machineId,
          machineCode: j.machine?.code ?? null,
          machineName: j.machine?.name ?? null,
          unit: unit || '—',
          good, reject, total,
          goodCommon, rejectCommon: conv(reject), totalCommon,
          diffFromPrev:
            prevGoodCommon === null || rung === null ? null : prevGoodCommon - totalCommon,
          unconvertible: rung === null,
        });

        if (rung !== null) prevGoodCommon = goodCommon;
      }

      runs.push({
        workOrderId,
        orderNumber: group[0]?.workOrder?.orderNumber ?? null,
        skuCode: sku?.code ?? null,
        skuName: sku?.name ?? null,
        packaging, ladder, commonUnit, steps,
      });
    }

    return runs;
  }
}
