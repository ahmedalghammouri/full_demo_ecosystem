/**
 * Whether a routing step may be taken out of the line, and what to say if not.
 *
 * Pure, and separate from the service, because the interesting part is the
 * refusals — and a decision that needs a database to exercise tends not to get
 * exercised.
 */
export interface BypassStep {
  id: string;
  sequenceOrder: number;
  operationName: string;
  machineCode?: string | null;
  bypassedAt: Date | null;
}

export type BypassVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The password gate.
 *
 * Deliberately ONE fixed password, held in an env var with a plant-agreed
 * default, because that is what was asked for and pretending otherwise would be
 * worse. What it buys is a deliberate pause — this changes which machine the
 * whole line's output is read from, and a stray tap must not do that.
 *
 * What it is NOT: authentication. It does not identify anybody; the endpoint's
 * own permission check does that, and the audit trail records the real user. If
 * this ever needs to say WHO approved, it must become a supervisor credential
 * check, not a longer constant.
 */
export const BYPASS_PASSWORD = process.env.STEP_BYPASS_PASSWORD || '12345678';

export function checkBypassPassword(supplied: unknown): BypassVerdict {
  if (typeof supplied !== 'string' || supplied.length === 0) {
    return { ok: false, reason: 'This change needs the supervisor password.' };
  }
  if (supplied !== BYPASS_PASSWORD) {
    return { ok: false, reason: 'That password is not correct.' };
  }
  return { ok: true };
}

/**
 * May `stepId` be bypassed, given every step of its work order?
 *
 * The one rule that matters: a work order must keep at least one step that
 * counts. Bypass them all and `FINAL_STEP` has nothing to pick, and the line
 * reports zero output for the shift — a total, silent loss of the numbers.
 */
export function canBypass(steps: BypassStep[], stepId: string): BypassVerdict {
  const target = steps.find((s) => s.id === stepId);
  if (!target) return { ok: false, reason: 'That step is not part of this work order.' };
  if (target.bypassedAt) return { ok: false, reason: 'That step is already bypassed.' };

  const liveAfter = steps.filter((s) => s.id !== stepId && !s.bypassedAt);
  if (liveAfter.length === 0) {
    return {
      ok: false,
      reason: 'This is the last step still counting. Bypassing it would leave the order with '
        + 'no machine to read output from.',
    };
  }
  return { ok: true };
}

/** Restoring a step is always allowed; only the password stands in the way. */
export function canRestore(steps: BypassStep[], stepId: string): BypassVerdict {
  const target = steps.find((s) => s.id === stepId);
  if (!target) return { ok: false, reason: 'That step is not part of this work order.' };
  if (!target.bypassedAt) return { ok: false, reason: 'That step is not bypassed.' };
  return { ok: true };
}

/**
 * The step the line's output will be read from once `bypassed` are excluded.
 *
 * The tablet shows this BEFORE asking for the password, because "output will be
 * read from Euro-Pack instead of Uni-Tech" is the whole consequence, and an
 * operator agreeing to a change should be able to see what they are agreeing to.
 */
export function outputStepAfter(steps: BypassStep[], alsoBypass?: string): BypassStep | null {
  const ordered = [...steps].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const live = ordered.filter((s) => !s.bypassedAt && s.id !== alsoBypass);
  // Same fallback as FINAL_STEP and finalStepCounts: never answer "nowhere".
  return live[live.length - 1] ?? ordered[ordered.length - 1] ?? null;
}
