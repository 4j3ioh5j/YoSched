/**
 * Per-day shift cap ("Max" in Settings › Staffing Rules) — the ONE place that turns a
 * (shift, date) into its cap. Stored as staffing_requirements.maxCount per
 * (shiftCode, dayKey); dayKey is "holiday" on a holiday, else the weekday "0".."6"
 * (Sunday = 0) — the same rule the minimums use. NULL / no row ⇒ no limit; 0 ⇒ none
 * allowed that day. Pure (no DB/React) so the engine, Live pins, the grid and the
 * server write routes all resolve caps identically.
 */

export type DayCapRequirement = { shiftCode: string; dayKey: string; maxCount?: number | null };
export type DayCapShift = { id: string; code: string };

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
  shiftTypes: readonly DayCapShift[],
  holidays: Iterable<string>,
): DayCapLookup {
  const holidaySet = new Set(holidays);
  const byCode = new Map<string, Map<string, number>>();
  for (const r of requirements) {
    if (r.maxCount == null) continue;
    let m = byCode.get(r.shiftCode);
    if (!m) byCode.set(r.shiftCode, (m = new Map()));
    m.set(r.dayKey, r.maxCount);
  }
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  return (shiftTypeId, date) => {
    const code = codeById.get(shiftTypeId);
    if (code === undefined) return null;
    return byCode.get(code)?.get(dayKeyOf(date, holidaySet)) ?? null;
  };
}

/** "Only 1 ORC allowed on Mondays" */
export function dayCapMessage(code: string, cap: number, date: string, holidays: Iterable<string>): string {
  return `Only ${cap} ${code} allowed ${dayKeyLabel(dayKeyOf(date, new Set(holidays)))}`;
}
