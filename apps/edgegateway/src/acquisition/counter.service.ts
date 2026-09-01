import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectEdge, totalizerDelta, totalizerWidth, type CounterRole, type EdgeType } from '@i360/industrial-drivers';
import { readConfigFile, writeConfigFile } from '../config/config-store';
import { aliasingWarning, deriveRejects } from './config-audit';

import { PrismaService } from '../prisma/prisma.service';

export interface CounterTag {
  id: string;
  machineId: string | null;
  factoryId: string;
  counterRole: CounterRole | null;
  edgeType: EdgeType;
  /** Registers the value spans — sets the wrap point for a TOTALIZER. */
  wordCount?: number | null;
}

/**
 * What a machine is allowed to do in one minute, and how fast a real pulse can
 * arrive. Held per machine, edited from the gateway's own settings page, and
 * re-read on every use so a plant can tune a limit mid-shift without a restart.
 */
export interface MachineLimit {
  /**
   * Ignore an edge arriving sooner than this after the last one COUNTED.
   *
   * A photo-eye's contact rings when it makes: one carton produces a burst of
   * transitions over a few tens of milliseconds, and a sampler looking every
   * 27 ms catches two of them as two separate pulses. Measured on this plant on
   * 25 Aug 2026: M1 recorded 68.8 parts a minute against a mechanical ceiling of
   * 45, in 60 of 65 full running minutes.
   *
   * The safe value comes from the machine, not from taste: at 45 parts a minute
   * the fastest real gap is 1333 ms, so 200 ms kills every ring and cannot
   * touch a product. Zero disables it.
   */
  debounceMs: number;
  /**
   * Allowance around the machine's own design rate, in counts per minute.
   *
   * The cap is `designPerMin + tolerancePerMin`, and `designPerMin` comes from
   * the running order's ideal cycle time — in the counter's OWN unit, so a
   * cartoner is capped in cartons and a filler in sachets with no conversion.
   * May be negative (a tighter cap than design) or zero (design exactly).
   *
   * `null` means no cap: the plant has not stated a limit, and inventing one
   * would silently discard real production.
   */
  tolerancePerMin: number | null;
}

/** What one minute's balance did to a machine's counts. */
export interface BalanceResult {
  good: number;
  bad: number;
  trimmedGood: number;
  trimmedBad: number;
}

/**
 * Hold a minute's counts to what the machine can physically make.
 *
 * ── The rule, as the plant stated it ────────────────────────────────────────
 * The cap is the machine's design rate plus an allowance the plant sets, and a
 * minute over that cap is trimmed to it. What gets trimmed is not arbitrary:
 * **the rejects go first, and the good is protected.** A count the sensor
 * invented is far more likely to have been booked as a reject than as a
 * saleable unit, and a plant would rather understate its scrap than overstate
 * its output.
 *
 * Worked against the plant's own two examples, at design 45 and tolerance +5:
 *
 *   40 good + 15 bad = 55 → over by 5 → all 5 off the bad → 40 good + 10 bad
 *   55 good +  1 bad = 56 → over by 6 → 1 off the bad, then 5 off the good
 *                                     → 50 good +  0 bad
 *
 * A tolerance may be negative (a tighter cap than design) or zero (design
 * exactly). It NEVER pads upward: a stopped machine made nothing, and a cap is
 * a ceiling, not a target.
 *
 * ── What this costs, stated plainly ─────────────────────────────────────────
 * Trimming DISCARDS measured counts. That is the same class of silent
 * correction that produced the trouble this was written to contain, so it is
 * not silent: every trim is counted, surfaced on the health endpoint and
 * logged. Those counters are also the feedback signal for the debounce — once
 * the sensor stops double-counting, the trims fall to zero on their own, and a
 * trim rate that stays high says the gate is still not tight enough.
 */
export function balanceMinute(
  good: number, bad: number, roomLeft: number,
): BalanceResult {
  const total = good + bad;
  if (roomLeft < 0 || total <= roomLeft) {
    return { good, bad, trimmedGood: 0, trimmedBad: 0 };
  }
  let excess = total - roomLeft;
  const trimmedBad = Math.min(bad, excess);
  excess -= trimmedBad;
  const trimmedGood = Math.min(good, excess);
  return {
    good: good - trimmedGood,
    bad: bad - trimmedBad,
    trimmedGood,
    trimmedBad,
  };
}

export interface CountEvent {
  jobOrderId: string;
  machineId: string;
  role: CounterRole;
  good: number;
  rejected: number;
  total: number;
  // Per-edge increments — consumed by the API to journal shift/WO production trends.
  goodDelta: number;
  scrapDelta: number;
  ts: string;
}

interface CounterMem {
  lastRaw: number | boolean | null;
  accumulated: number; // total edges counted for the current JO (advanced on EVERY edge, DB or not)
  synced: number;      // the `accumulated` value already written to the JO in Postgres
  jobOrderId: string | null;
  /** When an edge was last COUNTED — the debounce clock. Not persisted. */
  lastCountedAt?: number;
  /** Edges seen but suppressed as contact ring. Diagnostics only. */
  suppressed?: number;
}

/** What the batch writer needs to know about a machine, fetched once per batch. */
interface MachineWriteContext {
  joId: string | null;
  running: boolean;
  /**
   * Counts per minute the machine can physically make, from the running order's
   * ideal cycle time. Null when nothing is executing or no cycle time is set —
   * and then no cap is applied, because a cap needs a number the plant stated.
   */
  designPerMin: number | null;
  priorGood: number;
  priorScrap: number;
  manualGood: number;
  manualBad: number;
}

/**
 * One machine's arithmetic for one batch, assembled in memory.
 *
 * Several counters on a machine — a good sensor and a total sensor — used to
 * write separately, each asking the database what the other had just done. That
 * ordering decided the answer, and the scrap figure moved depending on which
 * tag the poller happened to visit first. Here both land in the same object
 * before anything is written, so the subtraction is over two numbers this
 * process holds, and the write is one statement.
 */
class MachinePlan {
  goodDelta = 0;
  scrapDelta = 0;
  /** Edges from a TOTAL counter — only credited when there is no good counter. */
  totalDelta = 0;
  /** Accumulated totals for the roles present on this machine, or null if absent. */
  goodAcc: number | null = null;
  totalAcc: number | null = null;
  /** Set when scrap is DERIVED from a total rather than counted directly. */
  scrapAbsolute: number | null = null;
  lastRole: CounterRole = 'GOOD';
  readonly priorGood: number;
  readonly priorScrap: number;
  readonly manualBad: number;

  constructor(
    readonly machineId: string,
    readonly jobOrderId: string,
    ctx: MachineWriteContext,
  ) {
    this.priorGood = ctx.priorGood;
    this.priorScrap = ctx.priorScrap;
    this.manualBad = ctx.manualBad;
  }

  add(tag: CounterTag, delta: number, _accumulated: number): void {
    const role = tag.counterRole as CounterRole;
    this.lastRole = role;
    if (role === 'GOOD') this.goodDelta += delta;
    else if (role === 'BAD') this.scrapDelta += delta;
    else if (role === 'TOTAL') this.totalDelta += delta;
    // TOTAL contributes no delta of its own — what it changes is the DERIVED
    // scrap, and that is computed from accumulators in `stampAccumulators`
    // rather than from whichever tags happened to move in this batch.
  }

