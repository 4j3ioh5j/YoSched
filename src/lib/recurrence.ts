// Unified recurrence model — the "WHEN" axis: which occurrences a rule lands on.
//
// This is the shared representation behind availability rules, shift-eligibility
// rules, and (later) standing commitments. It supersedes the scattered
// `dayOfWeek + pattern(every|pp_week_1|pp_week_2|every_n) + cycleLength +
// cycleOffset` fields. Slice 2 ships the pure model + evaluator + legacy bridge
// with exhaustive tests; wiring into the scheduler/UI lands in later slices.
//
// Two orthogonal axes exist overall — this file is the WHEN axis. The HOW-OFTEN
// axis (min/max/exactly per N windows) lives in shift-eligibility.ts
// (getWindowBounds / windowCount).

import { ppWeekForDate, ppIndexForDate, type PayPeriodRange } from "./availability";

export type OccurrenceKind =
  | "every" // every occurrence of the chosen weekday(s)
  | "ppWeek" // only week 1 or week 2 of the pay period
  | "ordinalMonth" // the Nth occurrence of the weekday within the calendar month (-1 = last)
  | "ordinalPayPeriod" // the Nth occurrence of the weekday within the pay period (-1 = last)
  | "cycle"; // every Nth week-slot or pay-period, with an offset (parity / "every other")

export type WhenPattern = {
  // 0=Sun..6=Sat. [] = any day (the occurrence qualifier still applies).
  daysOfWeek: number[];
  kind: OccurrenceKind;

  // kind="ppWeek"
  ppWeek?: 1 | 2 | null;

  // kind="ordinalMonth" | "ordinalPayPeriod". Values 1..N pick that occurrence;
  // -1 means "the last occurrence of this weekday" in the month/pay period.
  // Multi-select drives "1st & 3rd" etc.
  ords?: number[] | null;

  // kind="cycle"
  cycleUnit?: "week" | "payPeriod" | null;
  cycleN?: number | null; // >= 1
  cycleOffset?: number | null; // 0 .. cycleN-1
};

function dowOf(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

// Nth occurrence of this date's own weekday within its calendar month (1-indexed).
// e.g. the 3rd Tuesday returns 3. Independent of any daysOfWeek filter.
export function monthOrdinalForDate(dateStr: string): number {
  const day = Number(dateStr.split("-")[2]);
  return Math.floor((day - 1) / 7) + 1;
}

// True when this date is the LAST occurrence of its weekday in the month
// (i.e. there is no same-weekday date 7 days later in the same month).
export function isLastWeekdayOccurrenceInMonth(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return d + 7 > daysInMonth;
}

// Day offset + length of the pay period containing dateStr (null if none).
function ppDayInfo(
  dateStr: string,
  payPeriods: PayPeriodRange[],
): { dayIndex: number; lengthDays: number } | null {
  for (const pp of payPeriods) {
    if (dateStr >= pp.startDate && dateStr <= pp.endDate) {
      const start = new Date(pp.startDate + "T12:00:00");
      const end = new Date(pp.endDate + "T12:00:00");
      const d = new Date(dateStr + "T12:00:00");
      const dayIndex = Math.round((d.getTime() - start.getTime()) / 86400000);
      const lengthDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      return { dayIndex, lengthDays };
    }
  }
  return null;
}

// Nth occurrence of this date's weekday within its pay period (1-indexed), or
// null if the date is in no pay period. For the standard 14-day PP this is 1 or 2.
export function ppOrdinalForDate(dateStr: string, payPeriods: PayPeriodRange[]): number | null {
  const info = ppDayInfo(dateStr, payPeriods);
  return info ? Math.floor(info.dayIndex / 7) + 1 : null;
}

// True when this date is the LAST occurrence of its weekday in its pay period.
export function isLastWeekdayOccurrenceInPP(dateStr: string, payPeriods: PayPeriodRange[]): boolean {
  const info = ppDayInfo(dateStr, payPeriods);
  return info ? info.dayIndex + 7 >= info.lengthDays : false;
}

// Does `dateStr` match the WHEN pattern? Pure; depends only on the date and the
// pay-period grid. The weekday gate is applied here (unlike legacy matchesPattern,
// where callers pre-filter by dayOfWeek).
export function matchesWhen(
  p: WhenPattern,
  dateStr: string,
  payPeriods: PayPeriodRange[],
): boolean {
  // 1. Weekday gate ([] = any day).
  if (p.daysOfWeek && p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(dowOf(dateStr))) {
    return false;
  }

  // 2. Occurrence qualifier.
  switch (p.kind) {
    case "every":
      return true;

    case "ppWeek":
      return ppWeekForDate(dateStr, payPeriods) === p.ppWeek;

    case "ordinalMonth": {
      const ords = p.ords ?? [];
      if (ords.length === 0) return true;
      if (ords.includes(monthOrdinalForDate(dateStr))) return true;
      return ords.includes(-1) && isLastWeekdayOccurrenceInMonth(dateStr);
    }

    case "ordinalPayPeriod": {
      const ords = p.ords ?? [];
      if (ords.length === 0) return true;
      const ord = ppOrdinalForDate(dateStr, payPeriods);
      if (ord === null) return true; // outside known PPs — match (consistent with legacy every_n)
      if (ords.includes(ord)) return true;
      return ords.includes(-1) && isLastWeekdayOccurrenceInPP(dateStr, payPeriods);
    }

    case "cycle": {
      const n = Math.max(1, Math.floor(p.cycleN ?? 1));
      const offset = p.cycleOffset ?? 0;
      const ppIdx = ppIndexForDate(dateStr, payPeriods);
      if (ppIdx < 0) return true; // consistent with legacy every_n (ppIdx<0 -> match)
      // "week" = the across-PP week-slot index used by legacy every_n; "payPeriod"
      // = the pay-period index (enables every-other-PP parity).
      const idx =
        p.cycleUnit === "payPeriod"
          ? ppIdx
          : ppIdx * 2 + (ppWeekForDate(dateStr, payPeriods) === 2 ? 1 : 0);
      return idx % n === offset;
    }

    default:
      return true;
  }
}

// Bridge legacy `dayOfWeek + pattern + cycleLength + cycleOffset` to the new
// model. Used by Slice 3's migration backfill and by the wiring layer to read
// old rows. Equivalence (proven in tests): for any legacy rule R and date D,
//   matchesWhen(legacyPatternToWhen(R), D) === (dow(D) === R.dayOfWeek && matchesPattern(R, D))
export function legacyPatternToWhen(rule: {
  dayOfWeek: number;
  pattern: string;
  cycleLength?: number | null;
  cycleOffset?: number | null;
}): WhenPattern {
  const daysOfWeek = [rule.dayOfWeek];
  switch (rule.pattern) {
    case "pp_week_1":
      return { daysOfWeek, kind: "ppWeek", ppWeek: 1 };
    case "pp_week_2":
      return { daysOfWeek, kind: "ppWeek", ppWeek: 2 };
    case "every_n":
      return {
        daysOfWeek,
        kind: "cycle",
        cycleUnit: "week",
        cycleN: rule.cycleLength ?? 2,
        cycleOffset: rule.cycleOffset ?? 0,
      };
    case "every":
    default:
      return { daysOfWeek, kind: "every" };
  }
}
