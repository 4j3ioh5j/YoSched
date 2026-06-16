import { matchesWhen, ruleToWhen, type PayPeriodRange } from "./recurrence";

export type ShiftEligibilityRule = {
  shiftTypeId: string;
  dayOfWeek: number;
  type: "eligible" | "ineligible";
  strength: "rule" | "preference";
  pattern: "every" | "pp_week_1" | "pp_week_2" | "every_n";
  cycleLength?: number | null;
  cycleOffset?: number | null;
  // New normalized WHEN columns (present after slice-3b backfill / picker save).
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

export type ShiftMinTarget = {
  shiftTypeId: string;
  minCount: number;
  maxCount?: number | null;
  window: "week" | "pay_period" | "month" | "days";
  windowDays?: number | null;
  // Multiplier for week/pay_period/month windows: "per N windows" (e.g. 1 per 3
  // pay periods). Tiles the calendar into fixed, non-overlapping blocks of N
  // anchored at a stable epoch (PP[0] / a reference Monday / year 0), so both
  // min and max stay well-defined. Defaults to 1. Ignored for window="days".
  windowCount?: number | null;
};

export function evaluateShiftEligibility(
  rules: ShiftEligibilityRule[],
  shiftTypeId: string,
  dateStr: string,
  payPeriods: PayPeriodRange[],
): { eligible: boolean; weight: number } | null {
  const shiftRules = rules.filter((r) => r.shiftTypeId === shiftTypeId);
  if (shiftRules.length === 0) return null;

  let hardEligible = false;
  let hardIneligible = false;
  let weight = 0;

  // matchesWhen applies the weekday gate, so iterate all rules for this shift.
  // No matching rule → weight 0 → {eligible:false, weight:0}, matching the old
  // "no rule for this day-of-week" early return.
  for (const rule of shiftRules) {
    if (!matchesWhen(ruleToWhen(rule), dateStr, payPeriods)) continue;

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
  // "per N windows" multiplier (week/pay_period/month only). Tiles into fixed,
  // non-overlapping blocks of n anchored at a stable epoch, so n=1 reduces
  // exactly to a single window and n>1 never overlaps.
  const n = Math.max(1, Math.floor(target.windowCount ?? 1));

  switch (target.window) {
    case "pay_period": {
      // Anchored at PP[0] (the same epoch ppIndexForDate / every_n use).
      const idx = payPeriods.findIndex((pp) => dateStr >= pp.startDate && dateStr <= pp.endDate);
      if (idx < 0) return null;
      const blockStart = Math.floor(idx / n) * n;
      const blockEnd = Math.min(blockStart + n - 1, payPeriods.length - 1);
      return { start: payPeriods[blockStart].startDate, end: payPeriods[blockEnd].endDate };
    }
    case "week": {
      const d = new Date(dateStr + "T12:00:00");
      const dow = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dow + 6) % 7));
      if (n === 1) {
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return { start: fmt(monday), end: fmt(sunday) };
      }
      // Tile weeks into n-blocks anchored at a reference Monday (1970-01-05).
      const EPOCH_MON = new Date("1970-01-05T12:00:00");
      const weekIdx = Math.round((monday.getTime() - EPOCH_MON.getTime()) / (7 * 86400000));
      const blockStartWeek = Math.floor(weekIdx / n) * n;
      const start = new Date(EPOCH_MON);
      start.setDate(EPOCH_MON.getDate() + blockStartWeek * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + n * 7 - 1);
      return { start: fmt(start), end: fmt(end) };
    }
    case "month": {
      const [y, m] = dateStr.split("-").map(Number); // m is 1-based
      const monthIdx = y * 12 + (m - 1);
      const blockStart = Math.floor(monthIdx / n) * n;
      const blockEnd = blockStart + n - 1;
      const sy = Math.floor(blockStart / 12);
      const sm = (blockStart % 12) + 1;
      const ey = Math.floor(blockEnd / 12);
      const em = (blockEnd % 12) + 1;
      const lastDay = new Date(ey, em, 0).getDate();
      return {
        start: `${sy}-${String(sm).padStart(2, "0")}-01`,
        end: `${ey}-${String(em).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
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
