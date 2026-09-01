import type { PrismaClient } from '@prisma/client';

/**
 * CLOSE ORPHANED machine_state_records — the data half of the outbox race.
 *
 * ── The bug, briefly ─────────────────────────────────────────────────────────
 * The edge gateway's outbox drains deferred work in concurrent batches. A
 * machine's state transitions are not independent of each other, and
 * `StatusService.apply()` used to run unserialized: two transitions for the
 * SAME machine landing in one batch could both read "no open record matches"
 * before either wrote, so both opened a new row. Closing a record only ever
 * finds the LATEST open one, so every earlier duplicate was orphaned open
 * forever — accumulating minutes nobody was measuring. `status.service.ts` now
 * serializes transitions per machine, so this stops happening going forward.
 *
 * It does not touch what already happened. On this plant: 15 open records on
 * M1 (one from 23 Aug 08:26), 22 on M2, 5 on M3 — all but the true final one
 * on each machine reading a state the machine had long since left.
 *
 * ── Why this repair is not a guess ──────────────────────────────────────────
 * `apply()` only ever opens a new record when the state genuinely changed
 * (`if (String(open.state) === state) return;`), so every orphaned row marks a
 * REAL transition boundary — the race lost the WRITE that should have closed
 * the previous row, not the transition itself. Chaining
 * `record[i].endTime = record[i+1].startTime` across each machine's open
 * records, ordered by start time, reconstructs exactly what a serialized
 * `apply()` would have written: the timeline is completed, not invented.
 *
 * The true CURRENT state — the last record in the chain — is left open. Only
 * that one may still be open when this finishes; anything else is refused
 * before writing, not fixed by force.
 */
export interface RepairResult {
  machineCode: string;
  closed: number;
  /** True current state, left open. */
  remainingOpenState: string | null;
}

export async function repairOrphanedStateRecords(
  prisma: PrismaClient,
  opts: { dryRun?: boolean } = {},
): Promise<RepairResult[]> {
  const machines = await prisma.machine.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });

  const out: RepairResult[] = [];
  for (const m of machines) {
    const open = await prisma.machineStateRecord.findMany({
      where: { machineId: m.id, endTime: null },
      orderBy: { startTime: 'asc' },
      select: { id: true, state: true, startTime: true },
    });
    if (open.length <= 1) continue;

    let closed = 0;
    for (let i = 0; i < open.length - 1; i += 1) {
      const row = open[i];
      const next = open[i + 1];
      const durationMinutes = Math.max(
        0, (next.startTime.getTime() - row.startTime.getTime()) / 60_000,
      );
      if (!opts.dryRun) {
        await prisma.machineStateRecord.update({
          where: { id: row.id },
          data: { endTime: next.startTime, durationMinutes },
        });
      }
      closed += 1;
    }

    out.push({
      machineCode: m.code,
      closed,
      remainingOpenState: String(open[open.length - 1].state),
    });
  }
  return out;
}
