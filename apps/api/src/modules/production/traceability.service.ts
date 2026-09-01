import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

type TraceEntityType = 'MATERIAL_LOT' | 'WORK_ORDER' | 'FINISHED_GOODS_LOT' | 'RECIPE';
type TraceLinkType = 'CONSUMED_BY' | 'PRODUCED_FROM' | 'GOVERNED_BY';

interface TraceNode {
  // Broad on purpose — genealogy also surfaces STEP / RAW_MATERIAL / BATCH nodes.
  type: TraceEntityType | 'STEP' | 'RAW_MATERIAL' | 'BATCH';
  id: string;
  label: string;
  meta?: Record<string, unknown>;
  children?: TraceNode[];
}

const round3 = (x: number) => Math.round((x ?? 0) * 1000) / 1000;

@Injectable()
export class TraceabilityService {
  private readonly logger = new Logger(TraceabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Link recording ──────────────────────────────────────────

  /**
   * Records all traceability links when a Work Order completes.
   * Creates edges: MaterialLot→WO (CONSUMED_BY), WO→Recipe (GOVERNED_BY), WO→FGLot (PRODUCED_FROM)
   */
  @OnEvent('production.work-order.completed')
  async recordProductionLinks(payload: { workOrder?: { id?: string }; factoryId: string; workOrderId?: string; fgLotId?: string }) {
    const workOrderId = payload.workOrderId ?? payload.workOrder?.id;
    const factoryId = payload.factoryId;
    if (!workOrderId) return;
    try {
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: workOrderId },
        include: {
          sku: { select: { name: true, code: true } },
          batchRecords: { select: { id: true }, take: 1, orderBy: { createdAt: 'desc' } },
        },
      });
      if (!wo) return;
      // The WO's output batch is the finished-goods lot for the link graph.
      const fgLotId = payload.fgLotId ?? wo.batchRecords[0]?.id;

      const links: Array<{
        parentType: TraceEntityType;
        parentId: string;
        childType: TraceEntityType;
        childId: string;
        linkType: TraceLinkType;
        factoryId: string;
        quantity?: number;
        unit?: string;
        metadata?: Record<string, unknown>;
      }> = [];

      // WO → Recipe link
      const recipe = await (this.prisma as any).recipe.findFirst({
        where: { skuId: wo.skuId, status: 'APPROVED' },
        orderBy: { version: 'desc' },
        select: { id: true, version: true, name: true },
      });
      if (recipe) {
        links.push({
          parentType: 'WORK_ORDER',
          parentId: workOrderId,
          childType: 'RECIPE',
          childId: recipe.id,
          linkType: 'GOVERNED_BY',
          factoryId,
          metadata: { recipeVersion: recipe.version, recipeName: recipe.name },
        });
      }

      // MaterialLot → WO links (from materialConsumption records if they exist)
      const consumptions = await (this.prisma as any).materialConsumption?.findMany?.({
        where: { workOrderId },
        include: { materialLot: { select: { lotNumber: true, materialCode: true, materialName: true } } },
      }).catch(() => []) ?? [];

      for (const c of consumptions) {
        if (c.materialLotId) {
          links.push({
            parentType: 'MATERIAL_LOT',
            parentId: c.materialLotId,
            childType: 'WORK_ORDER',
            childId: workOrderId,
            linkType: 'CONSUMED_BY',
            factoryId,
            quantity: c.quantityActual,
            unit: c.unit,
            metadata: {
              lotNumber: c.materialLot?.lotNumber,
              materialCode: c.materialLot?.materialCode,
              materialName: c.materialLot?.materialName,
            },
          });
        }
      }

      // WO → FG Lot link
      if (fgLotId) {
        links.push({
          parentType: 'WORK_ORDER',
          parentId: workOrderId,
          childType: 'FINISHED_GOODS_LOT',
          childId: fgLotId,
          linkType: 'PRODUCED_FROM',
          factoryId,
          metadata: { skuCode: wo.sku?.code, skuName: wo.sku?.name },
        });
      }

