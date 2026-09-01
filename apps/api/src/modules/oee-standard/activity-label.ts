/**
 * The name to write inside a band on the machine status timeline.
 *
 * ── Why this is not just `notes` ────────────────────────────────────────────
 * `machine_state_records.notes` carries two different things that happen to
 * share a column:
 *
 *   AN ACTIVITY NAME, meant for a human   "Line Cleaning — start of shift"
 *   A MACHINE MARKER, meant for a query   "[auto-stop <id> @ <key>]"
 *
 * The markers are load-bearing: `AutoPlannedStopService` finds an occurrence it
 * already booked by searching for its own marker, which is the only thing
 * stopping a stop being booked again every time the cron runs. So they must
 * stay in the column — and they must never reach the screen.
 *
 * The timeline used to take the note whole. The result was bands labelled
 * `[idle-repair: was STARVED, no order was executing]` and
 * `[idle-repair tail of 940d8674-c671-49af-a23f-95351506c786]` — a UUID painted
 * across a shift, on a chart whose whole job is to be read at a glance. Every
 * automatically booked cleaning stop had the same defect waiting in it.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Bracketed spans are machine talk and come out. A trailing parenthetical is
 * provenance the materialiser appends and comes out too. What remains is the
 * name a person wrote; if nothing remains, the band keeps its state name, which
 * is honest — better a band that says STARVED than one that says nothing.
 */
export function activityLabel(notes: string | null | undefined): string | undefined {
  if (!notes) return undefined;
  const readable = notes
    .replace(/\[[^\]]*\]/g, ' ')   // every machine marker, wherever it sits
    .split(' (')[0]                // the provenance clause the writer appends
    .replace(/\s+/g, ' ')
    .trim()
    // ...and the case the split above cannot see: a note that is NOTHING but a
    // parenthetical has no name in front of the ' (' to split on.
    .replace(/^\([^)]*\)$/, '');
  return readable || undefined;
}
