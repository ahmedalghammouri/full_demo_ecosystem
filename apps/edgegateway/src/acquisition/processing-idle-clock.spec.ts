import { IngestService } from './ingest.service';
import { StateInferenceService } from './state-inference.service';

/**
 * How long has this signal been still?
 *
 * Starvation detection turns on that one number, and it used to be computed from
 * `tagCurrentValue.timestamp` — which records when the value was last WRITTEN,
 * not when the signal was last ACTIVE. Under CHANGE publishing a write happens
 * only on a change, so the two agreed and every test passed.
 *
 * They part company on a gateway restart. The first reading of every tag is
 * written unconditionally, so a signal dead for an hour gets stamped "now", the
 * machine reads RUNNING, and it is credited with run time it did not do — for a
 * full idle window after every restart. Seen on the line on 19 Aug 2026, where
 * five tags across two devices all carried the same write timestamp to the
 * second.
 *
 * `lastActiveAt` is now its own column so the two questions cannot be confused.
 */
describe('the processing idle clock', () => {
  const HOUR_AGO = () => new Date(Date.now() - 60 * 60_000);
  const JUST_NOW = () => new Date();

  // ── What the inference reads ───────────────────────────────────────────────
  describe('StateInferenceService.processingNow', () => {
    /** M4 feeds M5; M5 is last on the line and so can never be BLOCKED. */
    const LINE = [{ id: 'm4', sortOrder: 4 }, { id: 'm5', sortOrder: 5 }];

    function build(reading: Record<string, unknown>, feederState = 'BREAKDOWN') {
      const states: Record<string, string> = { m4: feederState, m5: 'RUNNING' };
      const prisma: any = {
        /**

         * Rule 0 gates everything on there being work scheduled: a machine with

         * no job order is IDLE and its tags are not consulted. These cases are all

         * about a machine that IS working, so the mock says so — otherwise every

         * one of them would assert against IDLE and prove nothing about the table.

         */

        jobOrder: { count: jest.fn().mockResolvedValue(1) },

        machine: {
          findUnique: jest.fn(async ({ where }: any) => ({
            ...LINE.find((m) => m.id === where.id)!, lineId: 'L1',
          })),
          findMany: jest.fn().mockResolvedValue(LINE),
        },
        machineCurrentStatus: {
          findUnique: jest.fn(async ({ where }: any) =>
            states[where.machineId] ? { state: states[where.machineId] } : null),
          findMany: jest.fn(async ({ where }: any) =>
            (where.machineId.in as string[]).map((id) => ({ machineId: id, state: states[id] }))),
        },
        tagDefinition: {
          findFirst: jest.fn(async ({ where }: any) =>
            where?.signalRole === 'PROCESSING'
              ? { id: 'rot', idleThresholdMs: 5 * 60_000 }
              : null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        tagCurrentValue: { findUnique: jest.fn(async () => reading) },
      };
      return new StateInferenceService(prisma as never);
    }

    it('starves the wrapper when the table has been still past the threshold', async () => {
      const svc = build({ value: '0', quality: 'GOOD', timestamp: HOUR_AGO(), lastActiveAt: HOUR_AGO() });
      await expect(svc.classify('m5', 'RUNNING')).resolves.toBe('STARVED');
    });

    it('leaves it running while the table is merely between pallets', async () => {
      // Thirty seconds against a five-minute threshold: the wrapper rests between
      // pallets, and calling that starvation reports it every single cycle.
      const recent = new Date(Date.now() - 30_000);
      const svc = build({ value: '0', quality: 'GOOD', timestamp: recent, lastActiveAt: recent });
      await expect(svc.classify('m5', 'RUNNING')).resolves.toBe('RUNNING');
    });

    it('does not forget an hour of stillness because the gateway restarted', async () => {
      // THE test. The restart rewrote `timestamp` with an unchanged value, so the
      // old code measured the idle gap as milliseconds and reported RUNNING.
      // `lastActiveAt` is untouched by that write and still says an hour.
      const svc = build({ value: '0', quality: 'GOOD', timestamp: JUST_NOW(), lastActiveAt: HOUR_AGO() });
      await expect(svc.classify('m5', 'RUNNING')).resolves.toBe('STARVED');
    });

    it('falls back to the write timestamp on a row written before the column existed', async () => {
      // Existing rows have no lastActiveAt. Behaving as before beats reporting
      // every machine in the plant as never having produced.
      const svc = build({ value: '0', quality: 'GOOD', timestamp: HOUR_AGO(), lastActiveAt: null });
      await expect(svc.classify('m5', 'RUNNING')).resolves.toBe('STARVED');
    });

    it('reads an active signal as producing whatever the clock says', async () => {
      const svc = build({ value: '1', quality: 'GOOD', timestamp: HOUR_AGO(), lastActiveAt: HOUR_AGO() });
      await expect(svc.classify('m5', 'RUNNING')).resolves.toBe('RUNNING');
    });
  });

  // ── What keeps it honest ───────────────────────────────────────────────────
  describe('IngestService.writeCurrentValue', () => {
    function build(existing: { value: string; lastActiveAt: Date | null } | null) {
      const writes: any[] = [];
      const prisma: any = {
        tagCurrentValue: {
          findUnique: jest.fn(async () => existing),
          upsert: jest.fn(async ({ update }: any) => { writes.push(update); return update; }),
        },
      };
      const svc = new IngestService(
        prisma as never,
        { isEnabled: () => false } as never,
        { publish: () => true } as never,
        { enqueue: jest.fn() } as never,
      );
      const write = (numeric: number, ts: Date) => (svc as never as {
        writeCurrentValue(r: unknown): Promise<void>;
      }).writeCurrentValue({
        tagId: 'rot', factoryId: 'f1', code: 'M5_TABLE_ROTATION',
        value: String(numeric), numeric, quality: 'GOOD', timestamp: ts.toISOString(),
      });
      return { write, writes };
    }

    it('marks the moment the signal goes active', async () => {
      const { write, writes } = build({ value: '0', lastActiveAt: HOUR_AGO() });
      const now = JUST_NOW();
      await write(1, now);
      expect(writes[0].lastActiveAt).toEqual(now);
    });

    it('marks the falling edge — that is when idleness starts', async () => {
      // The signal was active right up to this reading, so this instant is the
      // last moment it was active. Carrying forward the moment it went HIGH would
      // report an hour of idleness the instant a long run ended.
      const { write, writes } = build({ value: '1', lastActiveAt: HOUR_AGO() });
      const now = JUST_NOW();
      await write(0, now);
      expect(writes[0].lastActiveAt).toEqual(now);
    });

    it('leaves it alone when an inactive value is rewritten unchanged', async () => {
      // The restart write. This is the one that used to destroy the evidence.
      const wasActive = HOUR_AGO();
      const { write, writes } = build({ value: '0', lastActiveAt: wasActive });
      await write(0, JUST_NOW());
      expect(writes[0].lastActiveAt).toEqual(wasActive);
      expect(writes[0].timestamp).not.toEqual(wasActive); // timestamp still moves
    });

    it('records nothing for a tag that has never been seen active', async () => {
      const { write, writes } = build(null);
      await write(0, JUST_NOW());
      expect(writes[0].lastActiveAt).toBeNull();
    });
  });
});