      if (links.length > 0) {
        await (this.prisma as any).traceabilityLink.createMany({ data: links, skipDuplicates: true });
        this.logger.log(`Recorded ${links.length} traceability links for WO ${workOrderId}`);
      }
    } catch (err) {
      this.logger.error(`Failed to record traceability links for WO ${workOrderId}`, err);
    }
  }

  /**
   * Manually record a single traceability link (for UI-driven lot consumption).
   */
  async recordLink(dto: {
    parentType: TraceEntityType;
    parentId: string;
    childType: TraceEntityType;
    childId: string;
    linkType: TraceLinkType;
    factoryId: string;
    quantity?: number;
    unit?: string;
  }) {
    return (this.prisma as any).traceabilityLink.create({ data: dto });
  }

  /** Resolve a work order from an id, order number, or its output batch number. */
  private async resolveWorkOrder(ref: string) {
    const r = ref.trim();
    return this.prisma.workOrder.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { id: r },
          { orderNumber: { equals: r, mode: 'insensitive' } },
          { batchRecords: { some: { OR: [{ batchNumber: { equals: r, mode: 'insensitive' } }, { lotNumber: { equals: r, mode: 'insensitive' } }] } } },
        ],
      },
      include: {
        sku: { select: { name: true, code: true } },
        jobOrders: { select: { machine: { select: { name: true } } } },
        batchRecords: { select: { id: true, batchNumber: true, lotNumber: true, goodQuantity: true, unit: true } },
      },
    });
  }

  /** Resolve a material lot from an id or lot number. */
  private async resolveMaterialLot(ref: string) {
    const r = ref.trim();
    return this.prisma.materialLot.findFirst({
      where: { OR: [{ id: r }, { lotNumber: { equals: r, mode: 'insensitive' } }] },
      select: { id: true, lotNumber: true, materialCode: true, materialName: true, quantity: true, remainingQty: true, unit: true, supplierName: true, expiryDate: true, status: true },
    });
  }

  // ── Backward trace (Finished WO/Batch → inputs) ─────────────

  /**
   * Backward genealogy from a finished output. Accepts a WO id / order number /
   * batch number, then walks the REAL consumption data: WO → routing steps →
   * the exact MaterialLots (and raw materials) consumed at each step, with the
   * quantities recorded by the consumption engine. Independent of the legacy
   * TraceabilityLink graph.
   */
  async traceBackward(fgLotId: string): Promise<TraceNode> {
    const wo = await this.resolveWorkOrder(fgLotId);
    if (wo) return this.buildBackwardFromWO(wo);
    // Legacy fallback: an explicit FG-lot link graph, if one exists.
    return this.legacyTraceBackward(fgLotId);
  }

  private async buildBackwardFromWO(wo: {
    id: string; orderNumber: string; status: string; goodQty: number;
    actualStart: Date | null; actualEnd: Date | null;
    sku: { name: string; code: string } | null;
    jobOrders: Array<{ machine: { name: string } | null }>;
    batchRecords: Array<{ id: string; batchNumber: string; lotNumber: string | null; goodQuantity: number; unit: string }>;
  }): Promise<TraceNode> {
    const root: TraceNode = {
      type: 'WORK_ORDER',
      id: wo.id,
      label: `WO: ${wo.orderNumber}`,
      meta: {
        product: wo.sku ? `${wo.sku.code} — ${wo.sku.name}` : undefined,
        status: wo.status,
        qtyProduced: wo.goodQty,
        completedAt: wo.actualEnd?.toISOString()?.slice(0, 16).replace('T', ' '),
      },
      children: [],
    };

    // Output finished-goods batch(es)
    for (const b of wo.batchRecords) {
      root.children!.push({
        type: 'BATCH',
        id: b.id,
        label: `Output Batch: ${b.batchNumber}`,
        meta: { lot: b.lotNumber ?? undefined, good: b.goodQuantity, unit: b.unit },
      });
    }

    // Consumed materials — grouped by routing step (job order)
    const consumptions = await this.prisma.materialConsumption.findMany({
      where: { workOrderId: wo.id },
      include: {
        materialLot: { select: { lotNumber: true, supplierName: true, expiryDate: true, status: true } },
        jobOrder: { select: { sequenceOrder: true, operationName: true, machine: { select: { name: true } } } },
      },
    });

    const steps = new Map<string, { seq: number; label: string; machine: string | null; node: TraceNode }>();
    const noStepKey = '__wo__';
    for (const c of consumptions) {
      const key = c.jobOrderId ?? noStepKey;
      if (!steps.has(key)) {
        const seq = c.jobOrder?.sequenceOrder ?? 999;
        const node: TraceNode = {
          type: 'STEP',
          id: key,
          label: c.jobOrder ? `Step ${c.jobOrder.sequenceOrder}: ${c.jobOrder.operationName}` : 'Materials',
          meta: c.jobOrder?.machine?.name ? { machine: c.jobOrder.machine.name } : undefined,
          children: [],
        };
        steps.set(key, { seq, label: node.label, machine: c.jobOrder?.machine?.name ?? null, node });
      }
      const stepNode = steps.get(key)!.node;
      stepNode.children!.push({
        type: c.materialLotId ? 'MATERIAL_LOT' : 'RAW_MATERIAL',
        id: c.materialLotId ?? c.id,
        label: c.materialLot?.lotNumber
          ? `Lot ${c.materialLot.lotNumber} — ${c.materialName}`
          : `${c.materialName} (no lot)`,
        meta: {
          code: c.materialCode,
          consumed: `${round3(c.quantityActual)} ${c.unit}`,
          ...(c.materialLot?.supplierName ? { supplier: c.materialLot.supplierName } : {}),
          ...(c.materialLot?.expiryDate ? { expiry: c.materialLot.expiryDate.toISOString().slice(0, 10) } : {}),
        },
      });
    }

    [...steps.values()]
      .sort((a, b) => a.seq - b.seq)
      .forEach((s) => root.children!.push(s.node));

    return root;
  }

  /** Legacy FG-lot link-graph backward trace (kept for any pre-existing links). */
  private async legacyTraceBackward(fgLotId: string): Promise<TraceNode> {
    // Find WO that produced this FG lot
    const woLinks = await (this.prisma as any).traceabilityLink.findMany({
      where: { childType: 'FINISHED_GOODS_LOT', childId: fgLotId, linkType: 'PRODUCED_FROM' },
    });

    const fgNode: TraceNode = {
      type: 'FINISHED_GOODS_LOT',
      id: fgLotId,
      label: `FG Lot: ${fgLotId.slice(0, 8)}`,
      children: [],
    };

    for (const woLink of woLinks) {
      const woId = woLink.parentId;
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: woId },
        include: {
          sku: { select: { name: true, code: true } },
          jobOrders: { select: { machine: { select: { name: true, code: true } } } },
        },
      });
      if (!wo) continue;

      const woNode: TraceNode = {
        type: 'WORK_ORDER',
        id: woId,
        label: `WO: ${wo.orderNumber}`,
        meta: {
          skuCode: wo.sku?.code,
          skuName: wo.sku?.name,
          machine: wo.jobOrders.find((j) => j.machine)?.machine?.name ?? null,
          status: wo.status,
          startedAt: wo.actualStart?.toISOString(),
          completedAt: wo.actualEnd?.toISOString(),
          qtyProduced: wo.goodQty,
        },
        children: [],
      };

      // Recipe link
      const recipeLinks = await (this.prisma as any).traceabilityLink.findMany({
        where: { parentType: 'WORK_ORDER', parentId: woId, linkType: 'GOVERNED_BY' },
      });
      for (const rl of recipeLinks) {
        const recipe = await (this.prisma as any).recipe.findUnique({
          where: { id: rl.childId },
          select: { id: true, name: true, version: true, status: true, batchSize: true, batchUnit: true },
        });
        if (recipe) {
          woNode.children!.push({
            type: 'RECIPE',
            id: recipe.id,
            label: `Recipe: ${recipe.name} v${recipe.version}`,
            meta: { status: recipe.status, batchSize: recipe.batchSize, batchUnit: recipe.batchUnit },
          });
        }
      }

      // Material Lot links
      const matLinks = await (this.prisma as any).traceabilityLink.findMany({
        where: { childType: 'WORK_ORDER', childId: woId, linkType: 'CONSUMED_BY' },
      });
      for (const ml of matLinks) {
        const lot = await this.prisma.materialLot.findUnique({
          where: { id: ml.parentId },
          select: {
            id: true, lotNumber: true, materialCode: true, materialName: true,
            quantity: true, unit: true, expiryDate: true, status: true,
          },
        });
        if (lot) {
          woNode.children!.push({
            type: 'MATERIAL_LOT',
            id: lot.id,
            label: `Lot: ${lot.lotNumber} (${lot.materialCode})`,
            meta: {
              materialName: lot.materialName,
              quantity: ml.quantity ?? lot.quantity,
              unit: ml.unit ?? lot.unit,
              expiryDate: lot.expiryDate?.toISOString(),
              status: lot.status,
            },
          });
        }
      }

      fgNode.children!.push(woNode);
    }

    return fgNode;
  }

  // ── Forward trace (Material Lot → outputs) ───────────────────

  /**
   * Forward genealogy from a material lot (id or lot number): every work order
   * that consumed it → the finished output batch each produced. Walks the real
   * MaterialConsumption records written by the consumption engine.
   */
  async traceForward(materialLotId: string): Promise<TraceNode> {
    const lot = await this.resolveMaterialLot(materialLotId);
    if (!lot) throw new NotFoundException(`Material lot "${materialLotId}" not found`);

    const matNode: TraceNode = {
      type: 'MATERIAL_LOT',
      id: lot.id,
      label: `Lot ${lot.lotNumber} — ${lot.materialName}`,
      meta: {
        code: lot.materialCode,
        received: lot.quantity,
        remaining: lot.remainingQty,
        unit: lot.unit,
        status: lot.status,
        ...(lot.supplierName ? { supplier: lot.supplierName } : {}),
      },
      children: [],
    };

    const consumptions = await this.prisma.materialConsumption.findMany({
      where: { materialLotId: lot.id },
      include: {
        workOrder: {
          select: {
            id: true, orderNumber: true, status: true, goodQty: true, actualEnd: true,
            sku: { select: { name: true, code: true } },
            batchRecords: { select: { id: true, batchNumber: true, lotNumber: true, goodQuantity: true, unit: true } },
            jobOrders: { select: { machine: { select: { name: true } } } },
          },
        },
        jobOrder: { select: { sequenceOrder: true, operationName: true } },
      },
    });

    // Group consumed-here slices by the work order that consumed them.
    const byWO = new Map<string, { node: TraceNode; consumed: number; unit: string }>();
    for (const c of consumptions) {
      const wo = c.workOrder;
      if (!wo) continue;
      if (!byWO.has(wo.id)) {
        const node: TraceNode = {
          type: 'WORK_ORDER',
          id: wo.id,
          label: `WO: ${wo.orderNumber}`,
          meta: {
            product: wo.sku ? `${wo.sku.code} — ${wo.sku.name}` : undefined,
            status: wo.status,
            qtyProduced: wo.goodQty,
            machine: wo.jobOrders.find((j) => j.machine)?.machine?.name ?? undefined,
          },
          children: [],
        };
        // Finished-goods batches produced by this WO using the lot.
        for (const b of wo.batchRecords) {
          node.children!.push({
            type: 'BATCH',
            id: b.id,
            label: `Output Batch: ${b.batchNumber}`,
            meta: { lot: b.lotNumber ?? undefined, good: b.goodQuantity, unit: b.unit },
          });
        }
        byWO.set(wo.id, { node, consumed: 0, unit: c.unit });
      }
      byWO.get(wo.id)!.consumed += c.quantityActual;
    }

    for (const { node, consumed, unit } of byWO.values()) {
      node.meta = { ...node.meta, consumedFromLot: `${round3(consumed)} ${unit}` };
      matNode.children!.push(node);
    }

    return matNode;
  }

  // ── Query: raw link list ─────────────────────────────────────

  async getLinksForEntity(entityType: TraceEntityType, entityId: string) {
    const [asParent, asChild] = await Promise.all([
      (this.prisma as any).traceabilityLink.findMany({
        where: { parentType: entityType, parentId: entityId },
        orderBy: { createdAt: 'asc' },
      }),
      (this.prisma as any).traceabilityLink.findMany({
        where: { childType: entityType, childId: entityId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { asParent, asChild };
  }

  async getTraceabilityStats(factoryId: string) {
    const [totalLinks, lotsTracked, wosTracked] = await Promise.all([
      (this.prisma as any).traceabilityLink.count({ where: { factoryId } }),
      (this.prisma as any).traceabilityLink.groupBy({
        by: ['parentId'],
        where: { factoryId, parentType: 'MATERIAL_LOT' },
        _count: true,
      }).then((r: any[]) => r.length),
      (this.prisma as any).traceabilityLink.groupBy({
        by: ['parentId'],
        where: { factoryId, parentType: 'WORK_ORDER' },
        _count: true,
      }).then((r: any[]) => r.length),
    ]);
    return { totalLinks, lotsTracked, wosTracked };
  }
}
