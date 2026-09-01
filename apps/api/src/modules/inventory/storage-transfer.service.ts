import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType, NotificationSeverity } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export interface CreateTransferDto {
  entityType: 'RAW_MATERIAL' | 'SPARE_PART' | 'PRODUCT';
  materialLotId?: string; // move a specific raw-material lot (qty-bearing, splittable)
  entityId?: string; // rawMaterialId / sparePartId / skuId when not moving a lot
  fromLocationId?: string;
  toLocationId: string;
  quantity?: number; // for lot moves; omit = move the whole remaining qty
  notes?: string;
}

@Injectable()
export class StorageTransferService {
  private readonly logger = new Logger(StorageTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  // ── List ─────────────────────────────────────────────────────
  async list(
    factoryId: string | null,
    filters: { search?: string; locationId?: string; entityType?: string; page?: number; limit?: number },
  ) {
    const { search, locationId, entityType, page = 1, limit = 20 } = filters;
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      ...(entityType ? { entityType } : {}),
      ...(locationId ? { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] } : {}),
      ...(search && {
        OR: [
          { transferNumber: { contains: search, mode: 'insensitive' } },
          { entityName: { contains: search, mode: 'insensitive' } },
          { entityCode: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.storageTransfer.count({ where }),
      this.prisma.storageTransfer.findMany({
        where,
        include: {
          fromLocation: { select: { code: true, name: true, zone: true } },
          toLocation: { select: { code: true, name: true, zone: true } },
          materialLot: { select: { lotNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async stats(factoryId: string | null) {
    const where = { ...(factoryId ? { factoryId } : {}) };
    const [total, byTypeRaw] = await Promise.all([
      this.prisma.storageTransfer.count({ where }),
      this.prisma.storageTransfer.groupBy({ by: ['entityType'], where, _count: { _all: true } }),
    ]);
    const byType: Record<string, number> = {};
    byTypeRaw.forEach((r) => { byType[r.entityType] = r._count._all; });
    return { total, byType };
  }

  private async generateTransferNumber(factoryId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.storageTransfer.count({ where: { factoryId } });
    return `TR-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ── Create / execute a transfer ──────────────────────────────
  async create(factoryId: string | null, userId: string | null, dto: CreateTransferDto) {
    if (!dto.toLocationId) throw new BadRequestException('Destination location is required.');
    if (dto.fromLocationId && dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Source and destination locations must differ.');
    }

    const toLoc = await this.prisma.storageLocation.findFirst({
      where: { id: dto.toLocationId, ...(factoryId ? { factoryId } : {}) },
    });
    if (!toLoc) throw new NotFoundException('Destination location not found.');
    const resolvedFactoryId = factoryId ?? toLoc.factoryId;

    let entityType = dto.entityType;
    let entityId = dto.entityId ?? '';
    let entityCode = '';
    let entityName = '';
    let unit: string | null = null;
    let qty = 0;
    let fromLocationId = dto.fromLocationId ?? null;
    let materialLotId: string | null = null;

    if (dto.materialLotId) {
      // ── Move a specific raw-material lot (qty-bearing, splittable) ──
      const lot = await this.prisma.materialLot.findFirst({
        where: { id: dto.materialLotId, ...(factoryId ? { factoryId } : {}) },
      });
      if (!lot) throw new NotFoundException('Material lot not found.');
      const moveQty = dto.quantity != null ? round3(Number(dto.quantity)) : round3(lot.remainingQty);
      if (!(moveQty > 0)) throw new BadRequestException('Transfer quantity must be greater than zero.');
      if (moveQty > lot.remainingQty + 1e-6) {
        throw new BadRequestException(`Only ${lot.remainingQty} ${lot.unit} remaining in lot ${lot.lotNumber}.`);
      }
      entityType = 'RAW_MATERIAL';
      entityId = lot.rawMaterialId ?? lot.id;
      entityCode = lot.materialCode;
      entityName = lot.materialName;
      unit = lot.unit;
      qty = moveQty;
      fromLocationId = lot.storageLocationId;
      materialLotId = lot.id;

      const transferNumber = await this.generateTransferNumber(resolvedFactoryId);
      if (moveQty >= lot.remainingQty - 1e-6) {
        // Whole lot → just repoint its location.
        await this.prisma.materialLot.update({ where: { id: lot.id }, data: { storageLocationId: dto.toLocationId } });
      } else {
        // Partial → split: decrement source, create a sibling lot at the destination.
        await this.prisma.materialLot.update({ where: { id: lot.id }, data: { remainingQty: round3(lot.remainingQty - moveQty) } });
        await this.prisma.materialLot.create({
          data: {
            factoryId: resolvedFactoryId,
            rawMaterialId: lot.rawMaterialId,
            materialCode: lot.materialCode,
            materialName: lot.materialName,
            lotNumber: `${lot.lotNumber}/${transferNumber}`,
            supplierLot: lot.supplierLot,
            supplierName: lot.supplierName,
            quantity: moveQty,
            remainingQty: moveQty,
            unit: lot.unit,
            status: 'ACTIVE',
            expiryDate: lot.expiryDate,
            storageLocationId: dto.toLocationId,
            notes: `Transferred from lot ${lot.lotNumber} (${transferNumber})`,
          },
        });
      }
      return this.finalizeTransfer(resolvedFactoryId, userId, {
        transferNumber, entityType, entityId, entityCode, entityName, unit, qty, fromLocationId, materialLotId, toLoc, notes: dto.notes,
      });
    }

    // ── Relocate a master item (whole) ──
    if (!entityId) throw new BadRequestException('Select an item to transfer.');
    if (entityType === 'RAW_MATERIAL') {
      const rm = await this.prisma.rawMaterial.findFirst({ where: { id: entityId, ...(factoryId ? { factoryId } : {}) } });
      if (!rm) throw new NotFoundException('Raw material not found.');
      entityCode = rm.code; entityName = rm.name; unit = rm.unit; qty = rm.currentStock; fromLocationId = rm.storageLocationId;
      await this.prisma.rawMaterial.update({ where: { id: rm.id }, data: { storageLocationId: dto.toLocationId } });
    } else if (entityType === 'SPARE_PART') {
      const sp = await this.prisma.sparePart.findFirst({ where: { id: entityId, ...(factoryId ? { factoryId } : {}) } });
      if (!sp) throw new NotFoundException('Spare part not found.');
      entityCode = sp.partNumber; entityName = sp.name; unit = 'PCS'; qty = sp.stockQty; fromLocationId = sp.storageLocationId;
      await this.prisma.sparePart.update({ where: { id: sp.id }, data: { storageLocationId: dto.toLocationId } });
    } else {
      const sku = await this.prisma.sKU.findFirst({ where: { id: entityId, ...(factoryId ? { factoryId } : {}) } });
      if (!sku) throw new NotFoundException('Product not found.');
      entityCode = sku.code; entityName = sku.name; unit = sku.baseUnit; qty = sku.currentStock; fromLocationId = sku.storageLocationId;
      await this.prisma.sKU.update({ where: { id: sku.id }, data: { storageLocationId: dto.toLocationId } });
    }

    const transferNumber = await this.generateTransferNumber(resolvedFactoryId);
    return this.finalizeTransfer(resolvedFactoryId, userId, {
      transferNumber, entityType, entityId, entityCode, entityName, unit, qty, fromLocationId, materialLotId: null, toLoc, notes: dto.notes,
    });
  }

  /** Write the transfer record + ledger + trace event + notification. */
  private async finalizeTransfer(
    factoryId: string,
    userId: string | null,
    p: {
      transferNumber: string; entityType: 'RAW_MATERIAL' | 'SPARE_PART' | 'PRODUCT';
      entityId: string; entityCode: string; entityName: string; unit: string | null; qty: number;
      fromLocationId: string | null; materialLotId: string | null;
      toLoc: { id: string; code: string; name: string }; notes?: string;
    },
  ) {
    const fromLoc = p.fromLocationId
      ? await this.prisma.storageLocation.findUnique({ where: { id: p.fromLocationId }, select: { code: true, name: true } })
      : null;
    const fromLabel = fromLoc ? `${fromLoc.code} ${fromLoc.name}` : '—';
    const toLabel = `${p.toLoc.code} ${p.toLoc.name}`;

    const transfer = await this.prisma.storageTransfer.create({
      data: {
        factoryId,
        transferNumber: p.transferNumber,
        entityType: p.entityType,
        entityId: p.entityId,
        entityCode: p.entityCode,
        entityName: p.entityName,
        materialLotId: p.materialLotId,
        fromLocationId: p.fromLocationId,
        toLocationId: p.toLoc.id,
        quantity: p.qty,
        unit: p.unit,
        notes: p.notes,
        performedById: userId,
      },
    });

    // Universal stock ledger entry (audit).
    await this.prisma.stockMovement.create({
      data: {
        factoryId,
        entityType: p.entityType,
        entityId: p.entityId,
        entityCode: p.entityCode,
        entityName: p.entityName,
        movementType: 'TRANSFER',
        quantity: p.qty,
        referenceType: 'STORAGE_TRANSFER',
        referenceId: transfer.id,
        referenceNumber: p.transferNumber,
        performedById: userId,
        notes: `Moved ${p.qty}${p.unit ? ' ' + p.unit : ''} from ${fromLabel} → ${toLabel}`,
      },
    }).catch(() => undefined);

    // Traceability event so the move is trackable in the genealogy/trace log.
    await this.prisma.traceEvent.create({
      data: {
        factoryId,
        entityType: p.entityType,
        entityId: p.entityId,
        entityCode: p.entityCode,
        eventType: 'STOCK_TRANSFER',
        quantity: p.qty,
        eventData: {
          transferNumber: p.transferNumber,
          from: fromLabel,
          to: toLabel,
          unit: p.unit,
          materialLotId: p.materialLotId,
          notes: p.notes ?? null,
        },
        performedById: userId,
        relatedType: 'STORAGE_TRANSFER',
        relatedId: transfer.id,
      },
    }).catch(() => undefined);

    // Notify the factory of the relocation.
    await this.notifications.dispatch({
      type: NotificationType.SYSTEM,
      severity: NotificationSeverity.INFO,
      factoryId,
      title: 'Stock transfer',
      message: `${p.entityName} (${p.entityCode}) — ${p.qty}${p.unit ? ' ' + p.unit : ''} moved ${fromLabel} → ${toLabel}`,
      link: '/inventory/location-movements',
      data: { transferNumber: p.transferNumber, entityType: p.entityType },
      allInFactory: true,
    }).catch(() => undefined);

    this.eventEmitter.emit('inventory.storage.transfer', { transferId: transfer.id, factoryId });
    // A raw-material relocation/receipt may affect open shortage requests.
    if (p.entityType === 'RAW_MATERIAL') {
      this.eventEmitter.emit('inventory.raw-material.stock-changed', { rawMaterialId: p.entityId, factoryId });
    }
    this.logger.log(`Transfer ${p.transferNumber}: ${p.entityCode} ${p.qty} → ${toLabel}`);
    return transfer;
  }
}
