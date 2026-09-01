import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ChangeRequestStatus, ChangeRequestType, Priority } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

const ALLOWED_TRANSITIONS: Record<ChangeRequestStatus, ChangeRequestStatus[]> = {
  DRAFT: [ChangeRequestStatus.SUBMITTED],
  SUBMITTED: [ChangeRequestStatus.UNDER_REVIEW, ChangeRequestStatus.REJECTED],
  UNDER_REVIEW: [ChangeRequestStatus.APPROVED, ChangeRequestStatus.REJECTED],
  APPROVED: [ChangeRequestStatus.IMPLEMENTED],
  REJECTED: [ChangeRequestStatus.DRAFT],       // rework
  IMPLEMENTED: [],
};

@Injectable()
export class PlmService {
  constructor(private readonly prisma: PrismaService) {}

  private requireFactory(factoryId: string | null): string {
    if (!factoryId) throw new BadRequestException('Factory context required');
    return factoryId;
  }

  async listChangeRequests(factoryId: string | null, filters: {
    status?: string; type?: string; search?: string; page?: number; limit?: number;
  }) {
    const fid = this.requireFactory(factoryId);
    const { status, type, search, page = 1, limit = 50 } = filters;

    const where: Prisma.ChangeRequestWhereInput = {
      factoryId: fid,
      ...(status && { status: status as ChangeRequestStatus }),
      ...(type && { type: type as ChangeRequestType }),
      ...(search && {
        OR: [
          { crNumber: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, data, byStatus, byType] = await Promise.all([
      this.prisma.changeRequest.count({ where }),
      this.prisma.changeRequest.findMany({
        where,
        include: {
          sku: { select: { id: true, itemNumber: true, name: true } },
          requestedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.changeRequest.groupBy({
        by: ['status'], where: { factoryId: fid }, _count: { _all: true },
      }),
      this.prisma.changeRequest.groupBy({
        by: ['type'], where: { factoryId: fid }, _count: { _all: true },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      countsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      countsByType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    };
  }

  async createChangeRequest(factoryId: string | null, userId: string, dto: {
    title: string; description?: string; type: ChangeRequestType;
    priority?: Priority; skuId?: string; reason?: string; targetDate?: string;
  }) {
    const fid = this.requireFactory(factoryId);
    if (!dto.title?.trim()) throw new BadRequestException('Title is required');

    // Sequential ECR-YYYY-NNN per factory
    const year = new Date().getFullYear();
    const last = await this.prisma.changeRequest.findFirst({
      where: { factoryId: fid, crNumber: { startsWith: `ECR-${year}-` } },
      orderBy: { crNumber: 'desc' },
      select: { crNumber: true },
    });
    const seq = last ? parseInt(last.crNumber.split('-')[2], 10) + 1 : 1;
    const crNumber = `ECR-${year}-${String(seq).padStart(3, '0')}`;

    return this.prisma.changeRequest.create({
      data: {
        factoryId: fid,
        crNumber,
        title: dto.title.trim(),
        description: dto.description,
        type: dto.type,
        priority: dto.priority ?? Priority.MEDIUM,
        skuId: dto.skuId ?? null,
        reason: dto.reason,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        requestedById: userId,
        status: ChangeRequestStatus.DRAFT,
      },
      include: {
        sku: { select: { id: true, itemNumber: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  async updateChangeRequest(factoryId: string | null, id: string, dto: {
    title?: string; description?: string; type?: ChangeRequestType;
    priority?: Priority; skuId?: string | null; reason?: string; targetDate?: string | null;
  }) {
    const fid = this.requireFactory(factoryId);
    const cr = await this.prisma.changeRequest.findFirst({ where: { id, factoryId: fid } });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status === ChangeRequestStatus.IMPLEMENTED) {
      throw new BadRequestException('Implemented change requests are immutable');
    }
    return this.prisma.changeRequest.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.skuId !== undefined && { skuId: dto.skuId }),
        ...(dto.reason !== undefined && { reason: dto.reason }),
        ...(dto.targetDate !== undefined && { targetDate: dto.targetDate ? new Date(dto.targetDate) : null }),
      },
      include: {
        sku: { select: { id: true, itemNumber: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  /** Workflow transition with guard rails; review/approve stamps the reviewer. */
  async transitionChangeRequest(factoryId: string | null, userId: string, id: string, status: ChangeRequestStatus) {
    const fid = this.requireFactory(factoryId);
    const cr = await this.prisma.changeRequest.findFirst({ where: { id, factoryId: fid } });
    if (!cr) throw new NotFoundException('Change request not found');

    const allowed = ALLOWED_TRANSITIONS[cr.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Cannot move ${cr.status} → ${status}`);
    }

    const reviewerStamp = ([
      ChangeRequestStatus.UNDER_REVIEW, ChangeRequestStatus.APPROVED, ChangeRequestStatus.REJECTED,
    ] as ChangeRequestStatus[]).includes(status);

    return this.prisma.changeRequest.update({
      where: { id },
      data: {
        status,
        ...(reviewerStamp && { reviewedById: userId }),
        ...(status === ChangeRequestStatus.IMPLEMENTED && { implementedAt: new Date() }),
      },
      include: {
        sku: { select: { id: true, itemNumber: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  async deleteChangeRequest(factoryId: string | null, id: string) {
    const fid = this.requireFactory(factoryId);
    const cr = await this.prisma.changeRequest.findFirst({ where: { id, factoryId: fid } });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status !== ChangeRequestStatus.DRAFT) {
      throw new BadRequestException('Only draft change requests can be deleted');
    }
    await this.prisma.changeRequest.delete({ where: { id } });
    return { id, deleted: true };
  }
}
