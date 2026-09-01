import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface MeterContext {
  meterId: string;
  factoryId: string;
  machineId: string | null;
  unit: string;
}

export interface EnergyEvent {
  readingId: string;
  meterId: string;
  machineId: string | null;
  value: number;
  powerKw: number | null;
  ts: string;
}

/**
 * Turns a meter's per-poll tag readings into `EnergyReading` rows (the energy
 * analog of CounterService). Uses the `ENERGY_IMPORT_TOTAL` tag for cumulative
 * energy (`value`) and `ACTIVE_POWER_TOTAL` for instantaneous `powerKw`.
 * Writes are throttled per meter so we don't flood the table — the rich
 * per-phase metrics are already historized to InfluxDB every poll by IngestService.
 */
@Injectable()
export class EnergyReadingService {
  private readonly logger = new Logger(EnergyReadingService.name);
  private readonly lastWrite = new Map<string, number>();
  private readonly minIntervalMs = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param roleValues map of energyRole → scaled numeric value for this poll
   * @returns an EnergyEvent when a reading was written (for MQTT publish), else null
   */
  async process(meter: MeterContext, roleValues: Map<string, number>, ts: string, now = Date.now()): Promise<EnergyEvent | null> {
    const energy = roleValues.get('ENERGY_IMPORT_TOTAL');
    const power = roleValues.get('ACTIVE_POWER_TOTAL');
    if (energy === undefined && power === undefined) return null; // not an energy-bearing meter poll

    const last = this.lastWrite.get(meter.meterId) ?? 0;
    if (now - last < this.minIntervalMs) return null; // throttle
    this.lastWrite.set(meter.meterId, now);

    try {
      const reading = await this.prisma.energyReading.create({
        data: {
          meterId: meter.meterId,
          factoryId: meter.factoryId,
          machineId: meter.machineId,
          timestamp: new Date(ts),
          value: energy ?? 0,
          ...(power !== undefined ? { powerKw: power } : {}),
          unit: meter.unit || 'kWh',
          source: 'AUTO',
          quality: 'GOOD',
        } as any,
      });
      return { readingId: reading.id, meterId: meter.meterId, machineId: meter.machineId, value: energy ?? 0, powerKw: power ?? null, ts };
    } catch (err) {
      this.logger.error(`EnergyReading write failed (meter ${meter.meterId})`, err as Error);
      return null;
    }
  }
}
