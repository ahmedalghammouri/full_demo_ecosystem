import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Why a machine stopped — Starved, Blocked, or genuinely broken.
 *
 * ── The case I360's plant actually presents ──────────────────────────────────
 * The obvious design — "a starved machine stops, so classify its stop" — does not
 * work here, and I360's own signal document says why. For Carton Packer and Uni-Tech:
 *
 *   ON: running/ready, INCLUDING the condition where the machine is ready
 *       but no product is currently being processed
 *
 * A starved machine on this line never looks stopped. Its Run Mode signal stays
 * ON while it waits. Waiting for a stop to appear would mean this never fires.
 *
 * I360 supplied the second signal that makes it detectable — the Uni-Tech wrapping
 * table's rotation, which "indicates that a pallet is being processed". Run Mode
 * says the machine is ABLE to work; the table says whether it IS working.
 *
 *   Run ON  + processing        → RUNNING
 *   Run ON  + NOT processing    → STARVED / BLOCKED   (ready, nothing to do)
 *   Run OFF                     → BREAKDOWN           (alarm / emergency stop)
 *
 * ── Direction ───────────────────────────────────────────────────────────────
 * Material flows along the line in `sortOrder`. Nothing arriving from upstream is
 * starvation; nowhere to discharge downstream is blockage. A machine at the head
 * of the line cannot be starved and one at the end cannot be blocked, so those
 * are never inferred.
 *
 * A neighbour's stop only counts as a cause if it is not itself a symptom. A
 * STARVED machine downstream is waiting for product, not refusing it; a BLOCKED
 * machine upstream has product and cannot pass it on. Reading either as a cause
 * inverts the line and hides the real constraint — see notFeeding / notAccepting.
 *
 * ── Precedence ──────────────────────────────────────────────────────────────
 *   1. An explicit STARVED/BLOCKED from the machine itself — never overruled.
 *   2. A bound signal (PROCESSING / INFEED_AVAILABLE / OUTFEED_BLOCKED).
 *      A measurement beats a guess.
 *   3. Inference from neighbouring machine states.
 *
 * Deliberately conservative. Every uncertain path returns the raw state: no
 * PROCESSING signal, no reading, a reading the gateway flagged BAD, or an idle
 * period short enough to be the normal gap between units all leave the machine
 * as it was. Over-reporting starvation is worse than under-reporting it, because
 * it moves real losses out of the machine's OEE and flatters the equipment.
 *
 * These states are excluded from Availability and Performance loss — see
 * EXTERNAL_STATES in the API's kpi.service — which is exactly what I360 asked for:
 * the palletiser and wrapper judged only when product is available to process.
 */

/** States that mean "not currently producing". */
const NOT_PRODUCING = new Set([
  'IDLE', 'STOPPED', 'BREAKDOWN', 'PLANNED_STOP', 'SETUP',
  'CHANGEOVER', 'STARTUP', 'MAINTENANCE', 'OFFLINE', 'STARVED', 'BLOCKED',
]);

/**
 * Stops that carry no explanation, and so are open to inference. BREAKDOWN is
 * included because that is what a bare "run signal went false" produces — it is a
 * default, not a diagnosis. SETUP, CHANGEOVER, STARTUP, PLANNED_STOP and
 * MAINTENANCE are NOT included: somebody has already said what those are, and
 * overwriting a declared state with an inferred one loses the only account
 * that came from a person.
 *
 * A whitelist rather than a blocklist, deliberately — a state added to the
 * system later is protected from inference by default, which is the safe way
 * round. STARTUP arrived this way and needed no change here.
 */
const UNEXPLAINED_STOPS = new Set(['IDLE', 'STOPPED', 'BREAKDOWN']);

/**
 * States that mean the machine is up and working, for the purposes of the truth
 * table. RUNNING only: SETUP and CHANGEOVER are work but not output, and a
 * machine in either is not feeding the one after it.
 */
const PRODUCING_RAW = new Set(['RUNNING']);

/** Signal semantics, validated here rather than in the schema. */
const PROCESSING = 'PROCESSING';
const INFEED_AVAILABLE = 'INFEED_AVAILABLE';
const OUTFEED_BLOCKED = 'OUTFEED_BLOCKED';

