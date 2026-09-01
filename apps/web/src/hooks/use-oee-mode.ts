'use client';

import { useTranslation } from 'react-i18next';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';

/**
 * The OEE calculation basis the user has selected, and the helpers for honouring
 * it consistently.
 *
 * ── The two bases ───────────────────────────────────────────────────────────
 *   • STANDARD (OEE-TB, the default) — Availability is measured against the time
 *     that actually WENT BY, less the stops nobody is charged for: planned stops,
 *     and minutes lost to an upstream or downstream constraint. Complete at every
 *     instant, which is why a headline card opens on it.
 *   • SCHEDULE (OEE)                 — Availability is measured against the slot
 *     each order was COMMITTED to. A late start is charged, and so is the part of
 *     the slot the order has not reached yet, so mid-slot this reads low and
 *     climbs. It answers "of the time we promised, how much have we delivered".
 *
 * ── What these used to say, and why it was wrong ────────────────────────────
 * This block described the second basis as "uptime + downtime, the clock the
 * equipment actually faced". That denominator is algebraically IDENTICAL to the
 * first one — the minute buckets are defined to sum to the total, so
 * `total − planned − external − unmeasured` is exactly `operating + down`. Both
 * sides of the toggle were the same number, and switching it changed only the
 * rounding. The two bases above are the ones the engines actually compute.
 *
 * Neither is "the right one"; they answer different questions. What is NOT
 * acceptable is a screen that mixes them, or a toggle that changes one card and
 * leaves the rest alone — the user then compares two numbers computed on
 * different bases and concludes the system is wrong.
 *
 * ── Why a hook and not `atOee ? x : y` at each call site ─────────────────────
 * That inline form was already copied into a handful of views and omitted from
 * two dozen others, which is exactly how the toggle came to look inert. Reading
 * the mode through one helper means a card either honours it or visibly does not
 * import it — no silent third state.
 *
 *   const oee = useOeeMode();
 *   <KPICard title={oee.label(t('cards.oee'))} value={oee.pick(d.oee, d.oeeTb)} />
 */
export function useOeeMode() {
  const { t } = useTranslation('common');
  const { atOee, setAtOee } = useDashboardPrefsStore();

  /**
   * Choose between the schedule-based and time-based value.
   *
   * `tbValue` is optional on purpose: several endpoints do not return a standard
   * variant yet. When it is missing we fall back to the schedule figure rather
   * than rendering 0 or a blank — but `isExact` reports that the card could not
   * honour the toggle, so a caller can mark it instead of quietly showing the
   * wrong basis.
   */
  const pick = (scheduleValue: number | null | undefined, tbValue?: number | null) => {
    if (!atOee) return scheduleValue ?? 0;
    return tbValue ?? scheduleValue ?? 0;
  };

  /** True when the displayed number really is on the selected basis. */
  const isExact = (tbValue?: number | null) => !atOee || tbValue != null;

  /** Suffix a card title so the basis is visible on the card, not only in the filter. */
  const label = (base: string) => (atOee ? `${base} (${t('atOee.tb')})` : base);

  /** Short name of the active basis, for legends and tooltips. */
  const basisName = atOee ? t('atOee.tb') : t('atOee.schedule');

  return { atOee, setAtOee, pick, isExact, label, basisName, t };
}
