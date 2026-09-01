import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StockEntityType, MovementType, type Prisma } from '@prisma/client';

export interface RecordMovementDto {
  factoryId: string | null;
  entityType: 'SPARE_PART' | 'RAW_MATERIAL' | 'PRODUCT';
  entityId: string;
  entityCode: string;
  entityName: string;
  movementType: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'RESERVATION' | 'RELEASE' | 'CONSUMPTION';
  quantity: number;
  unitCost?: number;
  stockBefore?: number;
  stockAfter?: number;
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  performedById?: string | null;
  notes?: string;
}

@Injectable()
export class StockMovementsService {
  private readonly logger = new Logger(StockMovementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────
  // RECORD A MOVEMENT (internal)
  // ────────────────────────────────────────────────────────────

  async record(dto: RecordMovementDto): Promise<void> {
    try {
      const unitCost = dto.unitCost ?? null;
      const totalCost =
        unitCost !== null ? parseFloat((Math.abs(dto.quantity) * unitCost).toFixed(4)) : null;

      await this.prisma.stockMovement.create({
        data: {
          factoryId: dto.factoryId ?? (await this.getDefaultFactoryId()),
          entityType: dto.entityType as StockEntityType,
          entityId: dto.entityId,
          entityCode: dto.entityCode,
          entityName: dto.entityName,
          movementType: dto.movementType as MovementType,
          quantity: dto.quantity,
          unitCost: unitCost,
          totalCost: totalCost,
          stockBefore: dto.stockBefore ?? null,
          stockAfter: dto.stockAfter ?? null,
          referenceType: dto.referenceType ?? null,
          referenceId: dto.referenceId ?? null,
          referenceNumber: dto.referenceNumber ?? null,
          performedById: dto.performedById ?? null,
          notes: dto.notes ?? null,
        },
      });
    } catch (err) {
      // Never crash the caller — log and continue
      this.logger.error('Failed to record stock movement', err);
    }
  }

  // ────────────────────────────────────────────────────────────
  // QUERY MOVEMENTS WITH FILTERS
  // ────────────────────────────────────────────────────────────

  async findMovements(
    factoryId: string | null,
    filters: {
      entityType?: string;
      entityId?: string;
      movementType?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      entityType,
      entityId,
      movementType,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.StockMovementWhereInput = {
      ...(factoryId !== null ? { factoryId } : {}),
      ...(entityType && { entityType: entityType as StockEntityType }),
      ...(entityId && { entityId }),
      ...(movementType && { movementType: movementType as MovementType }),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        include: {
          performedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((m) => ({
        id: m.id,
        factoryId: m.factoryId,
        entityType: m.entityType,
        entityId: m.entityId,
        entityCode: m.entityCode,
        entityName: m.entityName,
        movementType: m.movementType,
        quantity: m.quantity,
        unitCost: m.unitCost,
        totalCost: m.totalCost,
        stockBefore: m.stockBefore,
        stockAfter: m.stockAfter,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        referenceNumber: m.referenceNumber,
        notes: m.notes,
        createdAt: m.createdAt.toISOString(),
        performedBy: m.performedBy
          ? { id: m.performedBy.id, name: m.performedBy.name, email: m.performedBy.email }
          : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE
  // ────────────────────────────────────────────────────────────

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    return factory?.id ?? 'unknown';
  }
}
