import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StateInferenceService } from './state-inference.service';

/** Standard 0-based INT → MachineState map (used when a status tag has no explicit statusMap). */
const DEFAULT_STATUS_MAP: Record<string, string> = {
  '0': 'IDLE',
  '1': 'RUNNING',
  '2': 'BREAKDOWN',
  '3': 'PLANNED_STOP',
  '4': 'SETUP',
  '5': 'CHANGEOVER',
  '6': 'STARVED',
  '7': 'BLOCKED',
  '8': 'OFFLINE',
  '9': 'MAINTENANCE',
  // Appended, never inserted. These codes are what a PLC actually writes into
  // the status word, so renumbering one to keep the list tidy would silently
  // re-label every historical reading that used it.
  '10': 'STARTUP',
};

/**
 * What each state means — the FALLBACK only.
 *
 * The live values come from `machine_state_rules`, which the plant edits in the
 * app. This table is what a factory with no rules configured behaves like, so a
 * fresh install still records downtime correctly instead of silently recording
 * none. It is deliberately identical to the rules the seed writes.
 */
interface StateRule {
  isDowntime: boolean;
  isPlanned: boolean;
  affectsOEE: boolean;
  reasonCode: string | null;
  category: string;
  debounceSeconds: number;
}

/**
 * Marks a downtime event as opened by this service, and records which state it
 * was filed under. Also the boundary of what this service may edit: an event
 * without this prefix was raised or reclassified by a person, and their record
 * is never rewritten by a signal.
 */
const AUTO_REASON_PREFIX = 'Auto (status signal): ';

