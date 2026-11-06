/**
 * Per-day shift cap ("Max" in Settings › Staffing Rules) — the ONE place that turns a
 * (shift, date) into its cap. Stored as staffing_requirements.maxCount per
 * (shiftTypeId, dayKey); dayKey is "holiday" on a holiday, else the weekday "0".."6"
 * (Sunday = 0) — the same rule the minimums use. NULL / no row ⇒ no limit; 0 ⇒ none
 * allowed that day. Keyed by the shift's ID, so renaming a shift code changes nothing.
 * Pure (no DB/React) so the engine, Live pins, the grid and the server write routes all
 * resolve caps identically.
 */

export type DayCapRequirement = { shiftTypeId: string; dayKey: string; maxCount?: number | null };

export function dayKeyOf(date: string, holidaySet: ReadonlySet<string>): string {
  if (holidaySet.has(date)) return "holiday";
  return String(new Date(date + "T12:00:00").getDay());
}

const WEEKDAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** "on Mondays" / "on holidays" — for "Only 1 ORC allowed on Mondays". */
export function dayKeyLabel(dayKey: string): string {
  if (dayKey === "holiday") return "on holidays";
  const n = Number(dayKey);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? `on ${WEEKDAY_NAMES[n]}` : "per day";
}

export type DayCapLookup = (shiftTypeId: string, date: string) => number | null;

export function buildDayCapLookup(
  requirements: readonly DayCapRequirement[],
  holidays: Iterable<string>,
): DayCapLookup {
  const holidaySet = new Set(holidays);
  const byShift = new Map<string, Map<string, number>>();
  for (const r of requirements) {
    if (r.maxCount == null) continue;
    let m = byShift.get(r.shiftTypeId);
    if (!m) byShift.set(r.shiftTypeId, (m = new Map()));
    m.set(r.dayKey, r.maxCount);
  }
  return (shiftTypeId, date) => byShift.get(shiftTypeId)?.get(dayKeyOf(date, holidaySet)) ?? null;
}

/** "Only 1 ORC allowed on Mondays" */
export function dayCapMessage(code: string, cap: number, date: string, holidays: Iterable<string>): string {
  return `Only ${cap} ${code} allowed ${dayKeyLabel(dayKeyOf(date, new Set(holidays)))}`;
}