/**
 * How long a PROCESSING signal must stay inactive before the machine counts as
 * starved rather than merely between units.
 *
 * The wrapping table rotates once per pallet. At the line's pace a pallet arrives
 * every few minutes, so the table is legitimately still for long stretches during
 * normal running. Too short a threshold reports starvation between every pallet;
 * too long and a real stoppage goes unrecorded. Configurable because the right
 * value is the plant's slowest normal cycle, which only the plant knows.
 */
const PROCESSING_IDLE_DEFAULT_MS = 5 * 60_000;

export interface LineNeighbours {
  upstream: string[];
  downstream: string[];
}

@Injectable()
export class StateInferenceService {
  private readonly logger = new Logger(StateInferenceService.name);

  /** Line topology, cached briefly — machines do not move during a shift. */
  private topologyCache = new Map<string, { at: number; value: LineNeighbours }>();
  private static readonly TOPOLOGY_TTL_MS = 60_000;

  /**
   * A PAUSED order still counts as work scheduled: the machine is mid-job and
   * whatever stopped it is a real stop on a real order, not an idle plant.
   */
  private workCache = new Map<string, { at: number; value: boolean }>();
  private static readonly WORK_TTL_MS = 15_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Classify a stop. Returns the state to record — either the original, or
   * STARVED / BLOCKED when the context explains it.
   */
  async classify(machineId: string, rawState: string): Promise<string> {
    /**
     * Rule 0 — no job order, no verdict.
     *
     * A machine with nothing scheduled on it is not RUNNING, not STARVED and
     * not BROKEN: it is IDLE, and none of its tags are worth reading to decide
     * that. Run Mode being on at a machine with no work says the panel is
     * powered, not that the line is producing; Run Mode being off says it was
     * switched off, not that it failed.
     *
     * Inferring anything else here manufactures downtime out of an idle plant.
     * Counting is already gated the same way — the counter only applies an edge
     * when it has a job order to apply it TO — and the OEE writer never emits a
     * minute for a machine with no step running. So this closes the last place
     * where an unscheduled machine could still assert something about itself.
     *
     * The elapsed time is not lost: it is exactly what the Energy module
     * measures, and standby consumption on an idle machine is a real cost that
     * OEE has nothing to say about.
     */
    if (!(await this.hasWorkScheduled(machineId))) return 'IDLE';

    // Rule 1 — the machine said why itself. A status word that reports STARVED or
    // BLOCKED outright is a measurement, and nothing inferred may overrule it.
    if (rawState === 'STARVED' || rawState === 'BLOCKED') return rawState;

    // ...and neither is a stop that already carries an explanation. A CHANGEOVER,
    // SETUP, PLANNED_STOP or MAINTENANCE is a decision somebody made, not a
    // symptom to be diagnosed. Reclassifying one as starvation would move a
    // PLANNED stop into an EXTERNAL loss and change what OEE excludes — the table
    // below governs states derived from Run Mode, not states that speak for
    // themselves.
    if (!UNEXPLAINED_STOPS.has(rawState) && !PRODUCING_RAW.has(rawState)) return rawState;

    try {
      // Rule 2 — a bound material signal. INFEED_AVAILABLE and OUTFEED_BLOCKED
      // measure the thing the table below infers, so where one exists it wins.
      const fromSignal = await this.fromMaterialSignals(machineId);
      if (fromSignal) return fromSignal;

      // Rule 3 — why is this machine not producing?
      //
      //   RUN  PROC   cause                    state
      //   ───  ────   ──────────────────────   ──────────
      //    1     1    —                        RUNNING
      //    1     0    nothing arriving         STARVED
      //    1     0    cannot discharge         BLOCKED
      //    0    0/1   nothing arriving         STARVED
      //    0    0/1   cannot discharge         BLOCKED
      //    0    0/1   neither                  BREAKDOWN
      //
      // STARVED and BLOCKED name WHERE the cause is, and the two point in opposite
      // directions along the line:
      //
      //   STARVED  nothing is arriving  → the machine BEFORE  (upstream)
      //   BLOCKED  nowhere to discharge → the machine AFTER   (downstream)
      //
      // So each is asked of its own side. An earlier version inferred BLOCKED
      // from "the machine before is running" — arguing that if material arrives
      // and is not consumed, something ahead must be holding it. That is a proxy,
      // not the thing itself: a machine can be fed, idle, and simply faulty, and
      // the proxy would file its breakdown as an external loss.
      //
      // Upstream is asked first. When nothing is arriving AND nothing can be
      // discharged, the true constraint is the one starving the line — that is
      // where a fix has to go.
      const running = PRODUCING_RAW.has(rawState);
      const processing = await this.processingNow(machineId);

      if (running && processing === true) return 'RUNNING';

      // ── STARVED and BLOCKED need evidence AT THIS MACHINE ──────────────────
      // Either the machine stopped (Run Mode off) or its process stopped
      // (PROCESSING inactive past the gap between units). A neighbour's state
      // alone is never enough, and may not overrule a machine whose own signals
      // say it is working.
      //
      // This was briefly implemented the other way — a stopped feeder inferred
      // starvation for a machine with no PROCESSING signal — and the line
      // disproved it within the hour. Powder Filler went down and the cartoner and
      // palletiser were immediately reported STARVED, while the wrapper's table
      // was still rotating. A rotating table means a pallet was being wrapped,
      // which means the palletiser had just delivered one, which means the
      // cartoner had fed it: the two machines called starved were demonstrably
      // working, and the machine after them was consuming their output.
      //
      // The flaw is that a stopped feeder does not mean nothing is arriving. A
      // line has product between its stations, and the cartoner keeps working
      // through what is in front of it long after the filler stops — Powder Filler
      // had been down one minute. Starvation arrives when the buffer drains, at
      // a delay the topology cannot know. Only the machine itself can report it.
      //
      // So with no PROCESSING signal there is nothing to report, and the machine
      // is left as it reported itself. That is a real gap for M3 and M4 — their
      // starvation is invisible until a PROCESSING signal is bound to them — but
      // an invisible loss is better than a fabricated one charged to the wrong
      // machine at the wrong moment.
      if (running && processing === null) return rawState;

      // Ready-but-idle and stopped ask the same question, so they share the
      // answer: what, outside this machine, would explain it producing nothing?
      const { upstream, downstream } = await this.neighbours(machineId);

      // The IMMEDIATE neighbour on each side, not every machine on that side.
      // This is a serial line: material reaches you through the station directly
      // before you, so if that one is down you starve whether or not the filler
      // three places back is running — it is simply backing up behind the gap.
      // Requiring ALL of them to be stopped missed every single-station failure,
      // which is the common case.
      const feeder = upstream.length > 0 ? [upstream[upstream.length - 1]] : [];
      const receiver = downstream.length > 0 ? [downstream[0]] : [];

      // A line end has no neighbour on that side: the first machine can never be
      // starved by an upstream that does not exist, nor the last one blocked by a
      // missing downstream.
      if (feeder.length > 0 && (await this.notFeeding(feeder))) return 'STARVED';
      if (receiver.length > 0 && (await this.notAccepting(receiver))) return 'BLOCKED';

      // ── Ready, and not processing: it is WAITING ───────────────────────────
      // Its own process signal says no product is moving through it, and its Run
      // Mode says it is able to work. A machine in that condition is not at
      // fault, it is waiting for something to arrive — and on a serial line the
      // only thing to wait for is the station in front.
      //
      // The neighbour checks above did not explain it, but they only see whether
      // a neighbour is STOPPED. A feeder that is running slower than this machine
      // starves it just as surely: the wrapper takes 115 s a pallet and the
      // palletiser 255 s, so the wrapper waits over two minutes of every cycle
      // with the whole line reporting healthy. That gap is invisible to topology
      // and plain in the machine's own signal.
      //
      // The head of the line is the one place this cannot be true — nothing feeds
      // it, so it cannot be waiting on anything.
      if (running && upstream.length > 0) return 'STARVED';

      // A machine that actually STOPPED, with work arriving and somewhere to send
      // it, stopped for its own reasons. That is a breakdown and it stays one:
      // this branch is reached only when Run Mode itself went off.
      return rawState;
    } catch (err) {
      // Inference is an enrichment. If it fails, record the honest raw state
      // rather than losing the stop entirely.
      this.logger.warn(`state inference failed for machine ${machineId}: ${(err as Error).message}`);
      return rawState;
    }
  }

