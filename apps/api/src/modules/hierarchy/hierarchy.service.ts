import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class HierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async getHierarchyTree(factoryId: string | null) {
    const [factories, areaOnlyMachines, factoryOnlyMachines] = await Promise.all([
      this.prisma.factory.findMany({
        where: factoryId ? { id: factoryId } : {},
        include: {
          areas: {
            where: { isActive: true },
            include: {
              productionLines: {
                where: { isActive: true },
                include: {
                  machines: {
                    where: { isActive: true },
                    include: { currentStatus: true },
                    orderBy: { name: 'asc' },
                  },
                },
                orderBy: { name: 'asc' },
              },
            },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.machine.findMany({
        where: { ...(factoryId ? { factoryId } : {}), isActive: true, lineId: null, areaId: { not: null } },
        include: { currentStatus: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.machine.findMany({
        where: { ...(factoryId ? { factoryId } : {}), isActive: true, lineId: null, areaId: null },
        include: { currentStatus: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const areaDirectMap = new Map<string, typeof areaOnlyMachines>();
    for (const m of areaOnlyMachines) {
      if (!m.areaId) continue;
      if (!areaDirectMap.has(m.areaId)) areaDirectMap.set(m.areaId, []);
      areaDirectMap.get(m.areaId)!.push(m);
    }

    const factoryDirectMap = new Map<string, typeof factoryOnlyMachines>();
    for (const m of factoryOnlyMachines) {
      if (!factoryDirectMap.has(m.factoryId)) factoryDirectMap.set(m.factoryId, []);
      factoryDirectMap.get(m.factoryId)!.push(m);
    }

    const toMachineNode = (m: (typeof areaOnlyMachines)[0]) => ({
      id: m.id, type: 'MACHINE', code: m.code, name: m.name,
      machineType: m.machineType, state: m.currentStatus?.state ?? 'OFFLINE', oee: m.currentStatus?.oee,
      // Editable attributes — surfaced so the Edit dialog can pre-fill (parity with Add)
      criticality: m.criticality, manufacturer: m.manufacturer, designCapacity: m.designCapacity,
      downtimeThreshold: m.downtimeThreshold,
      areaId: m.areaId, lineId: m.lineId,
    });

    return factories.map((factory) => {
      const unassigned = factoryDirectMap.get(factory.id) ?? [];
      return {
        id: factory.id, type: 'FACTORY', code: factory.code, name: factory.name,
        city: factory.city, country: factory.country,
        children: [
          ...factory.areas.map((area) => ({
            id: area.id, type: 'AREA', code: area.code, name: area.name,
            areaType: area.type,
            children: [
              ...area.productionLines.map((line) => ({
                id: line.id, type: 'PRODUCTION_LINE', code: line.code, name: line.name,
                lineType: line.type, areaId: line.areaId,
                // Surfaced so the Edit dialog can show the current Line-OEE basis.
                oeeMethod: line.oeeMethod,
                bottleneckMachineId: line.bottleneckMachineId,
                outfeedMachineIds: line.outfeedMachineIds,
                children: line.machines.map(toMachineNode),
              })),
              ...(areaDirectMap.get(area.id) ?? []).map(toMachineNode),
            ],
          })),
          ...(unassigned.length > 0 ? [{
            id: `${factory.id}-unassigned`, type: 'AREA', code: 'UNASSIGNED',
            name: 'Unassigned Equipment', children: unassigned.map(toMachineNode),
          }] : []),
        ],
      };
    });
  }

  async getFactories(factoryId: string | null) {
    return this.prisma.factory.findMany({
      where: factoryId ? { id: factoryId } : {},
      orderBy: { name: 'asc' },
    });
  }

  async getAreas(factoryId: string | null) {
    return this.prisma.area.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async getLines(factoryId: string | null, areaId?: string) {
    return this.prisma.productionLine.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true, ...(areaId ? { areaId } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async getMachines(factoryId: string | null, filters: { areaId?: string; lineId?: string; type?: string }) {
    return this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}), isActive: true,
        ...(filters.areaId && { areaId: filters.areaId }),
        ...(filters.lineId && { lineId: filters.lineId }),
        ...(filters.type && { machineType: filters.type as any }),
      },
      include: {
        currentStatus: true,
        area: { select: { id: true, name: true, code: true } },
        line: { select: { id: true, name: true, code: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createNode(factoryId: string, dto: any) {
    const { type, ...data } = dto;
    switch (type) {
      case 'AREA':
        return this.prisma.area.create({
          data: { factoryId, code: data.code, name: data.name, nameAr: data.nameAr || undefined, type: data.areaType || 'PACKING' },
        });
      case 'PRODUCTION_LINE': {
        if (!data.areaId) throw new BadRequestException('areaId is required for Production Line');
        return this.prisma.productionLine.create({
          data: {
            factoryId, areaId: data.areaId, code: data.code, name: data.name,
            type: data.lineType || 'PACKING',
            // Bottleneck-based line OEE: the constraint machine supplies Availability
            // and Performance, the outfeed machine supplies Quality. Both optional —
            // unset falls back to lowest design capacity / last machine in line order.
            oeeMethod: data.oeeMethod || undefined,
            bottleneckMachineId: data.bottleneckMachineId || null,
            outfeedMachineIds: Array.isArray(data.outfeedMachineIds) ? data.outfeedMachineIds : [],
          },
        });
      }
      case 'MACHINE': {
        return this.prisma.machine.create({
          data: {
            factoryId,
            areaId: data.areaId || undefined,
            lineId: data.lineId || undefined,
            code: data.code,
            name: data.name,
            machineType: data.machineType || 'MACHINE',
            criticality: data.criticality || 'MEDIUM',
            manufacturer: data.manufacturer || undefined,
            designCapacity: data.designCapacity ? parseFloat(data.designCapacity) : undefined,
            downtimeThreshold: data.downtimeThreshold ? parseInt(data.downtimeThreshold) : 60,
          },
        });
      }
      default:
        throw new BadRequestException(`Unsupported node type: ${type}`);
    }
  }

  async updateNode(id: string, dto: any) {
    const { type, ...data } = dto;
    switch (type) {
      case 'AREA':
        return this.prisma.area.update({ where: { id }, data: { name: data.name, nameAr: data.nameAr || undefined, type: data.areaType || undefined } });
      case 'PRODUCTION_LINE':
        return this.prisma.productionLine.update({
          where: { id },
          data: {
            name: data.name,
            type: data.lineType || undefined,
            // `undefined` leaves the value untouched; an explicit empty string clears
            // it back to the automatic fallback. Both are meaningful here, so the
            // nullish check must not collapse them.
            ...(data.bottleneckMachineId !== undefined
              ? { bottleneckMachineId: data.bottleneckMachineId || null }
              : {}),
            ...(data.oeeMethod !== undefined ? { oeeMethod: data.oeeMethod } : {}),
            // An empty array is a real choice ("all machines are outfeeds"), so it must
            // not be collapsed into "leave unchanged" the way a falsy string would be.
            ...(Array.isArray(data.outfeedMachineIds)
              ? { outfeedMachineIds: data.outfeedMachineIds }
              : {}),
          },
        });
      case 'MACHINE':
        return this.prisma.machine.update({
          where: { id }, data: {
            name: data.name,
            machineType: data.machineType || undefined,
            criticality: data.criticality || undefined,
            manufacturer: data.manufacturer || undefined,
            areaId: data.areaId || undefined,
            lineId: data.lineId || undefined,
            // Both of these were settable at CREATE and dropped on every edit,
            // so a machine created with the wrong figure kept it forever and the
            // only route to a correction was SQL. `designCapacity` is the
            // denominator of Performance and `downtimeThreshold` is the microstop
            // boundary — two of the more consequential numbers in the system.
            //
            // `undefined` means "left off the form"; a value of 0 is a real
            // choice, so the check is on presence, not truthiness.
            ...(data.designCapacity !== undefined && data.designCapacity !== ''
              ? { designCapacity: parseFloat(data.designCapacity) }
              : {}),
            ...(data.downtimeThreshold !== undefined && data.downtimeThreshold !== ''
              ? { downtimeThreshold: parseInt(data.downtimeThreshold, 10) }
              : {}),
          },
        });
      case 'FACTORY':
        return this.prisma.factory.update({ where: { id }, data: { name: data.name } });
      default:
        throw new BadRequestException(`Unsupported node type: ${type}`);
    }
  }

  async deleteNode(id: string, type: string) {
    switch (type) {
      case 'AREA':
        return this.prisma.area.update({ where: { id }, data: { isActive: false } });
      case 'PRODUCTION_LINE':
        return this.prisma.productionLine.update({ where: { id }, data: { isActive: false } });
      case 'MACHINE':
        return this.prisma.machine.update({ where: { id }, data: { isActive: false } });
      default:
        throw new BadRequestException(`Cannot delete node of type: ${type}`);
    }
  }
}