const FALLBACK_RULES: Record<string, StateRule> = {
  RUNNING:      { isDowntime: false, isPlanned: false, affectsOEE: true,  reasonCode: null, category: 'OTHER', debounceSeconds: 0 },
  IDLE:         { isDowntime: false, isPlanned: false, affectsOEE: true,  reasonCode: null, category: 'OTHER', debounceSeconds: 0 },
  BREAKDOWN:    { isDowntime: true,  isPlanned: false, affectsOEE: true,  reasonCode: 'UNPLANNED_BREAKDOWN', category: 'MECHANICAL', debounceSeconds: 0 },
  PLANNED_STOP: { isDowntime: true,  isPlanned: true,  affectsOEE: false, reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_BREAK', debounceSeconds: 0 },
  MAINTENANCE:  { isDowntime: true,  isPlanned: true,  affectsOEE: false, reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_MAINTENANCE', debounceSeconds: 0 },
  SETUP:        { isDowntime: true,  isPlanned: true,  affectsOEE: true,  reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', debounceSeconds: 0 },
  CHANGEOVER:   { isDowntime: true,  isPlanned: true,  affectsOEE: true,  reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', debounceSeconds: 0 },
  // Intended (isPlanned) and still charged (affectsOEE) — start-up loss is one
  // of the six big losses. Matches the API's rule exactly; the classifier reads
  // affectsOEE now, so the two disagreeing would move the reading.
  STARTUP:      { isDowntime: true,  isPlanned: true,  affectsOEE: true,  reasonCode: 'CHANGEOVER', category: 'STARTUP', debounceSeconds: 0 },
  STARVED:      { isDowntime: true,  isPlanned: false, affectsOEE: false, reasonCode: 'STARVED', category: 'MATERIAL', debounceSeconds: 0 },
  BLOCKED:      { isDowntime: true,  isPlanned: false, affectsOEE: false, reasonCode: 'BLOCKED', category: 'PROCESS', debounceSeconds: 0 },
  OFFLINE:      { isDowntime: true,  isPlanned: false, affectsOEE: false, reasonCode: 'EXTERNAL', category: 'EXTERNAL', debounceSeconds: 0 },
};

/** Anything not listed is treated as an unexplained stop rather than ignored. */
const UNKNOWN_STATE_RULE: StateRule = {
  isDowntime: true, isPlanned: false, affectsOEE: true,
  reasonCode: 'UNPLANNED_BREAKDOWN', category: 'OTHER', debounceSeconds: 0,
};

export interface StatusTag {
  tagId: string;
  factoryId: string;
  machineId: string | null;
  dataType: string; // BOOL | INT | ...
  statusMap: Record<string, string> | null;
  /** RUN_MODE | RUN_MODE_PULSED | PROCESSING | … — see TagDefinition.signalRole. */
  signalRole?: string | null;
  /**
   * Per-SIGNAL pulse timing, configured in the app rather than per deployment.
   * A wrapper table and a robot arm do not share a sensible pulse window, and an
   * environment variable forces one number on every machine in the plant.
   */
  pulseWindowMs?: number | null;
  pulseMinEdges?: number | null;
}

/**
 * Pulse detection for signals that carry three states on one bit.
 *
 * I360's Euro-Pack Robot reports: steady ON = running, PULSING = stop mode,
 * OFF = alarm or emergency stop. Reading the level alone cannot tell running from
 * stopped, because a pulsing signal is ON half the time — sampling it would
 * report the machine as alternately running and broken every second.
 *
 * So the bit is judged by how often it CHANGES, not by what it reads. Transitions
 * are kept for a short window; enough of them means the signal is oscillating
 * rather than resting.
 */
const PULSE_WINDOW_DEFAULT_MS = 6_000;
/** Two full cycles inside the window — one edge could be an ordinary start/stop. */
const PULSE_MIN_EDGES_DEFAULT = 4;

/** How many sample intervals to average when reporting the observed poll rate. */
const SAMPLE_GAPS_KEPT = 50;

interface PulseState {
  last: boolean;
  at: number[];
  samples: number;
  lastSampleAt: number;
  gaps: number[];
  windowMs: number;
  minEdges: number;
  machineId: string | null;
  sawEdgeOnce?: boolean;
}

/** One pulsed signal as the detector currently sees it — see pulseDiagnostics(). */
export interface PulseDiagnostic {
  tagId: string;
  machineId: string | null;
  pulsing: boolean;
  edgesInWindow: number;
  minEdges: number;
  windowMs: number;
  /** The level of the last sample. On its own this is what misleads: a pulsing
   *  signal reads high half the time, so a single look says "running". */
  level: boolean;
  samples: number;
  /** Measured, not configured. null until two samples have arrived. */
  observedSampleMs: number | null;
  /** The fastest flash this sample rate can be trusted to resolve. */
  fastestResolvableFlashHz: number | null;
  lastSampleAgoMs: number | null;
  lastEdgeAgoMs: number | null;
  everSawAnEdge: boolean;
}

/**
 * Drives a machine's live state from its designated status tag:
 *   • BOOL → true = RUNNING; false = BREAKDOWN (unplanned stop) when a JO is in
 *     progress, otherwise IDLE.
 *   • INT  → mapped via the tag's statusMap (else the standard 0-based default).
 * Updates MachineCurrentStatus and opens/closes the matching DowntimeEvent so the
 * downtime + OEE engine sees the stop. Returns the derived state (for counter gating).
 */
@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inference: StateInferenceService,
  ) {}

  async process(tag: StatusTag, numeric: number | null, ts: string): Promise<string | null> {
    if (!tag.machineId || numeric === null) return null;
    const state = await this.derive(tag, numeric);
    if (!state) return null;
    const machineId = tag.machineId;
    try {
      await this.serialized(machineId, () => this.apply(tag.factoryId, machineId, state, new Date(ts)));
    } catch (err) {
      this.logger.error(`status apply failed for machine ${machineId}`, err as Error);
    }
    return state;
  }

  /**
   * One state transition for a machine at a time, however many callers ask.
   *
   * `apply()` reads the machine's current state and its open history record,
   * then writes both — several `await`s apart. The outbox this gateway drains
   * batches deferred work and runs a whole batch with `Promise.allSettled`,
   * DELIBERATELY concurrent: most of what it carries — an ingest write, an
   * alarm check — is independent per tag and gains nothing from waiting in
   * line.
   *
   * A machine's own state transitions are not independent of each other. Two
   * `apply()` calls for the SAME machine, close enough together to land in one
   * batch, interleave: both read "no open record matches this state" before
   * either has written, so both close — or fail to find — the same row and
   * both create a new one. Closing only ever finds the LATEST open record, so
   * every earlier duplicate is orphaned open forever, accumulating minutes
   * nobody is measuring. Fourteen such records were found open on one machine
   * across a single shift — all but the last still reading RUNNING three hours
   * after the machine had gone IDLE, which is what made "Where the time went"
   * show a stopped machine as running.
   *
   * So StatusService enforces its own invariant rather than trusting every
   * caller never to race it: transitions for one machine queue behind each
   * other here, in arrival order, while different machines still run fully in
   * parallel — this costs nothing in throughput and closes the race at its
   * root rather than at whichever caller happened to expose it.
   */
  private readonly machineQueue = new Map<string, Promise<unknown>>();

  private serialized<T>(machineId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.machineQueue.get(machineId) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(fn);
    this.machineQueue.set(machineId, run.catch(() => undefined));
    return run;
  }

  /** Recent transitions per tag, for signals whose meaning is in their rhythm. */
  private readonly edges = new Map<string, PulseState>();

  /**
   * This gateway's copy of `machineCurrentStatus.state` per machine.
   *
   * Reading that row from the server before every write put a WAN round-trip
   * between two Modbus samples — at a 100 ms poll, ten a second per machine,
   * and the delay a fast counter pulse was being lost inside.
   *
   * It is a cache and NOT a source of truth, because this process is not the
   * only writer: maintenance, downtime and the IoT ingest in the API all write
   * the same column. So it expires. Within the TTL the gateway trusts what it
   * last wrote; after it, it asks the server again and sees any foreign change.
   * The cost of the window is that a state set elsewhere may stand a few
   * seconds longer before the signal re-asserts over it — the cost of removing
   * it is the pulses. The gateway's own writes refresh the entry immediately,
   * so a machine whose state is changing is never reading stale.
   */
  private readonly appliedState = new Map<string, { state: string | null; at: number }>();
  private static readonly APPLIED_TTL_MS = 5_000;

  /** Configured rules, cached briefly so a poll loop is not a query storm. */
  private ruleCache = new Map<string, { at: number; rule: StateRule }>();
  private static readonly RULE_TTL_MS = 30_000;

  /**
   * The rule governing a state, most specific first:
   *   1. a rule for THIS machine — one awkward machine treated differently
   *   2. the factory-wide rule
   *   3. the built-in fallback
   *
   * Cached for 30 s: long enough that polling does not hammer the database,
   * short enough that an edit made in the app takes effect while the engineer who
   * made it is still watching the screen.
   */
  private async ruleFor(factoryId: string, machineId: string, state: string): Promise<StateRule> {
    const key = `${machineId}:${state}`;
    const hit = this.ruleCache.get(key);
    if (hit && Date.now() - hit.at < StatusService.RULE_TTL_MS) return hit.rule;

    let rule = FALLBACK_RULES[state] ?? UNKNOWN_STATE_RULE;
    try {
      const rows = await this.prisma.machineStateRule.findMany({
        where: { factoryId, state, isActive: true, OR: [{ machineId }, { machineId: null }] },
        select: {
          machineId: true, isDowntime: true, isPlanned: true, affectsOEE: true,
          reasonCode: true, category: true, debounceSeconds: true,
        },
      });
      const chosen = rows.find((r) => r.machineId === machineId) ?? rows.find((r) => r.machineId === null);
      if (chosen) {
        rule = {
          isDowntime: chosen.isDowntime,
          isPlanned: chosen.isPlanned,
          affectsOEE: chosen.affectsOEE,
          reasonCode: chosen.reasonCode,
          category: String(chosen.category),
          debounceSeconds: chosen.debounceSeconds,
        };
      }
    } catch (err) {
      // A configuration read must never stop a stop being recorded.
      this.logger.warn(`state-rule lookup failed for ${state}: ${(err as Error).message}`);
    }

    this.ruleCache.set(key, { at: Date.now(), rule });
    return rule;
  }

  /**
   * True when this bit is oscillating rather than resting.
   *
   * Records a timestamp on every change and keeps only those inside the window,
   * so the check is over recent behaviour and the memory cannot grow.
   */
  private isPulsing(tag: StatusTag, on: boolean): boolean {
    const tagId = tag.tagId;
    const windowMs = tag.pulseWindowMs ?? PULSE_WINDOW_DEFAULT_MS;
    const minEdges = tag.pulseMinEdges ?? PULSE_MIN_EDGES_DEFAULT;
    const now = Date.now();
    const e = this.edges.get(tagId) ?? {
      last: on, at: [], samples: 0, lastSampleAt: 0, gaps: [],
      windowMs, minEdges, machineId: tag.machineId,
    };
    // The OBSERVED interval between samples, not the configured one. A device
    // set to 100 ms whose block read takes 400 ms is sampling at 400 ms, and a
    // lamp flashing faster than twice that is invisible however the pulse window
    // is configured. Nothing else in the gateway reports this, which is why a
    // signal can be correct everywhere on screen and still never be seen.
    if (e.lastSampleAt > 0) {
      e.gaps.push(now - e.lastSampleAt);
      if (e.gaps.length > SAMPLE_GAPS_KEPT) e.gaps.shift();
    }
    e.lastSampleAt = now;
    e.samples += 1;
    e.windowMs = windowMs;
    e.minEdges = minEdges;
    e.machineId = tag.machineId;

    if (on !== e.last) {
      e.at.push(now);
      e.last = on;
      e.sawEdgeOnce = true;
    }
    e.at = e.at.filter((t) => now - t <= windowMs);
    this.edges.set(tagId, e);
    return e.at.length >= minEdges;
  }

  /**
   * What the pulse detector is actually seeing, per tag.
   *
   * A pulsed signal that does not work looks identical from every screen in the
   * system to one that is simply steady: the machine reads RUNNING either way.
   * The difference is only visible here — whether edges are arriving at all, and
   * whether the sampler is fast enough to have seen them if they were.
   */
  pulseDiagnostics(): PulseDiagnostic[] {
    const now = Date.now();
    return [...this.edges.entries()].map(([tagId, e]) => {
      const recent = e.at.filter((t) => now - t <= e.windowMs);
      const sampleMs = e.gaps.length > 0
        ? Math.round(e.gaps.reduce((a, b) => a + b, 0) / e.gaps.length)
        : null;
      // Nyquist: a square wave is only resolvable when its half-period exceeds
      // the sample interval, and reliably so at twice it. Expressed as the
      // fastest flash this sampler can be trusted to see.
      const fastestFlashHz = sampleMs && sampleMs > 0 ? Math.round(1000 / (4 * sampleMs) * 10) / 10 : null;
      return {
        tagId,
        machineId: e.machineId,
        pulsing: recent.length >= e.minEdges,
        edgesInWindow: recent.length,
        minEdges: e.minEdges,
        windowMs: e.windowMs,
        level: e.last,
        samples: e.samples,
        observedSampleMs: sampleMs,
        fastestResolvableFlashHz: fastestFlashHz,
        lastSampleAgoMs: e.lastSampleAt > 0 ? now - e.lastSampleAt : null,
        lastEdgeAgoMs: e.at.length > 0 ? now - e.at[e.at.length - 1] : null,
        // The window holds only recent edges, so a signal that has never changed
        // since the gateway started is indistinguishable from one that stopped
        // changing an hour ago — except by this.
        everSawAnEdge: e.samples > 1 && (e.at.length > 0 || e.sawEdgeOnce === true),
      };
    });
  }

  private async derive(tag: StatusTag, numeric: number): Promise<string | null> {
    if (tag.dataType === 'BOOL') {
      const on = numeric >= 1;

      // Three states on one bit (I360's Euro-Pack Robot):
      //   steady ON → running · PULSING → stop mode · OFF → alarm / e-stop
      // The pulse check must run on EVERY sample, including while the signal is
      // low, or the low half of each cycle would be misread as an alarm.
      if (tag.signalRole === 'RUN_MODE_PULSED') {
        const pulsing = this.isPulsing(tag, on);
        if (pulsing) return 'IDLE';   // stop mode — a deliberate stop, not a fault
        if (on) return 'RUNNING';
        return this.stoppedState(tag);
      }

      // A plain Run Mode bit. Note this stays ON while the machine is merely
      // starved — I360's spec says "running/ready, INCLUDING ready with no product
      // being processed" — so RUNNING here means ABLE to work, not working. The
      // PROCESSING signal decides that, in StateInferenceService.
      if (on) return 'RUNNING';
      return this.stoppedState(tag);
    }
    const map = tag.statusMap ?? DEFAULT_STATUS_MAP;
    return map[String(Math.round(numeric))] ?? null;
  }

  /**
   * A false run signal: a fault while an order is running, otherwise just idle.
   *
   * Asks the inference service rather than counting job orders itself. It used
   * to run its own query with its own idea of what counts as work, and the two
   * definitions drifted — see `hasWorkScheduled`. Four machines in one
   * situation showed three different states because of it.
   */
  private async stoppedState(tag: StatusTag): Promise<string> {
    const working = await this.inference.hasWorkScheduled(tag.machineId!);
    return working ? 'BREAKDOWN' : 'IDLE';
  }

  private async apply(factoryId: string, machineId: string, rawState: string, when: Date): Promise<void> {
    // A bare stop signal says the machine stopped, not why. Ask the line: a stop
    // with no material arriving is STARVED, one with nowhere to discharge is
    // BLOCKED, and OEE already excludes both from the machine's own losses. An
    // explicit STARVED/BLOCKED from the status word passes through untouched.
    const state = await this.inference.classify(machineId, rawState);

    // What this gateway last wrote for the machine. It is the only writer of
    // that row, so after the first sighting the answer is already here — and
    // asking the server for it on every poll put a WAN round-trip between two
    // Modbus samples, which is where fast counter pulses were being lost.
    const cached = this.appliedState.get(machineId);
    let currentState: string | null;
    if (cached && Date.now() - cached.at < StatusService.APPLIED_TTL_MS) {
      currentState = cached.state;
    } else {
      const row = await this.prisma.machineCurrentStatus
        .findUnique({ where: { machineId }, select: { state: true } })
        .catch(() => null);
      currentState = row?.state ?? null;
      this.appliedState.set(machineId, { state: currentState, at: Date.now() });
    }
    if (currentState === state) {
      this.pending.delete(machineId); // settled back — nothing was waiting
      // First sighting of this machine since boot: the open history record may
      // still describe whatever it was doing before the gateway restarted. A
      // machine that comes back up already STARVED never changes state, so
      // without this its history stays wrong for as long as it keeps waiting —
      // and those minutes are exactly the ones OEE subtracts as external loss.
      await this.reconcileHistoryOnce(factoryId, machineId, state, when);
      return;
    }

    // How this plant classifies the state — configured, not compiled in.
    const rule = await this.ruleFor(factoryId, machineId, state);

    // ── Debounce ────────────────────────────────────────────────────────────
    // A contact that chatters, or a state the line context keeps flipping,
    // produces a downtime event per poll. Live running on 14 Aug 2026 recorded
    // three BLOCKED events for one machine inside two seconds — 0.6 s each.
    // A log like that cannot be read, and its event COUNT is meaningless even
    // though the total minutes are roughly right.
    //
    // So a state must hold for its configured settling time before it is
    // believed. The field existed and was carried all the way here; nothing
    // used it. Configurable per state and per machine, because how long is long
    // enough is a property of the machine, not of the software.
    if (!this.settled(machineId, state, rule.debounceSeconds, when)) return;

    if (state !== rawState) {
      this.logger.log(`machine ${machineId}: ${rawState} reclassified as ${state} from line context`);
    }

    // ── State HISTORY ───────────────────────────────────────────────────────
    // Separate from machineCurrentStatus, which only ever holds "now". Until
    // this was added the gateway wrote the current state and the downtime event
    // but never the history, so machine_state_records held one RUNNING row per
    // machine, opened when its job order started and never closed. Two things
    // broke silently as a result:
    //
    //   • the Machine Status Timeline drew one solid green bar for days, even
    //     with the machine visibly STARVED on the same screen;
    //   • the OEE engine reads STARVED / BLOCKED minutes FROM THIS TABLE to
    //     subtract external loss from planned production time — so external
    //     loss was always zero, and the starvation work never reached OEE.
    //
    // Written before the downtime event so a reader that sees the event always
    // finds the matching state record already there.
    await this.recordStateChange(factoryId, machineId, state, when);

    await this.prisma.machineCurrentStatus.upsert({
      where: { machineId },
      create: { machineId, state: state as any, lastEventAt: when },
      update: { state: state as any, lastEventAt: when },
    });
    this.appliedState.set(machineId, { state, at: Date.now() });

    let open = await this.prisma.downtimeEvent.findFirst({ where: { machineId, endTime: null } });

    // ── One stop, one reason ────────────────────────────────────────────────
    // A machine can move from one stopped state straight into another —
    // STARVED then BREAKDOWN when the operator gives up and calls maintenance.
    // Leaving the first event open books the WHOLE stop under the first reason.
    // With STARVED excluded from OEE by rule, an hour of genuine breakdown would
    // vanish from availability because its first two minutes were starvation.
    //
    // So a change of reason closes the old event and opens a new one. Only
    // events this service opened are touched: an operator who has already
    // classified a stop by hand outranks the signal, and their record is left
    // exactly as they left it.
    if (rule.isDowntime && open && this.autoStateOf(open.reason) !== null
        && this.autoStateOf(open.reason) !== state) {
      await this.closeEvent(open, when);
      open = null;
    }

    if (rule.isDowntime && !open) {
      await this.openEvent(factoryId, machineId, state, rule, when);
    } else if (!rule.isDowntime && open) {
      await this.closeEvent(open, when);
    }
  }

  /**
   * Open the downtime event for a stopped state.
   *
   * Extracted so the steady-state path and the reconciliation path below cannot
   * drift: an event opened by one and an event opened by the other must carry the
   * same reason, category and OEE flags, or the same stop would be charged two
   * different ways depending on which code path noticed it.
   */
  private async openEvent(
    factoryId: string, machineId: string, state: string, rule: StateRule, when: Date,
  ): Promise<void> {
    const activeWO = await this.prisma.workOrder.findFirst({
      where: { status: 'IN_PROGRESS', jobOrders: { some: { machineId } } },
      select: { id: true },
    });
    await this.prisma.downtimeEvent.create({
      data: {
        factoryId, machineId,
        workOrderId: activeWO?.id ?? null,
        reasonCode: (rule.reasonCode ?? 'UNPLANNED_BREAKDOWN') as any,
        category: rule.category as any,
        reason: `${AUTO_REASON_PREFIX}${state}`,
        startTime: when,
        isPlanned: rule.isPlanned,
        // Straight from the rule. This used to be derived from a hard-coded list
        // of excluded reason codes, so a plant could not decide for itself that,
        // say, cleaning should not count against availability.
        affectsOEE: rule.affectsOEE,
      } as any,
    });
  }

  /**
   * When each machine's history was last checked against reality.
   *
   * A Set that was never cleared meant "once per boot", and that left a real hole:
   * clearing downtime events from the Danger Zone WHILE the gateway is running
   * leaves a stopped machine with no event and no way to notice, because it never
   * changes state and it has already been reconciled. It stayed broken until
   * somebody restarted the gateway.
   *
   * A timestamp with a TTL closes that: the check is still effectively free in the
   * steady state (one lookup per machine per minute, and it exits on the first
   * query when the event is there), but the system now repairs itself.
   */
  private readonly reconciled = new Map<string, number>();
  private static readonly RECONCILE_TTL_MS = 60_000;

  /**
   * One-time check that the open history record matches what the machine is
   * actually doing.
   *
   * Runs on the first reading per machine after a restart and never again, so it
   * costs one query per machine per boot rather than one per poll. Without it a
   * machine that was already STARVED when the gateway came up would keep an open
   * record describing the state it was in beforehand — and since the OEE engine
   * reads external loss from these rows, those minutes would be attributed to
   * the wrong state entirely.
   */
  private async reconcileHistoryOnce(
    factoryId: string, machineId: string, state: string, when: Date,
  ): Promise<void> {
    const last = this.reconciled.get(machineId) ?? 0;
    if (Date.now() - last < StatusService.RECONCILE_TTL_MS) return;
    this.reconciled.set(machineId, Date.now());

    try {
      const open = await this.prisma.machineStateRecord.findFirst({
        where: { machineId, endTime: null },
        orderBy: { startTime: 'desc' },
        select: { id: true, state: true },
      });
      if (!open || String(open.state) !== state) {
        await this.recordStateChange(factoryId, machineId, state, when);
        this.logger.log(`machine ${machineId}: state history reconciled to ${state} after restart`);
      }

      // ── The downtime EVENT has to be reconciled too ─────────────────────────
      //
      // This used to stop at the state record, and that gap was the single
      // biggest source of numbers that could not be reconciled across the app.
      //
      // A machine already stopped when the gateway starts — or one whose events
      // were cleared by a Danger Zone reset while it stayed in the same state —
      // never CHANGES state, so `apply` returns early here and the code that opens
      // the event is never reached. Measured on this plant: four machines BLOCKED
      // or in BREAKDOWN, each with an open state record, and zero open downtime
      // events between them.
      //
      // The consequence is not a missing row. Machine Status reads state records
      // and reported 0% availability; the fact store reads downtime events, saw no
      // stop at all, and credited every one of those minutes as run time — 91.8%
      // on the same machine, on the same screen, at the same moment. The state
      // timeline and the OEE engine were describing the same minutes and
      // disagreeing about whether the machine was running.
      const rule = await this.ruleFor(factoryId, machineId, state);
      if (!rule.isDowntime) return;

      const openEvent = await this.prisma.downtimeEvent.findFirst({
        where: { machineId, endTime: null },
        select: { id: true },
      });
      if (openEvent) return; // already accounted for

      // Backdate to when the machine actually entered the state, not to now:
      // opening it at `when` would silently forgive every minute it has already
      // been stopped for. The state record is the honest start.
      const since = await this.prisma.machineStateRecord.findFirst({
        where: { machineId, endTime: null },
        orderBy: { startTime: 'desc' },
        select: { startTime: true },
      });
      await this.openEvent(factoryId, machineId, state, rule, since?.startTime ?? when);
      this.logger.log(
        `machine ${machineId}: downtime event reopened for ongoing ${state} ` +
        `(since ${(since?.startTime ?? when).toISOString()}) — state history had no matching event`,
      );
    } catch (err) {
      this.reconciled.delete(machineId); // let the next poll try again, not the next minute
      this.logger.warn(`history reconcile failed for machine ${machineId}: ${(err as Error).message}`);
    }
  }

  /**
   * Close the machine's open state record and open one for the new state.
   *
   * The pair is the timeline: one row per period the machine spent in a state,
   * with a duration. It is also what the OEE engine reads to remove STARVED and
   * BLOCKED minutes from planned production time, so a gap here does not just
   * spoil a chart — it silently returns a machine's external losses to its own
   * availability.
   *
   * Best-effort: a failure is logged, never thrown. Losing a history row is bad;
   * losing the live state and the downtime event because history failed is worse.
   */
  private async recordStateChange(
    factoryId: string, machineId: string, state: string, when: Date,
  ): Promise<void> {
    try {
      const open = await this.prisma.machineStateRecord.findFirst({
        where: { machineId, endTime: null },
        orderBy: { startTime: 'desc' },
        select: { id: true, state: true, startTime: true },
      });

      if (open) {
        // Already recorded as this state — nothing changed, leave it running.
        if (String(open.state) === state) return;
        await this.prisma.machineStateRecord.update({
          where: { id: open.id },
          data: {
            endTime: when,
            durationMinutes: Math.max(0, (when.getTime() - open.startTime.getTime()) / 60_000),
          },
        });
      }

      // The job order gives the record its production context, so a timeline can
      // be read against what the machine was actually making at the time.
      const jo = await this.prisma.jobOrder.findFirst({
        where: { machineId, status: 'EXECUTING' },
        select: { workOrderId: true, workOrder: { select: { skuId: true } } },
      });

      await this.prisma.machineStateRecord.create({
        data: {
          factoryId,
          machineId,
          state: state as never,
          startTime: when,
          workOrderId: jo?.workOrderId ?? null,
          skuId: jo?.workOrder?.skuId ?? null,
          source: 'SYSTEM',
        },
      });
    } catch (err) {
      this.logger.warn(
        `state history write failed for machine ${machineId} (${state}): ${(err as Error).message}`,
      );
    }
  }

  /** A state seen but not yet believed, per machine. */
  private readonly pending = new Map<string, { state: string; since: number }>();

  /**
   * Has this state held long enough to be believed?
   *
   * A settling time of zero means act at once, which is the seeded default and
   * so preserves the behaviour of every existing install until somebody chooses
   * otherwise. Timestamps come from the reading rather than the wall clock, so
   * the decision is reproducible and testable.
   */
  private settled(machineId: string, state: string, debounceSeconds: number, when: Date): boolean {
    if (!debounceSeconds || debounceSeconds <= 0) {
      this.pending.delete(machineId);
      return true;
    }

    const at = when.getTime();
    const waiting = this.pending.get(machineId);

    // First sight of this state, or the machine changed its mind about which
    // state it is settling into — either way the clock restarts.
    if (!waiting || waiting.state !== state) {
      this.pending.set(machineId, { state, since: at });
      return false;
    }

    if (at - waiting.since < debounceSeconds * 1000) return false;

    this.pending.delete(machineId);
    return true;
  }

  /**
   * The machine state an auto-opened event was filed under, or null when this
   * service did not open it. Null means hands off: an operator's own
   * classification of a stop outranks anything derived from a signal.
   */
  private autoStateOf(reason: string | null | undefined): string | null {
    if (!reason?.startsWith(AUTO_REASON_PREFIX)) return null;
    return reason.slice(AUTO_REASON_PREFIX.length);
  }

  /** Close a downtime event and credit its minutes to the work order. */
  private async closeEvent(
    open: { id: string; startTime: Date; workOrderId: string | null },
    when: Date,
  ): Promise<void> {
    const durationMinutes = (when.getTime() - open.startTime.getTime()) / 60_000;
    await this.prisma.downtimeEvent.update({ where: { id: open.id }, data: { endTime: when, durationMinutes } });
    if (open.workOrderId) {
      await this.prisma.workOrder
        .update({ where: { id: open.workOrderId }, data: { downtimeMinutes: { increment: durationMinutes } } })
        .catch(() => undefined);
    }
  }
}
