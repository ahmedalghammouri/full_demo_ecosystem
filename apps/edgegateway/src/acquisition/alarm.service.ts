import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Alarm evaluation — turns a configured AlarmDefinition into real AlarmEvents.
 *
 * The definitions were configurable long before anything read them: a customer
 * could fill in condition, threshold, deadband and delay, save it, and nothing
 * would ever happen. This is the missing consumer.
 *
 * ── Where it runs ───────────────────────────────────────────────────────────
 * At the edge, on every reading, for the same reason counting runs here: a
 * threshold crossing that only exists between two API polls is a threshold
 * crossing that never gets seen. It also means alarms keep firing while the
 * link to the API is down.
 *
 * ── Three guards against a useless alarm log ────────────────────────────────
 * A bare `value > threshold` produces hundreds of events from one noisy sensor
 * hovering at its limit. Three configured mechanisms prevent that, and each is
 * a plant decision rather than a constant:
 *
 *   delaySeconds  the condition must hold CONTINUOUSLY this long before an event
 *                 is raised. A momentary spike is not a fault.
 *   deadband      once raised, the value must come back PAST the threshold by
 *                 this much before the alarm clears. Hysteresis — without it a
 *                 value sitting exactly on the limit chatters on and off.
 *   isActive      an alarm can be switched off without being deleted, so its
 *                 history survives.
 *
 * ── One open event per definition ───────────────────────────────────────────
 * A definition that is breaching has exactly one unresolved AlarmEvent. It is
 * resolved — with a duration — when the value recovers. State is held in memory
 * for speed, but the open event is recovered from the database on first use, so
 * a gateway restart mid-alarm does not orphan the event or duplicate it.
 *
 * Deliberately conservative: an unreadable value, a BAD-quality reading, or a
 * definition with no threshold raises nothing. A missed alarm is recoverable
 * from the historian; a log full of false ones is not worth reading at all.
 */

interface AlarmDef {
  id: string;
  factoryId: string;
  code: string;
  name: string;
  severity: string;
  category: string;
  condition: string | null;
  threshold: number | null;
  deadband: number | null;
  delaySeconds: number;
  autoAck: boolean;
}

interface AlarmState {
  /** When the condition first became true, or null while it is false. */
  breachingSince: number | null;
  /** Id of the unresolved AlarmEvent, or null when not currently raised. */
  openEventId: string | null;
  /** Whether the open event has been recovered from the database yet. */
  recovered: boolean;
}

@Injectable()
export class AlarmService {
  private readonly logger = new Logger(AlarmService.name);

  /** Definitions per tag, cached — alarm configuration changes rarely. */
  private defsCache = new Map<string, { at: number; defs: AlarmDef[] }>();
  private static readonly DEFS_TTL_MS = 30_000;

  /** Live evaluation state, keyed by definition id. */
  private state = new Map<string, AlarmState>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluate every alarm bound to this tag against a new reading.
   *
   * `numeric` null means the value could not be read as a number — nothing is
   * evaluated, because a comparison against an unknown is not a fault.
   */
  async evaluate(
    tagId: string,
    machineId: string | null,
    numeric: number | null,
    at: string,
  ): Promise<void> {
    if (numeric === null || !Number.isFinite(numeric)) return;

    let defs: AlarmDef[];
    try {
      defs = await this.definitionsFor(tagId);
    } catch (err) {
      this.logger.warn(`alarm definitions unavailable for tag ${tagId}: ${(err as Error).message}`);
      return;
    }
    if (defs.length === 0) return;

    const now = new Date(at).getTime();
    for (const def of defs) {
      try {
        await this.evaluateOne(def, machineId, numeric, now, at);
      } catch (err) {
        // One bad definition must not stop the others, nor the poll cycle.
        this.logger.warn(`alarm ${def.code} evaluation failed: ${(err as Error).message}`);
      }
    }
  }

  private async evaluateOne(
    def: AlarmDef,
    machineId: string | null,
    value: number,
    now: number,
    at: string,
  ): Promise<void> {
    const st = this.stateFor(def.id);
    await this.recoverOpenEvent(def, st);

    const raised = st.openEventId !== null;
    // While raised, the deadband widens the clearing threshold. While clear, the
    // plain threshold applies — so the alarm is easy to trip and harder to clear,
    // which is the correct asymmetry for something meant to be noticed.
    const breaching = raised
      ? this.stillBreaching(def, value)
      : this.conditionMet(def.condition, value, def.threshold);

    if (breaching) {
      if (st.breachingSince === null) st.breachingSince = now;
      // Not raised yet, and the condition has held long enough to be believed.
      if (!raised && now - st.breachingSince >= def.delaySeconds * 1000) {
        st.openEventId = await this.raise(def, machineId, value, at);
      }
      return;
    }

    // Condition false. Clear the timer either way; resolve if something is open.
    st.breachingSince = null;
    if (raised) {
      await this.resolve(st.openEventId!, at);
      st.openEventId = null;
    }
  }

