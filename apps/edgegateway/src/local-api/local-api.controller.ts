import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, BadRequestException, ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { MqttService } from '../services/mqtt.service';
import { InfluxService } from '../services/influx.service';
import { GatewayContextService } from '../context/gateway-context.service';
import { ModbusPollerService } from '../acquisition/modbus-poller.service';
import { BufferService } from '../acquisition/buffer.service';
import { ModbusLogService } from '../acquisition/modbus-log.service';
import { StatusService } from '../acquisition/status.service';
import { CounterService } from '../acquisition/counter.service';
import { METER_TEMPLATES, instantiateMeterTags, instantiateEdgeCounterTags, type EdgeCounterBlocks } from '@i360/industrial-drivers';
import { readConfigFile, writeConfigFile } from '../config/config-store';
import { CountBalanceService } from './count-balance.service';
import { LineBalanceService } from './line-balance.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * REST API consumed by the gateway's embedded dashboard. `/api/auth/login` is
 * public; everything else requires a shared-JWT Bearer token.
 */
@Controller('api')
export class LocalApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly influx: InfluxService,
    private readonly ctx: GatewayContextService,
    private readonly poller: ModbusPollerService,
    private readonly buffer: BufferService,
    private readonly mlog: ModbusLogService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly statusSvc: StatusService,
    private readonly counter: CounterService,
    private readonly balance: CountBalanceService,
    private readonly lineBalance: LineBalanceService,
  ) {}

  @Post('auth/login')
  login(@Body() body: { email?: string; password?: string }) {
    if (!body?.email || !body?.password) throw new BadRequestException('email and password required');
    return this.auth.login(body.email, body.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  async status() {
    let dbOk = true;
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { dbOk = false; }
    const mes = await this.checkMesReachable();
    return {
      gatewayId: this.ctx.getGatewayId(),
      factoryId: this.ctx.getFactoryId(),
      ready: this.ctx.isReady(),
      sinks: { db: dbOk, mqtt: this.mqtt.isConnected(), influx: this.influx.isEnabled(), mes },
      devices: this.poller.status(),
      buffers: {
        pgTagValue: this.buffer.size('pg-tagvalue'),
        influx: this.buffer.size('influx'),
        mqtt: this.buffer.size('mqtt'),
      },
    };
  }

  private async checkMesReachable(): Promise<boolean | null> {
    const url = this.config.get<string>('mesPlatformUrl');
    if (!url) return null; // not configured
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Settings (service connections) ───────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('settings')
  settings() {
    const stored = readConfigFile();
    // Effective values: stored override, else current runtime config.
    return {
      gatewayName: stored.gatewayName ?? this.config.get('gatewayName'),
      factoryCode: stored.factoryCode ?? this.config.get('factoryCode') ?? '',
      databaseUrl: stored.databaseUrl ?? this.config.get('databaseUrl') ?? '',
      mqttBrokerUrl: stored.mqttBrokerUrl ?? this.config.get('mqtt.brokerUrl') ?? '',
      influxUrl: stored.influxUrl ?? this.config.get('influx.url') ?? '',
      influxToken: stored.influxToken ?? this.config.get('influx.token') ?? '',
      influxOrg: stored.influxOrg ?? this.config.get('influx.org') ?? '',
      influxBucket: stored.influxBucket ?? this.config.get('influx.bucket') ?? '',
      mesPlatformUrl: stored.mesPlatformUrl ?? this.config.get('mesPlatformUrl') ?? '',
      defaultPollIntervalMs: stored.defaultPollIntervalMs ?? this.config.get('defaultPollIntervalMs'),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('settings')
  saveSettings(@Body() b: any) {
    const allowed = [
      'gatewayName', 'factoryCode', 'databaseUrl', 'mqttBrokerUrl',
      'influxUrl', 'influxToken', 'influxOrg', 'influxBucket', 'mesPlatformUrl', 'defaultPollIntervalMs',
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (b[k] !== undefined) patch[k] = b[k];
    writeConfigFile(patch);
    return { ok: true, restartRequired: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('restart')
  restart() {
    // Exit cleanly; NSSM (service) or a dev runner restarts the process so the
    // new settings take effect. Delay so the HTTP response is flushed first.
    setTimeout(() => process.exit(0), 300);
    return { ok: true, restarting: true };
  }

  // ── Hierarchy (for scope binding) ────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('machines')
  machines() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.machine.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('lines')
  lines() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.productionLine.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('areas')
  areas() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.area.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
    });
  }

  /** Reject a duplicate active COUNTER role on the same machine (prevents double-counting). */
  private async assertCounterRoleUnique(factoryId: string, machineId: string | null, counterRole: string | null | undefined, tagType: string | undefined, excludeId?: string) {
    if (tagType !== 'COUNTER' || !machineId || !counterRole || !['GOOD', 'BAD', 'TOTAL'].includes(counterRole)) return;
    const clash = await this.prisma.tagDefinition.findFirst({
      where: { factoryId, machineId, counterRole: counterRole as any, isActive: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { code: true },
    });
    if (clash) throw new ConflictException(`This machine already has a ${counterRole} counter tag (${clash.code}).`);
  }

  /** Derive areaId (and lineId) from the chosen scope so devices/tags/meters
   *  roll up consistently machine → line → area. */
  private async resolveScope(b: { machineId?: string | null; lineId?: string | null; areaId?: string | null }) {
    let machineId = b.machineId ?? null;
    let lineId = b.lineId ?? null;
    let areaId = b.areaId ?? null;
    if (!areaId) {
      if (machineId) {
        const m = await this.prisma.machine.findUnique({ where: { id: machineId }, select: { lineId: true, areaId: true } });
        if (m) { areaId = m.areaId ?? null; if (!lineId) lineId = m.lineId ?? null; }
      } else if (lineId) {
        const l = await this.prisma.productionLine.findUnique({ where: { id: lineId }, select: { areaId: true } });
        if (l) areaId = l.areaId ?? null;
      }
    }
    return { machineId, lineId, areaId };
  }

  // ── Energy meters ────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('meter-templates')
  meterTemplates() {
    return METER_TEMPLATES.map((t) => ({ key: t.key, label: t.label, manufacturer: t.manufacturer, models: t.models, tagCount: t.tags.length }));
  }

  @UseGuards(JwtAuthGuard)
  @Get('meters')
  async meters() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.energyMeter.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      include: {
        device: { select: { id: true, deviceCode: true, protocol: true, status: true } },
        _count: { select: { tags: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Create a meter + its Modbus device (linked) in one step, optionally applying a template. */
  @UseGuards(JwtAuthGuard)
  @Post('meters')
  async createMeter(@Body() b: any) {
    if (!b?.meterNumber || !b?.name) throw new BadRequestException('meterNumber and name required');
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    const scope = await this.resolveScope(b);

    const device = await this.prisma.device.create({
      data: {
        factoryId,
        gatewayId: this.ctx.getGatewayId(),
        name: `${b.name} (meter)`,
        deviceCode: `${b.meterNumber}-DEV`,
        type: 'METER',
        protocol: b.protocol ?? 'MODBUS',
        ipAddress: b.ipAddress ?? null,
        port: b.port ?? 502,
        unitId: b.unitId ?? 1,
        serialPort: b.serialPort ?? null,
        baudRate: b.baudRate ?? null,
        parity: b.parity ?? null,
        dataBits: b.dataBits ?? null,
        stopBits: b.stopBits ?? null,
        pollIntervalMs: b.pollIntervalMs ?? null,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        status: 'DISCONNECTED',
      },
    });

    const meter = await this.prisma.energyMeter.create({
      data: {
        factoryId,
        deviceId: device.id,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        meterNumber: b.meterNumber,
        name: b.name,
        type: b.type ?? 'ELECTRICAL',
        unit: b.unit ?? 'kWh',
        manufacturer: b.manufacturer ?? null,
        model: b.model ?? null,
        templateKey: b.templateKey ?? null,
        location: b.location ?? null,
      },
    });
    if (b.templateKey) await this.applyTemplateTags(meter.id, b.meterNumber, factoryId, device.id, b.templateKey, b.machineId ?? null);
    return meter;
  }

  @UseGuards(JwtAuthGuard)
  @Post('meters/:id/apply-template')
  async applyTemplate(@Param('id') id: string, @Body() b: { templateKey: string }) {
    const meter = await this.prisma.energyMeter.findUnique({ where: { id } });
    if (!meter) throw new BadRequestException('Meter not found');
    if (!b?.templateKey) throw new BadRequestException('templateKey required');
    const created = await this.applyTemplateTags(meter.id, meter.meterNumber, meter.factoryId, meter.deviceId, b.templateKey, meter.machineId);
    await this.prisma.energyMeter.update({ where: { id }, data: { templateKey: b.templateKey } });
    return { ok: true, created };
  }

  private async applyTemplateTags(meterId: string, meterNumber: string, factoryId: string, deviceId: string | null, templateKey: string, machineId: string | null) {
    const specs = instantiateMeterTags(templateKey, meterNumber);
    let created = 0;
    for (const s of specs) {
      const exists = await this.prisma.tagDefinition.findFirst({ where: { factoryId, code: s.code } });
      if (exists) continue;
      await this.prisma.tagDefinition.create({
        data: {
          factoryId, meterId, deviceId, machineId,
          code: s.code, name: s.name, dataType: s.dataType as any, tagType: 'ENERGY',
          unit: s.unit, address: s.address, registerType: s.registerType,
          wordCount: s.wordCount, wordOrder: s.wordOrder, scaleFactor: s.scaleFactor,
          energyRole: s.energyRole,
        },
      });
      created++;
    }
    return created;
  }

  // ── Devices ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('devices')
  async devices() {
    const gatewayId = this.ctx.getGatewayId();
    return this.prisma.device.findMany({
      where: { ...(gatewayId ? { gatewayId } : {}), isActive: true },
      include: { machine: { select: { id: true, code: true, name: true } }, tagDefinitions: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('devices')
  async createDevice(@Body() b: any) {
    if (!b?.name || !b?.deviceCode) throw new BadRequestException('name and deviceCode required');
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    const scope = await this.resolveScope(b);
    const isEdgeCounter = b.type === 'EDGE_COUNTER';
    const device = await this.prisma.device.create({
      data: {
        factoryId,
        gatewayId: this.ctx.getGatewayId(),
        name: b.name,
        deviceCode: b.deviceCode,
        type: b.type ?? 'PLC',
        protocol: b.protocol ?? 'MODBUS',
        ipAddress: b.ipAddress ?? null,
        port: b.port ?? 502,
        unitId: b.unitId ?? 1,
        serialPort: b.serialPort ?? null,
        baudRate: b.baudRate ?? null,
        parity: b.parity ?? null,
        dataBits: b.dataBits ?? null,
        stopBits: b.stopBits ?? null,
        // EdgeCounter devices poll fast by default so short sensor pulses aren't missed.
        pollIntervalMs: b.pollIntervalMs ?? (isEdgeCounter ? 100 : null),
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        config: isEdgeCounter && b.edgeCounter ? { edgeCounter: b.edgeCounter } : undefined,
        status: 'DISCONNECTED',
      },
    });
    if (isEdgeCounter && b.edgeCounter) {
      await this.provisionEdgeCounterTags(device.id, device.deviceCode, factoryId, scope, b.edgeCounter as EdgeCounterBlocks);
    }
    return device;
  }

  /** Auto-create an EdgeCounter device's DI/Coil/HR/IR tags (idempotent by factory+code). */
  private async provisionEdgeCounterTags(
    deviceId: string, deviceCode: string, factoryId: string,
    scope: { machineId: string | null; lineId: string | null; areaId: string | null },
    blocks: EdgeCounterBlocks,
  ) {
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

  @UseGuards(JwtAuthGuard)
  @Patch('devices/:id')
  updateDevice(@Param('id') id: string, @Body() b: any) {
    return this.prisma.device.update({
      where: { id },
      data: {
        ...(b.name !== undefined && { name: b.name }),
        ...(b.protocol !== undefined && { protocol: b.protocol }),
        ...(b.ipAddress !== undefined && { ipAddress: b.ipAddress }),
        ...(b.port !== undefined && { port: b.port }),
        ...(b.unitId !== undefined && { unitId: b.unitId }),
        ...(b.serialPort !== undefined && { serialPort: b.serialPort }),
        ...(b.baudRate !== undefined && { baudRate: b.baudRate }),
        ...(b.parity !== undefined && { parity: b.parity }),
        ...(b.dataBits !== undefined && { dataBits: b.dataBits }),
        ...(b.stopBits !== undefined && { stopBits: b.stopBits }),
        ...(b.pollIntervalMs !== undefined && { pollIntervalMs: b.pollIntervalMs }),
        ...(b.machineId !== undefined && { machineId: b.machineId }),
        ...(b.lineId !== undefined && { lineId: b.lineId }),
        ...(b.areaId !== undefined && { areaId: b.areaId }),
        ...(b.isActive !== undefined && { isActive: b.isActive }),
      },
    });
  }

  // ── Tags ─────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('tags')
  tags(@Query('deviceId') deviceId?: string, @Query('meterId') meterId?: string) {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.tagDefinition.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(meterId ? { meterId } : {}),
        isActive: true,
      },
      include: { currentValue: true, machine: { select: { code: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('tags')
  async createTag(@Body() b: any) {
    if (!b?.code || !b?.name) throw new BadRequestException('code and name required');
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    await this.assertCounterRoleUnique(factoryId, b.machineId ?? null, b.counterRole, b.tagType);
    const scope = await this.resolveScope(b);
    return this.prisma.tagDefinition.create({
      data: {
        factoryId,
        code: b.code,
        name: b.name,
        dataType: b.dataType ?? 'INT',
        tagType: b.tagType ?? 'MEASUREMENT',
        unit: b.unit ?? null,
        deviceId: b.deviceId ?? null,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        meterId: b.meterId ?? null,
        energyRole: b.energyRole ?? null,
        address: b.address ?? null,
        registerType: b.registerType ?? 'HOLDING',
        wordCount: b.wordCount ?? 1,
        wordOrder: b.wordOrder ?? 'BIG',
        scaleFactor: b.scaleFactor ?? null,
        offset: b.offset ?? null,
        counterRole: b.counterRole ?? null,
        edgeType: b.edgeType ?? 'RISING',
        pollIntervalMs: b.pollIntervalMs ?? null,
        ...(b.mqttPublishMode !== undefined && { mqttPublishMode: b.mqttPublishMode }),
        ...(b.mqttPublishRateSec !== undefined && { mqttPublishRateSec: b.mqttPublishRateSec }),
        ...(b.historizationMode !== undefined && { historizationMode: b.historizationMode }),
        ...(b.historizationRateSec !== undefined && { historizationRateSec: b.historizationRateSec }),
        ...(b.deadband !== undefined && { deadband: b.deadband }),
        // How this signal is to be READ. Configurable here as well as in the main
        // app, because commissioning happens at the panel, often with no server.
        ...(b.isMachineStatus !== undefined && { isMachineStatus: b.isMachineStatus }),
        ...(b.statusMap !== undefined && { statusMap: b.statusMap }),
        ...(b.signalRole !== undefined && { signalRole: b.signalRole }),
        ...(b.pulseWindowMs !== undefined && { pulseWindowMs: b.pulseWindowMs }),
        ...(b.pulseMinEdges !== undefined && { pulseMinEdges: b.pulseMinEdges }),
        ...(b.idleThresholdMs !== undefined && { idleThresholdMs: b.idleThresholdMs }),
      },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch('tags/:id')
  async updateTag(@Param('id') id: string, @Body() b: any) {
    const existing = await this.prisma.tagDefinition.findUnique({ where: { id }, select: { factoryId: true, machineId: true, counterRole: true, tagType: true } });
    if (existing) {
      const effMachineId = b.machineId !== undefined ? b.machineId : existing.machineId;
      const effRole = b.counterRole !== undefined ? b.counterRole : existing.counterRole;
      const effType = b.tagType !== undefined ? b.tagType : existing.tagType;
      await this.assertCounterRoleUnique(existing.factoryId, effMachineId, effRole, effType, id);
    }
    const allowed = [
      'name', 'unit', 'dataType', 'tagType', 'machineId', 'lineId', 'areaId', 'deviceId', 'address', 'registerType',
      'wordCount', 'wordOrder', 'scaleFactor', 'offset', 'counterRole', 'edgeType', 'pollIntervalMs', 'isActive',
      'mqttPublishMode', 'mqttPublishRateSec', 'historizationMode', 'historizationRateSec', 'deadband', 'historizationEnabled', 'isMachineStatus', 'statusMap',
      'signalRole', 'pulseWindowMs', 'pulseMinEdges', 'idleThresholdMs',
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
    return this.prisma.tagDefinition.update({ where: { id }, data });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('tags/:id')
  async deleteTag(@Param('id') id: string) {
    await this.prisma.tagDefinition.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  // ── Live values & job orders (for monitoring + counter mapping) ──
  @UseGuards(JwtAuthGuard)
  @Get('live')
  async live() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.tagCurrentValue.findMany({
      where: factoryId ? { factoryId } : {},
      include: { tag: { select: { code: true, name: true, unit: true, tagType: true, counterRole: true } } },
      orderBy: { timestamp: 'desc' },
      take: 200,
    });
  }

  /**
   * What the pulse detector sees, live.
   *
   * A RUN_MODE_PULSED signal that never fires and one that is genuinely steady
   * look the same from every screen: the machine reads RUNNING. Standing at the
   * machine and flashing the lamp therefore produces no feedback at all, which
   * is how a wiring fault, a stale gateway build and a too-slow poll became
   * indistinguishable in the field.
   *
   * Each row answers the three questions separately:
   *   • `everSawAnEdge` false  → the bit is not changing. The signal is not
   *     reaching this input; look at the tap, not at the software.
   *   • edges arriving but `edgesInWindow` below `minEdges` → it is changing too
   *     slowly, or the window is too short for this lamp.
   *   • `fastestResolvableFlashHz` below the lamp's rate → the sampler cannot
   *     see it whatever it does. Poll faster; no other setting will help.
   *
   * An empty array means no pulsed tag is configured; a row whose `detector` is
   * null means the tag has never been sampled — it is inactive, unassigned to a
   * device, or this build predates RUN_MODE_PULSED.
   */
  @UseGuards(JwtAuthGuard)
  @Get('signals/pulse')
  async pulseSignals() {
    const factoryId = this.ctx.getFactoryId();
    const configured = await this.prisma.tagDefinition.findMany({
      where: { ...(factoryId ? { factoryId } : {}), signalRole: 'RUN_MODE_PULSED' },
      select: {
        id: true, code: true, name: true, isActive: true, isMachineStatus: true,
        pulseWindowMs: true, pulseMinEdges: true,
        machine: { select: { code: true } }, device: { select: { name: true, pollIntervalMs: true } },
      },
    });
    const seen = new Map(this.statusSvc.pulseDiagnostics().map((d) => [d.tagId, d]));
    return configured.map((t) => ({
      code: t.code,
      name: t.name,
      machine: t.machine?.code ?? null,
      device: t.device?.name ?? null,
      devicePollIntervalMs: t.device?.pollIntervalMs ?? null,
      isActive: t.isActive,
      // A pulsed signal that does not drive the machine's state is inert: it is
      // read and historized, and nothing acts on it.
      drivesMachineState: t.isMachineStatus,
      configured: { windowMs: t.pulseWindowMs, minEdges: t.pulseMinEdges },
      detector: seen.get(t.id) ?? null,
    }));
  }

  /** Tail of the Modbus error log (timeouts, CRC/port errors) for the dashboard. */
  @UseGuards(JwtAuthGuard)
  @Get('logs/modbus')
  modbusLog(@Query('lines') lines?: string) {
    const n = Math.min(Math.max(parseInt(lines ?? '200', 10) || 200, 1), 1000);
    return { path: this.mlog.path(), lines: this.mlog.tail(n) };
  }

  @UseGuards(JwtAuthGuard)
  /**
   * The line's material balance — see {@link CountBalanceService}.
   *
   * On the gateway and not only in the MES because this is the number a
   * technician needs while STANDING AT the line, comparing what a machine's own
   * panel says with what the gateway counted from it.
   */
  @Get('count-balance')
  async countBalance() {
    return this.balance.balance();
  }

  /**
   * The reconciled line — see {@link LineBalanceService}.
   *
   * Deliberately gateway-only. What a conveyor holds is plant-floor data that
   * belongs to whoever can walk over and count it, and the corrections it
   * produces should be watched from the same screen that shows the raw counts.
   */
  /**
   * Counter health — see {@link CounterService.counterDiagnostics}.
   *
   * The sibling comparison is the part that found the fault on this line. Two
   * counters on ONE machine watch the same product stream, so their rates must
   * agree. When one reports a fraction of the other, no amount of polling will
   * reconcile them: the signals themselves are different shapes, and the answer
   * is at the sensor.
   */
  /**
   * What each machine is allowed to count, and what the balance has taken off.
   *
   * Served together on purpose: a limit and its effect are one question. Reading
   * "tolerance +5" without "and it trimmed 340 counts this hour" tells a plant
   * nothing about whether the limit is protecting it or hiding a broken sensor.
   */
  @Get('machine-limits')
  async machineLimits() {
    const stored = this.counter.machineLimits();
    const trims = new Map(this.counter.balanceTrims().map((t) => [t.machineId, t]));
    const machines = await this.prisma.machine.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const dropped = new Map(this.counter.stoppedWhileIdleCounts().map((d) => [d.tagId, d.count]));
    const tags = await this.prisma.tagDefinition.findMany({
      where: { isActive: true, counterRole: { not: null } },
      select: { id: true, machineId: true },
    });
    const stoppedByMachine = new Map<string, number>();
    for (const t of tags) {
      if (!t.machineId) continue;
      const n = dropped.get(t.id) ?? 0;
      if (n > 0) stoppedByMachine.set(t.machineId, (stoppedByMachine.get(t.machineId) ?? 0) + n);
    }

    return machines.map((m) => {
      const entry = stored[m.id];
      return {
        machineId: m.id,
        code: m.code,
        name: m.name,
        debounceMs: entry?.debounceMs ?? 0,
        tolerancePerMin: entry?.tolerancePerMin ?? null,
        // ── What the cap ACTUALLY is, which is not what is stored ──────────
        // This used to report a null tolerance as "off", and say so in a
        // comment, because off WAS the default. It is not any more: an
        // unconfigured machine is now capped at design speed + 25%.
        //
        // Leaving the old label would have put "no limit" on a screen while
        // the gateway was trimming counts behind it -- and an operator who
        // cannot see that a limit is trimming cannot tell a sensor that has
        // been fixed from a cap that is hiding it.
        capSource: entry === undefined
          ? 'default'                                        // design + 25%
          : entry.tolerancePerMin === null ? 'off' : 'stated',
        trimmedGood: trims.get(m.id)?.trimmedGood ?? 0,
        trimmedBad: trims.get(m.id)?.trimmedBad ?? 0,
        // Pulses seen while this machine was NOT running. Dropped, not booked.
        // A number that climbs here is an input turning while its machine
        // stands still -- which no cap and no debounce will explain.
        droppedWhileStopped: stoppedByMachine.get(m.id) ?? 0,
      };
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch('machine-limits/:machineId')
  setMachineLimit(
    @Param('machineId') machineId: string,
    @Body() b: { debounceMs?: number; tolerancePerMin?: number | null },
  ) {
    // Applied on the next cycle — no restart. A tolerance that needs the service
    // bounced is a tolerance nobody adjusts during a shift, which is the only
    // time anybody wants to.
    return this.counter.setMachineLimit(machineId, b);
  }

  @Get('counter-health')
  async counterHealth() {
    const diags = this.counter.counterDiagnostics();
    const codes = await this.prisma.tagDefinition.findMany({
      where: { id: { in: diags.map((d) => d.tagId) } },
      select: { id: true, code: true, address: true, edgeType: true, machine: { select: { code: true } } },
    });
    const meta = new Map(codes.map((c) => [c.id, c]));

    // Fastest counter per machine — the yardstick its siblings are held to.
    const best = new Map<string, number>();
    for (const d of diags) {
      if (!d.machineId || d.edgesPerMin === null) continue;
      best.set(d.machineId, Math.max(best.get(d.machineId) ?? 0, d.edgesPerMin));
    }

    return diags.map((d) => {
      const peer = d.machineId ? best.get(d.machineId) ?? null : null;
      const share = peer && peer > 0 && d.edgesPerMin !== null
        ? Math.round((d.edgesPerMin / peer) * 100) : null;
      return {
        ...d,
        code: meta.get(d.tagId)?.code ?? d.tagId,
        address: meta.get(d.tagId)?.address ?? null,
        edgeType: meta.get(d.tagId)?.edgeType ?? null,
        machineCode: meta.get(d.tagId)?.machine?.code ?? null,
        /** This counter's rate as a share of the busiest counter on its machine. */
        peerSharePct: share,
        /**
         * What the counted pulse is probably really worth, when the signal is
         * aliasing AND a sibling gives us the true rate. Capture probability is
         * pulse width over sample interval, so the width follows from the share.
         */
        estimatedPulseMs: d.aliasing && share !== null && d.sampleIntervalMs
          ? Math.round((share / 100) * d.sampleIntervalMs)
          : null,
      };
    });
  }

  @Get('line-balance')
  async lineBalanceView() {
    return this.lineBalance.balance();
  }

  /** Current balance configuration, one row per machine on this factory's lines. */
  @Get('line-balance/config')
  async lineBalanceConfig() {
    const factoryId = this.ctx.getFactoryId();
    const machines = await this.prisma.machine.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true, code: { not: { startsWith: 'X-' } } },
      select: { id: true, code: true, name: true, lineId: true },
      orderBy: { code: 'asc' },
    });
    const cfg = await this.prisma.lineBalanceConfig.findMany({
      where: factoryId ? { factoryId } : {},
    });
    const byMachine = new Map(cfg.map((c) => [c.machineId, c]));
    // Which machine each belt actually runs TO. Every row describes ONE link —
    // the belt from this machine to the next — and the chaining is done by the
    // balance itself, each machine measured against its neighbour's already
    // corrected figure. Naming the far end on screen is the difference between
    // entering one conveyor and entering a running total of several.
    //
    // Machine codes ARE routing order here: renumber-machines.seed keeps them
    // aligned with the routing, and re-derives them whenever it does not.
    return machines.map((m, i) => ({
      machineId: m.id, code: m.code, name: m.name,
      nextMachineCode: machines[i + 1]?.code ?? null,
      enabled: byMachine.get(m.id)?.enabled ?? true,
      isAnchor: byMachine.get(m.id)?.isAnchor ?? false,
      bufferToNextQty: byMachine.get(m.id)?.bufferToNextQty ?? null,
      bufferUnit: byMachine.get(m.id)?.bufferUnit ?? null,
      transitSec: byMachine.get(m.id)?.transitSec ?? null,
      maxCorrectionPct: byMachine.get(m.id)?.maxCorrectionPct ?? 10,
      applyAdjustment: byMachine.get(m.id)?.applyAdjustment ?? false,
      configured: byMachine.has(m.id),
    }));
  }

  /**
   * Save one machine's balance settings.
   *
   * `isAnchor` is exclusive per factory: setting it here clears it everywhere
   * else in the same write. Two references on one line would each be corrected
   * towards the other, and the numbers would never settle.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('line-balance/config/:machineId')
  async saveLineBalance(
    @Param('machineId') machineId: string,
    @Body() body: {
      enabled?: boolean; isAnchor?: boolean; bufferToNextQty?: number | null;
      bufferUnit?: string | null;
      transitSec?: number | null; maxCorrectionPct?: number; applyAdjustment?: boolean;
    },
  ) {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId }, select: { id: true, factoryId: true },
    });
    if (!machine) throw new BadRequestException('machine not found');

    if (body.maxCorrectionPct !== undefined
      && (!Number.isFinite(body.maxCorrectionPct) || body.maxCorrectionPct < 0 || body.maxCorrectionPct > 100)) {
      throw new BadRequestException('maxCorrectionPct must be between 0 and 100');
    }
    if (body.bufferUnit !== undefined && body.bufferUnit !== null
      && !['PIECE', 'INNER', 'CARTON', 'PALLET'].includes(body.bufferUnit)) {
      throw new BadRequestException('bufferUnit must be a packaging-ladder unit');
    }
    if (body.bufferToNextQty !== undefined && body.bufferToNextQty !== null
      && (!Number.isFinite(body.bufferToNextQty) || body.bufferToNextQty < 0)) {
      throw new BadRequestException('bufferToNextQty must be zero or more');
    }

    const data = {
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.isAnchor !== undefined && { isAnchor: body.isAnchor }),
      ...(body.bufferToNextQty !== undefined && { bufferToNextQty: body.bufferToNextQty }),
      ...(body.bufferUnit !== undefined && { bufferUnit: body.bufferUnit }),
      ...(body.transitSec !== undefined && { transitSec: body.transitSec }),
      ...(body.maxCorrectionPct !== undefined && { maxCorrectionPct: body.maxCorrectionPct }),
      ...(body.applyAdjustment !== undefined && { applyAdjustment: body.applyAdjustment }),
    };

    if (body.isAnchor) {
      await this.prisma.lineBalanceConfig.updateMany({
        where: { factoryId: machine.factoryId, machineId: { not: machineId } },
        data: { isAnchor: false },
      });
    }

    return this.prisma.lineBalanceConfig.upsert({
      where: { machineId },
      create: { machineId, factoryId: machine.factoryId, ...data },
      update: data,
    });
  }

  @Get('job-orders')
  async jobOrders() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.jobOrder.findMany({
      where: { ...(factoryId ? { factoryId } : {}), status: 'EXECUTING' },
      select: {
        id: true, operationName: true, machineId: true,
        actualQtyGood: true, actualQtyRejected: true,
        machine: { select: { code: true, name: true } },
        workOrder: { select: { orderNumber: true } },
      },
      orderBy: { actualStart: 'desc' },
      take: 100,
    });
  }
  // ── Signal interpretation: what a state MEANS, and what raises an alarm ──
  //
  // Both are editable at the panel as well as in the main app. A commissioning
  // engineer standing at the cabinet with no route to the server still needs to
  // be able to say that this machine's changeover is not charged to OEE.

  @Get('state-rules')
  stateRules(@Query('machineId') machineId?: string) {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.machineStateRule.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineId ? { OR: [{ machineId }, { machineId: null }] } : {}),
      },
      include: { machine: { select: { id: true, code: true, name: true } } },
      orderBy: [{ machineId: 'asc' }, { state: 'asc' }],
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('state-rules')
  async upsertStateRule(@Body() b: any) {
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    if (!b?.state) throw new BadRequestException('state required');

    const data = {
      factoryId,
      machineId: b.machineId ?? null,
      state: String(b.state).toUpperCase(),
      isDowntime: b.isDowntime ?? true,
      isPlanned: b.isPlanned ?? false,
      affectsOEE: b.affectsOEE ?? true,
      reasonCode: b.reasonCode ?? null,
      category: (b.category ?? 'OTHER') as never,
      debounceSeconds: b.debounceSeconds ?? 0,
      description: b.description ?? null,
      isActive: b.isActive ?? true,
    };
    // One rule per (factory, machine, state): editing the same state twice must
    // replace it, not leave a second rule that never applies.
    const existing = await this.prisma.machineStateRule.findFirst({
      where: { factoryId, machineId: data.machineId, state: data.state },
      select: { id: true },
    });
    return existing
      ? this.prisma.machineStateRule.update({ where: { id: existing.id }, data })
      : this.prisma.machineStateRule.create({ data });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('state-rules/:id')
  async deleteStateRule(@Param('id') id: string) {
    await this.prisma.machineStateRule.delete({ where: { id } });
    return { ok: true };
  }

  @Get('alarm-definitions')
  alarmDefinitions(@Query('tagId') tagId?: string) {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.alarmDefinition.findMany({
      where: { ...(factoryId ? { factoryId } : {}), ...(tagId ? { tagId } : {}) },
      include: { tag: { select: { id: true, code: true, unit: true, machine: { select: { code: true } } } } },
      orderBy: { code: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('alarm-definitions')
  async createAlarmDefinition(@Body() b: any) {
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    if (!b?.code || !b?.name) throw new BadRequestException('code and name required');
    if (!b?.tagId) throw new BadRequestException('An alarm must be bound to a tag');
    // Without a threshold there is nothing to compare against, so the alarm
    // could never fire. Better to refuse the save than to store a silent rule.
    if (b.threshold === null || b.threshold === undefined || Number.isNaN(Number(b.threshold))) {
      throw new BadRequestException('A numeric threshold is required');
    }
    return this.prisma.alarmDefinition.create({
      data: {
        factoryId,
        tagId: b.tagId,
        code: String(b.code).trim(),
        name: String(b.name).trim(),
        severity: (b.severity ?? 'HIGH') as never,
        category: b.category ?? 'PROCESS',
        condition: String(b.condition ?? 'GT').toUpperCase(),
        threshold: Number(b.threshold),
        deadband: b.deadband != null ? Number(b.deadband) : null,
        delaySeconds: Number(b.delaySeconds ?? 0),
        autoAck: !!b.autoAck,
        isActive: b.isActive !== false,
      },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch('alarm-definitions/:id')
  async updateAlarmDefinition(@Param('id') id: string, @Body() b: any) {
    const allowed = [
      'code', 'name', 'tagId', 'severity', 'category', 'condition',
      'threshold', 'deadband', 'delaySeconds', 'autoAck', 'isActive',
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
    return this.prisma.alarmDefinition.update({ where: { id }, data });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('alarm-definitions/:id')
  async deleteAlarmDefinition(@Param('id') id: string) {
    // Past events outlive the rule — an alarm history that vanishes when
    // somebody edits a rule is not a history.
    await this.prisma.alarmEvent.updateMany({
      where: { alarmDefinitionId: id },
      data: { alarmDefinitionId: null },
    });
    await this.prisma.alarmDefinition.delete({ where: { id } });
    return { ok: true };
  }
}
