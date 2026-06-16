import {
  ppWeekForDate,
  ppIndexForDate,
  matchesWhen,
  ruleToWhen,
  type PayPeriodRange,
} from "./recurrence";

export type AvailabilityRule = {
  dayOfWeek: number;
  type: "available" | "unavailable";
  strength: "rule" | "preference";
  pattern: "every" | "pp_week_1" | "pp_week_2" | "every_n";
  cycleLength?: number | null;
  cycleOffset?: number | null;
  conditionStaffId?: string | null;
  conditionType?: "working" | "not_working" | null;
  // New normalized WHEN columns (present after the slice-3b backfill / picker
  // save). ruleToWhen prefers these when whenKind is set, else the legacy fields.
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

// The pay-period helpers + PayPeriodRange moved to recurrence.ts (to break a
// circular import); re-export them so existing importers from here keep working.
export { ppWeekForDate, ppIndexForDate, type PayPeriodRange };

export function matchesPattern(
  rule: { pattern: string; cycleLength?: number | null; cycleOffset?: number | null },
  dateStr: string,
  payPeriods: PayPeriodRange[]
): boolean {
  switch (rule.pattern) {
    case "every":
      return true;
    case "pp_week_1": {
      const week = ppWeekForDate(dateStr, payPeriods);
      return week === 1;
    }
    case "pp_week_2": {
      const week = ppWeekForDate(dateStr, payPeriods);
      return week === 2;
    }
    case "every_n": {
      const n = rule.cycleLength ?? 2;
      const offset = rule.cycleOffset ?? 0;
      const ppIdx = ppIndexForDate(dateStr, payPeriods);
      if (ppIdx < 0) return true;
      const week = ppWeekForDate(dateStr, payPeriods);
      const occurrence = ppIdx * 2 + (week === 2 ? 1 : 0);
      return occurrence % n === offset;
    }
    default:
      return true;
  }
}

export function evaluateAvailability(
  rules: AvailabilityRule[],
  dateStr: string,
  payPeriods: PayPeriodRange[],
  isStaffAssigned?: (staffId: string, date: string) => boolean
): { available: boolean; weight: number } {
  let hardAvailable = false;
  let hardUnavailable = false;
  let weight = 0;

  // matchesWhen applies the weekday gate, so iterate all rules (no dayOfWeek
  // pre-filter). A rule that doesn't apply to this date simply doesn't match.
  // With no matching rules, weight stays 0 → unavailable, exactly as the old
  // "no rules for this day-of-week → {available:false, weight:0}" early return.
  for (const rule of rules) {
    if (!matchesWhen(ruleToWhen(rule), dateStr, payPeriods)) continue;

    if (rule.conditionStaffId && rule.conditionType && isStaffAssigned) {
      const assigned = isStaffAssigned(rule.conditionStaffId, dateStr);
      if (rule.conditionType === "working" && !assigned) continue;
      if (rule.conditionType === "not_working" && assigned) continue;
    }

    if (rule.type === "available") {
      if (rule.strength === "rule") hardAvailable = true;
      else weight += 1;
    } else {
      if (rule.strength === "rule") hardUnavailable = true;
      else weight -= 1;
    }
  }

  if (hardUnavailable) return { available: false, weight: -10 };
  if (hardAvailable) return { available: true, weight: weight + 10 };
  return { available: weight > 0, weight };
}

export function isBaseWorkDay(
  rules: AvailabilityRule[],
  dayOfWeek: number
): boolean {
  return rules.some(
    (r) =>
      r.dayOfWeek === dayOfWeek &&
      r.type === "available" &&
      r.strength === "rule" &&
      r.pattern === "every" &&
      !r.conditionStaffId
  );
}

export function getBaseWorkDays(rules: AvailabilityRule[]): number[] {
  const days: number[] = [];
  for (let d = 0; d <= 6; d++) {
    if (isBaseWorkDay(rules, d)) days.push(d);
  }
  return days;
}

export function hasAdvancedRules(rules: AvailabilityRule[]): boolean {
  return rules.some(
    (r) =>
      r.pattern !== "every" ||
      r.strength !== "rule" ||
      r.type !== "available" ||
      r.conditionStaffId
  );
}

export function getRuleSummary(rules: AvailabilityRule[]): string {
  if (rules.length === 0) return "Off";

  const parts: string[] = [];
  for (const r of rules) {
    let s = r.type === "available" ? "" : "Not ";
    if (r.strength === "preference") s = r.type === "available" ? "Prefer " : "Avoid ";

    switch (r.pattern) {
      case "every": s += "every week"; break;
      case "pp_week_1": s += "PP wk 1"; break;
      case "pp_week_2": s += "PP wk 2"; break;
      case "every_n": {
        const n = r.cycleLength ?? 2;
        const ord = n === 2 ? "other" : n === 3 ? "3rd" : `${n}th`;
        s += `every ${ord}`;
        break;
      }
    }
    parts.push(s);
  }
  return parts.join("; ");
}
