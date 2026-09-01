import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { EnergyContextService } from './energy-context.service';
import { instantiateEdgeCounterTags, type EdgeCounterBlocks } from './edge-counter';

export interface TelemetryDto {
  machineId: string;
  state?: string;           // MachineState enum value
  actualSpeed?: number;     // units/hour
  goodCount?: number;
  rejectCount?: number;
  runtimeDelta?: number;    // minutes of runtime to add since last call
  tagValues?: Array<{ tagCode: string; value: string; quality?: string }>;
}

@Injectable()
export class IotService {
  private readonly logger = new Logger(IotService.name);
  /** Per-tag last auto-SPC capture (ms) — throttles in-line SPC point creation. */
  private readonly lastSpcMs = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly energyContext: EnergyContextService,
  ) {}

  /**
   * Stream in-line quality readings into SPC. For each MEASUREMENT tag in the
   * telemetry batch that is linked to a quality parameter — either explicitly
   * (tag.spcParameterId) or by convention (tag name === a parameter name on the
   * machine's active quality plan) — write an SPCMeasurement stamped with that
   * parameter's control/spec limits and flag out-of-control. Throttled per tag
   * (default 60s, or the tag's historizationRateSec) so polling can't flood.
   */
  private async captureAutoSpc(
    machine: { id: string; factoryId: string },
    tags: any[],
    tagValues: Array<{ tagCode: string; value: string }>,
    now: Date,
  ): Promise<void> {
    const valByCode = new Map(tagValues.map((tv) => [tv.tagCode, tv.value]));
    const numeric = (raw: string | undefined) => (raw == null || raw.trim() === '' ? NaN : Number(raw));

    const candidates = tags.filter((t) =>
      t.tagType === 'MEASUREMENT' && !isNaN(numeric(valByCode.get(t.code))));
    if (candidates.length === 0) return;

    // Convention fallback: load the machine's plan parameters only if needed.
    let byName: Map<string, any> | null = null;
    if (candidates.some((t) => !t.spcParameter)) {
      const params = await this.prisma.qualityParameter.findMany({
        where: { plan: { machineId: machine.id, isActive: true } },
        select: { id: true, name: true, unit: true, nominalValue: true, ucl: true, lcl: true, usl: true, lsl: true },
      });
      byName = new Map(params.map((p) => [p.name.toLowerCase(), p]));
    }

    const rows: any[] = [];
    for (const t of candidates) {
      const p = t.spcParameter ?? byName?.get(String(t.name ?? '').toLowerCase());
      if (!p) continue;
      const intervalMs = Math.max(5, t.historizationRateSec ?? 60) * 1000;
      if (now.getTime() - (this.lastSpcMs.get(t.id) ?? 0) < intervalMs) continue;
      this.lastSpcMs.set(t.id, now.getTime());

      const value = numeric(valByCode.get(t.code));
      const out = (p.ucl != null && value > p.ucl) || (p.lcl != null && value < p.lcl);
      rows.push({
        factoryId: machine.factoryId,
        machineId: machine.id,
        parameterName: p.name,
        parameterUnit: t.unit ?? p.unit ?? null,
        value,
        isOutOfControl: out,
        controlViolation: out ? 'RULE_1' : null,
        ucl: p.ucl ?? null, lcl: p.lcl ?? null, cl: p.nominalValue ?? null,
        usl: p.usl ?? null, lsl: p.lsl ?? null,
        measuredAt: now,
      });
    }
    if (rows.length > 0) await this.prisma.sPCMeasurement.createMany({ data: rows });
  }

  async ingestTelemetry(factoryId: string | null, dto: TelemetryDto) {
    const machine = await this.prisma.machine.findFirst({
      where: {
        id: dto.machineId,
        ...(factoryId ? { factoryId } : {}),
        isActive: true,
      },
      select: { id: true, name: true, code: true, factoryId: true },
    });
    if (!machine) throw new NotFoundException(`Machine ${dto.machineId} not found`);

    const previous = await this.prisma.machineCurrentStatus.findUnique({
      where: { machineId: dto.machineId },
      select: { state: true, goodCount: true, rejectCount: true },
    });

    const now = new Date();
    const updateData: Record<string, unknown> = { lastEventAt: now };
    if (dto.state !== undefined) updateData.state = dto.state;
    if (dto.actualSpeed !== undefined) updateData.actualSpeed = dto.actualSpeed;
    if (dto.goodCount !== undefined) updateData.goodCount = dto.goodCount;
    if (dto.rejectCount !== undefined) updateData.rejectCount = dto.rejectCount;
    if (dto.runtimeDelta !== undefined) updateData.runtimeMinutes = { increment: dto.runtimeDelta };

    const status = await this.prisma.machineCurrentStatus.upsert({
      where: { machineId: dto.machineId },
      create: {
        machineId: dto.machineId,
        state: (dto.state as any) ?? 'OFFLINE',
        actualSpeed: dto.actualSpeed,
        goodCount: dto.goodCount ?? 0,
        rejectCount: dto.rejectCount ?? 0,
        lastEventAt: now,
      },
      update: updateData,
    });

    // Bulk-resolve and update tag current values
    if (dto.tagValues?.length) {
      const tagCodes = dto.tagValues.map((t) => t.tagCode);
      const tags = await this.prisma.tagDefinition.findMany({
        where: { machineId: dto.machineId, code: { in: tagCodes }, isActive: true },
        select: {
          id: true, code: true, name: true, tagType: true, unit: true,
          historizationRateSec: true, spcParameterId: true,
          spcParameter: { select: { id: true, name: true, unit: true, nominalValue: true, ucl: true, lcl: true, usl: true, lsl: true } },
        },
      });
      const tagMap = new Map(tags.map((t) => [t.code, t.id]));

      await Promise.all(
        dto.tagValues.map((tv) => {
          const tagId = tagMap.get(tv.tagCode);
          if (!tagId) return;
          return this.prisma.tagCurrentValue.upsert({
            where: { tagId },
            create: {
              tagId,
              factoryId: machine.factoryId,
              value: tv.value,
              quality: (tv.quality as any) ?? 'GOOD',
              timestamp: now,
            },
            update: {
              value: tv.value,
              quality: (tv.quality as any) ?? 'GOOD',
              timestamp: now,
            },
          });
        }),
      );

      // Auto-SPC: stream linked MEASUREMENT readings into SPCMeasurement (throttled).
      await this.captureAutoSpc(machine, tags as any[], dto.tagValues, now)
        .catch((e) => this.logger.warn(`Auto-SPC capture failed: ${(e as Error).message}`));
    }

    // Broadcast live telemetry to dashboard clients
    this.eventEmitter.emit('iot.machine.telemetry', {
      machineId: machine.id,
      machineName: machine.name,
      machineCode: machine.code,
      factoryId: machine.factoryId,
      state: status.state,
      actualSpeed: status.actualSpeed,
      goodCount: status.goodCount,
      rejectCount: status.rejectCount,
      timestamp: now.toISOString(),
    });

    // Emit state-change event for downtime auto-detection
    if (dto.state && dto.state !== previous?.state) {
      this.eventEmitter.emit('machine.state.changed', {
        machineId: machine.id,
        machineName: machine.name,
        factoryId: machine.factoryId,
        previousState: previous?.state ?? 'OFFLINE',
        newState: dto.state,
        timestamp: now.toISOString(),
      });
    }

    return {
      machineId: machine.id,
      machineName: machine.name,
      state: status.state,
      timestamp: now.toISOString(),
    };
  }

  async getDevices(
    factoryId: string | null,
    filters: { status?: string; search?: string; machineId?: string; lineId?: string; areaId?: string; page?: number; limit?: number },
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      isActive: true,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.machineId ? { machineId: filters.machineId } : {}),
      ...(filters.lineId ? { lineId: filters.lineId } : {}),
      ...(filters.areaId ? { areaId: filters.areaId } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              { deviceCode: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        include: {
          machine: { select: { id: true, name: true, code: true } },
          line: { select: { id: true, name: true, code: true } },
          area: { select: { id: true, name: true, code: true } },
          gateway: { select: { id: true, name: true } },
          _count: { select: { tagDefinitions: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.device.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getDeviceStatus(deviceId: string) {
    return this.prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        machine: { select: { name: true, code: true } },
        tagDefinitions: {
          where: { isActive: true },
          include: { currentValue: true },
          orderBy: { name: 'asc' },
          take: 50,
        },
      },
    });
  }

  async connectDevice(factoryId: string | null, deviceId: string) {
    await this.prisma.device.update({
      where: { id: deviceId },
      data: { status: 'CONNECTED', lastSeenAt: new Date() },
    });
    return { status: 'CONNECTED', timestamp: new Date() };
  }

  async getTags(
    factoryId: string | null,
    filters: { deviceId?: string; machineId?: string; lineId?: string; areaId?: string; meterId?: string; search?: string; page?: number; limit?: number },
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      isActive: true,
      ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
      ...(filters.machineId ? { machineId: filters.machineId } : {}),
      ...(filters.lineId ? { lineId: filters.lineId } : {}),
      ...(filters.areaId ? { areaId: filters.areaId } : {}),
      ...(filters.meterId ? { meterId: filters.meterId } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              { code: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.tagDefinition.findMany({
        where,
        include: {
          currentValue: true,
          device: { select: { id: true, name: true } },
          machine: { select: { id: true, name: true, code: true } },
          line: { select: { id: true, name: true, code: true } },
          area: { select: { id: true, name: true, code: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tagDefinition.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async getMachineStates(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machines = await this.prisma.machine.findMany({
      where: { ...factoryFilter, isActive: true },
      include: { currentStatus: true },
      orderBy: { code: 'asc' },
    });

    // A WO has no header machine — the active WO on a machine is the one whose
    // job order is currently executing there. One query, then map by machine.
    const activeJOs = await this.prisma.jobOrder.findMany({
      where: { machineId: { in: machines.map((m) => m.id) }, status: 'EXECUTING' },
      select: { machineId: true, workOrder: { select: { orderNumber: true } } },
    });
    const woByMachine = new Map<string, string>();
    for (const jo of activeJOs) {
      if (jo.machineId && !woByMachine.has(jo.machineId)) {
        woByMachine.set(jo.machineId, jo.workOrder.orderNumber);
      }
    }

    return machines.map((m) => ({
      id: m.id,
      name: m.name,
      code: m.code,
      state: m.currentStatus?.state ?? 'OFFLINE',
      actualSpeed: m.currentStatus?.actualSpeed ?? 0,
      goodCount: m.currentStatus?.goodCount ?? 0,
      rejectCount: m.currentStatus?.rejectCount ?? 0,
      oee: m.currentStatus?.oee ?? 0,
      lastEventAt: m.currentStatus?.lastEventAt?.toISOString(),
      activeWorkOrder: woByMachine.get(m.id) ?? null,
    }));
  }

  async recordTagValue(tagId: string, value: string, quality: string): Promise<void> {
    const tag = await this.prisma.tagDefinition.findUnique({
      where: { id: tagId },
      select: { factoryId: true },
    });
    if (!tag) return;
    await this.prisma.tagCurrentValue.upsert({
      where: { tagId },
      create: {
        tagId,
        factoryId: tag.factoryId,
        value,
        quality: quality as 'GOOD' | 'BAD' | 'UNCERTAIN' | 'NOT_CONNECTED',
        timestamp: new Date(),
      },
      update: {
        value,
        quality: quality as 'GOOD' | 'BAD' | 'UNCERTAIN' | 'NOT_CONNECTED',
        timestamp: new Date(),
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // DEVICE CRUD
  // ────────────────────────────────────────────────────────────

  async getDeviceKPIs(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const [total, connected, disconnected, errored] = await Promise.all([
      this.prisma.device.count({ where: { ...factoryFilter, isActive: true } }),
      this.prisma.device.count({ where: { ...factoryFilter, status: 'CONNECTED', isActive: true } }),
      this.prisma.device.count({ where: { ...factoryFilter, status: 'DISCONNECTED', isActive: true } }),
      this.prisma.device.count({ where: { ...factoryFilter, status: 'ERROR', isActive: true } }),
    ]);
    return { total, connected, disconnected, errored };
  }

  /**
   * Normalise a plant-hierarchy scope. Exactly one of machine/line/area is the
   * primary target; `areaId` is auto-derived (machine→line→area, or line→area)
   * so dashboards can roll up without manual entry.
   */
  private async resolveScope(scope: { machineId?: string | null; lineId?: string | null; areaId?: string | null }): Promise<{ machineId: string | null; lineId: string | null; areaId: string | null }> {
    let { machineId = null, lineId = null, areaId = null } = scope;
    if (machineId) {
      const m = await this.prisma.machine.findUnique({ where: { id: machineId }, select: { lineId: true, areaId: true } });
      lineId = lineId ?? m?.lineId ?? null;
      areaId = areaId ?? m?.areaId ?? (m?.lineId ? (await this.prisma.productionLine.findUnique({ where: { id: m.lineId }, select: { areaId: true } }))?.areaId ?? null : null);
    } else if (lineId) {
      areaId = areaId ?? (await this.prisma.productionLine.findUnique({ where: { id: lineId }, select: { areaId: true } }))?.areaId ?? null;
    }
    return { machineId, lineId, areaId };
  }

  /**
   * Enforce at most one active COUNTER tag per (machine, role). Rejects on save
   * when the machine already has a tag of that role — prevents double-counting.
   */
  private async assertCounterRoleUnique(factoryId: string, machineId: string | null, counterRole: string | null | undefined, tagType: string | undefined, excludeTagId?: string): Promise<void> {
    if (tagType !== 'COUNTER' || !machineId || !counterRole || !['GOOD', 'BAD', 'TOTAL'].includes(counterRole)) return;
    const clash = await this.prisma.tagDefinition.findFirst({
      where: { factoryId, machineId, counterRole: counterRole as any, isActive: true, ...(excludeTagId ? { NOT: { id: excludeTagId } } : {}) },
      select: { code: true, machine: { select: { code: true } } },
    });
    if (clash) {
      throw new ConflictException(`${clash.machine?.code ?? 'This machine'} already has a ${counterRole} counter tag (${clash.code}). Remove or edit it first.`);
    }
  }

  /**
   * A machine has exactly one state, and a PROCESSING signal is not it.
   *
   * Both faults were live on 19 Aug 2026: the Uni-Tech wrapping table's rotation
   * bit was flagged as M5's status signal alongside its run-mode bit. Each wrote
   * the machine's state on every 100 ms poll, so M5 flipped between them, and
   * "the table is not turning" — which is what STARVED is inferred FROM — was
   * being read as "the machine is broken".
   *
   * Neither shows up as an error anywhere: the machine still displays a state,
   * and the state still looks plausible. So they are refused at the point they
   * are configured rather than diagnosed months later from the downtime log.
   */
  /**
   * Whether this tag drives its machine's state — decided here rather than taken
   * on trust, because the two ways of getting it wrong both go unnoticed.
   *
   * PROCESSING is not a state and cannot be one. It measures whether product is
   * flowing, which is what STARVED and BLOCKED are inferred FROM; read as a state
   * it calls every gap between units a fault. So the role settles it and the flag
   * is derived, not asserted. This is a coercion and not a refusal on purpose: a
   * caller that sends both is not making a choice the user could have made
   * differently, it is stating a contradiction in terms, and rejecting the save
   * would leave whoever is binding the signal with no shape that is accepted.
   */
  private statusDriverFor(isMachineStatus: boolean | undefined, signalRole: string | null | undefined): boolean {
    if (signalRole === 'PROCESSING') return false;
    return !!isMachineStatus;
  }

  /**
   * A machine has one state, so one tag may drive it.
   *
   * Two of them do not average out: each writes the state on every poll, the
   * machine flips between them, and the downtime log fills with alternating
   * events. Live on 19 Aug 2026, M5 had its wrapping-table rotation flagged
   * alongside its run-mode bit.
   *
   * Only a request that ADDS a second one is refused. A tag that is already
   * flagged stays editable — refusing every edit to it would mean a machine that
   * has landed in this state cannot be edited out of it, and the field that needs
   * changing lives on exactly such a tag.
   */
  private async assertOneStatusDriverPerMachine(
    factoryId: string, machineId: string | null, wouldDrive: boolean, alreadyDrove: boolean,
    excludeTagId?: string,
  ): Promise<void> {
    if (!wouldDrive || alreadyDrove || !machineId) return;
    const clash = await this.prisma.tagDefinition.findFirst({
      where: {
        factoryId, machineId, isMachineStatus: true, isActive: true,
        ...(excludeTagId ? { NOT: { id: excludeTagId } } : {}),
      },
      select: { code: true, machine: { select: { code: true } } },
    });
    if (clash) {
      throw new ConflictException(
        `${clash.machine?.code ?? 'This machine'} already takes its state from ${clash.code}. ` +
        'Two status signals overwrite each other on every poll. Clear the flag on that tag first.');
    }
  }

  async createDevice(factoryId: string | null, dto: {
    name: string; deviceCode: string; type: string; protocol: string;
    ipAddress?: string; port?: number; machineId?: string; firmware?: string;
    gatewayId?: string; unitId?: number; pollIntervalMs?: number;
    serialPort?: string; baudRate?: number; parity?: string; dataBits?: number; stopBits?: number;
    lineId?: string; areaId?: string;
    edgeCounter?: EdgeCounterBlocks;
  }) {
    const resolvedFactoryId = factoryId ?? await this.getDefaultFactoryId();
    const scope = await this.resolveScope({ machineId: dto.machineId, lineId: dto.lineId, areaId: dto.areaId });
    const isEdgeCounter = dto.type === 'EDGE_COUNTER';
    const device = await this.prisma.device.create({
      data: {
        factoryId: resolvedFactoryId,
        name: dto.name,
        deviceCode: dto.deviceCode,
        type: dto.type,
        protocol: dto.protocol,
        ipAddress: dto.ipAddress,
        port: dto.port,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        gatewayId: dto.gatewayId || null,
        unitId: dto.unitId ?? null,
        // EdgeCounter devices poll fast by default so short sensor pulses aren't missed.
        pollIntervalMs: dto.pollIntervalMs ?? (isEdgeCounter ? 100 : null),
        serialPort: dto.serialPort ?? null,
        baudRate: dto.baudRate ?? null,
        parity: dto.parity ?? null,
        dataBits: dto.dataBits ?? null,
        stopBits: dto.stopBits ?? null,
        firmware: dto.firmware,
        config: isEdgeCounter && dto.edgeCounter ? { edgeCounter: dto.edgeCounter as any } : undefined,
        status: 'DISCONNECTED',
        isActive: true,
      },
    });
    if (isEdgeCounter && dto.edgeCounter) {
      await this.provisionEdgeCounterTags(device.id, device.deviceCode, resolvedFactoryId, scope, dto.edgeCounter);
    }
    return device;
  }

  /** Auto-create an EdgeCounter device's DI/Coil/HR/IR tags (idempotent by factory+code). */
  private async provisionEdgeCounterTags(
    deviceId: string,
    deviceCode: string,
    factoryId: string,
    scope: { machineId: string | null; lineId: string | null; areaId: string | null },
    blocks: EdgeCounterBlocks,
  ): Promise<void> {
    const specs = instantiateEdgeCounterTags(deviceCode, blocks);
    for (const s of specs) {
      const exists = await this.prisma.tagDefinition.findFirst({ where: { factoryId, code: s.code } });
      if (exists) continue;
      await this.prisma.tagDefinition.create({
        data: {
          factoryId, deviceId,
          machineId: scope.machineId, lineId: scope.lineId, areaId: scope.areaId,
          code: s.code, name: s.name, dataType: s.dataType as any, tagType: s.tagType as any,
          address: s.address, registerType: s.registerType, wordCount: s.wordCount, wordOrder: s.wordOrder,
          counterRole: (s.counterRole as any) ?? undefined, edgeType: s.edgeType ?? undefined,
          mqttPublishMode: s.mqttPublishMode, historizationMode: s.historizationMode,
        },
      });
    }
  }

  async updateDevice(factoryId: string | null, id: string, dto: {
    name?: string; type?: string; protocol?: string; ipAddress?: string;
    port?: number; firmware?: string; isActive?: boolean;
    machineId?: string | null; gatewayId?: string | null; unitId?: number; pollIntervalMs?: number;
    serialPort?: string; baudRate?: number; parity?: string; dataBits?: number; stopBits?: number;
    lineId?: string | null; areaId?: string | null;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const device = await this.prisma.device.findFirst({ where: { id, ...factoryFilter } });
    if (!device) throw new NotFoundException('Device not found');
    // Re-derive scope when any scope field changes.
    const scopeTouched = dto.machineId !== undefined || dto.lineId !== undefined || dto.areaId !== undefined;
    const scope = scopeTouched
      ? await this.resolveScope({ machineId: dto.machineId ?? null, lineId: dto.lineId ?? null, areaId: dto.areaId ?? null })
      : null;
    return this.prisma.device.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.type && { type: dto.type }),
        ...(dto.protocol && { protocol: dto.protocol }),
        ...(dto.ipAddress !== undefined && { ipAddress: dto.ipAddress }),
        ...(dto.port !== undefined && { port: dto.port }),
        ...(dto.firmware !== undefined && { firmware: dto.firmware }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(scope ? { machineId: scope.machineId, lineId: scope.lineId, areaId: scope.areaId } : {}),
        ...(dto.gatewayId !== undefined && { gatewayId: dto.gatewayId }),
        ...(dto.unitId !== undefined && { unitId: dto.unitId }),
        ...(dto.pollIntervalMs !== undefined && { pollIntervalMs: dto.pollIntervalMs }),
        ...(dto.serialPort !== undefined && { serialPort: dto.serialPort }),
        ...(dto.baudRate !== undefined && { baudRate: dto.baudRate }),
        ...(dto.parity !== undefined && { parity: dto.parity }),
        ...(dto.dataBits !== undefined && { dataBits: dto.dataBits }),
        ...(dto.stopBits !== undefined && { stopBits: dto.stopBits }),
      },
    });
  }

  async deleteDevice(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const device = await this.prisma.device.findFirst({ where: { id, ...factoryFilter } });
    if (!device) throw new NotFoundException('Device not found');
    await this.prisma.device.update({ where: { id }, data: { isActive: false } });
  }

  // ────────────────────────────────────────────────────────────
  // TAG CRUD
  // ────────────────────────────────────────────────────────────

  async createTag(factoryId: string | null, dto: {
    code: string; name: string; dataType: string; tagType?: string; unit?: string;
    deviceId?: string; machineId?: string; description?: string;
    minValue?: number; maxValue?: number;
    scaleFactor?: number; offset?: number;
    address?: string; registerType?: string; wordCount?: number; wordOrder?: string;
    counterRole?: string; edgeType?: string; pollIntervalMs?: number;
    meterId?: string; energyRole?: string;
    lineId?: string; areaId?: string;
    historizationEnabled?: boolean; isMachineStatus?: boolean; statusMap?: Record<string, string> | null;
    // How this signal is to be READ, and the timing that goes with it. On an
    // eight-input module a bit's meaning cannot be inferred from its value.
    signalRole?: string | null; pulseWindowMs?: number | null; pulseMinEdges?: number | null; idleThresholdMs?: number | null;
    mqttPublishMode?: string; mqttPublishRateSec?: number; historizationMode?: string; historizationRateSec?: number; deadband?: number | null;
  }) {
    const resolvedFactoryId = factoryId ?? await this.getDefaultFactoryId();
    await this.assertCounterRoleUnique(resolvedFactoryId, dto.machineId || null, dto.counterRole, dto.tagType);
    const drivesState = this.statusDriverFor(dto.isMachineStatus, dto.signalRole);
    await this.assertOneStatusDriverPerMachine(resolvedFactoryId, dto.machineId || null, drivesState, false);
    const scope = await this.resolveScope({ machineId: dto.machineId, lineId: dto.lineId, areaId: dto.areaId });
    return this.prisma.tagDefinition.create({
      data: {
        factoryId: resolvedFactoryId,
        code: dto.code,
        name: dto.name,
        dataType: dto.dataType as any,
        tagType: (dto.tagType as any) ?? 'MEASUREMENT',
        unit: dto.unit,
        deviceId: dto.deviceId || null,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        meterId: dto.meterId || null,
        energyRole: dto.energyRole || null,
        description: dto.description,
        minValue: dto.minValue,
        maxValue: dto.maxValue,
        scaleFactor: dto.scaleFactor,
        offset: dto.offset,
        address: dto.address || null,
        registerType: dto.registerType || null,
        wordCount: dto.wordCount ?? 1,
        wordOrder: dto.wordOrder || 'BIG',
        counterRole: (dto.counterRole as any) || null,
        edgeType: dto.edgeType || 'RISING',
        pollIntervalMs: dto.pollIntervalMs ?? null,
        ...(dto.historizationEnabled !== undefined && { historizationEnabled: dto.historizationEnabled }),
        ...(dto.mqttPublishMode !== undefined && { mqttPublishMode: dto.mqttPublishMode }),
        ...(dto.mqttPublishRateSec !== undefined && { mqttPublishRateSec: dto.mqttPublishRateSec }),
        ...(dto.historizationMode !== undefined && { historizationMode: dto.historizationMode }),
        ...(dto.historizationRateSec !== undefined && { historizationRateSec: dto.historizationRateSec }),
        ...(dto.deadband !== undefined && { deadband: dto.deadband }),
        isMachineStatus: drivesState,
        statusMap: (dto.statusMap as any) ?? undefined,
        signalRole: dto.signalRole ?? undefined,
        pulseWindowMs: dto.pulseWindowMs ?? undefined,
        pulseMinEdges: dto.pulseMinEdges ?? undefined,
        idleThresholdMs: dto.idleThresholdMs ?? undefined,
        isActive: true,
      },
    });
  }

  async updateTag(factoryId: string | null, id: string, dto: {
    name?: string; unit?: string; description?: string;
    minValue?: number; maxValue?: number; isActive?: boolean;
    dataType?: string; tagType?: string; deviceId?: string | null; machineId?: string | null;
    scaleFactor?: number; offset?: number;
    address?: string; registerType?: string; wordCount?: number; wordOrder?: string;
    counterRole?: string; edgeType?: string; pollIntervalMs?: number;
    meterId?: string | null; energyRole?: string;
    lineId?: string | null; areaId?: string | null;
    historizationEnabled?: boolean; isMachineStatus?: boolean; statusMap?: Record<string, string> | null;
    // How this signal is to be READ, and the timing that goes with it. On an
    // eight-input module a bit's meaning cannot be inferred from its value.
    signalRole?: string | null; pulseWindowMs?: number | null; pulseMinEdges?: number | null; idleThresholdMs?: number | null;
    mqttPublishMode?: string; mqttPublishRateSec?: number; historizationMode?: string; historizationRateSec?: number; deadband?: number | null;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const tag = await this.prisma.tagDefinition.findFirst({ where: { id, ...factoryFilter } });
    if (!tag) throw new NotFoundException('Tag not found');
    // Counter-role uniqueness using the effective (post-update) machine + role.
    const effMachineId = dto.machineId !== undefined ? dto.machineId : tag.machineId;
    const effRole = dto.counterRole !== undefined ? dto.counterRole : (tag.counterRole as string | null);
    const effType = dto.tagType !== undefined ? dto.tagType : tag.tagType;
    await this.assertCounterRoleUnique(tag.factoryId, effMachineId, effRole, effType, id);
    // The same rules on the effective (post-update) values. "Already drove" is
    // read from the record AND the machine it is on, so moving a flagged tag to a
    // machine that has one still counts as adding a second.
    const effIsStatus = dto.isMachineStatus !== undefined ? dto.isMachineStatus : tag.isMachineStatus;
    const effSignalRole = dto.signalRole !== undefined ? dto.signalRole : (tag.signalRole as string | null);
    const drivesState = this.statusDriverFor(effIsStatus, effSignalRole);
    const alreadyDrove = tag.isMachineStatus && effMachineId === tag.machineId;
    await this.assertOneStatusDriverPerMachine(tag.factoryId, effMachineId, drivesState, alreadyDrove, id);
    const scopeTouched = dto.machineId !== undefined || dto.lineId !== undefined || dto.areaId !== undefined;
    const scope = scopeTouched
      ? await this.resolveScope({ machineId: dto.machineId ?? null, lineId: dto.lineId ?? null, areaId: dto.areaId ?? null })
      : null;
    return this.prisma.tagDefinition.update({
      where: { id },
      data: {
        ...(scope ? { machineId: scope.machineId, lineId: scope.lineId, areaId: scope.areaId } : {}),
        ...(dto.name && { name: dto.name }),
        ...(dto.unit !== undefined && { unit: dto.unit }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.minValue !== undefined && { minValue: dto.minValue }),
        ...(dto.maxValue !== undefined && { maxValue: dto.maxValue }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.dataType !== undefined && { dataType: dto.dataType as any }),
        ...(dto.tagType !== undefined && { tagType: dto.tagType as any }),
        ...(dto.deviceId !== undefined && { deviceId: dto.deviceId }),
        ...(dto.scaleFactor !== undefined && { scaleFactor: dto.scaleFactor }),
        ...(dto.offset !== undefined && { offset: dto.offset }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.registerType !== undefined && { registerType: dto.registerType }),
        ...(dto.wordCount !== undefined && { wordCount: dto.wordCount }),
        ...(dto.wordOrder !== undefined && { wordOrder: dto.wordOrder }),
        ...(dto.counterRole !== undefined && { counterRole: dto.counterRole as any }),
        ...(dto.edgeType !== undefined && { edgeType: dto.edgeType }),
        ...(dto.pollIntervalMs !== undefined && { pollIntervalMs: dto.pollIntervalMs }),
        ...(dto.meterId !== undefined && { meterId: dto.meterId }),
        ...(dto.energyRole !== undefined && { energyRole: dto.energyRole }),
        ...(dto.historizationEnabled !== undefined && { historizationEnabled: dto.historizationEnabled }),
        ...(dto.mqttPublishMode !== undefined && { mqttPublishMode: dto.mqttPublishMode }),
        ...(dto.mqttPublishRateSec !== undefined && { mqttPublishRateSec: dto.mqttPublishRateSec }),
        ...(dto.historizationMode !== undefined && { historizationMode: dto.historizationMode }),
        ...(dto.historizationRateSec !== undefined && { historizationRateSec: dto.historizationRateSec }),
        ...(dto.deadband !== undefined && { deadband: dto.deadband }),
        ...((dto.isMachineStatus !== undefined || dto.signalRole !== undefined) && { isMachineStatus: drivesState }),
        ...(dto.statusMap !== undefined && { statusMap: (dto.statusMap as any) }),
        ...(dto.signalRole !== undefined && { signalRole: dto.signalRole }),
        ...(dto.pulseWindowMs !== undefined && { pulseWindowMs: dto.pulseWindowMs }),
        ...(dto.pulseMinEdges !== undefined && { pulseMinEdges: dto.pulseMinEdges }),
        ...(dto.idleThresholdMs !== undefined && { idleThresholdMs: dto.idleThresholdMs }),
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // GATEWAYS
  // ────────────────────────────────────────────────────────────

  /** List gateways with derived ONLINE/OFFLINE (heartbeat within 60s) + device counts. */
  async getGateways(factoryId: string | null) {
    const gateways = await this.prisma.gateway.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      include: { _count: { select: { devices: true } } },
      orderBy: { name: 'asc' },
    });
    const now = Date.now();
    return gateways.map((g) => ({
      ...g,
      online: !!g.lastHeartbeatAt && now - g.lastHeartbeatAt.getTime() < 60_000,
      deviceCount: g._count.devices,
    }));
  }

  async getGatewayKPIs(factoryId: string | null) {
    const gateways = await this.getGateways(factoryId);
    return {
      total: gateways.length,
      online: gateways.filter((g) => g.online).length,
      offline: gateways.filter((g) => !g.online).length,
    };
  }

  async updateGateway(factoryId: string | null, id: string, dto: { name?: string; config?: unknown; isActive?: boolean }) {
    const gw = await this.prisma.gateway.findFirst({ where: { id, ...(factoryId ? { factoryId } : {}) } });
    if (!gw) throw new NotFoundException('Gateway not found');
    return this.prisma.gateway.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.config !== undefined && { config: dto.config as any }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteGateway(factoryId: string | null, id: string) {
    const gw = await this.prisma.gateway.findFirst({ where: { id, ...(factoryId ? { factoryId } : {}) } });
    if (!gw) throw new NotFoundException('Gateway not found');
    await this.prisma.gateway.update({ where: { id }, data: { isActive: false } });
  }

  async deleteTag(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const tag = await this.prisma.tagDefinition.findFirst({ where: { id, ...factoryFilter } });
    if (!tag) throw new NotFoundException('Tag not found');
    await this.prisma.tagDefinition.update({ where: { id }, data: { isActive: false } });
  }

  // ────────────────────────────────────────────────────────────
  // ENERGY READINGS
  // ────────────────────────────────────────────────────────────

  async ingestEnergyReading(factoryId: string | null, dto: {
    meterId: string;
    value: number;     // cumulative kWh from the meter
    powerKw?: number;  // instantaneous power reading
    timestamp?: string;
  }) {
    const meter = await (this.prisma as any).energyMeter.findUnique({
      where: { id: dto.meterId },
      select: { id: true, factoryId: true, machineId: true },
    });
    if (!meter) throw new NotFoundException(`Energy meter ${dto.meterId} not found`);

    const resolvedFactoryId = factoryId ?? meter.factoryId;
    const ts = dto.timestamp ? new Date(dto.timestamp) : new Date();

    const reading = await this.prisma.energyReading.create({
      data: {
        meterId: dto.meterId,
        factoryId: resolvedFactoryId,
        timestamp: ts,
        value: dto.value,
        ...(dto.powerKw !== undefined && { powerKw: dto.powerKw }),
      } as any,
    });

    // Async context enrichment: link to WO, WorkCenter, machine state
    void this.energyContext.enrichEnergyReading(reading.id, meter.machineId).then(async () => {
      const anomaly = await this.energyContext.detectPowerAnomaly(reading.id);
      if (anomaly.isAnomaly) {
        this.eventEmitter.emit('energy.anomaly.detected', {
          readingId: reading.id,
          factoryId: resolvedFactoryId,
          machineId: meter.machineId,
          message: anomaly.message,
          timestamp: ts.toISOString(),
        });
      }
    });

    return {
      id: reading.id,
      meterId: dto.meterId,
      factoryId: resolvedFactoryId,
      timestamp: ts.toISOString(),
      value: dto.value,
      powerKw: dto.powerKw ?? null,
    };
  }

  async getEnergyTimeseries(factoryId: string | null, filters: {
    workOrderId?: string;
    workCenterId?: string;
    from: string;
    to: string;
  }) {
    return this.energyContext.getEnergyTimeseries({
      factoryId: factoryId ?? undefined,
      workOrderId: filters.workOrderId,
      workCenterId: filters.workCenterId,
      from: new Date(filters.from),
      to: new Date(filters.to),
    });
  }

  async getEnergyWOSummary(workOrderId: string) {
    return this.energyContext.getWOEnergySummary(workOrderId);
  }

  async backfillEnergyWOSummaries(factoryId: string | null, force = false) {
    return this.energyContext.backfillWOEnergySummaries(factoryId, force);
  }

  async getEnergyByWorkCenter(factoryId: string, from: string, to: string) {
    return this.energyContext.getEnergyByWorkCenter(factoryId, new Date(from), new Date(to));
  }

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    if (!factory) throw new NotFoundException('No active factory found');
    return factory.id;
  }
  // ────────────────────────────────────────────────────────────
  // MACHINE STATE RULES
  // ────────────────────────────────────────────────────────────

  /**
   * Rules for this factory, factory-wide ones first then per-machine overrides.
   *
   * A machine-specific rule wins over the factory rule for the same state, so one
   * awkward machine can be treated differently without forking the whole table.
   */
  async listStateRules(factoryId: string | null, machineId?: string) {
    if (!factoryId) return [];
    return this.prisma.machineStateRule.findMany({
      where: {
        factoryId,
        ...(machineId ? { OR: [{ machineId }, { machineId: null }] } : {}),
      },
      include: { machine: { select: { id: true, code: true, name: true } } },
      orderBy: [{ machineId: 'asc' }, { state: 'asc' }],
    });
  }

  async upsertStateRule(factoryId: string | null, dto: any) {
    if (!factoryId) throw new BadRequestException('A factory context is required');
    if (!dto?.state) throw new BadRequestException('state is required');

    const data = {
      factoryId,
      machineId: dto.machineId ?? null,
      state: String(dto.state).toUpperCase(),
      isDowntime: dto.isDowntime ?? true,
      isPlanned: dto.isPlanned ?? false,
      affectsOEE: dto.affectsOEE ?? true,
      reasonCode: dto.reasonCode ?? null,
      category: (dto.category ?? 'OTHER') as any,
      debounceSeconds: dto.debounceSeconds ?? 0,
      description: dto.description ?? null,
      isActive: dto.isActive ?? true,
    };

    // One rule per (factory, machine, state) — editing the same state twice must
    // replace it rather than silently create a second rule that never applies.
    const existing = await this.prisma.machineStateRule.findFirst({
      where: { factoryId, machineId: data.machineId, state: data.state },
      select: { id: true },
    });
    return existing
      ? this.prisma.machineStateRule.update({ where: { id: existing.id }, data })
      : this.prisma.machineStateRule.create({ data });
  }

  async updateStateRule(factoryId: string | null, id: string, dto: any) {
    const rule = await this.prisma.machineStateRule.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
    });
    if (!rule) throw new NotFoundException('State rule not found');
    return this.prisma.machineStateRule.update({
      where: { id },
      data: {
        ...(dto.isDowntime !== undefined && { isDowntime: dto.isDowntime }),
        ...(dto.isPlanned !== undefined && { isPlanned: dto.isPlanned }),
        ...(dto.affectsOEE !== undefined && { affectsOEE: dto.affectsOEE }),
        ...(dto.reasonCode !== undefined && { reasonCode: dto.reasonCode }),
        ...(dto.category !== undefined && { category: dto.category as any }),
        ...(dto.debounceSeconds !== undefined && { debounceSeconds: dto.debounceSeconds }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /**
   * Delete a rule. A per-machine override disappearing is safe — that machine
   * falls back to the factory rule. Deleting the factory rule falls back to the
   * gateway's built-in default, so downtime is still recorded either way.
   */
  async deleteStateRule(factoryId: string | null, id: string) {
    const rule = await this.prisma.machineStateRule.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
      select: { id: true },
    });
    if (!rule) throw new NotFoundException('State rule not found');
    await this.prisma.machineStateRule.delete({ where: { id } });
  }
}