  /**
   * Is the PROCESSING signal active right now?
   *
   * `true` product is moving · `false` it is not, and has not been for longer
   * than the gap between units · `null` there is no signal, no reading, or one
   * the gateway distrusts.
   *
   * Null is not false. A machine with nothing wired must not be declared starved
   * on the strength of silence — over-reporting starvation moves real losses out
   * of OEE and flatters the equipment.
   */
  /**
   * Is there a step running on this machine right now?
   *
   * ── ONE definition, and it used to be two ───────────────────────────────
   * This counted EXECUTING *and* PAUSED, while `StatusService.stoppedState`
   * counted only EXECUTING — two answers to one question, in two files.
   *
   * The plant saw it on 25 Aug 2026: all four job orders were PAUSED, M1's Run
   * Mode bit happened to drop so it took the other path and correctly read
   * IDLE, and M2/M3/M4 kept their bits high, took this path, were told there
   * was work, and went on inferring STARVED and BLOCKED. Four machines in the
   * same situation showing three different states, and neither rule was
   * reachable from the other to notice.
   *
   * EXECUTING is the right answer. A PAUSED order is a deliberate stop: the
   * machine is not being asked to produce, so it cannot be starved of material
   * for it or blocked from discharging it. Inferring either manufactures an
   * external loss out of a decision somebody made.
   *
   * This does NOT change the time model. `oee-standard.writer` still counts a
   * paused order's minutes, because a pause occupies the clock and must be
   * charged rather than vanish from the denominator. What changes is only what
   * the MACHINE is said to be doing during them — which is idle.
   *
   * Cached briefly: asked on every poll for every machine, and a job order does
   * not start and stop within a few seconds. Short enough that a machine goes
   * live within one cache window of its order being released.
   */
  async hasWorkScheduled(machineId: string): Promise<boolean> {
    const hit = this.workCache.get(machineId);
    if (hit && Date.now() - hit.at < StateInferenceService.WORK_TTL_MS) return hit.value;
    const count = await this.prisma.jobOrder.count({
      where: { machineId, status: 'EXECUTING' },
    });
    const value = count > 0;
    this.workCache.set(machineId, { at: Date.now(), value });
    return value;
  }

