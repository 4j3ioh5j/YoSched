// How the auto-scheduler treats a holiday for staff who are NOT working it.
//
//   "entitlement" — scheduled-workday rule (standard holiday-pay practice): every
//                   staffer for whom the holiday falls on a day they normally work
//                   gets HOL, granted BEFORE the hours fill so it counts toward the
//                   pay-period target (it displaces a fill day — never a 9th day
//                   on top). Staff already holding a work shift on the holiday
//                   (CALL/ORC/ICU…) keep it; approved leave stays leave; staff with
//                   a 0 target (fee-basis) get nothing.
//   "fill"        — legacy: HOL appears only when the hours-fill pass happens to
//                   land a fill day on the holiday; anyone already at target gets X.
//   "none"        — the engine never places HOL; a holiday is a plain day off (X).
//
// A department setting, not a hardcode (handoff 740): which staff are owed a
// holiday — and whether they are owed one at all — is payroll policy.
export type HolidayPolicy = "entitlement" | "fill" | "none";

export const HOLIDAY_POLICIES: readonly HolidayPolicy[] = ["entitlement", "fill", "none"];
export const DEFAULT_HOLIDAY_POLICY: HolidayPolicy = "entitlement";

/** STRICT membership check — use to VALIDATE a user write (reject anything else 400). */
export function isHolidayPolicy(v: unknown): v is HolidayPolicy {
  return typeof v === "string" && (HOLIDAY_POLICIES as readonly string[]).includes(v);
}

/** LENIENT parse for PERSISTED reads — unknown/legacy falls back to the default. */
export function parseHolidayPolicy(v: unknown): HolidayPolicy {
  return isHolidayPolicy(v) ? v : DEFAULT_HOLIDAY_POLICY;
}
