import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  ModbusClient, instantiateMeterTags,
  type ModbusTransport, type RegisterType, type ModbusDataType, type EdgeType, type TagBinding,
} from '@i360/industrial-drivers';

import { PrismaService } from '../prisma/prisma.service';
import { MqttService } from '../services/mqtt.service';
import { GatewayContextService } from '../context/gateway-context.service';
import { IngestService, type TagReadingRecord } from './ingest.service';
import { CounterService, type CounterTag } from './counter.service';
import { auditBindings, describeOrphans, suggestedIntervalMs } from './config-audit';
import { EnergyReadingService, type MeterContext } from './energy-reading.service';
import { StatusService, type StatusTag } from './status.service';
import { AlarmService } from './alarm.service';
import { ModbusLogService } from './modbus-log.service';

interface PolledTag {
  binding: TagBinding;
  tagId: string;
  code: string;
  factoryId: string;
  machineId: string | null;
  machineCode: string | null;
  isCounter: boolean;
  counterTag: CounterTag;
  energyRole: string | null;
  historize: boolean;
  mqttPublishMode: string;
  mqttPublishRateSec: number;
  historizationMode: string;
  historizationRateSec: number;
  deadband: number | null;
  isMachineStatus: boolean;
  statusTag: StatusTag;
}

interface DeviceRuntime {
  id: string;
  name: string;
  client: ModbusClient;
  tags: PolledTag[];
  meter: MeterContext | null;
  intervalMs: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  /** Rate-limits the slow-cycle warning to one line a minute per device. */
  slowLoggedAt?: number;
  /** The achieved sample period last reported, so a steady one is not re-reported. */
  reportedRate?: number;
  /**
   * Work that has to leave the machine, waiting its turn OFF the read path.
   *
   * Everything here — current-value writes, historian points, MQTT, machine
   * state, alarms — travels to a server on the far side of the plant's internet
   * link. The read loop used to await it, so the interval between two Modbus
   * samples was a WAN round-trip (~430 ms measured on site) rather than the
   * 100 ms it was configured for, and every counter pulse shorter than that was
   * invisible. The reads now hand work to this queue and go straight back to
   * the wire; the queue drains at whatever speed the link allows.
   */
  outbox: Array<() => Promise<unknown>>;
  /** True while {@link ModbusPollerService.drainOutbox} is running for this device. */
  draining: boolean;
  /** Jobs discarded because the link fell far enough behind to threaten memory. */
  dropped: number;
  /** Rate-limits the backlog warning to one line a minute per device. */
  dropLoggedAt?: number;
  /** Duration of the last Modbus round-trip alone, for the slow-cycle report. */
  lastReadMs?: number;
  /** Duration of the last complete cycle, so the loop waits only the remainder. */
  lastCycleMs?: number;
  /** Cycles run since the last report, for the achieved sample period. */
  cycles?: number;
  /** When the achieved period was last measured from. */
  cyclesSince?: number;
  signature: string; // detects config changes to trigger rebuild
}

/** Map a Device.protocol string to a Modbus transport. */
function transportFor(protocol: string): ModbusTransport {
  if (protocol === 'MODBUS_RTU') return 'RTU';
  if (protocol === 'MODBUS_RTU_TCP') return 'RTU_TCP';
  return 'TCP';
}

/**
 * Owns one Modbus connection per device assigned to this gateway, polls every
 * bound tag on its interval, and fans readings to the counter + ingest layers.
 * Reloads device/tag config periodically so online edits apply without restart.
 */