  private async processingNow(machineId: string): Promise<boolean | null> {
    const tag = await this.prisma.tagDefinition.findFirst({
      where: { machineId, isActive: true, signalRole: PROCESSING },
      select: { id: true, idleThresholdMs: true },
    });
    if (!tag) return null;

    const reading = await this.prisma.tagCurrentValue
      .findUnique({
        where: { tagId: tag.id },
        select: { value: true, quality: true, timestamp: true, lastActiveAt: true },
      })
      .catch(() => null);
    if (!reading || reading.quality === 'BAD') return null;

    if (Number(reading.value) >= 1) return true;

    // Off right now, but a wrapper rests between pallets and a filler does not.
    // Only a gap longer than that signal's own slowest normal cycle counts.
    //
    // Measured from when the signal was last ACTIVE, not from when its value was
    // last WRITTEN. The two agree while the gateway runs; they part company on a
    // restart, which writes every tag's first reading and so used to stamp a
    // signal dead for an hour as "just now" — reporting the machine RUNNING, and
    // crediting it with run time, for a full idle window after every restart.
    //
    // `timestamp` remains the fallback for a row written before this column
    // existed: that is the old behaviour, and it corrects itself the moment the
    // signal is next seen active.
    const since = reading.lastActiveAt ?? reading.timestamp;
    const idleFor = Date.now() - new Date(since).getTime();
    const limit = tag.idleThresholdMs ?? PROCESSING_IDLE_DEFAULT_MS;
    return idleFor < limit ? true : false;
  }


