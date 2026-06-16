import { matchesWhen, ruleToWhen, type PayPeriodRange } from "./recurrence";

export type ShiftEligibilityRule = {
  shiftTypeId: string;
  type: "eligible" | "ineligible";
  strength: "rule" | "preference";
  // Normalized WHEN columns — sole recurrence representation (slice 7 dropped
  // the legacy dayOfWeek/pattern/cycle* columns).
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

// ── Frequency (HOW-OFTEN) mode helpers (slice 5 picker) ──────────────────────
// The editor surfaces an explicit mode, but the stored shape stays min/max so
// the scheduler is unchanged (checkMinimumTargetMet reads minCount, isAtMaximum
// reads maxCount). These convert between the explicit mode and the min/max pair.
export type FrequencyMode = "atLeast" | "atMost" | "exactly" | "between";

export function frequencyModeOf(t: { minCount: number; maxCount?: number | null }): FrequencyMode {
  const min = t.minCount ?? 0;
  const max = t.maxCount ?? null;
  if (max == null) return "atLeast"; // no upper bound
  if (min <= 0) return "atMost"; // floor of 0 → only a cap
  if (min === max) return "exactly";
  return "between";
}

// Inverse of frequencyModeOf. `a` is the primary count (min / exact / lower
// bound); `b` is the cap (used by atMost / upper bound of between).
export function applyFrequencyMode(
  mode: FrequencyMode,
  a: number,
  b: number,
): { minCount: number; maxCount: number | null } {
  switch (mode) {
    case "atLeast":
      return { minCount: a, maxCount: null };
    case "atMost":
      return { minCount: 0, maxCount: b };
    case "exactly":
      return { minCount: a, maxCount: a };
    case "between":
      return { minCount: a, maxCount: b };
  }
}

const WINDOW_UNIT_LABELS: Record<ShiftMinTarget["window"], { one: string; many: string }> = {
  week: { one: "week", many: "weeks" },
  pay_period: { one: "pay period", many: "pay periods" },
  month: { one: "month", many: "months" },
  days: { one: "day", many: "days" },
};

// Window phrase: "pay period" / "3 pay periods". "days" is a ROLLING window
// (windowDays), labelled "rolling N days" so it isn't confused with the fixed
// week/pay-period/month buckets. Unknown window strings fall back to the raw
// value rather than throwing, so legacy/invalid rows still render.
export function describeWindow(t: Pick<ShiftMinTarget, "window" | "windowDays" | "windowCount">): string {
  if (t.window === "days") {
    const d = Math.max(1, Math.floor(t.windowDays ?? 7));
    return `rolling ${d} ${d === 1 ? "day" : "days"}`;
  }
  const n = Math.max(1, Math.floor(t.windowCount ?? 1));
  const lbl = WINDOW_UNIT_LABELS[t.window] ?? { one: t.window, many: `${t.window}s` };
  return n === 1 ? lbl.one : `${n} ${lbl.many}`;
}

// Natural-language summary of a target, e.g. "At least 2 per 3 pay periods".
// Renders existing/invalid rows gracefully — a between row with min > max is
// ordered low-to-high rather than printing "Between 3 and 1".
export function describeFrequency(t: ShiftMinTarget): string {
  const mode = frequencyModeOf(t);
  const min = t.minCount ?? 0;
  const max = t.maxCount ?? 0;
  const count =
    mode === "atLeast"
      ? `At least ${min}`
      : mode === "atMost"
        ? `At most ${max}`
        : mode === "exactly"
          ? `Exactly ${min}`
          : `Between ${Math.min(min, max)} and ${Math.max(min, max)}`;
  return `${count} per ${describeWindow(t)}`;
}

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