@Injectable()
export class ModbusPollerService implements OnModuleDestroy {
  /** Drains counted edges to the database, off the poll path. */
  private flushTimer: NodeJS.Timeout | null = null;
  /** machineId → factoryId, so a flushed count can be published on its topic. */
  private readonly factoryOfMachine = new Map<string, string>();
  private readonly logger = new Logger(ModbusPollerService.name);
  private readonly devices = new Map<string, DeviceRuntime>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly ingest: IngestService,
    private readonly counter: CounterService,
    private readonly energy: EnergyReadingService,
    private readonly statusSvc: StatusService,
    private readonly alarms: AlarmService,
    private readonly ctx: GatewayContextService,
    private readonly config: ConfigService,
    private readonly mlog: ModbusLogService,
  ) {}

  onModuleDestroy() {
    for (const d of this.devices.values()) {
      if (d.timer) { clearTimeout(d.timer); d.timer = null; }
      void d.client.disconnect();
    }
  }

  /**
   * Counter tags that exist in the database but are not, and cannot be, polled.
   *
   * ── Why this is worth a warning ─────────────────────────────────────────────
   * A tag deleted from the UI leaves its row behind — detached from its device
   * (`deviceId` null) or simply deactivated. The poller already ignores them,
   * because it loads tags THROUGH a device and filters on `isActive`. So they do
   * no harm to the reading.
   *
   * What they do harm is every diagnosis after them. On this plant seven such
   * counters were carrying stale `gateway_counter_states` rows with totals of
   * 5477, 2300 and 338 — numbers that look exactly like live counts to anyone
   * reading the table, and that cost real time during the 25 Aug investigation.
   * They also make an address collision invisible: two rows can claim one input
   * while only one of them is live, and nothing says which.
   *
   * Reported ONCE per process, with the ids, so the list can be acted on rather
   * than merely noticed. Never deleted here — this service reads configuration,
   * it does not get to decide what the plant keeps.
   */
  private orphansReported = false;

  private async auditOrphanTags(): Promise<void> {
    if (this.orphansReported) return;
    this.orphansReported = true;
    try {
      const rows = await this.prisma.tagDefinition.findMany({
        where: {
          tagType: 'COUNTER',
          OR: [{ deviceId: null }, { isActive: false }],
        },
        select: {
          id: true, code: true, isActive: true, deviceId: true, address: true,
          machine: { select: { code: true } },
        },
        orderBy: { code: 'asc' },
      });
      const stored = await this.prisma.gatewayCounterState.findMany({
        where: { tagId: { in: rows.map((r) => r.id) } },
        select: { tagId: true, accumulated: true },
      });
      const message = describeOrphans(rows, new Map(stored.map((w) => [w.tagId, w.accumulated])));
      if (message) this.logger.warn(message);
    } catch {
      // A configuration audit must never be the reason polling does not start.
    }
  }


  /**
   * Configuration that is legal, loads cleanly, and is still a trap.
   *
   * None of these stop the gateway. All three cost hours when something later
   * goes wrong, because they make the reader's mental model quietly false:
   *
   *   NAME vs ADDRESS   a tag called `..._DI3` reading input 2. Three tags on
   *                     this plant do exactly that, and every conversation about
   *                     them has to start by establishing which number is real.
   *
   *   MIXED POLARITY    one machine's GOOD on RISING and its TOTAL on FALLING.
   *                     Perfectly valid — sensors differ — but the two then
   *                     respond differently to the same contact ring, and the
   *                     pair drifts apart for a reason nothing on screen
   *                     explains. M2 carries this today.
   *
   *   ADDRESS CLASH     two active tags on one device reading one input. The
   *                     poller obliges; the plant sees one physical signal
   *                     counted under two names.
   *
   * Reported once per process with the specifics, because a warning a reader
   * cannot act on is just noise.
   */
  private bindingsReported = false;

  private auditTagBindings(devices: any[]): void {
    if (this.bindingsReported) return;
    this.bindingsReported = true;

    const notes: string[] = [];
    for (const dev of devices) notes.push(...auditBindings(dev.name, dev.tagDefinitions ?? []));

    if (notes.length === 0) return;
    this.logger.warn(
      `${notes.length} counter binding(s) load cleanly but do not agree with themselves. `
      + 'None of these stop a reading; all of them make the next fault harder to '
      + 'find than it needs to be:\n' + notes.map((n) => `  ${n}`).join('\n'),
    );
  }

  /** Reconcile runtime against DB config every 10s (also the first load). */
  @Interval('poller-reload', 10_000)
  async reload() {
    const gatewayId = this.ctx.getGatewayId();
    if (!gatewayId) return;

    let configured;
    try {
      configured = await this.prisma.device.findMany({
        where: { gatewayId, protocol: { startsWith: 'MODBUS' }, isActive: true },
        include: {
          machine: { select: { id: true, code: true } },
          energyMeter: { select: { id: true, machineId: true, unit: true, meterNumber: true, templateKey: true } },
          tagDefinitions: {
            where: { isActive: true, address: { not: null } },
            include: { machine: { select: { id: true, code: true } } },
          },
        },
      });
    } catch (err) {
      this.logger.debug(`Device reload failed: ${(err as Error).message}`);
      return;
    }

    const seen = new Set<string>();
    const defaultInterval = this.config.get<number>('defaultPollIntervalMs') ?? 1000;

    // Say once what is in the database but not in the plant, and once what is
    // in the plant but does not agree with itself.
    void this.auditOrphanTags();
    void this.auditTagBindings(configured);

    // Which tags may drive machine state, decided across ALL devices before any
    // is rebuilt — the rules are about a MACHINE, and a machine's signals can be
    // spread over more than one I/O module.
    const statusDrivers = this.auditStatusTags(configured, defaultInterval);

    for (const dev of configured) {
      seen.add(dev.id);

      // Auto-provision a meter's ENERGY tags from its template the first time we
      // see it (templateKey set by the web/edge UI, but no energy tags yet). The
      // tags are picked up on the next reload tick.
      const m = dev.energyMeter;
      if (m?.templateKey && !dev.tagDefinitions.some((t) => t.tagType === 'ENERGY')) {
        await this.provisionMeterTags(dev.id, m.id, dev.factoryId, m.machineId ?? dev.machineId ?? null, m.meterNumber, m.templateKey);
        continue; // reload next tick with the new tags
      }

      const signature = JSON.stringify({
        proto: dev.protocol, ip: dev.ipAddress, port: dev.port, unit: dev.unitId, poll: dev.pollIntervalMs,
        serial: [dev.serialPort, dev.baudRate, dev.parity, dev.dataBits, dev.stopBits], meter: dev.energyMeter?.id ?? null,
        tags: dev.tagDefinitions.map((t) => [t.id, t.address, t.registerType, t.dataType, t.scaleFactor, t.offset, t.wordCount, t.wordOrder, t.counterRole, t.edgeType, t.machineId, t.energyRole, (t as any).historizationEnabled, (t as any).mqttPublishMode, (t as any).mqttPublishRateSec, (t as any).historizationMode, (t as any).historizationRateSec, (t as any).deadband, (t as any).isMachineStatus, (t as any).signalRole, (t as any).pulseWindowMs, (t as any).pulseMinEdges, (t as any).idleThresholdMs]),
      });
      const existing = this.devices.get(dev.id);
      if (existing && existing.signature === signature) continue; // unchanged

      // (Re)build this device's runtime.
      if (existing) {
        if (existing.timer) { clearTimeout(existing.timer); existing.timer = null; }
        await existing.client.disconnect().catch(() => undefined);
      }

      const client = new ModbusClient({
        transport: transportFor(dev.protocol),
        host: dev.ipAddress ?? '127.0.0.1',
        port: dev.port ?? 502,
        serialPort: dev.serialPort ?? undefined,
        baudRate: dev.baudRate ?? undefined,
        parity: (dev.parity as 'none' | 'even' | 'odd') ?? undefined,
        dataBits: (dev.dataBits as 7 | 8) ?? undefined,
        stopBits: (dev.stopBits as 1 | 2) ?? undefined,
        unitId: dev.unitId ?? 1,
        timeoutMs: 3000,
      });

      const tags: PolledTag[] = dev.tagDefinitions.map((t) => {
        if (t.machineId && t.factoryId) this.factoryOfMachine.set(t.machineId, t.factoryId);
        const binding: TagBinding = {
          id: t.id,
          code: t.code,
          address: parseInt(String(t.address), 10) || 0,
          registerType: (t.registerType as RegisterType) ?? 'HOLDING',
          dataType: t.dataType as ModbusDataType,
          wordCount: t.wordCount ?? 1,
          wordOrder: (t.wordOrder as 'BIG' | 'LITTLE') ?? 'BIG',
          scaleFactor: t.scaleFactor,
          offset: t.offset,
          counterRole: t.counterRole as any,
          edgeType: (t.edgeType as EdgeType) ?? 'RISING',
        };
        return {
          binding,
          tagId: t.id,
          code: t.code,
          factoryId: t.factoryId,
          machineId: t.machineId ?? dev.machineId ?? null,
          machineCode: t.machine?.code ?? dev.machine?.code ?? null,
          isCounter: t.tagType === 'COUNTER' && !!t.counterRole && t.counterRole !== 'NONE',
          counterTag: {
            id: t.id,
            machineId: t.machineId ?? dev.machineId ?? null,
            factoryId: t.factoryId,
            counterRole: t.counterRole as any,
            edgeType: (t.edgeType as EdgeType) ?? 'RISING',
            wordCount: t.wordCount ?? null,
          },
          energyRole: t.energyRole ?? null,
          historize: (t as any).historizationEnabled !== false,
          mqttPublishMode: ((t as any).mqttPublishMode as string) ?? 'CHANGE',
          mqttPublishRateSec: ((t as any).mqttPublishRateSec as number) ?? 0,
          historizationMode: ((t as any).historizationMode as string) ?? 'CHANGE',
          historizationRateSec: ((t as any).historizationRateSec as number) ?? 60,
          deadband: ((t as any).deadband as number | null) ?? null,
          isMachineStatus: statusDrivers.has(t.id),
          statusTag: {
            tagId: t.id,
            factoryId: t.factoryId,
            machineId: t.machineId ?? dev.machineId ?? null,
            dataType: t.dataType as string,
            statusMap: ((t as any).statusMap as Record<string, string> | null) ?? null,
            // How this bit is to be READ. On an eight-input module a bit's meaning
            // cannot be inferred from its value; it has to be declared.
            signalRole: ((t as any).signalRole as string | null) ?? null,
            pulseWindowMs: ((t as any).pulseWindowMs as number | null) ?? null,
            pulseMinEdges: ((t as any).pulseMinEdges as number | null) ?? null,
          },
        };
      });

      /**
       * GOOD counters are applied before TOTAL counters, within every poll.
       *
       * ── The defect this closes ──────────────────────────────────────────
       * A TOTAL counter has no bad count of its own; `CounterService` derives
       * one as `total - good`, reading `good` from the job order. When one
       * physical unit raises both bits in the same poll — which is what the
       * hardware does — the order these two tags are visited in decides the
       * answer:
       *
       *   TOTAL first → good is still N-1, so bad = 1 is written and STANDS
       *                 until the next TOTAL edge re-derives it.
       *   GOOD first  → good is N, so bad = 0. Correct.
       *
       * The tags arrived in address order, so TOTAL (the lower address on both
       * of this plant's modules) always won. On a fast machine the phantom
       * reject is corrected 3 seconds later and nobody sees it. On the wrapper,
       * one pallet every NINE MINUTES, it stood for nine minutes — and the
       * minute-level OEE store recorded every one of those minutes. That is how
       * a line configured for 0.2% scrap reported 41%, and why the scrap looked
       * like it only ever happened at the last machine.
       *
       * A stable sort, so everything else keeps its address order and only the
       * two counter roles are pulled apart.
       */
      const COUNTER_PRIORITY: Record<string, number> = { GOOD: 0, BAD: 0, TOTAL: 1 };
      const priority = (t: (typeof tags)[number]) =>
        (t.isCounter ? COUNTER_PRIORITY[String(t.counterTag.counterRole)] ?? 0 : 0);
      tags.sort((a, b) => priority(a) - priority(b));

      const meter: MeterContext | null = dev.energyMeter
        ? {
            meterId: dev.energyMeter.id,
            factoryId: dev.factoryId,
            machineId: dev.energyMeter.machineId ?? dev.machineId ?? null,
            unit: dev.energyMeter.unit,
          }
        : null;

      const runtime: DeviceRuntime = {
        id: dev.id,
        name: dev.name,
        client,
        tags,
        meter,
        intervalMs: dev.pollIntervalMs ?? defaultInterval,
        timer: null,
        busy: false,
        outbox: [],
        draining: false,
        dropped: 0,
        signature,
      };
      // Establish the connection now, sequentially per device. Lazy-connecting
      // many clients at once on the first poll tick triggers a connect storm
      // that modbus-serial mishandles (most reads then "Timed out"). The reload
      // loop is already serial, so awaiting here connects devices one at a time.
      await runtime.client.connect().catch((err) => {
        const conn = dev.protocol === 'MODBUS_RTU'
          ? `${dev.serialPort ?? '?'} @ ${dev.baudRate ?? '?'} ${dev.parity ?? 'none'}`
          : `${dev.ipAddress ?? '?'}:${dev.port ?? 502}`;
        this.mlog.log(dev.name, 'connect', (err as Error)?.message ?? String(err), { proto: dev.protocol, conn, unitId: dev.unitId ?? 1 });
      });
      // A self-rescheduling loop, NOT setInterval.
      //
      // setInterval fires on a fixed grid and the gateway drops any tick whose
      // predecessor is still running, so the real sample period was the interval
      // ROUNDED UP to a multiple of itself: a 27 ms cycle on a 20 ms grid
      // sampled every 40 ms, not every 27. The line's own log showed both
      // numbers on 23 Aug 2026 without the two being connected.
      //
      // Waiting only the remainder AFTER each cycle instead means a device that
      // cannot meet its interval simply runs as fast as it can, and one that can
      // still keeps its configured rate.
      const loop = async () => {
        await this.pollDevice(runtime);
        if (!this.devices.has(runtime.id) || runtime.timer === null) return;
        const wait = Math.max(0, runtime.intervalMs - (runtime.lastCycleMs ?? 0));
        runtime.timer = setTimeout(() => void loop(), wait);
      };
      runtime.timer = setTimeout(() => void loop(), runtime.intervalMs);
      this.devices.set(dev.id, runtime);
      this.logger.log(`Device "${dev.name}" loaded: ${tags.length} tag(s) @ ${runtime.intervalMs}ms`);
    }

    /**
     * Counter writes, on their own clock.
     *
     * Edges are taken from every sample by CounterService.observe and land in
     * memory; this drains them to the database. One second is a compromise the
     * counts survive: a pulse is durable on disk the moment it is seen, so the
     * only thing a crash between flushes costs is a second of latency on a
     * number the job order picks up on the next drain.
     */
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        void this.counter.flush()
          .then((events) => {
            for (const ev of events) {
              // The event knows its machine, not its factory; the topic needs both.
              const factoryId = this.factoryOfMachine.get(ev.machineId);
              if (factoryId) this.mqtt.publish(`industry360/${factoryId}/jo/${ev.jobOrderId}/count`, ev);
            }
          })
          .catch((err) => this.logger.warn(`counter flush failed: ${(err as Error).message}`));
      }, 1_000);
    }

    // Drop devices no longer assigned to this gateway.
    for (const [id, d] of this.devices) {
      if (seen.has(id)) continue;
      if (d.timer) { clearTimeout(d.timer); d.timer = null; }
      await d.client.disconnect().catch(() => undefined);
      this.devices.delete(id);
    }
  }

  /** Warnings already logged, so a reload every few seconds is not a log flood. */
  private lastAudit = '';

  /**
   * Decide which tags are allowed to drive machine state, and say plainly when a
   * signal is configured in a way that cannot work.
   *
   * Three configuration faults are silent today. Each one leaves the machine
   * reading RUNNING, which is indistinguishable from a machine that IS running,
   * so the plant discovers them only by noticing that availability looks too
   * good — months later, if at all.
   */
  private auditStatusTags(
    configured: Array<{ name: string; pollIntervalMs: number | null; tagDefinitions: any[] }>,
    defaultInterval: number,
  ): Set<string> {
    const drivers = new Set<string>();
    const warnings: string[] = [];
    const perMachine = new Map<string, Array<{ id: string; code: string; role: string | null }>>();

    for (const dev of configured) {
      const sampleMs = dev.pollIntervalMs ?? defaultInterval;
      for (const t of dev.tagDefinitions) {
        const role = (t.signalRole as string | null) ?? null;

        // ── A PROCESSING signal is not a machine state ──────────────────────
        // "The wrapping table is not turning" means no product is passing, which
        // is what STARVED is inferred FROM. Letting it set the state directly
        // makes a starved machine report itself broken, and — where the machine
        // also has a RUN_MODE bit — puts two writers on one machine's state,
        // each overwriting the other on every poll.
        if (t.isMachineStatus && role === 'PROCESSING') {
          warnings.push(
            `${t.code}: PROCESSING signals cannot drive machine state — ignored as a status driver. ` +
            `It remains available to Starved/Blocked detection.`);
          continue;
        }
        if (!t.isMachineStatus) continue;
        if (!t.machineId) {
          warnings.push(`${t.code}: marked as the machine-status signal but assigned to no machine — ignored.`);
          continue;
        }

        // ── A pulse nobody can see ──────────────────────────────────────────
        // Nyquist: a square wave is only resolvable when its half-period exceeds
        // the sample interval, and dependably so at twice it. A lamp flashing at
        // 1 Hz has a 500 ms half-period and needs sampling at 250 ms or faster.
        // Below that the bit reads as a steady level — high half the time — and
        // the machine reports RUNNING however the pulse window is configured.
        if (role === 'RUN_MODE_PULSED') {
          const resolvableHz = Math.round(1000 / (4 * sampleMs) * 10) / 10;
          if (resolvableHz < 1) {
            warnings.push(
              `${t.code}: sampled every ${sampleMs} ms on "${dev.name}", which can only resolve a flash ` +
              `up to ${resolvableHz} Hz. A tower lamp flashes at about 1 Hz and will read as steady. ` +
              `Set the device poll interval to 250 ms or faster.`);
          }
          const windowMs = (t.pulseWindowMs as number | null) ?? 6000;
          const minEdges = (t.pulseMinEdges as number | null) ?? 4;
          if (windowMs < minEdges * sampleMs * 2) {
            warnings.push(
              `${t.code}: a ${windowMs} ms window cannot hold ${minEdges} edges at a ${sampleMs} ms sample rate.`);
          }
        }

        const list = perMachine.get(t.machineId) ?? [];
        list.push({ id: t.id, code: t.code, role });
        perMachine.set(t.machineId, list);
      }
    }

    // ── One machine, one state signal ─────────────────────────────────────────
    // Two status tags on a machine do not average out: each writes the state on
    // every poll, so the machine flips between them and the downtime log fills
    // with alternating events. Rather than let that continue, one is chosen
    // deterministically — a run-mode bit over anything else, then by code — and
    // the conflict is reported instead of being silently resolved differently on
    // each restart.
    for (const [machineId, list] of perMachine) {
      const ordered = [...list].sort((a, b) => {
        const rank = (r: string | null) => (r === 'RUN_MODE' || r === 'RUN_MODE_PULSED' ? 0 : 1);
        return rank(a.role) - rank(b.role) || a.code.localeCompare(b.code);
      });
      drivers.add(ordered[0].id);
      if (ordered.length > 1) {
        warnings.push(
          `machine ${machineId}: ${ordered.length} tags claim to drive its state ` +
          `(${ordered.map((o) => o.code).join(', ')}). Using ${ordered[0].code}; the rest are ignored.`);
      }
    }

    const digest = warnings.join('|');
    if (digest !== this.lastAudit) {
      for (const w of warnings) this.logger.warn(`signal config — ${w}`);
      this.lastAudit = digest;
    }
    return drivers;
  }

  private async pollDevice(dev: DeviceRuntime) {
    if (dev.busy) {
      // With the loop rescheduling itself after each cycle this should not be
      // reachable; it stays as a re-entrancy guard for the config reload, which
      // can start a second loop for the same device while one is mid-cycle.
      return;
    }
    dev.busy = true;
    const cycleStart = Date.now();
    let anyError = false;
    const energyRoleValues = new Map<string, number>();
    /**
     * Everything that can wait, deferred to the device outbox.
     *
     * These were once awaited one tag at a time, then gathered and awaited
     * together — which turned a sum of latencies into the longest one but still
     * left the whole WAN round-trip standing between two Modbus samples. They
     * are now queued and not awaited at all: see {@link DeviceRuntime.outbox}.
     */
    const work: Array<() => Promise<unknown>> = [];
    let lastTs = new Date().toISOString();
    try {
      // One coalesced set of block reads per cycle instead of a round-trip per
      // tag — the key to fast counter polling and light meter reads.
      const readStart = Date.now();
      const results = await dev.client.readTagsBlocked(dev.tags.map((t) => t.binding));
      dev.lastReadMs = Date.now() - readStart;
      for (const tag of dev.tags) {
        const res = results.get(tag.tagId);
        if (!res) continue;
        const ts = res.timestamp.toISOString();
        lastTs = ts;

        if (res.quality !== 'GOOD') {
          anyError = true;
          this.mlog.log(dev.name, 'read', res.error ?? 'read failed', {
            tag: tag.code, address: tag.binding.address, register: tag.binding.registerType, quality: res.quality,
          });
          continue;
        }

        const numeric =
          typeof res.value === 'number' ? res.value
          : typeof res.value === 'boolean' ? (res.value ? 1 : 0)
          : null;

        // ── Counting comes first, on EVERY sample ───────────────────────────
        // A pulse at this line's rate opens and closes in a few tens of
        // milliseconds. The edge has to be taken from this sample, before any
        // decision about reporting and before anything that can await. The
        // write happens on the flush timer; see CounterService.observe.
        if (tag.isCounter) this.counter.observe(tag.counterTag, res.raw, ts);
        if (tag.energyRole && numeric !== null) energyRoleValues.set(tag.energyRole, numeric);

        // ── Reporting is a slower, separate question ────────────────────────
        // See {@link shouldDispatch}. The wire is read tens of times a second so
        // an edge cannot hide between two looks; a value that has not moved does
        // not need telling to a server across the plant's link at that rate.
        if (!this.shouldDispatch(tag.tagId, numeric, cycleStart)) continue;

        const record: TagReadingRecord = {
          tagId: tag.tagId,
          factoryId: tag.factoryId,
          code: tag.code,
          machineId: tag.machineId,
          machineCode: tag.machineCode,
          deviceId: dev.id,
          value: String(res.value ?? ''),
          numeric,
          quality: res.quality,
          timestamp: ts,
          historize: tag.historize,
          mqttPublishMode: tag.mqttPublishMode,
          mqttPublishRateSec: tag.mqttPublishRateSec,
          historizationMode: tag.historizationMode,
          historizationRateSec: tag.historizationRateSec,
          deadband: tag.deadband,
        };
        work.push(() => this.ingest.ingest(record));

        // Machine-status driver tag → derive and apply the live machine state,
        // which is what opens and closes downtime events. Counting is NOT gated
        // on it: a pulse that arrives is a unit that was made, and discarding it
        // because the state signal disagreed would lose real production.
        if (tag.isMachineStatus) {
          work.push(() => this.statusSvc.process(tag.statusTag, numeric, ts));
        }

        // Configured alarms on this tag. Runs on every GOOD reading, not only on
        // status tags — a threshold on a temperature or a meter is the ordinary case.
        work.push(() => this.alarms.evaluate(tag.tagId, tag.machineId, numeric, ts));
      }

      // Hand the deferred work to the outbox and return to the wire. Nothing
      // here is awaited: the next Modbus sample must not wait on a server.
      if (work.length) this.enqueue(dev, work);

      // Energy meter → write an EnergyReading (throttled) + publish for API
      // enrichment. Also a server round-trip, so it too leaves the read path.
      if (dev.meter && energyRoleValues.size) {
        const meter = dev.meter;
        const roles = new Map(energyRoleValues);
        const at = lastTs;
        this.enqueue(dev, [async () => {
          const ev = await this.energy.process(meter, roles, at);
          if (ev) this.mqtt.publish(`industry360/${meter.factoryId}/energy/${ev.meterId}`, ev);
        }]);
      }

      const took = Date.now() - cycleStart;
      dev.lastCycleMs = took;
      dev.cycles = (dev.cycles ?? 0) + 1;
      if (took > dev.intervalMs) {
        const now = Date.now();
        const since = dev.cyclesSince ?? now;
        // What the device is ACTUALLY sampled at. This is the number that
        // decides whether a pulse is visible; the configured interval is only a
        // request, and on a device whose wire is slower it is never granted.
        const achieved = dev.cycles && now > since
          ? Math.round((now - since) / dev.cycles)
          : took;

        // Say it when it MEANS something. A device whose round-trip exceeds its
        // interval is not a fault to re-report every minute for the life of the
        // plant — it is a fixed property of that wire, and a line repeated 1,400
        // times a day is one nobody reads. So: the first time, and thereafter
        // only when the achieved rate has actually moved.
        const drifted = dev.reportedRate === undefined
          || Math.abs(achieved - dev.reportedRate) > Math.max(5, dev.reportedRate * 0.25);
        if (drifted && (!dev.slowLoggedAt || now - dev.slowLoggedAt > 60_000)) {
          dev.slowLoggedAt = now;
          dev.reportedRate = achieved;
          const readMs = dev.lastReadMs ?? 0;
          // What the device is ACTUALLY sampled at, averaged over the reporting
          const rate = ` — sampling every ${achieved}ms on average`;
          // Two very different situations produce an overrun, and telling them
          // apart is the whole value of this line. If the Modbus round-trip
          // alone exceeds the interval, the wire is the limit and the interval
          // is simply set below what this device can do — the gateway is
          // already sampling as fast as it can. If the round-trip is quick and
          // the cycle is not, something after the read is holding the loop, and
          // that is a defect.
          // What the interval SHOULD be, from what the wire actually does.
          const suggest = suggestedIntervalMs(achieved);
          this.logger.warn(
            readMs >= dev.intervalMs
              ? `${dev.name}: sampling at its limit — the Modbus round-trip alone takes ${readMs}ms, `
                + `so its ${dev.intervalMs}ms interval cannot be met${rate}. `
                + 'Effective sample rate is the round-trip, not the interval. '
                + `Set the interval to about ${suggest}ms so it describes what this device can do; `
                + 'a lower number does not sample faster, it only hides the ceiling.'
              : `${dev.name}: poll cycle ${took}ms exceeds its ${dev.intervalMs}ms interval `
                + `while the Modbus read took only ${readMs}ms${rate}. `
                + 'Something after the read is holding the loop; counter pulses '
                + 'shorter than the overrun are being missed.',
          );
        }
        if (now - since >= 60_000) {
          dev.cyclesSince = now;
          dev.cycles = 0;
        }
      }
      this.enqueue(dev, [() => this.markDevice(dev.id, anyError ? 'ERROR' : 'CONNECTED', anyError ? 'One or more tag reads failed' : null)]);
    } catch (err) {
      this.mlog.log(dev.name, 'poll', (err as Error)?.message ?? String(err));
      this.enqueue(dev, [() => this.markDevice(dev.id, 'ERROR', (err as Error).message)]);
    } finally {
      dev.busy = false;
    }
  }

  /**
   * The value each tag was last reported to the server with, and when.
   *
   * Sampling and reporting are two different rates and used to be one. Counting
   * needs the wire read many times a second — that is what makes a short pulse
   * visible. Nothing downstream needs the same reading repeated at that rate:
   * the current-value row, the historian, MQTT and the alarm evaluator all care
   * about what the value IS and when it CHANGES.
   *
   * Conflating them queued roughly 550 jobs a second for six tags, far more
   * than the plant's link could carry, and the overflow was discarded —
   * 177,723 of them in nine minutes on 23 Aug 2026. Reporting on change, with a
   * heartbeat so a steady value still refreshes and time-based rules still run,
   * cuts that by well over an order of magnitude and drops nothing.
   *
   * No transition is lost: this is consulted on EVERY sample, so any value the
   * gateway can see at all is reported the moment it appears. What it removes
   * is repetition, not information.
   */
  private readonly dispatched = new Map<string, { value: number | null; at: number }>();
  private static readonly DISPATCH_HEARTBEAT_MS = 1_000;

  private shouldDispatch(tagId: string, numeric: number | null, now: number): boolean {
    const last = this.dispatched.get(tagId);
    if (last && last.value === numeric && now - last.at < ModbusPollerService.DISPATCH_HEARTBEAT_MS) {
      return false;
    }
    this.dispatched.set(tagId, { value: numeric, at: now });
    return true;
  }

  /**
   * The read path's only exit for work that needs the network.
   *
   * `dropped` exists because the alternative to discarding is unbounded growth:
   * if the plant's link stalls for an hour at 10 samples a second, an unbounded
   * queue ends the process. The oldest go first — for the bulk of this traffic
   * (current values, live telemetry) that is also the correct choice, since a
   * newer reading supersedes an older one. Counts are NOT in here: they are
   * accumulated in memory by CounterService and persisted on its own flush, so
   * a backlog costs freshness, never a unit of production.
   */
  private static readonly MAX_OUTBOX = 2_000;
  private static readonly DRAIN_BATCH = 25;

  private enqueue(dev: DeviceRuntime, jobs: Array<() => Promise<unknown>>) {
    for (const job of jobs) {
      if (dev.outbox.length >= ModbusPollerService.MAX_OUTBOX) {
        dev.outbox.shift();
        dev.dropped += 1;
      }
      dev.outbox.push(job);
    }
    if (!dev.draining) void this.drainOutbox(dev);
  }

  private async drainOutbox(dev: DeviceRuntime) {
    dev.draining = true;
    try {
      while (dev.outbox.length) {
        const batch = dev.outbox.splice(0, ModbusPollerService.DRAIN_BATCH);
        // `allSettled`: one failing alarm evaluation must not discard the
        // readings queued beside it. Each sink buffers its own failures to disk.
        await Promise.allSettled(batch.map((job) => job()));
      }
    } catch (err) {
      this.logger.error(`${dev.name}: outbox drain failed`, err as Error);
    } finally {
      dev.draining = false;
      if (dev.dropped) {
        const now = Date.now();
        if (!dev.dropLoggedAt || now - dev.dropLoggedAt > 60_000) {
          dev.dropLoggedAt = now;
          this.logger.warn(
            `${dev.name}: ${dev.dropped} queued write(s) discarded — the link to the `
            + 'server is slower than this device is polled. Counts are unaffected.',
          );
          dev.dropped = 0;
        }
      }
    }
  }

  /** Instantiate a meter's ENERGY tags from its template (idempotent). */
  private async provisionMeterTags(
    deviceId: string, meterId: string, factoryId: string, machineId: string | null, meterNumber: string, templateKey: string,
  ) {
    try {
      const specs = instantiateMeterTags(templateKey, meterNumber);
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
      }
      this.logger.log(`Provisioned ${specs.length} tag(s) for meter ${meterNumber} (${templateKey})`);
    } catch (err) {
      this.logger.error(`Meter tag provisioning failed (${meterNumber})`, err as Error);
    }
  }

  /**
   * Record a device's health — on CHANGE, or once a minute.
   *
   * This ran at the end of every poll cycle: at a 100 ms interval that is ten
   * row updates a second per device, awaited inside the cycle, for a column
   * nobody reads ten times a second. A status CHANGE still writes immediately,
   * because that is the part anyone is watching for; a heartbeat that has not
   * changed can wait a minute.
   */
  private readonly deviceHealth = new Map<string, { status: string; at: number }>();
  private static readonly HEALTH_HEARTBEAT_MS = 60_000;

  private async markDevice(id: string, status: string, lastError: string | null) {
    const last = this.deviceHealth.get(id);
    const changed = !last || last.status !== status;
    if (!changed && Date.now() - last.at < ModbusPollerService.HEALTH_HEARTBEAT_MS) return;
    this.deviceHealth.set(id, { status, at: Date.now() });
    await this.prisma.device
      .update({ where: { id }, data: { status, lastSeenAt: new Date(), lastError } })
      .catch(() => undefined);
  }

  /**
   * Drain disk buffers when the sinks recover.
   *
   * Every three seconds, not twenty. A buffer only fills when a sink refuses,
   * and the longer the gap between attempts the further behind it falls — at
   * twenty seconds a gateway that briefly lost Postgres kept accumulating for
   * nineteen of every twenty seconds it was already healthy again.
   */
  @Interval('buffer-drain', 3_000)
  async drain() {
    await this.ingest.drainBuffers().catch(() => undefined);
  }

  /** Snapshot for the local dashboard. */
  status() {
    return Array.from(this.devices.values()).map((d) => ({
      id: d.id,
      name: d.name,
      connected: d.client.isConnected(),
      tagCount: d.tags.length,
      intervalMs: d.intervalMs,
    }));
  }
}
