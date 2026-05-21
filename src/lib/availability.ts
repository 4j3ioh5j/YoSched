export type AvailabilityRule = {
  dayOfWeek: number;
  type: "available" | "unavailable";
  strength: "rule" | "preference";
  pattern: "every" | "pp_week_1" | "pp_week_2" | "every_n";
  cycleLength?: number | null;
  cycleOffset?: number | null;
  conditionProviderId?: string | null;
  conditionType?: "working" | "not_working" | null;
};

type PayPeriodRange = { startDate: string; endDate: string };

function ppWeekForDate(
  dateStr: string,
  payPeriods: PayPeriodRange[]
): 1 | 2 | null {
  for (const pp of payPeriods) {
    if (dateStr >= pp.startDate && dateStr <= pp.endDate) {
      const start = new Date(pp.startDate + "T12:00:00");
      const d = new Date(dateStr + "T12:00:00");
      const dayIndex = Math.round(
        (d.getTime() - start.getTime()) / (86400000)
      );
      return dayIndex < 7 ? 1 : 2;
    }
  }
  return null;
}

function ppIndexForDate(
  dateStr: string,
  payPeriods: PayPeriodRange[]
): number {
  for (let i = 0; i < payPeriods.length; i++) {
    if (dateStr >= payPeriods[i].startDate && dateStr <= payPeriods[i].endDate) {
      return i;
    }
  }
  return -1;
}

function matchesPattern(
  rule: AvailabilityRule,
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
  isProviderAssigned?: (providerId: string, date: string) => boolean
): { available: boolean; weight: number } {
  const dow = new Date(dateStr + "T12:00:00").getDay();
  const dayRules = rules.filter((r) => r.dayOfWeek === dow);

  if (dayRules.length === 0) {
    return { available: false, weight: 0 };
  }

  let hardAvailable = false;
  let hardUnavailable = false;
  let weight = 0;

  for (const rule of dayRules) {
    if (!matchesPattern(rule, dateStr, payPeriods)) continue;

    if (rule.conditionProviderId && rule.conditionType && isProviderAssigned) {
      const assigned = isProviderAssigned(rule.conditionProviderId, dateStr);
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
      !r.conditionProviderId
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
      r.conditionProviderId
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
