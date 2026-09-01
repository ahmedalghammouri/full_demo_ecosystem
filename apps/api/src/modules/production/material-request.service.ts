import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { ProductionService } from './production.service';

const OPEN_STATUSES = ['PENDING', 'ACKNOWLEDGED', 'PARTIALLY_FULFILLED'] as const;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export interface MaterialReceiptLotDto {
  lotNumber: string;
  quantity: number;
  supplierLot?: string;
  supplierName?: string;
  expiryDate?: string;
  storageLocationId?: string;
  binNumber?: string;
  notes?: string;
}

export interface RespondMaterialRequestDto {
  // FULFILL = receive/adjust stock now; SET_DELIVERY = commit a supplier ETA;
  // CANCEL = drop the request (e.g. WO rescheduled or superseded).
  action: 'FULFILL' | 'SET_DELIVERY' | 'CANCEL';
  quantity?: number; // FULFILL (direct adjust): qty to add to raw-material stock
  // FULFILL by lots: receive one or more material lots linked to this request.
  // When present, stock is rolled up from the lots and `quantity` is ignored.
  lots?: MaterialReceiptLotDto[];
  deliveryDate?: string; // SET_DELIVERY: ISO date the material will be available
  notes?: string;
}

@Injectable()
export class MaterialRequestService {
  private readonly logger = new Logger(MaterialRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly production: ProductionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── List (inventory response queue) ──────────────────────────
  async list(
    factoryId: string | null,
    filters: { search?: string; status?: string; archived?: string; page?: number; limit?: number },
  ) {
    const { search, status, archived, page = 1, limit = 20 } = filters;
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      // archived: 'archived' → only archived; 'all' → both; default → active only.
      ...(archived === 'archived' ? { NOT: { archivedAt: null } } : archived === 'all' ? {} : { archivedAt: null }),
      ...(status ? { status } : { status: { in: OPEN_STATUSES as any } }),
      ...(search && {
        OR: [
          { requestNumber: { contains: search, mode: 'insensitive' } },
          { rawMaterial: { name: { contains: search, mode: 'insensitive' } } },
          { rawMaterial: { code: { contains: search, mode: 'insensitive' } } },
          { workOrder: { orderNumber: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.materialRequest.count({ where }),
      this.prisma.materialRequest.findMany({
        where,
        include: {
          rawMaterial: { select: { id: true, code: true, name: true, unit: true, currentStock: true, reservedStock: true, minStock: true, storageLocation: true, supplierName: true, leadTimeDays: true } },
          workOrder: { select: { id: true, orderNumber: true, status: true, priority: true, plannedStart: true, materialReadyDate: true, sku: { select: { name: true, itemNumber: true } } } },
          productionOrder: { select: { orderNumber: true } },
        },
        orderBy: [{ priority: 'desc' }, { requestedAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const data = rows.map((r) => {
      const rm: any = r.rawMaterial;
      const liveAvailable = round3((rm?.currentStock ?? 0) - (rm?.reservedStock ?? 0));
      return {
        id: r.id,
        requestNumber: r.requestNumber,
        status: r.status,
        priority: r.priority,
        workOrderId: r.workOrderId,
        woNumber: (r.workOrder as any)?.orderNumber ?? null,
        woStatus: (r.workOrder as any)?.status ?? null,
        woPlannedStart: (r.workOrder as any)?.plannedStart ?? null,
        materialReadyDate: (r.workOrder as any)?.materialReadyDate ?? null,
        productName: (r.workOrder as any)?.sku ? `${(r.workOrder as any).sku.itemNumber} ${(r.workOrder as any).sku.name}` : null,
        poNumber: (r.productionOrder as any)?.orderNumber ?? null,
        rawMaterialId: r.rawMaterialId,
        materialCode: rm?.code ?? null,
        materialName: rm?.name ?? null,
        unit: r.unit,
        currentStock: rm?.currentStock ?? 0,
        reservedStock: rm?.reservedStock ?? 0,
        liveAvailable: Math.max(0, liveAvailable),
        minStock: rm?.minStock ?? 0,
        storageLocation: rm?.storageLocation ?? null,
        supplierName: rm?.supplierName ?? null,
        leadTimeDays: rm?.leadTimeDays ?? null,
        quantityNeeded: r.quantityNeeded,
        quantityAvailable: r.quantityAvailable,
        quantityShort: r.quantityShort,
        quantityFulfilled: r.quantityFulfilled,
        // Live recompute: still short if the live availability can't cover the need.
        stillShort: round3(Math.max(0, r.quantityNeeded - liveAvailable)),
        deliveryDate: r.deliveryDate,
        requestedAt: r.requestedAt,
        reviewedAt: r.reviewedAt,
        notes: r.notes,
        responseNotes: r.responseNotes,
      };
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async stats(factoryId: string | null) {
    const where = { ...(factoryId ? { factoryId } : {}), status: { in: OPEN_STATUSES as any } };
    const open = await this.prisma.materialRequest.findMany({
      where,
      select: { quantityShort: true, deliveryDate: true, priority: true },
    });
    return {
      openCount: open.length,
      awaitingResponse: open.filter((o) => !o.deliveryDate).length,
      scheduled: open.filter((o) => !!o.deliveryDate).length,
      highCritical: open.filter((o) => o.priority === 'HIGH' || o.priority === 'CRITICAL').length,
      totalShortQty: round3(open.reduce((s, o) => s + (o.quantityShort ?? 0), 0)),
    };
  }

  // ── Respond ──────────────────────────────────────────────────
  async respond(factoryId: string | null, userId: string | null, id: string, dto: RespondMaterialRequestDto) {
    const req = await this.prisma.materialRequest.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
      include: { rawMaterial: true },
    });
    if (!req) throw new NotFoundException('Material request not found');
    if (req.status === 'FULFILLED' || req.status === 'CANCELLED') {
      throw new BadRequestException(`This request is already ${req.status}.`);
    }

    if (dto.action === 'CANCEL') {
      const updated = await this.prisma.materialRequest.update({
        where: { id },
        data: { status: 'CANCELLED', responseNotes: dto.notes, reviewedById: userId, reviewedAt: new Date() },
      });
      if (req.workOrderId) await this.production.refreshWorkOrderMaterialStatus(req.workOrderId);
      return updated;
    }

    if (dto.action === 'SET_DELIVERY') {
      if (!dto.deliveryDate) throw new BadRequestException('deliveryDate is required to commit a delivery date.');
      const updated = await this.prisma.materialRequest.update({
        where: { id },
        data: {
          deliveryDate: new Date(dto.deliveryDate),
          status: 'ACKNOWLEDGED',
          responseNotes: dto.notes,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
      });
      // Committing an ETA raises a PENDING PO reschedule request for approval (it
      // does NOT move the WO/PO dates until approved). The WO stays blocked via its
      // materialStatus / materialReadyDate gate in the meantime.
      if (req.workOrderId) await this.production.scheduleWorkOrderForDelivery(req.workOrderId, userId);
      this.eventEmitter.emit('production.material-request.scheduled', { id, workOrderId: req.workOrderId, factoryId: req.factoryId });
      return updated;
    }

    // FULFILL — receive/adjust raw-material stock now. Two modes:
    //   • by lots  → create one or more MaterialLots linked to this request (FEFO-
    //     traceable, per-location), each rolling into the master currentStock.
    //   • direct   → bump the master currentStock by a single quantity.
    const rm = req.rawMaterial;
    const useLots = Array.isArray(dto.lots) && dto.lots.length > 0;

    let addQty = 0;
    const stockBefore = rm.currentStock;

    if (useLots) {
      const lots = dto.lots!.filter((l) => Number(l.quantity) > 0 && l.lotNumber?.trim());
      if (lots.length === 0) throw new BadRequestException('Provide at least one lot with a lot number and a positive quantity.');
      let running = stockBefore;
      for (const l of lots) {
        const q = round3(Number(l.quantity));
        const before = running;
        const after = round3(before + q);
        const lot = await this.prisma.materialLot.create({
          data: {
            factoryId: rm.factoryId,
            rawMaterialId: rm.id,
            materialCode: rm.code,
            materialName: rm.name,
            lotNumber: l.lotNumber.trim(),
            supplierLot: l.supplierLot,
            supplierName: l.supplierName ?? rm.supplierName ?? undefined,
            quantity: q,
            remainingQty: q,
            unit: rm.unit,
            status: 'ACTIVE',
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : undefined,
            storageLocationId: l.storageLocationId ?? rm.storageLocationId ?? undefined,
            binNumber: l.binNumber,
            notes: l.notes ?? `Received for ${req.requestNumber}`,
            materialRequestId: req.id,
          },
        });
        await this.prisma.stockMovement.create({
          data: {
            factoryId: rm.factoryId,
            entityType: 'RAW_MATERIAL',
            entityId: rm.id,
            entityCode: rm.code,
            entityName: rm.name,
            movementType: 'RECEIPT',
            quantity: q,
            unitCost: rm.unitCost,
            totalCost: rm.unitCost != null ? round3(rm.unitCost * q) : null,
            stockBefore: before,
            stockAfter: after,
            referenceType: 'MATERIAL_REQUEST',
            referenceId: req.id,
            referenceNumber: req.requestNumber,
            performedById: userId,
            notes: `Lot ${lot.lotNumber} received for ${req.requestNumber}`,
          },
        });
        addQty = round3(addQty + q);
        running = after;
      }
    } else {
      addQty = dto.quantity != null ? round3(Number(dto.quantity)) : round3(Math.max(0, req.quantityShort - req.quantityFulfilled));
      if (!(addQty > 0)) throw new BadRequestException('Quantity to fulfill must be greater than zero.');
      await this.prisma.stockMovement.create({
        data: {
          factoryId: rm.factoryId,
          entityType: 'RAW_MATERIAL',
          entityId: rm.id,
          entityCode: rm.code,
          entityName: rm.name,
          movementType: 'RECEIPT',
          quantity: addQty,
          unitCost: rm.unitCost,
          totalCost: rm.unitCost != null ? round3(rm.unitCost * addQty) : null,
          stockBefore,
          stockAfter: round3(stockBefore + addQty),
          referenceType: 'MATERIAL_REQUEST',
          referenceId: req.id,
          referenceNumber: req.requestNumber,
          performedById: userId,
          notes: dto.notes ?? `Fulfilled material request ${req.requestNumber}`,
        },
      });
    }

    const stockAfter = round3(stockBefore + addQty);
    await this.prisma.rawMaterial.update({ where: { id: rm.id }, data: { currentStock: stockAfter } });

    const liveAvailable = round3(stockAfter - rm.reservedStock);
    const covered = liveAvailable + 1e-6 >= req.quantityNeeded;
    const updated = await this.prisma.materialRequest.update({
      where: { id },
      data: {
        quantityFulfilled: round3(req.quantityFulfilled + addQty),
        quantityAvailable: Math.max(0, liveAvailable),
        status: covered ? 'FULFILLED' : 'PARTIALLY_FULFILLED',
        responseNotes: dto.notes ?? req.responseNotes,
        reviewedById: userId,
        reviewedAt: new Date(),
        ...(covered && { fulfilledAt: new Date() }),
      },
    });

    await this.prisma.traceEvent.create({
      data: {
        factoryId: rm.factoryId,
        entityType: 'RAW_MATERIAL',
        entityId: rm.id,
        entityCode: rm.code,
        eventType: 'STOCK_IN',
        quantity: addQty,
        eventData: { requestNumber: req.requestNumber, fulfilled: covered, stockAfter, viaLots: useLots, lotsCreated: useLots ? dto.lots!.filter((l) => Number(l.quantity) > 0).length : 0 },
        performedById: userId,
        relatedType: 'MATERIAL_REQUEST',
        relatedId: req.id,
      },
    }).catch(() => undefined);

    if (req.workOrderId) await this.production.refreshWorkOrderMaterialStatus(req.workOrderId);
    this.eventEmitter.emit('production.material-request.fulfilled', { id, workOrderId: req.workOrderId, factoryId: req.factoryId, covered });
    return updated;
  }

  // ── Bulk actions (cancel / archive / unarchive / delete) ─────
  async bulk(
    factoryId: string | null,
    userId: string | null,
    action: 'cancel' | 'archive' | 'unarchive' | 'delete',
    ids: string[],
  ): Promise<{ affected: number }> {
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('No requests selected.');
    const where = { id: { in: ids }, ...(factoryId ? { factoryId } : {}) };
    const rows = await this.prisma.materialRequest.findMany({ where, select: { id: true, workOrderId: true, status: true } });
    if (rows.length === 0) return { affected: 0 };

    const touchedWOs = new Set<string>();
    if (action === 'delete') {
      await this.prisma.materialRequest.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      rows.forEach((r) => r.workOrderId && touchedWOs.add(r.workOrderId));
    } else if (action === 'archive') {
      await this.prisma.materialRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { archivedAt: new Date() } });
    } else if (action === 'unarchive') {
      await this.prisma.materialRequest.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { archivedAt: null } });
    } else if (action === 'cancel') {
      // Only open requests can be cancelled.
      const cancellable = rows.filter((r) => OPEN_STATUSES.includes(r.status as any));
      await this.prisma.materialRequest.updateMany({
        where: { id: { in: cancellable.map((r) => r.id) } },
        data: { status: 'CANCELLED', reviewedById: userId, reviewedAt: new Date() },
      });
      cancellable.forEach((r) => r.workOrderId && touchedWOs.add(r.workOrderId));
    }

    // cancel/delete can change a WO's material gate → refresh affected WOs.
    for (const woId of touchedWOs) await this.production.refreshWorkOrderMaterialStatus(woId);
    this.eventEmitter.emit('production.material-request.bulk', { factoryId, action, count: rows.length });
    return { affected: rows.length };
  }

  // ── Auto-resolve when raw-material stock arrives elsewhere ────
  @OnEvent('inventory.raw-material.stock-changed', { async: true })
  async onStockChanged(payload: { rawMaterialId?: string; factoryId?: string }) {
    try {
      if (!payload?.rawMaterialId) return;
      const open = await this.prisma.materialRequest.findMany({
        where: { rawMaterialId: payload.rawMaterialId, status: { in: OPEN_STATUSES as any } },
        include: { rawMaterial: { select: { currentStock: true, reservedStock: true } } },
      });
      const touchedWOs = new Set<string>();
      for (const req of open) {
        const rm: any = req.rawMaterial;
        const available = round3((rm?.currentStock ?? 0) - (rm?.reservedStock ?? 0));
        if (available + 1e-6 >= req.quantityNeeded) {
          await this.prisma.materialRequest.update({
            where: { id: req.id },
            data: { status: 'FULFILLED', quantityAvailable: Math.max(0, available), fulfilledAt: new Date(), responseNotes: req.responseNotes ?? 'Auto-resolved: stock replenished' },
          });
          if (req.workOrderId) touchedWOs.add(req.workOrderId);
        }
      }
      for (const woId of touchedWOs) await this.production.refreshWorkOrderMaterialStatus(woId);
      if (touchedWOs.size) this.logger.log(`Auto-resolved material requests for ${touchedWOs.size} work order(s) after stock replenishment`);
    } catch (err) {
      this.logger.error('Auto-resolve of material requests failed', err as Error);
    }
  }
}
