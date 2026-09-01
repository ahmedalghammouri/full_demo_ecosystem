/**
 * The OEE identity. One definition, for the whole system.
 *
 *   OEE = Availability × Performance × Quality
 *
 * ── Why a four-line function needs its own file ─────────────────────────────
 * The product was written out by hand in sixteen places across six services.
 * Sixteen copies of arithmetic this simple do not drift in the MULTIPLICATION —
 * they drift in the edge cases around it, and those are the ones that reach a
 * screen:
 *
 *   · `(a / 100) * (p / 100) * (q / 100) * 100`            no null guard at all
 *   · `((r.performance ?? 0) / 100) * …`                   null coerced to ZERO
 *   · `a != null && p != null && q != null ? … : null`     null propagated
 *
 * The middle one is the dangerous form. A machine with no parts counted has no
 * measurable Performance — that is not "Performance = 0%". Coercing it produces
 * an OEE of 0.0% for a machine that ran perfectly well, and the reader has no
 * way to tell that from a machine that genuinely produced nothing. The engines
 * spend real effort keeping "not measured" distinct from "measured at zero";
 * a `?? 0` in the last step throws that away.
 *
 * So: null in, null out. Always. A factor that was not measured makes the
 * product unmeasurable, and the page says so instead of printing a number.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * It does not round. Callers round for display at different precisions, and a
 * rounding decision baked in here would silently change every existing figure
 * the moment it was adopted — which is exactly what this consolidation must not
 * do.
 */

/** A factor is usable only if it is a real number. NaN is not a measurement. */
const usable = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Clamp a factor to 0–100.
 *
 * Above 100 means the machine outran its own design speed, which is a master
 * data problem rather than a performance to be celebrated; below 0 is
 * impossible. Both are clamped so the product cannot be inflated by a bad
 * cycle time — and both remain visible in the factor itself, which callers
 * clamp or not according to what that factor means to them.
 */
const clamp01 = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * OEE from its three factors, each a percentage.
 *
 * Returns `null` when any factor is missing — see the note above on why that is
 * not zero.
 */
export function oeeIdentity(
  availability: number | null | undefined,
  performance: number | null | undefined,
  quality: number | null | undefined,
): number | null {
  if (!usable(availability) || !usable(performance) || !usable(quality)) return null;
  return oeeIdentityOf(availability, performance, quality);
}

/**
 * The same product, for a caller that has ALREADY established all three factors.
 *
 * ── Why two entry points and not one ────────────────────────────────────────
 * Most call sites guard their factors a line or two above the multiplication —
 * `a != null && p != null && q != null ? … : null`. Handing those a nullable
 * return makes the compiler demand a second guard for something the code has
 * just proved, and that nullability then cascades into every consumer: widening
 * one rounding helper turned sixty unrelated durations nullable.
 *
 * So the strict version is the door for unguarded input, and this is the door
 * for guarded input. They are the SAME multiplication — this one is the
 * implementation and `oeeIdentity` is a null-check in front of it — which is the
 * whole point. What was sixteen copies of the arithmetic is now one, whichever
 * door a caller comes through.
 */
export function oeeIdentityOf(availability: number, performance: number, quality: number): number {
  return (clamp01(availability) / 100) * (clamp01(performance) / 100) * (clamp01(quality) / 100) * 100;
}

/**
 * The time-based twin: the same product with a different Availability.
 *
 * Named rather than left to each call site to remember, because the mistake it
 * prevents is a specific one. OEE-TB differs from OEE in EXACTLY one factor —
 * availability measured against the clock the equipment faced rather than the
 * planned time. Performance and Quality are shared. A call site that recomputed
 * all three would be answering a different question than the number printed
 * beside it.
 */
export function oeeTimeBased(
  availabilityTimeBased: number | null | undefined,
  performance: number | null | undefined,
  quality: number | null | undefined,
): number | null {
  return oeeIdentity(availabilityTimeBased, performance, quality);
}

/** A ratio as a percentage, or null when the denominator cannot support one. */
export function pctOf(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!usable(numerator) || !usable(denominator) || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}
