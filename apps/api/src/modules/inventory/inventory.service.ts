import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { StockMovementsService } from './stock-movements.service';
import { findProcessForSku, processCoveredSkusWhere } from '../../common/process-scope.util';
import { archivedWhere } from '../../common/archive.util';
import { type Prisma } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockMovements: StockMovementsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ────────────────────────────────────────────────────────────
  // OVERVIEW
  // ────────────────────────────────────────────────────────────

  async getOverview(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 86400000);

    const [
      totalSpareParts, totalSKUs, totalMaterialLots, parts,
      rawMaterials, lots, recentMovements,
    ] = await Promise.all([
      this.prisma.sparePart.count({ where: { ...factoryFilter, isActive: true } }),
      this.prisma.sKU.count({ where: { ...factoryFilter, isActive: true } }),
      this.prisma.materialLot.count({ where: { ...factoryFilter, status: 'ACTIVE' } }),
      this.prisma.sparePart.findMany({
        where: { ...factoryFilter, isActive: true },
        select: { stockQty: true, minStockQty: true, unitCost: true },
      }),
      this.prisma.rawMaterial.findMany({
        where: { ...factoryFilter, isActive: true },
        select: { currentStock: true, minStock: true, reorderPoint: true, unitCost: true },
      }),
      this.prisma.materialLot.findMany({
        where: { ...factoryFilter },
        select: { status: true, expiryDate: true },
      }),
      this.prisma.stockMovement.count({
        where: { ...factoryFilter, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } },
      }).catch(() => 0),
    ]);

    // Spare parts
    const sparePartsLowStock = parts.filter(p => p.stockQty <= p.minStockQty).length;
    const sparePartsValue = parts.reduce((s, p) => s + p.stockQty * (p.unitCost ?? 0), 0);

    // Raw materials
    const rawMaterialsLowStock = rawMaterials.filter(r => r.currentStock <= (r.reorderPoint ?? r.minStock)).length;
    const rawMaterialsValue = rawMaterials.reduce((s, r) => s + r.currentStock * (r.unitCost ?? 0), 0);

    // Material lots — status mix + expiry risk
    const lotsByStatus = lots.reduce((m, l) => { m[l.status] = (m[l.status] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const lotsExpiringSoon = lots.filter(l => l.expiryDate && l.expiryDate <= in30Days && l.expiryDate >= now && l.status === 'ACTIVE').length;
    const lotsExpired = lots.filter(l => l.expiryDate && l.expiryDate < now && l.status === 'ACTIVE').length;

    return {
      // legacy fields (kept for backward compatibility)
      totalSpareParts,
      lowStockCount: sparePartsLowStock + rawMaterialsLowStock,
      totalSKUs,
      totalMaterialLots,
      totalStockValue: parseFloat((sparePartsValue + rawMaterialsValue).toFixed(2)),
      // enriched breakdown
      spareParts: { total: totalSpareParts, lowStock: sparePartsLowStock, value: parseFloat(sparePartsValue.toFixed(2)) },
      rawMaterials: { total: rawMaterials.length, lowStock: rawMaterialsLowStock, value: parseFloat(rawMaterialsValue.toFixed(2)) },
      products: { total: totalSKUs },
      materialLots: { active: totalMaterialLots, byStatus: lotsByStatus, expiringSoon: lotsExpiringSoon, expired: lotsExpired },
      movementsLast7d: recentMovements,
    };
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PARTS
  // ────────────────────────────────────────────────────────────

  async findSpareParts(factoryId: string | null, filters: {
    search?: string;
    category?: string;
    lowStock?: boolean;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, category, lowStock, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.SparePartWhereInput = {
      ...archivedWhere(archived),
      ...factoryFilter,
      isActive: true,
      ...(category && { category }),
      ...(search && {
        OR: [
          { partNumber: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.sparePart.count({ where }),
      this.prisma.sparePart.findMany({
        where,
        include: {
          storageLocationRef: { select: { id: true, code: true, name: true, zone: true } },
          woConsumptions: {
            orderBy: { wo: { createdAt: 'desc' } },
            take: 1,
            include: { wo: { select: { woNumber: true, completedAt: true } } },
          },
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    let result = data.map(p => ({
      id: p.id,
      partNumber: p.partNumber,
      name: p.name,
      description: p.description,
      category: p.category,
      manufacturer: p.manufacturer,
      model: (p as any).model,
      supplier: p.supplier,
      unitCost: p.unitCost,
      stockQty: p.stockQty,
      minStockQty: p.minStockQty,
      maxStockQty: p.maxStockQty,
      storageLocation: (p as any).storageLocationRef?.name ?? p.storageLocation,
      storageLocationId: p.storageLocationId,
      storageLocationRef: (p as any).storageLocationRef ?? null,
      binNumber: p.binNumber,
      isLowStock: p.stockQty <= p.minStockQty,
      stockValue: parseFloat((p.stockQty * (p.unitCost ?? 0)).toFixed(2)),
      lastUsed: p.woConsumptions[0]?.wo?.completedAt?.toISOString() ?? null,
    }));

    if (lowStock) result = result.filter(p => p.isLowStock);

    return {
      data: result,
      total: lowStock ? result.length : total,
      page,
      limit,
      totalPages: Math.ceil((lowStock ? result.length : total) / limit),
    };
  }

  async createSparePart(factoryId: string, dto: {
    partNumber: string;
    name: string;
    description?: string;
    category?: string;
    manufacturer?: string;
    model?: string;
    supplier?: string;
    unitCost?: number;
    stockQty?: number;
    minStockQty?: number;
    maxStockQty?: number;
    storageLocation?: string;
    storageLocationId?: string;
    binNumber?: string;
  }) {
    return this.prisma.sparePart.create({ data: { factoryId, ...dto } });
  }

  async updateSparePart(factoryId: string | null, id: string, dto: Record<string, unknown>) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const part = await this.prisma.sparePart.findFirst({ where: { id, ...factoryFilter } });
    if (!part) throw new NotFoundException('Spare part not found');

    const { partNumber: _pn, factoryId: _fid, ...safe } = dto as any;
    return this.prisma.sparePart.update({ where: { id }, data: safe });
  }

  async adjustStock(factoryId: string | null, id: string, dto: {
    quantity: number;
    type: 'ADD' | 'REMOVE' | 'SET';
    reason?: string;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const part = await this.prisma.sparePart.findFirst({ where: { id, ...factoryFilter } });
    if (!part) throw new NotFoundException('Spare part not found');

    let newQty: number;
    if (dto.type === 'ADD') newQty = part.stockQty + dto.quantity;
    else if (dto.type === 'REMOVE') {
      if (part.stockQty < dto.quantity) {
        throw new BadRequestException(`Insufficient stock: ${part.stockQty} available`);
      }
      newQty = part.stockQty - dto.quantity;
    } else {
      newQty = dto.quantity;
    }

    return this.prisma.sparePart.update({ where: { id }, data: { stockQty: newQty } });
  }

  // ────────────────────────────────────────────────────────────
  // UNIFIED STOCK ADJUSTMENT (any inventory entity, any storage location)
  // ────────────────────────────────────────────────────────────

  /**
   * Single professional entry point to update/correct on-hand quantities for ANY
   * inventory entity shown in a storage location: raw materials, spare parts,
   * finished products (SKU), material lots, and finished-goods lots.
   *
   *   • mode ADD    → on-hand += quantity
   *   • mode REMOVE → on-hand -= quantity   (blocked if it would go negative)
   *   • mode SET    → on-hand  = quantity   (physical recount)
   *
   * Every adjustment writes an ADJUSTMENT row to the stock-movement ledger (the
   * audit trail), keyed to the entity's master. Lot adjustments also roll the delta
   * into the parent master's on-hand (RawMaterial / SKU) so the two never drift,
   * and flip the lot ACTIVE↔DEPLETED at the zero boundary.
   */
  async adjustInventory(
    factoryId: string | null,
    userId: string | null,
    dto: {
      entityType: 'RAW_MATERIAL' | 'SPARE_PART' | 'PRODUCT' | 'MATERIAL_LOT' | 'FINISHED_GOODS_LOT';
      entityId: string;
      mode: 'ADD' | 'REMOVE' | 'SET';
      quantity: number;
      reason?: string;
    },
  ) {
    const { entityType, entityId, mode, reason } = dto;
    const qty = Number(dto.quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new BadRequestException('Quantity must be a non-negative number');
    }
    if (!['ADD', 'REMOVE', 'SET'].includes(mode)) {
      throw new BadRequestException(`Invalid mode: ${mode}`);
    }
    const round4 = (x: number) => parseFloat(x.toFixed(4));
    const factoryFilter = factoryId ? { factoryId } : {};
    const nextOnHand = (before: number) =>
      round4(mode === 'ADD' ? before + qty : mode === 'REMOVE' ? before - qty : qty);

    switch (entityType) {
      case 'RAW_MATERIAL': {
        const rm = await this.prisma.rawMaterial.findFirst({ where: { id: entityId, ...factoryFilter, isActive: true } });
        if (!rm) throw new NotFoundException('Raw material not found');
        const before = rm.currentStock;
        const after = nextOnHand(before);
        if (after < 0) throw new BadRequestException(`Insufficient stock: ${before} ${rm.unit} available`);
        await this.prisma.rawMaterial.update({ where: { id: rm.id }, data: { currentStock: after } });
        await this.stockMovements.record({
          factoryId: rm.factoryId, entityType: 'RAW_MATERIAL', entityId: rm.id,
          entityCode: rm.code, entityName: rm.name, movementType: 'ADJUSTMENT',
          quantity: round4(after - before), unitCost: rm.unitCost ?? undefined,
          stockBefore: before, stockAfter: after, referenceType: 'MANUAL_ADJUSTMENT',
          performedById: userId, notes: reason,
        });
        this.eventEmitter.emit('inventory.raw-material.stock-changed', { rawMaterialId: rm.id, factoryId: rm.factoryId });
        return { entityType, entityId, mode, stockBefore: before, stockAfter: after, unit: rm.unit };
      }

      case 'SPARE_PART': {
        const sp = await this.prisma.sparePart.findFirst({ where: { id: entityId, ...factoryFilter, isActive: true } });
        if (!sp) throw new NotFoundException('Spare part not found');
        const before = sp.stockQty;
        const after = nextOnHand(before);
        if (after < 0) throw new BadRequestException(`Insufficient stock: ${before} available`);
        await this.prisma.sparePart.update({ where: { id: sp.id }, data: { stockQty: after } });
        await this.stockMovements.record({
          factoryId: sp.factoryId, entityType: 'SPARE_PART', entityId: sp.id,
          entityCode: sp.partNumber, entityName: sp.name, movementType: 'ADJUSTMENT',
          quantity: round4(after - before), unitCost: sp.unitCost ?? undefined,
          stockBefore: before, stockAfter: after, referenceType: 'MANUAL_ADJUSTMENT',
          performedById: userId, notes: reason,
        });
        return { entityType, entityId, mode, stockBefore: before, stockAfter: after };
      }

      case 'PRODUCT': {
        const sku = await this.prisma.sKU.findFirst({ where: { id: entityId, ...factoryFilter } });
        if (!sku) throw new NotFoundException('Product not found');
        const before = sku.currentStock ?? 0;
        const after = nextOnHand(before);
        if (after < 0) throw new BadRequestException(`Insufficient stock: ${before} ${sku.baseUnit} available`);
        await this.prisma.sKU.update({ where: { id: sku.id }, data: { currentStock: after } });
        await this.stockMovements.record({
          factoryId: sku.factoryId, entityType: 'PRODUCT', entityId: sku.id,
          entityCode: sku.code, entityName: sku.name, movementType: 'ADJUSTMENT',
          quantity: round4(after - before), stockBefore: before, stockAfter: after,
          referenceType: 'MANUAL_ADJUSTMENT', performedById: userId, notes: reason,
        });
        return { entityType, entityId, mode, stockBefore: before, stockAfter: after, unit: sku.baseUnit };
      }

      case 'MATERIAL_LOT': {
        const lot = await this.prisma.materialLot.findFirst({
          where: { id: entityId, ...factoryFilter },
          include: { rawMaterial: { select: { id: true, code: true, name: true, currentStock: true, unitCost: true } } },
        });
        if (!lot) throw new NotFoundException('Material lot not found');
        const before = lot.remainingQty ?? 0;
        const after = nextOnHand(before);
        if (after < 0) throw new BadRequestException(`Cannot reduce below zero: ${before} ${lot.unit} remaining`);
        const delta = round4(after - before);
        const rm = (lot as any).rawMaterial as { id: string; code: string; name: string; currentStock: number; unitCost: number | null } | null;
        await this.prisma.$transaction(async (tx) => {
          await tx.materialLot.update({
            where: { id: lot.id },
            data: { remainingQty: after, ...(after <= 0 ? { status: 'DEPLETED' } : lot.status === 'DEPLETED' ? { status: 'ACTIVE' } : {}) },
          });
          if (rm) await tx.rawMaterial.update({ where: { id: rm.id }, data: { currentStock: { increment: delta } } });
        });
        await this.stockMovements.record({
          factoryId: lot.factoryId, entityType: 'RAW_MATERIAL', entityId: rm?.id ?? lot.id,
          entityCode: rm?.code ?? lot.materialCode, entityName: rm?.name ?? lot.materialName,
          movementType: 'ADJUSTMENT', quantity: delta, unitCost: rm?.unitCost ?? undefined,
          stockBefore: rm?.currentStock, stockAfter: rm ? round4(rm.currentStock + delta) : undefined,
          referenceType: 'MATERIAL_LOT', referenceId: lot.id, referenceNumber: lot.lotNumber,
          performedById: userId, notes: reason ? `Lot ${lot.lotNumber}: ${reason}` : `Lot ${lot.lotNumber} adjusted`,
        });
        if (rm) this.eventEmitter.emit('inventory.raw-material.stock-changed', { rawMaterialId: rm.id, factoryId: lot.factoryId });
        return { entityType, entityId, mode, stockBefore: before, stockAfter: after, unit: lot.unit };
      }

      case 'FINISHED_GOODS_LOT': {
        const lot = await this.prisma.finishedGoodsLot.findFirst({
          where: { id: entityId, ...factoryFilter },
          include: { sku: { select: { id: true, code: true, name: true, currentStock: true } } },
        });
        if (!lot) throw new NotFoundException('Finished goods lot not found');
        const before = lot.remainingQty ?? 0;
        const after = nextOnHand(before);
        if (after < 0) throw new BadRequestException(`Cannot reduce below zero: ${before} ${lot.unit} remaining`);
        const delta = round4(after - before);
        const sku = (lot as any).sku as { id: string; code: string; name: string; currentStock: number | null };
        await this.prisma.$transaction(async (tx) => {
          await tx.finishedGoodsLot.update({
            where: { id: lot.id },
            data: { remainingQty: after, ...(after <= 0 ? { status: 'DEPLETED' } : lot.status === 'DEPLETED' ? { status: 'ACTIVE' } : {}) },
          });
          await tx.sKU.update({ where: { id: lot.skuId }, data: { currentStock: { increment: delta } } });
        });
        await this.stockMovements.record({
          factoryId: lot.factoryId, entityType: 'PRODUCT', entityId: lot.skuId,
          entityCode: sku.code, entityName: sku.name, movementType: 'ADJUSTMENT',
          quantity: delta, stockBefore: sku.currentStock ?? 0, stockAfter: round4((sku.currentStock ?? 0) + delta),
          referenceType: 'FINISHED_GOODS_LOT', referenceId: lot.id, referenceNumber: lot.lotNumber,
          performedById: userId, notes: reason ? `Lot ${lot.lotNumber}: ${reason}` : `Lot ${lot.lotNumber} adjusted`,
        });
        return { entityType, entityId, mode, stockBefore: before, stockAfter: after, unit: lot.unit };
      }

      default:
        throw new BadRequestException(`Unsupported entity type: ${entityType}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCTS (SKUs)
  // ────────────────────────────────────────────────────────────

  async findProducts(factoryId: string | null, filters: {
    search?: string;
    category?: string;
    brand?: string;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, category, brand, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.SKUWhereInput = {
      ...archivedWhere(archived),
      ...factoryFilter,
      isActive: true,
      ...(category && { category }),
      ...(brand && { brand }),
      ...(search && {
        OR: [
          { itemNumber: { contains: search, mode: 'insensitive' as const } },
          { code: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.sKU.count({ where }),
      this.prisma.sKU.findMany({
        where,
        include: {
          family: { select: { name: true, brand: true, category: true } },
          bomComponents: {
            where: { isActive: true },
            select: { componentCode: true, componentName: true, quantity: true, unit: true, type: true },
          },
          storageLocationRef: { select: { id: true, code: true, name: true, zone: true } },
          categoryRef: { select: { id: true, name: true } },
          brandRef: { select: { id: true, name: true } },
          packagingTypeRef: { select: { id: true, name: true } },
          baseUnitRef: { select: { id: true, code: true, name: true } },
          baseWeightRef: { select: { id: true, value: true, unit: true, label: true } },
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ────────────────────────────────────────────────────────────
  // MATERIAL LOTS
  // ────────────────────────────────────────────────────────────

  async findMaterials(factoryId: string | null, filters: {
    search?: string;
    status?: string;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.MaterialLotWhereInput = {
      ...archivedWhere(archived),
      ...factoryFilter,
      ...(status && { status: status as any }),
      ...(search && {
        OR: [
          { materialCode: { contains: search, mode: 'insensitive' as const } },
          { materialName: { contains: search, mode: 'insensitive' as const } },
          { lotNumber: { contains: search, mode: 'insensitive' as const } },
          { supplierName: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, rawData] = await Promise.all([
      this.prisma.materialLot.count({ where }),
      (this.prisma.materialLot.findMany as any)({
        where,
        include: { storageLocationRef: { select: { id: true, code: true, name: true, zone: true } } },
        orderBy: [{ receivedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const data: any[] = rawData;

    const now = new Date();
    return {
      data: data.map(lot => ({
        ...lot,
        storageLocation: lot.storageLocationRef?.name ?? lot.storageLocation,
        storageLocationId: lot.storageLocationId ?? null,
        storageLocationRef: lot.storageLocationRef ?? null,
        utilizationPct: lot.quantity > 0
          ? parseFloat(((1 - lot.remainingQty / lot.quantity) * 100).toFixed(1))
          : 0,
        isExpired: lot.expiryDate ? lot.expiryDate < now : false,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createMaterialLot(factoryId: string, dto: {
    rawMaterialId?: string;
    materialCode?: string;
    materialName?: string;
    lotNumber: string;
    supplierLot?: string;
    supplierName?: string;
    quantity: number;
    unit?: string;
    expiryDate?: string;
    storageLocation?: string;
    storageLocationId?: string;
    notes?: string;
  }) {
    // Auto-resolve materialCode/materialName/unit from RawMaterial master if rawMaterialId provided
    let resolvedCode = dto.materialCode ?? '';
    let resolvedName = dto.materialName ?? '';
    let resolvedUnit = dto.unit ?? 'KG';
    let master: { id: string; code: string; name: string; unit: string; currentStock: number; unitCost: number | null } | null = null;

    if (dto.rawMaterialId) {
      master = await this.prisma.rawMaterial.findUnique({
        where: { id: dto.rawMaterialId },
        select: { id: true, code: true, name: true, unit: true, currentStock: true, unitCost: true },
      });
      if (master) {
        resolvedCode = master.code;
        resolvedName = master.name;
        resolvedUnit = dto.unit ?? master.unit;
      }
    }

    // Create the lot and, when linked to a master, roll its quantity into the
    // RawMaterial.currentStock in one transaction so the two never drift apart.
    const lot = await this.prisma.$transaction(async (tx) => {
      const created = await (tx.materialLot.create as any)({
        data: {
          factoryId,
          rawMaterialId: dto.rawMaterialId ?? null,
          materialCode: resolvedCode,
          materialName: resolvedName,
          lotNumber: dto.lotNumber,
          supplierLot: dto.supplierLot,
          supplierName: dto.supplierName,
          quantity: dto.quantity,
          remainingQty: dto.quantity,
          unit: resolvedUnit,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          storageLocation: dto.storageLocation,
          storageLocationId: dto.storageLocationId ?? null,
          notes: dto.notes,
        },
      });
      if (master) {
        await tx.rawMaterial.update({
          where: { id: master.id },
          data: { currentStock: { increment: dto.quantity } },
        });
      }
      return created;
    });

    // Ledger entry for the master stock increase (fire-and-forget; never blocks receipt).
    if (master) {
      await this.stockMovements.record({
        factoryId,
        entityType: 'RAW_MATERIAL',
        entityId: master.id,
        entityCode: master.code,
        entityName: master.name,
        movementType: 'RECEIPT',
        quantity: dto.quantity,
        unitCost: master.unitCost ?? undefined,
        stockBefore: master.currentStock,
        stockAfter: parseFloat((master.currentStock + dto.quantity).toFixed(4)),
        referenceType: 'MATERIAL_LOT',
        referenceId: lot.id,
        referenceNumber: dto.lotNumber,
        notes: `Lot ${dto.lotNumber} received`,
      });
      // Receipt may clear open WO material-shortage requests → auto-resolve.
      this.eventEmitter.emit('inventory.raw-material.stock-changed', { rawMaterialId: master.id, factoryId });
    }

    return lot;
  }

  async deleteMaterialLot(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const lot = await this.prisma.materialLot.findFirst({
      where: { id, ...factoryFilter },
      include: { rawMaterial: { select: { id: true, code: true, name: true, currentStock: true, unitCost: true } } },
    });
    if (!lot) throw new NotFoundException('Material lot not found');

    // Reverse the receipt rollup: remove the lot's remaining quantity from the
    // master so deleting a received lot does not leave the stock inflated.
    const master = (lot as any).rawMaterial as
      | { id: string; code: string; name: string; currentStock: number; unitCost: number | null }
      | null;
    const reverseQty = Math.min(master?.currentStock ?? 0, lot.remainingQty);

    await this.prisma.$transaction(async (tx) => {
      await tx.materialLot.delete({ where: { id } });
      if (master && reverseQty > 0) {
        await tx.rawMaterial.update({
          where: { id: master.id },
          data: { currentStock: { decrement: reverseQty } },
        });
      }
    });

    if (master && reverseQty > 0) {
      await this.stockMovements.record({
        factoryId: lot.factoryId,
        entityType: 'RAW_MATERIAL',
        entityId: master.id,
        entityCode: master.code,
        entityName: master.name,
        movementType: 'ADJUSTMENT',
        quantity: -reverseQty,
        unitCost: master.unitCost ?? undefined,
        stockBefore: master.currentStock,
        stockAfter: parseFloat((master.currentStock - reverseQty).toFixed(4)),
        referenceType: 'MATERIAL_LOT',
        referenceId: lot.id,
        referenceNumber: lot.lotNumber,
        notes: `Lot ${lot.lotNumber} deleted — remaining qty reversed`,
      });
    }
  }

  async deleteSparePart(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const part = await this.prisma.sparePart.findFirst({ where: { id, ...factoryFilter } });
    if (!part) throw new NotFoundException('Spare part not found');
    await this.prisma.sparePart.delete({ where: { id } });
  }

  async createProduct(factoryId: string | null, dto: {
    code: string; name: string; nameAr?: string; shortName?: string;
    itemNumber?: string; category?: string; brand?: string;
    categoryId?: string | null; brandId?: string | null; packagingTypeId?: string | null;
    baseUnitId?: string | null; baseWeightId?: string | null;
    unit?: string; weight?: number; weightUnit?: string;
    length?: number; width?: number; height?: number; dimensionUnit?: string;
    packagingType?: string;
    unitsPerInner?: number; innersPerCarton?: number; cartonsPerPallet?: number;
    storageLocationId?: string;
  }) {
    const resolvedFactoryId = factoryId ?? await this.getDefaultFactoryId();
    const refs = await this.resolveMasterRefs(resolvedFactoryId, dto);
    return this.prisma.sKU.create({
      data: {
        factoryId: resolvedFactoryId,
        code: dto.code,
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        shortName: dto.shortName ?? null,
        itemNumber: dto.itemNumber ?? dto.code,
        category: dto.category,
        brand: dto.brand,
        baseUnit: dto.unit ?? 'PCS',
        weight: dto.weight ?? null,
        weightUnit: dto.weightUnit ?? 'kg',
        length: dto.length ?? null,
        width: dto.width ?? null,
        height: dto.height ?? null,
        dimensionUnit: dto.dimensionUnit ?? 'cm',
        packagingType: dto.packagingType,
        unitsPerInner: dto.unitsPerInner ?? 1,
        innersPerCarton: dto.innersPerCarton ?? 1,
        cartonsPerPallet: dto.cartonsPerPallet ?? 1,
        storageLocationId: dto.storageLocationId ?? null,
        isActive: true,
        ...refs, // FK ids + synced legacy texts/weight (wins over raw strings)
      },
    });
  }

  async updateProduct(factoryId: string | null, id: string, dto: {
    name?: string; nameAr?: string | null; shortName?: string | null;
    category?: string; brand?: string; unit?: string;
    categoryId?: string | null; brandId?: string | null; packagingTypeId?: string | null;
    baseUnitId?: string | null; baseWeightId?: string | null;
    weight?: number | null; weightUnit?: string;
    length?: number | null; width?: number | null; height?: number | null; dimensionUnit?: string;
    unitsPerInner?: number; innersPerCarton?: number; cartonsPerPallet?: number;
    packagingType?: string;
    storageLocationId?: string | null;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const sku = await this.prisma.sKU.findFirst({ where: { id, ...factoryFilter } });
    if (!sku) throw new NotFoundException('Product not found');
    const refs = await this.resolveMasterRefs(sku.factoryId, dto);
    return this.prisma.sKU.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.shortName !== undefined && { shortName: dto.shortName }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.brand !== undefined && { brand: dto.brand }),
        ...(dto.unit && { baseUnit: dto.unit }),
        ...(dto.weight !== undefined && { weight: dto.weight }),
        ...(dto.weightUnit && { weightUnit: dto.weightUnit }),
        ...(dto.length !== undefined && { length: dto.length }),
        ...(dto.width !== undefined && { width: dto.width }),
        ...(dto.height !== undefined && { height: dto.height }),
        ...(dto.dimensionUnit && { dimensionUnit: dto.dimensionUnit }),
        ...(dto.unitsPerInner !== undefined && { unitsPerInner: dto.unitsPerInner }),
        ...(dto.innersPerCarton !== undefined && { innersPerCarton: dto.innersPerCarton }),
        ...(dto.cartonsPerPallet !== undefined && { cartonsPerPallet: dto.cartonsPerPallet }),
        ...(dto.packagingType !== undefined && { packagingType: dto.packagingType }),
        ...(dto.storageLocationId !== undefined && { storageLocationId: dto.storageLocationId }),
        ...refs,
      },
    });
  }

  async deleteProduct(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const sku = await this.prisma.sKU.findFirst({ where: { id, ...factoryFilter } });
    if (!sku) throw new NotFoundException('Product not found');
    await this.prisma.sKU.update({ where: { id }, data: { isActive: false } });
  }

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    if (!factory) throw new NotFoundException('No active factory found');
    return factory.id;
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCT MASTER DATA (Category / Brand / Packaging / Base Unit / Base Weight)
  // ────────────────────────────────────────────────────────────

  /** All five lookup lists in one call (powers the product form dropdowns). */
  async getProductMasterData(factoryId: string | null) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const where = { factoryId: fid, isActive: true };
    const order = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];
    const [categories, brands, packagingTypes, baseUnits, baseWeights, units] = await Promise.all([
      this.prisma.productCategory.findMany({ where, orderBy: order }),
      this.prisma.productBrand.findMany({ where, orderBy: order }),
      this.prisma.packagingType.findMany({ where, orderBy: order }),
      this.prisma.baseUnit.findMany({ where, orderBy: order }),
      this.prisma.baseWeight.findMany({ where, orderBy: [{ value: 'asc' }] }),
      this.prisma.unitOfMeasure.findMany({ where, orderBy: order }),
    ]);
    return { categories, brands, packagingTypes, baseUnits, baseWeights, units };
  }

  /**
   * Convert a quantity between two units of the SAME category via their
   * canonical conversion factors (G → KG → TON …). PACKAGING units convert
   * through the SKU ladder in production.service, not here.
   */
  async convertUom(factoryId: string | null, qty: number, fromCode: string, toCode: string) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const norm = (c: string) => (c || '').trim().toUpperCase();
    const [from, to] = await Promise.all([
      this.prisma.unitOfMeasure.findUnique({ where: { factoryId_code: { factoryId: fid, code: norm(fromCode) } } }),
      this.prisma.unitOfMeasure.findUnique({ where: { factoryId_code: { factoryId: fid, code: norm(toCode) } } }),
    ]);
    if (!from || !to) throw new BadRequestException(`Unknown unit: ${!from ? fromCode : toCode}`);
    if (from.category !== to.category) {
      throw new BadRequestException(`Cannot convert ${from.code} (${from.category}) → ${to.code} (${to.category})`);
    }
    if (from.category === 'PACKAGING') {
      throw new BadRequestException('PACKAGING units convert through the SKU packaging hierarchy (units per inner / carton / pallet)');
    }
    const result = (qty * from.conversionFactor) / to.conversionFactor;
    return { qty, from: from.code, to: to.code, result: Number(result.toFixed(to.decimals)) };
  }

  /**
   * Server-side auto-fetch for step input materials: a row linked to a raw
   * material inherits code/name/unit (+ unified unitId) from the master, so the
   * unit can never drift from the material record. Free-text rows resolve their
   * unitId by code when one matches.
   */
  private async stepMaterialMapper(
    factoryId: string,
    steps?: Array<{ materials?: Array<{ rawMaterialId?: string; materialCode?: string; name: string; qtyPerOutputUnit: number; unit?: string }> }>,
  ) {
    const ids = Array.from(new Set(
      (steps ?? []).flatMap((s) => (s.materials ?? []).map((m) => m.rawMaterialId).filter(Boolean)),
    )) as string[];
    const [masters, units] = await Promise.all([
      ids.length
        ? this.prisma.rawMaterial.findMany({
            where: { id: { in: ids }, factoryId },
            select: { id: true, code: true, name: true, unit: true, unitId: true },
          })
        : Promise.resolve([]),
      this.prisma.unitOfMeasure.findMany({ where: { factoryId }, select: { id: true, code: true } }),
    ]);
    const byId = new Map(masters.map((m) => [m.id, m]));
    const unitByCode = new Map(units.map((u) => [u.code, u.id]));
    return (m: { rawMaterialId?: string; materialCode?: string; name: string; qtyPerOutputUnit: number; unit?: string }) => {
      const master = m.rawMaterialId ? byId.get(m.rawMaterialId) : undefined;
      const unit = master?.unit ?? m.unit ?? 'KG';
      return {
        rawMaterialId: master?.id ?? null,
        materialCode: master?.code ?? m.materialCode ?? null,
        name: master?.name ?? m.name,
        qtyPerOutputUnit: m.qtyPerOutputUnit,
        unit,
        unitId: master?.unitId ?? unitByCode.get(unit.trim().toUpperCase()) ?? null,
      };
    };
  }

  /**
   * Reverse of the legacy machine-from-workcenter heuristic: find the CELL
   * work center that represents each step's default machine (name/code
   * containment). The form now picks machines directly, but routing views and
   * the downtime cascade still join on workCenterId — keep it auto-linked.
   */
  private async workCenterByMachineMap(
    factoryId: string,
    steps?: Array<{ machineId?: string | null; workCenterId?: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = Array.from(new Set(
      (steps ?? []).filter((s) => s.machineId && !s.workCenterId).map((s) => s.machineId!),
    ));
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const [machines, wcs] = await Promise.all([
      this.prisma.machine.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } }),
      this.prisma.workCenter.findMany({ where: { factoryId, isActive: true }, select: { id: true, name: true, code: true } }),
    ]);
    for (const m of machines) {
      const mName = m.name.toLowerCase();
      const mCodeTail = m.code.replace(/^.*?-(M\d+)-?/i, '$1').toLowerCase();
      const wc =
        wcs.find((w) => w.name.toLowerCase().includes(mName)) ??
        wcs.find((w) => mName.includes(w.name.replace(/\s+cell$/i, '').trim().toLowerCase())) ??
        wcs.find((w) => mCodeTail && w.code.toLowerCase().includes(mCodeTail));
      if (wc) map.set(m.id, wc.id);
    }
    return map;
  }

  /**
   * Primary + alternative machine options for a step. The step's machineId is
   * always the default (priority 0); alternatives keep their preference order.
   */
  private machineOptionRows(s: {
    machineId?: string | null;
    machineOptions?: Array<{ machineId: string; priority?: number; cycleTimeSec?: number; setupTimeMins?: number }>;
  }) {
    const rows: Array<{ machineId: string; priority: number; isDefault: boolean; cycleTimeSec: number | null; setupTimeMins: number | null }> = [];
    if (s.machineId) rows.push({ machineId: s.machineId, priority: 0, isDefault: true, cycleTimeSec: null, setupTimeMins: null });
    (s.machineOptions ?? [])
      .filter((o) => o.machineId && o.machineId !== s.machineId)
      .forEach((o, i) => rows.push({
        machineId: o.machineId,
        priority: o.priority ?? i + 1,
        isDefault: false,
        cycleTimeSec: o.cycleTimeSec ?? null,
        setupTimeMins: o.setupTimeMins ?? null,
      }));
    return rows;
  }

  private masterDelegate(entity: string): { d: any; label: string } {
    const map: Record<string, { d: any; label: string }> = {
      'categories': { d: this.prisma.productCategory, label: 'Category' },
      'brands': { d: this.prisma.productBrand, label: 'Brand' },
      'packaging-types': { d: this.prisma.packagingType, label: 'Packaging type' },
      'base-units': { d: this.prisma.baseUnit, label: 'Base unit' },
      'base-weights': { d: this.prisma.baseWeight, label: 'Base weight' },
      'units': { d: this.prisma.unitOfMeasure, label: 'Unit of measure' },
    };
    const found = map[entity];
    if (!found) throw new BadRequestException(`Unknown master-data entity: ${entity}`);
    return found;
  }

  async createMasterItem(factoryId: string | null, entity: string, dto: {
    name?: string; nameAr?: string; code?: string; value?: number; unit?: string; sortOrder?: number;
    category?: string; baseUnitCode?: string; conversionFactor?: number; decimals?: number;
  }) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const { d, label } = this.masterDelegate(entity);

    if (entity === 'units') {
      const code = (dto.code ?? dto.name ?? '').trim().toUpperCase();
      if (!code) throw new BadRequestException('Unit code is required');
      const category = (dto.category ?? 'COUNT').toUpperCase();
      return d.upsert({
        where: { factoryId_code: { factoryId: fid, code } },
        update: {
          isActive: true,
          ...(dto.name && { name: dto.name }),
          ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
          ...(dto.category && { category }),
          ...(dto.baseUnitCode !== undefined && { baseUnitCode: dto.baseUnitCode }),
          ...(dto.conversionFactor !== undefined && { conversionFactor: dto.conversionFactor }),
        },
        create: {
          factoryId: fid, code, name: dto.name ?? code, nameAr: dto.nameAr ?? null,
          category, baseUnitCode: dto.baseUnitCode ?? null,
          conversionFactor: dto.conversionFactor ?? 1, decimals: dto.decimals ?? 3,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    }
    if (entity === 'base-weights') {
      if (dto.value == null || dto.value <= 0) throw new BadRequestException('Base weight value is required');
      const unit = dto.unit ?? 'kg';
      return d.upsert({
        where: { factoryId_value_unit: { factoryId: fid, value: dto.value, unit } },
        update: { isActive: true, label: dto.name ?? `${dto.value} ${unit.toUpperCase() === 'KG' ? 'Kg' : unit}` },
        create: { factoryId: fid, value: dto.value, unit, label: dto.name ?? `${dto.value} Kg`, sortOrder: dto.sortOrder ?? 0 },
      });
    }
    if (entity === 'base-units') {
      const code = (dto.code ?? dto.name ?? '').trim().toUpperCase();
      if (!code) throw new BadRequestException('Base unit code is required');
      return d.upsert({
        where: { factoryId_code: { factoryId: fid, code } },
        update: { isActive: true, name: dto.name ?? code },
        create: { factoryId: fid, code, name: dto.name ?? code, sortOrder: dto.sortOrder ?? 0 },
      });
    }
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException(`${label} name is required`);
    return d.upsert({
      where: { factoryId_name: { factoryId: fid, name } },
      update: { isActive: true, ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }) },
      create: { factoryId: fid, name, nameAr: dto.nameAr ?? null, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async updateMasterItem(factoryId: string | null, entity: string, id: string, dto: {
    name?: string; nameAr?: string; code?: string; value?: number; unit?: string; sortOrder?: number; isActive?: boolean;
    category?: string; baseUnitCode?: string; conversionFactor?: number; decimals?: number;
  }) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const { d, label } = this.masterDelegate(entity);
    const item = await d.findFirst({ where: { id, factoryId: fid } });
    if (!item) throw new NotFoundException(`${label} not found`);
    const data: Record<string, unknown> = {
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    if (entity === 'base-weights') {
      Object.assign(data,
        dto.value !== undefined && { value: dto.value },
        dto.unit && { unit: dto.unit },
        dto.name !== undefined && { label: dto.name });
    } else if (entity === 'base-units') {
      Object.assign(data,
        dto.code && { code: dto.code.trim().toUpperCase() },
        dto.name !== undefined && { name: dto.name });
    } else if (entity === 'units') {
      Object.assign(data,
        dto.code && { code: dto.code.trim().toUpperCase() },
        dto.name !== undefined && { name: dto.name },
        dto.nameAr !== undefined && { nameAr: dto.nameAr },
        dto.category && { category: dto.category.toUpperCase() },
        dto.baseUnitCode !== undefined && { baseUnitCode: dto.baseUnitCode },
        dto.conversionFactor !== undefined && { conversionFactor: dto.conversionFactor },
        dto.decimals !== undefined && { decimals: dto.decimals });
    } else {
      Object.assign(data,
        dto.name && { name: dto.name.trim() },
        dto.nameAr !== undefined && { nameAr: dto.nameAr });
    }
    const updated = await d.update({ where: { id }, data });
    await this.syncLegacyProductTexts(entity, updated);
    return updated;
  }

  async deleteMasterItem(factoryId: string | null, entity: string, id: string) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const { d, label } = this.masterDelegate(entity);
    const usageSelect = entity === 'units'
      ? { rawMaterials: true, bomItems: true, routingStepMaterials: true, materialLots: true }
      : { skus: true };
    const item = await d.findFirst({ where: { id, factoryId: fid }, include: { _count: { select: usageSelect } } });
    if (!item) throw new NotFoundException(`${label} not found`);
    const usedBy = Object.values(item._count as Record<string, number>).reduce((a, b) => a + b, 0);
    if (usedBy > 0) {
      // In use → soft-disable so existing records keep their reference
      await d.update({ where: { id }, data: { isActive: false } });
      return { id, disabled: true, usedBy };
    }
    await d.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Renaming a lookup keeps the SKUs' legacy text columns in sync. */
  private async syncLegacyProductTexts(entity: string, item: any) {
    if (entity === 'categories') {
      await this.prisma.sKU.updateMany({ where: { categoryId: item.id }, data: { category: item.name } });
    } else if (entity === 'brands') {
      await this.prisma.sKU.updateMany({ where: { brandId: item.id }, data: { brand: item.name } });
    } else if (entity === 'packaging-types') {
      await this.prisma.sKU.updateMany({ where: { packagingTypeId: item.id }, data: { packagingType: item.name } });
    } else if (entity === 'base-units') {
      await this.prisma.sKU.updateMany({ where: { baseUnitId: item.id }, data: { baseUnit: item.code } });
    } else if (entity === 'base-weights') {
      await this.prisma.sKU.updateMany({ where: { baseWeightId: item.id }, data: { weight: item.value, weightUnit: item.unit } });
    } else if (entity === 'units') {
      // Renaming a unit code propagates to every legacy text column referencing it
      await Promise.all([
        this.prisma.rawMaterial.updateMany({ where: { unitId: item.id }, data: { unit: item.code } }),
        this.prisma.materialLot.updateMany({ where: { unitId: item.id }, data: { unit: item.code } }),
        this.prisma.routingStepMaterial.updateMany({ where: { unitId: item.id }, data: { unit: item.code } }),
        this.prisma.bOMItem.updateMany({ where: { unitId: item.id }, data: { unit: item.code } }),
      ]);
    }
  }

  /** Resolve master FK ids → legacy text values so both stay consistent. */
  private async resolveMasterRefs(fid: string, dto: {
    categoryId?: string | null; brandId?: string | null; packagingTypeId?: string | null;
    baseUnitId?: string | null; baseWeightId?: string | null;
  }) {
    const out: Record<string, unknown> = {};
    if (dto.categoryId !== undefined) {
      out.categoryId = dto.categoryId;
      out.category = dto.categoryId
        ? (await this.prisma.productCategory.findFirst({ where: { id: dto.categoryId, factoryId: fid } }))?.name ?? null
        : null;
    }
    if (dto.brandId !== undefined) {
      out.brandId = dto.brandId;
      out.brand = dto.brandId
        ? (await this.prisma.productBrand.findFirst({ where: { id: dto.brandId, factoryId: fid } }))?.name ?? null
        : null;
    }
    if (dto.packagingTypeId !== undefined) {
      out.packagingTypeId = dto.packagingTypeId;
      out.packagingType = dto.packagingTypeId
        ? (await this.prisma.packagingType.findFirst({ where: { id: dto.packagingTypeId, factoryId: fid } }))?.name ?? null
        : null;
    }
    if (dto.baseUnitId !== undefined) {
      out.baseUnitId = dto.baseUnitId;
      if (dto.baseUnitId) {
        const u = await this.prisma.baseUnit.findFirst({ where: { id: dto.baseUnitId, factoryId: fid } });
        if (u) out.baseUnit = u.code;
      }
    }
    if (dto.baseWeightId !== undefined) {
      out.baseWeightId = dto.baseWeightId;
      if (dto.baseWeightId) {
        const w = await this.prisma.baseWeight.findFirst({ where: { id: dto.baseWeightId, factoryId: fid } });
        if (w) { out.weight = w.value; out.weightUnit = w.unit; }
      }
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────
  // STORAGE LOCATIONS
  // ────────────────────────────────────────────────────────────

  async findStorageLocations(factoryId: string | null, filters: {
    zone?: string; search?: string; page?: number; limit?: number;
  }) {
    const { zone, search, page = 1, limit = 50 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.StorageLocationWhereInput = {
      ...factoryFilter,
      isActive: true,
      ...(zone && { zone: zone as any }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.storageLocation.count({ where }),
      this.prisma.storageLocation.findMany({
        where,
        include: {
          _count: {
            select: { rawMaterials: true, materialLots: true, spareParts: true },
          },
        },
        orderBy: [{ zone: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map(l => ({
        id: l.id,
        code: l.code,
        name: l.name,
        zone: l.zone,
        description: l.description,
        capacity: l.capacity,
        isActive: l.isActive,
        createdAt: l.createdAt,
        rawMaterialCount: l._count.rawMaterials,
        materialLotCount: l._count.materialLots,
        sparePartCount: l._count.spareParts,
        totalItems: l._count.rawMaterials + l._count.materialLots + l._count.spareParts,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createStorageLocation(factoryId: string, dto: {
    code: string; name: string; zone: string; description?: string; capacity?: number;
  }) {
    return this.prisma.storageLocation.create({
      data: {
        factoryId,
        code: dto.code,
        name: dto.name,
        zone: dto.zone as any,
        description: dto.description,
        capacity: dto.capacity,
      },
    });
  }

  async updateStorageLocation(factoryId: string | null, id: string, dto: {
    name?: string; zone?: string; description?: string; capacity?: number; isActive?: boolean;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const loc = await this.prisma.storageLocation.findFirst({ where: { id, ...factoryFilter } });
    if (!loc) throw new NotFoundException('Storage location not found');

    return this.prisma.storageLocation.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.zone && { zone: dto.zone as any }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteStorageLocation(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const loc = await this.prisma.storageLocation.findFirst({ where: { id, ...factoryFilter } });
    if (!loc) throw new NotFoundException('Storage location not found');
    await this.prisma.storageLocation.update({ where: { id }, data: { isActive: false } });
  }

  async getLocationContents(factoryId: string | null, id: string) {
    const where = factoryId ? { id, factoryId } : { id };
    const loc = await this.prisma.storageLocation.findFirst({
      where,
      include: {
        rawMaterials: {
          where: { isActive: true },
          select: { id: true, code: true, name: true, category: true, unit: true, currentStock: true, minStock: true, unitCost: true },
          orderBy: { name: 'asc' },
        },
        materialLots: {
          select: {
            id: true, lotNumber: true, materialCode: true, materialName: true,
            quantity: true, remainingQty: true, unit: true, status: true,
            receivedAt: true, expiryDate: true, binNumber: true,
            rawMaterial: { select: { code: true, name: true, category: true } },
          },
          orderBy: { receivedAt: 'desc' },
        },
        spareParts: {
          where: { isActive: true },
          select: { id: true, partNumber: true, name: true, category: true, stockQty: true, minStockQty: true, unitCost: true, binNumber: true },
          orderBy: { name: 'asc' },
        },
        skus: {
          where: { isActive: true },
          select: { id: true, code: true, name: true, itemNumber: true, category: true, currentStock: true, baseUnit: true },
          orderBy: { name: 'asc' },
        },
        finishedGoodsLots: {
          where: { status: 'ACTIVE', remainingQty: { gt: 0 } },
          select: {
            id: true, lotNumber: true, quantity: true, remainingQty: true, unit: true,
            producedQty: true, producedUnit: true, producedAt: true, expiryDate: true,
            sku: { select: { code: true, name: true, itemNumber: true } },
            workOrder: { select: { orderNumber: true } },
          },
          orderBy: { producedAt: 'desc' },
          take: 200,
        },
      },
    });
    if (!loc) throw new NotFoundException('Storage location not found');

    const rawMaterials = (loc as any).rawMaterials as { id: string; code: string; name: string; category: string | null; unit: string; currentStock: number; minStock: number; unitCost: number | null }[];
    const materialLots = (loc as any).materialLots as { id: string; lotNumber: string; materialCode: string; materialName: string; quantity: number; remainingQty: number | null; unit: string; status: string; receivedAt: Date; expiryDate: Date | null; binNumber: string | null; rawMaterial: { code: string; name: string; category: string | null } | null }[];
    const spareParts = (loc as any).spareParts as { id: string; partNumber: string; name: string; category: string | null; stockQty: number; minStockQty: number; unitCost: number | null; binNumber: string | null }[];
    const skus = (loc as any).skus as { id: string; code: string; name: string; itemNumber: string | null; category: string | null; currentStock?: number; baseUnit?: string }[];
    const finishedGoodsLots = (loc as any).finishedGoodsLots ?? [];

    const stockValue =
      rawMaterials.reduce((s, r) => s + r.currentStock * (r.unitCost ?? 0), 0) +
      materialLots.reduce((s, m) => s + (m.remainingQty ?? 0), 0) +
      spareParts.reduce((s, p) => s + p.stockQty * (p.unitCost ?? 0), 0);

    return {
      id: loc.id,
      code: loc.code,
      name: loc.name,
      zone: loc.zone,
      description: loc.description,
      capacity: loc.capacity,
      isActive: loc.isActive,
      stockValue: parseFloat(stockValue.toFixed(2)),
      rawMaterials: rawMaterials.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name,
        category: r.category,
        unit: r.unit,
        stockQty: r.currentStock,
        minStockQty: r.minStock,
        unitCost: r.unitCost,
        isLowStock: r.currentStock <= r.minStock,
        stockValue: parseFloat((r.currentStock * (r.unitCost ?? 0)).toFixed(2)),
      })),
      materialLots,
      spareParts: spareParts.map(p => ({
        ...p,
        isLowStock: p.stockQty <= p.minStockQty,
        stockValue: parseFloat((p.stockQty * (p.unitCost ?? 0)).toFixed(2)),
      })),
      skus,
      finishedGoodsLots,
    };
  }

  // ────────────────────────────────────────────────────────────
  // BOM MANAGEMENT
  // ────────────────────────────────────────────────────────────

  async findBOMs(factoryId: string | null, filters: {
    skuId?: string; isActive?: boolean; page?: number; limit?: number;
  }) {
    const { skuId, isActive, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.BOMHeaderWhereInput = {
      ...factoryFilter,
      ...(skuId && { skuId }),
      ...(isActive !== undefined && { isActive }),
    };

    const [total, data] = await Promise.all([
      this.prisma.bOMHeader.count({ where }),
      this.prisma.bOMHeader.findMany({
        where,
        include: {
          sku: { select: { id: true, code: true, name: true, itemNumber: true, category: true } },
          process: { select: { id: true, name: true, version: true, scopeType: true } },
          _count: { select: { items: true } },
          items: {
            include: {
              rawMaterial: { select: { id: true, code: true, name: true, unit: true } },
              routingStepRef: { select: { stepNumber: true, operationName: true } },
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: [{ sku: { name: 'asc' } }, { version: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getBOMById(id: string) {
    const bom = await this.prisma.bOMHeader.findUnique({
      where: { id },
      include: {
        sku: { select: { id: true, code: true, name: true, itemNumber: true, category: true } },
        process: { select: { id: true, name: true, version: true, scopeType: true } },
        items: {
          include: {
            rawMaterial: { select: { id: true, code: true, name: true, unit: true, unitCost: true } },
            routingStepRef: { select: { stepNumber: true, operationName: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!bom) throw new NotFoundException('BOM not found');
    return bom;
  }

  async createBOM(factoryId: string | null, dto: {
    skuId: string;
    version?: string;
    notes?: string;
    items: Array<{
      rawMaterialId: string;
      quantityPer: number;
      unit: string;
      scrapFactor?: number;
      isOptional?: boolean;
      notes?: string;
    }>;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const sku = await this.prisma.sKU.findFirst({ where: { id: dto.skuId, ...factoryFilter } });
    if (!sku) throw new NotFoundException('SKU not found');

    const resolvedFactoryId = factoryId ?? await this.getDefaultFactoryId();
    return this.prisma.bOMHeader.create({
      data: {
        factoryId: resolvedFactoryId,
        skuId: dto.skuId,
        version: dto.version ?? '1.0',
        notes: dto.notes,
        isActive: true,
        items: {
          create: dto.items.map(item => ({
            rawMaterialId: item.rawMaterialId,
            quantityPer: item.quantityPer,
            unit: item.unit,
            scrapFactor: item.scrapFactor ?? 0,
            isOptional: item.isOptional ?? false,
            notes: item.notes,
          })),
        },
      },
      include: {
        sku: { select: { id: true, code: true, name: true } },
        items: { include: { rawMaterial: { select: { code: true, name: true, unit: true } } } },
      },
    });
  }

  async updateBOM(id: string, dto: {
    version?: string;
    notes?: string;
    isActive?: boolean;
  }) {
    const bom = await this.prisma.bOMHeader.findUnique({ where: { id } });
    if (!bom) throw new NotFoundException('BOM not found');

    return this.prisma.bOMHeader.update({
      where: { id },
      data: {
        ...(dto.version && { version: dto.version }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async approveBOM(id: string, userId: string) {
    const bom = await this.prisma.bOMHeader.findUnique({ where: { id } });
    if (!bom) throw new NotFoundException('BOM not found');
    if (bom.approvedAt) throw new BadRequestException('BOM is already approved');

    // Deactivate all other BOMs for the same SKU
    await this.prisma.bOMHeader.updateMany({
      where: { skuId: bom.skuId, id: { not: id } },
      data: { isActive: false },
    });

    return this.prisma.bOMHeader.update({
      where: { id },
      data: { approvedAt: new Date(), approvedById: userId, isActive: true },
    });
  }

  async deleteBOM(id: string, factoryId: string | null) {
    const where = factoryId ? { id, factoryId } : { id };
    const bom = await this.prisma.bOMHeader.findFirst({ where });
    if (!bom) throw new NotFoundException('BOM not found');
    if (bom.approvedAt) throw new BadRequestException('Approved BOMs cannot be deleted. Revert to draft first or create a new version.');
    await this.prisma.bOMItem.deleteMany({ where: { bomId: id } });
    await this.prisma.bOMHeader.delete({ where: { id } });
  }

  async deleteBOMItem(bomId: string, itemId: string) {
    const item = await this.prisma.bOMItem.findFirst({ where: { id: itemId, bomId } });
    if (!item) throw new NotFoundException('BOM item not found');
    await this.prisma.bOMItem.delete({ where: { id: itemId } });
  }

  async upsertBOMItem(bomId: string, dto: {
    rawMaterialId: string;
    quantityPer: number;
    unit: string;
    scrapFactor?: number;
    isOptional?: boolean;
    notes?: string;
  }) {
    const bom = await this.prisma.bOMHeader.findUnique({ where: { id: bomId } });
    if (!bom) throw new NotFoundException('BOM not found');

    const existing = await this.prisma.bOMItem.findFirst({
      where: { bomId, rawMaterialId: dto.rawMaterialId },
    });

    if (existing) {
      return this.prisma.bOMItem.update({
        where: { id: existing.id },
        data: {
          quantityPer: dto.quantityPer,
          unit: dto.unit,
          scrapFactor: dto.scrapFactor ?? existing.scrapFactor,
          isOptional: dto.isOptional ?? existing.isOptional,
          notes: dto.notes,
        },
      });
    }

    return this.prisma.bOMItem.create({
      data: { bomId, ...dto, scrapFactor: dto.scrapFactor ?? 0, isOptional: dto.isOptional ?? false },
    });
  }

  // ────────────────────────────────────────────────────────────
  // BOM ↔ PROCESS SMART LINKING
  // Process = source of truth; the BOM is a derived summary of the
  // routing-step materials, rolled up to per-1-finished-base-unit.
  // ────────────────────────────────────────────────────────────

  /** Pieces contained in 1 of the given packaging unit (exact, no rounding). */
  private piecesPerUnit(unit: string, pkg: { unitsPerInner: number; innersPerCarton: number; cartonsPerPallet: number }): number {
    const u = (unit || 'PIECE').toUpperCase();
    const upi = Math.max(1, pkg.unitsPerInner);
    const ipc = Math.max(1, pkg.innersPerCarton);
    const cpp = Math.max(1, pkg.cartonsPerPallet);
    if (u === 'INNER') return upi;
    if (u === 'CARTON') return upi * ipc;
    if (u === 'PALLET') return upi * ipc * cpp;
    return 1; // PIECE / PCS / EA
  }

  /**
   * Resolve the manufacturing process for a SKU by scope priority
   * (PRODUCT → LIST → CATEGORY → BASE_WEIGHT) via the shared canonical util.
   */
  async resolveProcessForSku(factoryId: string | null, skuId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const sku = await this.prisma.sKU.findFirst({ where: { id: skuId, ...factoryFilter }, select: { id: true } });
    if (!sku) throw new NotFoundException('SKU not found');
    const include = {
      routingSteps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { materials: true, machine: { select: { code: true, name: true } } },
      },
    } satisfies Prisma.ManufacturingProcessInclude;
    return findProcessForSku<Prisma.ManufacturingProcessGetPayload<{ include: typeof include }>>(
      this.prisma, factoryId, skuId, include,
    );
  }

  /**
   * Canonical covered-product list of a process — THE source for every consumer
   * (BOM derivation, planning, JO generation, UI) that needs "which products
   * does this routing apply to". Derived from the scope's product ids.
   */
  async getProcessProducts(factoryId: string | null, id: string) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const p = await this.prisma.manufacturingProcess.findFirst({
      where: { id, factoryId: fid },
      include: { skuLinks: { select: { skuId: true } } },
    });
    if (!p) throw new NotFoundException('Manufacturing process not found');

    const products = await this.prisma.sKU.findMany({
      where: processCoveredSkusWhere(p, fid),
      select: {
        id: true, itemNumber: true, code: true, name: true,
        weight: true, weightUnit: true, baseUnit: true,
        unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true,
      },
      orderBy: { itemNumber: 'asc' },
    });
    return { processId: p.id, name: p.name, version: p.version, scopeType: p.scopeType, count: products.length, products };
  }

  /**
   * Derive a BOM from a manufacturing process: every routing-step material is
   * rolled up to quantity per 1 finished base unit of the SKU (via the packaging
   * ladder), grouped by raw material, each line remembering its source step.
   */
  async generateBomFromProcess(factoryId: string | null, userId: string, dto: { skuId: string; processId?: string; version?: string }) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const sku = await this.prisma.sKU.findFirst({ where: { id: dto.skuId, factoryId: fid } });
    if (!sku) throw new NotFoundException('SKU not found');

    const process = dto.processId
      ? await this.prisma.manufacturingProcess.findFirst({
          where: { id: dto.processId, factoryId: fid },
          include: { routingSteps: { orderBy: { stepNumber: 'asc' }, include: { materials: true } } },
        })
      : await this.resolveProcessForSku(fid, dto.skuId);
    if (!process) throw new BadRequestException('No manufacturing process found for this product — create one first or use the guided BOM flow.');
    if (process.routingSteps.every((s) => s.materials.length === 0)) {
      throw new BadRequestException(`Process '${process.name}' has no step input materials to derive a BOM from.`);
    }

    const pkg = { unitsPerInner: sku.unitsPerInner, innersPerCarton: sku.innersPerCarton, cartonsPerPallet: sku.cartonsPerPallet };
    const basePieces = this.piecesPerUnit(sku.baseUnit, pkg);

    // Roll up: qty per 1 SKU base unit = qtyPerOutputUnit × (step outUnits contained in 1 base unit)
    const lines = new Map<string, { rawMaterialId: string; quantityPer: number; unit: string; unitId: string | null; routingStepId: string; steps: number[] }>();
    const skipped: Array<{ name: string; step: number; reason: string }> = [];
    for (const step of process.routingSteps) {
      const outPieces = this.piecesPerUnit(step.outUnit ?? sku.baseUnit, pkg);
      const outPerBase = basePieces / outPieces;
      for (const m of step.materials) {
        if (!m.rawMaterialId) {
          skipped.push({ name: m.name, step: step.stepNumber, reason: 'free-text material (not linked to raw-materials master)' });
          continue;
        }
        const qty = m.qtyPerOutputUnit * outPerBase;
        const existing = lines.get(m.rawMaterialId);
        if (existing) {
          existing.quantityPer += qty;
          existing.steps.push(step.stepNumber);
        } else {
          lines.set(m.rawMaterialId, {
            rawMaterialId: m.rawMaterialId,
            quantityPer: qty,
            unit: m.unit,
            unitId: m.unitId ?? null,
            routingStepId: step.id,
            steps: [step.stepNumber],
          });
        }
      }
    }
    if (lines.size === 0) throw new BadRequestException('All step materials are free-text — link them to raw materials first.');

    // Next free version for this SKU
    let version = dto.version;
    if (!version) {
      const count = await this.prisma.bOMHeader.count({ where: { skuId: dto.skuId } });
      version = `${count + 1}.0`;
    }

    const bom = await this.prisma.bOMHeader.create({
      data: {
        factoryId: fid,
        skuId: dto.skuId,
        version,
        isActive: true,
        processId: process.id,
        sourceType: 'DERIVED_FROM_PROCESS',
        isStale: false,
        notes: `Derived from process '${process.name}' v${process.version} (${process.routingSteps.length} steps)`,
        items: {
          create: Array.from(lines.values()).map((l) => ({
            rawMaterialId: l.rawMaterialId,
            quantityPer: Math.round(l.quantityPer * 10000) / 10000,
            unit: l.unit,
            unitId: l.unitId,
            routingStepId: l.routingStepId,
            notes: `step${l.steps.length > 1 ? 's' : ''} ${l.steps.join(', ')}`,
          })),
        },
      },
      include: {
        sku: { select: { id: true, code: true, name: true } },
        process: { select: { id: true, name: true, version: true } },
        items: { include: { rawMaterial: { select: { code: true, name: true, unit: true } }, routingStepRef: { select: { stepNumber: true, operationName: true } } } },
      },
    });
    return { bom, skipped };
  }

  /**
   * Guided flow inverse: generate a DRAFT manufacturing process from a manual BOM.
   * Clones the steps of the closest scope-matched template process when one exists
   * (materials distributed by category/name heuristic), otherwise creates a single
   * "Production" step holding all materials. The BOM is back-linked DRAFT_FOR_PROCESS.
   */
  async generateProcessFromBom(factoryId: string | null, bomId: string) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const bom = await this.prisma.bOMHeader.findFirst({
      where: { id: bomId, factoryId: fid },
      include: { sku: true, items: { include: { rawMaterial: true } } },
    });
    if (!bom) throw new NotFoundException('BOM not found');
    if (bom.processId) throw new BadRequestException('This BOM is already linked to a process.');
    if (bom.items.length === 0) throw new BadRequestException('BOM has no items.');

    const template = await this.resolveProcessForSku(fid, bom.skuId);
    const pkg = { unitsPerInner: bom.sku.unitsPerInner, innersPerCarton: bom.sku.innersPerCarton, cartonsPerPallet: bom.sku.cartonsPerPallet };
    const basePieces = this.piecesPerUnit(bom.sku.baseUnit, pkg);

    // Which step should consume a material (category + name heuristic)
    const stepFor = (rm: { category?: string | null; name: string }, operations: string[]): number => {
      const hay = `${rm.category ?? ''} ${rm.name}`.toLowerCase();
      const find = (re: RegExp) => operations.findIndex((op) => re.test(op.toLowerCase()));
      let idx = -1;
      if (/stretch|wrap/.test(hay)) idx = find(/wrap/);
      else if (/pallet/.test(hay)) idx = find(/palletiz/);
      else if (/carton|glue|box/.test(hay)) idx = find(/carton|pack/);
      else if (/film|inner|bag/.test(hay)) idx = find(/fill/);
      else if (/powder|raw|chemical|detergent/.test(hay)) idx = find(/fill|mix/);
      return idx >= 0 ? idx : 0;
    };

    const existingVersions = await this.prisma.manufacturingProcess.count({ where: { skuId: bom.skuId } });
    const version = `${existingVersions + 1}.0`;

    const templateSteps = template?.routingSteps?.length
      ? template.routingSteps.map((s) => ({
          stepNumber: s.stepNumber,
          operationName: s.operationName,
          workCenter: s.workCenter,
          workCenterId: s.workCenterId,
          machineId: s.machineId,
          cycleTimeSec: s.cycleTimeSec,
          cycleTimeMins: s.cycleTimeMins,
          setupTimeMins: s.setupTimeMins,
          inUnit: s.inUnit,
          outUnit: s.outUnit,
        }))
      : [{
          stepNumber: 1, operationName: 'Production', workCenter: null as string | null, workCenterId: null as string | null,
          machineId: null as string | null, cycleTimeSec: 60, cycleTimeMins: 1, setupTimeMins: null as number | null,
          inUnit: 'PCS', outUnit: bom.sku.baseUnit,
        }];
    const operations = templateSteps.map((s) => s.operationName);

    // Distribute BOM lines onto steps; convert per-base-unit qty → per-step-outUnit qty
    const materialsByStep = new Map<number, Array<{ rawMaterialId: string; materialCode: string; name: string; qtyPerOutputUnit: number; unit: string; unitId: string | null }>>();
    for (const item of bom.items) {
      const idx = stepFor(item.rawMaterial, operations);
      const step = templateSteps[idx];
      const outPieces = this.piecesPerUnit(step.outUnit ?? bom.sku.baseUnit, pkg);
      const qtyPerOut = item.quantityPer * (outPieces / basePieces);
      const arr = materialsByStep.get(idx) ?? [];
      arr.push({
        rawMaterialId: item.rawMaterialId,
        materialCode: item.rawMaterial.code,
        name: item.rawMaterial.name,
        qtyPerOutputUnit: Math.round(qtyPerOut * 10000) / 10000,
        unit: item.unit,
        unitId: item.unitId ?? item.rawMaterial.unitId ?? null,
      });
      materialsByStep.set(idx, arr);
    }

    const process = await this.prisma.manufacturingProcess.create({
      data: {
        factoryId: fid,
        skuId: bom.skuId,
        scopeType: 'PRODUCT',
        version,
        name: `${bom.sku.name} — Process (from BOM v${bom.version})`,
        description: template
          ? `Draft generated from BOM v${bom.version}; steps cloned from '${template.name}' v${template.version}. Review and activate.`
          : `Draft generated from BOM v${bom.version}. Review steps, machines and cycle times, then activate.`,
        isActive: false, // draft — must be reviewed/activated before scheduling picks it up
        routingSteps: {
          create: templateSteps.map((s, idx) => ({
            stepNumber: s.stepNumber,
            operationName: s.operationName,
            workCenter: s.workCenter,
            workCenterId: s.workCenterId,
            machineId: s.machineId,
            cycleTimeSec: s.cycleTimeSec,
            cycleTimeMins: s.cycleTimeMins,
            setupTimeMins: s.setupTimeMins,
            inUnit: s.inUnit,
            outUnit: s.outUnit,
            ...(s.machineId && { machineOptions: { create: [{ machineId: s.machineId, priority: 0, isDefault: true }] } }),
            ...(materialsByStep.get(idx)?.length && {
              materials: { create: materialsByStep.get(idx)! },
            }),
          })),
        },
      },
      include: { routingSteps: { orderBy: { stepNumber: 'asc' }, include: { materials: true } } },
    });

    await this.prisma.bOMHeader.update({
      where: { id: bom.id },
      data: { processId: process.id, sourceType: 'DRAFT_FOR_PROCESS', isStale: false },
    });

    return { process, linkedBom: { id: bom.id, version: bom.version } };
  }

  /**
   * BOM-coverage report for a process: compares the union of its step materials
   * against the SKU's active BOM — missing / extra / quantity deltas.
   */
  async processBomCoverage(factoryId: string | null, processId: string) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const process = await this.prisma.manufacturingProcess.findFirst({
      where: { id: processId, factoryId: fid },
      include: {
        sku: true,
        routingSteps: { orderBy: { stepNumber: 'asc' }, include: { materials: true } },
      },
    });
    if (!process) throw new NotFoundException('Manufacturing process not found');

    // Pick the reference SKU (direct, or first list member for list/scoped processes)
    let sku = process.sku;
    if (!sku) {
      const link = await this.prisma.manufacturingProcessSku.findFirst({ where: { processId }, include: { sku: true } });
      sku = link?.sku ?? null;
      if (!sku && process.scopeType === 'CATEGORY' && process.categoryId) {
        sku = await this.prisma.sKU.findFirst({ where: { categoryId: process.categoryId, factoryId: fid, isActive: true } });
      }
      if (!sku && process.scopeType === 'BASE_WEIGHT' && process.baseWeightId) {
        sku = await this.prisma.sKU.findFirst({ where: { baseWeightId: process.baseWeightId, factoryId: fid, isActive: true } });
      }
    }
    if (!sku) throw new BadRequestException('No SKU resolvable for this process scope');

    const bom = await this.prisma.bOMHeader.findFirst({
      where: { skuId: sku.id, isActive: true },
      include: { items: { include: { rawMaterial: { select: { id: true, code: true, name: true } } } } },
      orderBy: { version: 'desc' },
    });

    const pkg = { unitsPerInner: sku.unitsPerInner, innersPerCarton: sku.innersPerCarton, cartonsPerPallet: sku.cartonsPerPallet };
    const basePieces = this.piecesPerUnit(sku.baseUnit, pkg);

    // Process side rolled up per base unit
    const procTotals = new Map<string, { qty: number; unit: string; name: string; steps: number[] }>();
    const unlinked: Array<{ name: string; step: number }> = [];
    for (const step of process.routingSteps) {
      const outPieces = this.piecesPerUnit(step.outUnit ?? sku.baseUnit, pkg);
      for (const m of step.materials) {
        if (!m.rawMaterialId) { unlinked.push({ name: m.name, step: step.stepNumber }); continue; }
        const qty = m.qtyPerOutputUnit * (basePieces / outPieces);
        const cur = procTotals.get(m.rawMaterialId);
        if (cur) { cur.qty += qty; cur.steps.push(step.stepNumber); }
        else procTotals.set(m.rawMaterialId, { qty, unit: m.unit, name: m.name, steps: [step.stepNumber] });
      }
    }

    const TOLERANCE = 0.02; // 2% qty drift allowed
    const covered: any[] = [];
    const missing: any[] = [];
    const extra: any[] = [];
    const qtyDeltas: any[] = [];

    for (const item of bom?.items ?? []) {
      const proc = procTotals.get(item.rawMaterialId);
      if (!proc) {
        missing.push({ rawMaterialId: item.rawMaterialId, code: item.rawMaterial.code, name: item.rawMaterial.name, bomQtyPer: item.quantityPer, unit: item.unit });
      } else {
        const delta = item.quantityPer > 0 ? (proc.qty - item.quantityPer) / item.quantityPer : 0;
        if (Math.abs(delta) > TOLERANCE) {
          qtyDeltas.push({ rawMaterialId: item.rawMaterialId, code: item.rawMaterial.code, name: item.rawMaterial.name, bomQtyPer: item.quantityPer, processQtyPer: Math.round(proc.qty * 10000) / 10000, deltaPct: Math.round(delta * 1000) / 10, unit: item.unit, steps: proc.steps });
        } else {
          covered.push({ rawMaterialId: item.rawMaterialId, code: item.rawMaterial.code, name: item.rawMaterial.name, qtyPer: item.quantityPer, unit: item.unit, steps: proc.steps });
        }
        procTotals.delete(item.rawMaterialId);
      }
    }
    for (const [rmId, p] of procTotals) {
      extra.push({ rawMaterialId: rmId, name: p.name, processQtyPer: Math.round(p.qty * 10000) / 10000, unit: p.unit, steps: p.steps });
    }

    return {
      process: { id: process.id, name: process.name, version: process.version },
      sku: { id: sku.id, code: sku.code, name: sku.name },
      bom: bom ? { id: bom.id, version: bom.version, isStale: bom.isStale, sourceType: bom.sourceType } : null,
      covered, missing, extra, qtyDeltas, unlinked,
      ok: !!bom && missing.length === 0 && extra.length === 0 && qtyDeltas.length === 0 && unlinked.length === 0,
    };
  }

  /**
   * One-click allocation: distribute the SKU's active BOM items onto the process
   * steps (category/name heuristic), converting per-base-unit → per-step-outUnit.
   * Skips materials already present on any step; never removes existing rows.
   */
  async allocateProcessMaterialsFromBom(factoryId: string | null, processId: string) {
    const fid = factoryId ?? await this.getDefaultFactoryId();
    const coverage = await this.processBomCoverage(fid, processId);
    if (!coverage.bom) throw new BadRequestException('No active BOM for this product — derive one first or create it.');
    if (coverage.missing.length === 0) return { allocated: 0, message: 'Every BOM material is already allocated to a step.' };

    const process = await this.prisma.manufacturingProcess.findFirst({
      where: { id: processId, factoryId: fid },
      include: { routingSteps: { orderBy: { stepNumber: 'asc' } } },
    });
    const sku = await this.prisma.sKU.findFirst({ where: { id: coverage.sku.id } });
    if (!process || !sku) throw new NotFoundException('Process or SKU not found');

    const pkg = { unitsPerInner: sku.unitsPerInner, innersPerCarton: sku.innersPerCarton, cartonsPerPallet: sku.cartonsPerPallet };
    const basePieces = this.piecesPerUnit(sku.baseUnit, pkg);
    const operations = process.routingSteps.map((s) => s.operationName);
    const stepFor = (hay: string): number => {
      const find = (re: RegExp) => operations.findIndex((op) => re.test(op.toLowerCase()));
      const h = hay.toLowerCase();
      let idx = -1;
      if (/stretch|wrap/.test(h)) idx = find(/wrap/);
      else if (/pallet/.test(h)) idx = find(/palletiz/);
      else if (/carton|glue|box/.test(h)) idx = find(/carton|pack/);
      else if (/film|inner|bag/.test(h)) idx = find(/fill/);
      else if (/powder|raw|chemical|detergent/.test(h)) idx = find(/fill|mix/);
      return idx >= 0 ? idx : 0;
    };

    let allocated = 0;
    for (const miss of coverage.missing) {
      const rm = await this.prisma.rawMaterial.findUnique({ where: { id: miss.rawMaterialId } });
      if (!rm) continue;
      const idx = stepFor(`${rm.category ?? ''} ${rm.name}`);
      const step = process.routingSteps[idx];
      const outPieces = this.piecesPerUnit(step.outUnit ?? sku.baseUnit, pkg);
      await this.prisma.routingStepMaterial.create({
        data: {
          stepId: step.id,
          rawMaterialId: rm.id,
          materialCode: rm.code,
          name: rm.name,
          qtyPerOutputUnit: Math.round(miss.bomQtyPer * (outPieces / basePieces) * 10000) / 10000,
          unit: miss.unit,
          unitId: rm.unitId ?? null,
        },
      });
      allocated++;
    }
    return { allocated, message: `${allocated} BOM material(s) allocated to steps — review quantities.` };
  }

  /**
   * Process materials changed → derived BOMs become stale and an ECR is raised
   * through the PLM workflow so the change is reviewed.
   */
  private async markDerivedBomsStale(processId: string, factoryId: string, userId?: string) {
    try {
      const linked = await this.prisma.bOMHeader.findMany({
        where: { processId, sourceType: { in: ['DERIVED_FROM_PROCESS', 'DRAFT_FOR_PROCESS'] }, isStale: false },
        select: { id: true, version: true, skuId: true, sku: { select: { name: true } } },
      });
      if (linked.length === 0) return;
      await this.prisma.bOMHeader.updateMany({
        where: { id: { in: linked.map((b) => b.id) } },
        data: { isStale: true },
      });
      // Raise one BOM_CHANGE ECR per affected product (PLM numbering convention)
      const year = new Date().getFullYear();
      for (const b of linked) {
        const count = await this.prisma.changeRequest.count({ where: { factoryId, crNumber: { startsWith: `ECR-${year}-` } } });
        await this.prisma.changeRequest.create({
          data: {
            factoryId,
            crNumber: `ECR-${year}-${String(count + 1).padStart(3, '0')}`,
            title: `BOM v${b.version} stale — source process changed`,
            description: `Routing-step materials of the linked manufacturing process were modified. Re-derive BOM v${b.version} (${b.sku?.name ?? b.skuId}) to stay in sync.`,
            type: 'BOM_CHANGE',
            status: 'SUBMITTED',
            priority: 'MEDIUM',
            skuId: b.skuId,
            requestedById: userId ?? null,
            reason: 'Process is the source of truth; derived BOM summary no longer matches.',
          },
        });
      }
    } catch (err) {
      // Staleness flagging is advisory — never block the process update
      // eslint-disable-next-line no-console
      console.error('markDerivedBomsStale failed', err);
    }
  }

  // ────────────────────────────────────────────────────────────
  // MANUFACTURING PROCESSES
  // ────────────────────────────────────────────────────────────

  async findProcesses(factoryId: string | null, filters: {
    skuId?: string; isActive?: boolean; page?: number; limit?: number;
  }) {
    const { skuId, isActive, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.ManufacturingProcessWhereInput = {
      ...factoryFilter,
      ...(skuId && { skuId }),
      ...(isActive !== undefined && { isActive }),
    };

    const [total, data] = await Promise.all([
      this.prisma.manufacturingProcess.count({ where }),
      this.prisma.manufacturingProcess.findMany({
        where,
        include: {
          sku: { select: { id: true, code: true, name: true, itemNumber: true } },
          categoryRef: { select: { id: true, name: true } },
          baseWeightRef: { select: { id: true, value: true, unit: true, label: true } },
          skuLinks: { include: { sku: { select: { id: true, code: true, name: true } } } },
          // Latest governance ECR — gates the Approve action in the UI
          changeRequests: {
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            select: { id: true, crNumber: true, status: true },
          },
          routingSteps: {
            include: {
              machine: { select: { code: true, name: true } },
              workCenterRef: { select: { id: true, code: true, name: true, level: true } },
              materials: true,
              machineOptions: {
                where: { isActive: true },
                orderBy: { priority: 'asc' },
                include: { machine: { select: { id: true, code: true, name: true } } },
              },
              predecessors: {
                include: { fromStep: { select: { id: true, stepNumber: true, operationName: true } } },
              },
            },
            orderBy: { stepNumber: 'asc' },
          },
        },
        orderBy: [{ sku: { name: 'asc' } }, { version: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Covered-product count derived from each process's scope product ids
    const withCounts = await Promise.all(data.map(async (p) => ({
      ...p,
      coveredSkuCount: await this.prisma.sKU.count({
        where: processCoveredSkusWhere(p as any, p.factoryId),
      }),
    })));

    return { data: withCounts, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createProcess(factoryId: string, dto: {
    skuId?: string;
    scopeType?: 'PRODUCT' | 'CATEGORY' | 'BASE_WEIGHT' | 'PRODUCT_LIST';
    categoryId?: string;
    baseWeightId?: string;
    skuIds?: string[];
    version?: string;
    name: string;
    description?: string;
    totalCycleTimeMins?: number;
    steps: Array<{
      stepNumber: number;
      operationName: string;
      workCenter?: string;
      workCenterId?: string;
      machineId?: string;
      cycleTimeSec?: number;
      cycleTimeMins?: number;
      setupTimeMins?: number;
      inUnit?: string;
      outUnit?: string;
      materials?: Array<{ rawMaterialId?: string; materialCode?: string; name: string; qtyPerOutputUnit: number; unit?: string }>;
      machineOptions?: Array<{ machineId: string; priority?: number; cycleTimeSec?: number; setupTimeMins?: number }>;
      description?: string;
      parameters?: Record<string, unknown>;
      isOptional?: boolean;
      dependencies?: Array<{ fromStepNumber: number; type: string; lagMins?: number }>;
    }>;
  }, userId?: string) {
    const version = dto.version ?? '1.0';
    const scopeType = dto.scopeType ?? 'PRODUCT';
    const mapMaterial = await this.stepMaterialMapper(factoryId, dto.steps);
    const wcByMachine = await this.workCenterByMachineMap(factoryId, dto.steps);

    // Scope validation
    if (scopeType === 'PRODUCT' && !dto.skuId) throw new BadRequestException('skuId is required for PRODUCT scope');
    if (scopeType === 'CATEGORY' && !dto.categoryId) throw new BadRequestException('categoryId is required for CATEGORY scope');
    if (scopeType === 'BASE_WEIGHT' && !dto.baseWeightId) throw new BadRequestException('baseWeightId is required for BASE_WEIGHT scope');
    if (scopeType === 'PRODUCT_LIST' && !dto.skuIds?.length) throw new BadRequestException('skuIds list is required for PRODUCT_LIST scope');

    if (scopeType === 'PRODUCT') {
      const existing = await this.prisma.manufacturingProcess.findUnique({
        where: { skuId_version: { skuId: dto.skuId!, version } },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(
          `A manufacturing process version ${version} already exists for this product. Use a different version or clone the existing one.`,
        );
      }
    }

    const process = await this.prisma.manufacturingProcess.create({
      data: {
        factoryId,
        skuId: scopeType === 'PRODUCT' ? dto.skuId! : null,
        scopeType: scopeType as any,
        categoryId: scopeType === 'CATEGORY' ? dto.categoryId : null,
        baseWeightId: scopeType === 'BASE_WEIGHT' ? dto.baseWeightId : null,
        version,
        name: dto.name,
        description: dto.description,
        totalCycleTimeMins: dto.totalCycleTimeMins,
        isActive: true,
        ...(scopeType === 'PRODUCT_LIST' && {
          skuLinks: { create: dto.skuIds!.map((skuId) => ({ skuId })) },
        }),
        routingSteps: {
          create: dto.steps.map(s => {
            // Seconds are the canonical cycle time; legacy minutes stay derived.
            const sec = s.cycleTimeSec ?? (s.cycleTimeMins != null ? s.cycleTimeMins * 60 : null);
            return {
              stepNumber: s.stepNumber,
              operationName: s.operationName,
              workCenter: s.workCenter,
              workCenterId: s.workCenterId ?? (s.machineId ? wcByMachine.get(s.machineId) ?? null : null),
              machineId: s.machineId ?? null,
              cycleTimeSec: sec,
              cycleTimeMins: sec != null ? sec / 60 : null,
              setupTimeMins: s.setupTimeMins,
              inUnit: s.inUnit ?? null,
              outUnit: s.outUnit ?? null,
              description: s.description,
              parameters: (s.parameters as any) ?? undefined,
              isOptional: s.isOptional ?? false,
              ...(s.materials?.length && {
                materials: { create: s.materials.map(mapMaterial) },
              }),
              ...(this.machineOptionRows(s).length && {
                machineOptions: { create: this.machineOptionRows(s) },
              }),
            };
          }),
        },
      },
      include: {
        sku: { select: { code: true, name: true } },
        categoryRef: { select: { id: true, name: true } },
        baseWeightRef: { select: { id: true, value: true, unit: true, label: true } },
        skuLinks: { include: { sku: { select: { id: true, code: true, name: true } } } },
        routingSteps: { orderBy: { stepNumber: 'asc' }, include: { materials: true } },
      },
    });

    // Create step dependencies now that we have real step IDs
    const stepMap = new Map(process.routingSteps.map(s => [s.stepNumber, s.id]));
    const depData: Array<{ fromStepId: string; toStepId: string; type: string; lagMins: number }> = [];

    for (const s of dto.steps) {
      if (!s.dependencies?.length) continue;
      const toStepId = stepMap.get(s.stepNumber);
      if (!toStepId) continue;
      for (const dep of s.dependencies) {
        const fromStepId = stepMap.get(dep.fromStepNumber);
        if (!fromStepId || fromStepId === toStepId) continue;
        depData.push({ fromStepId, toStepId, type: dep.type, lagMins: dep.lagMins ?? 0 });
      }
    }

    if (depData.length > 0) {
      await (this.prisma as any).stepDependency.createMany({ data: depData, skipDuplicates: true });
    }

    // Governance: every new process raises a linked PROCESS_CHANGE ECR that
    // must be approved before the process itself can be approved.
    const cr = await this.raiseProcessChangeRequest(process.id, factoryId, {
      skuId: process.skuId,
      title: `New process '${process.name}' v${process.version} — awaiting approval`,
      description: `Manufacturing process created with ${dto.steps.length} routing step(s). Review the routing, machines, unit flow and input materials, approve this change request, then approve the process.`,
    }, userId);

    return { ...process, changeRequest: cr };
  }

  async updateProcess(id: string, dto: {
    name?: string;
    description?: string;
    totalCycleTimeMins?: number;
    isActive?: boolean;
    scopeType?: 'PRODUCT' | 'CATEGORY' | 'BASE_WEIGHT' | 'PRODUCT_LIST';
    skuId?: string | null;
    categoryId?: string | null;
    baseWeightId?: string | null;
    skuIds?: string[];
    steps?: Array<{
      stepNumber: number;
      operationName: string;
      workCenter?: string;
      workCenterId?: string;
      machineId?: string;
      cycleTimeSec?: number;
      cycleTimeMins?: number;
      setupTimeMins?: number;
      inUnit?: string;
      outUnit?: string;
      materials?: Array<{ rawMaterialId?: string; materialCode?: string; name: string; qtyPerOutputUnit: number; unit?: string }>;
      machineOptions?: Array<{ machineId: string; priority?: number; cycleTimeSec?: number; setupTimeMins?: number }>;
      description?: string;
      parameters?: Record<string, unknown>;
      isOptional?: boolean;
      dependencies?: Array<{ fromStepNumber: number; type: string; lagMins?: number }>;
    }>;
  }, userId?: string) {
    const p = await this.prisma.manufacturingProcess.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Manufacturing process not found');

    const { steps, skuIds, scopeType, skuId, categoryId, baseWeightId, ...headerDto } = dto;
    const mapMaterial = await this.stepMaterialMapper(p.factoryId, steps);
    const wcByMachine = await this.workCenterByMachineMap(p.factoryId, steps);

    // Scope change handling
    const scopeData: Record<string, unknown> = {};
    if (scopeType) {
      scopeData.scopeType = scopeType;
      scopeData.skuId = scopeType === 'PRODUCT' ? (skuId ?? p.skuId) : null;
      scopeData.categoryId = scopeType === 'CATEGORY' ? (categoryId ?? p.categoryId) : null;
      scopeData.baseWeightId = scopeType === 'BASE_WEIGHT' ? (baseWeightId ?? p.baseWeightId) : null;
      if (scopeType === 'PRODUCT_LIST') {
        await this.prisma.manufacturingProcessSku.deleteMany({ where: { processId: id } });
        if (skuIds?.length) {
          await this.prisma.manufacturingProcessSku.createMany({
            data: skuIds.map((sid) => ({ processId: id, skuId: sid })),
            skipDuplicates: true,
          });
        }
      } else {
        await this.prisma.manufacturingProcessSku.deleteMany({ where: { processId: id } });
      }
    }

    await this.prisma.manufacturingProcess.update({ where: { id }, data: { ...headerDto, ...scopeData } });

    if (steps && steps.length > 0) {
      // Steps (and their materials) are being replaced → any BOM derived from
      // this process is now stale; flag it and raise a BOM_CHANGE ECR.
      await this.markDerivedBomsStale(id, p.factoryId, userId);

      // Delete all existing steps (cascades to StepDependency via onDelete: Cascade)
      await this.prisma.routingStep.deleteMany({ where: { processId: id } });

      // Seconds are canonical
      const secOf = (s: { cycleTimeSec?: number; cycleTimeMins?: number }) =>
        s.cycleTimeSec ?? (s.cycleTimeMins != null ? s.cycleTimeMins * 60 : null);

      // Recreate steps
      const process = await this.prisma.manufacturingProcess.update({
        where: { id },
        data: {
          totalCycleTimeMins: steps.reduce((s, st) => s + ((secOf(st) ?? 0) / 60), 0) || headerDto.totalCycleTimeMins,
          routingSteps: {
            create: steps.map(s => {
              const sec = secOf(s);
              return {
                stepNumber: s.stepNumber,
                operationName: s.operationName,
                workCenter: s.workCenter,
                workCenterId: s.workCenterId ?? (s.machineId ? wcByMachine.get(s.machineId) ?? null : null),
                machineId: s.machineId ?? null,
                cycleTimeSec: sec,
                cycleTimeMins: sec != null ? sec / 60 : null,
                setupTimeMins: s.setupTimeMins,
                inUnit: s.inUnit ?? null,
                outUnit: s.outUnit ?? null,
                description: s.description,
                parameters: (s.parameters as any) ?? undefined,
                isOptional: s.isOptional ?? false,
                ...(s.materials?.length && {
                  materials: { create: s.materials.map(mapMaterial) },
                }),
                ...(this.machineOptionRows(s).length && {
                  machineOptions: { create: this.machineOptionRows(s) },
                }),
              };
            }),
          },
        },
        include: {
          sku: { select: { code: true, name: true } },
          routingSteps: { orderBy: { stepNumber: 'asc' }, include: { materials: true } },
        },
      });

      // Recreate dependencies
      const stepMap = new Map(process.routingSteps.map(s => [s.stepNumber, s.id]));
      const depData: Array<{ fromStepId: string; toStepId: string; type: string; lagMins: number }> = [];

      for (const s of steps) {
        if (!s.dependencies?.length) continue;
        const toStepId = stepMap.get(s.stepNumber);
        if (!toStepId) continue;
        for (const dep of s.dependencies) {
          const fromStepId = stepMap.get(dep.fromStepNumber);
          if (!fromStepId || fromStepId === toStepId) continue;
          depData.push({ fromStepId, toStepId, type: dep.type, lagMins: dep.lagMins ?? 0 });
        }
      }

      if (depData.length > 0) {
        await (this.prisma as any).stepDependency.createMany({ data: depData, skipDuplicates: true });
      }

      // Governance: editing routing steps requires a fresh approval cycle —
      // raise a linked PROCESS_CHANGE ECR and (if previously approved) revert
      // the process to draft until the ECR and the process are re-approved.
      const wasApproved = !!p.approvedAt;
      if (wasApproved) {
        await this.prisma.manufacturingProcess.update({
          where: { id },
          data: { approvedAt: null, approvedById: null },
        });
      }
      const cr = await this.raiseProcessChangeRequest(id, p.factoryId, {
        skuId: p.skuId,
        title: `Process '${p.name}' v${p.version} modified — awaiting re-approval`,
        description: `Routing steps were replaced (${steps.length} step(s)).${wasApproved ? ' The process was approved and has been reverted to draft.' : ''} Approve this change request, then re-approve the process — its product BOMs will regenerate automatically.`,
      }, userId);

      return { ...process, ...(wasApproved && { approvedAt: null }), changeRequest: cr };
    }

    return this.prisma.manufacturingProcess.findUnique({
      where: { id },
      include: {
        sku: { select: { code: true, name: true } },
        routingSteps: { orderBy: { stepNumber: 'asc' } },
      },
    });
  }

  /** Linked PROCESS_CHANGE ECR (SUBMITTED) — the approval gate for the process. */
  private async raiseProcessChangeRequest(
    processId: string,
    factoryId: string,
    info: { skuId?: string | null; title: string; description: string },
    userId?: string,
  ) {
    try {
      const year = new Date().getFullYear();
      const count = await this.prisma.changeRequest.count({
        where: { factoryId, crNumber: { startsWith: `ECR-${year}-` } },
      });
      return await this.prisma.changeRequest.create({
        data: {
          factoryId,
          crNumber: `ECR-${year}-${String(count + 1).padStart(3, '0')}`,
          title: info.title,
          description: info.description,
          type: 'PROCESS_CHANGE',
          status: 'SUBMITTED',
          priority: 'MEDIUM',
          skuId: info.skuId ?? null,
          processId,
          requestedById: userId ?? null,
          reason: 'Process create/update governance — routing changes require PLM review.',
        },
      });
    } catch (err) {
      // Governance bookkeeping must never block saving the process itself
      // eslint-disable-next-line no-console
      console.error('raiseProcessChangeRequest failed', err);
      return null;
    }
  }

  async approveProcess(id: string, userId: string) {
    const p = await this.prisma.manufacturingProcess.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Manufacturing process not found');

    // Gate: the latest linked PROCESS_CHANGE ECR must be approved first
    const latestCr = await this.prisma.changeRequest.findFirst({
      where: { processId: id, type: 'PROCESS_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    if (latestCr && ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(latestCr.status)) {
      throw new BadRequestException(
        `Change request ${latestCr.crNumber} is still ${latestCr.status.replace('_', ' ').toLowerCase()} — approve it in PLM › Change Requests first.`,
      );
    }
    if (latestCr && latestCr.status === 'REJECTED') {
      throw new BadRequestException(
        `Change request ${latestCr.crNumber} was rejected — revise the process (a new ECR will be raised) before approving.`,
      );
    }

    // Deactivate only COMPETING versions (same scope target) — never sibling
    // scoped processes (e.g. approving the 2 Kg routing must not touch 1.5 Kg).
    const competingWhere =
      p.scopeType === 'PRODUCT' && p.skuId ? { scopeType: p.scopeType, skuId: p.skuId }
      : p.scopeType === 'CATEGORY' && p.categoryId ? { scopeType: p.scopeType, categoryId: p.categoryId }
      : p.scopeType === 'BASE_WEIGHT' && p.baseWeightId ? { scopeType: p.scopeType, baseWeightId: p.baseWeightId }
      : null;
    if (competingWhere) {
      await this.prisma.manufacturingProcess.updateMany({
        where: { ...competingWhere, id: { not: id } },
        data: { isActive: false },
      });
    }

    const approved = await this.prisma.manufacturingProcess.update({
      where: { id },
      data: { approvedAt: new Date(), approvedById: userId, isActive: true },
    });

    // Close the loop: mark the approved ECR implemented
    if (latestCr && latestCr.status === 'APPROVED') {
      await this.prisma.changeRequest.update({
        where: { id: latestCr.id },
        data: { status: 'IMPLEMENTED', implementedAt: new Date() },
      });
    }

    // Auto-regenerate (and auto-approve) the BOM of every covered product
    const boms = await this.regenerateBomsForProcess(id, userId);

    return { ...approved, regeneratedBoms: boms };
  }

  /**
   * Derive a fresh, approved BOM for every product the process covers —
   * called automatically on process approval so BOMs never drift from the
   * approved routing. Per-product failures (e.g. free-text-only materials)
   * are reported, never thrown.
   */
  private async regenerateBomsForProcess(processId: string, userId: string) {
    const results: Array<{ skuId: string; itemNumber: string; bomVersion?: string; error?: string }> = [];
    try {
      const p = await this.prisma.manufacturingProcess.findUnique({
        where: { id: processId },
        include: { skuLinks: { select: { skuId: true } }, routingSteps: { include: { materials: true } } },
      });
      if (!p) return results;
      if (p.routingSteps.every((s) => s.materials.length === 0)) return results; // nothing to derive

      const products = await this.prisma.sKU.findMany({
        where: processCoveredSkusWhere(p, p.factoryId),
        select: { id: true, itemNumber: true },
      });

      for (const sku of products) {
        try {
          const { bom } = await this.generateBomFromProcess(p.factoryId, userId, { skuId: sku.id, processId });
          // The routing is approved → its derived BOM summary is too
          await this.prisma.bOMHeader.updateMany({
            where: { skuId: sku.id, id: { not: bom.id } },
            data: { isActive: false },
          });
          await this.prisma.bOMHeader.update({
            where: { id: bom.id },
            data: { approvedAt: new Date(), approvedById: userId, isActive: true },
          });
          results.push({ skuId: sku.id, itemNumber: sku.itemNumber, bomVersion: bom.version });
        } catch (err: any) {
          results.push({ skuId: sku.id, itemNumber: sku.itemNumber, error: err?.message ?? 'derivation failed' });
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('regenerateBomsForProcess failed', err);
    }
    return results;
  }

  async revertToDraft(id: string) {
    const p = await this.prisma.manufacturingProcess.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Manufacturing process not found');
    if (!p.approvedAt) throw new BadRequestException('Process is already in draft state.');
    return this.prisma.manufacturingProcess.update({
      where: { id },
      data: { approvedAt: null, approvedById: null, isActive: false },
    });
  }

  async findProcessById(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const process = await this.prisma.manufacturingProcess.findFirst({
      where: { id, ...factoryFilter },
      include: {
        sku: { select: { id: true, code: true, name: true, itemNumber: true } },
        routingSteps: {
          include: {
            machine: { select: { code: true, name: true } },
            workCenterRef: { select: { id: true, code: true, name: true, level: true } },
            predecessors: {
              include: { fromStep: { select: { id: true, stepNumber: true, operationName: true } } },
            },
          },
          orderBy: { stepNumber: 'asc' },
        },
      },
    });
    if (!process) throw new NotFoundException('Manufacturing process not found');
    return process;
  }

  async deleteProcess(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const process = await this.prisma.manufacturingProcess.findFirst({
      where: { id, ...factoryFilter },
      select: { id: true, approvedAt: true },
    });
    if (!process) throw new NotFoundException('Manufacturing process not found');
    if (process.approvedAt) {
      throw new BadRequestException('Approved processes cannot be deleted. Obsolete it first.');
    }
    await this.prisma.manufacturingProcess.delete({ where: { id } });
  }
}
