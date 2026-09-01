import type { PrismaService } from '../database/prisma.service';

/** A shift template reduced to what the window maths needs. */
export interface ShiftTemplateWindow {
  id: string;
  code: string;
  name: string;
  startTime: string;      // "HH:mm", plant-local
  endTime: string;        // "HH:mm", plant-local
  crossesMidnight: boolean;
}

/** Which shift a moment belongs to, and which calendar day that occurrence began on. */
export interface ResolvedShift {
  templateId: string;
  code: string;
  name: string;
  /** Start of the occurrence — the key that makes "Shift 2 on 8 Aug" distinct. */
  shiftStart: Date;
  /** Midnight of the day the occurrence STARTED (an overnight shift keeps day 1). */
  shiftDate: Date;
}

const parseHhmm = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Resolve which shift a given INSTANT falls in, from the templates alone.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Shift attribution used to depend on a `ShiftInstance` row being created and
 * linked to a work order. Nothing created them: the database held ONE instance,
 * twelve days old, so every "group by shift" collapsed into a single bucket
 * labelled "Unassigned" — while the Command Center happily displayed the current
 * shift's NAME, because it derived that from the templates.
 *
 * Deriving the shift from the timestamp needs no rows to exist, works for the past
 * as well as the present, and lets one production order span as many shifts as it
 * actually ran in — each minute of history attributed to the shift it happened in,
 * rather than to whatever instance someone remembered to start.
 */
export function resolveShiftAt(
  at: Date,
  templates: ShiftTemplateWindow[],
): ResolvedShift | null {
  if (templates.length === 0) return null;
  const atMin = at.getHours() * 60 + at.getMinutes();

  const inWindow = (t: ShiftTemplateWindow) => {
    const s = parseHhmm(t.startTime), e = parseHhmm(t.endTime);
    return t.crossesMidnight ? atMin >= s || atMin < e : atMin >= s && atMin < e;
  };

  const active = templates.find(inWindow);
  if (!active) return null; // a genuine gap between shifts — do not guess

  const s = parseHhmm(active.startTime), e = parseHhmm(active.endTime);
  const shiftStart = new Date(at);
  shiftStart.setHours(Math.floor(s / 60), s % 60, 0, 0);
  // Past-midnight portion of an overnight shift belongs to the occurrence that
  // began YESTERDAY.
  if (active.crossesMidnight && atMin < e) shiftStart.setDate(shiftStart.getDate() - 1);

  const shiftDate = new Date(shiftStart);
  shiftDate.setHours(0, 0, 0, 0);

  return { templateId: active.id, code: active.code, name: active.name, shiftStart, shiftDate };
}

/**
 * Resolve the START of the shift that is active right now for a factory, from the
 * shift templates (HH:mm windows, overnight-aware). Returns null when there is no
 * factory context or no active templates. Used so a `timeframe=shift` request means
 * the REAL current shift (start → now), not "since midnight". Mirrors the logic in
 * ShiftService.getCurrentShiftStatus so every surface agrees on the shift window.
 */
export async function currentShiftWindow(
  prisma: PrismaService,
  factoryId: string | null,
): Promise<{ start: Date; end: Date } | null> {
  /**
   * A null factory is a SUPER_ADMIN, not "no factory".
   *
   * ── What returning null here did ─────────────────────────────────────────
   * Every caller falls back to midnight when this yields nothing, so for an
   * account with no factory of its own the "Shift" period silently became
   * "since today 00:00" — with no error, no empty state, and the button still
   * highlighted. On this plant that is the difference between 6,361 units and
   * 2,649 for one machine, and it is why /production/oee/calculate?timeframe=
   * shift disagreed with /oee-standard over the same shift: they were not
   * looking at the same hours.
   *
   * The same defect has now been fixed three times in three places by resolving
   * across factories instead of bailing. This is that resolution, in the shared
   * helper, so the next caller inherits it.
   */
  const templates = await prisma.shiftTemplate.findMany({
    where: { ...(factoryId ? { factoryId } : {}), isActive: true },
    orderBy: { startTime: 'asc' },
    select: { startTime: true, endTime: true, crossesMidnight: true },
  });
  if (templates.length === 0) return null;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const parse = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
  const inWindow = (t: (typeof templates)[number]) => {
    const s = parse(t.startTime), e = parse(t.endTime);
    return t.crossesMidnight ? nowMin >= s || nowMin < e : nowMin >= s && nowMin < e;
  };

  const active = templates.find(inWindow) ?? templates[0];
  const s = parse(active.startTime), e = parse(active.endTime);
  const startDt = new Date(now);
  startDt.setHours(Math.floor(s / 60), s % 60, 0, 0);
  // Overnight shift currently in its post-midnight portion, or shift not yet started
  // today → the active occurrence began on the previous calendar day.
  if (active.crossesMidnight && nowMin < e) startDt.setDate(startDt.getDate() - 1);
  else if (nowMin < s) startDt.setDate(startDt.getDate() - 1);

  // The END of the same occurrence. The schedule basis divides by the slot an
  // order was committed to, and for a shift window that slot runs to the end
  // of the SHIFT — not to now, and not to midnight. Derived here beside the
  // start so the two can never be resolved by different rules.
  const endDt = new Date(startDt);
  const lengthMin = active.crossesMidnight ? (24 * 60 - s) + e : e - s;
  endDt.setMinutes(endDt.getMinutes() + lengthMin);

  return { start: startDt, end: endDt };
}

/** The start of the running shift. A read of {@link currentShiftWindow}. */
export async function currentShiftStart(
  prisma: PrismaService,
  factoryId: string | null,
): Promise<Date | null> {
  return (await currentShiftWindow(prisma, factoryId))?.start ?? null;
}