  /**
   * The machine's standing totals, taken from every counter it has — not only
   * the ones with a pulse in this batch.
   *
   * The distinction matters. Scrap is `total − good`, and a batch where the
   * total sensor fired and the good sensor did not is completely ordinary: the
   * two are different sensors a few centimetres apart and their pulses do not
   * arrive in the same 20 ms window. Deriving from the batch alone would read
   * the absent good counter as zero and book the entire production run as
   * scrap. So both numbers come from the accumulator, which always holds the
   * whole count.
   */
  stampAccumulators(goodAcc: number | null, totalAcc: number | null): void {
    this.goodAcc = goodAcc;
    this.totalAcc = totalAcc;
  }
}

/**
 * Turns rising edges on COUNTER tags into Good/Bad/Total quantities on the
 * machine's currently EXECUTING Job Order.
 *
 *  - GOOD  edge → JobOrder.actualQtyGood += 1, status.goodCount += 1
 *  - BAD   edge → JobOrder.actualQtyRejected += 1, status.rejectCount += 1
 *  - TOTAL edge → bad is derived: rejected = total − good
 *
 * Map a device as either (GOOD + BAD) or (TOTAL + GOOD).
 *
 * **Outage-safe counting.** Edge detection runs on every poll and advances the
 * in-memory `accumulated` total regardless of Postgres availability; that total
 * is mirrored to a local disk file (`counter-state.json`) on every edge, so it
 * survives both a DB outage AND a gateway restart during one. The value written
 * to the JO (`synced`) trails `accumulated`; whenever the DB is reachable the
 * pending delta (`accumulated − synced`) is flushed to the JO and published.
 * Example: total=120, DB drops for 10 min while 10 parts pass → `accumulated`
 * climbs to 130 locally; when the DB returns, the JO jumps 120→130 and a count
 * event is published. Nothing is lost or double-counted (`synced` is the guard).
 */
@Injectable()
export class CounterService {
  private readonly logger = new Logger(CounterService.name);
  private readonly cache = new Map<string, CounterMem>();

  /** Tags with counted-but-unwritten edges, drained by {@link flush}. */
  private readonly pending = new Set<string>();
  /** Definitions seen by {@link observe}, so flush can act without the poller. */
  private readonly tags = new Map<string, CounterTag>();
  /** Tags being seeded from the DB right now — never seeded twice at once. */
  private readonly seeding = new Set<string>();
  /** Set when memory has moved ahead of the disk file. */
  private dirty = false;

  /** True while a batch is being written — keeps a slow flush from re-entering. */
  private writing = false;

  /**
   * Job order + running state per machine.
   *
   * One second: long enough that several counters on one machine share a
   * single pair of queries, short enough that starting a job order takes
   * effect before anybody notices.
   */
  private readonly ctxCache = new Map<string, { at: number; value: { joId: string | null; running: boolean; dbUp: boolean } }>();

  /**
   * Pulses counted while NO job order was executing, per tag, since start-up.
   *
   * Not production, and not an error either: a counter that turns with nothing
   * scheduled means the line moved outside an order, or the input is picking up
   * noise. Either is worth seeing, and neither may be attributed to whichever
   * order happens to start next.
   */
  private readonly orphaned = new Map<string, number>();

  /** What has been dropped for want of an order, for the diagnostics endpoint. */
  orphanedCounts(): Array<{ tagId: string; count: number }> {
    return [...this.orphaned].map(([tagId, count]) => ({ tagId, count }));
  }

