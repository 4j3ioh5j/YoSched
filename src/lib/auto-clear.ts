// Helper for "Clear Auto" — identifying which calendar month an Auto-schedule
// run targets.
//
// Each source="auto" assignment is stamped with the "YYYY-MM" month its run
// targeted (Assignment.autoMonth). A run expands its window out to whole pay
// periods (see build-auto-schedule-input.ts), so scheduling one month can place
// cells that overflow into the adjacent month — but every such cell still
// carries its origin month. "Clear Auto" of a month then deletes by origin
// (autoMonth == this month) rather than by date, so it removes the month's auto
// cells AND their overflow, while leaving another month's run untouched.
//
// Both the apply (PUT, which stamps autoMonth) and the clear (DELETE, which
// matches it) derive the month from the same viewed range via this function, so
// they always agree.

/**
 * The "YYYY-MM" calendar month covering the most days of the inclusive range
 * [startDate, endDate] ("YYYY-MM-DD"); ties resolve to the earliest month.
 *
 * The viewed range is a month, possibly extended to pay-period edges that spill
 * a few days into adjacent months — the dominant month is the one the run
 * targets. Day-counting (not e.g. assignment-counting) makes this immune to
 * sparsely-staffed months.
 */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when both endpoints are real "YYYY-MM-DD" calendar dates and start <=
 * end. Rejects malformed ("2026-13-40"), rolled-over ("2026-02-30") and
 * reversed ranges — important because Clear Auto deletes a whole origin month
 * by `autoMonth` with no date bound, so a bogus range must never reach
 * owningMonthKey.
 */
export function isValidDateRange(startDate: string, endDate: string): boolean {
  if (!YMD.test(startDate) || !YMD.test(endDate)) return false;
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate + "T00:00:00Z");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false;
  // Reject silent roll-over (e.g. Feb 30 -> Mar 2) by round-tripping.
  if (s.toISOString().slice(0, 10) !== startDate) return false;
  if (e.toISOString().slice(0, 10) !== endDate) return false;
  return s <= e;
}

export function owningMonthKey(startDate: string, endDate: string): string {
  const counts = new Map<string, number>();
  const d = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (d <= end) {
    const key = d.toISOString().slice(0, 7); // "YYYY-MM"
    counts.set(key, (counts.get(key) ?? 0) + 1);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  // Map preserves chronological insertion order, so strict `>` keeps the
  // earliest month on a tie.
  let best = startDate.slice(0, 7);
  let bestN = -1;
  for (const [key, n] of counts) {
    if (n > bestN) {
      best = key;
      bestN = n;
    }
  }
  return best;
}