  /** Has the value returned past the threshold by more than the deadband? */
  private stillBreaching(def: AlarmDef, value: number): boolean {
    const threshold = def.threshold;
    if (threshold === null) return false;
    const band = Math.abs(def.deadband ?? 0);
    if (band === 0) return this.conditionMet(def.condition, value, threshold);

    switch ((def.condition ?? 'GT').toUpperCase()) {
      // Tripped going up, so it clears only once it falls BELOW threshold-band.
      case 'GT':
      case 'GTE':
        return value > threshold - band;
      // Tripped going down, so it clears only once it rises ABOVE threshold+band.
      case 'LT':
      case 'LTE':
        return value < threshold + band;
      // Equality has no direction: the deadband is a tolerance around the value.
      case 'EQ':
        return Math.abs(value - threshold) <= band;
      case 'NEQ':
        return Math.abs(value - threshold) > band;
      default:
        return this.conditionMet(def.condition, value, threshold);
    }
  }

  private conditionMet(condition: string | null, value: number, threshold: number | null): boolean {
    // A definition with no threshold cannot be evaluated. Raising on it would be
    // inventing a fault out of a half-filled form.
    if (threshold === null || threshold === undefined) return false;
    switch ((condition ?? 'GT').toUpperCase()) {
      case 'GT': return value > threshold;
      case 'GTE': return value >= threshold;
      case 'LT': return value < threshold;
      case 'LTE': return value <= threshold;
      case 'EQ': return value === threshold;
      case 'NEQ': return value !== threshold;
      default: return false;
    }
  }

  private async raise(
    def: AlarmDef,
    machineId: string | null,
    value: number,
    at: string,
  ): Promise<string> {
    const triggeredAt = new Date(at);
    const event = await this.prisma.alarmEvent.create({
      data: {
        factoryId: def.factoryId,
        alarmDefinitionId: def.id,
        machineId,
        code: def.code,
        description: def.name,
        severity: def.severity as never,
        category: def.category,
        value,
        threshold: def.threshold,
        triggeredAt,
        // autoAck means nobody is expected to acknowledge this one — it is
        // informational. Stamping it at raise keeps it out of the operator's
        // outstanding queue without inventing a fake acknowledging user.
        acknowledgedAt: def.autoAck ? triggeredAt : null,
      },
      select: { id: true },
    });
    this.logger.log(`ALARM ${def.code} raised — ${value} vs ${def.threshold} (${def.condition ?? 'GT'})`);
    return event.id;
  }

  private async resolve(eventId: string, at: string): Promise<void> {
    const event = await this.prisma.alarmEvent.findUnique({
      where: { id: eventId },
      select: { triggeredAt: true, resolvedAt: true },
    });
    if (!event || event.resolvedAt) return; // already closed by an operator

    const resolvedAt = new Date(at);
    await this.prisma.alarmEvent.update({
      where: { id: eventId },
      data: {
        resolvedAt,
        durationMinutes: (resolvedAt.getTime() - event.triggeredAt.getTime()) / 60_000,
      },
    });
  }

  /**
   * Adopt an event left open by a previous gateway run.
   *
   * Without this a restart mid-alarm would raise a second event for a condition
   * that never went away, and leave the first one open for ever.
   */
  private async recoverOpenEvent(def: AlarmDef, st: AlarmState): Promise<void> {
    if (st.recovered) return;
    st.recovered = true;
    const open = await this.prisma.alarmEvent.findFirst({
      where: { alarmDefinitionId: def.id, resolvedAt: null },
      orderBy: { triggeredAt: 'desc' },
      select: { id: true },
    });
    if (open) st.openEventId = open.id;
  }

  private stateFor(defId: string): AlarmState {
    let st = this.state.get(defId);
    if (!st) {
      st = { breachingSince: null, openEventId: null, recovered: false };
      this.state.set(defId, st);
    }
    return st;
  }

  private async definitionsFor(tagId: string): Promise<AlarmDef[]> {
    const cached = this.defsCache.get(tagId);
    if (cached && Date.now() - cached.at < AlarmService.DEFS_TTL_MS) return cached.defs;

    const rows = await this.prisma.alarmDefinition.findMany({
      where: { tagId, isActive: true },
      select: {
        id: true, factoryId: true, code: true, name: true, severity: true,
        category: true, condition: true, threshold: true, deadband: true,
        delaySeconds: true, autoAck: true,
      },
    });
    const defs: AlarmDef[] = rows.map((r) => ({
      ...r,
      severity: String(r.severity),
      threshold: r.threshold ?? null,
      deadband: r.deadband ?? null,
    }));
    this.defsCache.set(tagId, { at: Date.now(), defs });
    return defs;
  }
}
