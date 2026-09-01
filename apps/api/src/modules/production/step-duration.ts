/**
 * How long a routing step takes, given what actually flows through it.
 *
 * ── The quantity ISSUED and the quantity WORKED are different numbers ───────
 * A job order cannot be issued for 23.08 pallets, so `convertUnits` rounds UP
 * when it moves to a coarser unit: 1500 cartons at 65 per pallet is issued as
 * 24. That rounding is right, and it has to stay — the step must produce enough
 * to satisfy the next one, and a part-filled pallet is still a pallet somebody
 * has to move.
 *
 * But the ceiling then leaked into the estimate. The palletiser was quoted for
 * 24 pallets when only 1500 cartons ever reach it — 187 minutes for 180 minutes
 * of work, on every coarsening step, on every order. The plant found it by
 * doing the division by hand.
 *
 * Work content is proportional to what PASSES THROUGH the machine, not to how
 * the output is packaged and counted afterwards. So the duration takes the
 * unrounded quantity and the issued quantity keeps its ceiling. Two numbers,
 * because they answer two questions.
 */
export function stepDurationMins(
  workedQty: number,
  cycleTimeSec: number | null | undefined,
  setupTimeMins = 0,
): number | null {
  if (cycleTimeSec == null || !Number.isFinite(cycleTimeSec)) return null;
  const qty = Number.isFinite(workedQty) ? Math.max(0, workedQty) : 0;
  return Math.round((qty * cycleTimeSec) / 60 + (setupTimeMins || 0));
}
