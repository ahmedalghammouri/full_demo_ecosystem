import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WorkCenterLevel } from '@prisma/client';

export interface CreateWorkCenterDto {
  code: string;
  name: string;
  level: WorkCenterLevel;
  parentId?: string;
  description?: string;
  capacity?: number;
}

@Injectable()
export class WorkCenterService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Tree query (recursive) ───────────────────────────────────

  async getTree(factoryId: string) {
    const all = await this.prisma.workCenter.findMany({
      where: { factoryId, isActive: true },
      include: { _count: { select: { routingSteps: true } } },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });

    const byId = new Map(all.map(wc => [wc.id, { ...wc, children: [] as any[] }]));
    const roots: any[] = [];

    for (const wc of all) {
      const node = byId.get(wc.id)!;
      if (wc.parentId && byId.has(wc.parentId)) {
        byId.get(wc.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  // ── Flat list ────────────────────────────────────────────────

  async findAll(factoryId: string, level?: WorkCenterLevel) {
    return this.prisma.workCenter.findMany({
      where: {
        factoryId,
        isActive: true,
        ...(level && { level }),
      },
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: true, routingSteps: true } },
      },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
  }

  // ── Create ───────────────────────────────────────────────────

  async create(factoryId: string, dto: CreateWorkCenterDto) {
    if (dto.parentId) {
      const parent = await this.prisma.workCenter.findFirst({
        where: { id: dto.parentId, factoryId },
      });
      if (!parent) throw new NotFoundException('Parent work center not found');

      // Enforce hierarchy: PLANT > AREA > LINE > CELL
      const allowed: Record<WorkCenterLevel, WorkCenterLevel[]> = {
        PLANT: [],
        AREA: ['PLANT'],
        LINE: ['AREA'],
        CELL: ['LINE'],
      };
      if (!allowed[dto.level].includes(parent.level)) {
        throw new BadRequestException(
          `A ${dto.level} work center must have a ${allowed[dto.level].join(' or ')} parent`,
        );
      }
    }

    return this.prisma.workCenter.create({
      data: { factoryId, ...dto },
      include: { parent: { select: { id: true, code: true, name: true } } },
    });
  }

  // ── Update ───────────────────────────────────────────────────

  async update(factoryId: string, id: string, dto: Partial<Omit<CreateWorkCenterDto, 'code'>>) {
    const wc = await this.prisma.workCenter.findFirst({ where: { id, factoryId } });
    if (!wc) throw new NotFoundException('Work center not found');
    return this.prisma.workCenter.update({
      where: { id },
      data: dto,
      include: { parent: { select: { id: true, code: true, name: true } } },
    });
  }

  // ── Delete (soft) ────────────────────────────────────────────

  async delete(factoryId: string, id: string) {
    const wc = await this.prisma.workCenter.findFirst({
      where: { id, factoryId },
      include: { _count: { select: { children: true } } },
    });
    if (!wc) throw new NotFoundException('Work center not found');
    if (wc._count.children > 0) {
      throw new BadRequestException('Cannot delete a work center that has children');
    }
    await this.prisma.workCenter.update({ where: { id }, data: { isActive: false } });
  }

  // ── Breadcrumb path ──────────────────────────────────────────

  async getPath(id: string): Promise<{ id: string; code: string; name: string; level: WorkCenterLevel }[]> {
    const path: { id: string; code: string; name: string; level: WorkCenterLevel }[] = [];
    let current = await this.prisma.workCenter.findUnique({ where: { id } });
    while (current) {
      path.unshift({ id: current.id, code: current.code, name: current.name, level: current.level });
      if (!current.parentId) break;
      current = await this.prisma.workCenter.findUnique({ where: { id: current.parentId } });
    }
    return path;
  }
}
