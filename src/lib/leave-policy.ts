import { evaluateAvailability, type AvailabilityRule, type PayPeriodRange } from "./availability";

// Card #175 — how much requested leave is charged.
//
//   "up-to-target" — leave is charged only for days the person would have worked,
//                    and never past their pay-period hours target: a requested
//                    leave day they would have been off anyway (their own
//                    availability rules say they don't work it), or one beyond
//                    the target, becomes the off shift (X) instead of leave.
//                    The person is off either way; X honours the request.
//   "always"       — leave on every requested day (the pre-#175 behaviour).
//
// A department setting, not a hardcode: whether leave is charged beyond the
// hours target is payroll policy.
export type LeavePolicy = "up-to-target" | "always";

export const LEAVE_POLICIES: readonly LeavePolicy[] = ["up-to-target", "always"];
export const DEFAULT_LEAVE_POLICY: LeavePolicy = "up-to-target";

/** STRICT membership check — use to VALIDATE a user write (reject anything else 400). */
export function isLeavePolicy(v: unknown): v is LeavePolicy {
  return typeof v === "string" && (LEAVE_POLICIES as readonly string[]).includes(v);
}

/** LENIENT parse for PERSISTED reads — unknown/legacy falls back to the default. */
export function parseLeavePolicy(v: unknown): LeavePolicy {
  return isLeavePolicy(v) ? v : DEFAULT_LEAVE_POLICY;
}

/**
 * The leave days of ONE pay period to turn into the off shift so the person is
 * not charged leave past their target. Pure.
 *
 * @param target  the person's hours target for the pay period
 * @param other   counted hours of every NON-leave cell of theirs in the pay period
 * @param leave   the convertible leave days, each with the hours it counts
 * @returns       dates to convert, latest first; converts a day only while the
 *                total is over target by at least that day's hours, so it never
 *                takes the person under target (a +4 stays +4).
 */
export function excessLeaveDays(
  target: number,
  other: number,
  leave: readonly { date: string; hours: number }[],
): string[] {
  let over = other + leave.reduce((s, l) => s + l.hours, 0) - target;
  const out: string[] = [];
  for (const l of [...leave].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    if (l.hours <= 0) continue;
    if (over < l.hours) continue;
    out.push(l.date);
    over -= l.hours;
  }
  return out;
}

/**
 * Could this person work `date`, by their own availability rules? A requested leave
 * day they could NOT work is a day off anyway, so it is not charged as leave.
 * A conditional rule ("available when CD is working" / "unavailable when …") is judged
 * exactly when `known` says CD's day is decided (card #183). Otherwise it is read
 * optimistically: a conditional AVAILABLE rule counts as met, a conditional UNAVAILABLE
 * rule is ignored. A day that might be worked keeps its leave; any excess is trimmed
 * against the hours target.
 */
export function couldWorkOn(
  rules: readonly AvailabilityRule[],
  date: string,
  payPeriods: readonly PayPeriodRange[],
  // Card #183: the condition person's day when it is already decided — true = working,
  // false = not working, undefined = not decided yet (read optimistically, as above).
  known?: (staffId: string, date: string) => boolean | undefined,
): boolean {
  const kept: AvailabilityRule[] = [];
  for (const r of rules) {
    if (!r.conditionStaffId || !r.conditionType) { kept.push(r); continue; }
    const k = known?.(r.conditionStaffId, date);
    if (k === undefined) {
      // Optimistic: a conditional AVAILABLE rule counts as met, a conditional UNAVAILABLE one is ignored.
      if (r.type === "available") kept.push({ ...r, conditionStaffId: null, conditionType: null });
      continue;
    }
    const met = r.conditionType === "working" ? k : !k;
    if (met) kept.push({ ...r, conditionStaffId: null, conditionType: null });
  }
  return evaluateAvailability(kept, date, [...payPeriods]).available;
}