  /**
   * Pulses dropped because the machine was not running, per tag.
   *
   * Sits beside {@link orphanedCounts} on the health view. The two answer
   * different questions: orphaned means "nothing was scheduled", stopped means
   * "something was scheduled and the machine was standing still".
   */
  stoppedWhileIdleCounts(): Array<{ tagId: string; count: number }> {
    return [...this.stoppedCounts].map(([tagId, count]) => ({ tagId, count }));
  }
  private static readonly CTX_TTL_MS = 1_000;
  private readonly stateFile: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const dir = config.get<string>('bufferDir') ?? './buffer';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.stateFile = join(dir, 'counter-state.json');
    this.loadLocalFile();
  }

  /** Seed the cache from the local disk file (authoritative during a DB outage). */
  private loadLocalFile(): void {
    try {
      if (!existsSync(this.stateFile)) return;
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Record<string, Partial<CounterMem>>;
      for (const [tagId, s] of Object.entries(raw)) {
        this.cache.set(tagId, {
          lastRaw: s.lastRaw ?? null,
          accumulated: s.accumulated ?? 0,
          synced: s.synced ?? s.accumulated ?? 0,
          jobOrderId: s.jobOrderId ?? null,
        });
      }
      this.logger.log(`Restored ${this.cache.size} counter state(s) from disk`);
    } catch (err) {
      this.logger.warn(`counter-state load failed: ${(err as Error).message}`);
    }
  }

  /** Persist all counter state to disk (small file, written only when a count changes). */
  private saveLocal(): void {
    try {
      const obj: Record<string, CounterMem> = {};
      for (const [tagId, m] of this.cache) {
        obj[tagId] = {
          lastRaw: typeof m.lastRaw === 'boolean' ? (m.lastRaw ? 1 : 0) : m.lastRaw,
          accumulated: m.accumulated,
          synced: m.synced,
          jobOrderId: m.jobOrderId,
        };
      }
      writeFileSync(this.stateFile, JSON.stringify(obj));
    } catch (err) {
      this.logger.error(`counter-state save failed: ${(err as Error).message}`);
    }
  }

  private async load(tagId: string): Promise<CounterMem> {
    const cached = this.cache.get(tagId);
    if (cached) return cached;
    // Not in the local file → first run for this tag; seed from the DB record (fully synced).
    const state = await this.prisma.gatewayCounterState
      .findUnique({ where: { tagId } })
      .catch(() => null);
    const mem: CounterMem = {
      lastRaw: state?.lastRawValue ?? null,
      accumulated: state?.accumulated ?? 0,
      synced: state?.accumulated ?? 0,
      jobOrderId: state?.jobOrderId ?? null,
    };
    this.cache.set(tagId, mem);
    return mem;
  }

  /** Mirror the current (already-synced) state to Postgres. Best-effort. */
  private async persistDb(tagId: string, mem: CounterMem, edgeAt?: string): Promise<void> {
    const raw = typeof mem.lastRaw === 'boolean' ? (mem.lastRaw ? 1 : 0) : mem.lastRaw;
    await this.prisma.gatewayCounterState
      .upsert({
        where: { tagId },
        create: {
          tagId,
          lastRawValue: raw,
          accumulated: mem.accumulated,
          jobOrderId: mem.jobOrderId,
          ...(edgeAt ? { lastEdgeAt: new Date(edgeAt) } : {}),
        },
        update: {
          lastRawValue: raw,
          accumulated: mem.accumulated,
          jobOrderId: mem.jobOrderId,
          ...(edgeAt ? { lastEdgeAt: new Date(edgeAt) } : {}),
        },
      })
      .catch((err) => this.logger.error(`Counter state persist failed (${tagId})`, err as Error));
  }

  /**
   * Count an edge. SYNCHRONOUS, and deliberately so.
   *
   * ── The bug this exists for ─────────────────────────────────────────────────
   * `process()` below did two fresh database queries — the executing job order
   * and the machine's current state — plus a file write and up to two more
   * writes, PER COUNTER TAG, PER POLL. The poller awaited all of that inline and
   * skipped the next cycle while it ran (`if (dev.busy) return`).
   *
   * So the real sampling period was not the configured 100 ms; it was however
   * long that chain took, and on a device with four counters it is far longer. A
   * filler running 120 parts a minute emits a pulse every 500 ms, and pulses
   * that open and close between two samples are simply never seen. The counts
   * came out low and the input looked permanently TRUE, because the sampler was
   * only ever awake for part of the wave.
   *
   * Nothing here touches the database or the disk. It reads the cache, compares
   * against the previous raw level, and adds to an in-memory total. The poll
   * loop can then run at its configured rate, and {@link flush} does the
   * persisting on its own schedule.
   *
   * A tag not yet in the cache is SEEDED asynchronously and counts from the next
   * cycle. Missing one edge on the very first poll of a tag's life is the price
   * of never blocking the loop; missing them at 2 Hz forever is not.
   */
  observe(tag: CounterTag, raw: number | boolean | null, _ts: string): void {
    if (!tag.machineId || !tag.counterRole || tag.counterRole === 'NONE') return;

    const mem = this.cache.get(tag.id);
    if (!mem) {
      // First sighting. Seed from the DB in the background; do not block.
      if (!this.seeding.has(tag.id)) {
        this.seeding.add(tag.id);
        void this.load(tag.id).finally(() => this.seeding.delete(tag.id));
      }
      return;
    }

    // Registered on every reading, not only on an edge. A counter that has
    // never pulsed used to be absent from this map entirely — so a DEAD sensor,
    // the one most worth seeing, was the one thing the health view could not
    // show. It is now listed with nothing to report, which is the finding.
    this.tags.set(tag.id, tag);

    // A totalizer has no pulse to measure — the device did the counting and the
    // gateway reads a running total, so its sample rate is not in question.
    if (tag.edgeType !== 'TOTALIZER') this.measurePulse(tag, mem.lastRaw, raw);

    const inc = tag.edgeType === 'TOTALIZER'
      ? totalizerDelta(mem.lastRaw, raw, totalizerWidth(tag.wordCount))
      : detectEdge(mem.lastRaw, raw, tag.edgeType);

    // The level ALWAYS advances, whether or not the edge is counted. Suppressing
    // the level as well would break edge detection outright: the next real pulse
    // would be compared against a stale baseline and missed.
    mem.lastRaw = raw;
    if (inc <= 0) return;

    // ── The debounce gate ─────────────────────────────────────────────────
    // A totalizer is exempt: the device did the counting, and a register that
    // advances twice in quick succession advanced twice.
    if (tag.edgeType !== 'TOTALIZER') {
      const gap = this.debounceMsFor(tag.machineId);
      if (gap > 0) {
        const now = Date.now();
        if (mem.lastCountedAt !== undefined && now - mem.lastCountedAt < gap) {
          // Contact ring, not a product. Recorded rather than dropped in
          // silence — this counter is how the plant finds out whether the gate
          // is set too tight and is eating real pulses.
          mem.suppressed = (mem.suppressed ?? 0) + inc;
          return;
        }
        mem.lastCountedAt = now;
      }
    }

    mem.accumulated += inc;
    this.pending.add(tag.id);
    this.dirty = true;
  }

  /**
   * How much a machine has already been credited THIS minute, and what the
   * balance has taken off it.
   *
   * Keyed by machine and reset when the minute turns. A step toward the bucket
   * model rather than a detour from it: the moment counts are held per minute
   * here, a minute becomes a thing the gateway can name — which is the whole
   * premise of what comes next.
   */
  /** Throttle for the good-above-total warning, per machine. */
  private readonly goodOverTotalAt = new Map<string, number>();

  /**
   * Pulses seen while the machine was NOT running, per tag.
   *
   * Dropped rather than booked, and counted rather than forgotten. A steadily
   * climbing figure here is a real finding -- it means an input is turning
   * while its machine stands still, which no debounce and no cap will explain.
   */
  private readonly stoppedCounts = new Map<string, number>();

  private readonly minuteTally = new Map<string, {
    minute: number; emitted: number;
    trimmedGood: number; trimmedBad: number; warnedAt: number;
  }>();

  /**
   * A rolling record of what each machine emitted, minute by minute, so a
   * SUSTAINED over-rate can be caught as well as a single burst.
   *
   * One entry per machine, holding the last {@link WINDOW_MINUTES} minutes.
   */
  private readonly windowTally = new Map<string, Map<number, number>>();

  /**
   * The cap when the plant has not stated one.
   *
   * ── Why there is a default at all ───────────────────────────────────────
   * This gate used to require `tolerancePerMin` in gateway-config.json, and
   * that file has never had a `machineLimits` block. So the cap was off on
   * every machine, on every deployment, and a counter reporting 9,424 pieces
   * in a minute whose ceiling is 43 was written to the job order unchallenged.
   *
   * A safety limit that must be configured before it protects anything is not
   * a safety limit. Off is now a DECISION -- `tolerancePerMin: null` -- rather
   * than the consequence of never having written the file.
   *
   * A quarter above design speed is deliberately generous. It is not trying to
   * measure the machine; it is trying to be unmistakably above anything the
   * machine can physically do, so that what it trims is only ever impossible.
   */
  private static readonly DEFAULT_TOLERANCE_FRACTION = 0.25;

  /**
   * The window for the sustained-rate cap, in minutes.
   *
   * ── Why a per-minute cap is not enough ──────────────────────────────────
   * The per-minute cap is floored at one whole unit, and that floor is
   * load-bearing: a palletiser rated at 0.28 pallets a minute really does put
   * one whole pallet into one minute, and trimming it to 0.28 of a pallet would
   * shave away real output on every slow machine in the plant.
   *
   * But the floor is also a hole. A machine rated 0.28 a minute can honestly
   * produce 1 in a minute; it cannot honestly produce 1 in EVERY minute. On
   * this line M3 and M4 exceeded their ceiling in 99% and 100% of their
   * counting minutes -- an average of 4.2x design, sustained for hours -- and
   * every one of those minutes passed the per-minute cap because each held
   * about one unit.
   *
   * Fifteen minutes is long enough that the floor stops hiding a sustained
   * over-rate, and short enough that a genuine burst after a stoppage is not
   * charged against an hour of history.
   */
  private static readonly WINDOW_MINUTES = 15;

  /**
   * Room left in this machine's minute, or -1 when no cap applies.
   *
   * Two caps, because the two failures on this line look nothing alike:
   *
   *   per minute   catches a BURST -- 2,986 pieces on M1 and 9,424 on M2, in
   *                single minutes whose ceilings are 46 and 43. That is not a
   *                fast minute, it is a backlog paid out in the wrong place.
   *
   *   per window   catches a SUSTAINED over-rate the floor lets through, which
   *                is the whole of what M3 and M4 do.
   *
   * The tighter of the two wins, and either alone would have missed half of
   * what this line actually did.
   */
  private roomLeftThisMinute(machineId: string, designPerMin: number | null): number {
    const entry = this.limits()[machineId];
    const tol = entry?.tolerancePerMin;
    // No design speed means no ceiling to compare against -- the job order has
    // no ideal cycle time, and a cap invented here would be a guess.
    if (designPerMin === null) return -1;
    // An explicit null is the plant switching the cap OFF, and is honoured.
    if (tol === null) return -1;
    const tolerance = typeof tol === 'number'
      ? tol
      : designPerMin * CounterService.DEFAULT_TOLERANCE_FRACTION;

    const minute = Math.floor(Date.now() / 60_000);
    let t = this.minuteTally.get(machineId);
    if (!t || t.minute !== minute) {
      t = { minute, emitted: 0, trimmedGood: 0, trimmedBad: 0, warnedAt: t?.warnedAt ?? 0 };
      this.minuteTally.set(machineId, t);
    }
    // Floored at ONE WHOLE UNIT, and that floor is load-bearing.
    //
    // A palletiser on this line is rated at 0.28 pallets a minute — one every
    // three and a half. Capping a minute at 0.28 means the minute a pallet
    // actually completes reads 1 > 0.28 and gets trimmed to 0.28 OF A PALLET, a
    // number describing nothing. Every slow machine in the plant would have its
    // real output shaved away by a limit meant to catch a runaway counter.
    //
    // You cannot make a fraction of a countable thing. A minute holding one unit
    // is never evidence of over-counting, whatever the rated speed, so the cap
    // never falls below one.
    const cap = Math.max(1, designPerMin + tolerance);
    const roomThisMinute = Math.max(0, cap - t.emitted);

    // ── The sustained-rate cap ────────────────────────────────────────────
    // Over WINDOW_MINUTES a machine cannot beat its design speed, and the
    // one-unit floor that protects a slow machine's honest minute does not
    // apply across a window: a palletiser may put one pallet in one minute,
    // but not one in every minute for a quarter of an hour.
    const w = this.windowFor(machineId, minute);
    let emittedInWindow = 0;
    for (const n of w.values()) emittedInWindow += n;
    const windowCap = Math.max(
      1,
      (designPerMin + tolerance) * CounterService.WINDOW_MINUTES,
    );
    const roomInWindow = Math.max(0, windowCap - emittedInWindow);

    // The tighter of the two. A burst is caught by the first, a grinding
    // over-count by the second, and neither can be smuggled past the other.
    return Math.min(roomThisMinute, roomInWindow);
  }

  /** This machine's rolling window, pruned to the last WINDOW_MINUTES. */
  private windowFor(machineId: string, minute: number): Map<number, number> {
    let w = this.windowTally.get(machineId);
    if (!w) {
      w = new Map<number, number>();
      this.windowTally.set(machineId, w);
    }
    const oldest = minute - CounterService.WINDOW_MINUTES + 1;
    for (const k of w.keys()) if (k < oldest) w.delete(k);
    return w;
  }

  /** What the balance has taken off each machine — surfaced on the health view. */
  balanceTrims(): Array<{ machineId: string; trimmedGood: number; trimmedBad: number }> {
    return [...this.minuteTally.entries()].map(([machineId, t]) => ({
      machineId, trimmedGood: t.trimmedGood, trimmedBad: t.trimmedBad,
    }));
  }

  /**
   * Per-machine limits, read live from the gateway's config file.
   *
   * Deliberately not cached beyond one second: a plant changing a tolerance
   * mid-shift expects the next minute to obey it, and a restart to apply a
   * number is exactly the friction that stops these being used at all.
   */
  private limitsAt = 0;
  private limitsCache: Record<string, { debounceMs?: number; tolerancePerMin?: number | null }> = {};

  private limits(): Record<string, { debounceMs?: number; tolerancePerMin?: number | null }> {
    const now = Date.now();
    if (now - this.limitsAt > 1000) {
      this.limitsCache = readConfigFile().machineLimits ?? {};
      this.limitsAt = now;
    }
    return this.limitsCache;
  }

  /** The debounce window for a machine. Zero — the default — is off. */
  private debounceMsFor(machineId: string | null): number {
    if (!machineId) return 0;
    const v = this.limits()[machineId]?.debounceMs;
    return typeof v === 'number' && v > 0 ? v : 0;
  }

  /** Read the stored limits, for the settings screen. */
  machineLimits(): Record<string, { debounceMs: number; tolerancePerMin: number | null }> {
    const out: Record<string, { debounceMs: number; tolerancePerMin: number | null }> = {};
    for (const [k, v] of Object.entries(this.limits())) {
      out[k] = {
        debounceMs: typeof v.debounceMs === 'number' ? v.debounceMs : 0,
        tolerancePerMin: typeof v.tolerancePerMin === 'number' ? v.tolerancePerMin : null,
      };
    }
    return out;
  }

  /** Write one machine's limits and make them live on the next cycle. */
  setMachineLimit(machineId: string, patch: { debounceMs?: number; tolerancePerMin?: number | null }) {
    const all = { ...(readConfigFile().machineLimits ?? {}) };
    const cur = all[machineId] ?? {};
    all[machineId] = {
      debounceMs: patch.debounceMs !== undefined ? Math.max(0, Math.trunc(patch.debounceMs)) : cur.debounceMs,
      tolerancePerMin: patch.tolerancePerMin !== undefined
        ? (patch.tolerancePerMin === null ? null : Math.trunc(patch.tolerancePerMin))
        : cur.tolerancePerMin,
    };
    writeConfigFile({ machineLimits: all });
    this.limitsAt = 0; // next read is fresh
    return this.machineLimits()[machineId];
  }


  /**
   * WHETHER A COUNTER CAN BE BELIEVED — measured, not assumed.
   *
   * A miscounting sensor is silent. It does not error; it reports a smaller
   * number, and nothing about that number says it is wrong. The only way to
   * know is to look at the SHAPE of the signal and compare it with how often
   * the gateway is able to look.
   *
   * Two readings decide it. If the counted level never lasts more than one
   * sample, its true width is unknown and BELOW the sample period — the counter
   * is aliasing and its total is a floor, not a count. And if one counter on a
   * machine reports a small fraction of what another on the same machine sees,
   * the two are watching the same product stream and disagreeing, which points
   * at the sensor rather than at the software.
   *
   * Both were measured by hand on SDPF's line on 23 Aug 2026: one input pulsed
   * for ~17 ms and another for 607 ms on the same cartons, and the short one
   * caught 5 of 28. This turns that one-off investigation into something the
   * plant can read at any time.
   */
  counterDiagnostics(): Array<{
    tagId: string; machineId: string | null; counterRole: string | null;
    accumulated: number; observedMinutes: number; edgesPerMin: number | null;
    sampleIntervalMs: number | null; activePct: number | null;
    shortestActiveMs: number | null; shortestActiveSamples: number | null;
    medianActiveMs: number | null; aliasing: boolean;
    verdict: 'OK' | 'MARGINAL' | 'ALIASING' | 'UNKNOWN';
  }> {
    const out: Array<any> = [];
    for (const [tagId, tag] of this.tags) {
      const p = this.pulse.get(tagId);
      const mem = this.cache.get(tagId);
      const minutes = p ? (Date.now() - p.firstAt) / 60_000 : 0;
      const interval = p && p.intervalN ? p.intervalSum / p.intervalN : null;

      // The LIMITING level: whichever of the two the signal spends less time in.
      // That one is what a poll interval has to beat, and it is the one a
      // normally-closed sensor hides — its brief LOW, not its long rest.
      const hi = p && p.highRuns ? p.highMs / p.highRuns : null;
      const lo = p && p.lowRuns ? p.lowMs / p.lowRuns : null;
      const limitIsHigh = hi !== null && (lo === null || hi <= lo);
      const medianActive = hi === null ? lo : lo === null ? hi : Math.min(hi, lo);
      const limRuns = p ? (limitIsHigh ? p.highRuns : p.lowRuns) : 0;
      const limOne = p ? (limitIsHigh ? p.highOneSample : p.lowOneSample) : 0;

      // "Aliasing" is a specific claim: the limiting level has NEVER been seen to
      // last more than one sample, so its real width cannot be measured here and
      // is smaller than the interval. Counts from it are a lower bound.
      const aliasing = !!p && limRuns > 0 && limOne === limRuns;
      let verdict: string = 'UNKNOWN';
      if (p && limRuns > 0 && interval) {
        if (aliasing) verdict = 'ALIASING';
        else if (medianActive !== null && medianActive < interval * 3) verdict = 'MARGINAL';
        else verdict = 'OK';
      }

      out.push({
        tagId,
        machineId: tag.machineId,
        counterRole: tag.counterRole ?? null,
        accumulated: mem?.accumulated ?? 0,
        observedMinutes: Math.round(minutes * 10) / 10,
        edgesPerMin: p && minutes > 0.05 ? Math.round((p.edges / 2 / minutes) * 10) / 10 : null,
        sampleIntervalMs: interval === null ? null : Math.round(interval),
        activePct: p && p.samplesSeen ? Math.round((p.highSamples / p.samplesSeen) * 100) : null,
        shortestActiveMs: p && Number.isFinite(p.minMs) ? Math.round(p.minMs) : null,
        shortestActiveSamples: p && Number.isFinite(p.minSamples) ? p.minSamples : null,
        medianActiveMs: medianActive === null ? null : Math.round(medianActive),
        aliasing,
        verdict,
      });
    }
    return out;
  }

  /** How long each counter tag has held its present level, and the shortest seen. */
  private readonly pulse = new Map<string, {
    since: number; samples: number; minMs: number; minSamples: number; reportedAt: number;
    /** Everything needed to say whether this counter can be trusted at all. */
    firstAt: number; edges: number; samplesSeen: number; highSamples: number;
    highMs: number; highRuns: number; highOneSample: number;
    lowMs: number; lowRuns: number; lowOneSample: number;
    lastSampleAt: number; intervalSum: number; intervalN: number;
  }>();
  /** A level seen in this many samples or fewer is at the edge of being missed. */
  private static readonly ALIAS_SAMPLES = 2;

  /**
   * Measure the geometry of the signal being counted.
   *
   * Whether a counter is accurate is not a question about the code — it is the
   * relationship between how long the contact stays closed and how often the
   * gateway looks. A pulse shorter than the poll interval is invisible no matter
   * how the edge is detected, and it fails SILENTLY: the tag simply reads as a
   * flat level and the count comes out low, which is exactly how 44 cartons were
   * recorded as 4 on 23 Aug 2026.
   *
   * So the gateway measures it and says so. The shortest level it has actually
   * observed, in milliseconds and in samples, is the number that decides whether
   * a device's poll interval is fast enough — and it can only be known from the
   * plant floor, not from a design document.
   */
  private measurePulse(tag: CounterTag, prevRaw: number | boolean | null, raw: number | boolean | null): void {
    const level = raw === true || (typeof raw === 'number' && raw >= 1);
    const was = prevRaw === true || (typeof prevRaw === 'number' && prevRaw >= 1);
    const now = Date.now();

    let p = this.pulse.get(tag.id);
    if (!p) {
      this.pulse.set(tag.id, {
        since: now, samples: 1, minMs: Infinity, minSamples: Infinity, reportedAt: 0,
        firstAt: now, edges: 0, samplesSeen: 1, highSamples: level ? 1 : 0,
        highMs: 0, highRuns: 0, highOneSample: 0,
        lowMs: 0, lowRuns: 0, lowOneSample: 0,
        lastSampleAt: now, intervalSum: 0, intervalN: 0,
      });
      return;
    }

    p.samplesSeen += 1;
    if (level) p.highSamples += 1;
    if (now > p.lastSampleAt) { p.intervalSum += now - p.lastSampleAt; p.intervalN += 1; }
    p.lastSampleAt = now;

    if (level === was) { p.samples += 1; return; }
    p.edges += 1;

    // The level just ended — record how long it lasted.
    const heldMs = now - p.since;
    if (p.samples < p.minSamples || (p.samples === p.minSamples && heldMs < p.minMs)) {
      p.minSamples = p.samples;
      p.minMs = heldMs;
    }
    // BOTH levels are recorded, and this is the correction the plant's own
    // capture forced. Detecting any edge means seeing the level before it and
    // the level after it, so the limit is whichever of the two is SHORTER —
    // not whichever happens to be "on".
    //
    // On a normally-closed sensor the resting state is HIGH and the event is a
    // brief LOW. Measuring only the high side graded 2958 ms of rest and called
    // a sensor healthy whose actual pulse was under one sample.
    if (was) {
      p.highMs += heldMs; p.highRuns += 1;
      if (p.samples <= 1) p.highOneSample += 1;
    } else {
      p.lowMs += heldMs; p.lowRuns += 1;
      if (p.samples <= 1) p.lowOneSample += 1;
    }
    p.since = now;
    p.samples = 1;

    if (p.minSamples <= CounterService.ALIAS_SAMPLES && now - p.reportedAt > 60_000) {
      p.reportedAt = now;
      this.logger.warn(aliasingWarning(tag.id, p.minSamples, p.minMs));
    }
  }

  /**
   * Write what {@link observe} counted. Called on a timer, not on the poll.
   *
   * The gate that used to run per pulse — is a job order executing, is the
   * machine running — runs ONCE PER MACHINE here, from a short-lived cache. It
   * is the same rule: an edge is only credited to a job order that exists and a
   * machine that is running. What changed is how often the question is asked.
   *
   * A machine that stopped between the pulse and the flush keeps its count: the
   * pulse is evidence a unit was made, and the state signal arriving a second
   * later does not unmake it.
   */
  async flush(): Promise<CountEvent[]> {
    if (this.pending.size === 0 && !this.dirty) return [];
    // One writer at a time. A flush that overruns its timer must not have a
    // second one start on top of it and write the same delta twice.
    if (this.writing) return [];
    this.writing = true;
    try {
      return await this.writeBatch();
    } finally {
      this.writing = false;
    }
  }

  /**
   * ── STAGE 1 · SNAPSHOT ────────────────────────────────────────────────────
   * Take everything the accumulator has, synchronously, and let it keep going.
   */
  private async writeBatch(): Promise<CountEvent[]> {
    const ids = [...this.pending];
    this.pending.clear();

    const work: Array<{ tag: CounterTag; mem: CounterMem; accumulated: number }> = [];
    const machineIds = new Set<string>();
    for (const id of ids) {
      const tag = this.tags.get(id);
      const mem = this.cache.get(id);
      if (!tag || !mem || !tag.machineId) continue;
      // The accumulated value is read ONCE here. Edges arriving during the write
      // land on `mem.accumulated` and are picked up by the next batch — which is
      // why `synced` is set from this snapshot and not from the live value.
      work.push({ tag, mem, accumulated: mem.accumulated });
      machineIds.add(tag.machineId);
    }

    if (work.length === 0) {
      if (this.dirty) { this.saveLocal(); this.dirty = false; }
      return [];
    }

    // ── STAGE 2 · RESOLVE ───────────────────────────────────────────────────
    // Every machine's job order and status in ONE batched round-trip, however
    // many counters are pending.
    let ctx: Map<string, MachineWriteContext>;
    try {
      ctx = await this.machineContexts([...machineIds]);
    } catch {
      // Database unreachable. Counts stay in memory and on disk; the whole
      // backlog is re-queued so nothing is lost when the link returns.
      for (const id of ids) this.pending.add(id);
      if (this.dirty) { this.saveLocal(); this.dirty = false; }
      return [];
    }

    // ── STAGE 3 · COMPUTE ───────────────────────────────────────────────────
    // All arithmetic happens here, in memory, against the accumulators. This is
    // what removes the read-modify-write that used to sit between two counters
    // on one machine: the total and the good count are both known locally, so
    // deriving scrap never needs to ask the database what it just wrote.
    const plan = new Map<string, MachinePlan>();
    const committed: Array<{ mem: CounterMem; accumulated: number; tagId: string }> = [];

    for (const { tag, mem, accumulated } of work) {
      const machineId = tag.machineId!;
      const c = ctx.get(machineId);
      if (!c) continue;

      if (c.joId !== mem.jobOrderId) {
        if (mem.jobOrderId) {
          // A real handover: settle the old order's remainder before resetting.
          // Its plan is built against the OLD order id.
          const tail = accumulated - mem.synced;
          if (tail > 0) this.planFor(plan, machineId, mem.jobOrderId, c).add(tag, tail, accumulated);
          mem.accumulated = 0;
          mem.synced = 0;
          mem.jobOrderId = c.joId;
          this.dirty = true;
          continue;
        }
        // FIRST attribution — the counts are KEPT. Edges are taken before the
        // order behind them is resolved, so pulses accumulate against a null
        // order between startup and the first flush. Treating that as a
        // handover threw away every count from the first seconds of a shift.
        mem.jobOrderId = c.joId;
      }

      // ── Pulses with no order behind them ──────────────────────────────
      // `joId` is only ever an EXECUTING order, so this branch means the plant
      // was not running anything. Those pulses belong to NO order, and the
      // backlog is dropped rather than carried.
      //
      // Carrying it is what produced the jumps of 25-26 Aug 2026. The line sat
      // with nothing executing from 13:30 until 05:54 the next morning while
      // `accumulated` went on climbing; the moment an order started, sixteen
      // hours of pulses flushed as ONE delta, and the writer booked all of it
      // into the single minute it landed in: 1260 pieces on M1, 2100 on M2
      // (in a minute recorded as STARVED), 960 on M4. The plant saw its counts
      // "jump by 500" and had to correct four job orders by hand.
      //
      // Dropped counts are recorded, not silently swallowed — a counter that
      // turns while nothing is scheduled is itself worth knowing about.
      if (!c.joId) {
        const orphaned = accumulated - mem.synced;
        if (orphaned > 0) {
          mem.synced = accumulated;
          this.dirty = true;
          this.orphaned.set(tag.id, (this.orphaned.get(tag.id) ?? 0) + orphaned);
        }
        continue;
      }

      // ── Pulses while the machine is not running ───────────────────────
      // DROPPED, exactly like the no-order case above, and for the same
      // reason: the danger is never the pulse, it is the BACKLOG.
      //
      // An earlier version of this gate read `|| !c.running` and simply
      // `continue`d, leaving `synced` where it was. That HELD the counts
      // instead of discarding them, and the moment the machine was agreed to
      // be RUNNING the whole backlog flushed as one delta into one minute.
      // That is the 25-26 Aug shape, and it is still measurable in this
      // plant's data: single minutes carrying 2,986 pieces on M1 and 9,424 on
      // M2 against ceilings of 46 and 43.
      //
      // So the gate returns, but with drop semantics. `synced` is advanced to
      // `accumulated`, which means the counter neither buffers nor counts
      // against itself while the machine stands still; it simply resumes when
      // the machine does. The dropped pulses are tallied and surfaced on the
      // health view, because a counter that turns while its machine is stopped
      // is itself the fault worth seeing.
      //
      // `running` is hardware-backed: the state engine derives it from each
      // machine's own RUN_MODE discrete input (M1 addr 2, M2 addr 3, M3 addr 4
      // on EDGECOUNTER01; M4 addr 5 on EDGE_COUNTER_M03), not from a guess.
      if (!c.running) {
        const stopped = accumulated - mem.synced;
        if (stopped > 0) {
          mem.synced = accumulated;
          this.dirty = true;
          this.stoppedCounts.set(tag.id, (this.stoppedCounts.get(tag.id) ?? 0) + stopped);
        }
        continue;
      }

      const delta = accumulated - mem.synced;
      if (delta <= 0) continue;

      this.planFor(plan, machineId, c.joId, c).add(tag, delta, accumulated);
      committed.push({ mem, accumulated, tagId: tag.id });
    }

    if (plan.size === 0) {
      if (this.dirty) { this.saveLocal(); this.dirty = false; }
      return [];
    }

    // Standing totals per machine, from every counter it owns. See
    // {@link MachinePlan.stampAccumulators} for why this cannot come from the batch.
    for (const m of plan.values()) {
      let goodAcc: number | null = null;
      let totalAcc: number | null = null;
      for (const [tagId, t] of this.tags) {
        if (t.machineId !== m.machineId) continue;
        const mem = this.cache.get(tagId);
        if (!mem || mem.jobOrderId !== m.jobOrderId) continue;
        if (t.counterRole === 'GOOD') goodAcc = (goodAcc ?? 0) + mem.accumulated;
        else if (t.counterRole === 'TOTAL') totalAcc = (totalAcc ?? 0) + mem.accumulated;
      }
      m.stampAccumulators(goodAcc, totalAcc);
    }

    // ── STAGE 4 · WRITE ─────────────────────────────────────────────────────
    // One transaction for the whole batch. Ten counted units on four machines
    // used to be forty-odd sequential round-trips across the plant's link;
    // they are now a single one, and the accumulator never waited for any of it.
    const ops: any[] = [];
    const events: CountEvent[] = [];

    for (const m of plan.values()) {
      // ── The minute's balance ─────────────────────────────────────────────
      // Applied BEFORE anything else reads these deltas, so the derived scrap,
      // the job-order write, the live tile and the published event all describe
      // the same minute. Trimming after any one of them had been built would
      // put two different accounts of one minute into the system, which is the
      // exact failure this whole effort exists to remove.
      const ctxM = ctx.get(m.machineId);
      const room = this.roomLeftThisMinute(m.machineId, ctxM?.designPerMin ?? null);
      if (room >= 0) {
        const bal = balanceMinute(m.goodDelta, m.scrapDelta, room);
        if (bal.trimmedGood > 0 || bal.trimmedBad > 0) {
          const t = this.minuteTally.get(m.machineId)!;
          t.trimmedGood += bal.trimmedGood;
          t.trimmedBad += bal.trimmedBad;
          const now = Date.now();
          if (now - t.warnedAt > 60_000) {
            t.warnedAt = now;
            // Named, not buried. A plant that cannot see the trim cannot tell a
            // sensor that has been fixed from a cap that is hiding it.
            this.logger.warn(
              `machine ${m.machineId}: minute over its cap — trimmed `
              + `${bal.trimmedBad} reject(s) and ${bal.trimmedGood} good. `
              + 'Rejects are taken first. If this persists, the counter is still '
              + 'over-counting: tighten the debounce rather than the tolerance.',
            );
          }
        }
        m.goodDelta = bal.good;
        m.scrapDelta = bal.bad;
        const t = this.minuteTally.get(m.machineId)!;
        const emitted = bal.good + bal.bad;
        t.emitted += emitted;
        // The same figure into the rolling window, so the sustained-rate cap
        // sees what was ACTUALLY booked rather than what was offered. Counting
        // the offer would let a trimmed minute eat the next minute's room.
        const minute = Math.floor(Date.now() / 60_000);
        const w = this.windowFor(m.machineId, minute);
        w.set(minute, (w.get(minute) ?? 0) + emitted);
      }

      // A machine with a TOTAL counter and NO good counter knows how much it
      // made and nothing about how much of it was good. Deriving scrap as
      // `total - good` there reads the absent good counter as zero and books
      // the whole run as rejected — so the total is credited as production,
      // which is the only reading of it that is not simply false. Decided
      // BEFORE the payload below is built, since it changes what goes in it.
      if (m.totalAcc !== null && m.goodAcc === null) m.goodDelta += m.totalDelta;

      const joData: Record<string, unknown> = {};
      if (m.goodDelta > 0) joData.actualQtyGood = { increment: m.goodDelta };
      if (m.scrapDelta > 0) joData.actualQtyRejected = { increment: m.scrapDelta };

      // A TOTAL counter carries no scrap of its own: scrap is what the total saw
      // and the good counter did not. Both numbers are accumulators held here,
      // so this is a subtraction rather than a query — and it can no longer
      // race the good counter's own write.
      if (m.totalAcc !== null && m.goodAcc !== null) {
        const derived = deriveRejects(m.totalAcc, m.goodAcc, m.manualBad);
        // Good above total is arithmetically impossible — a machine cannot pass
        // more units than it made. The clamp inside `deriveRejects` keeps the
        // write sane; without this warning it also makes the fault INVISIBLE,
        // and the operator is left unable to correct a figure that every flush
        // resets to zero.
        if (derived.impossible) {
          const now = Date.now();
          if (now - (this.goodOverTotalAt.get(m.machineId) ?? 0) > 10 * 60_000) {
            this.goodOverTotalAt.set(m.machineId, now);
            this.logger.warn(
              `machine ${m.machineId}: good counter reads ${m.goodAcc} but total reads `
              + `${m.totalAcc} — good cannot exceed total. Derived rejects are pinned `
              + 'at zero until this is fixed, and no manual correction to the rejected '
              + 'figure will hold. The two inputs are miscounting independently.',
            );
          }
        }
        const autoBad = Math.max(0, m.totalAcc - m.goodAcc);
        // Absolute, because it is DERIVED rather than counted — plus whatever
        // the operator entered by hand, which a sensor must never overwrite.
        joData.actualQtyRejected = derived.rejected;
        m.scrapAbsolute = derived.rejected;
      }

      if (Object.keys(joData).length) {
        ops.push(this.prisma.jobOrder.update({ where: { id: m.jobOrderId }, data: joData as any }));
      }

      const statusData: Record<string, unknown> = { lastEventAt: new Date() };
      if (m.goodDelta > 0) statusData.goodCount = { increment: m.goodDelta };
      if (m.totalAcc !== null && m.goodAcc !== null) statusData.rejectCount = Math.max(0, m.totalAcc - m.goodAcc);
      else if (m.scrapDelta > 0) statusData.rejectCount = { increment: m.scrapDelta };

      ops.push(this.prisma.machineCurrentStatus.upsert({
        where: { machineId: m.machineId },
        create: {
          machineId: m.machineId, state: 'RUNNING', lastEventAt: new Date(),
          goodCount: m.goodDelta, rejectCount: m.totalAcc !== null ? Math.max(0, m.totalAcc - (m.goodAcc ?? 0)) : m.scrapDelta,
        } as any,
        update: statusData as any,
      }));

      events.push({
        jobOrderId: m.jobOrderId,
        machineId: m.machineId,
        role: m.lastRole,
        good: m.priorGood + m.goodDelta,
        rejected: m.scrapAbsolute ?? (m.priorScrap + m.scrapDelta),
        total: (m.priorGood + m.goodDelta) + (m.scrapAbsolute ?? (m.priorScrap + m.scrapDelta)),
        goodDelta: m.goodDelta,
        scrapDelta: m.scrapAbsolute !== null ? Math.max(0, m.scrapAbsolute - m.priorScrap) : m.scrapDelta,
        ts: new Date().toISOString(),
      });
    }

    // The gateway's own counter state rides along in the same transaction, so
    // "what was written to the job order" and "how far this counter has been
    // written" can never disagree after a crash between two statements.
    for (const { mem, accumulated, tagId } of committed) {
      const raw = typeof mem.lastRaw === 'boolean' ? (mem.lastRaw ? 1 : 0) : mem.lastRaw;
      const row = { lastRawValue: raw, accumulated, jobOrderId: mem.jobOrderId, lastEdgeAt: new Date() };
      ops.push(this.prisma.gatewayCounterState.upsert({
        where: { tagId }, create: { tagId, ...row } as any, update: row as any,
      }));
    }

    try {
      await this.prisma.$transaction(ops);
    } catch (err) {
      // The batch did not land. Nothing is marked synced, so every delta in it
      // is re-offered on the next pass rather than silently lost.
      for (const id of ids) this.pending.add(id);
      this.logger.error(`counter batch of ${ops.length} write(s) failed`, err as Error);
      if (this.dirty) { this.saveLocal(); this.dirty = false; }
      return [];
    }

    // ── STAGE 5 · COMMIT ────────────────────────────────────────────────────
    for (const { mem, accumulated } of committed) mem.synced = accumulated;
    this.dirty = true;
    this.saveLocal();
    this.dirty = false;
    return events;
  }

  /** The per-machine accumulator this batch is building. */
  private planFor(
    plan: Map<string, MachinePlan>, machineId: string, jobOrderId: string, c: MachineWriteContext,
  ): MachinePlan {
    const key = `${machineId}:${jobOrderId}`;
    let m = plan.get(key);
    if (!m) {
      m = new MachinePlan(machineId, jobOrderId, c);
      plan.set(key, m);
    }
    return m;
  }

  /**
   * Job order, running state and manual quantities for MANY machines at once.
   *
   * This used to be two queries per machine per flush, each a round-trip across
   * the plant's internet link. It is now two queries for the whole batch, sent
   * together — so adding a fifth counter to the line costs nothing.
   */
  private async machineContexts(machineIds: string[]): Promise<Map<string, MachineWriteContext>> {
    const [jos, statuses] = await this.prisma.$transaction([
      this.prisma.jobOrder.findMany({
        where: { machineId: { in: machineIds }, status: 'EXECUTING' },
        orderBy: { actualStart: 'desc' },
        select: {
          id: true, machineId: true,
          actualQtyGood: true, actualQtyRejected: true,
          manualQtyGood: true, manualQtyRejected: true,
          // The cap's basis. Per OUTPUT unit, which is the same unit the counter
          // counts in — so a cartoner is capped in cartons and a filler in
          // sachets, with no conversion and no chance of one creeping in.
          idealCycleTimeSec: true,
        },
      }),
      this.prisma.machineCurrentStatus.findMany({
        where: { machineId: { in: machineIds } },
        select: { machineId: true, state: true, goodCount: true },
      }),
    ]);

    const joByMachine = new Map<string, (typeof jos)[number]>();
    for (const jo of jos) {
      if (jo.machineId && !joByMachine.has(jo.machineId)) joByMachine.set(jo.machineId, jo);
    }
    const stateByMachine = new Map(statuses.map((s) => [s.machineId, s]));

    const out = new Map<string, MachineWriteContext>();
    for (const machineId of machineIds) {
      const jo = joByMachine.get(machineId) ?? null;
      const st = stateByMachine.get(machineId);
      out.set(machineId, {
        joId: jo?.id ?? null,
        // Unknown state counts as running: a pulse arrived, so something is.
        running: !st?.state || st.state === 'RUNNING',
        priorGood: jo?.actualQtyGood ?? 0,
        priorScrap: jo?.actualQtyRejected ?? 0,
        manualGood: jo?.manualQtyGood ?? 0,
        manualBad: jo?.manualQtyRejected ?? 0,
        designPerMin: jo?.idealCycleTimeSec && jo.idealCycleTimeSec > 0
          ? 60 / jo.idealCycleTimeSec
          : null,
      });
    }
    return out;
  }

  /**
   * Job order + running state for a machine, cached briefly.
   *
   * Asked once per machine per flush instead of twice per counter per poll. The
   * TTL is short enough that a job order released now is credited within a
   * second, and long enough that two counters on one machine share the answer.
   */
  private async machineContext(machineId: string) {
    const hit = this.ctxCache.get(machineId);
    if (hit && Date.now() - hit.at < CounterService.CTX_TTL_MS) return hit.value;

    const jo = await this.prisma.jobOrder.findFirst({
      where: { machineId, status: 'EXECUTING' },
      orderBy: { actualStart: 'desc' },
      select: { id: true },
    });
    const status = await this.prisma.machineCurrentStatus
      .findUnique({ where: { machineId }, select: { state: true } })
      .catch(() => null);

    const value = {
      joId: jo?.id ?? null,
      // Unknown state counts as running: a pulse arrived, so something is.
      running: !status?.state || status.state === 'RUNNING',
      dbUp: true,
    };
    this.ctxCache.set(machineId, { at: Date.now(), value });
    return value;
  }

  /**
   * Process one counter reading. Returns a CountEvent when an edge was applied
   * to a running Job Order (for MQTT publish / API roll-up), else null.
   */
  async process(tag: CounterTag, raw: number | boolean | null, ts: string): Promise<CountEvent | null> {
    if (!tag.machineId || !tag.counterRole || tag.counterRole === 'NONE') return null;

    const mem = await this.load(tag.id);
    const inc = detectEdge(mem.lastRaw, raw, tag.edgeType);
    mem.lastRaw = raw; // always advance the raw snapshot (no backlog jump on resume)

    // Resolve the machine's currently executing Job Order. A THROW here means the DB
    // is unreachable (outage) — distinct from a successful query that returns no JO.
    let dbUp = true;
    let jo: { id: string; actualQtyGood: number; actualQtyRejected: number } | null = null;
    try {
      jo = await this.prisma.jobOrder.findFirst({
        where: { machineId: tag.machineId, status: 'EXECUTING' },
        orderBy: { actualStart: 'desc' },
        select: { id: true, actualQtyGood: true, actualQtyRejected: true },
      });
    } catch {
      dbUp = false; // Postgres down → keep counting locally, sync on reconnect.
    }

    // Machine RUNNING gate — only enforceable when the DB is up. During an outage
    // the state is unknown, so we keep counting (a producing machine is running).
    let notRunning = false;
    if (dbUp) {
      const status = await this.prisma.machineCurrentStatus
        .findUnique({ where: { machineId: tag.machineId }, select: { state: true } })
        .catch(() => null);
      notRunning = !!status?.state && status.state !== 'RUNNING';
    }

    let changed = false;

    // Job-order transition (only when the DB is up so we don't mistake an outage for
    // a JO ending). Flush any unsynced delta to the OLD JO before switching.
    if (dbUp) {
      const newJoId = jo?.id ?? null;
      if (newJoId !== mem.jobOrderId) {
        if (mem.jobOrderId && mem.accumulated > mem.synced) {
          await this.applyToJob(tag, mem.jobOrderId, mem.accumulated, mem.accumulated - mem.synced, ts).catch(() => undefined);
        }
        mem.jobOrderId = newJoId;
        mem.accumulated = 0;
        mem.synced = 0;
        changed = true;
      }
    }

    // Count the edge locally. This is the key change: it happens whether or not the
    // DB is reachable, so no pulse is lost during an outage.
    if (inc > 0 && !(dbUp && notRunning)) {
      mem.accumulated += inc;
      changed = true;
    }

    // Persist locally on any change so counts survive an outage + restart.
    if (changed) this.saveLocal();

    // Flush the pending delta to the JO whenever the DB is reachable — this catches
    // up the whole backlog on reconnect, even on a poll with no new edge.
    let event: CountEvent | null = null;
    if (dbUp && mem.jobOrderId && !notRunning && mem.accumulated > mem.synced) {
      const delta = mem.accumulated - mem.synced;
      event = await this.applyToJob(tag, mem.jobOrderId, mem.accumulated, delta, ts);
      mem.synced = mem.accumulated; // only advance after a successful write (no double-count)
      this.saveLocal();
      await this.persistDb(tag.id, mem, ts);
    }
    return event;
  }

  private async applyToJob(
    tag: CounterTag,
    jobOrderId: string,
    total: number,
    inc: number,
    ts: string,
  ): Promise<CountEvent> {
    const role = tag.counterRole as CounterRole;
    let goodDelta = 0;
    let scrapDelta = 0;

    if (role === 'GOOD') {
      await this.prisma.jobOrder.update({ where: { id: jobOrderId }, data: { actualQtyGood: { increment: inc } } });
      await this.bumpStatus(tag.machineId!, { goodCount: { increment: inc } });
      goodDelta = inc;
    } else if (role === 'BAD') {
      await this.prisma.jobOrder.update({ where: { id: jobOrderId }, data: { actualQtyRejected: { increment: inc } } });
      await this.bumpStatus(tag.machineId!, { rejectCount: { increment: inc } });
      scrapDelta = inc;
    } else if (role === 'TOTAL') {
      const fresh = await this.prisma.jobOrder.findUnique({
        where: { id: jobOrderId },
        select: { actualQtyGood: true, actualQtyRejected: true, manualQtyGood: true, manualQtyRejected: true },
      });
      const good = fresh?.actualQtyGood ?? 0;
      const prevRejected = fresh?.actualQtyRejected ?? 0;
      const manualGood = fresh?.manualQtyGood ?? 0;
      const manualBad = fresh?.manualQtyRejected ?? 0;
      // Derive the AUTO bad from the sensed total minus AUTO good, then add the
      // operator-entered scrap back — so the counter NEVER overwrites manual scrap.
      const autoGood = Math.max(0, good - manualGood);
      const autoBad = Math.max(0, total - autoGood);
      const bad = autoBad + manualBad;
      scrapDelta = Math.max(0, bad - prevRejected);
      await this.prisma.jobOrder.update({ where: { id: jobOrderId }, data: { actualQtyRejected: bad } });
      const status = await this.prisma.machineCurrentStatus.findUnique({
        where: { machineId: tag.machineId! }, select: { goodCount: true },
      }).catch(() => null);
      await this.bumpStatus(tag.machineId!, { rejectCount: Math.max(0, total - (status?.goodCount ?? 0)) });
    }

    const jo = await this.prisma.jobOrder.findUnique({
      where: { id: jobOrderId }, select: { actualQtyGood: true, actualQtyRejected: true },
    });
    const good = jo?.actualQtyGood ?? 0;
    const rejected = jo?.actualQtyRejected ?? 0;
    return { jobOrderId, machineId: tag.machineId!, role, good, rejected, total: good + rejected, goodDelta, scrapDelta, ts };
  }

  /** Upsert MachineCurrentStatus, supporting both increment ops and absolute sets. */
  private async bumpStatus(machineId: string, data: Record<string, unknown>): Promise<void> {
    const createDefaults: Record<string, number> = { goodCount: 0, rejectCount: 0 };
    for (const [k, v] of Object.entries(data)) {
      createDefaults[k] = typeof v === 'object' && v && 'increment' in (v as any) ? (v as any).increment : (v as number);
    }
    await this.prisma.machineCurrentStatus
      .upsert({
        where: { machineId },
        create: { machineId, state: 'RUNNING', lastEventAt: new Date(), ...createDefaults } as any,
        update: { ...data, lastEventAt: new Date() } as any,
      })
      .catch((err) => this.logger.error(`Status update failed (${machineId})`, err as Error));
  }
}