  /**
   * A material-flow signal bound to this machine, if one is configured.
   *
   * `INFEED_AVAILABLE` false while stopped means nothing is arriving → STARVED.
   * `OUTFEED_BLOCKED` true while stopped means it cannot discharge → BLOCKED.
   * Returns null when no such tag exists or it has no recent reading, so the
   * caller falls through to topology.
   */
  private async fromMaterialSignals(machineId: string): Promise<string | null> {
    const tags = await this.prisma.tagDefinition.findMany({
      where: { machineId, isActive: true, signalRole: { in: [INFEED_AVAILABLE, OUTFEED_BLOCKED] } },
      select: { id: true, signalRole: true },
    });
    if (tags.length === 0) return null;

    for (const tag of tags) {
      // TagCurrentValue holds the latest reading per tag — exactly what a live
      // classification needs, and one indexed lookup rather than a history scan.
      const reading = await this.prisma.tagCurrentValue
        .findUnique({ where: { tagId: tag.id }, select: { value: true, quality: true } })
        .catch(() => null);
      // A BAD-quality reading is worse than no reading: acting on it would
      // classify a stop from a sensor the gateway itself distrusts.
      if (!reading || reading.value == null || reading.quality === 'BAD') continue;

      const on = Number(reading.value) >= 1;
      if (tag.signalRole === INFEED_AVAILABLE && !on) return 'STARVED';
      if (tag.signalRole === OUTFEED_BLOCKED && on) return 'BLOCKED';
    }
    return null;
  }

  /** Machines before and after this one on its line, ordered by material flow. */
  private async neighbours(machineId: string): Promise<LineNeighbours> {
    const cached = this.topologyCache.get(machineId);
    if (cached && Date.now() - cached.at < StateInferenceService.TOPOLOGY_TTL_MS) return cached.value;

    const me = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, lineId: true, sortOrder: true },
    });

    const empty: LineNeighbours = { upstream: [], downstream: [] };
    // A machine outside any line has no material flow to reason about.
    if (!me?.lineId) {
      this.topologyCache.set(machineId, { at: Date.now(), value: empty });
      return empty;
    }

    const siblings = await this.prisma.machine.findMany({
      where: { lineId: me.lineId, isActive: true, archivedAt: null },
      select: { id: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    const value: LineNeighbours = {
      upstream: siblings.filter((s) => s.sortOrder < me.sortOrder).map((s) => s.id),
      downstream: siblings.filter((s) => s.sortOrder > me.sortOrder).map((s) => s.id),
    };
    this.topologyCache.set(machineId, { at: Date.now(), value });
    return value;
  }

  /**
   * True when NONE of these upstream machines is sending product down.
   *
   * "All", not "any": one upstream machine still running means material is still
   * arriving, so the stop downstream is not starvation.
   *
   * An upstream machine in BLOCKED is the exception, and it is not a detail. A
   * blocked machine is one that HAS product and cannot get rid of it — usually
   * because this machine stopped taking it. Counting it as "not feeding" would
   * blame the upstream for a jam this machine caused, then file the loss as
   * external and remove it from OEE. The machine would be rewarded for its own
   * blockage.
   */
  private async notFeeding(machineIds: string[]): Promise<boolean> {
    return this.allInactive(machineIds, 'BLOCKED');
  }

  /**
   * True when NONE of these downstream machines can take product.
   *
   * Mirror image of the above: a downstream machine in STARVED is WAITING for
   * product, which is the opposite of refusing it. It is the consequence of this
   * machine's stop, not its cause. Treating it as a blockage inverts the whole
   * line — the true starvation at the head of the line gets reported as a
   * blockage at every machine behind it, and the real constraint disappears.
   *
   * Found by live verification, not by the unit tests: with Filling stopped, the
   * palletiser was reported BLOCKED by the wrapper it had itself starved.
   */
  private async notAccepting(machineIds: string[]): Promise<boolean> {
    return this.allInactive(machineIds, 'STARVED');
  }

  /**
   * True when every one of these machines is stopped for a reason OTHER than
   * `excuse` — a state that proves the machine is a symptom rather than a cause.
   *
   * A machine with no status record yet is treated as producing: absence of
   * evidence is not evidence of a stop, and guessing the other way would invent
   * starvation across a fresh install.
   */
  private async allInactive(machineIds: string[], excuse: string): Promise<boolean> {
    const rows = await this.prisma.machineCurrentStatus.findMany({
      where: { machineId: { in: machineIds } },
      select: { machineId: true, state: true },
    });
    if (rows.length < machineIds.length) return false; // some machine unknown
    return rows.every((r) => {
      const state = String(r.state);
      return state !== excuse && NOT_PRODUCING.has(state);
    });
  }
}
