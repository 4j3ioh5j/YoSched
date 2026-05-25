import { matchesPattern, type PayPeriodRange } from "./availability";

export type ShiftEligibilityRule = {
  shiftTypeId: string;
  dayOfWeek: number;
  type: "eligible" | "ineligible";
  strength: "rule" | "preference";
  pattern: "every" | "pp_week_1" | "pp_week_2" | "every_n";
  cycleLength?: number | null;
  cycleOffset?: number | null;
};

export type ShiftMinTarget = {
  shiftTypeId: string;
  minCount: number;
  window: "week" | "pay_period" | "month" | "days";
  windowDays?: number | null;
};

export function evaluateShiftEligibility(
  rules: ShiftEligibilityRule[],
  shiftTypeId: string,
  dateStr: string,
  payPeriods: PayPeriodRange[],
): { eligible: boolean; weight: number } | null {
  const shiftRules = rules.filter((r) => r.shiftTypeId === shiftTypeId);
  if (shiftRules.length === 0) return null;

  const dow = new Date(dateStr + "T12:00:00").getDay();
  const dayRules = shiftRules.filter((r) => r.dayOfWeek === dow);

  if (dayRules.length === 0) {
    return { eligible: false, weight: 0 };
  }

  let hardEligible = false;
  let hardIneligible = false;
  let weight = 0;

  for (const rule of dayRules) {
    if (!matchesPattern(rule, dateStr, payPeriods)) continue;

    if (rule.type === "eligible") {
      if (rule.strength === "rule") hardEligible = true;
      else weight += 1;
    } else {
      if (rule.strength === "rule") hardIneligible = true;
      else weight -= 1;
    }
  }

  if (hardIneligible) return { eligible: false, weight: -10 };
  if (hardEligible) return { eligible: true, weight: weight + 10 };
  return { eligible: weight > 0, weight };
}

export function getWindowBounds(
  target: ShiftMinTarget,
  dateStr: string,
  payPeriods: PayPeriodRange[],
): { start: string; end: string } | null {
  switch (target.window) {
    case "pay_period": {
      for (const pp of payPeriods) {
        if (dateStr >= pp.startDate && dateStr <= pp.endDate) {
          return { start: pp.startDate, end: pp.endDate };
        }
      }
      return null;
    }
    case "week": {
      const d = new Date(dateStr + "T12:00:00");
      const dow = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dow + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: fmt(monday), end: fmt(sunday) };
    }
    case "month": {
      const [y, m] = dateStr.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      return {
        start: `${y}-${String(m).padStart(2, "0")}-01`,
        end: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      };
    }
    case "days": {
      if (!target.windowDays || target.windowDays <= 0) return null;
      const d = new Date(dateStr + "T12:00:00");
      const end = new Date(d);
      end.setDate(d.getDate() + target.windowDays - 1);
      return { start: dateStr, end: fmt(end) };
    }
    default:
      return null;
  }
}

export function checkMinimumTargetMet(
  target: ShiftMinTarget,
  assignedDatesInWindow: string[],
): { met: boolean; current: number; needed: number } {
  const current = assignedDatesInWindow.length;
  return {
    met: current >= target.minCount,
    current,
    needed: target.minCount,
  };
}

export function countInWindow(
  allAssignedDates: string[],
  windowStart: string,
  windowEnd: string,
): string[] {
  return allAssignedDates.filter((d) => d >= windowStart && d <= windowEnd);
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
