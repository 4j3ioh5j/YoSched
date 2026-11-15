import { computeFairness, type FairnessSummary, type EquityFactor } from "./fairness";
import { evaluateAvailability, getBaseWorkDays, type AvailabilityRule, type PayPeriodRange } from "./availability";
import { type FollowRuleRow, buildFollowRuleMap, isShiftAllowedAfter } from "./follow-rules";
import { buildDayCapLookup } from "./day-cap";
import { evaluateShiftEligibility, getWindowBounds, countInWindow, checkMinimumTargetMet, isAtRollingMaximum, type ShiftEligibilityRule, type ShiftMinTarget } from "./shift-eligibility";
import { foldRequestsForDate, detectRequestConflicts, coversDate, parseOffStrategyOrder, LEAVE_STRATEGY_PREFIX, type ScheduleRequestData, type FoldedRequests, type PendingRequestMode, type RequestConflictPolicy } from "./schedule-requests";
import { matchesWhen, standingToWhen, ruleToWhen } from "./recurrence";
import { type ShiftShareBasis } from "./shift-share";
import { type HolidayPolicy, resolveHolidayShift } from "./holiday-policy";
import { buildHolidayGroups, type HolidayRuleSpec, type HolidayGroup, type HolidayGroupSlot } from "./holiday-rules";
import { couldWorkOn, excessLeaveDays, type LeavePolicy } from "./leave-policy";
import { parseHoursPolicy, type HoursPolicy } from "./autogen-hours-policy";
import { tallyBalances, sharesOf, spreadPenalty, spreadChange, addDays, type BalanceTally } from "./shift-balance";
import { gapBreaks, gapList, gapListShrank, gapTrialBeats, type GapTrialOutcome } from "./shift-gap";
import { readTuning, isWeekendDate, weekendSecondDow, type SchedulerTuning } from "./scheduler-tuning";

export type ScheduleStaff = {
  id: string;
  initials: string;
  /** 0 when the person's employment type has no FTE % (card #71). */
  ftePercentage: number;
  /** Card #71: fixed hours per pay period (types without an FTE %), else null. Replaces the FTE target. */
  fixedHoursPerPp: number | null;
  /** Card #71: counted in fairness (the employment type's includedInFairness setting). */
  inFairness: boolean;
  eligibleShiftTypeIds: string[];
  availabilityRules: AvailabilityRule[];
  isActive: boolean;
  isAutoScheduled: boolean;
  specialQualifications: string[];
  shiftEligibilityRules?: ShiftEligibilityRule[];
  shiftMinimumTargets?: ShiftMinTarget[];
  // Card #203: when the person joined (staff created; YYYY-MM-DD) and temporary-staff dates.
  // Before joining (or outside the temp dates) they are not owed a share of any shift.
  createdOn?: string | null;
  tempStartDate?: string | null;
  tempEndDate?: string | null;
  // Card #203: the day each shift was ticked for them (shiftTypeId → YYYY-MM-DD). They are
  // owed a share of that shift only from then on. Missing → no limit.
  eligibleSince?: Record<string, string>;
};

export type ScheduleShiftType = {
  id: string;
  code: string;
  name: string;
  defaultHours: number; // weekday hours (the base value)
  defaultHoursWeekend: number; // hours on Sat/Sun; 0 = does not accrue weekend hours
  defaultHoursHoliday: number; // hours on a holiday; 0 = none. Holiday wins over weekend.
  countsTowardFte: boolean;
  countsAsHolidayWork: boolean;
  isLeave: boolean;
  isOffShift: boolean;
  isFillShift: boolean;
  sortOrder: number; // configured display order; orders OR-request placement deterministically
  schedulePriority: number | null;
  weekendPaired: boolean;
  holidayWeekendPaired: boolean;
  // Card #178: for each person, the marked shifts (together) are spread across the weeks.
  spreadOverMonth?: boolean;
  // Card #203: "Keep counts even across months" — the running balance (cells since the
  // department's shiftBalanceFrom) shares this shift out; earlier months only break ties.
  evenAcrossMonths?: boolean;
  // Card #260: for one person, at least this many days between two of this shift (days in a
  // row are one stretch). null/absent = off. "rule" = Hard (never closer), else Prefer.
  minGapDays?: number | null;
  minGapStrength?: string;
  ignoresWorkingDays: boolean;
  category: string;

  autoSchedulable: boolean;
};

export type ScheduleAssignment = {
  staffId: string;
  date: string;
  shiftTypeId: string;
  code: string;
  isLocked: boolean;
  // Provenance of the cell: "manual" (typed by a human), "auto" (engine-placed),
  // "imported", "request". The engine treats a hand-placed cell as fixed — it is
  // never overwritten, even when it's an unlocked day-off ("X"). Undefined is
  // treated as non-manual (fillable) so older callers/tests keep prior behavior.
  source?: string;
};

// A required follower (settings-driven): after `sourceShift`, auto-place
// `followerShift` on the next eligible day. scope "each_day" = after every
// occurrence (e.g. ORC→X recovery); "each_run" = once after a consecutive run
// (e.g. a CALL weekend → one ADM). countsTowardTargets decides whether the
// placed follower satisfies staffing/min-max targets for its own shift (its
// worked hours always count toward FTE regardless).
export type RequiredFollowerRow = {
  sourceShiftId: string;
  followerShiftId: string;
  scope: string;
  countsTowardTargets: boolean;
};

type PayPeriod = {
  startDate: string;
  endDate: string;
  targetHours: number;
};

// Card #210: holidayTypeId links a dated holiday to its holiday rules (by id).
type Holiday = { date: string; holidayTypeId?: string | null };

type DesirabilityWeight = {
  shiftTypeId: string;
  dayOfWeek: number;
  weight: number;
};

type StandingCommitment = {
  staffId: string;
  shiftTypeId: string;
  // Unified WHEN columns — sole recurrence representation (slice 7 dropped the
  // legacy dayOfWeek + frequency columns). standingToWhen reads these.
  whenKind?: string | null;
  whenDays?: number[] | null;
  whenPpWeek?: number | null;
  whenOrds?: number[] | null;
  whenCycleUnit?: string | null;
  whenCycleN?: number | null;
  whenCycleOffset?: number | null;
};

type StaffOverride = {
  staffId: string;
  shiftTypeId: string;
  durationHrs: number;
  // Day-type-aware overrides. When null/undefined, fall back to durationHrs
  // (legacy single value applies to both weekday and weekend).
  durationHrsWeekday?: number | null;
  durationHrsWeekend?: number | null;
  // Null/undefined → mirror the weekend resolution (legacy rows had no holiday
  // value; holidays were valued at the override's weekend hours).
  durationHrsHoliday?: number | null;
};

// A day's "kind" for hour math. Holiday takes precedence over weekend (a holiday
// that falls on a Saturday is valued as a holiday, not a weekend).
export type DayType = "weekday" | "weekend" | "holiday";

// Resolved per-(staff,shiftType) hour override, split by day type.
export type ShiftHourOverride = { weekday: number; weekend: number; holiday: number };

// Resolve a stored per-staff override into concrete per-day-type hours. The
// day-type columns fall back to the legacy single `durationHrs`; an unset
// holiday value mirrors the (resolved) weekend value, preserving how holidays
// were valued before the holiday column existed.
export function resolveShiftHourOverride(o: StaffOverride): ShiftHourOverride {
  const weekend = o.durationHrsWeekend ?? o.durationHrs;
  return {
    weekday: o.durationHrsWeekday ?? o.durationHrs,
    weekend,
    holiday: o.durationHrsHoliday ?? weekend,
  };
}

type DayPreference = {
  staffId: string;
  dayOfWeek: number;
  preference: string;
};

type StaffingRequirement = {
  shiftTypeId: string; // Staffing Rules are linked to the shift, not its code (a rename changes nothing)
  // Wire compatibility only: the input bundle (GET /api/auto-schedule/inputs) also carries the
  // shift's CURRENT code (derived from shift_types, not a stored column) so a grid tab still
  // running a pre-id-link engine bundle keys its minimums and caps correctly. The engine itself
  // never reads it. Keep it until old bundles are version-gated (Codex #262).
  shiftCode?: string;
  dayKey: string;
  minCount: number;
  // Preferred (safe) headcount — the day-balance threshold for the fill shift
  // (handoff #743). A discretionary day off avoids dates whose projected fill
  // count would fall below this. 0 / undefined = no preference.
  preferredCount?: number;
  // Most staff on this shift that day ("Max" in Staffing Rules); null/undefined = no
  // limit. Resolved per date by src/lib/day-cap.ts (holiday row on holidays).
  maxCount?: number | null;
};

type SchedulingPreferences = {
  prefer3DayWeekends: boolean;
  prefer4DayWeekends: boolean;
  preferSequentialOff: boolean;
  sequentialOffWeight: number;
  threeDayWeekendWeight: number;
  fourDayWeekendWeight: number;
  // Card #215: tuning numbers from Settings (src/lib/scheduler-tuning.ts). Read leniently: a
  // missing or bad value is the column default, which is what the engine always used.
  spreadRadiusDays?: SchedulerTuning["spreadRadiusDays"];
  evenBandCalls?: SchedulerTuning["evenBandCalls"];
  softRequestOffWeight?: SchedulerTuning["softRequestOffWeight"];
  softAvoidFollowWeight?: SchedulerTuning["softAvoidFollowWeight"];
  scarcePoolSize?: SchedulerTuning["scarcePoolSize"];
  weekendStartDow?: SchedulerTuning["weekendStartDow"];
  pendingRequestMode?: PendingRequestMode; // how to treat PENDING requests; default "off"
  maxLeavePerDay?: number; // soft cap on staff away per day; 0/undefined = no cap (warn-only)
  requestConflictPolicy?: RequestConflictPolicy; // forced-request contention resolution; default "reconcile"
  shiftShareBasis?: ShiftShareBasis; // split of a scheduled shift's slots across eligible staff: "fte" (default) | "head"
  holidayPolicy?: HolidayPolicy; // who is owed HOL on a holiday: "entitlement" (default) | "fill" (legacy) | "none"
  holidayShiftId?: string | null; // card #207: the shift credited on a holiday, by id (null/undefined = none chosen)
  leaveHoursPolicy?: LeavePolicy; // card #175: leave only on days they'd work, up to the PP target ("up-to-target", default) | "always"
  shiftBalanceFrom?: string | null; // card #203: first day counted by "Keep counts even across months" (null = this run only)
};

// Card #175: FTE-counted hours of one cell — the same math as the engine's
// ppHoursForStaff (countsTowardFte, per-staff hour overrides, day type holiday >
// weekend > weekday). Shared with request approval so both writers cap leave alike.
// Card #215: the weekend comes from the same Settings value the engine reads.
export function countedHoursFn(input: Pick<AutoScheduleInput, "shiftTypes" | "staffOverrides" | "holidays" | "schedulingPreferences">): (staffId: string, shiftTypeId: string, date: string) => number {
  const weekendStart = readTuning(input.schedulingPreferences).weekendStartDow;
  const stById = new Map(input.shiftTypes.map((s) => [s.id, s] as const));
  const overrides = new Map<string, ShiftHourOverride>();
  for (const o of input.staffOverrides) overrides.set(`${o.staffId}:${o.shiftTypeId}`, resolveShiftHourOverride(o));
  const holidaySet = new Set(input.holidays.map((h) => h.date));
  return (staffId, shiftTypeId, date) => {
    const st = stById.get(shiftTypeId);
    if (!st?.countsTowardFte) return 0;
    return getShiftHours(staffId, st, overrides, dayTypeAt(date, holidaySet, weekendStart));
  };
}

// Card #175: the step of an off-shift (X) cell the engine placed on a requested
// leave day instead of the leave shift (the day was off anyway, or past target).
export const LEAVE_OFF_STEP = "request-leave-off";

export type Suggestion = {
  staffId: string;
  date: string;
  shiftTypeId: string;
  code: string;
  reason: string;
  step: string;
  confidence: number;
};

// Global quality objective (#224 item 4, Slice 4a). Grades a FINISHED schedule —
// it does NOT change how the engine builds one. `rank` is a lexicographic key in
// #220 precedence order (each element "lower is better"): compare two schedules
// element-by-element, first difference decides — so a better higher-priority term
// is never traded for a lower one. Slice 2a SPLIT the old aggregate tiers so admins
// can rank them independently (handoff #376): coverage / hardLimits (was the single
// `coverageAndHardLimits` T0) and overHours / underHours (was the two-directional
// `ppHours` T1). Default order [hardLimits, coverage, overHours, underHours,
// requests, fairness]. Day-off quality (#226) is a reserved lower tier, added later.
export type ScheduleQuality = {
  breakdown: {
    coverage: number;          // unmet coverage minimums NOT sanctioned by a human-approved/locked cell
    hardLimits: number;        // hard per-staff MIN shortfall + hard per-staff (rolling) MAX overage
    overHours: number;         // Σ max(0, worked − target) over staff×PP (measures #217, over side)
    underHours: number;        // Σ max(0, target − worked) over staff×PP (measures #217, under side)
    requestsDenied: number;    // non-human-approved REQUEST_SHIFT work-days not honored, per covered date (#221)
    fairnessSpread: number;    // stddev of FTE-normalized desirability load across staff
    // Derived aggregate (coverage + hardLimits). NOT a rank tier — kept so the
    // feasibility floor in autoScheduleCandidates keeps its Slice-1 meaning until
    // the Slice-2b floor redesign. Equals the old T0 `hardBreaches`.
    hardBreaches: number;
    // Measurement only (NOT in `rank`): total Σ(required − assigned) coverage gap
    // across all date×shift minimums, counted UNCONDITIONALLY — including gaps
    // `coverage` excludes because they're sanctioned by a locked/approved cell.
    // Used by the Live "expanding freeing" re-solve (#248 Option 4) to tell whether
    // an edit opened a coverage hole that freeing more cells could let the engine
    // backfill (locked survivors mask such a hole from `coverage`).
    coverageShortfall: number;
  };
  rank: number[];
};

export type AutoScheduleResult = {
  suggestions: Suggestion[];
  warnings: string[];
  stats: {
    totalSlotsFilled: number;
    byStep: Record<string, number>;
  };
  quality: ScheduleQuality;
  // Card #203: for each "Keep counts even across months" shift, every scheduled person's balance
  // (got − expected, in shifts) at the end of the run: this calendar month, and carried from
  // the department's start date to the month's 1st. Absent when no shift is marked.
  balances?: Record<string, Record<string, { run: number; carried: number }>>;
};

// Lexicographic comparison of two schedule qualities (lower rank = better).
// Returns <0 if `a` is better, >0 if `b` is better, 0 if equivalent. This is the
// ranking rule multi-option (Slice 4b) uses to surface the best candidate.
export function compareScheduleQuality(a: ScheduleQuality, b: ScheduleQuality): number {
  const ra = a.rank, rb = b.rank;
  const n = Math.max(ra.length, rb.length);
  for (let i = 0; i < n; i++) {
    const av = ra[i] ?? 0, bv = rb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Admin-configurable order of the negotiable objective factors (#252, Slice 1). One
// entry per AutoGenFactor row; the engine reorders `rank[]` to match. Optional on the
// input — when absent or invalid the engine uses DEFAULT_FACTOR_ORDER, so default
// output is byte-for-byte unchanged from the pre-config hardcoded behavior.
// `hoursPolicy` (optional; only meaningful on overHours / underHours) — see autogen-hours-policy.ts.
export type AutoGenFactorConfig = { key: string; sortOrder: number; enabled: boolean; hoursPolicy?: HoursPolicy };

// The canonical lexicographic order — also the fallback. Each key maps to one of the
// already-computed breakdown terms in buildRankFromConfig. Slice 2a split the old
// aggregate tiers (coverageAndHardLimits → hardLimits + coverage; ppHours → overHours
// + underHours). Default protects hard caps and ranks coverage above BOTH hour terms.
export const DEFAULT_FACTOR_ORDER = [
  "hardLimits",
  "coverage",
  "overHours",
  "underHours",
  "requests",
  "fairness",
] as const;

// Build the lexicographic rank vector from the configured factor order. `terms` holds
// the computed objective values keyed by factor. The config is HONORED only when it is
// well-formed — every known factor present and enabled — otherwise we fall back to
// DEFAULT_FACTOR_ORDER. A config that drops, disables, duplicates, or adds an unknown
// factor is treated as invalid here so no factor can be silently demoted (mirrors the
// independent feasibility floor in autoScheduleCandidates — Codex #1752 W1).
// The effective (validated-or-default) factor order for a run. Single source of the
// validity contract so the GRADER (buildRankFromConfig) and the BUILDER (Slice 2b's
// coverage trades + the candidate floor) never disagree about the order. Honored only
// when the config is EXACTLY the known factors: same count, no duplicates, every entry
// known AND enabled. Anything else → DEFAULT_FACTOR_ORDER (no factor silently demoted).
// Do NOT pre-filter unknowns, or an unknown key alongside a reordered known set would
// slip through and reorder the known factors instead of falling back (Codex #1761).
export function effectiveFactorKeys(config: AutoGenFactorConfig[] | undefined): string[] {
  const known: readonly string[] = DEFAULT_FACTOR_ORDER;
  let order: string[] = [...known];
  if (config && config.length) {
    const keys = new Set(config.map((f) => f.key));
    const valid =
      config.length === known.length &&
      keys.size === config.length &&
      config.every((f) => f.enabled && known.includes(f.key));
    if (valid) order = [...config].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.key);
  }
  return withProhibitedHoursFirst(order, config);
}

// A Prohibited pay-period hours row is never crossed wherever it sits, so for grading
// and every rank comparison it moves to the FRONT (above hard limits and coverage),
// keeping the relative order of the two hours rows when both are Prohibited (then the
// higher one wins a collision between them). Policies are read by key, so they apply
// even when the order itself fell back to the default.
function withProhibitedHoursFirst(order: string[], config: AutoGenFactorConfig[] | undefined): string[] {
  const prohibited = new Set(
    (config ?? []).filter((f) => (f.key === "overHours" || f.key === "underHours") && parseHoursPolicy(f.hoursPolicy) === "prohibited").map((f) => f.key),
  );
  if (prohibited.size === 0) return order;
  return [...order.filter((k) => prohibited.has(k)), ...order.filter((k) => !prohibited.has(k))];
}

// Build the lexicographic rank vector from the configured factor order. `terms` holds
// the computed objective values keyed by factor.
export function buildRankFromConfig(
  terms: Record<(typeof DEFAULT_FACTOR_ORDER)[number], number>,
  config: AutoGenFactorConfig[] | undefined,
): number[] {
  return effectiveFactorKeys(config).map((k) => terms[k as (typeof DEFAULT_FACTOR_ORDER)[number]]);
}

/**
 * Card #71: the person's hours target for a pay period. Fixed hours (types without an FTE %)
 * are absolute; otherwise the PP's hours x FTE (0 for a type without an FTE %).
 * Mirrors src/lib/fte.ts staffPpTarget with the engine's 0-for-no-target convention.
 */
export function targetFor(
  p: { ftePercentage: number; fixedHoursPerPp: number | null },
  pp: { targetHours: number },
): number {
  return p.fixedHoursPerPp != null ? p.fixedHoursPerPp : pp.targetHours * p.ftePercentage;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDow(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

// Classify a date for hour math. Holiday wins over weekend. Card #215: the weekend is the
// Settings value (its first day and the next), never fixed Sat/Sun.
function dayTypeAt(dateStr: string, holidaySet: Set<string>, weekendStart: number): DayType {
  if (holidaySet.has(dateStr)) return "holiday";
  return isWeekendDate(dateStr, weekendStart) ? "weekend" : "weekday";
}

// Hours a shift is worth for a staff on a given day type. A per-staff override
// can value the shift differently per day type; with no override the shift's own
// per-day-type defaults apply. `dayType` is required so every caller decides
// explicitly (capacity-bound callers without a single date take the max/min over
// day types — see call sites and maxShiftHours).
export function getShiftHours(
  staffId: string,
  shiftType: ScheduleShiftType,
  overrides: Map<string, ShiftHourOverride>,
  dayType: DayType
): number {
  const ov = overrides.get(`${staffId}:${shiftType.id}`);
  if (ov) return ov[dayType];
  return dayType === "holiday"
    ? shiftType.defaultHoursHoliday
    : dayType === "weekend"
      ? shiftType.defaultHoursWeekend
      : shiftType.defaultHours;
}

// The most hours this shift could be worth for a staff on any single day —
// used by capacity bounds that have no specific date. A 0 (e.g. weekend/holiday
// that doesn't count) never raises the max, so this matches "the longest real
// day" the staff could work.
function maxShiftHours(
  staffId: string,
  shiftType: ScheduleShiftType,
  overrides: Map<string, ShiftHourOverride>
): number {
  return Math.max(
    getShiftHours(staffId, shiftType, overrides, "weekday"),
    getShiftHours(staffId, shiftType, overrides, "weekend"),
    getShiftHours(staffId, shiftType, overrides, "holiday"),
  );
}

// The most hours a staff member could work in a single day, given the shifts
// they can actually receive. This bounds "can this person still reach their
// pay-period hour target in the days that remain?" Valuing every open day at
// only the (short) fill shift understates real capacity — staff work 12h/16h
// shifts too — and falsely excludes full-timers from long shifts (e.g. ORC),
// which is the ORC under-distribution bug. Restrict to shifts the staff is
// eligible for, that count toward FTE, are real work (not off/leave), are
// auto-schedulable, and carry positive hours. Returns 0 when none qualify, so
// callers can fall back to that staff's fill-shift hours.
export function maxReachableDailyHours(
  staff: ScheduleStaff,
  shiftTypes: ScheduleShiftType[],
  overrides: Map<string, ShiftHourOverride>
): number {
  let max = 0;
  for (const st of shiftTypes) {
    if (!staff.eligibleShiftTypeIds.includes(st.id)) continue;
    if (!st.countsTowardFte || st.isOffShift || st.isLeave || !st.autoSchedulable) continue;
    // No single date here — this bounds capacity, so take the largest day type
    // so a full-timer is never wrongly excluded from reaching target.
    const hrs = maxShiftHours(staff.id, st, overrides);
    if (hrs > max) max = hrs;
  }
  return max;
}

function prevDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

function nextDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(a + "T12:00:00").getTime() - new Date(b + "T12:00:00").getTime()) / 86400000
  );
}

// Deterministic 32-bit string hash (FNV-1a). Used ONLY as the final seeded
// tiebreak in multi-option candidate generation (Slice 4b) — never for any
// constraint, coverage, or quality decision — so its statistical bias is
// irrelevant; all it must do is map equal strings to equal numbers and vary by
// seed. Pure + deterministic (no Math.random), so a given seed+input always
// reproduces the same schedule (resume-safe). Math.imul keeps the 32-bit
// multiply exact across engines.
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Find the combination of `count` dates from `candidates` that maximizes
// the minimum gap between any two selected dates (and optionally existing
// anchor dates like previously-assigned ORC shifts for the same staff).
export function bestSpread(
  candidates: string[],
  count: number,
  anchors: string[],
  isValid: (picked: string[], next: string) => boolean,
  // Seeded tiebreak (Slice 4b). When provided, equal-minGap/equal-length combos
  // are broken by the lower tieKey instead of "first wins". Omitted (or seed 0)
  // ⇒ unchanged first-wins behavior, so seed 0 reproduces the pre-4b output.
  tieKey?: (combo: string[]) => number,
): string[] {
  if (candidates.length <= count) {
    // Must use all — just filter for validity
    const valid: string[] = [];
    for (const d of candidates) {
      if (isValid(valid, d)) valid.push(d);
    }
    return valid;
  }

  let bestCombo: string[] = [];
  let bestMinGap = -1;

  const comboSet = new Set<string>();
  function score(combo: string[]): number {
    comboSet.clear();
    for (const d of combo) comboSet.add(d);
    const all = [...combo, ...anchors].sort();
    if (all.length < 2) return Infinity;
    let minGap = Infinity;
    for (let i = 1; i < all.length; i++) {
      if (!comboSet.has(all[i]) && !comboSet.has(all[i - 1])) continue;
      minGap = Math.min(minGap, daysBetween(all[i], all[i - 1]));
    }
    return minGap;
  }

  // Recursive combination generator — bounded by C(~10, 2-3) ≈ 45-120
  function search(start: number, picked: string[]) {
    if (picked.length === count) {
      const s = score(picked);
      if (s > bestMinGap || (s === bestMinGap && picked.length > bestCombo.length)) {
        bestMinGap = s;
        bestCombo = [...picked];
      } else if (tieKey && s === bestMinGap && picked.length === bestCombo.length &&
                 bestCombo.length > 0 && tieKey(picked) < tieKey(bestCombo)) {
        bestCombo = [...picked];
      }
      return;
    }
    const remaining = count - picked.length;
    for (let i = start; i <= candidates.length - remaining; i++) {
      if (isValid(picked, candidates[i])) {
        picked.push(candidates[i]);
        search(i + 1, picked);
        picked.pop();
      }
    }
  }

  search(0, []);
  return bestCombo;
}

export type AutoScheduleInput = {
  dates: string[];
  staff: ScheduleStaff[];
  shiftTypes: ScheduleShiftType[];
  existingAssignments: ScheduleAssignment[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  desirabilityWeights: DesirabilityWeight[];
  standingCommitments: StandingCommitment[];
  staffOverrides: StaffOverride[];
  /** Card #204: ignored (retired hidden table); kept optional so an older caller still type-checks. */
  dayPreferences?: DayPreference[];
  historicalAssignments: ScheduleAssignment[];
  staffingRequirements: StaffingRequirement[];
  schedulingPreferences: SchedulingPreferences;
  equityFactors: EquityFactor[];
  followRules?: FollowRuleRow[];
  // Card #177: soft follow rules — "avoid `avoidShiftId` the day after `sourceShiftId`".
  followAvoids?: { sourceShiftId: string; avoidShiftId: string }[];
  scheduleRequests?: ScheduleRequestData[];
  requiredFollowers?: RequiredFollowerRow[];
  // Admin-configured objective factor order (#252, Slice 1). Absent/invalid ⇒ the
  // engine uses DEFAULT_FACTOR_ORDER, so default output is unchanged.
  factorOrder?: AutoGenFactorConfig[];
  // Tests only (card #176): skip the compound hours repair, so a test can compare a run with it
  // against the same run without it. Never set by the input builder.
  skipCompoundRepairForTest?: boolean;
  /** Test-only (card #232): skip finishing half pairs, to exercise the later repairs on the old shapes. */
  skipFinishPairsForTest?: boolean;
  /** Test-only (card #233): skip the joint day choice of paired spread shifts (the old greedy days). */
  skipJointSpreadForTest?: boolean;
  /** Test-only (card #260): place each pay period once, with the minimum-gap host keys (no with/without trial). */
  skipGapTrialForTest?: boolean;
  /** Test-only (card #259): skip Phase C of the compound repair (mixing in wanted shifts), to compare a run with and without it. */
  skipShiftMixForTest?: boolean;
  /** Test-only (card #233): lower the joint day choice's per-PP bounds (default 200 swaps / 50k checks). */
  jointSpreadLimitsForTest?: { swaps: number; checks: number };
  // Multi-option candidate seed (Slice 4b). 0/undefined ⇒ the canonical schedule,
  // byte-for-byte identical to the pre-4b output (guaranteed by snapshot test).
  // A positive seed appends a deterministic hash AFTER every existing tiebreak
  // cascade, reordering ONLY true ties (no individually-infeasible placement).
  // Because the engine is greedy, a different tie-order CAN still shift the final
  // coverage — so a raw seeded run may end with more hard breaches than canonical;
  // autoScheduleCandidates filters those out (it never surfaces a candidate worse
  // than canonical on the inviolable tier). Use that, not raw seeds, for options.
  seed?: number;
  // Card #174: the first date this run may write (YYYY-MM-DD, the run month's 1st).
  // Earlier dates are read-only context: their cells still count (PP hours, follow
  // rules, rolling windows), but the engine never places anything on them. A run
  // never changes any part of an earlier, completed month. Absent ⇒ no limit.
  writableFrom?: string;
  // Card #203: read-only context. Approved requests from shiftBalanceFrom on (who could take a
  // past slot); pay periods back to shiftBalanceFrom (pay-period rules on past dates); cells in
  // the two weeks after the covering pay periods (how close a late shift is to next month's).
  balanceRequests?: ScheduleRequestData[];
  balancePayPeriods?: PayPeriodRange[];
  spreadContext?: ScheduleAssignment[];
  // Card #210: holiday rules (settings data) — each dated holiday of a rule's type makes a group
  // of (date, shift) days that go to ONE person. holidayRuleContext: read-only cells just after
  // the run (a hand-entered day of a group that reaches past the end); never written.
  holidayRules?: HolidayRuleSpec[];
  holidayRuleContext?: ScheduleAssignment[];
};

export function autoSchedule({
  dates,
  staff,
  shiftTypes,
  existingAssignments,
  payPeriods,
  holidays,
  desirabilityWeights,
  standingCommitments,
  staffOverrides,
  historicalAssignments,
  staffingRequirements,
  schedulingPreferences,
  equityFactors,
  followRules,
  followAvoids,
  scheduleRequests,
  requiredFollowers,
  factorOrder,
  seed,
  writableFrom,
  skipCompoundRepairForTest,
  skipFinishPairsForTest,
  skipJointSpreadForTest,
  skipGapTrialForTest,
  skipShiftMixForTest,
  jointSpreadLimitsForTest,
  balanceRequests,
  balancePayPeriods,
  spreadContext,
  holidayRules,
  holidayRuleContext,
}: AutoScheduleInput): AutoScheduleResult {
  // Card #215: the tuning numbers and the weekend, from Settings.
  const tuning = readTuning(schedulingPreferences);
  const weekendStart = tuning.weekendStartDow;
  const weekendSecond = weekendSecondDow(weekendStart);
  const isWeekend = (dateStr: string): boolean => isWeekendDate(dateStr, weekendStart);
  const dayTypeOf = (dateStr: string, hs: Set<string>): DayType => dayTypeAt(dateStr, hs, weekendStart);
  const spreadRadius = tuning.spreadRadiusDays;
  const isFrozen = (date: string): boolean => !!writableFrom && date < writableFrom;
  // Seeded final tiebreak helper (Slice 4b). seed 0/undefined ⇒ returns 0 for
  // every key, so all seeded comparisons are no-ops and the engine produces its
  // canonical output unchanged. seed > 0 ⇒ a per-key deterministic hash applied
  // strictly AFTER all other tiebreak levels.
  const seedNum = seed ?? 0;
  const seedTie = (key: string): number => (seedNum ? fnv1a(`${seedNum}:${key}`) : 0);
  const suggestions: Suggestion[] = [];
  const warnings: string[] = [];
  const byStep: Record<string, number> = {};

  const holidaySet = new Set(holidays.map((h) => h.date));
  const dateSet = new Set(dates);
  const followMap = buildFollowRuleMap(followRules ?? []);

  const stByCode = new Map<string, ScheduleShiftType>();
  const stById = new Map<string, ScheduleShiftType>();
  for (const st of shiftTypes) {
    stByCode.set(st.code, st);
    stById.set(st.id, st);
  }

  const offShift = shiftTypes.find((st) => st.isOffShift);

  // Required-follower lookup: sourceShiftId → { follower shift, scope, counts }.
  // Settings-driven (no shift codes in code). The recovery-day behavior that used
  // to be derived from a recovery-only follow rule is now just an each_day rule.
  type FollowerSpec = { follower: ScheduleShiftType; scope: string; countsTowardTargets: boolean };
  const followerBySource = new Map<string, FollowerSpec>();
  for (const r of requiredFollowers ?? []) {
    const f = stById.get(r.followerShiftId);
    if (f) followerBySource.set(r.sourceShiftId, { follower: f, scope: r.scope, countsTowardTargets: r.countsTowardTargets });
  }

  // A shift is "away" (off or leave) — requesting one means time off, so a soft such
  // request nudges the staff away from work (see foldRequestsForDate).
  const isAwayShift = (id: string): boolean => {
    const st = stById.get(id);
    return !!st && (st.isLeave || st.isOffShift);
  };

  // Schedule requests, folded per (staff, date) on demand and cached. `pendingMode`
  // decides whether PENDING (unapproved) requests exert force: "off" = approved-only
  // (the request list may still contain pending rows — fold ignores them); "soft" =
  // pending forced to soft; "full" = pending at declared strength. Empty list ⇒ no-op.
  const requestList = scheduleRequests ?? [];
  const pendingMode: PendingRequestMode = schedulingPreferences.pendingRequestMode ?? "off";
  // Contention policy for forced REQUEST_SHIFTs. "reconcile" (default) places them
  // tentatively in STEP 0b and confirms/revokes them in the reconciliation pass after
  // STEP 3b; "honor-always" keeps the pre-#221 force-first-and-keep behavior.
  const reconcilePolicy: RequestConflictPolicy = schedulingPreferences.requestConflictPolicy ?? "reconcile";
  // cellKey → metadata for a tentatively-placed (revocable) forced request. Only
  // populated under "reconcile"; the reconciliation pass consumes & clears it.
  const tentativeMeta = new Map<string, { receivedAt: string }>();
  const foldCache = new Map<string, FoldedRequests>();
  function foldFor(staffId: string, date: string): FoldedRequests {
    const key = `${staffId}:${date}`;
    let folded = foldCache.get(key);
    if (!folded) {
      folded = foldRequestsForDate(requestList, staffId, date, isAwayShift, pendingMode);
      foldCache.set(key, folded);
    }
    return folded;
  }

  // ── Day-off fulfillment strategies (slice 2: hold the day + ORC_ADJACENT) ──
  // A "day-off-strategy request" is a PURE day-off ask carrying a non-empty
  // offStrategyOrder: kind OFF, or a REQUEST_SHIFT whose ONLY shift is the off
  // shift (the staff "day off" path). A mixed Off-OR-work REQUEST_SHIFT is NOT one
  // — it's a flexible OR ask and gets no strategy treatment. The order is honored
  // as a soft, lowest-priority bias; LEAVE/ORL_PAIR fulfillment lands in slice 3.
  const offShiftId = offShift?.id ?? null;

  function pureOffStrategyOrder(r: ScheduleRequestData): string[] {
    const order = parseOffStrategyOrder(r.offStrategyOrder);
    if (order.length === 0) return [];
    const isPureOff =
      r.kind === "OFF" ||
      (r.kind === "REQUEST_SHIFT" && offShiftId !== null && r.shiftTypeIds.length === 1 && r.shiftTypeIds[0] === offShiftId);
    return isPureOff ? order : [];
  }

  // Active given the pending mode (mirrors fold's status gate): approved always;
  // pending only when the mode honors pending at all ("soft"/"full").
  function strategyRequestActive(r: ScheduleRequestData): boolean {
    if (r.status === "approved") return true;
    if (r.status === "pending") return pendingMode !== "off";
    return false;
  }

  // EFFECTIVE-hard day-off hold on (staff, date): approved-hard, or pending-hard only
  // under "full" mode (mirrors foldRequestsForDate's pending→soft downgrade — pending
  // under "soft" does NOT hold). Returns the order when a hold applies, else null.
  function heldDayOffOrder(staffId: string, date: string): string[] | null {
    if (requestList.length === 0) return null;
    for (const r of requestList) {
      if (r.staffId !== staffId || !coversDate(r, date)) continue;
      if (!strategyRequestActive(r) || r.strength !== "hard") continue;
      if (r.status === "pending" && pendingMode === "soft") continue; // downgraded → soft
      if (pureOffStrategyOrder(r).length > 0) return pureOffStrategyOrder(r);
    }
    return null;
  }

  // Does the staff prefer ORC-the-day-before to free an off on `date`? True when an
  // active pure-off request covering date ranks ORC_ADJACENT before any LEAVE token.
  // Strength-agnostic — it's only a soft tie-break for who fills an ORC slot.
  function prefersOrcAdjacentOff(staffId: string, date: string): boolean {
    if (requestList.length === 0) return false;
    for (const r of requestList) {
      if (r.staffId !== staffId || !coversDate(r, date)) continue;
      if (!strategyRequestActive(r)) continue;
      const order = pureOffStrategyOrder(r);
      const orcIdx = order.indexOf("ORC_ADJACENT");
      if (orcIdx === -1) continue;
      const leaveIdx = order.findIndex((t) => t.startsWith(LEAVE_STRATEGY_PREFIX));
      if (leaveIdx === -1 || orcIdx < leaveIdx) return true;
    }
    return false;
  }

  // An "ORC-like" shift triggers a post-call day off: it has an each_day required
  // follower that is itself an off shift (settings-driven; no hardcoded codes).
  function isPostCallSource(st: ScheduleShiftType): boolean {
    const spec = followerBySource.get(st.id);
    return !!spec && spec.scope === "each_day" && spec.follower.isOffShift;
  }

  // A working shift is anything that isn't an off-shift or a leave shift. A hard
  // OFF request forbids working shifts but still allows OFF / leave placement.
  function requestBlocksWork(staffId: string, date: string, st: ScheduleShiftType): boolean {
    if (requestList.length === 0) return false;
    const folded = foldFor(staffId, date);
    if (folded.forbidWorking && !st.isOffShift && !st.isLeave) return true;
    // Card #175: a hard-leave day is a day off — no work over it, even when the
    // engine placed X there instead of the leave shift.
    if (folded.leaveShiftTypeId && !st.isOffShift && !st.isLeave) return true;
    if (folded.forbiddenShiftIds.has(st.id)) return true;
    // An effective-hard PURE-off day-off-strategy request forbids work on its date —
    // the same gate a kind:"OFF" request gets. STEP 0b pre-places the off shift, but
    // that cell is unlocked and any later isAvailable-gated work placement (staffing
    // fill, FTE fill, reconciliation re-home) would otherwise overwrite it; this hold
    // keeps the requested day genuinely off so the strategies act on a real day off.
    if (!st.isOffShift && !st.isLeave && heldDayOffOrder(staffId, date)) return true;
    return false;
  }

  // Soft request bias for placing `st` on `date`: positive = prefer this staff,
  // negative = prefer to spare them. Used only as a tiebreak below hard staffing
  // need, so soft requests advise without overriding fairness/coverage.
  function requestBias(staffId: string, date: string, st: ScheduleShiftType): number {
    if (requestList.length === 0) return 0;
    const folded = foldFor(staffId, date);
    let bias = 0;
    if (folded.preferredShiftIds.has(st.id)) bias += 1;
    if (folded.avoidedShiftIds.has(st.id)) bias -= 1;
    if (folded.avoidWorking && !st.isOffShift && !st.isLeave) bias -= 1;
    // ORC_ADJACENT: nudge an ORC-like (post-call) shift toward a staffer who wants
    // the NEXT day off via post-call and ranks it ahead of burning leave. Pure
    // tie-break (same ±1 tier) — it never outranks any hard/soft staffing need.
    if (isPostCallSource(st) && prefersOrcAdjacentOff(staffId, nextDate(date))) bias += 1;
    return bias;
  }

  const overrideMap = new Map<string, ShiftHourOverride>();
  for (const o of staffOverrides) {
    overrideMap.set(`${o.staffId}:${o.shiftTypeId}`, resolveShiftHourOverride(o));
  }

  // `noCount` marks a cell placed as a non-counting required follower: its worked
  // hours still count toward FTE, but it does NOT satisfy staffing requirements or
  // min/max targets for its shift (see countsTowardTargets).
  // `step` records the engine step that placed the cell (undefined for cells
  // loaded from existingAssignments). The hour-balancing repair (STEP 3b) reads
  // it to swap only scheduler-placed coverage/fill cells, never authoritative
  // placements (leave, standing commitments, honored requests, followers).
  const grid = new Map<string, { shiftTypeId: string; code: string; locked: boolean; noCount?: boolean; step?: string; source?: string }>();
  for (const a of existingAssignments) {
    grid.set(`${a.staffId}:${a.date}`, {
      shiftTypeId: a.shiftTypeId,
      code: a.code,
      locked: a.isLocked,
      source: a.source,
    });
  }

  const activeStaff = staff.filter(
    (p) => p.isActive && p.isAutoScheduled
  );

  const dwMap = new Map<string, number>();
  for (const dw of desirabilityWeights) {
    dwMap.set(`${dw.shiftTypeId}:${dw.dayOfWeek}`, dw.weight);
  }

  const holidayPolicy: HolidayPolicy = schedulingPreferences.holidayPolicy ?? "entitlement";
  // Card #207: the holiday shift is the one chosen in Settings (by id), and only while it is
  // still a leave shift counting toward the target — entitlement bypasses eligibility and caps.
  const configuredHolShift = resolveHolidayShift(shiftTypes, schedulingPreferences.holidayShiftId);
  const holShift = holidayPolicy === "none" ? null : configuredHolShift;

  // Card #176: STEP 2.75 grants HOL on a holiday a person normally works. Until it has
  // run, the hours checks (ppHoursBlock) must already see that owed HOL, or STEP 2
  // fills a part-timer to target with coverage (a preferred ORC) and the later HOL
  // pushes them over. ONE predicate for both the grant and the reservation.
  let holidaysGranted = false;
  function owedHoliday(staff: ScheduleStaff, date: string, pp: { targetHours: number }): boolean {
    if (holidayPolicy !== "entitlement" || !holShift) return false;
    if (!holidaySet.has(date) || isFrozen(date)) return false;
    if (targetFor(staff, pp) <= 0) return false;
    if (isAssigned(staff.id, date)) return false;
    return evaluateAvailability(staff.availabilityRules, date, payPeriods, (pid, d) => isWorking(pid, d)).available;
  }
  /** HOL hours `staff` will be granted in `pp` by STEP 2.75 (0 once it has run), not
   *  counting the dates being projected — working the holiday itself means no HOL there. */
  function pendingHolidayHours(staff: ScheduleStaff, pp: { startDate: string; endDate: string; targetHours: number }, exclude: string | readonly string[]): number {
    if (holidaysGranted || !holShift) return 0;
    const skip = new Set(typeof exclude === "string" ? [exclude] : exclude);
    let h = 0;
    for (const d of dates) {
      if (d < pp.startDate || d > pp.endDate || skip.has(d)) continue;
      if (!owedHoliday(staff, d, pp)) continue;
      h += holShift.countsTowardFte ? getShiftHours(staff.id, holShift, overrideMap, dayTypeOf(d, holidaySet)) : 0;
    }
    return h;
  }

  // Per-day caps (Staffing Rules "Max") — the same resolver the manual edit paths use.
  const capOf = buildDayCapLookup(staffingRequirements, holidays.map((h) => h.date));

  // ── Card #210: holiday-rule groups and the demand they create ──
  // Every rule day in the run needs one holder of its shift that day, even where the normal
  // minimum is 0 (Thanksgiving Friday): demand = max(normal minimum, groups on that day+shift),
  // capped by the day's Max. A Max of 0 means the shift isn't allowed that day: warned, skipped.
  const ruleGroups: HolidayGroup[] = dates.length > 0 ? buildHolidayGroups(holidays, holidayRules ?? [], dates[0], dates[dates.length - 1]) : [];
  const slotKey = (shiftTypeId: string, date: string): string => `${shiftTypeId}|${date}`;
  const ruleDemand = new Map<string, number>();
  const disallowedSlots = new Set<string>();
  for (const g of ruleGroups) {
    for (const s of g.slots) {
      if (!dateSet.has(s.date)) continue;
      const k = slotKey(s.shiftTypeId, s.date);
      if (capOf(s.shiftTypeId, s.date) === 0) {
        if (!disallowedSlots.has(`${g.key}|${k}`)) {
          disallowedSlots.add(`${g.key}|${k}`);
          warnings.push(`${g.ruleName}: ${shiftTypes.find((t) => t.id === s.shiftTypeId)?.code ?? "?"} is not allowed on ${s.date} (its Max that day is 0); that day of the rule is skipped`);
        }
        continue;
      }
      ruleDemand.set(k, (ruleDemand.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of ruleDemand) {
    const [stId, d] = k.split("|");
    const cap = capOf(stId, d);
    if (cap != null) ruleDemand.set(k, Math.min(n, cap));
  }
  /** A group's slots that may be placed (shift known, not disallowed by a Max of 0). */
  const usableSlots = (g: HolidayGroup): HolidayGroupSlot[] =>
    g.slots.filter((s) => shiftTypes.some((t) => t.id === s.shiftTypeId) && !disallowedSlots.has(`${g.key}|${slotKey(s.shiftTypeId, s.date)}`));
  // (date, shift) days a group claims in this run: the weekend/bridge pairing skips them and the
  // residual fill covers them (card #210 r3).
  const claimedSlots = new Set<string>();
  for (const g of ruleGroups) for (const s of usableSlots(g)) if (dateSet.has(s.date) && !isFrozen(s.date)) claimedSlots.add(slotKey(s.shiftTypeId, s.date));

  // Build staffing requirements lookup: shiftTypeId → Map<dayKey, minCount>
  const reqsByShift = new Map<string, Map<string, number>>();
  for (const sr of staffingRequirements) {
    if (sr.minCount <= 0) continue;
    let dayMap = reqsByShift.get(sr.shiftTypeId);
    if (!dayMap) {
      dayMap = new Map();
      reqsByShift.set(sr.shiftTypeId, dayMap);
    }
    dayMap.set(sr.dayKey, sr.minCount);
  }

  const fairness = computeFairness({
    assignments: [...historicalAssignments, ...existingAssignments].map((a) => ({
      staffId: a.staffId,
      date: a.date,
      shiftType: (() => {
        const st = stById.get(a.shiftTypeId);
        return {
          id: a.shiftTypeId,
          code: a.code,
          defaultHours: st?.defaultHours ?? 0,
          countsTowardFte: st?.countsTowardFte ?? false,
          countsAsHolidayWork: st?.countsAsHolidayWork ?? true,
          isLeave: st?.isLeave ?? false,
        };
      })(),
    })),
    staff: staff.map((p) => ({
      id: p.id,
      initials: p.initials,
      ftePercentage: p.ftePercentage,
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      inFairness: p.inFairness,
      eligibleShiftTypeIds: p.eligibleShiftTypeIds,
    })),
    desirabilityWeights,
    holidays,
    equityFactors,
  });

  // An unlocked off-shift cell ("X") is normally treated as an empty slot the
  // engine may fill. EXCEPTION: a cell a human placed by hand (source "manual")
  // is fixed — the autoscheduler must never overwrite a manual assignment, even
  // a manual day-off. Auto/imported/engine-placed off cells stay fillable;
  // request-backed days off are held separately via requestBlocksWork().
  function isFillableOffCell(cell: { shiftTypeId: string; locked: boolean; source?: string; step?: string }): boolean {
    // Card #175: an X standing in for requested leave ("request-leave-off") is the
    // request's own placement — held like the leave it replaces, never refilled
    // (not by a fill step, a follower, nor STEP 4's day-off pass).
    if (cell.step === LEAVE_OFF_STEP) return false;
    return !!offShift && cell.shiftTypeId === offShift.id && !cell.locked && cell.source !== "manual";
  }

  function getCell(staffId: string, date: string) {
    const cell = grid.get(`${staffId}:${date}`);
    if (cell && isFillableOffCell(cell)) return undefined;
    return cell;
  }

  // ── Card #177: soft "avoid B the day after A" ──
  // A preference only: it orders choices (who, which day, which trade) and never blocks a
  // placement. Block/allow rules (followMap) stay the hard gate.
  const avoidSet = new Set((followAvoids ?? []).map((a) => `${a.sourceShiftId}>${a.avoidShiftId}`));
  const isAvoidedPair = (a: string | null | undefined, b: string | null | undefined): boolean =>
    !!a && !!b && avoidSet.has(`${a}>${b}`);
  /** Avoided pairs that `stId` on `date` would make with the staffer's cells either side. */
  function avoidedPairs(staffId: string, date: string, stId: string): number {
    if (avoidSet.size === 0) return 0;
    let n = 0;
    if (isAvoidedPair(grid.get(`${staffId}:${prevDate(date)}`)?.shiftTypeId, stId)) n++;
    if (isAvoidedPair(stId, grid.get(`${staffId}:${nextDate(date)}`)?.shiftTypeId)) n++;
    return n;
  }
  /** Avoided pairs in a staffer's run of days, reading `cellAt` (a proposed state) for each day. */
  function avoidedInRun(days: Iterable<string>, cellAt: (d: string) => string | null | undefined): number {
    if (avoidSet.size === 0) return 0;
    const pairs = new Set<string>();
    for (const d of days) { pairs.add(prevDate(d)); pairs.add(d); }
    let n = 0;
    for (const a of pairs) if (isAvoidedPair(cellAt(a), cellAt(nextDate(a)))) n++;
    return n;
  }

  // ── Card #178 / #203: "Spread out as much as possible" ──
  // The marked shifts form ONE group per person; the engine prefers placements furthest from
  // the person's other marked shifts (spreadPenalty, two weeks either side). A preference only:
  // it never blocks and ranks below share fairness.
  const spreadIds = new Set(shiftTypes.filter((s) => s.spreadOverMonth).map((s) => s.id));
  // Cells outside the grid, read-only: history (before the covering pay periods) and the two
  // weeks after them (spreadContext). Never written; the grid always wins for its own dates.
  const outsideCells = new Map<string, string>();
  for (const a of historicalAssignments) outsideCells.set(`${a.staffId}:${a.date}`, a.shiftTypeId);
  for (const a of spreadContext ?? []) outsideCells.set(`${a.staffId}:${a.date}`, a.shiftTypeId);
  /** The person's shift on any date: the grid's cell, else a history / forward-context cell. */
  function cellShiftAt(staffId: string, date: string): string | undefined {
    const key = `${staffId}:${date}`;
    const g = grid.get(key);
    if (g) return g.shiftTypeId;
    return outsideCells.get(key);
  }
  /** How bunched a marked shift on `date` would be for the person (0 = nothing within two weeks). */
  function spreadLoad(staffId: string, date: string): number {
    if (spreadIds.size === 0) return 0;
    return spreadPenalty((d) => spreadIds.has(cellShiftAt(staffId, d) ?? ""), date, spreadRadius);
  }

  // ── Card #260: minimum days between two of the same shift, for one person ──
  // Read from the grid, history and next month's cells (cellShiftAt). Hard = a STATE rule:
  // placements are pre-checked here (isAvailable / canHoldForSwap, a group as one unit) and
  // every writer that can remove or overwrite a cell compares the too-close pairs before and
  // after (gapSnapshot / gapNewSince) and rolls back on a new one (Codex #1190). Pairs that
  // already exist (hand-entered) never block a change. Prefer never blocks: it ranks.
  // Card #260: while a pay period of a Prefer-gap shift is placed as if the setting were off
  // (the baseline its Prefer result must beat), its gap reads as off.
  let gapSuspended: string | null = null;
  const gapOf = (st: ScheduleShiftType): number => (st.id !== gapSuspended && st.minGapDays != null && st.minGapDays >= 2 ? Math.floor(st.minGapDays) : 0);
  const gapHard = (st: ScheduleShiftType): boolean => gapOf(st) > 0 && st.minGapStrength === "rule";
  const gapShifts = shiftTypes.filter((s) => gapOf(s) > 0);
  const hardGapShifts = gapShifts.filter(gapHard);
  function holdsAt(staffId: string, stId: string, add?: Iterable<string>): (d: string) => boolean {
    const extra = new Set(add ?? []);
    return (d) => extra.has(d) || cellShiftAt(staffId, d) === stId;
  }
  /** How many NEW too-close pairs the person would get if `dates` (not yet on the grid) held `st`. */
  function gapNewBreaks(staffId: string, st: ScheduleShiftType, dates: string[]): number {
    const n = gapOf(st);
    if (!n || dates.length === 0) return 0;
    const sorted = [...dates].sort();
    const from = sorted[0], to = sorted[sorted.length - 1];
    const before = gapBreaks(holdsAt(staffId, st.id), from, to, n);
    let k = 0;
    for (const pair of gapBreaks(holdsAt(staffId, st.id, dates), from, to, n)) if (!before.has(pair)) k++;
    return k;
  }
  /** The smallest gap the person's stretch of `st` would have to its neighbours with `dates` added (bigger = more room). */
  function gapRoom(staffId: string, st: ScheduleShiftType, dates: string[]): number {
    const n = gapOf(st);
    if (!n || dates.length === 0) return 0;
    const sorted = [...dates].sort();
    const reach = Math.max(n, spreadRadius);
    const gaps = gapList(holdsAt(staffId, st.id, dates), addDays(sorted[0], -reach), addDays(sorted[sorted.length - 1], reach));
    return gaps.length ? Math.min(...gaps, reach) : reach;
  }
  type GapSnap = { from: string; to: string; pairs: Map<string, Set<string>> };
  /** The Hard-gap too-close pairs of these people around these dates, before a change. */
  function gapSnapshot(staffIds: Iterable<string>, dates: Iterable<string>): GapSnap | null {
    if (hardGapShifts.length === 0) return null;
    const ds = [...dates].sort();
    if (ds.length === 0) return null;
    const snap: GapSnap = { from: ds[0], to: ds[ds.length - 1], pairs: new Map() };
    for (const id of new Set(staffIds)) for (const st of hardGapShifts) {
      snap.pairs.set(`${id}|${st.id}`, gapBreaks(holdsAt(id, st.id), snap.from, snap.to, gapOf(st)));
    }
    return snap;
  }
  /**
   * What a set of cell changes would do to minimum gaps, judged on the whole resulting state
   * (removals included): does it add a Hard too-close pair, and how many Prefer pairs does it
   * add (negative: removes)? The grid is changed only for the check and put back exactly.
   */
  function gapEffect(changes: readonly (readonly [string, string, string | null])[]): { hardNew: boolean; preferDelta: number } {
    if (gapShifts.length === 0 || changes.length === 0) return { hardNew: false, preferDelta: 0 };
    const ids = [...new Set(changes.map((c) => c[0]))];
    const ds = changes.map((c) => c[1]).sort();
    const from = ds[0], to = ds[ds.length - 1];
    const prefer = gapShifts.filter((x) => !gapHard(x));
    const preferCount = (): number => {
      let n = 0;
      for (const id of ids) for (const x of prefer) n += gapBreaks(holdsAt(id, x.id), from, to, gapOf(x)).size;
      return n;
    };
    const snap = gapSnapshot(ids, ds);
    const p0 = prefer.length ? preferCount() : 0;
    const saved = changes.map(([id, d]) => [`${id}:${d}`, grid.get(`${id}:${d}`)] as const);
    for (const [id, d, stId] of changes) {
      const key = `${id}:${d}`;
      if (stId === null) grid.delete(key);
      else { const x = stById.get(stId)!; grid.set(key, { shiftTypeId: x.id, code: x.code, locked: false, noCount: false, step: "repair" }); }
    }
    const hardNew = gapNewSince(snap);
    const p1 = prefer.length ? preferCount() : 0;
    for (let i = saved.length - 1; i >= 0; i--) { const [k, v] = saved[i]; if (v) grid.set(k, v); else grid.delete(k); }
    return { hardNew, preferDelta: p1 - p0 };
  }
  /**
   * Would placing `st` on `dates` now (against the grid as it stands at this write) make a
   * Hard-gap too-close pair the person doesn't already have? For the paths that write with
   * their own checks instead of isAvailable (followers, standing commitments, min targets,
   * fill, the holiday entitlement, days off), each checked at its own write (Codex #1198:
   * a batch checked once before it writes goes stale as it writes).
   */
  function hardGapBlocks(staffId: string, st: ScheduleShiftType, dates: string[]): boolean {
    return gapHard(st) && gapNewBreaks(staffId, st, dates) > 0;
  }
  const hardGapWhy = (st: ScheduleShiftType): string => `minimum gap between two ${st.code}: at least ${gapOf(st)} days, Hard`;
  /** " — why" when a Hard gap is what keeps everyone else off this day (else ""), for "No eligible" warnings. */
  function gapCause(st: ScheduleShiftType, dates: string[], pool: ScheduleStaff[]): string {
    if (!gapHard(st)) return "";
    const held = pool.some((p) => dates.every((d) => isAvailable(p, d, st, { skipGap: true })) && !dates.every((d) => isAvailable(p, d, st, { gapGroup: dates })));
    return held ? ` — everyone free to work it would break the minimum gap between two ${st.code} (at least ${gapOf(st)} days, Hard)` : "";
  }
  /** Does the grid now hold a Hard-gap too-close pair that the snapshot didn't? */
  function gapNewSince(snap: GapSnap | null): boolean {
    if (!snap) return false;
    for (const [key, before] of snap.pairs) {
      const [id, stId] = key.split("|");
      const st = stById.get(stId)!;
      for (const pair of gapBreaks(holdsAt(id, stId), snap.from, snap.to, gapOf(st))) if (!before.has(pair)) return true;
    }
    return false;
  }

  // Card #188: a staff card's Prefer eligibility rules rank, never gate — "eligible · Prefer"
  // favours those days (+1 each), "ineligible · Prefer" steers away (−1 each).
  const eligPpRanges = payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
  const preferRuleKeys = new Set(staff.flatMap((p) => (p.shiftEligibilityRules ?? []).filter((r) => r.strength === "preference").map((r) => `${p.id}:${r.shiftTypeId}`)));
  /** The person's soft eligibility score for `stId` on `date` (0 without Prefer rules). */
  function eligPreference(p: ScheduleStaff, stId: string, date: string): number {
    if (!preferRuleKeys.has(`${p.id}:${stId}`)) return 0;
    return evaluateShiftEligibility(p.shiftEligibilityRules ?? [], stId, date, eligPpRanges)?.weight ?? 0;
  }

  function isAssigned(staffId: string, date: string): boolean {
    const cell = grid.get(`${staffId}:${date}`);
    if (!cell) return false;
    if (isFillableOffCell(cell)) return false;
    return true;
  }

  // Card #69: "is this person WORKING that day?", the question conditional
  // availability rules ask ("AB only when CD is working"). Unlike isAssigned
  // (is the cell occupied?), an off or leave cell, locked or not, is NOT working.
  // Same reading as request-approval-outcome's verify and scenario's baseline.
  function isWorking(staffId: string, date: string): boolean {
    const cell = grid.get(`${staffId}:${date}`);
    return !!cell && !isAwayShift(cell.shiftTypeId);
  }

  // `ignoreHardMax` (Slice 2b-2) waives ONLY the hard per-staff rolling-MAX gate so a
  // coverage minimum can be filled by exceeding a hard max when coverage is ranked above
  // hardLimits. Every other gate — eligibility, availability, follow rules, the per-day
  // cap (Staffing Rules Max), one-shift-per-day — still applies. Hard MIN is not an availability
  // gate (it lives in the objective/floor), so only the MAX needs a waiver (Codex #1779).
  // `gapGroup` (card #260): the whole group the day belongs to (a weekend pair, a paired group),
  // so a Hard gap judges it as one stretch; `skipGap` leaves the gap to a caller that checks
  // the whole group itself (completeGroupFor).
  function isAvailable(staff: ScheduleStaff, date: string, st: ScheduleShiftType, opts?: { ignoreHardMax?: boolean; gapGroup?: string[]; skipGap?: boolean }): boolean {
    if (isFrozen(date)) return false;
    if (isAssigned(staff.id, date)) return false;
    // Approved hard requests (OFF / NEGATE_SHIFT) gate every placement that flows
    // through isAvailable (staffing fills, minimum targets, FTE fill shift).
    if (requestBlocksWork(staff.id, date, st)) return false;
    if (staff.shiftEligibilityRules && staff.shiftEligibilityRules.length > 0) {
      const eligResult = evaluateShiftEligibility(
        staff.shiftEligibilityRules, st.id, date,
        payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate })),
      );
      if (eligResult !== null && !eligResult.eligible) return false; // card #188: Prefer never closes a day
    }
    if (!st.ignoresWorkingDays) {
      const avail = evaluateAvailability(
        staff.availabilityRules, date, payPeriods,
        (pid, d) => isWorking(pid, d)
      );
      if (!avail.available) return false;
    }
    const prev = getCell(staff.id, prevDate(date));
    if (prev) {
      const prevSt = stById.get(prev.shiftTypeId);
      if (prevSt && !isShiftAllowedAfter(followMap, prev.shiftTypeId, st.id, st.isOffShift)) return false;
    }
    const next = getCell(staff.id, nextDate(date));
    if (next) {
      const nextSt = stById.get(next.shiftTypeId);
      if (nextSt && !isShiftAllowedAfter(followMap, st.id, next.shiftTypeId, nextSt.isOffShift)) return false;
    }
    if (dayFull(st, date)) return false;
    if (!opts?.ignoreHardMax && isAtMaximum(staff, st, date)) return false;
    // Card #260: never waived (not by ignoreHardMax / coverage over limits): the day stays short.
    if (!opts?.skipGap && gapHard(st) && gapNewBreaks(staff.id, st, opts?.gapGroup ?? [date]) > 0) return false;
    return true;
  }

  function assign(
    staffId: string,
    date: string,
    shiftType: ScheduleShiftType,
    reason: string,
    step: string,
    confidence: number,
    noCount = false
  ) {
    if (isFrozen(date)) return;
    const key = `${staffId}:${date}`;
    const existing = grid.get(key);
    if (existing && !isFillableOffCell(existing)) return;
    grid.set(key, { shiftTypeId: shiftType.id, code: shiftType.code, locked: false, noCount, step });
    suggestions.push({
      staffId,
      date,
      shiftTypeId: shiftType.id,
      code: shiftType.code,
      reason,
      step,
      confidence,
    });
    byStep[step] = (byStep[step] || 0) + 1;
  }

  // Place a required follower after `afterDate` for `staffId`. Skips (and, for a
  // WORK follower, warns) when the next day falls outside the window, is already
  // filled, is a holiday, or the staff is unavailable. An off-shift follower (a
  // recovery day) skips silently — an unavailable next day is already off.
  // Whether the required follower of `sourceShift` on `afterDate` would be placed now:
  // null = it lands; "" = silently not placed; otherwise the reason (warned for a work
  // follower). Card #185: the ONE rule both the placement and the hours projection
  // (ppHoursBlock) read, so the projection never counts a follower that won't land.
  function followerBlock(staffId: string, afterDate: string, sourceShift: ScheduleShiftType): string | null {
    const spec = followerBySource.get(sourceShift.id);
    if (!spec) return "";
    const next = nextDate(afterDate);
    if (!dateSet.has(next)) return ""; // follower would land outside the scheduling window
    const isWorkFollower = !spec.follower.isOffShift && !spec.follower.isLeave;
    const member = activeStaff.find((p) => p.id === staffId);
    if (!member) return "";
    if (isAssigned(staffId, next)) return "cell already filled";
    // Card #75: a WORK follower is a shift like any other — never for a person not eligible for
    // it (unticked in the activation panel). A recovery day off is always fine.
    if (isWorkFollower && !member.eligibleShiftTypeIds.includes(spec.follower.id)) return `not eligible for ${spec.follower.code}`;
    // A WORK follower must not overwrite a day the staff holds off via an effective-hard
    // day-off-strategy request. This path assigns directly (it never flows through
    // isAvailable), so the requestBlocksWork hold wouldn't catch it — check here too.
    // An off-shift follower is fine (the day is meant to be off anyway).
    if (isWorkFollower && heldDayOffOrder(staffId, next)) return "staff requested this day off";
    const avail = evaluateAvailability(member.availabilityRules, next, payPeriods, (pid, d) => isWorking(pid, d));
    if (!avail.available) return "staff unavailable";
    if (holidaySet.has(next) && isWorkFollower) return "holiday";
    if (dayFull(spec.follower, next)) return `Max for ${spec.follower.code} that day already reached`;
    if (hardGapBlocks(staffId, spec.follower, [next])) return hardGapWhy(spec.follower);
    return null;
  }

  function placeFollowerAfter(staffId: string, afterDate: string, sourceShift: ScheduleShiftType) {
    const spec = followerBySource.get(sourceShift.id);
    if (!spec) return;
    const next = nextDate(afterDate);
    const why = followerBlock(staffId, afterDate, sourceShift);
    if (why !== null) {
      const member = activeStaff.find((p) => p.id === staffId);
      const isWorkFollower = !spec.follower.isOffShift && !spec.follower.isLeave;
      // Card #239: a held day that already IS the follower (typed in by hand, say) meets the
      // requirement: nothing is placed and nothing is wrong. Only the warning knows this —
      // followerBlock's answer (read by the hours projections) stays "cell already filled".
      const alreadyThere = why === "cell already filled" && grid.get(`${staffId}:${next}`)?.shiftTypeId === spec.follower.id;
      if (why && member && isWorkFollower && !alreadyThere) warnings.push(`${member.initials}: could not place required ${spec.follower.code} after ${sourceShift.code} on ${next} (${why})`);
      return;
    }
    assign(staffId, next, spec.follower, `Required follower after ${sourceShift.code}`, "follower", 0.95, !spec.countsTowardTargets);
  }

  // each_day: place a follower right after a single occurrence (e.g. ORC→X).
  function placeEachDayFollower(staffId: string, date: string, sourceShift: ScheduleShiftType) {
    const spec = followerBySource.get(sourceShift.id);
    if (spec?.scope === "each_day") placeFollowerAfter(staffId, date, sourceShift);
  }

  // each_run: after a source shift's distribution completes, place ONE follower
  // after the last day of each consecutive run (e.g. a CALL weekend → one ADM).
  function placeRunFollowers(sourceShift: ScheduleShiftType) {
    const spec = followerBySource.get(sourceShift.id);
    if (spec?.scope !== "each_run") return;
    for (const member of activeStaff) {
      for (const d of dates) {
        if (grid.get(`${member.id}:${d}`)?.code !== sourceShift.code) continue;
        // d is a source day; it's a run END unless the next calendar day is also one.
        if (grid.get(`${member.id}:${nextDate(d)}`)?.code === sourceShift.code) continue;
        placeFollowerAfter(member.id, d, sourceShift);
      }
    }
  }

  function ppHoursForStaff(staffId: string, pp: PayPeriod): number {
    let hours = 0;
    const cur = new Date(pp.startDate + "T12:00:00");
    const end = new Date(pp.endDate + "T12:00:00");
    while (cur <= end) {
      const d = toDateStr(cur);
      const cell = getCell(staffId, d);
      if (cell) {
        const st = stById.get(cell.shiftTypeId);
        if (st?.countsTowardFte) {
          // A weekend/holiday the shift doesn't accrue on resolves to 0 hours,
          // so no explicit day-type gate is needed.
          hours += getShiftHours(staffId, st, overrideMap, dayTypeOf(d, holidaySet));
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return hours;
  }

  function fairnessScore(staffId: string): number {
    return fairness.deviations.get(staffId)?.overall ?? 0;
  }

  function sortByFairness(pIds: string[]): string[] {
    return [...pIds].sort((a, b) => fairnessScore(a) - fairnessScore(b));
  }

  const eligibleShiftSets = new Map<string, Set<string>>();
  for (const p of staff) {
    eligibleShiftSets.set(p.id, new Set(p.eligibleShiftTypeIds));
  }

  function eligibleStaff(st: ScheduleShiftType, date?: string): ScheduleStaff[] {
    return activeStaff.filter((p) => {
      // Card #75: no eligibility row → never eligible; rules can only narrow (a hidden
      // "eligible" rule of an unticked person must not grant the shift).
      if (!(eligibleShiftSets.get(p.id)?.has(st.id) ?? false)) return false;
      if (date && p.shiftEligibilityRules && p.shiftEligibilityRules.length > 0) {
        const result = evaluateShiftEligibility(
          p.shiftEligibilityRules, st.id, date,
          payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate })),
        );
        if (result !== null) return result.eligible; // card #188: Prefer never closes a day
      }
      return eligibleShiftSets.get(p.id)?.has(st.id) ?? false;
    });
  }

  // Undefined strength is HARD ("rule"), preserving per-staff target behavior and
  // existing tests. "preference" is SOFT (department-wide Pay-period preferences):
  // biases selection but never gates placement or warns.
  function targetIsHard(t: ShiftMinTarget): boolean {
    return (t.strength ?? "rule") === "rule";
  }

  // Deficit toward minCount targets. `onlyStrength` restricts to hard ("rule") or
  // soft ("preference") targets; omit to count all. Soft and hard deficits are
  // weighed separately in pickStaff so a soft preference never outranks a hard min.
  function getMinimumDeficit(staff: ScheduleStaff, st: ScheduleShiftType, date: string, onlyStrength?: "rule" | "preference"): number {
    if (!staff.shiftMinimumTargets || staff.shiftMinimumTargets.length === 0) return 0;
    const targets = staff.shiftMinimumTargets.filter(
      (t) => t.shiftTypeId === st.id && (onlyStrength == null || (t.strength ?? "rule") === onlyStrength),
    );
    if (targets.length === 0) return 0;

    let maxDeficit = 0;
    for (const target of targets) {
      const bounds = getWindowBounds(
        target, date,
        payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate })),
      );
      if (!bounds) continue;

      const assigned: string[] = [];
      for (const [k, v] of grid.entries()) {
        if (k.startsWith(staff.id + ":") && v.code === st.code && !v.noCount) {
          const d = k.split(":")[1];
          if (d >= bounds.start && d <= bounds.end) assigned.push(d);
        }
      }
      const { met, needed, current } = checkMinimumTargetMet(target, assigned);
      if (!met) maxDeficit = Math.max(maxDeficit, needed - current);
    }
    return maxDeficit;
  }

  // A staff member with an unmet hard minimum for this shift takes precedence over
  // the soft pay-period hours cap. The configured minimum (e.g. "1 ORC per 28 days")
  // is a stronger signal than hour-target protection, so these staff must not be
  // filtered out of the candidate pool by wouldBreakPPHours — otherwise a constrained
  // low-FTE staff loses every eligible day to broadly-available staff and can never
  // satisfy the minimum. pickStaff already sorts by deficit, so once they're in the
  // pool they win the contested slot. maxCount (via isAtMaximum) still caps them.
  // HARD minimums only — a soft preference must not override hour protection.
  function hasUnmetMinimum(staff: ScheduleStaff, st: ScheduleShiftType, date: string): boolean {
    return getMinimumDeficit(staff, st, date, "rule") > 0;
  }

  // MAX caps use a ROLLING window (isAtRollingMaximum): a placement is blocked if
  // any N-window span CONTAINING this date already holds maxCount, so two shifts
  // can't land close together just because a fixed block boundary falls between
  // them. (MIN targets stay fixed-block — see getMinimumDeficit. For windowCount=1
  // the rolling and fixed windows coincide, so behavior is unchanged.)
  // Shared rolling-max check, filtered by hardness. `wantHard=true` powers the
  // hard GATE (isAtMaximum); `wantHard=false` powers the soft PENALTY
  // (isOverSoftMaximum) used only to deprioritize in pickStaff.
  function atRollingMax(staff: ScheduleStaff, st: ScheduleShiftType, date: string, wantHard: boolean): boolean {
    if (!staff.shiftMinimumTargets || staff.shiftMinimumTargets.length === 0) return false;
    const targets = staff.shiftMinimumTargets.filter(
      (t) => t.shiftTypeId === st.id && t.maxCount != null && targetIsHard(t) === wantHard,
    );
    if (targets.length === 0) return false;

    // The candidate `date` is not yet in the grid, so these are the existing
    // counting placements only — isAtRollingMaximum adds the candidate implicitly.
    const assignedDates: string[] = [];
    for (const [k, v] of grid.entries()) {
      if (k.startsWith(staff.id + ":") && v.code === st.code && !v.noCount) {
        assignedDates.push(k.split(":")[1]);
      }
    }

    const ppRanges = payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
    for (const target of targets) {
      if (isAtRollingMaximum(target, date, assignedDates, ppRanges)) return true;
    }
    return false;
  }

  // HARD max gate — blocks placement (used everywhere a max must be respected).
  function isAtMaximum(staff: ScheduleStaff, st: ScheduleShiftType, date: string): boolean {
    return atRollingMax(staff, st, date, true);
  }

  // SOFT max — never blocks; a staff already at/over their preferred cap is just
  // ranked behind others in pickStaff so the mix drifts toward the preference.
  function isOverSoftMaximum(staff: ScheduleStaff, st: ScheduleShiftType, date: string): boolean {
    return atRollingMax(staff, st, date, false);
  }

  function getRequiredCount(st: ScheduleShiftType, date: string): number {
    const dayMap = reqsByShift.get(st.id);
    const base = dayMap?.get(holidaySet.has(date) ? "holiday" : String(getDow(date))) ?? 0;
    return Math.max(base, ruleDemand.get(slotKey(st.id, date)) ?? 0); // card #210: rule demand
  }

  // Physical count of `code` cells on `date`, INCLUDING non-counting followers —
  // use for per-day caps (Staffing Rules Max), where a follower still occupies a slot.
  // Staffing Rules "Max" for this shift on this date is already reached (counts
  // physical cells, non-counting followers included). Every work placement path
  // checks it: isAvailable, the coverage loop, standing commitments, followers.
  function dayFull(st: ScheduleShiftType, date: string): boolean {
    const cap = capOf(st.id, date);
    return cap != null && countAssigned(st.code, date) >= cap;
  }

  function countAssigned(code: string, date: string): number {
    let count = 0;
    for (const [k, v] of grid.entries()) {
      if (k.endsWith(`:${date}`) && v.code === code) count++;
    }
    return count;
  }

  // Coverage count: like countAssigned but EXCLUDES non-counting followers
  // (countsTowardTargets=false). Use wherever a staffing requirement is being
  // satisfied — a non-counting follower must not falsely meet a requirement.
  function countCoverage(code: string, date: string): number {
    let count = 0;
    for (const [k, v] of grid.entries()) {
      if (k.endsWith(`:${date}`) && v.code === code && !v.noCount) count++;
    }
    return count;
  }

  // Is this shift still below its required staffing minimum on `date`? (Slice 2b: the
  // gate that authorizes the configured coverage trades — they only ever fire to fill a
  // genuinely unmet coverage minimum, never to over-fill a satisfied one.)
  function hasUnmetCoverageMinimum(date: string, st: ScheduleShiftType): boolean {
    const required = getRequiredCount(st, date);
    return required > 0 && countCoverage(st.code, date) < required;
  }

  // Configured coverage trades for THIS run (Slice 2b). With the default order
  // (hardLimits > coverage > overHours > underHours) coverageBeatsOverHours is TRUE and
  // coverageBeatsHardLimits is FALSE — so the fallback below stays byte-identical to the
  // pre-2b behavior (coverage already filled over soft hours; hard caps stayed
  // protected). An admin flips either trade by ranking coverage higher.
  const factorKeys2b = effectiveFactorKeys(factorOrder);
  const coverageRank2b = factorKeys2b.indexOf("coverage");
  // Pay-period hours policy per hours row (autogen-hours-policy.ts). Read by key from the
  // config even when the ORDER falls back to default — a policy is not an ordering.
  const overHoursPolicy: HoursPolicy = parseHoursPolicy(factorOrder?.find((f) => f.key === "overHours")?.hoursPolicy);
  const underHoursPolicy: HoursPolicy = parseHoursPolicy(factorOrder?.find((f) => f.key === "underHours")?.hoursPolicy);
  // May factor `a` push past hours row `b`? Allowed → always; Prohibited → never (wherever
  // it ranks); Discouraged → only when `a` ranks above `b`. With NULL policies (=discouraged)
  // this is exactly the pre-policy rank comparison.
  function beatsHoursRow(a: string, b: "overHours" | "underHours"): boolean {
    const policy = b === "overHours" ? overHoursPolicy : underHoursPolicy;
    if (policy === "allowed") return true;
    if (policy === "prohibited") return false;
    return factorKeys2b.indexOf(a) < factorKeys2b.indexOf(b);
  }
  // When going over and going under conflict (keeping a cell pushes over; dropping it leaves
  // under), is landing UNDER the worse outcome? Prohibited beats discouraged beats allowed;
  // equal policies → the higher-ranked row is the one to protect.
  function underIsWorseThanOver(): boolean {
    const weight = (p: HoursPolicy) => (p === "prohibited" ? 2 : p === "discouraged" ? 1 : 0);
    const wu = weight(underHoursPolicy);
    const wo = weight(overHoursPolicy);
    if (wu !== wo) return wu > wo;
    if (wu === 0) return false; // both allowed → neither blocks; keep the pre-policy behavior
    return factorKeys2b.indexOf("underHours") < factorKeys2b.indexOf("overHours");
  }
  const coverageBeatsOverHours = beatsHoursRow("coverage", "overHours");
  // A staffer's HARD per-staff minimum target overrides the pay-period cap only when hard
  // limits may push past over-target (default order: yes, unchanged).
  const hardMinBeatsOverHours = beatsHoursRow("hardLimits", "overHours");
  // May the last fill day overshoot the target (shifts come in whole lengths)? Always, as
  // before, unless over-target is Prohibited — then only a Prohibited under-target ranked
  // above it can force the overshoot.
  const fillMayOvershoot = overHoursPolicy !== "prohibited" ||
    (underHoursPolicy === "prohibited" && factorKeys2b.indexOf("underHours") < factorKeys2b.indexOf("overHours"));
  const coverageBeatsHardLimits = coverageRank2b < factorKeys2b.indexOf("hardLimits");

  // Slice 2b coverage-fill FALLBACK gate — consulted only when the hours-clean tier is
  // empty (every remaining eligible body already has SOME block). It mirrors the pre-2b
  // fallback `eligible.filter(isAvailable)` (place any available body to cover), with two
  // config-driven adjustments:
  //   • coverage > hardLimits → also consider a body at its hard rolling MAX (ignoreHardMax).
  //   • overHours > coverage  → do NOT place a body whose assignment would push it OVER
  //                             target (respect hours instead of covering).
  // The ONLY hours condition this gate touches is the OVER-target exceedance. The
  // "under-reach" block (a body that stays UNDER target afterward) is deliberately NOT
  // gated: placing an under-target body covers the shift AND reduces underHours, so it is
  // never an exceedance and there is nothing to waive — it is allowed exactly as pre-2b.
  // (Codex #1793: the earlier "under-reach never waived" wording was wrong — excluding it
  // would strand coverage AND worsen underHours.) Hard MIN is handled in tier1 via
  // hasUnmetMinimum. With the default order this reduces to exactly `isAvailable(p,…)`.
  // Would placing `st` on every date of `group` push `p` over target in any pay period?
  function pairWouldExceed(p: ScheduleStaff, group: string[], st: ScheduleShiftType): boolean {
    if (!st.countsTowardFte) return false;
    const addByPP = new Map<PayPeriod, number>();
    for (const d of group) {
      const pp = findPPForDate(d);
      if (!pp) continue;
      addByPP.set(pp, (addByPP.get(pp) ?? 0) + getShiftHours(p.id, st, overrideMap, dayTypeOf(d, holidaySet)));
    }
    for (const [pp, add] of addByPP) {
      const target = targetFor(p, pp);
      if (target > 0 && ppHoursForStaff(p.id, pp) + pendingHolidayHours(p, pp, group) + add > target) return true; // card #176: owed HOL
    }
    return false;
  }

  // Tier-1 staffing gate: hours-clean, or a hard per-staff minimum that may override the
  // cap (never past an over-target hard limits may not cross).
  function hoursOkOrHardMin(p: ScheduleStaff, date: string, st: ScheduleShiftType): boolean {
    const block = ppHoursBlock(p.id, date, st);
    if (block === null) return true;
    if (!hasUnmetMinimum(p, st, date)) return false;
    return block !== "over" || hardMinBeatsOverHours;
  }

  function canFillCoverageOverLimits(p: ScheduleStaff, date: string, st: ScheduleShiftType, gapGroup?: string[]): boolean {
    if (!isAvailable(p, date, st, { ignoreHardMax: coverageBeatsHardLimits && hasUnmetCoverageMinimum(date, st), gapGroup })) return false;
    const block = ppHoursBlock(p.id, date, st);
    if (!coverageBeatsOverHours && block === "over") return false;
    // An under-target coverage cannot push past (Prohibited, or Discouraged and ranked above
    // coverage): refuse a placement that CREATES an avoidable shortfall — the staffer could
    // still reach target with ordinary days now, but not after this shift (+ its follower
    // day). A shortfall that exists either way stays placeable (covering reduces it).
    if (block === "under-reach" && !beatsHoursRow("coverage", "underHours") && canStillReachTarget(p, date)) return false;
    return true;
  }

  // Could `p` still reach the pay-period target of `date`'s period with the open days left,
  // before anything more is placed? (Same capacity estimate as ppHoursBlock's under-reach.)
  function canStillReachTarget(p: ScheduleStaff, date: string): boolean {
    const pp = findPPForDate(date);
    if (!pp || !fillShift) return true;
    const target = targetFor(p, pp);
    const current = ppHoursForStaff(p.id, pp) + pendingHolidayHours(p, pp, date); // card #176: owed HOL
    if (target <= 0 || current >= target) return true;
    const reachableHrs = maxReachableDailyHours(p, shiftTypes, overrideMap);
    const perDayHrs = reachableHrs > 0 ? reachableHrs : maxShiftHours(p.id, fillShift, overrideMap);
    let availDays = 0;
    const cur = new Date(pp.startDate + "T12:00:00");
    const end = new Date(pp.endDate + "T12:00:00");
    while (cur <= end) {
      if (isAvailable(p, toDateStr(cur), fillShift)) availDays++;
      cur.setDate(cur.getDate() + 1);
    }
    return current + availDays * perDayHrs >= target;
  }

  function findPPForDate(date: string): PayPeriod | null {
    for (const pp of payPeriods) {
      if (date >= pp.startDate && date <= pp.endDate) return pp;
    }
    return null;
  }

  // Slice 2b-0 (Codex #1779 C2): the PP-hours guard bundles TWO distinct blocks that
  // the configurable-priority feature must treat differently:
  //   "over"        — adding this shift pushes worked hours OVER the PP target (maps to
  //                   the `overHours` factor; waivable to fill coverage when coverage is
  //                   ranked above overHours).
  //   "under-reach" — even after this shift the staff can't REACH their target with the
  //                   days left (maps to `underHours`). This is NOT an exceedance: it
  //                   keeps tier1 (the hours-clean pool) from relying on a body that can't
  //                   hit target, but the coverage fallback still places such a body (that
  //                   reduces underHours), so it is never the thing the over-target trade
  //                   waives — see canFillCoverageOverLimits.
  // Split the reason here so callers can gate only the over case. `wouldBreakPPHours`
  // keeps the old boolean contract (either block ⇒ true) for the unchanged call sites.
  function ppHoursBlock(staffId: string, date: string, st: ScheduleShiftType): "over" | "under-reach" | null {
    // An each_day follower (e.g. ORC→X) reliably drags one follower day — and its
    // hours — into the period per placement, so it's part of this projection.
    // each_run followers are shared across a run; their hours land via
    // ppHoursForStaff once placed, and Slice 2 refines their projection.
    const followerSpec = followerBySource.get(st.id);
    // Card #185: only a follower that would actually land (the placement's own rule) — a work
    // follower is never placed on a holiday, so that day keeps its owed HOL instead.
    // A follower past the end of the run ("" = not placed by THIS run) still counts, as before.
    const eachDayFollower = followerSpec?.scope === "each_day" && !followerBlock(staffId, date, st) ? followerSpec : null;
    const hasFollowerDay = !!eachDayFollower;
    if (!st.countsTowardFte && !hasFollowerDay) return null;

    const followerDate = hasFollowerDay ? nextDate(date) : null;
    const followerPP = followerDate ? findPPForDate(followerDate) : null;
    const pp = st.countsTowardFte ? findPPForDate(date) : followerPP;
    if (!pp || !fillShift) return null;
    const staff = activeStaff.find((p) => p.id === staffId);
    if (!staff) return null;
    const target = targetFor(staff, pp);
    if (target <= 0) return null;

    const sameFollowerPP = !!followerPP && followerPP.startDate === pp.startDate;
    const followerHrs = eachDayFollower && eachDayFollower.follower.countsTowardFte && sameFollowerPP
      ? getShiftHours(staffId, eachDayFollower.follower, overrideMap, followerDate ? dayTypeOf(followerDate, holidaySet) : "weekday") : 0;
    const addHours = (st.countsTowardFte ? getShiftHours(staffId, st, overrideMap, dayTypeOf(date, holidaySet)) : 0) + followerHrs;
    // Card #176: owed-but-not-yet-granted HOL counts (see pendingHolidayHours). Card #185 r2: a
    // follower day keeps its owed HOL — a work follower never lands on a holiday, and an off
    // follower (X) stays fillable and is later replaced by the HOL.
    const current = ppHoursForStaff(staffId, pp) + pendingHolidayHours(staff, pp, date);
    if (current + addHours > target) return "over";

    // Value each remaining open day at the staff's longest reachable shift, not
    // the short fill shift, so a full-timer who can still hit target via 12h/16h
    // shifts isn't wrongly excluded. Fall back to this staff's fill-shift hours
    // (override-aware) when no longer shift qualifies.
    // Generic per-open-day capacity estimate (no single date): take the largest
    // day type so a reachable target isn't understated.
    const fillHrs = maxShiftHours(staffId, fillShift, overrideMap);
    const reachableHrs = maxReachableDailyHours(staff, shiftTypes, overrideMap);
    const perDayHrs = reachableHrs > 0 ? reachableHrs : fillHrs;
    let availDays = 0;
    const cur = new Date(pp.startDate + "T12:00:00");
    const end = new Date(pp.endDate + "T12:00:00");
    while (cur <= end) {
      const d = toDateStr(cur);
      if (isAvailable(staff, d, fillShift)) {
        availDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }

    let daysConsumed = 0;
    if (st.countsTowardFte) daysConsumed += 1;
    if (hasFollowerDay && sameFollowerPP) daysConsumed += 1;
    const remainingAvail = availDays - daysConsumed;
    const hoursAfterAssign = current + addHours;
    const hoursStillNeeded = target - hoursAfterAssign;
    const maxFillable = remainingAvail * perDayHrs;

    return hoursStillNeeded > 0 && maxFillable < hoursStillNeeded ? "under-reach" : null;
  }

  // Boolean wrapper preserving the pre-2b contract (either block ⇒ "would break").
  function wouldBreakPPHours(staffId: string, date: string, st: ScheduleShiftType): boolean {
    return ppHoursBlock(staffId, date, st) !== null;
  }

  const fillShift = shiftTypes.find((st) => st.isFillShift) ?? null;

  // ── Flag contradictory requests (advisory) ──
  // Surface logically impossible request combinations on a (staff, date) — e.g. a
  // hard OFF together with a hard request to work — so the scheduler doesn't silently
  // pick one. Reads the same folds the steps below use (so it honors pendingMode: a
  // pending-soft request can't raise a hard conflict, and an "off"-mode pending
  // request isn't considered at all). Never blocks placement; only pushes warnings.
  if (requestList.length > 0) {
    const isWorkingShift = (id: string) => !isAwayShift(id);
    const codeOf = (id: string) => stById.get(id)?.code ?? id;
    const flaggedCells = new Set<string>();
    for (const staff of activeStaff) {
      for (const date of dates) {
        const cellKey = `${staff.id}:${date}`;
        if (flaggedCells.has(cellKey)) continue;
        const folded = foldFor(staff.id, date);
        if (folded.contributing.length === 0) continue;
        flaggedCells.add(cellKey);
        for (const msg of detectRequestConflicts(folded, isWorkingShift, codeOf)) {
          warnings.push(`${staff.initials} ${date}: ${msg}`);
        }
      }
    }
  }

  // Card #175: could the person work this date, by their own availability rules
  // (couldWorkOn reads conditional rules optimistically — STEP 0 runs on an empty grid;
  // any excess left over target is trimmed after placement, trimLeaveToTarget).
  const leavePolicy: LeavePolicy = schedulingPreferences.leaveHoursPolicy ?? "up-to-target";
  const normallyWorks = (p: ScheduleStaff, date: string): boolean => couldWorkOn(p.availabilityRules, date, payPeriods);

  // ── STEP 0: Pre-place approved leave requests ──
  // An approved hard LEAVE request pre-places its specific leave shift, exactly
  // like an approved absence. It only fills empty / unlocked-off cells (assign()
  // never overwrites a real assignment) and bypasses working-day availability
  // because approved leave is authoritative. Placing it first marks the staff
  // assigned, so later steps won't schedule work over the leave.
  if (requestList.length > 0) {
    for (const staff of activeStaff) {
      for (const date of dates) {
        if (isAssigned(staff.id, date)) continue;
        const leaveShiftId = foldFor(staff.id, date).leaveShiftTypeId;
        if (!leaveShiftId) continue;
        const leaveSt = stById.get(leaveShiftId);
        if (!leaveSt) {
          warnings.push(`${staff.initials}: leave request on ${date} references an unknown shift type`);
          continue;
        }
        // Card #175: a requested leave day the person would have been off anyway
        // (their own availability rules) gets X — no leave is charged for a day off.
        if (leavePolicy === "up-to-target" && offShift && !normallyWorks(staff, date)) {
          assign(staff.id, date, offShift, `Requested leave on a day off: ${offShift.code} (no leave used)`, LEAVE_OFF_STEP, 1.0);
          continue;
        }
        assign(staff.id, date, leaveSt, `Approved leave request: ${leaveSt.code}`, "request-leave", 1.0);
      }
    }
  }

  // ── STEP 0b: Honor approved hard REQUEST_SHIFT ("wants this shift") ──
  // Pre-place one of the requested shifts when the staff is eligible for it and
  // the placement is otherwise legal (availability / follow rules / per-day & max
  // caps are all enforced by isAvailable). Runs before standing commitments and
  // staffing fills so an explicit "I want to work X" wins, and counts toward that
  // shift's staffing so later steps fill only the remainder. Warns when a request
  // can't be honored (ineligible, capped, or no legal slot).
  if (requestList.length > 0) {
    for (const staff of activeStaff) {
      const eligSet = eligibleShiftSets.get(staff.id);
      for (const date of dates) {
        if (isAssigned(staff.id, date)) continue;
        const forced = foldFor(staff.id, date).forcedShiftIds;
        if (forced.size === 0) continue;
        // Resolve the OR set deterministically by configured sortOrder (then code),
        // not arbitrary id. A requested WORK shift is preferred when it's legal
        // (eligible + available) so the staff works if they can; an Off/leave ("away")
        // shift is the authoritative fallback — placed regardless of work-eligibility/
        // availability, exactly like an approved leave (STEP 0a), since being granted
        // time off isn't gated by working-day rules.
        const candidates = [...forced]
          .map((id) => stById.get(id))
          .filter((st): st is ScheduleShiftType => !!st)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
        let placed = false;
        // Pass 1: a legal work shift wins.
        for (const st of candidates) {
          if (st.isLeave || st.isOffShift) continue;
          if (!eligSet?.has(st.id) || !isAvailable(staff, date, st)) continue;
          // Under "reconcile", a forced WORK request is placed TENTATIVELY (revocable)
          // unless a HUMAN-approved request forces it (status approved & !autoApproved)
          // — human decisions are authoritative and never reconciled. Record the
          // earliest contributing revocable receivedAt for first-come ordering.
          const contribs = foldFor(staff.id, date).contributing.filter(
            (c) => c.kind === "REQUEST_SHIFT" && c.effective === "hard" && c.shiftTypeIds.includes(st.id),
          );
          const humanApproved = contribs.some((c) => c.status === "approved" && !c.autoApproved);
          const revocable = reconcilePolicy === "reconcile" && !humanApproved;
          assign(staff.id, date, st, `Approved shift request: ${st.code}`, revocable ? "request-tentative" : "request-shift", 1.0);
          if (revocable) {
            let earliest: string | null = null;
            for (const c of contribs) {
              if (c.status === "approved" && !c.autoApproved) continue; // not a revocable contributor
              if (c.receivedAt && (earliest === null || c.receivedAt < earliest)) earliest = c.receivedAt;
            }
            tentativeMeta.set(`${staff.id}:${date}`, { receivedAt: earliest ?? "" });
          }
          placed = true;
          break;
        }
        // Pass 2: fall back to the first away shift, placed authoritatively.
        if (!placed) {
          for (const st of candidates) {
            if (!st.isLeave && !st.isOffShift) continue;
            assign(staff.id, date, st, `Approved shift request: ${st.code}`, "request-shift", 1.0);
            placed = true;
            break;
          }
        }
        if (!placed) {
          // Name pending vs approved when unambiguous (all contributing hard
          // REQUEST_SHIFTs share a status); stay generic when mixed.
          const reqs = foldFor(staff.id, date).contributing.filter((c) => c.kind === "REQUEST_SHIFT" && c.effective === "hard");
          const label = reqs.length > 0 && reqs.every((c) => c.status === "pending") ? "pending "
            : reqs.length > 0 && reqs.every((c) => c.status === "approved") ? "approved "
            : "";
          warnings.push(`${staff.initials}: could not honor ${label}shift request on ${date} (ineligible or no legal slot)`);
        }
      }
    }
  }

  // ── STEP 1: Apply standing commitments ──
  const scPayPeriods = payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
  for (const sc of standingCommitments) {
    const st = stById.get(sc.shiftTypeId);
    if (!st || !st.autoSchedulable) continue;
    const member = staff.find((p) => p.id === sc.staffId);
    if (!member?.isActive) continue;
    // Card #75: a standing commitment of a person not eligible for the shift is inert.
    if (!member.eligibleShiftTypeIds.includes(sc.shiftTypeId)) continue;
    const when = standingToWhen(sc);

    for (const date of dates) {
      if (isAssigned(sc.staffId, date)) continue;

      // matchesWhen applies both the weekday filter and the occurrence qualifier
      // (every / biweekly cycle / monthly ordinal / explicit when*). Replaces the
      // legacy `frequency==="weekly" || dayOfWeek===null` gate, which silently
      // dropped biweekly/monthly commitments tied to a specific weekday.
      if (!matchesWhen(when, date, scPayPeriods)) continue;

      const avail = evaluateAvailability(
        member.availabilityRules, date, payPeriods,
        (pid, d) => isWorking(pid, d)
      );
      if (!avail.available) continue;
      if (holidaySet.has(date)) continue;

      if (member.shiftEligibilityRules && member.shiftEligibilityRules.length > 0) {
        const eligResult = evaluateShiftEligibility(
          member.shiftEligibilityRules, st.id, date, scPayPeriods,
        );
        if (eligResult !== null && !eligResult.eligible) continue; // card #188
      }

      if (isAtMaximum(member, st, date)) continue;
      // An approved hard OFF / NEGATE_SHIFT request overrides a standing
      // commitment (this path doesn't flow through isAvailable).
      if (requestBlocksWork(sc.staffId, date, st)) continue;
      if (dayFull(st, date)) {
        warnings.push(`${member.initials}: standing ${st.code} not placed on ${date} (Max for ${st.code} that day already reached)`);
        continue;
      }
      if (hardGapBlocks(sc.staffId, st, [date])) {
        warnings.push(`${member.initials}: standing ${st.code} not placed on ${date} (${hardGapWhy(st)})`);
        continue;
      }

      assign(
        sc.staffId,
        date,
        st,
        `Standing commitment: ${st.code}`,
        "standing",
        0.9
      );
    }
  }

  // ── STEP 2: Fill staffing requirements (even distribution + equity tiebreak) ──
  //
  // For each shift type, distribute assignments evenly across eligible staff
  // within this scheduling run. Historical per-shift equity only breaks ties when
  // multiple staff have the same count — it never causes one person to absorb
  // all the burden just because they're historically underloaded.
  //
  // "Evenly" is per the department's shiftShareBasis: "fte" divides each staff's
  // run count by their FTE before comparing (a 0.5 FTE carries half the slots of a
  // 1.0 FTE); "head" compares raw counts. The run count is SEEDED from cells of the
  // same shift already in the window (approved/pending requests, manual entries,
  // a prior run's spill) so a staffer who already holds one isn't handed a full
  // extra share as if they held none.
  //
  // Sort priority: fewest-in-this-run (share-weighted) → long-shift fit →
  // longest-gap-since-last → fewest-historical
  const shareBasis: ShiftShareBasis = schedulingPreferences.shiftShareBasis ?? "fte";
  function shareWeight(p: ScheduleStaff): number {
    return shareBasis === "fte" && p.ftePercentage > 0 ? p.ftePercentage : 1;
  }

  // ── Card #203: "Keep counts even across months" — the running balance ──
  // A pure function of the cells (shift-balance.ts): every cell of the shift is a slot, owed
  // to the people who could have taken it that day by their share weight. Two parts:
  //   run     — the calendar month this run schedules (never the adjacent months' cells
  //             that come along with whole pay periods);
  //   carried — from the department's shiftBalanceFrom up to that month's 1st.
  // The picker and both hours repairs rank this month's balance first; the carried part
  // only breaks ties, so earlier months never flood anyone within a month.
  const evenIds = new Set(shiftTypes.filter((s) => s.evenAcrossMonths).map((s) => s.id));
  const balanceMonth = ((): string => {
    if (writableFrom) return writableFrom.slice(0, 7);
    const n = new Map<string, number>();
    for (const d of dates) n.set(d.slice(0, 7), (n.get(d.slice(0, 7)) ?? 0) + 1);
    let best = "", bestN = -1;
    for (const [m, c] of n) if (c > bestN || (c === bestN && m > best)) { best = m; bestN = c; }
    return best;
  })();
  const monthStart = `${balanceMonth}-01`;
  const monthDays: string[] = [];
  for (let d = monthStart; d.slice(0, 7) === balanceMonth; d = addDays(d, 1)) monthDays.push(d);
  const balanceFrom = schedulingPreferences.shiftBalanceFrom ?? null;
  const carriedDays: string[] = [];
  if (balanceFrom && evenIds.size > 0) for (let d = balanceFrom; d < monthStart; d = addDays(d, 1)) carriedDays.push(d);
  const ablePPs: PayPeriodRange[] = balancePayPeriods && balancePayPeriods.length > 0
    ? balancePayPeriods : payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
  const balanceReqs = balanceRequests ?? requestList.filter((r) => r.status === "approved");
  const ppStartOf = new Map<string, string | null>();
  function ppStartFor(d: string): string | null {
    if (!ppStartOf.has(d)) ppStartOf.set(d, ablePPs.find((pp) => d >= pp.startDate && d <= pp.endDate)?.startDate ?? null);
    return ppStartOf.get(d)!;
  }
  const runDateSet = new Set(dates);
  // On the roster in a past pay period = they have at least one cell in it (saved cells only).
  const rosterPPs = new Set<string>();
  if (carriedDays.length > 0) {
    for (const a of [...historicalAssignments, ...existingAssignments]) {
      if (a.date < carriedDays[0] || a.date >= monthStart) continue;
      const pp = ppStartFor(a.date);
      if (pp) rosterPPs.add(`${a.staffId}|${pp}`);
    }
  }
  const staticAvail = new Map<string, AvailabilityRule[]>();
  /** Inside the person's time for this shift: joined, ticked for it, within temp dates. */
  function joinedFor(p: ScheduleStaff, stId: string, d: string): boolean {
    const since = p.eligibleSince?.[stId];
    if (since && d < since) return false;
    if (p.createdOn && d < p.createdOn) return false;
    if (p.tempStartDate && d < p.tempStartDate) return false;
    if (p.tempEndDate && d > p.tempEndDate) return false;
    return true;
  }
  /** Could `p` have taken `st` on `d`? STATIC gates only, so a run and next month's replay agree. */
  function ableFor(p: ScheduleStaff, st: ScheduleShiftType, d: string): boolean {
    if (!(eligibleShiftSets.get(p.id)?.has(st.id) ?? false)) return false;
    if (!joinedFor(p, st.id, d)) return false;
    if (p.shiftEligibilityRules && p.shiftEligibilityRules.length > 0) {
      const r = evaluateShiftEligibility(p.shiftEligibilityRules, st.id, d, ablePPs);
      if (r !== null && !r.eligible) return false;
    }
    if (!st.ignoresWorkingDays) {
      // "When X is / isn't working" rules depend on other cells, so they don't move credit.
      if (!staticAvail.has(p.id)) staticAvail.set(p.id, p.availabilityRules.filter((r) => !r.conditionStaffId));
      if (!evaluateAvailability(staticAvail.get(p.id)!, d, ablePPs).available) return false;
    }
    const c = cellShiftAt(p.id, d);
    if (c && stById.get(c)?.isLeave) return false;
    if (balanceReqs.length > 0) {
      const f = foldRequestsForDate(balanceReqs, p.id, d, isAwayShift, "off");
      if (f.forbidWorking || f.leaveShiftTypeId || f.forbiddenShiftIds.has(st.id)) return false;
    }
    if (d < monthStart && !runDateSet.has(d)) {
      // A past pay period: on the roster only if they hold a cell in it. Days this run
      // schedules are on everyone's roster.
      const pp = ppStartFor(d);
      if (!pp || !rosterPPs.has(`${p.id}|${pp}`)) return false;
    }
    return true;
  }
  const shareCache = new Map<string, Map<string, number>>();
  function shareOn(st: ScheduleShiftType, d: string): Map<string, number> {
    const key = `${st.id}|${d}`;
    let m = shareCache.get(key);
    if (!m) {
      m = sharesOf(activeStaff.filter((p) => ableFor(p, st, d)).map((p) => ({ id: p.id, weight: shareWeight(p) })));
      shareCache.set(key, m);
    }
    return m;
  }
  // Earlier-month days: a day no pay period covers can't be judged (roster), so it counts on
  // neither side; days inside this run's own range stay live (the run may still write them).
  const carriedFixedDays = carriedDays.filter((d) => !runDateSet.has(d) && ppStartFor(d) !== null);
  const carriedLiveDays = carriedDays.filter((d) => runDateSet.has(d) && ppStartFor(d) !== null);
  const activeIds = activeStaff.map((p) => p.id);
  const staffById = new Map(activeStaff.map((p) => [p.id, p] as const));
  const carriedCache = new Map<string, Map<string, BalanceTally>>();
  type EvenBalance = { run: Map<string, number>; carried: Map<string, number> };
  /** This month's and the carried balance (got − expected) per person for an even shift. */
  // A cell held outside the person's time for the shift (before they joined or were ticked
  // for it, after temp end) is no slot at all: in neither their got nor anyone's expected.
  const slotCell = (st: ScheduleShiftType, cellAt: (staffId: string, date: string) => string | undefined) =>
    (id: string, d: string): string | undefined => {
      const p = staffById.get(id);
      return p && !joinedFor(p, st.id, d) ? undefined : cellAt(id, d);
    };
  function evenBalance(st: ScheduleShiftType, cellAt: (staffId: string, date: string) => string | undefined = cellShiftAt): EvenBalance {
    // Only days this run can't write are cached; earlier-month days inside the run (an
    // approval re-solve spanning two months) are re-tallied from the current/proposed cells.
    let carried = carriedCache.get(st.id);
    if (!carried) {
      carried = tallyBalances({ shiftTypeId: st.id, weekendPaired: st.weekendPaired, weekendStartDow: weekendStart, staffIds: activeIds, dates: carriedFixedDays, cellAt: slotCell(st, cellShiftAt), shareOn: (d) => shareOn(st, d) });
      carriedCache.set(st.id, carried);
    }
    const live = carriedLiveDays.length > 0
      ? tallyBalances({ shiftTypeId: st.id, weekendPaired: st.weekendPaired, weekendStartDow: weekendStart, staffIds: activeIds, dates: carriedLiveDays, cellAt: slotCell(st, cellAt), shareOn: (d) => shareOn(st, d) })
      : null;
    const run = tallyBalances({ shiftTypeId: st.id, weekendPaired: st.weekendPaired, weekendStartDow: weekendStart, staffIds: activeIds, dates: monthDays, cellAt: slotCell(st, cellAt), shareOn: (d) => shareOn(st, d) });
    const out: EvenBalance = { run: new Map(), carried: new Map() };
    for (const id of activeIds) {
      const r = run.get(id)!, c = carried.get(id)!, l = live?.get(id);
      out.run.set(id, r.got - r.expected);
      out.carried.set(id, c.got - c.expected + (l ? l.got - l.expected : 0));
    }
    return out;
  }
  /**
   * Repairs (card #203): how a set of cell changes moves the even shifts' balances —
   * [Δ Σ|this month's balance|, Δ Σ|this month's + carried|], compared in that order (lower is
   * better). Everyone is counted, since splitting a weekend pair changes the slot count. Cells
   * outside the calendar month don't count.
   */
  function evenDelta(changes: readonly (readonly [string, string, string | null])[]): [number, number] {
    if (evenIds.size === 0 || changes.length === 0) return [0, 0];
    const over = new Map<string, string | null>();
    for (const [id, d, stId] of changes) over.set(`${id}:${d}`, stId);
    const cellAfter = (id: string, d: string): string | undefined => {
      const k = `${id}:${d}`;
      return over.has(k) ? (over.get(k) ?? undefined) : cellShiftAt(id, d);
    };
    let dRun = 0, dTot = 0;
    for (const stId of evenIds) {
      const st = stById.get(stId)!;
      const touched = changes.some(([id, d, to]) => to === stId || cellShiftAt(id, d) === stId);
      if (!touched) continue;
      const before = evenBalance(st), after = evenBalance(st, cellAfter);
      for (const id of activeIds) {
        const rb = before.run.get(id)!, ra = after.run.get(id)!;
        const cb = before.carried.get(id)!, ca = after.carried.get(id)!;
        dRun += Math.abs(ra) - Math.abs(rb);
        dTot += Math.abs(ra + ca) - Math.abs(rb + cb);
      }
    }
    return [dRun, dTot];
  }
  /** Repairs: Δ spread penalty for the people whose cells change (marked shifts only). */
  /** Repairs: Δ spacing penalty of the whole proposed state, per person (marked shifts only). */
  function spreadDelta(changes: readonly (readonly [string, string, string | null])[]): number {
    if (spreadIds.size === 0) return 0;
    const byPerson = new Map<string, Map<string, boolean>>();
    for (const [id, d, to] of changes) {
      if (!byPerson.has(id)) byPerson.set(id, new Map());
      byPerson.get(id)!.set(d, spreadIds.has(to ?? ""));
    }
    let delta = 0;
    for (const [id, after] of byPerson) delta += spreadChange((d) => spreadIds.has(cellShiftAt(id, d) ?? ""), after, spreadRadius);
    return delta;
  }
  const EPS = 1e-9;
  const cmpTuple = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return a[i] - b[i];
    return 0;
  };

  const scheduledShifts = shiftTypes
    .filter((st) => st.autoSchedulable && st.schedulePriority != null && !st.isFillShift && !st.isOffShift)
    .sort((a, b) => (a.schedulePriority ?? 0) - (b.schedulePriority ?? 0));

  const historicalShiftCounts = new Map<string, Record<string, number>>();
  for (const m of fairness.metrics) {
    historicalShiftCounts.set(m.staffId, m.shiftCounts);
  }

  function historicalCount(staffId: string, shiftCode: string): number {
    return historicalShiftCounts.get(staffId)?.[shiftCode] ?? 0;
  }

  // ── Card #210: holiday-rule pass (start of STEP 2) ──
  // Each group's days go to ONE person. A person already holding a day of the group (hand
  // entry, request, an earlier month, or a day just past the run) is the anchor and gets the
  // open days; a group whose days are held by different people is a hand split and is left
  // alone. With no anchor, one person who can take every open day is picked. A group is placed
  // all at once (followers included) or not at all; what can't be placed is warned and left to
  // the residual fill in that shift's own pass.
  const scheduledIds = new Set(scheduledShifts.map((t) => t.id));
  /** Staff holding `stId` on `date`: the grid for run dates, else history / read-only context. */
  const ruleContextCells = new Map<string, string[]>();
  for (const a of holidayRuleContext ?? []) {
    const k = slotKey(a.shiftTypeId, a.date);
    ruleContextCells.set(k, [...(ruleContextCells.get(k) ?? []), a.staffId]);
  }
  const historyByDay = new Map<string, string[]>();
  if (ruleGroups.length > 0) {
    for (const a of historicalAssignments) {
      const k = slotKey(a.shiftTypeId, a.date);
      historyByDay.set(k, [...(historyByDay.get(k) ?? []), a.staffId]);
    }
  }
  function slotHolders(date: string, stId: string): string[] {
    if (dateSet.has(date)) {
      const out: string[] = [];
      for (const [k, v] of grid.entries()) if (v.shiftTypeId === stId && k.endsWith(`:${date}`)) out.push(k.slice(0, k.indexOf(":")));
      return out;
    }
    return ruleContextCells.get(slotKey(stId, date)) ?? historyByDay.get(slotKey(stId, date)) ?? [];
  }
  const initialsOf = (id: string): string => staff.find((p) => p.id === id)?.initials ?? id;
  /** Card #210 r3: hours of the group's new days, priced per day's OWN shift (overrides, day type,
   *  each_day follower as ppHoursBlock prices it), per pay period, against the target. */
  function groupWouldExceed(p: ScheduleStaff, open: readonly HolidayGroupSlot[]): boolean {
    const addByPP = new Map<PayPeriod, number>();
    const add = (pp: PayPeriod | null, h: number) => { if (pp && h > 0) addByPP.set(pp, (addByPP.get(pp) ?? 0) + h); };
    for (const s of open) {
      const st = stById.get(s.shiftTypeId)!;
      const pp = findPPForDate(s.date);
      if (st.countsTowardFte) add(pp, getShiftHours(p.id, st, overrideMap, dayTypeOf(s.date, holidaySet)));
      const spec = followerBySource.get(st.id);
      if (spec?.scope === "each_day" && spec.follower.countsTowardFte && !followerBlock(p.id, s.date, st)) {
        const fd = nextDate(s.date);
        const fpp = findPPForDate(fd);
        if (fpp && pp && fpp.startDate === pp.startDate) add(fpp, getShiftHours(p.id, spec.follower, overrideMap, dayTypeOf(fd, holidaySet)));
      }
    }
    const groupDates = open.map((s) => s.date);
    for (const [pp, h] of addByPP) {
      const target = targetFor(p, pp);
      if (target > 0 && ppHoursForStaff(p.id, pp) + pendingHolidayHours(p, pp, groupDates) + h > target) return true;
    }
    return false;
  }
  type GroupTier = "strict" | "fallback" | "anchor";
  /** Can `p` take one open day under the tier's gate? (eligibility ticks + rules are checked
   *  separately: isAvailable doesn't check the ticks.) */
  // `open` (card #260): the group's days, so a Hard gap judges its days of one shift as one stretch.
  function slotOk(p: ScheduleStaff, s: HolidayGroupSlot, tier: GroupTier, open?: readonly HolidayGroupSlot[]): boolean {
    const st = stById.get(s.shiftTypeId)!;
    const gapGroup = open ? open.filter((x) => x.shiftTypeId === s.shiftTypeId).map((x) => x.date) : undefined;
    if (tier === "fallback") return canFillCoverageOverLimits(p, s.date, st, gapGroup);
    if (!isAvailable(p, s.date, st, { gapGroup })) return false;
    return tier === "anchor" || ppHoursBlock(p.id, s.date, st) === null;
  }
  /** Why `p` can't take all the open days, or null. */
  function groupBlock(p: ScheduleStaff, open: readonly HolidayGroupSlot[], tier: GroupTier): string | null {
    for (const s of open) {
      const st = stById.get(s.shiftTypeId)!;
      if (!eligibleStaff(st, s.date).some((e) => e.id === p.id)) return `not eligible for ${st.code} on ${s.date}`;
    }
    for (const s of open) if (!slotOk(p, s, tier, open)) return `can't take ${stById.get(s.shiftTypeId)!.code} on ${s.date}`;
    if (!coverageBeatsOverHours && groupWouldExceed(p, open)) return "would go over their hours for the pay period";
    return null;
  }
  /** Place the open days for `p` (date order, followers inside the trial); all or nothing. */
  function placeGroup(p: ScheduleStaff, g: HolidayGroup, open: readonly HolidayGroupSlot[], tier: GroupTier): string | null {
    const snap = snapshotFor(p.id, []);
    const gapSnap = gapSnapshot([p.id], open.map((s) => s.date));
    let why: string | null = null;
    for (const s of open) {
      const st = stById.get(s.shiftTypeId)!;
      if (!slotOk(p, s, tier, open)) { why = `can't take ${st.code} on ${s.date}`; break; }
      assign(p.id, s.date, st, `Holiday rule ${g.ruleName} (${p.initials})`, "holiday-rule", 0.95);
      placeEachDayFollower(p.id, s.date, st);
    }
    if (!why) {
      for (const s of open) {
        const c = grid.get(`${p.id}:${s.date}`);
        if (!c || c.shiftTypeId !== s.shiftTypeId || c.step !== "holiday-rule") { why = `a required follower lands on ${s.date}`; break; }
      }
    }
    if (!why && gapNewSince(gapSnap)) why = "would break a minimum gap between two of the same shift";
    if (why) { restoreSnapshot(snap); return why; }
    return null;
  }
  /** Card #210 r3: the group's ranking — pickStaff's keys, summed over the group's days; an
   *  even-across-months shift ranks by its balance (card #203), never raw all-time counts. */
  function rankGroup(pool: ScheduleStaff[], open: readonly HolidayGroupSlot[]): ScheduleStaff[] {
    const bal = new Map<string, EvenBalance>();
    const shareOfShift = (p: ScheduleStaff, st: ScheduleShiftType): number => {
      let n = 0;
      for (const [k, v] of grid.entries()) {
        if (v.shiftTypeId !== st.id || v.noCount || !k.startsWith(`${p.id}:`)) continue;
        if (dateSet.has(k.slice(k.indexOf(":") + 1))) n++;
      }
      return n / shareWeight(p);
    };
    const keyOf = (p: ScheduleStaff): number[] => {
      let hard = 0, soft = 0, over = 0, av = 0, bias = 0, pref = 0, share = 0, spread = 0, carried = 0, hist = 0;
      for (const s of open) {
        const st = stById.get(s.shiftTypeId)!;
        hard += getMinimumDeficit(p, st, s.date, "rule");
        soft += getMinimumDeficit(p, st, s.date, "preference");
        over += isOverSoftMaximum(p, st, s.date) ? 1 : 0;
        av += avoidedPairs(p.id, s.date, st.id);
        bias += requestBias(p.id, s.date, st);
        pref += eligPreference(p, st.id, s.date);
        if (st.spreadOverMonth) spread += spreadLoad(p.id, s.date);
        if (st.evenAcrossMonths) {
          if (!bal.has(st.id)) bal.set(st.id, evenBalance(st));
          const b = bal.get(st.id)!;
          share += b.run.get(p.id) ?? 0;
          carried += b.carried.get(p.id) ?? 0;
        } else {
          share += shareOfShift(p, st);
          hist += historicalCount(p.id, st.code);
        }
      }
      return [-hard, -soft, over, av, -bias, -pref, share, spread, carried, hist, seedTie(p.id)];
    };
    const keys = new Map(pool.map((p) => [p.id, keyOf(p)] as const));
    return [...pool].sort((a, b) => cmpTuple(keys.get(a.id)!, keys.get(b.id)!));
  }

  for (const g of ruleGroups) {
    const slots = usableSlots(g);
    if (slots.length < 2) continue;
    const held = slots.map((s) => slotHolders(s.date, s.shiftTypeId));
    const anchors = new Set(held.flat());
    const open = slots.filter((s, i) => held[i].length === 0 && dateSet.has(s.date) && !isFrozen(s.date) && scheduledIds.has(s.shiftTypeId));
    if (open.length === 0) continue;
    if (anchors.size > 1) continue; // a hand split: never reassigned
    if (anchors.size === 1) {
      const id = [...anchors][0];
      const p = activeStaff.find((x) => x.id === id);
      if (!p) { warnings.push(`${initialsOf(id)}: cannot keep ${g.ruleName} (${g.holidayDate}) — not scheduled automatically`); continue; }
      const why = groupBlock(p, open, "anchor") ?? placeGroup(p, g, open, "anchor");
      if (why) warnings.push(`${p.initials}: cannot keep ${g.ruleName} (${g.holidayDate}) — ${why}; that day is filled separately`);
      continue;
    }
    let placed = false;
    let lastWhy = "nobody can take all of its days";
    for (const tier of ["strict", "fallback"] as const) {
      const pool = activeStaff.filter((p) => groupBlock(p, open, tier) === null);
      for (const p of rankGroup(pool, open)) {
        const why = placeGroup(p, g, open, tier);
        if (!why) { placed = true; break; }
        lastWhy = `${p.initials}: ${why}`;
      }
      if (placed) break;
    }
    if (!placed) warnings.push(`${g.ruleName} (${g.holidayDate}): ${lastWhy}; its days are filled separately`);
  }

  for (const st of scheduledShifts) {
    const eligible = eligibleStaff(st);
    const stepName = st.code.toLowerCase();

    // Per-shift tracking for even distribution within this run
    const runCount = new Map<string, number>();
    const lastRunDate = new Map<string, string>();
    // Card #260: the minimum-gap host keys (gap first, then room) in pickStaff. A paired pay
    // period is placed with them and without them, and they are kept only where they help.
    let gapKeysOn = true;
    for (const p of eligible) runCount.set(p.id, 0);
    // Seed from counting cells of this shift already on the grid (STEP 1 requests,
    // manual/locked entries, prior-run spill inside the window). Must use the SAME
    // unit as recordAssignment below: for a weekend-paired shift the engine counts
    // a Sat+Sun pair ONCE (recordAssignment runs for the Saturday only), so a
    // Sunday cell whose Saturday holds the same shift for the same staff is the
    // second half of an already-counted pair and is skipped. A lone Sunday, a
    // holiday or a weekday cell each count one, matching the holiday/bridge passes.
    for (const [k, v] of grid.entries()) {
      if (v.code !== st.code || v.noCount) continue;
      const sep = k.indexOf(":");
      const staffId = k.slice(0, sep);
      const date = k.slice(sep + 1);
      if (!runCount.has(staffId) || !dateSet.has(date)) continue;
      if (st.weekendPaired && getDow(date) === weekendSecond) {
        const satCell = getCell(staffId, prevDate(date));
        if (satCell && satCell.code === st.code && !satCell.noCount) continue;
      }
      runCount.set(staffId, (runCount.get(staffId) ?? 0) + 1);
      const last = lastRunDate.get(staffId);
      if (!last || date > last) lastRunDate.set(staffId, date);
    }
    function shareCount(p: ScheduleStaff): number {
      return (runCount.get(p.id) ?? 0) / shareWeight(p);
    }

    // `loadOf` (card #178): the spread load to rank by, when the caller knows the person's
    // actual dates (a paired group); otherwise spreadLoad on `date`.
    // `datesOf` (cards #178/#188): the dates a candidate would actually get when it differs
    // from `date` (a weekend pair, a paired group); null = it can't host. Prefer rules and the
    // spread load are scored over those dates.
    // `roomFor` (card #260): how far apart this person could space the shift in the pay period
    // at best (their open days' span); a cramped person ranks behind a roomy one in the band.
    // `groupsLeft` (card #260): how many more groups this pay period still needs. When it is at
    // least the number of people in the fairness band, every one of them gets one anyway: then
    // the most cramped go FIRST (so their few days aren't taken), not last.
    function pickStaff(pool: ScheduleStaff[], date?: string, datesOf?: (p: ScheduleStaff) => string[] | null, roomFor?: (p: ScheduleStaff) => number, groupsLeft?: number): ScheduleStaff {
      const datesFor = (p: ScheduleStaff): string[] | null => (datesOf ? datesOf(p) : date ? [date] : null);
      const preferOf = new Map<string, number>();
      if (date || datesOf) {
        for (const p of pool) {
          const ds = datesFor(p);
          preferOf.set(p.id, ds ? ds.reduce((n, d) => n + eligPreference(p, st.id, d), 0) : 0);
        }
      }
      // Option B (long-shift fit): for shifts longer than the fill shift, break
      // ties among equally-shared candidates by who the long shift serves best.
      // Two tiers, lower key wins:
      //   1. DIVISIBILITY NEED — staff whose remaining hours to target can't be
      //      reached with fill-shift days alone (e.g. 36h left, 8h fill → needs a
      //      12h ORL) come first, closest-to-target among them. This is the lever
      //      the ORL pairing/repair passes rely on.
      //   2. Everyone else by MOST ROOM to target (signed: projected − target, so
      //      an overshoot sorts last). This replaces the old absolute-distance
      //      |target − projected|, which ranked an EMPTY full-timer (0/80 → 64)
      //      behind every part-timer (0/16 → 0) and every staffer pre-loaded with
      //      manual hours — the ORC under-distribution of veteran full-timers.
      // Ranked BELOW every hard/soft min/max + request signal AND below the share
      // count, so it never concentrates a long shift on one person. Gated to long
      // shifts. STEP 3b's repair pass remains the guarantee.
      const fillHrsForFit = fillShift ? fillShift.defaultHours : 0;
      let fitMap: Map<string, number> | null = null;
      if (date && fillHrsForFit > 0 && st.defaultHours > fillHrsForFit) {
        const pp = findPPForDate(date);
        if (pp) {
          fitMap = new Map();
          const NEED_TIER = -1e9;
          for (const p of pool) {
            const target = targetFor(p, pp);
            if (target <= 0) { fitMap.set(p.id, Infinity); continue; }
            const current = ppHoursForStaff(p.id, pp) + pendingHolidayHours(p, pp, date); // card #176: owed HOL
            const projected = current + getShiftHours(p.id, st, overrideMap, dayTypeOf(date, holidaySet));
            const remaining = target - current;
            const fillMultiple = Math.round(remaining / fillHrsForFit) * fillHrsForFit;
            const needsLong = remaining > 0 && Math.abs(remaining - fillMultiple) > 1e-9;
            fitMap.set(p.id, needsLong ? NEED_TIER + Math.abs(target - projected) : projected - target);
          }
        }
      }
      // Card #203: an even-across-months shift ranks by this month's balance with a one-call
      // band; inside it, spacing, then the carried balance (earlier months: a tie-break only).
      const evenOn = !!st.evenAcrossMonths;
      const bal = evenOn ? evenBalance(st) : null;
      const runBal = (p: ScheduleStaff): number => bal!.run.get(p.id) ?? 0;
      const minRun = evenOn ? Math.min(...pool.map(runBal)) : 0;
      const inBand = (p: ScheduleStaff): boolean => runBal(p) < minRun + tuning.evenBandCalls - EPS;
      const spreadOf = (p: ScheduleStaff): number => { const ds = datesFor(p); return ds ? ds.reduce((n, d) => n + spreadLoad(p.id, d), 0) : Infinity; };
      // Card #260: with a minimum gap set, among people LEVEL on share (the even-across-months
      // band for an even shift), those whose days keep the gap go first, then the most room
      // (the widest smallest gap their days could have). Someone with fewer of the shift is
      // never put behind someone with more for spacing: in the Feb 2027 trial a one-group band
      // did that, and the person passed over still got the close leftover days (ST 23/25 Feb)
      // while another got an extra pair.
      const gapOn = gapKeysOn && gapOf(st) > 0 && !!(date || datesOf);
      const gapBadOf = new Map<string, number>();
      const roomOf = new Map<string, number>();
      let gapMinShare = Infinity;
      if (gapOn) {
        for (const p of pool) {
          const ds = datesFor(p);
          gapBadOf.set(p.id, ds && ds.length ? (gapNewBreaks(p.id, st, ds) > 0 ? 1 : 0) : 0);
          roomOf.set(p.id, roomFor ? Math.min(roomFor(p), gapOf(st)) : ds && ds.length ? Math.min(gapRoom(p.id, st, ds), gapOf(st)) : 0);
          gapMinShare = Math.min(gapMinShare, evenOn ? runBal(p) : shareCount(p));
        }
      }
      // The band the keys act in: the even shift's own band, else exactly level with the lowest.
      const inGapBand = (p: ScheduleStaff): boolean => gapOn && (evenOn ? inBand(p) : Math.abs(shareCount(p) - gapMinShare) < 1e-9);
      const allInBandServed = gapOn && groupsLeft !== undefined && groupsLeft >= pool.filter(inGapBand).length;
      const gapCmp = (a: ScheduleStaff, b: ScheduleStaff): number => {
        if (allInBandServed || !inGapBand(a) || !inGapBand(b)) return 0;
        return (gapBadOf.get(a.id) ?? 0) - (gapBadOf.get(b.id) ?? 0);
      };
      const roomCmp = (a: ScheduleStaff, b: ScheduleStaff): number => {
        if (!gapOn) return 0;
        const d = (roomOf.get(b.id) ?? 0) - (roomOf.get(a.id) ?? 0);
        return allInBandServed ? -d : d;
      };
      pool.sort((a, b) => {
        if (date) {
          // Hard minimum deficit first — a staff who MUST reach a required minimum
          // outranks everyone (overrides the hours cap via hasUnmetMinimum too).
          const hardA = getMinimumDeficit(a, st, date, "rule");
          const hardB = getMinimumDeficit(b, st, date, "rule");
          if (hardA !== hardB) return hardB - hardA;
          // Soft (preference) minimum deficit — Pay-period preferences — biases the
          // mix toward the target but ranks strictly below any hard minimum.
          const softA = getMinimumDeficit(a, st, date, "preference");
          const softB = getMinimumDeficit(b, st, date, "preference");
          if (softA !== softB) return softB - softA;
          // Soft max: a staff already at/over their preferred cap sorts behind one
          // who isn't (penalty, not a block).
          const overA = isOverSoftMaximum(a, st, date) ? 1 : 0;
          const overB = isOverSoftMaximum(b, st, date) ? 1 : 0;
          if (overA !== overB) return overA - overB;
          // Card #177: a soft "avoid B after A" rule — someone for whom this shift would make
          // an avoided pair with the day before/after sorts behind (never excluded).
          const avA = avoidedPairs(a.id, date, st.id);
          const avB = avoidedPairs(b.id, date, st.id);
          if (avA !== avB) return avA - avB;
          // Soft request preference: a staff who prefers this shift sorts ahead of
          // one who's indifferent; one who soft-avoids it (or prefers off) behind.
          const biasA = requestBias(a.id, date, st);
          const biasB = requestBias(b.id, date, st);
          if (biasA !== biasB) return biasB - biasA;
        }
        // Card #188: a staff card's Prefer rules — favoured days first, steered-away days last.
        // Below explicit requests, above share fairness (a "favour" that loses to round-robin
        // would do nothing).
        const prefA = preferOf.get(a.id) ?? 0;
        const prefB = preferOf.get(b.id) ?? 0;
        if (prefA !== prefB) return prefB - prefA;
        if (evenOn) {
          const ia = inBand(a), ib = inBand(b);
          if (ia !== ib) return ia ? -1 : 1;
          if (ia) {
            const gc = gapCmp(a, b);
            if (gc !== 0) return gc;
            const rc = roomCmp(a, b);
            if (rc !== 0) return rc;
            if (st.spreadOverMonth && (date || datesOf)) {
              const la = spreadOf(a), lb = spreadOf(b);
              if (la !== lb) return la - lb;
            }
            const carriedDiff = (bal!.carried.get(a.id) ?? 0) - (bal!.carried.get(b.id) ?? 0);
            if (Math.abs(carriedDiff) > EPS) return carriedDiff;
          }
          const runDiff = runBal(a) - runBal(b);
          if (Math.abs(runDiff) > EPS) return runDiff;
        } else {
          const countDiff = shareCount(a) - shareCount(b);
          if (Math.abs(countDiff) > 1e-9) return countDiff;
          const gc = gapCmp(a, b);
          if (gc !== 0) return gc;
          const rc = roomCmp(a, b);
          if (rc !== 0) return rc;
          // Card #178: among equally-shared candidates, the one with marked shifts furthest away.
          if (st.spreadOverMonth && (date || datesOf)) {
            const la = spreadOf(a), lb = spreadOf(b);
            if (la !== lb) return la - lb;
          }
        }
        // Option B long-shift fit (see fitMap above): among equally-shared
        // candidates, divisibility need first, then most room to target.
        // Subordinate to the share count so it never concentrates.
        if (fitMap) {
          const fitA = fitMap.get(a.id) ?? Infinity;
          const fitB = fitMap.get(b.id) ?? Infinity;
          if (fitA !== fitB) return fitA - fitB;
        }
        const lastA = lastRunDate.get(a.id) ?? "";
        const lastB = lastRunDate.get(b.id) ?? "";
        if (lastA !== lastB) return lastA.localeCompare(lastB);
        // Card #203: all-time raw counts favour newcomers; an even shift uses its balance instead.
        const histDiff = evenOn ? 0 : historicalCount(a.id, st.code) - historicalCount(b.id, st.code);
        if (histDiff !== 0) return histDiff;
        // Final seeded tiebreak (Slice 4b): only reached when every level above
        // is equal — a genuine tie. seed 0 ⇒ both 0 ⇒ stable order preserved.
        return seedTie(a.id) - seedTie(b.id);
      });
      return pool[0];
    }

    function recordAssignment(staffId: string, date: string) {
      runCount.set(staffId, (runCount.get(staffId) ?? 0) + 1);
      lastRunDate.set(staffId, date);
    }

    // Card #210 r3: days the residual fill covers for this shift — every day a holiday-rule
    // group claims, plus the unclaimed partner of any weekend pair a claim dissolves.
    const residualDays = new Set<string>();
    for (const d of dates) if (claimedSlots.has(slotKey(st.id, d))) residualDays.add(d);
    const isClaimed = (d: string): boolean => claimedSlots.has(slotKey(st.id, d));

    if (st.weekendPaired) {
      const saturdayDates = dates.filter((d) => getDow(d) === weekendStart); // card #215: the weekend's first day

      for (const sat of saturdayDates) {
        const sun = nextDate(sat);
        const satRequired = getRequiredCount(st, sat);
        const sunRequired = getRequiredCount(st, sun);
        if (satRequired <= 0 && sunRequired <= 0) continue;
        // A rule claims a day of this weekend: the Sat/Sun pair is dissolved and each day is
        // filled on its own by the residual fill below (never paired with the other group).
        if (isClaimed(sat) || isClaimed(sun)) {
          for (const d of [sat, sun]) if (dateSet.has(d)) residualDays.add(d);
          continue;
        }
        if (!dateSet.has(sun)) continue;

        const satCount = countCoverage(st.code, sat);
        const sunCount = countCoverage(st.code, sun);
        if (satCount >= satRequired && sunCount >= sunRequired) continue;

        // The pair lands as a unit, so when over-target may not be crossed (policy/rank)
        // its COMBINED hours must fit — the per-day checks below only see one day.
        const pairOk = (p: ScheduleStaff) => coverageBeatsOverHours || !pairWouldExceed(p, [sat, sun], st);
        // Card #265: the pair is gap-checked as one block with its Sunday. Someone whose Sunday a
        // maximum will drop (judged with the Saturday on the grid, which may be what fills it) gets
        // the Saturday alone, so that lone day must keep a Hard gap too. Checked in every tier.
        const getsSunday = (p: ScheduleStaff): boolean => {
          if (coverageBeatsHardLimits) return true;
          const key = `${p.id}:${sat}`, was = grid.get(key);
          grid.set(key, { shiftTypeId: st.id, code: st.code, locked: false, noCount: false, step: `weekend-${stepName}` });
          const capped = isAtMaximum(p, st, sun);
          if (was) grid.set(key, was); else grid.delete(key);
          return !capped;
        };
        const loneOk = (p: ScheduleStaff): boolean => !gapHard(st) || getsSunday(p) || !hardGapBlocks(p.id, st, [sat]);
        let loneRefused = false;
        const keepLone = (ps: ScheduleStaff[]): ScheduleStaff[] => {
          const kept = ps.filter(loneOk);
          if (kept.length < ps.length) loneRefused = true;
          return kept;
        };
        const available = keepLone(eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
            isAvailable(p, sat, st, { gapGroup: [sat, sun] }) && isAvailable(p, sun, st, { gapGroup: [sat, sun] }) &&
            !wouldBreakPPHours(p.id, sat, st) && pairOk(p)
        ));
        const fallback = available.length > 0 ? [] : keepLone(eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
            canFillCoverageOverLimits(p, sat, st, [sat, sun]) && canFillCoverageOverLimits(p, sun, st, [sat, sun]) && pairOk(p)
        ));
        if (available.length === 0) {
          if (fallback.length === 0) {
            const why = loneRefused ? ` — a maximum would leave ${sat} alone, too close to another ${st.code} (${hardGapWhy(st)})` : gapCause(st, [sat, sun], eligible);
            warnings.push(`No eligible ${st.code} staff for ${sat}/${sun}${why}`);
            continue;
          }
          warnings.push(`${st.code} ${sat}/${sun}: all eligible staff would exceed PP hours`);
        }
        const pool = available.length > 0 ? available : fallback;
        // Card #188: with Prefer rules in play, score the whole weekend each person would get.
        const chosen = pool.some((p) => preferRuleKeys.has(`${p.id}:${st.id}`)) ? pickStaff(pool, sat, () => [sat, sun]) : pickStaff(pool, sat);
        const sunToo = getsSunday(chosen);
        assign(chosen.id, sat, st, `Weekend ${st.code} (even dist — ${chosen.initials})`, `weekend-${stepName}`, 0.8);
        if (sunToo) {
          assign(chosen.id, sun, st, `Weekend ${st.code} (even dist — ${chosen.initials})`, `weekend-${stepName}`, 0.8);
        } else {
          warnings.push(`${chosen.initials}: skipped ${st.code} on ${sun} — capped by max shift limit`);
        }
        recordAssignment(chosen.id, sat);

        // Pair with a leading/following holiday: if the Friday before Saturday
        // or the Monday after Sunday is a holiday needing coverage, extend the
        // same staff member across it for a 3-day holiday weekend. If the chosen
        // staff can't take it, warn and leave it for the holiday pass below to
        // fill independently (the 3-day invariant couldn't be met).
        if (st.holidayWeekendPaired) {
          for (const bridge of [prevDate(sat), nextDate(sun)]) {
            if (!dateSet.has(bridge) || !holidaySet.has(bridge)) continue;
            if (isClaimed(bridge)) continue; // card #210: a rule's day; the group / residual fill owns it
            const bridgeRequired = getRequiredCount(st, bridge);
            if (bridgeRequired <= 0) continue;
            if (countCoverage(st.code, bridge) >= bridgeRequired) continue;
            if (isAssigned(chosen.id, bridge)) continue;
            if (!isAvailable(chosen, bridge, st)) {
              warnings.push(`${chosen.initials}: cannot extend ${st.code} weekend to adjacent holiday ${bridge} — unavailable`);
              continue;
            }
            if (isAtMaximum(chosen, st, bridge)) {
              warnings.push(`${chosen.initials}: skipped ${st.code} on holiday ${bridge} — capped by max shift limit`);
              continue;
            }
            assign(chosen.id, bridge, st, `Holiday weekend ${st.code} (${chosen.initials})`, `holiday-weekend-${stepName}`, 0.8);
            recordAssignment(chosen.id, bridge);
          }
        }
      }

      for (const date of dates) {
        if (!holidaySet.has(date) || isWeekend(date)) continue;
        if (isClaimed(date)) continue; // card #210: filled by the residual fill below
        const required = getRequiredCount(st, date);
        if (required <= 0) continue;
        const current = countCoverage(st.code, date);
        if (current >= required) continue;

        let available = eligible.filter(
          (p) => !isAssigned(p.id, date) && isAvailable(p, date, st) &&
            !wouldBreakPPHours(p.id, date, st)
        );
        if (available.length === 0) {
          available = eligible.filter(
            (p) => !isAssigned(p.id, date) && canFillCoverageOverLimits(p, date, st)
          );
        }
        if (available.length === 0) {
          warnings.push(`No eligible ${st.code} staff for holiday ${date}${gapCause(st, [date], eligible)}`);
          continue;
        }

        const chosen = pickStaff(available, date);
        assign(chosen.id, date, st, `Holiday ${st.code} (even dist — ${chosen.initials})`, `holiday-${stepName}`, 0.8);
        recordAssignment(chosen.id, date);
      }
    } else {
      // Compute pairing factor: shifts where (hours - fillHours) doesn't divide
      // evenly into fillHours need to be assigned in groups so the remaining
      // hours are always fill-divisible.
      const fillHrs = fillShift ? fillShift.defaultHours : 0;
      const extra = fillHrs > 0 ? st.defaultHours - fillHrs : 0;
      const pairingFactor = (extra > 0) ? fillHrs / gcd(extra, fillHrs) : 1;

      if (pairingFactor > 1 && fillShift) {
        // PP-grouped distribution: assign in groups of pairingFactor to ensure
        // each staff's total hours remain fill-divisible.
        const step2PPs = [...payPeriods]
          .filter(pp => dates.some(d => d >= pp.startDate && d <= pp.endDate))
          .sort((a, b) => a.startDate.localeCompare(b.startDate));

        for (const pp of step2PPs) {
          const ppNeedDates: string[] = [];
          for (const date of dates) {
            if (date < pp.startDate || date > pp.endDate) continue;
            if (getRequiredCount(st, date) > countCoverage(st.code, date)) {
              ppNeedDates.push(date);
            }
          }

          if (ppNeedDates.length === 0) continue;

          // Card #260: one pass of this pay period's placement (finishing pairs, groups, the
          // unpaired remainder, the day swaps); run twice below when the shift has a minimum gap.
          const placePP = (): void => {
          const usedDates = new Set<string>();
          // Card #260: how far apart a person could space this shift in the pay period at best.
          const roomCache = new Map<string, number>();
          const roomInPP = (p: ScheduleStaff): number => {
            let r = roomCache.get(p.id);
            if (r === undefined) {
              const open = ppNeedDates.filter((d) => isAvailable(p, d, st, { skipGap: true }));
              r = open.length >= 2 ? daysBetween(open[0], open[open.length - 1]) : 0;
              roomCache.set(p.id, r);
            }
            return r;
          };

          // Find a COMPLETE group of `pairingFactor` legal, uncapped, well-spread
          // dates that `chosen` can take from `remainDates`, or null if they can't
          // host a full group. Returning a partial is intentionally impossible —
          // that is what used to leave a lone ORL (and a +4 overshoot).
          const completeGroupFor = (chosen: ScheduleStaff, remainDates: string[], size: number = pairingFactor): string[] | null => {
            // Card #260: the gap is judged on the whole group below (a day that's too close alone
            // can be fine next to its partner), so the single-day pre-check leaves it out.
            const provAvailDates = remainDates
              .filter((d) => isAvailable(chosen, d, st, { skipGap: true }))
              .sort((a, b) => a.localeCompare(b));
            const gapBad = (combo: string[]): number => (gapOf(st) ? gapNewBreaks(chosen.id, st, combo) : 0);
            if (provAvailDates.length < size) return null;
            // Anchor dates: PP boundaries (push toward the middle) plus dates where
            // this staff already has other scheduled shifts in this PP.
            const anchorDates: string[] = [prevDate(pp.startDate), nextDate(pp.endDate)];
            if (st.spreadOverMonth) {
              // Card #178: keep away from the person's MARKED shifts (this one included), also
              // just across the pay-period edges.
              // Card #203: two weeks either side, history and next month's cells included.
              const stop = addDays(pp.endDate, spreadRadius);
              for (let d = addDays(pp.startDate, -spreadRadius); d <= stop; d = nextDate(d)) {
                if (spreadIds.has(cellShiftAt(chosen.id, d) ?? "")) anchorDates.push(d);
              }
            } else {
              for (const date of dates) {
                if (date < pp.startDate || date > pp.endDate) continue;
                const cell = getCell(chosen.id, date);
                if (cell && cell.code !== st.code && !stById.get(cell.shiftTypeId)?.isOffShift) anchorDates.push(date);
              }
            }
            const violatesFollow = (picked: string[], candidate: string): boolean => {
              if (!followMap.has(st.id)) return false;
              for (const pd of picked) {
                if (nextDate(pd) === candidate && !isShiftAllowedAfter(followMap, st.id, st.id, st.isOffShift)) return true;
                if (prevDate(pd) === candidate && !isShiftAllowedAfter(followMap, st.id, st.id, st.isOffShift)) return true;
              }
              return false;
            };
            // Among equally spread groups: fewer soft-avoided pairs first (card #177), then the seed.
            const groupAvoided = (combo: string[]): number =>
              avoidedInRun(combo, (d) => (combo.includes(d) ? st.id : grid.get(`${chosen.id}:${d}`)?.shiftTypeId));
            const tieKey = seedNum || avoidSet.size > 0
              ? (combo: string[]) => groupAvoided(combo) * 1e10 + (seedNum ? seedTie(`${chosen.id}|${combo.join(",")}`) : 0)
              : undefined;
            if (st.spreadOverMonth) {
              // Card #203: the group whose days sit furthest from the person's marked shifts AND
              // from each other (spreadPenalty), then fewer avoided pairs, then the old min-gap
              // pull toward the pay period's middle, then the seed.
              const open = provAvailDates.filter((d) => !isAtMaximum(chosen, st, d));
              const pairW = (a: string, b: string): number => { const g = daysBetween(a, b); return g >= 1 && g <= spreadRadius ? (spreadRadius + 1 - g) ** 2 : 0; };
              const minGap = (combo: string[]): number => {
                let m = Infinity;
                for (const d of combo) for (const o of [...anchorDates, ...combo]) if (o !== d) m = Math.min(m, daysBetween(d, o));
                return m;
              };
              let best: { combo: string[]; key: number[] } | null = null;
              const walk = (from: number, combo: string[]): void => {
                if (combo.length === size) {
                  let pen = 0;
                  for (let i = 0; i < combo.length; i++) {
                    pen += spreadLoad(chosen.id, combo[i]);
                    for (let j = i + 1; j < combo.length; j++) pen += pairW(combo[i], combo[j]);
                  }
                  // Card #260: a Hard gap drops the group; a Prefer gap ranks it behind every group that keeps it.
                  const bad = gapBad(combo);
                  if (bad > 0 && gapHard(st)) return;
                  const key = [bad, pen, avoidSet.size > 0 ? groupAvoided(combo) : 0, -minGap(combo), seedNum ? seedTie(`${chosen.id}|${combo.join(",")}`) : 0];
                  if (!best || cmpTuple(key, best.key) < 0) best = { combo: [...combo], key };
                  return;
                }
                for (let i = from; i <= open.length - (size - combo.length); i++) {
                  if (violatesFollow(combo, open[i])) continue;
                  combo.push(open[i]);
                  walk(i + 1, combo);
                  combo.pop();
                }
              };
              walk(0, []);
              return best ? (best as { combo: string[] }).combo : null;
            }
            // Card #260: groups that keep the gap first (the only ones under Hard); Prefer falls back.
            const keepsGap = (p: string[], c: string): boolean => !gapOf(st) || gapBad([...p, c]) === 0;
            const tryPick = (gapOk: boolean): string[] | null => {
              const picked = bestSpread(provAvailDates, size, anchorDates, (p, c) => !violatesFollow(p, c) && (!gapOk || keepsGap(p, c)), tieKey)
                .filter((d) => !isAtMaximum(chosen, st, d));
              if (picked.length < size) return null;
              const g = picked.slice(0, size);
              return gapOk && gapBad(g) > 0 ? null : g;
            };
            if (gapOf(st)) return tryPick(true) ?? (gapHard(st) ? null : tryPick(false));
            return tryPick(false);
          };

          // Card #232: finish HALF groups first. A person who already holds this shift in
          // the pay period (hand-entered, a request, an earlier step) a non-multiple of
          // pairingFactor times may be unable to land on target with fill days alone; one
          // more (or the missing few) can fix that. "Can't land" is judged in each person's
          // fill-day grain (the gcd of the fill hours on the days they could hold the fill,
          // as the hours repair judges it: a 12 h Saturday OR counts for someone who works
          // Saturdays), and finishing must leave hours they CAN fill, within target.
          const c100 = (h: number): number => Math.round(h * 100);
          const ppRunDates = dates.filter((d) => d >= pp.startDate && d <= pp.endDate && !isFrozen(d));
          const fillGrain = (p: ScheduleStaff): number => {
            let g = 0;
            for (const d of ppRunDates) {
              const h = c100(countedHrs(p.id, fillShift, d));
              if (h <= 0) continue;
              const c = grid.get(`${p.id}:${d}`);
              if (c ? !isAwayShift(c.shiftTypeId) : isAvailable(p, d, fillShift)) g = gcd(g, h);
            }
            return g;
          };
          // Candidates: anyone whose hours LEFT can't be filled in their grain, for whom the
          // fewest (1..pairingFactor-1) of this shift would make them fillable. Usually that is
          // a person holding a lone one (`lone`: named in a warning when it can't be finished),
          // but another 12 h shift can make someone odd too, and fairness picks between them.
          // A required each-day WORK follower that counts toward FTE (e.g. ORL → ADM) adds
          // its hours to every finishing day, whatever countsTowardTargets says (Codex #1049, #1051).
          const finSpec = followerBySource.get(st.id);
          const finFollower = finSpec && finSpec.scope === "each_day" && finSpec.follower.countsTowardFte
            && !finSpec.follower.isOffShift && !finSpec.follower.isLeave ? finSpec.follower : null;
          const finishHrs = (p: ScheduleStaff, d: string): number =>
            c100(countedHrs(p.id, st, d)) + (finFollower ? c100(countedHrs(p.id, finFollower, nextDate(d))) : 0);
          type Holder = { p: ScheduleStaff; k: number; left: number; grain: number; lone: boolean };
          const holderOf = (p: ScheduleStaff): Holder | null => {
            const target = targetFor(p, pp);
            if (!(target > 0)) return null;
            const grain = fillGrain(p) || c100(fillHrs); // no fill day they can hold: judge in the plain fill length
            const left = c100(target - ppHoursForStaff(p.id, pp) - pendingHolidayHours(p, pp, ppNeedDates));
            if (left <= 0 || grain <= 0 || left % grain === 0) return null;
            let have = 0;
            for (let d = pp.startDate; d <= pp.endDate; d = nextDate(d)) if (cellShiftAt(p.id, d) === st.id) have++;
            const lone = have % pairingFactor !== 0;
            const h = c100(st.defaultHours) + (finFollower ? c100(finFollower.defaultHours) : 0);
            for (let k = 1; k < pairingFactor; k++) {
              const after = left - k * h;
              if (after < 0) break;
              if (after % grain === 0) return { p, k, left, grain, lone };
            }
            return null;
          };
          if (!skipFinishPairsForTest) {
            let holders = eligible.map(holderOf).filter((h): h is Holder => h !== null);
            // Only in a pay period where someone really holds a lone one: elsewhere the pairs
            // loop below and the hours repair after it keep their established behaviour.
            if (!holders.some((h) => h.lone)) holders = [];
            while (holders.length > 0) {
              const remainDates = ppNeedDates.filter((d) => !usedDates.has(d));
              const groups = new Map(holders.map((h) => [h.p.id, completeGroupFor(h.p, remainDates, h.k)] as const));
              const usable: Holder[] = [];
              for (const h of holders) {
                const g = groups.get(h.p.id);
                if (!g) {
                  if (h.lone) warnings.push(`${h.p.initials}: could not finish the ${st.code} pair in PP ${pp.startDate} — no remaining ${st.code} day they can work`);
                  continue;
                }
                const after = h.left - g.reduce((n, d) => n + finishHrs(h.p, d), 0);
                if (after >= 0 && after % h.grain === 0) usable.push(h); // otherwise finishing wouldn't help
              }
              if (usable.length === 0) break;
              const chosen = pickStaff(usable.map((h) => h.p), remainDates[0], (p) => groups.get(p.id) ?? null, gapOf(st) ? roomInPP : undefined);
              for (const date of groups.get(chosen.id)!) {
                const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
                assign(chosen.id, date, st, `${st.code} (finishes pair${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`, stepName, 0.7);
                usedDates.add(date);
                recordAssignment(chosen.id, date);
                placeEachDayFollower(chosen.id, date, st);
              }
              // Re-check the rest against the days now left (a day just taken may have been theirs).
              holders = usable.filter((h) => h.p.id !== chosen.id);
            }
          }

          // Place COMPLETE groups only — never a partial. This keeps every staffer's
          // count of this shift a multiple of pairingFactor per PP (e.g. ORL is only
          // ever assigned in PAIRS), so a 12h ORL can't strand a full-timer at +4 over
          // an 8h-divisible target. If the best-fit staffer can't host a full group,
          // try the next; stop when no one can pair the remaining dates.
          while (true) {
            const remainDates = ppNeedDates.filter((d) => !usedDates.has(d));
            if (remainDates.length < pairingFactor) break;

            const hostable = eligible.filter((p) => remainDates.filter((d) => isAvailable(p, d, st, { skipGap: true })).length >= pairingFactor);
            // Prefer staff a full group does NOT push over their PP target (a hard
            // minimum overrides the cap); fall back to any hostable if none fit.
            const fits = hostable.filter((p) => {
              const target = targetFor(p, pp);
              // The group spans pairingFactor of remainDates (day-type mix not
              // yet fixed); value each day at the largest day type so this cap
              // pre-check stays conservative and never overfills a staffer.
              const perDayHrs = maxShiftHours(p.id, st, overrideMap);
              const groupHrs = pairingFactor * perDayHrs;
              // Card #176: owed HOL counts; the group's own days may be holidays it works.
              const owed = pendingHolidayHours(p, pp, remainDates);
              return !(target > 0 && ppHoursForStaff(p.id, pp) + owed + groupHrs > target) || (hardMinBeatsOverHours && hasUnmetMinimum(p, st, remainDates[0]));
            });

            let placed = false;
            // The any-hostable fallback ignores hours, so it's only open when coverage may
            // push past over-target (policy + rank); otherwise only `fits` may host.
            for (const tier of coverageBeatsOverHours ? [fits, hostable] : [fits]) {
              let poolList = [...tier];
              while (poolList.length > 0) {
                // Cards #178/#188: rank hosts by the group each would actually get (spread load,
                // Prefer rules) — remainDates[0] may be a day a host won't work.
                const groups = st.spreadOverMonth || gapOf(st) > 0 || poolList.some((p) => preferRuleKeys.has(`${p.id}:${st.id}`))
                  ? new Map(poolList.map((p) => [p.id, completeGroupFor(p, remainDates)])) : null;
                const chosen = groups
                  ? pickStaff(poolList, remainDates[0], (p) => groups.get(p.id) ?? null, gapOf(st) ? roomInPP : undefined, Math.floor(remainDates.length / pairingFactor))
                  : pickStaff(poolList, remainDates[0]);
                const group = groups ? groups.get(chosen.id)! : completeGroupFor(chosen, remainDates);
                if (group) {
                  for (const date of group) {
                    const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
                    assign(chosen.id, date, st, `${st.code} (paired dist${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`, stepName, 0.7);
                    usedDates.add(date);
                    recordAssignment(chosen.id, date);
                    placeEachDayFollower(chosen.id, date, st);
                  }
                  placed = true;
                  break;
                }
                poolList = poolList.filter((p) => p.id !== chosen.id);
              }
              if (placed) break;
            }
            if (!placed) break;
          }

          // Genuinely unpairable remainder — an odd required day, or no one can host
          // another full group (e.g. a scarce shift like ICU whose eligible pool
          // can't form another complete group). This only fires AFTER complete-group
          // packing, so a normal even-weekday ORL run leaves nothing here. Coverage
          // is preserved exactly as before: prefer staff the placement won't push
          // over target, but fall back to covering anyway (a scarce-shift overage the
          // post-repair audit then flags) rather than dropping required coverage.
          const leftoverDates = ppNeedDates.filter((d) => !usedDates.has(d));
          for (const date of leftoverDates) {
            let available = eligible.filter((p) => isAvailable(p, date, st) && hoursOkOrHardMin(p, date, st));
            if (available.length === 0) available = eligible.filter((p) => canFillCoverageOverLimits(p, date, st));
            if (available.length === 0) {
              warnings.push(`No eligible ${st.code} staff for ${date} (unpaired remainder) in PP ${pp.startDate}${gapCause(st, [date], eligible)}`);
              continue;
            }
            const chosen = pickStaff([...available], date);
            const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
            assign(chosen.id, date, st, `${st.code} (unpaired remainder${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`, stepName, 0.7);
            recordAssignment(chosen.id, date);
            placeEachDayFollower(chosen.id, date, st);
          }

          // ── Card #233: choose the pay period's days jointly ──
          // The groups above are chosen one host at a time, so the last hosts take what is left
          // (two ORLs three days apart). A bounded best-improvement search then trades DAYS
          // between two hosts — A's d1 for B's d2 — when that strictly lowers the spacing penalty
          // (spreadDelta: the exact before/after penalty of both people). Who holds the shift, how
          // many and their hours never change; every swap is judged on the grid it leaves.
          // v1 scope: no follower source (a date swap could split a run or move a follower).
          if (st.spreadOverMonth && spreadIds.size > 0 && !skipJointSpreadForTest && !followerBySource.has(st.id)) {
            jointSpreadSwaps(pp);
          }
          };

          // Card #260: Prefer works greedily (the host keys: spacing first, then room, among
          // people level on share; groups that keep the gap first; the day swaps' guards), and
          // in the Feb 2027 trial that cascaded: a person passed over still got the close
          // leftover days, or none, so another got more and the hours repair scattered single
          // ORLs. So the pay period is placed twice, and the result with the gap at work is kept
          // only when it beats the baseline (gapTrialBeats): fewer too-close pairs, and no worse
          // on coverage, lone groups, the most anyone holds, people over target or hours short.
          // The baseline is the pay period placed as if the setting were off (Prefer), or with
          // the gap but without the host keys (Hard: the gap itself is never off). Later steps
          // (repairs) run once, on the kept result.
          if (gapOf(st) > 0 && !skipGapTrialForTest) {
            const snap = takeState();
            const prefer = !gapHard(st);
            if (prefer) gapSuspended = st.id; else gapKeysOn = false;
            try { placePP(); } finally { gapSuspended = null; gapKeysOn = true; }
            const base = ppOutcome(pp);
            const baseState = takeState();
            restoreState(snap);
            placePP();
            if (!gapTrialBeats(ppOutcome(pp), base)) restoreState(baseState);
          } else {
            placePP();
          }
        }

        // The whole engine state a pay period's placement can change: every cell, every
        // suggestion (copied: the day swaps edit them in place), step counts, warnings and the
        // run's share counts.
        type EngineState = { cells: [string, NonNullable<ReturnType<typeof grid.get>>][]; sug: Suggestion[]; steps: Record<string, number>; warn: string[]; run: [string, number][]; last: [string, string][] };
        function takeState(): EngineState {
          return { cells: [...grid].map(([k, v]) => [k, { ...v }]), sug: suggestions.map((x) => ({ ...x })), steps: { ...byStep }, warn: warnings.slice(), run: [...runCount], last: [...lastRunDate] };
        }
        function restoreState(s: EngineState): void {
          grid.clear();
          for (const [k, v] of s.cells) grid.set(k, { ...v });
          suggestions.length = 0;
          suggestions.push(...s.sug.map((x) => ({ ...x })));
          for (const k of Object.keys(byStep)) delete byStep[k];
          Object.assign(byStep, s.steps);
          warnings.length = 0;
          warnings.push(...s.warn);
          runCount.clear(); for (const [k, v] of s.run) runCount.set(k, v);
          lastRunDate.clear(); for (const [k, v] of s.last) lastRunDate.set(k, v);
        }
        // `short`: hours short of target that can't be made up, judged as each person's hours
        // now plus the fill shift on every day they could still take it (a 12 h ORL moved off
        // someone who can't reach target leaves them 4 h shorter). See gapTrialBeats.
        function ppOutcome(pp: (typeof payPeriods)[number]): GapTrialOutcome {
          let covered = 0, over = 0, close = 0, broken = 0, most = 0, short = 0;
          for (const d of dates) if (d >= pp.startDate && d <= pp.endDate) covered += countCoverage(st.code, d);
          for (const p of eligible) {
            let n = 0;
            for (const d of dates) if (d >= pp.startDate && d <= pp.endDate && grid.get(`${p.id}:${d}`)?.shiftTypeId === st.id) n++;
            if (n % pairingFactor !== 0) broken++;
            most = Math.max(most, n);
            const target = targetFor(p, pp);
            const have = ppHoursForStaff(p.id, pp) + pendingHolidayHours(p, pp, []);
            if (target > 0 && have > target + EPS) over++;
            if (target > 0 && fillShift) {
              let reach = have;
              for (const d of dates) if (d >= pp.startDate && d <= pp.endDate && !grid.has(`${p.id}:${d}`) && isAvailable(p, d, fillShift)) reach += countedHrs(p.id, fillShift, d);
              short += Math.max(0, target - reach);
            }
            close += gapBreaks((d) => cellShiftAt(p.id, d) === st.id, pp.startDate, pp.endDate, gapOf(st)).size;
          }
          return { covered, broken, most, over, short, close };
        }

        function jointSpreadSwaps(pp: (typeof payPeriods)[number]): void {
          const LIM = jointSpreadLimitsForTest ?? { swaps: 200, checks: 50000 };
          const ppDates = dates.filter((d) => d >= pp.startDate && d <= pp.endDate);
          const ppRangesAll: PayPeriodRange[] = payPeriods.map((x) => ({ startDate: x.startDate, endDate: x.endDate }));
          // Only this step's own unlocked cells of the shift, on writable days.
          const movable = (): { p: ScheduleStaff; d: string }[] => {
            const out: { p: ScheduleStaff; d: string }[] = [];
            for (const p of eligible) for (const d of ppDates) {
              if (isFrozen(d)) continue;
              const c = grid.get(`${p.id}:${d}`);
              if (c && c.shiftTypeId === st.id && !c.locked && !c.noCount && c.step === stepName && c.source !== "manual") out.push({ p, d });
            }
            return out;
          };
          const softAvoid = (id: string, d: string): number => {
            if (requestList.length === 0) return 0;
            const f = foldFor(id, d);
            return f.avoidWorking || f.avoidedShiftIds.has(st.id) ? 1 : 0;
          };
          // Follow rules around a cell as the grid now stands; an emptied in-range day reads as off.
          const followOk = (id: string, d: string): boolean => {
            const at = (x: string): { id: string; off: boolean } | null => {
              const c = grid.get(`${id}:${x}`);
              if (!c) return offShift && dateSet.has(x) ? { id: offShift.id, off: true } : null;
              return { id: c.shiftTypeId, off: !!stById.get(c.shiftTypeId)?.isOffShift };
            };
            const me = at(d), prev = at(prevDate(d)), next = at(nextDate(d));
            if (!me) return true;
            if (prev && !isShiftAllowedAfter(followMap, prev.id, me.id, me.off)) return false;
            if (next && !isShiftAllowedAfter(followMap, me.id, next.id, next.off)) return false;
            return true;
          };
          // Hard minimum windows of this shift touching the changed days: never left lower when below.
          const hardWindows = (p: ScheduleStaff, days: string[]): { start: string; end: string; min: number }[] => {
            const out: { start: string; end: string; min: number }[] = [];
            for (const t of p.shiftMinimumTargets ?? []) {
              if (t.shiftTypeId !== st.id || (t.strength ?? "rule") !== "rule" || !(t.minCount > 0)) continue;
              for (const d of days) { const b = getWindowBounds(t, d, ppRangesAll); if (b) out.push({ ...b, min: t.minCount }); }
            }
            return out;
          };
          const countIn = (id: string, w: { start: string; end: string }): number => {
            let n = 0;
            for (let x = w.start; x <= w.end; x = nextDate(x)) { const c = grid.get(`${id}:${x}`); if (c && c.code === st.code && !c.noCount) n++; }
            return n;
          };
          const condOwners = staff.filter((p) => p.isActive && p.availabilityRules.some((r) => r.conditionStaffId && r.conditionType));
          const condBroken = (): Set<string> => {
            const out = new Set<string>();
            for (const p of condOwners) for (const d of ppDates) {
              const c = grid.get(`${p.id}:${d}`);
              if (!c || !isWorking(p.id, d) || stById.get(c.shiftTypeId)?.ignoresWorkingDays) continue;
              if (!evaluateAvailability(p.availabilityRules, d, payPeriods, (pid, x) => isWorking(pid, x)).available) out.add(`${p.id}:${d}`);
            }
            return out;
          };
          /** Makes the swap if the grid it leaves passes every hard check; otherwise leaves the grid as it was. */
          const trySwap = (A: ScheduleStaff, d1: string, B: ScheduleStaff, d2: string): boolean => {
            const kA1 = `${A.id}:${d1}`, kA2 = `${A.id}:${d2}`, kB1 = `${B.id}:${d1}`, kB2 = `${B.id}:${d2}`;
            const cA = grid.get(kA1)!, cB = grid.get(kB2)!;
            const wins = [...hardWindows(A, [d1, d2]).map((w) => ({ id: A.id, w })), ...hardWindows(B, [d1, d2]).map((w) => ({ id: B.id, w }))];
            const winBefore = wins.map(({ id, w }) => countIn(id, w));
            const condBefore = condBroken();
            const cover = [countCoverage(st.code, d1), countCoverage(st.code, d2)];
            // Equal shift hours aren't enough: leaving a holiday can make the person owed HOL
            // hours (Codex #1063). Each person's projected PP hours, owed HOL included, stay put.
            const projected = (p: ScheduleStaff): number => Math.round((ppHoursForStaff(p.id, pp) + pendingHolidayHours(p, pp, [])) * 100);
            const hoursBefore = [projected(A), projected(B)];
            const undo = (): false => {
              grid.delete(kA2); grid.delete(kB1);
              grid.set(kA1, cA); grid.set(kB2, cB);
              return false;
            };
            const gapSnap = gapSnapshot([A.id, B.id], [d1, d2]); // card #260: the end state, removals included
            grid.delete(kA1); grid.delete(kB2);
            if (!isAvailable(A, d2, st)) return undo();
            grid.set(kA2, { ...cA });
            if (!isAvailable(B, d1, st)) return undo();
            grid.set(kB1, { ...cB });
            for (const [id, d] of [[A.id, d1], [A.id, d2], [B.id, d1], [B.id, d2]] as const) if (!followOk(id, d)) return undo();
            for (let i = 0; i < wins.length; i++) {
              const now = countIn(wins[i].id, wins[i].w);
              if (now < wins[i].w.min && now < winBefore[i]) return undo();
            }
            for (const k of condBroken()) if (!condBefore.has(k)) return undo();
            if (countCoverage(st.code, d1) !== cover[0] || countCoverage(st.code, d2) !== cover[1]) return undo();
            if (projected(A) !== hoursBefore[0] || projected(B) !== hoursBefore[1]) return undo();
            if (gapNewSince(gapSnap)) return undo();
            return true;
          };
          // Card #260: each person's gaps between two of THIS shift (day to day) around the pay
          // period, as the grid stands or with one day moved. A swap never brings the closer of
          // the two people's closest pair of THIS shift closer (so ORL-to-ORL distance is no
          // longer traded for distance from CALL/ORC: RMc 10/17 → 9/11); with a minimum gap set it
          // also never shrinks either person's gap under it (gap by gap, never summed: Codex
          // #1190/#1195) and never adds a too-close pair for either person. Swaps rank by fewer
          // too-close pairs, then the spread penalty over all marked shifts, then less closeness
          // of THIS shift (so 16/18 → 16/19 is taken when the spread is level). Gaps above that
          // may still be traded: spreading everyone needs one to give a little.
          const gapReach = Math.max(gapOf(st), spreadRadius);
          const gapFrom = addDays(pp.startDate, -gapReach), gapTo = addDays(pp.endDate, gapReach);
          const holdsMoved = (id: string, drop?: string, add?: string) => (d: string): boolean =>
            d === add ? true : d === drop ? false : cellShiftAt(id, d) === st.id;
          const closeness = (gaps: number[]): number => gaps.reduce((n, g) => n + (g >= 1 && g <= spreadRadius ? (spreadRadius + 1 - g) ** 2 : 0), 0);
          const breaksOf = (has: (d: string) => boolean): number => (gapOf(st) ? gapBreaks(has, gapFrom, gapTo, gapOf(st)).size : 0);
          const moveSuggestion = (id: string, from: string, to: string): void => {
            const s = suggestions.find((x) => x.staffId === id && x.date === from && x.shiftTypeId === st.id);
            if (!s) return;
            s.date = to;
            if (!s.reason.endsWith(" · spread swap")) s.reason += " · spread swap";
          };
          const lastOf = (id: string): void => {
            let last: string | undefined;
            for (const d of dates) { const c = grid.get(`${id}:${d}`); if (c && c.code === st.code && !c.noCount) last = d; }
            if (last) lastRunDate.set(id, last); else lastRunDate.delete(id);
          };

          let swaps = 0, checks = 0, capped = false;
          search: while (true) {
            if (swaps >= LIM.swaps) { capped = true; break; }
            const cells = movable();
            const cands: { key: number[]; A: ScheduleStaff; d1: string; B: ScheduleStaff; d2: string }[] = [];
            for (let i = 0; i < cells.length; i++) for (let j = 0; j < cells.length; j++) {
              const { p: A, d: d1 } = cells[i], { p: B, d: d2 } = cells[j];
              if (A.id === B.id || d1 === d2) continue;
              if (i > j) continue; // each unordered pair once
              if (d1.slice(0, 7) !== d2.slice(0, 7)) continue; // calendar-month counts stay as they are
              if (grid.has(`${A.id}:${d2}`) || grid.has(`${B.id}:${d1}`)) continue; // destination must be empty
              if (countedHrs(A.id, st, d1) !== countedHrs(A.id, st, d2) || countedHrs(B.id, st, d1) !== countedHrs(B.id, st, d2)) continue;
              if (++checks > LIM.checks) { capped = true; break search; }
              if (eligPreference(A, st.id, d2) < eligPreference(A, st.id, d1) || eligPreference(B, st.id, d1) < eligPreference(B, st.id, d2)) continue;
              if (softAvoid(A.id, d2) > softAvoid(A.id, d1) || softAvoid(B.id, d1) > softAvoid(B.id, d2)) continue;
              const runA = (d: string) => (d === d1 ? null : d === d2 ? st.id : grid.get(`${A.id}:${d}`)?.shiftTypeId);
              const runB = (d: string) => (d === d2 ? null : d === d1 ? st.id : grid.get(`${B.id}:${d}`)?.shiftTypeId);
              const nowA = (d: string) => grid.get(`${A.id}:${d}`)?.shiftTypeId, nowB = (d: string) => grid.get(`${B.id}:${d}`)?.shiftTypeId;
              if (avoidedInRun([d1, d2], runA) > avoidedInRun([d1, d2], nowA) || avoidedInRun([d1, d2], runB) > avoidedInRun([d1, d2], nowB)) continue;
              const hasA0 = holdsMoved(A.id), hasA1 = holdsMoved(A.id, d1, d2);
              const hasB0 = holdsMoved(B.id), hasB1 = holdsMoved(B.id, d2, d1);
              const gA0 = gapList(hasA0, gapFrom, gapTo, true), gA1 = gapList(hasA1, gapFrom, gapTo, true);
              const gB0 = gapList(hasB0, gapFrom, gapTo, true), gB1 = gapList(hasB1, gapFrom, gapTo, true);
              if (gapOf(st) && (gapListShrank(gA0, gA1, gapOf(st)) || gapListShrank(gB0, gB1, gapOf(st)))) continue;
              const brA0 = breaksOf(hasA0), brA1 = breaksOf(hasA1), brB0 = breaksOf(hasB0), brB1 = breaksOf(hasB1);
              if (brA1 > brA0 || brB1 > brB0) continue;
              // The closer of the two people's closest pair of THIS shift never gets closer
              // (RMc 10/17 → 9/11 traded a 7-day gap for distance from CALL/ORC).
              const minOf = (g: number[]): number => (g.length ? g[0] : Infinity);
              if (Math.min(minOf(gA1), minOf(gB1)) < Math.min(minOf(gA0), minOf(gB0))) continue;
              const delta = spreadDelta([[A.id, d1, null], [A.id, d2, st.id], [B.id, d2, null], [B.id, d1, st.id]]);
              const key = [brA1 + brB1 - brA0 - brB0, delta, closeness(gA1) + closeness(gB1) - closeness(gA0) - closeness(gB0)];
              if (cmpTuple(key.map((v) => (Math.abs(v) <= EPS ? 0 : v)), [0, 0, 0]) < 0) cands.push({ key, A, d1, B, d2 });
            }
            cands.sort((x, y) => cmpTuple(x.key, y.key)); // stable: ties keep staff/date order
            const made = cands.find((c) => trySwap(c.A, c.d1, c.B, c.d2));
            if (!made) break;
            moveSuggestion(made.A.id, made.d1, made.d2);
            moveSuggestion(made.B.id, made.d2, made.d1);
            lastOf(made.A.id); lastOf(made.B.id);
            swaps++;
          }
          if (capped) warnings.push(`${st.code} spread search limit reached in PP ${pp.startDate}`);
        }
      } else {
        // Day-by-day distribution (pairingFactor === 1)
        for (const date of dates) {
          const required = getRequiredCount(st, date);
          if (required <= 0) continue;

          const current = countCoverage(st.code, date);
          if (current >= required) continue;

          const needed = required - current;
          let available = eligible.filter(
            (p) => isAvailable(p, date, st) && hoursOkOrHardMin(p, date, st)
          );
          if (available.length === 0) {
            available = eligible.filter((p) => canFillCoverageOverLimits(p, date, st));
          }

          if (available.length === 0) {
            warnings.push(`No eligible ${st.code} staff for ${date}${gapCause(st, [date], eligible)}`);
            continue;
          }

          const dow = getDow(date);
          // Card #204: no hidden per-day filter — a person's favoured days are the staff card's
          // "eligible · Prefer" rules, which rank inside pickStaff and never narrow the pool.
          let pool = available;
          const desirability = dwMap.get(`${st.id}:${dow}`) ?? 0;

          for (let i = 0; i < needed; i++) {
            if (pool.length === 0) break;
            // `available` was checked before any of these placements: re-check the
            // day's Max (Staffing Rules) so a minimum above it can't overfill the day.
            if (dayFull(st, date)) break;
            const chosen = pickStaff([...pool], date);

            assign(
              chosen.id,
              date,
              st,
              `${st.code} (even dist${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
              stepName,
              0.7
            );
            recordAssignment(chosen.id, date);

            placeEachDayFollower(chosen.id, date, st);

            pool = pool.filter((p) => p.id !== chosen.id);
          }
        }
      }
    }

    // ── Card #210 r3: residual fill ── each day a rule claims (or a dissolved weekend leaves
    // open) that is still short, one day at a time, with the holiday pass's single-day gate.
    for (const date of [...residualDays].sort()) {
      if (!dateSet.has(date) || isFrozen(date)) continue;
      const required = getRequiredCount(st, date);
      if (required <= 0 || countCoverage(st.code, date) >= required) continue;
      let available = eligible.filter((p) => !isAssigned(p.id, date) && isAvailable(p, date, st) && !wouldBreakPPHours(p.id, date, st));
      if (available.length === 0) available = eligible.filter((p) => !isAssigned(p.id, date) && canFillCoverageOverLimits(p, date, st));
      if (available.length === 0) {
        warnings.push(`No eligible ${st.code} staff for ${date}${gapCause(st, [date], eligible)}`);
        continue;
      }
      const chosen = pickStaff(available, date);
      assign(chosen.id, date, st, `${st.code} (day of a holiday rule, filled on its own — ${chosen.initials})`, `holiday-rule-fill-${stepName}`, 0.75);
      recordAssignment(chosen.id, date);
      placeEachDayFollower(chosen.id, date, st);
    }

    // each_run followers (e.g. a CALL weekend → one ADM) are placed here, after
    // this shift's distribution, so each consecutive run is fully formed. each_day
    // followers (e.g. ORC→X) were placed inline above. CALL (priority 10) finishes
    // before ORC (20), so ORC distribution and the hours math see these followers.
    placeRunFollowers(st);
  }

  // ── STEP 2b: Satisfy per-staff shift minimum targets ──
  //
  // If a staff has a minCount target for a shift (e.g. "at least 1 ADM per PP"),
  // proactively assign that shift on eligible days even without global staffing
  // requirements. This runs after staffing reqs so those slots are filled first.

  for (const staff of activeStaff) {
    if (!staff.shiftMinimumTargets || staff.shiftMinimumTargets.length === 0) continue;
    const ppRanges = payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));

    for (const target of staff.shiftMinimumTargets) {
      if (target.minCount <= 0) continue;
      if (target.window === "days") continue; // rolling windows have overlapping bounds — post-schedule warning only
      const st = stById.get(target.shiftTypeId);
      if (!st || !st.autoSchedulable || st.isOffShift) continue;

      const checkedWindows = new Set<string>();
      for (const date of dates) {
        const bounds = getWindowBounds(target, date, ppRanges);
        if (!bounds) continue;
        const windowKey = `${bounds.start}:${bounds.end}`;
        if (checkedWindows.has(windowKey)) continue;
        checkedWindows.add(windowKey);

        function countInWindow(): number {
          let n = 0;
          for (const [k, v] of grid.entries()) {
            if (k.startsWith(staff.id + ":") && v.code === st!.code && !v.noCount) {
              const d = k.split(":")[1];
              if (d >= bounds!.start && d <= bounds!.end) n++;
            }
          }
          return n;
        }

        const deficit = target.minCount - countInWindow();
        if (deficit <= 0) continue;

        const windowDates = dates.filter((d) => d >= bounds.start && d <= bounds.end);
        // Holidays are excluded like every other placement pass (staffing reqs use
        // the 0-valued holiday dayKey, standing commitments skip outright) — a
        // per-staff minimum must never be satisfied by scheduling into a closed
        // day. If the holiday was the only legal day, the hard-target warning
        // below fires instead of silently placing the shift.
        const candidateDates = windowDates.filter((d) =>
          !holidaySet.has(d) && !isAssigned(staff.id, d) && isAvailable(staff, d, st)
        );
        if (candidateDates.length === 0) {
          // Soft (preference) targets bias but never warn — only hard minimums do.
          if (targetIsHard(target)) {
            warnings.push(`${staff.initials}: no available days for ${st.code} min target in ${target.window} (${bounds.start}..${bounds.end})`);
          }
          continue;
        }

        // Card #177/#187: each pick takes the day that makes the fewest soft-avoided pairs
        // (date order otherwise), re-scored after every placement so the second ORC sees the first.
        const remaining = [...candidateDates];
        // Card #178: then, for a marked shift, the day with fewer marked shifts close by.
        const nextCandidate = (): string => {
          let best = 0;
          // Card #188: then the person's Prefer days (and away from soft-ineligible ones).
          if (avoidSet.size > 0 || st.spreadOverMonth || preferRuleKeys.has(`${staff.id}:${st.id}`)) {
            // Card #203: a tuple, so a large spread penalty can never outweigh a Prefer day.
            let bestKey: number[] | null = null;
            remaining.forEach((d, i) => {
              const key = [avoidedPairs(staff.id, d, st.id), -eligPreference(staff, st.id, d), st.spreadOverMonth ? spreadLoad(staff.id, d) : 0];
              if (!bestKey || cmpTuple(key, bestKey) < 0) { bestKey = key; best = i; }
            });
          }
          return remaining.splice(best, 1)[0];
        };
        while (remaining.length > 0) {
          const candidate = nextCandidate();
          if (countInWindow() >= target.minCount) break;
          // Rolling max is date-dependent: a candidate too close to an earlier
          // placement is capped, but a LATER one in this block may be fine — so
          // skip it and keep trying (respace) rather than abandoning the minimum.
          if (isAtMaximum(staff, st, candidate)) continue;
          // Card #260: the candidates were checked before this loop wrote any of them.
          if (hardGapBlocks(staff.id, st, [candidate])) continue;
          // Soft (preference) targets respect pay-period hour protection — a
          // preference biases the mix but must never push a staffer past their
          // hours. Hard minimums intentionally override the cap (hasUnmetMinimum).
          // Even a hard minimum stops at a Prohibited (or higher-ranked) over-target.
          const minBlock = ppHoursBlock(staff.id, candidate, st);
          // Over-target Allowed never blocks a preference either.
          if (!targetIsHard(target) && minBlock !== null && !(minBlock === "over" && overHoursPolicy === "allowed")) continue;
          if (minBlock === "over" && !hardMinBeatsOverHours) continue;
          assign(
            staff.id, candidate, st,
            `${st.code} (min target: ${target.minCount}/${target.window === "pay_period" ? "PP" : target.window})`,
            "min-target", 0.75
          );
        }
      }
    }
  }

  // ── STEP 2.75: Holiday entitlement (scheduled-workday rule) ──
  // Under holidayPolicy "entitlement" (default; see src/lib/holiday-policy.ts) a
  // holiday is OWED to every staffer for whom it falls on a day they normally work
  // — standard holiday-pay practice (handoff 740). It runs AFTER coverage / standing
  // commitments / min-target so a work shift already on the holiday (CALL, ORC, ICU…)
  // wins and the staffer gets no HOL on top, and BEFORE the STEP 3 hours fill so the
  // HOL hours are on the grid when fill sizes its days: HOL counts toward the
  // pay-period target and displaces a fill day — it is never a 9th day on top.
  //
  // Deliberately NOT routed through isAvailable(): HOL is leave, not work, so a
  // request-OFF hold, follow rules, the per-day Max and the rolling max must not block
  // it. "Normally scheduled" is the staffer's availability on the actual date
  // (evaluateAvailability), so an alternating-week rule is honored rather than the
  // weekday superset. Anything already on the cell — approved leave, a manual or
  // locked entry — stays (isAssigned). A 0 target (fee-basis) is owed nothing.
  //
  // Under "fill" nothing happens here (legacy: HOL only when the hours fill lands on
  // the holiday). Under "none" the engine never places HOL at all (STEP 3 also skips
  // holidays), so a holiday is a plain day off.
  // (holidayPolicy / holShift are declared before STEP 0: ppHoursBlock reads them, card #176.)

  // Idempotent (every occupied cell is skipped), so it is called again after request
  // reconciliation: a holiday cell freed by a revoked tentative request is re-granted
  // HOL instead of falling to X in STEP 4. Reconciliation may also RECLAIM an
  // entitlement HOL for holiday work (its backfill treats step "holiday" like a fill
  // day) — working the holiday means the work shift, not HOL.
  function grantHolidayEntitlement(): void {
    if (holidayPolicy !== "entitlement" || !holShift) return;
    for (const date of dates) {
      if (!holidaySet.has(date)) continue;
      const pp = findPPForDate(date);
      if (!pp) continue;
      for (const staff of activeStaff) {
        if (!owedHoliday(staff, date, pp)) continue;
        if (hardGapBlocks(staff.id, holShift, [date])) {
          warnings.push(`${staff.initials}: ${holShift.code} not placed on ${date} (${hardGapWhy(holShift)})`);
          continue;
        }
        assign(staff.id, date, holShift, "Holiday entitlement (normally scheduled day)", "holiday", 0.9);
      }
    }
  }
  grantHolidayEntitlement();
  // Card #207: a holiday policy that places a shift, with no valid shift chosen, must say
  // so instead of silently placing nothing.
  if (holidayPolicy !== "none" && !holShift && dates.some((d) => holidaySet.has(d))) {
    warnings.push("No holiday shift is chosen in Settings (or it is no longer a leave shift that counts toward hours), so no holiday hours were placed.");
  }
  holidaysGranted = true;

  // ── STEP 3: Fill shift to hit FTE hour targets (day-off clustering) ──

  // Records why STEP 3 couldn't lift a staff to target (key `staffId:ppStart` →
  // "days" = not enough available days / fill-divisibility, "max" = blocked by a
  // max-shift cap). The post-repair audit reads this so a residual shortfall is
  // reported with its real cause AND reflects the final (post-repair) state.
  const fillShortfallCause = new Map<string, string>();

  if (fillShift) {
    const sortedPPs = [...payPeriods]
      .filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const fillReqsByDay = new Map<string, number>();
    const fillReqs = reqsByShift.get(fillShift.id);
    if (fillReqs) {
      for (const [dayKey, min] of fillReqs) fillReqsByDay.set(dayKey, min);
    }

    // Coverage count for the fill shift: excludes non-counting followers, so a
    // follower whose follower-shift is the fill shift can't falsely satisfy a fill
    // staffing requirement during off-day selection (mirrors countCoverage).
    function fillStaffedCount(date: string): number {
      let count = 0;
      for (const [k, v] of grid.entries()) {
        if (k.endsWith(`:${date}`) && v.code === fillShift!.code && !v.noCount) count++;
      }
      return count;
    }

    function fillRequiredOnDate(date: string): number {
      const dayKey = holidaySet.has(date) ? "holiday" : String(getDow(date));
      return fillReqsByDay.get(dayKey) ?? 0;
    }

    // Day balance (handoff #743). `preferredCount` on the fill shift's staffing
    // requirement is the SAFE headcount (e.g. min 4 / preferred 6: at 4 one sick
    // call breaks the day). Off-day combos are ranked in two tiers: first by the
    // total shortfall below the preferred count across the chosen off days
    // (lower is better), then by the existing long-weekend / sequential score.
    // So a free X lands on a light day only when no day that can spare it is
    // available; above the threshold long weekends win as before. No preferred
    // count anywhere ⇒ tier 1 is 0 for every combo ⇒ byte-identical legacy output.
    const fillPreferredByDay = new Map<string, number>();
    for (const sr of staffingRequirements) {
      if (sr.shiftTypeId === fillShift.id && (sr.preferredCount ?? 0) > 0) {
        fillPreferredByDay.set(sr.dayKey, sr.preferredCount!);
      }
    }
    const dayBalanceActive = fillPreferredByDay.size > 0;
    function fillPreferredOnDate(date: string): number {
      const dayKey = holidaySet.has(date) ? "holiday" : String(getDow(date));
      return fillPreferredByDay.get(dayKey) ?? 0;
    }
    const fillFraction = (p: ScheduleStaff, pp: PayPeriod, avail: number): number => {
      // Share of `p`'s available days the hours fill will consume (same sizing
      // as the main loop) — the expected contribution of a not-yet-processed
      // staffer to each of their available dates.
      const target = targetFor(p, pp);
      if (target <= 0 || avail <= 0) return 0;
      const hours = ppHoursForStaff(p.id, pp);
      if (hours >= target) return 0;
      const wd = getShiftHours(p.id, fillShift!, overrideMap, "weekday");
      const we = getShiftHours(p.id, fillShift!, overrideMap, "weekend");
      const perDay = we > 0 ? Math.min(wd, we) : wd;
      if (perDay <= 0) return 0;
      return Math.min(1, Math.ceil((target - hours) / perDay) / avail);
    };

    function scoreOffDays(offDays: Set<string>, allWorkdaysInPP: string[], staffWorkingDays: number[]): number {
      if (offDays.size === 0) return 0;

      const workingSet = new Set(staffWorkingDays);
      const firstDate = allWorkdaysInPP[0];
      const lastDate = allWorkdaysInPP[allWorkdaysInPP.length - 1];

      const start = new Date(firstDate + "T12:00:00");
      start.setDate(start.getDate() - 3);
      const end = new Date(lastDate + "T12:00:00");
      end.setDate(end.getDate() + 3);

      const calendar: { date: string; isOff: boolean; isNonWorkDay: boolean }[] = [];
      const cur = new Date(start);
      while (cur <= end) {
        const d = toDateStr(cur);
        const dow = cur.getDay();
        const isNonWorkDay = !workingSet.has(dow);
        const hol = holidaySet.has(d);
        const isOff = isNonWorkDay || hol || offDays.has(d);
        calendar.push({ date: d, isOff, isNonWorkDay });
        cur.setDate(cur.getDate() + 1);
      }

      let score = 0;
      let runLen = 0;
      let runTouchesNonWorkDay = false;

      for (let i = 0; i <= calendar.length; i++) {
        const entry = calendar[i];
        if (entry && entry.isOff) {
          runLen++;
          if (entry.isNonWorkDay) runTouchesNonWorkDay = true;
        } else {
          if (runLen >= 2 && schedulingPreferences.preferSequentialOff) {
            score += (runLen - 1) * schedulingPreferences.sequentialOffWeight;
          }
          if (runLen >= 3 && runTouchesNonWorkDay && schedulingPreferences.prefer3DayWeekends) {
            score += schedulingPreferences.threeDayWeekendWeight;
          }
          if (runLen >= 4 && runTouchesNonWorkDay && schedulingPreferences.prefer4DayWeekends) {
            score += schedulingPreferences.fourDayWeekendWeight;
          }
          runLen = 0;
          runTouchesNonWorkDay = false;
        }
      }

      return score;
    }

    function* combinations(indices: number[], k: number): Generator<number[]> {
      if (k === 0) { yield []; return; }
      if (k > indices.length) return;
      for (let i = 0; i <= indices.length - k; i++) {
        for (const rest of combinations(indices.slice(i + 1), k - 1)) {
          yield [indices[i], ...rest];
        }
      }
    }

    const MAX_COMBOS = 5000;
    // How strongly a soft "prefers off" / "avoid this fill shift" request pulls a
    // day into the chosen off-day set. Comparable to the weekend-clustering weights
    // so it can tip day-off selection, but it only acts within the slack the FTE
    // target leaves — it never creates a day off that hours don't allow.
    const SOFT_REQUEST_OFF_WEIGHT = tuning.softRequestOffWeight; // card #215: Settings
    // Card #177: the cost of one soft-avoided pair in a fill combination — the same scale as a
    // soft request, so it only steers within the slack the hours target leaves.
    const SOFT_AVOID_FOLLOW_WEIGHT = tuning.softAvoidFollowWeight; // card #215: Settings

    function softOffBonus(staffId: string, offDays: Set<string>): number {
      if (requestList.length === 0) return 0;
      let bonus = 0;
      for (const d of offDays) {
        const folded = foldFor(staffId, d);
        if (folded.avoidWorking) bonus += SOFT_REQUEST_OFF_WEIGHT;
        if (fillShift && folded.avoidedShiftIds.has(fillShift.id)) bonus += SOFT_REQUEST_OFF_WEIGHT;
      }
      return bonus;
    }

    for (const pp of sortedPPs) {
      const ppDates = dates.filter(
        (d) => d >= pp.startDate && d <= pp.endDate
      );

      const sortedStaff = sortByFairness(activeStaff.map((p) => p.id))
        .map((id) => activeStaff.find((p) => p.id === id)!)
        .filter(Boolean);

      for (let si = 0; si < sortedStaff.length; si++) {
        const staff = sortedStaff[si];
        const target = targetFor(staff, pp);
        if (target <= 0) continue;

        const currentHours = ppHoursForStaff(staff.id, pp);
        if (currentHours >= target) continue;

        // Per-day estimate used to size how many fill days are needed (no single
        // date yet, and it's a divisor below). Use the smaller of weekday/weekend
        // so we never under-select fill days — but only fold in the weekend value
        // when the shift actually accrues weekend hours, else a non-counting
        // weekend (0h) would zero the divisor. Holiday is excluded for the same
        // reason and because holidays are a tiny fraction of fill dates; the
        // assignment loop below stops at target using each day's real hours.
        const fillWd = getShiftHours(staff.id, fillShift, overrideMap, "weekday");
        const fillWe = getShiftHours(staff.id, fillShift, overrideMap, "weekend");
        const hoursPerDay = fillWe > 0 ? Math.min(fillWd, fillWe) : fillWd;
        const hoursNeeded = target - currentHours;

        // Only the legacy "fill" policy lets a fill day land on a holiday (where it
        // becomes HOL below). Under "entitlement" HOL is owed by STEP 2.75's
        // scheduled-workday check alone — a fill shift that ignoresWorkingDays would
        // otherwise hand HOL to a staffer that check rejected (Codex #3298). Under
        // "none" no HOL exists at all. Either way fill work never lands on a closed day.
        const availableDates = ppDates.filter((d) =>
          isAvailable(staff, d, fillShift) && (holidayPolicy === "fill" || !holidaySet.has(d))
        );

        // Hour-deviation warnings are deferred to the post-repair audit so they
        // reflect FINAL state — STEP 3b may still close an under-target gap by
        // exchanging a longer shift in. Here we only record the CAUSE; the audit
        // emits the warning if a shortfall survives the repair.
        const shortfallKey = `${staff.id}:${pp.startDate}`;
        if (availableDates.length === 0) {
          fillShortfallCause.set(shortfallKey, "days");
          continue;
        }
        if (availableDates.length * hoursPerDay < hoursNeeded) {
          fillShortfallCause.set(shortfallKey, "days");
        }

        const fillDaysNeeded = Math.min(
          Math.ceil(hoursNeeded / hoursPerDay),
          availableDates.length
        );
        const daysOff = availableDates.length - fillDaysNeeded;

        let fillDates: string[];
        if (daysOff > 0 && daysOff < availableDates.length) {
          const indices = availableDates.map((_, i) => i);
          let bestOffIndices: number[] = [];
          let bestShortfall = Infinity;
          let bestScore = -Infinity;
          let bestTie = 0;
          let comboCount = 0;

          // Projected fill-shift headcount per candidate date EXCLUDING this
          // staffer: bodies already on the fill shift + the expected share of
          // every not-yet-processed staffer who could still work the date. The
          // shortfall of taking `date` off is how far that projection sits
          // below the preferred count (this staffer working would add 1).
          const projected = new Map<string, number>();
          if (dayBalanceActive) {
            for (const d of availableDates) projected.set(d, fillStaffedCount(d));
            for (let qi = si + 1; qi < sortedStaff.length; qi++) {
              const q = sortedStaff[qi];
              const qAvail = ppDates.filter((d) =>
                isAvailable(q, d, fillShift) && (holidayPolicy === "fill" || !holidaySet.has(d))
              );
              const frac = fillFraction(q, pp, qAvail.length);
              if (frac <= 0) continue;
              for (const d of qAvail) if (projected.has(d)) projected.set(d, projected.get(d)! + frac);
            }
          }
          const offShortfall = (offSet: Set<string>): number => {
            if (!dayBalanceActive) return 0;
            let s = 0;
            for (const d of offSet) s += Math.max(0, Math.max(fillPreferredOnDate(d), fillRequiredOnDate(d)) - (projected.get(d) ?? 0));
            return Math.round(s * 1e6) / 1e6; // float-noise guard so equal sums tie
          };

          // Minimum gate. Legacy: a day whose RUNNING fill count is below its
          // minimum can't be taken off — which, since STEP 2 skips the fill shift,
          // blocks EVERY off day for the first staff processed (count 0 < min) and
          // dumps their free X at the tail of the PP via the fallback below. With a
          // preferred count configured the gate reads the PROJECTED count instead
          // (bodies placed + expected share of staff still to be processed), so the
          // minimum stays protected while early staff can place their days off
          // deliberately. Legacy semantics are untouched when no preferred count is set.
          // Card #177: avoided pairs the WHOLE combination makes — its fill days and its X days
          // against each other and against the fixed cells around them (an empty day ends as X).
          const availSet = new Set(availableDates);
          const comboAvoided = (offSet: Set<string>): number => avoidedInRun(availableDates, (d) => {
            if (availSet.has(d)) return offSet.has(d) ? offShift?.id : fillShift.id;
            return grid.get(`${staff.id}:${d}`)?.shiftTypeId ?? (dateSet.has(d) && !isFrozen(d) ? offShift?.id : undefined);
          });
          const gateCount = (date: string): number =>
            dayBalanceActive ? (projected.get(date) ?? fillStaffedCount(date)) : fillStaffedCount(date);

          for (const offIndices of combinations(indices, daysOff)) {
            comboCount++;
            let feasible = true;
            for (const idx of offIndices) {
              const date = availableDates[idx];
              const required = fillRequiredOnDate(date);
              if (required > 0 && gateCount(date) < required) {
                feasible = false;
                break;
              }
            }
            if (!feasible) continue;

            const offSet = new Set<string>(offIndices.map((i: number) => availableDates[i]));
            const shortfall = offShortfall(offSet);
            const score = scoreOffDays(offSet, availableDates, getBaseWorkDays(staff.availabilityRules))
              + softOffBonus(staff.id, offSet)
              - (avoidSet.size > 0 ? SOFT_AVOID_FOLLOW_WEIGHT * comboAvoided(offSet) : 0);
            if (shortfall < bestShortfall || (shortfall === bestShortfall && score > bestScore)) {
              bestShortfall = shortfall;
              bestScore = score;
              bestOffIndices = offIndices;
              bestTie = seedNum ? seedTie(`${staff.id}|${offIndices.map((i) => availableDates[i]).join(",")}`) : 0;
            } else if (seedNum && shortfall === bestShortfall && score === bestScore && bestOffIndices.length > 0) {
              // Seeded tiebreak (Slice 4b): among equally-scored off-day combos,
              // the lower hash wins. seed 0 never enters this branch.
              const tie = seedTie(`${staff.id}|${offIndices.map((i) => availableDates[i]).join(",")}`);
              if (tie < bestTie) { bestOffIndices = offIndices; bestTie = tie; }
            }
            if (comboCount >= MAX_COMBOS) break;
          }

          const offDaySet = new Set(bestOffIndices.map((i) => availableDates[i]));
          fillDates = availableDates.filter((d) => !offDaySet.has(d));
        } else {
          fillDates = availableDates.slice(0, fillDaysNeeded);
        }

        let hours = currentHours;
        let cappedByMax = false;
        let cappedByGap: string | null = null; // card #260: the shift whose Hard gap kept a fill day off
        for (const date of fillDates) {
          if (hours >= target) break;
          const shift = holidayPolicy === "fill" && holidaySet.has(date) && holShift ? holShift : fillShift;
          // Rolling max is date-dependent — skip a capped date, keep trying later
          // ones. A residual shortfall is reported by the post-repair audit.
          if (isAtMaximum(staff, shift, date)) { cappedByMax = true; continue; }
          // Card #260 (Codex #1198): availability was checked before this batch wrote any day.
          if (hardGapBlocks(staff.id, shift, [date])) { cappedByGap = shift.id; continue; }
          const shiftHrs = getShiftHours(staff.id, shift, overrideMap, dayTypeOf(date, holidaySet));
          // A whole fill shift may overshoot the target; not when over-target is Prohibited.
          if (!fillMayOvershoot && shift.countsTowardFte && hours + shiftHrs > target) continue;
          assign(staff.id, date, shift,
            `${shift.code} to fill hours (${hours}/${target}hrs)`,
            "fill", 0.6);
          hours += shiftHrs;
        }
        if (cappedByMax && hours < target) {
          fillShortfallCause.set(`${staff.id}:${pp.startDate}`, "max");
        } else if (cappedByGap && hours < target) {
          fillShortfallCause.set(`${staff.id}:${pp.startDate}`, `gap:${cappedByGap}`);
        }
      }
    }
  }

  // Counted FTE hours a shift contributes for a staff on a date (honors the
  // per-day-type hours and per-staff overrides) — the unit the repair optimizes.
  // A weekend/holiday the shift doesn't accrue on resolves to 0, so no extra gate.
  function countedHrs(staffId: string, st: ScheduleShiftType, date: string): number {
    if (!st.countsTowardFte) return 0;
    return getShiftHours(staffId, st, overrideMap, dayTypeOf(date, holidaySet));
  }

  // Authoritative placements the repair must never disturb. Cells with no step
  // (loaded from existingAssignments), locked cells, and non-counting followers
  // are also excluded below.
  // "request-tentative" is excluded too: a tentatively-placed forced request is owned
  // by the reconciliation pass (which runs AFTER this repair). If STEP 3b were allowed
  // to swap a tentative cell's shift to another staff, reconciliation would never see
  // it — silently bypassing first-come ordering and the PP-cap revoke/backfill. The
  // repair therefore leaves tentative cells alone; reconcileRequests() resolves them.
  // "holiday" (STEP 2.75 entitlement HOL) is leave, so isSwappableCell already rejects
  // it via isLeave; listed here so the intent survives a HOL config change.
  const NON_SWAPPABLE_STEPS = new Set(["request-leave", LEAVE_OFF_STEP, "request-shift", "request-tentative", "standing", "follower", "off", "holiday", "holiday-rule"]);

  // Codex #1226 / card #271: a cell that is one day of a group (a weekend pair, a holiday-rule
  // pair) is never changed alone: changing one day would leave the other day stranded.
  const groupSlot = new Set(ruleGroups.flatMap((g) => g.slots.map((x) => `${x.shiftTypeId}:${x.date}`)));
  function cellInGroup(c: { shiftTypeId: string; step?: string }, d: string): boolean {
    if (c.step === "holiday-rule" || groupSlot.has(`${c.shiftTypeId}:${d}`)) return true;
    const st = stById.get(c.shiftTypeId);
    return !!st && st.weekendPaired && (isWeekend(d) || (st.holidayWeekendPaired && holidaySet.has(d)));
  }

  // Can this cell be exchanged or moved ON ITS OWN on `date` (a single-day swap, move or drop)?
  function isSwappableCell(cell: { shiftTypeId: string; locked: boolean; noCount?: boolean; step?: string }, date: string): boolean {
    if (cell.locked || cell.noCount || !cell.step || NON_SWAPPABLE_STEPS.has(cell.step)) return false;
    if (cellInGroup(cell, date)) return false;
    // A required-follower SOURCE (e.g. ORC→X recovery) must not move: its follower
    // was placed relative to this cell and we don't relocate/revalidate followers
    // here. (Follower cells themselves carry step "follower" and are excluded
    // above.) Moving a source would orphan the old follower and drop the new
    // holder's required follower.
    if (followerBySource.has(cell.shiftTypeId)) return false;
    const st = stById.get(cell.shiftTypeId);
    if (!st) return false;
    return st.countsTowardFte && !st.isLeave && !st.isOffShift && st.autoSchedulable;
  }

  // Could `staff` legally hold `st` on `date` if it replaced their current cell?
  // Mirrors isAvailable's gates MINUS the empty-cell + per-day-cap checks (a
  // same-day exchange preserves per-day counts), and INCLUDING availability
  // legality (working-day rules / approved requests) per review feedback.
  function canHoldForSwap(staff: ScheduleStaff, st: ScheduleShiftType, date: string, ppRangesAll: PayPeriodRange[]): boolean {
    let eligible = eligibleShiftSets.get(staff.id)?.has(st.id) ?? false;
    if (staff.shiftEligibilityRules && staff.shiftEligibilityRules.length > 0) {
      const r = evaluateShiftEligibility(staff.shiftEligibilityRules, st.id, date, ppRangesAll);
      // Card #188: rules only narrow — an eligible rule never re-opens a shift unticked in the
      // activation panel.
      if (r !== null) eligible = eligible && r.eligible;
    }
    if (!eligible) return false;
    if (requestBlocksWork(staff.id, date, st)) return false;
    if (!st.ignoresWorkingDays) {
      const avail = evaluateAvailability(
        staff.availabilityRules, date, payPeriods, (pid, d) => isWorking(pid, d)
      );
      if (!avail.available) return false;
    }
    const prev = getCell(staff.id, prevDate(date));
    if (prev && !isShiftAllowedAfter(followMap, prev.shiftTypeId, st.id, st.isOffShift)) return false;
    const next = getCell(staff.id, nextDate(date));
    if (next) {
      const nextSt = stById.get(next.shiftTypeId);
      if (nextSt && !isShiftAllowedAfter(followMap, st.id, next.shiftTypeId, nextSt.isOffShift)) return false;
    }
    if (isAtMaximum(staff, st, date)) return false;
    // Card #260: the cell it replaces is judged gone (it is replaced); the end state is
    // re-checked by the repair's endStateOk (removals included).
    if (gapHard(st)) {
      const cur = grid.get(`${staff.id}:${date}`);
      if (cur) grid.delete(`${staff.id}:${date}`);
      const bad = gapNewBreaks(staff.id, st, [date]) > 0;
      if (cur) grid.set(`${staff.id}:${date}`, cur);
      if (bad) return false;
    }
    return true;
  }

  // Would removing one `lostSt` from `staff` (at `date`) drop them below a HARD
  // minimum target for that shift? (Soft preferences never block a hours fix.)
  function swapBreaksHardMin(staff: ScheduleStaff, lostSt: ScheduleShiftType, date: string, ppRangesAll: PayPeriodRange[]): boolean {
    const targets = (staff.shiftMinimumTargets ?? []).filter(
      (t) => t.shiftTypeId === lostSt.id && (t.strength ?? "rule") === "rule" && t.minCount > 0,
    );
    for (const t of targets) {
      const bounds = getWindowBounds(t, date, ppRangesAll);
      if (!bounds) continue;
      let count = 0;
      for (const [k, v] of grid.entries()) {
        if (k.startsWith(staff.id + ":") && v.code === lostSt.code && !v.noCount) {
          const d = k.split(":")[1];
          if (d >= bounds.start && d <= bounds.end) count++;
        }
      }
      if (count - 1 < t.minCount) return true;
    }
    return false;
  }

  // Secondary tiebreak: does the swap improve soft (preference) min satisfaction?
  // Gaining a shift you're soft-short on is good; losing one you're short on is bad.
  function softPrefDelta(staff: ScheduleStaff, gainedSt: ScheduleShiftType, lostSt: ScheduleShiftType, date: string): number {
    let delta = 0;
    if (getMinimumDeficit(staff, gainedSt, date, "preference") > 0) delta += 1;
    if (getMinimumDeficit(staff, lostSt, date, "preference") > 0) delta -= 1;
    return delta;
  }

  function repairPayPeriodHours(): void {
    const ppRangesAll: PayPeriodRange[] = payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
    const repairPPs = payPeriods.filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate));
    const MAX_ITERS = 1000;

    for (const pp of repairPPs) {
      const ppDates = dates.filter((d) => d >= pp.startDate && d <= pp.endDate);
      let guard = 0;
      while (guard++ < MAX_ITERS) {
        // Current per-staff deviation (hours − FTE-scaled target) for this PP.
        const dev = new Map<string, number>();
        for (const p of activeStaff) {
          const target = targetFor(p, pp);
          if (target <= 0) continue;
          dev.set(p.id, ppHoursForStaff(p.id, pp) - target);
        }

        type Swap = { aId: string; bId: string; date: string; aSt: ScheduleShiftType; bSt: ScheduleShiftType; gain: number; avoid: number; even: [number, number]; spread: number; pref: number };
        let best: Swap | null = null;

        for (const date of ppDates) {
          const cells: { id: string; staff: ScheduleStaff; st: ScheduleShiftType }[] = [];
          for (const p of activeStaff) {
            if (!dev.has(p.id)) continue;
            const cell = grid.get(`${p.id}:${date}`);
            if (!cell || !isSwappableCell(cell, date)) continue;
            const st = stById.get(cell.shiftTypeId);
            if (st) cells.push({ id: p.id, staff: p, st });
          }
          for (let i = 0; i < cells.length; i++) {
            for (let j = i + 1; j < cells.length; j++) {
              const A = cells[i], B = cells[j];
              const devA = dev.get(A.id)!, devB = dev.get(B.id)!;
              const hA = countedHrs(A.id, A.st, date), hB = countedHrs(B.id, B.st, date);
              const hAnew = countedHrs(A.id, B.st, date), hBnew = countedHrs(B.id, A.st, date);
              const devAn = devA - hA + hAnew;
              const devBn = devB - hB + hBnew;
              const gain = (Math.abs(devA) + Math.abs(devB)) - (Math.abs(devAn) + Math.abs(devBn));
              if (gain <= 0) continue;
              // A Prohibited side is never made worse for either staffer, even for a net gain.
              if (overHoursPolicy === "prohibited" && (devAn > Math.max(0, devA) || devBn > Math.max(0, devB))) continue;
              if (underHoursPolicy === "prohibited" && (-devAn > Math.max(0, -devA) || -devBn > Math.max(0, -devB))) continue;
              // Cheap reject before legality: only consider if it could beat best.
              if (best && gain < best.gain) continue;
              if (!canHoldForSwap(A.staff, B.st, date, ppRangesAll)) continue;
              if (!canHoldForSwap(B.staff, A.st, date, ppRangesAll)) continue;
              if (swapBreaksHardMin(A.staff, A.st, date, ppRangesAll)) continue;
              if (swapBreaksHardMin(B.staff, B.st, date, ppRangesAll)) continue;
              // Card #260: the whole resulting state — A losing its ORL can split a stretch too.
              const gapFx = gapEffect([[A.id, date, B.st.id], [B.id, date, A.st.id]]);
              if (gapFx.hardNew) continue;
              const pref = softPrefDelta(A.staff, B.st, A.st, date) + softPrefDelta(B.staff, A.st, B.st, date);
              // Card #177: hours first; among equal gains, the swap adding fewer soft-avoided pairs
              // (card #260: and fewer too-close pairs of a Prefer minimum gap, beside it).
              const avoid = avoidedPairs(A.id, date, B.st.id) - avoidedPairs(A.id, date, A.st.id)
                + avoidedPairs(B.id, date, A.st.id) - avoidedPairs(B.id, date, B.st.id) + gapFx.preferDelta;
              // Card #203: then this month's evenness, the carried balance, spacing (marked shifts).
              const changes = [[A.id, date, B.st.id], [B.id, date, A.st.id]] as const;
              const even = evenDelta(changes);
              const spread = spreadDelta(changes);
              const better = !best || gain > best.gain || (gain === best.gain && (avoid < best.avoid || (avoid === best.avoid && (
                cmpTuple(even, best.even) < 0 || (cmpTuple(even, best.even) === 0 && (spread < best.spread || (spread === best.spread && pref > best.pref)))))));
              if (better) {
                best = { aId: A.id, bId: B.id, date, aSt: A.st, bSt: B.st, gain, avoid, even, spread, pref };
              }
            }
          }
        }

        if (!best) break;
        // Apply: A takes B's shift, B takes A's shift. Sync grid AND suggestions
        // (the returned schedule) so the saved result matches the repair.
        applyRepairCell(best.aId, best.date, best.bSt);
        applyRepairCell(best.bId, best.date, best.aSt);
        byStep["repair"] = (byStep["repair"] || 0) + 1;
      }
    }
  }

  function applyRepairCell(staffId: string, date: string, st: ScheduleShiftType): void {
    const key = `${staffId}:${date}`;
    grid.set(key, { shiftTypeId: st.id, code: st.code, locked: false, noCount: false, step: "repair" });
    for (let i = suggestions.length - 1; i >= 0; i--) {
      const s = suggestions[i];
      if (s.staffId === staffId && s.date === date) {
        s.shiftTypeId = st.id;
        s.code = st.code;
        s.reason = `${st.code} (hour-balance repair)`;
        s.step = "repair";
        s.confidence = 0.65;
        return;
      }
    }
  }

  // ── Schedule quality accumulators (#224 item 4, Slice 4a) ──
  // Filled by the audit loops below (no extra iteration), assembled into
  // result.quality just before return. See ScheduleQuality / compareScheduleQuality.
  // Slice 2a split: coverage / hardLimits (was qHardBreaches) and overHours /
  // underHours (was the two-directional qPpHoursDeviation).
  let qCoverage = 0;
  let qHardLimits = 0;
  let qCoverageShortfall = 0;
  let qOverHours = 0;
  let qUnderHours = 0;

  function auditPayPeriodHours(): void {
    const auditPPs = payPeriods.filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate));
    // Eligible-pool size per shift code among active auto-scheduled staff. A tiny
    // pool means coverage for that shift is structurally hard to balance.
    const SCARCE_POOL = tuning.scarcePoolSize; // card #215: Settings
    const poolByCode = new Map<string, number>();
    for (const st of shiftTypes) {
      let n = 0;
      for (const p of activeStaff) if (eligibleShiftSets.get(p.id)?.has(st.id)) n++;
      poolByCode.set(st.code, n);
    }
    for (const pp of auditPPs) {
      for (const staff of activeStaff) {
        const target = targetFor(staff, pp);
        if (target <= 0) continue;
        const hours = ppHoursForStaff(staff.id, pp);
        const dev = Math.round(hours - target);
        // Slice 2a: split the two-directional deviation into over / under sides so
        // they can be ranked independently (over = soft, under = shortage).
        if (dev > 0) qOverHours += dev;
        else if (dev < 0) qUnderHours += -dev;
        if (dev === 0) continue;
        // A scarce-eligibility shift this staff actually worked in the PP marks
        // the deviation as structural (Class 2 — no engine fix).
        let scarce: string | null = null;
        const cur = new Date(pp.startDate + "T12:00:00");
        const end = new Date(pp.endDate + "T12:00:00");
        while (cur <= end) {
          const d = toDateStr(cur);
          const cell = getCell(staff.id, d);
          if (cell) {
            const st = stById.get(cell.shiftTypeId);
            if (st && st.countsTowardFte && !st.isLeave && (poolByCode.get(st.code) ?? 99) <= SCARCE_POOL) {
              scarce = st.code;
              break;
            }
          }
          cur.setDate(cur.getDate() + 1);
        }
        if (dev > 0) {
          warnings.push(
            `${staff.initials}: over target — ${hours}/${target}hrs (+${dev}) in PP ${pp.startDate}` +
            (scarce ? ` — driven by ${scarce} (only ${poolByCode.get(scarce)} eligible); no legal rebalance` : ` — no legal rebalance available`),
          );
        } else {
          // Prefer the specific STEP-3 cause (max cap / not enough days); fall
          // back to eligibility-scarcity, then a generic note.
          const cause = fillShortfallCause.get(`${staff.id}:${pp.startDate}`);
          let detail: string;
          if (cause === "max") detail = " — capped by max shift limit";
          else if (cause?.startsWith("gap:")) { const g = stById.get(cause.slice(4)); detail = g ? ` — the ${hardGapWhy(g)}, leaves too few days` : " — no legal rebalance available"; }
          else if (cause === "days") detail = ` — cannot reach ${target}hrs with available days`;
          else if (scarce) detail = ` — constrained by ${scarce} (only ${poolByCode.get(scarce)} eligible)`;
          else detail = " — no legal rebalance available";
          warnings.push(
            `${staff.initials}: under target — ${hours}/${target}hrs (${dev}) in PP ${pp.startDate}${detail}`,
          );
        }
      }
    }
  }

  // ── STEP 3b: Hour-balancing repair (same-day shift-type exchanges) ──
  //
  // The steps above satisfy coverage and top hours UP toward each pay-period
  // target, but treat the target only as a one-directional ceiling: a person can
  // still land a few hours under (no fill-divisible way to close the gap) or over
  // (a long coverage shift overshot). Because shifts come in different lengths
  // (OR=8, ORL=12, ORC=16…), the fix is almost always to swap shift TYPES between
  // two staff on the SAME day — which provably preserves per-day coverage counts
  // AND every per-day cap (the count of each shift on that date is unchanged).
  //
  // This is a greedy hill-climb: repeatedly apply the single legal same-day
  // exchange that most reduces total |hours − target| within a pay period, until
  // none improves. Deviations are integers that strictly decrease each step, so
  // it terminates. It NEVER worsens hours, breaks coverage, or violates a hard
  // constraint (eligibility, availability, follow rules, hard min/max). Residual
  // gaps it can't legally close are reported by the audit below (Class 2).

  // ── Card #176: compound hours repair (after the single-swap loop above) ──
  //
  // The single-swap hill-climb stops when every one swap worsens the total, which is
  // what leaves people a few hours over: BC worked an ORL in the frozen earlier month,
  // so this month must be one ORL + three ORs, but STEP 3 gave five ORs. Clearing that
  // takes a COMBINATION — BC takes an ORL from someone at target (both worse), then
  // gives up a fill day (both fixed). Two phases per pay period:
  //   A. "odd" people — whose deviation no number of their fill days can close (it is
  //      not a multiple of their fill-day hours) — are paired by shift-type swaps, direct
  //      or through one intermediary, so each becomes a multiple of their fill hours;
  //   B. a strictly-improving hill-climb over SWAP, MOVE (a fill day from A to B, same
  //      day), DROP (a fill day above the day's minimum), ADD (a fill day on an open,
  //      legal day) and two-hop MOVEs.
  // Every change goes through repairSet() and an undo journal; a compound is committed
  // only if its end state passes every hard check (participants' prohibited-hours
  // bounds, follow rules around each changed cell, conditional dependents, coverage
  // minimums, per-day caps). The pay period's result is kept only if its total
  // |hours − target| strictly drops; otherwise it is rolled back exactly (grid,
  // suggestions in order, byStep) and only the strictly-improving Phase B runs.
  // A dropped fill day is CLEARED (STEP 4 writes its single X); legality treats a
  // cleared cell as the off shift.

  type GridCell = NonNullable<ReturnType<typeof grid.get>>;
  type JournalEntry =
    | { kind: "updated"; key: string; prev: GridCell | undefined; sug: Suggestion; old: Suggestion }
    | { kind: "inserted"; key: string; prev: GridCell | undefined; sug: Suggestion }
    | { kind: "removed"; key: string; prev: GridCell | undefined; idx: number; sug: Suggestion }
    | { kind: "grid"; key: string; prev: GridCell | undefined };
  const journal: JournalEntry[] = [];
  type Mark = { len: number; steps: Record<string, number> };
  const mark = (): Mark => ({ len: journal.length, steps: { ...byStep } });
  function rollback(m: Mark): void {
    while (journal.length > m.len) {
      const e = journal.pop()!;
      if (e.prev) grid.set(e.key, { ...e.prev }); else grid.delete(e.key);
      if (e.kind === "updated") Object.assign(e.sug, e.old);
      else if (e.kind === "inserted") { const i = suggestions.lastIndexOf(e.sug); if (i >= 0) suggestions.splice(i, 1); }
      else if (e.kind === "removed") suggestions.splice(e.idx, 0, e.sug);
    }
    for (const k of Object.keys(byStep)) delete byStep[k];
    Object.assign(byStep, m.steps);
  }
  const sugIndex = (staffId: string, date: string): number => {
    for (let i = suggestions.length - 1; i >= 0; i--) if (suggestions[i].staffId === staffId && suggestions[i].date === date) return i;
    return -1;
  };
  /** The single writer of the compound repair: sets (st) or clears (null) one cell,
   *  keeping exactly one matching suggestion, and journals the prior state. */
  function repairSet(staffId: string, date: string, st: ScheduleShiftType | null, step: string, reason: string): void {
    const key = `${staffId}:${date}`;
    const prevCell = grid.get(key);
    const prev = prevCell ? { ...prevCell } : undefined;
    const idx = sugIndex(staffId, date);
    if (prev?.step) byStep[prev.step] = Math.max(0, (byStep[prev.step] ?? 0) - 1);
    if (st === null) {
      grid.delete(key);
      if (idx >= 0) journal.push({ kind: "removed", key, prev, idx, sug: suggestions.splice(idx, 1)[0] });
      else journal.push({ kind: "grid", key, prev });
      return;
    }
    grid.set(key, { shiftTypeId: st.id, code: st.code, locked: false, noCount: false, step });
    byStep[step] = (byStep[step] ?? 0) + 1;
    if (idx >= 0) {
      const sug = suggestions[idx];
      journal.push({ kind: "updated", key, prev, sug, old: { ...sug } });
      Object.assign(sug, { shiftTypeId: st.id, code: st.code, reason, step, confidence: 0.65 });
    } else {
      const sug: Suggestion = { staffId, date, shiftTypeId: st.id, code: st.code, reason, step, confidence: 0.65 };
      suggestions.push(sug);
      journal.push({ kind: "inserted", key, prev, sug });
    }
  }

  // Hours are compared in hundredths so fractional overrides (7.5 h) stay exact.
  const cents = (h: number): number => Math.round(h * 100);

  function compoundHoursRepair(fill: ScheduleShiftType): void {
    const ppRangesAll: PayPeriodRange[] = payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
    const repairPPs = payPeriods.filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate));
    const LIMITS = { odd: 12, intermediaries: 40, checksPerStep: 200, phaseBIters: 500, phaseCIters: 200, reshapeOpts: 12 };
    const capHit = new Set<string>();

    for (const pp of repairPPs) {
      const ppDates = dates.filter((d) => d >= pp.startDate && d <= pp.endDate && !isFrozen(d));
      if (ppDates.length === 0) continue;
      const people = activeStaff.filter((p) => targetFor(p, pp) > 0);
      const devOf = (p: ScheduleStaff): number => cents(ppHoursForStaff(p.id, pp) - targetFor(p, pp));
      const total = (): number => people.reduce((s, p) => s + Math.abs(devOf(p)), 0);
      const fillH = (p: ScheduleStaff, d: string): number => cents(countedHrs(p.id, fill, d));
      const hrsOf = (p: ScheduleStaff, st: ScheduleShiftType, d: string): number => cents(countedHrs(p.id, st, d));
      // A person's fill-day granularity in this pay period (gcd of their possible fill-day hours).
      const grain = new Map<string, number>();
      for (const p of people) {
        let g = 0;
        for (const d of ppDates) {
          const h = fillH(p, d);
          if (h <= 0) continue;
          // Only days they could hold the fill on: a day they work now, or an empty day they're
          // available for it. (A Saturday they never work mustn't make 12 h count for them.)
          const c = grid.get(`${p.id}:${d}`);
          if (c ? !isAwayShift(c.shiftTypeId) : isAvailable(p, d, fill)) g = gcd(g, h);
        }
        grain.set(p.id, g);
      }
      const isOdd = (p: ScheduleStaff, dev = devOf(p)): boolean => { const g = grain.get(p.id) ?? 0; return g > 0 && dev % g !== 0; };
      const cellOf = (p: ScheduleStaff, d: string) => grid.get(`${p.id}:${d}`);
      const isFillCell = (p: ScheduleStaff, d: string): boolean => {
        const c = cellOf(p, d);
        return !!c && c.shiftTypeId === fill.id && isSwappableCell(c, d);
      };
      const isOpen = (p: ScheduleStaff, d: string): boolean => { const c = cellOf(p, d); return !c || isFillableOffCell(c); };

      // ── end-state hard checks for one compound ──
      const changed: { p: ScheduleStaff; d: string }[] = [];
      function neighboursOk(p: ScheduleStaff, d: string): boolean {
        const shiftAt = (x: string): { id: string; off: boolean } | null => {
          const c = grid.get(`${p.id}:${x}`);
          if (!c) return offShift && dateSet.has(x) ? { id: offShift.id, off: true } : null; // cleared ⇒ X
          const st = stById.get(c.shiftTypeId);
          return { id: c.shiftTypeId, off: !!st?.isOffShift };
        };
        const me = shiftAt(d), prev = shiftAt(prevDate(d)), next = shiftAt(nextDate(d));
        if (!me) return true;
        if (prev && !isShiftAllowedAfter(followMap, prev.id, me.id, me.off)) return false;
        if (next && !isShiftAllowedAfter(followMap, me.id, next.id, next.off)) return false;
        return true;
      }
      type Before = { devs: Map<string, number>; cover: Map<string, number>; avail: Set<string>; gap: GapSnap | null };
      // Card #185: every active person's rules, hand-scheduled ones too — a trade that takes BC's
      // day off must not leave a hand-placed 'EF only when BC works' day standing alone.
      const condOwners = staff.filter((p) => p.isActive && p.availabilityRules.some((r) => r.conditionStaffId && r.conditionType));
      function availBroken(): Set<string> {
        // Working cells this run may move whose availability no longer holds (conditional rules).
        const out = new Set<string>();
        for (const p of condOwners) for (const d of ppDates) {
          const c = cellOf(p, d);
          if (!c || !isWorking(p.id, d)) continue;
          const st = stById.get(c.shiftTypeId);
          if (st?.ignoresWorkingDays) continue;
          if (!evaluateAvailability(p.availabilityRules, d, payPeriods, (pid, x) => isWorking(pid, x)).available) out.add(`${p.id}:${d}`);
        }
        return out;
      }
      const coverKey = (st: ScheduleShiftType, d: string) => `${st.id}:${d}`;
      function snapshotBefore(): Before {
        const cover = new Map<string, number>();
        for (const d of ppDates) for (const st of shiftTypes) cover.set(coverKey(st, d), countAssigned(st.code, d));
        // Card #260: every participant's Hard-gap pairs over the pay period, so the end state is
        // judged with removals included (a swap/move/drop that splits a stretch is refused).
        return { devs: new Map(people.map((p) => [p.id, devOf(p)])), cover, avail: availBroken(), gap: gapSnapshot(people.map((p) => p.id), ppDates) };
      }
      /** Would anyone end further over (or under) target than in `start`, on a side the
       *  admin has made Prohibited? */
      function boundsBroken(start: Map<string, number>): boolean {
        for (const p of people) {
          const a = start.get(p.id)!, b = devOf(p);
          if (overHoursPolicy === "prohibited" && b > Math.max(0, a)) return true;
          if (underHoursPolicy === "prohibited" && -b > Math.max(0, -a)) return true;
        }
        return false;
      }
      // `bounds` false only for Phase A: its trades may pass through a prohibited side (the
      // intermediary 8 h under until Phase B gives a day back); the pay period's end state
      // is held to the bounds instead (see the commit below).
      function endStateOk(before: Before, bounds = true): boolean {
        if (bounds && boundsBroken(before.devs)) return false;
        for (const { p, d } of changed) {
          if (!neighboursOk(p, d)) return false;
          const c = cellOf(p, d);
          if (c && isWorking(p.id, d)) {
            const st = stById.get(c.shiftTypeId);
            if (st && !st.ignoresWorkingDays && !evaluateAvailability(p.availabilityRules, d, payPeriods, (pid, x) => isWorking(pid, x)).available) return false;
          }
        }
        for (const k of availBroken()) if (!before.avail.has(k)) return false;
        if (gapNewSince(before.gap)) return false;
        const days = new Set(changed.map((c) => c.d));
        for (const d of days) for (const st of shiftTypes) {
          const was = before.cover.get(coverKey(st, d)) ?? 0, now = countCoverage(st.code, d), phys = countAssigned(st.code, d);
          const min = getRequiredCount(st, d);
          if (now < min && now < was) return false; // never takes a day below (or further below) its minimum
          const cap = capOf(st.id, d);
          if (cap != null && phys > cap && phys > was) return false; // never over a day's Max
        }
        return true;
      }

      // ── primitives (each checks its own placement legality on the grid as it stands) ──
      function swap(d: string, A: ScheduleStaff, B: ScheduleStaff): boolean {
        const ca = cellOf(A, d), cb = cellOf(B, d);
        if (!ca || !cb || !isSwappableCell(ca, d) || !isSwappableCell(cb, d) || ca.shiftTypeId === cb.shiftTypeId) return false;
        const aSt = stById.get(ca.shiftTypeId)!, bSt = stById.get(cb.shiftTypeId)!;
        if (swapBreaksHardMin(A, aSt, d, ppRangesAll) || swapBreaksHardMin(B, bSt, d, ppRangesAll)) return false;
        // Legality of each side is judged with the other side's cell still in place.
        if (!canHoldForSwap(A, bSt, d, ppRangesAll) || !canHoldForSwap(B, aSt, d, ppRangesAll)) return false;
        repairSet(A.id, d, bSt, "repair", `${bSt.code} (hour-balance repair)`);
        repairSet(B.id, d, aSt, "repair", `${aSt.code} (hour-balance repair)`);
        changed.push({ p: A, d }, { p: B, d });
        return true;
      }
      // A fill day is only ever placed where STEP 3 itself could place one: an open cell
      // passing every isAvailable gate (requests, availability, follow rules, the day's
      // Max, rolling max) plus eligibility — never on a holiday (HOL's day).
      // A soft "prefers off" / "avoid this fill shift" request on the day is honoured
      // too: STEP 3 steers fill days away from it, and the repair never undoes that.
      const softAvoids = (B: ScheduleStaff, d: string): boolean => {
        if (requestList.length === 0) return false;
        const f = foldFor(B.id, d);
        return f.avoidWorking || f.avoidedShiftIds.has(fill.id);
      };
      const canReceiveFill = (B: ScheduleStaff, d: string): boolean =>
        !holidaySet.has(d) && !softAvoids(B, d) && isAvailable(B, d, fill) && canHoldForSwap(B, fill, d, ppRangesAll);
      function move(d: string, A: ScheduleStaff, B: ScheduleStaff): boolean {
        if (!isFillCell(A, d) || !isOpen(B, d)) return false;
        if (swapBreaksHardMin(A, fill, d, ppRangesAll)) return false;
        repairSet(A.id, d, null, "", ""); // free the slot first: the day's count is unchanged by the move
        changed.push({ p: A, d });
        if (!canReceiveFill(B, d)) return false; // attempt() rolls back
        repairSet(B.id, d, fill, "fill", `${fill.code} (hours repair)`);
        changed.push({ p: B, d });
        return true;
      }
      function drop(d: string, A: ScheduleStaff): boolean {
        if (!isFillCell(A, d)) return false;
        if (countCoverage(fill.code, d) - 1 < getRequiredCount(fill, d)) return false;
        if (swapBreaksHardMin(A, fill, d, ppRangesAll)) return false;
        repairSet(A.id, d, null, "", "");
        changed.push({ p: A, d });
        return true;
      }
      function add(d: string, A: ScheduleStaff): boolean {
        if (!isOpen(A, d) || !canReceiveFill(A, d)) return false;
        repairSet(A.id, d, fill, "fill", `${fill.code} (hours repair)`);
        changed.push({ p: A, d });
        return true;
      }
      // Card #177: change in soft-avoided pairs if these cells took these shifts (null = cleared,
      // which ends as X). A tiebreak only: hours gain/score always decides first.
      type Change = [ScheduleStaff, string, string | null];
      const cellNow = (p: ScheduleStaff, d: string): string | undefined =>
        grid.get(`${p.id}:${d}`)?.shiftTypeId ?? (dateSet.has(d) && !isFrozen(d) ? offShift?.id : undefined);
      function avoidDelta(changes: Change[]): number {
        if (avoidSet.size === 0) return 0;
        const byPerson = new Map<ScheduleStaff, Map<string, string | undefined>>();
        for (const [p, d, id] of changes) {
          if (!byPerson.has(p)) byPerson.set(p, new Map());
          byPerson.get(p)!.set(d, id ?? offShift?.id);
        }
        let delta = 0;
        for (const [p, over] of byPerson) {
          delta += avoidedInRun(over.keys(), (d) => (over.has(d) ? over.get(d) : cellNow(p, d)))
            - avoidedInRun(over.keys(), (d) => cellNow(p, d));
        }
        return delta;
      }
      const swapChanges = (d: string, X: ScheduleStaff, Y: ScheduleStaff): Change[] =>
        [[X, d, cellOf(Y, d)!.shiftTypeId], [Y, d, cellOf(X, d)!.shiftTypeId]];
      // Card #203: the tie-breaks after hours and avoided pairs — this month's evenness and the
      // carried balance of even shifts, then spacing of marked shifts. A cleared cell ends as X.
      const evenSpread = (changes: Change[]): { even: [number, number]; spread: number } => {
        if (evenIds.size === 0 && spreadIds.size === 0) return { even: [0, 0], spread: 0 };
        const ch = changes.map(([p, d, id]) => [p.id, d, id ?? offShift?.id ?? null] as const);
        return { even: evenDelta(ch), spread: spreadDelta(ch) };
      };

      type Step = () => boolean;
      /** Try a compound: apply its steps in order, then the end-state checks; roll back on any failure. */
      function attempt(steps: Step[], bounds = true, extra?: () => boolean): boolean {
        const m = mark();
        changed.length = 0;
        const before = snapshotBefore();
        for (const s of steps) if (!s()) { rollback(m); return false; }
        if (!endStateOk(before, bounds) || (extra && !extra())) { rollback(m); return false; }
        return true;
      }

      // ── Phase A: pair the odd ones ──
      function phaseA(): void {
        const done = new Set<string>();
        for (;;) {
          let odd = people.filter((p) => !done.has(p.id) && isOdd(p)).sort((a, b) => Math.abs(devOf(b)) - Math.abs(devOf(a)) || (a.id < b.id ? -1 : 1));
          if (odd.length > LIMITS.odd) { capHit.add("odd"); odd = odd.slice(0, LIMITS.odd); }
          type Cand = { score: number; avoid: number; even: [number, number]; spread: number; size: number; tag: string; steps: Step[]; ids: string[] };
          const cands: Cand[] = [];
          const swapDelta = (d: string, X: ScheduleStaff, Y: ScheduleStaff): number | null => {
            const cx = cellOf(X, d), cy = cellOf(Y, d);
            if (!cx || !cy || !isSwappableCell(cx, d) || !isSwappableCell(cy, d) || cx.shiftTypeId === cy.shiftTypeId) return null;
            return hrsOf(X, stById.get(cy.shiftTypeId)!, d) - hrsOf(X, stById.get(cx.shiftTypeId)!, d);
          };
          for (let i = 0; i < odd.length; i++) for (let j = i + 1; j < odd.length; j++) {
            const P = odd[i], Q = odd[j], dP = devOf(P), dQ = devOf(Q);
            for (const d of ppDates) { // (a) direct
              const x = swapDelta(d, P, Q);
              if (x === null) continue;
              const y = hrsOf(Q, stById.get(cellOf(P, d)!.shiftTypeId)!, d) - hrsOf(Q, stById.get(cellOf(Q, d)!.shiftTypeId)!, d);
              if (isOdd(P, dP + x) || isOdd(Q, dQ + y)) continue;
              cands.push({ score: Math.abs(dP + x) + Math.abs(dQ + y) - Math.abs(dP) - Math.abs(dQ), avoid: avoidDelta(swapChanges(d, P, Q)), ...evenSpread(swapChanges(d, P, Q)), size: 2, tag: `a${P.id}${Q.id}${d}`, steps: [() => swap(d, P, Q)], ids: [P.id, Q.id] });
            }
            let gs = people.filter((G) => G.id !== P.id && G.id !== Q.id && !isOdd(G));
            if (gs.length > LIMITS.intermediaries) { capHit.add("intermediaries"); gs = gs.slice(0, LIMITS.intermediaries); }
            for (const G of gs) for (const d1 of ppDates) {
              const x1 = swapDelta(d1, P, G);
              if (x1 === null || isOdd(P, dP + x1)) continue;
              const g1 = hrsOf(G, stById.get(cellOf(P, d1)!.shiftTypeId)!, d1) - hrsOf(G, stById.get(cellOf(G, d1)!.shiftTypeId)!, d1);
              for (const d2 of ppDates) {
                if (d2 === d1) continue;
                const x2 = swapDelta(d2, Q, G);
                if (x2 === null || isOdd(Q, dQ + x2)) continue;
                const g2 = hrsOf(G, stById.get(cellOf(Q, d2)!.shiftTypeId)!, d2) - hrsOf(G, stById.get(cellOf(G, d2)!.shiftTypeId)!, d2);
                const dG = devOf(G);
                if (isOdd(G, dG + g1 + g2)) continue;
                const score = Math.abs(dP + x1) + Math.abs(dQ + x2) + Math.abs(dG + g1 + g2) - Math.abs(dP) - Math.abs(dQ) - Math.abs(dG);
                cands.push({ score, avoid: avoidDelta([...swapChanges(d1, P, G), ...swapChanges(d2, Q, G)]), ...evenSpread([...swapChanges(d1, P, G), ...swapChanges(d2, Q, G)]), size: 4, tag: `b${P.id}${Q.id}${G.id}${d1}${d2}`, steps: [() => swap(d1, P, G), () => swap(d2, Q, G)], ids: [P.id, Q.id] });
              }
            }
          }
          if (cands.length === 0) return;
          cands.sort((a, b) => a.score - b.score || a.avoid - b.avoid || cmpTuple(a.even, b.even) || a.spread - b.spread || a.size - b.size || (a.tag < b.tag ? -1 : 1));
          let applied: Cand | null = null, checks = 0;
          for (const c of cands) {
            if (++checks > LIMITS.checksPerStep) { capHit.add("checks"); break; }
            if (attempt(c.steps, false)) { applied = c; break; }
          }
          if (!applied) return;
          for (const id of applied.ids) done.add(id);
        }
      }

      // ── Phase B: strictly improving ──
      function phaseB(): void {
        for (let it = 0; ; it++) {
          if (it >= LIMITS.phaseBIters) { capHit.add("phaseB"); return; }
          const devNow = new Map(people.map((p) => [p.id, devOf(p)]));
          const off = people.filter((p) => devNow.get(p.id) !== 0);
          if (off.length === 0) return;
          type Cand = { gain: number; avoid: number; even: [number, number]; spread: number; size: number; tag: string; steps: Step[] };
          const cands: Cand[] = [];
          const gainOf = (deltas: [ScheduleStaff, number][]): number => {
            const acc = new Map<string, number>();
            for (const [p, x] of deltas) acc.set(p.id, (acc.get(p.id) ?? 0) + x);
            let g = 0;
            for (const [id, x] of acc) { const dv = devNow.get(id)!; g += Math.abs(dv) - Math.abs(dv + x); }
            return g;
          };
          for (const A of off) for (const d of ppDates) {
            const ca = cellOf(A, d);
            if (ca && isSwappableCell(ca, d)) { // SWAP with anyone
              const aSt = stById.get(ca.shiftTypeId)!;
              for (const B of people) {
                if (B.id === A.id) continue;
                const cb = cellOf(B, d);
                if (!cb || !isSwappableCell(cb, d) || cb.shiftTypeId === ca.shiftTypeId) continue;
                const bSt = stById.get(cb.shiftTypeId)!;
                const gain = gainOf([[A, hrsOf(A, bSt, d) - hrsOf(A, aSt, d)], [B, hrsOf(B, aSt, d) - hrsOf(B, bSt, d)]]);
                if (gain > 0) cands.push({ gain, avoid: avoidDelta(swapChanges(d, A, B)), ...evenSpread(swapChanges(d, A, B)), size: 2, tag: `s${A.id}${B.id}${d}`, steps: [() => swap(d, A, B)] });
              }
            }
            if (isFillCell(A, d)) {
              if (devNow.get(A.id)! > 0) {
                const g = gainOf([[A, -fillH(A, d)]]);
                if (g > 0) cands.push({ gain: g, avoid: avoidDelta([[A, d, null]]), ...evenSpread([[A, d, null]]), size: 1, tag: `d${A.id}${d}`, steps: [() => drop(d, A)] });
              }
              for (const B of people) { // MOVE A→B
                if (B.id === A.id || !isOpen(B, d)) continue;
                const g = gainOf([[A, -fillH(A, d)], [B, fillH(B, d)]]);
                if (g > 0) cands.push({ gain: g, avoid: avoidDelta([[A, d, null], [B, d, fill.id]]), ...evenSpread([[A, d, null], [B, d, fill.id]]), size: 2, tag: `m${A.id}${B.id}${d}`, steps: [() => move(d, A, B)] });
              }
            }
            if (isOpen(A, d) && devNow.get(A.id)! < 0) {
              const g = gainOf([[A, fillH(A, d)]]);
              if (g > 0) cands.push({ gain: g, avoid: avoidDelta([[A, d, fill.id]]), ...evenSpread([[A, d, fill.id]]), size: 1, tag: `+${A.id}${d}`, steps: [() => add(d, A)] });
            }
          }
          // Two-hop MOVE: A (over) → G on e1, G → B (under) on e2; G's own hours move by
          // fillH(e1) − fillH(e2), usually 0.
          const overs = off.filter((p) => devNow.get(p.id)! > 0), unders = off.filter((p) => devNow.get(p.id)! < 0);
          let gs = people;
          if (gs.length > LIMITS.intermediaries) { capHit.add("intermediaries"); gs = gs.slice(0, LIMITS.intermediaries); }
          for (const A of overs) for (const B of unders) for (const G of gs) {
            if (G.id === A.id || G.id === B.id) continue;
            for (const e1 of ppDates) {
              if (!isFillCell(A, e1) || !isOpen(G, e1)) continue;
              for (const e2 of ppDates) {
                if (e2 === e1 || !isFillCell(G, e2) || !isOpen(B, e2)) continue;
                const g = gainOf([[A, -fillH(A, e1)], [G, fillH(G, e1) - fillH(G, e2)], [B, fillH(B, e2)]]);
                if (g > 0) cands.push({ gain: g, avoid: avoidDelta([[A, e1, null], [G, e1, fill.id], [G, e2, null], [B, e2, fill.id]]), ...evenSpread([[A, e1, null], [G, e1, fill.id], [G, e2, null], [B, e2, fill.id]]), size: 4, tag: `h${A.id}${G.id}${B.id}${e1}${e2}`, steps: [() => move(e1, A, G), () => move(e2, G, B)] });
              }
            }
          }
          if (cands.length === 0) return;
          cands.sort((a, b) => b.gain - a.gain || a.avoid - b.avoid || cmpTuple(a.even, b.even) || a.spread - b.spread || a.size - b.size || (a.tag < b.tag ? -1 : 1));
          let ok = false, checks = 0;
          for (const c of cands) {
            if (++checks > LIMITS.checksPerStep) { capHit.add("checks"); break; }
            if (attempt(c.steps)) { ok = true; break; }
          }
          if (!ok) return;
        }
      }

      // ── Phase C (card #259): mix shift lengths with shifts a person is meant to get ──
      // David (#48): hours may be made exact only with a shift the person is already meant to
      // get — their own min target / preference on it, up to that amount, or a staffing
      // requirement for it still unmet that day. Never a shift purely for hours; never under.
      // Feb 2027: DH +4 with an odd ORL; KO wants 2 PRE that week. DH takes KO's ORL (swap),
      // KO's two OR days become the PRE they want, DH drops an OR — a compound Phase A/B can't
      // reach, since its first step makes both worse.
      type Wanted = { own: boolean; cover: boolean };
      // Destination shifts: placeable work shifts other than the fill (Phase A/B own it), and
      // never a required-follower source (a reshape must not create a shift that owes a
      // follower — Codex #1212).
      // Nor a shift placed as a group: a weekend pair (or a holiday weekend pair) and a holiday
      // rule's slots must be placed together, so one cell of them alone is never a reshape.
      const reshapeShifts = shiftTypes.filter((st) => st.autoSchedulable && st.countsTowardFte && !st.isLeave && !st.isOffShift && st.id !== fill.id
        && !followerBySource.has(st.id) && !st.weekendPaired && !st.holidayWeekendPaired);
      // (A trade's swap and a reshape of an existing cell refuse a group day in isSwappableCell.)
      /** Is `W` a shift `A` is meant to get on `d`, on the grid as it stands (the compound's start)? */
      function wantedAt(A: ScheduleStaff, W: ScheduleShiftType, d: string): Wanted | null {
        const own = getMinimumDeficit(A, W, d) > 0;
        const cover = countCoverage(W.code, d) < getRequiredCount(W, d);
        return own || cover ? { own, cover } : null;
      }
      /** Still wanted in the end state: up to the target's amount, or up to the day's required count. */
      function stillWanted(A: ScheduleStaff, W: ScheduleShiftType, d: string, w: Wanted): boolean {
        if (w.cover && countCoverage(W.code, d) <= getRequiredCount(W, d)) return true;
        if (!w.own) return false;
        for (const t of A.shiftMinimumTargets ?? []) {
          if (t.shiftTypeId !== W.id || t.minCount <= 0) continue;
          const b = getWindowBounds(t, d, ppRangesAll);
          if (!b) continue;
          let n = 0;
          for (const [k, v] of grid.entries()) {
            if (!k.startsWith(A.id + ":") || v.code !== W.code || v.noCount) continue;
            const x = k.slice(A.id.length + 1);
            if (x >= b.start && x <= b.end) n++;
          }
          if (n <= t.minCount) return true;
        }
        return false;
      }
      /** Every max target (hard and soft) of A on W holds on the FINAL grid; the cell at `d` is
       *  the candidate, counted once (isAtMaximum assumes it absent — Codex #1212). */
      function rollingCountOk(A: ScheduleStaff, W: ScheduleShiftType, d: string): boolean {
        const targets = (A.shiftMinimumTargets ?? []).filter((t) => t.shiftTypeId === W.id && t.maxCount != null);
        if (targets.length === 0) return true;
        const others: string[] = [];
        for (const [k, v] of grid.entries()) {
          if (!k.startsWith(A.id + ":") || v.code !== W.code || v.noCount) continue;
          const x = k.slice(A.id.length + 1);
          if (x !== d) others.push(x);
        }
        return targets.every((t) => !isAtRollingMaximum(t, d, others, ppRangesAll));
      }
      const softAvoidsW = (A: ScheduleStaff, d: string, W: ScheduleShiftType): boolean => {
        if (requestList.length === 0) return false;
        const f = foldFor(A.id, d);
        return f.avoidWorking || f.avoidedShiftIds.has(W.id);
      };
      const windowWord: Record<string, string> = { week: "a week", pay_period: "a pay period", month: "a month", days: "in the window" };
      function reshapeReason(A: ScheduleStaff, W: ScheduleShiftType, d: string, w: Wanted): string {
        const t = w.own ? (A.shiftMinimumTargets ?? []).find((x) => x.shiftTypeId === W.id && x.minCount > 0) : undefined;
        if (t) return `${W.code} (hours repair: ${A.initials}'s ${t.minCount} ${W.code} ${windowWord[t.window] ?? ""})`.replace(/ \)$/, ")");
        return `${W.code} (hours repair: ${W.code} short on ${d})`;
      }
      /** The primitive: A's cell on d becomes W — a swappable work cell, or an open cell. */
      function reshape(d: string, A: ScheduleStaff, W: ScheduleShiftType, w: Wanted): boolean {
        if (holidaySet.has(d) || groupSlot.has(`${W.id}:${d}`) || softAvoidsW(A, d, W)) return false;
        const c = cellOf(A, d);
        if (c) {
          if (!isSwappableCell(c, d) || c.shiftTypeId === W.id) return false;
          if (swapBreaksHardMin(A, stById.get(c.shiftTypeId)!, d, ppRangesAll)) return false;
        } else if (!isAvailable(A, d, W)) return false;
        if (!canHoldForSwap(A, W, d, ppRangesAll)) return false;
        repairSet(A.id, d, W, "repair", reshapeReason(A, W, d, w));
        changed.push({ p: A, d });
        return true;
      }
      type ReshapeOpt = { d: string; W: ScheduleShiftType; w: Wanted; dh: number };
      /** A's wanted reshapes on the grid as it stands, with their hour change. */
      function reshapeOpts(A: ScheduleStaff, skip?: string): ReshapeOpt[] {
        const out: ReshapeOpt[] = [];
        for (const d of ppDates) {
          if (d === skip || holidaySet.has(d)) continue;
          const c = cellOf(A, d);
          if (c ? !isSwappableCell(c, d) : !isOpen(A, d)) continue;
          const cur = c ? hrsOf(A, stById.get(c.shiftTypeId)!, d) : 0;
          for (const W of reshapeShifts) {
            if (c?.shiftTypeId === W.id || !(eligibleShiftSets.get(A.id)?.has(W.id) ?? false)) continue;
            const w = wantedAt(A, W, d);
            if (w) out.push({ d, W, w, dh: hrsOf(A, W, d) - cur });
          }
        }
        return out;
      }
      /** 0, 1 or 2 reshapes on distinct days. */
      function reshapeSets(opts: ReshapeOpt[], min: number): ReshapeOpt[][] {
        const sets: ReshapeOpt[][] = min === 0 ? [[]] : [];
        for (let i = 0; i < opts.length; i++) {
          sets.push([opts[i]]);
          for (let j = i + 1; j < opts.length; j++) if (opts[j].d !== opts[i].d) sets.push([opts[i], opts[j]]);
        }
        return sets;
      }
      function phaseC(): void {
        for (let it = 0; ; it++) {
          if (it >= LIMITS.phaseCIters) { capHit.add("phaseC"); return; }
          const devNow = new Map(people.map((p) => [p.id, devOf(p)]));
          const off = people.filter((p) => devNow.get(p.id) !== 0).sort((a, b) => Math.abs(devNow.get(b.id)!) - Math.abs(devNow.get(a.id)!) || (a.id < b.id ? -1 : 1));
          if (off.length === 0) return;
          type Cand = { gain: number; avoid: number; even: [number, number]; spread: number; size: number; tag: string; steps: Step[]; shaped: { A: ScheduleStaff; o: ReshapeOpt }[] };
          const cands: Cand[] = [];
          const gainOf = (deltas: [ScheduleStaff, number][]): number => {
            const acc = new Map<string, number>();
            for (const [p, x] of deltas) acc.set(p.id, (acc.get(p.id) ?? 0) + x);
            let g = 0;
            for (const [id, x] of acc) { const dv = devNow.get(id)!; g += Math.abs(dv) - Math.abs(dv + x); }
            return g;
          };
          const under = (id: string, x: number): boolean => { const dv = devNow.get(id)!; return Math.max(0, -(dv + x)) > Math.max(0, -dv); };
          // A fill-day adjustment for P: none, drop one, or add one (on a day other than `skip`).
          type Adj = { dh: number; step: Step | null; ch: Change[]; tag: string };
          const adjFor = (P: ScheduleStaff, skip: string[]): Adj[] => {
            const out: Adj[] = [{ dh: 0, step: null, ch: [], tag: "" }];
            for (const e of ppDates) {
              if (skip.includes(e)) continue;
              if (isFillCell(P, e)) out.push({ dh: -fillH(P, e), step: () => drop(e, P), ch: [[P, e, null]], tag: `-${e}` });
              else if (isOpen(P, e)) out.push({ dh: fillH(P, e), step: () => add(e, P), ch: [[P, e, fill.id]], tag: `+${e}` });
            }
            return out;
          };
          const push = (deltas: [ScheduleStaff, number][], steps: Step[], ch: Change[], shaped: Cand["shaped"], tag: string) => {
            if (deltas.some(([p, x]) => under(p.id, x))) return; // never under (cheap pre-filter; re-checked on the end state)
            const gain = gainOf(deltas);
            if (gain > 0) cands.push({ gain, avoid: avoidDelta(ch), ...evenSpread(ch), size: steps.length, tag, steps, shaped });
          };
          const shapeSteps = (A: ScheduleStaff, set: ReshapeOpt[]): Step[] => set.map((o) => () => reshape(o.d, A, o.W, o.w));
          const shapeCh = (A: ScheduleStaff, set: ReshapeOpt[]): Change[] => set.map((o) => [A, o.d, o.W.id] as Change);
          for (const P of off) {
            // T1: P's own wanted reshapes (1–2), plus at most one fill-day adjustment.
            const own = reshapeOpts(P);
            if (own.length > LIMITS.reshapeOpts) capHit.add("reshapeOpts");
            for (const set of reshapeSets(own.slice(0, LIMITS.reshapeOpts), 1)) {
              const rh = set.reduce((s, o) => s + o.dh, 0);
              for (const a of adjFor(P, set.map((o) => o.d))) {
                push([[P, rh + a.dh]], [...shapeSteps(P, set), ...(a.step ? [a.step] : [])], [...shapeCh(P, set), ...a.ch],
                  set.map((o) => ({ A: P, o })), `t1${P.id}${set.map((o) => o.d + o.W.id).join("")}${a.tag}`);
              }
            }
            // T2: a same-day swap with A, then 1–2 of A's wanted reshapes absorb A's change, plus
            // at most one fill-day adjustment for P.
            let partners = people.filter((A) => A.id !== P.id);
            if (partners.length > LIMITS.intermediaries) { capHit.add("intermediaries"); partners = partners.slice(0, LIMITS.intermediaries); }
            for (const A of partners) {
              const allA = reshapeOpts(A);
              if (allA.length > LIMITS.reshapeOpts) capHit.add("reshapeOpts");
              const aOpts = allA.slice(0, LIMITS.reshapeOpts);
              if (aOpts.length === 0) continue;
              for (const d of ppDates) {
                const cp = cellOf(P, d), ca = cellOf(A, d);
                if (!cp || !ca || !isSwappableCell(cp, d) || !isSwappableCell(ca, d) || cp.shiftTypeId === ca.shiftTypeId) continue;
                const pSt = stById.get(cp.shiftTypeId)!, aSt = stById.get(ca.shiftTypeId)!;
                const xP = hrsOf(P, aSt, d) - hrsOf(P, pSt, d), xA = hrsOf(A, pSt, d) - hrsOf(A, aSt, d);
                // On the swap day itself A then holds P's old shift, so a reshape there is measured
                // from that (P takes A's shift, A works the shift A wanted).
                const onD: ReshapeOpt[] = [];
                if (!holidaySet.has(d)) for (const W of reshapeShifts) {
                  if (W.id === pSt.id || !(eligibleShiftSets.get(A.id)?.has(W.id) ?? false)) continue;
                  const w = wantedAt(A, W, d);
                  if (w) onD.push({ d, W, w, dh: hrsOf(A, W, d) - hrsOf(A, pSt, d) });
                }
                for (const set of reshapeSets([...onD, ...aOpts.filter((o) => o.d !== d)], 1)) {
                  const rA = set.reduce((s, o) => s + o.dh, 0);
                  for (const a of adjFor(P, [d])) {
                    // The absorber ends no further from target than they started (plan T2).
                    if (Math.abs(devNow.get(A.id)! + xA + rA) > Math.abs(devNow.get(A.id)!)) continue;
                    push([[P, xP + a.dh], [A, xA + rA]], [() => swap(d, P, A), ...shapeSteps(A, set), ...(a.step ? [a.step] : [])],
                      [...swapChanges(d, P, A), ...shapeCh(A, set), ...a.ch], set.map((o) => ({ A, o })),
                      `t2${P.id}${A.id}${d}${set.map((o) => o.d + o.W.id).join("")}${a.tag}`);
                  }
                }
              }
            }
          }
          if (cands.length === 0) return;
          cands.sort((a, b) => b.gain - a.gain || a.avoid - b.avoid || cmpTuple(a.even, b.even) || a.spread - b.spread || a.size - b.size || (a.tag < b.tag ? -1 : 1));
          let ok = false, checks = 0;
          for (const c of cands) {
            if (++checks > LIMITS.checksPerStep) { capHit.add("checks"); break; }
            const startTotal = total();
            const extra = (): boolean => {
              // End state: every reshaped cell is still wanted (two of the same W can't overshoot
              // together), every max holds with the candidate counted once, nobody further under
              // than at the start (whatever the under-hours setting), and the total strictly drops.
              for (const { A, o } of c.shaped) {
                if (cellOf(A, o.d)?.shiftTypeId !== o.W.id) return false;
                if (!stillWanted(A, o.W, o.d, o.w) || !rollingCountOk(A, o.W, o.d)) return false;
              }
              for (const p of people) if (Math.max(0, -devOf(p)) > Math.max(0, -devNow.get(p.id)!)) return false;
              // Everyone whose cells were reshaped (P in T1, the absorber in T2) ends no further from target.
              for (const { A } of c.shaped) if (Math.abs(devOf(A)) > Math.abs(devNow.get(A.id)!)) return false;
              return total() < startTotal;
            };
            if (attempt(c.steps, true, extra)) { ok = true; break; }
          }
          if (!ok) return;
        }
      }

      const start = total();
      if (start === 0) continue;
      const startDevs = new Map(people.map((p) => [p.id, devOf(p)]));
      const m = mark();
      phaseA();
      phaseB();
      if (total() >= start || boundsBroken(startDevs)) {
        rollback(m);
        phaseB(); // strictly improving on its own, so always kept
      }
      if (reshapeShifts.length > 0 && !skipShiftMixForTest) phaseC(); // each compound kept only if it strictly improves
      journal.length = 0; // committed
    }
    for (const what of capHit) warnings.push(`Hours repair: search limit reached (${what}); some hours may stay off target`);
  }

  if (fillShift) {
    repairPayPeriodHours();
    if (!skipCompoundRepairForTest) compoundHoursRepair(fillShift);
  }

  // ── Coverage repair by one-level rearrangement ──
  // Auto-generation may always rearrange to make the schedule work. When a daily minimum
  // is still unmet late in the run (e.g. a revoked request freed a slot after STEP 3 had
  // already filled everyone's days), a staffer may take the slot if the ONLY obstacles are
  // engine-placed discretionary cells:
  //   • on the slot day: a fill cell, or a holiday-entitlement HOL (working the holiday
  //     replaces HOL on that same day — HOL is never released anywhere else);
  //   • on the day before / after: a fill cell the follow rules forbid next to the slot's
  //     shift, or (day after) the day the shift's each_day follower needs.
  // The whole move — release, place the shift, its each_day follower, refill released hours
  // on open days of the same pay period — is first TRIED on the live state and rolled back;
  // it is committed (and re-verified) only if it raises the slot's coverage, leaves every
  // released day's own minimum met, and crosses no hours line the policy protects. Never
  // touches manual, locked, imported, request, leave, follower or follower-source cells.
  // Shifts with an each_run follower (e.g. CALL→ADM) and weekend-paired slots are not
  // repaired here (one-day moves would break those units). One level only.
  function isOpenCell(staffId: string, date: string): boolean {
    const c = grid.get(`${staffId}:${date}`);
    return !c || isFillableOffCell(c);
  }
  function releasableCellAt(staffId: string, date: string, allowHoliday: boolean) {
    const c = grid.get(`${staffId}:${date}`);
    if (!c || c.locked || c.noCount || c.step === undefined) return null;
    if (c.step !== "fill" && !(allowHoliday && c.step === "holiday")) return null;
    if (followerBySource.has(c.shiftTypeId)) return null;
    return c;
  }
  // Remove a cell the engine placed in THIS run (grid + its suggestion + step stat).
  function releaseEngineCell(staffId: string, date: string) {
    const c = grid.get(`${staffId}:${date}`);
    if (!c) return;
    grid.delete(`${staffId}:${date}`);
    const idx = suggestions.findIndex((x) => x.staffId === staffId && x.date === date && x.shiftTypeId === c.shiftTypeId && x.step === c.step);
    if (idx >= 0) suggestions.splice(idx, 1);
    if (c.step) byStep[c.step] = Math.max(0, (byStep[c.step] ?? 0) - 1);
  }

  function trimLeaveToTarget(off: ScheduleShiftType) {
    for (const pp of payPeriods) {
      if (!dates.some((d) => d >= pp.startDate && d <= pp.endDate)) continue;
      for (const p of activeStaff) {
        const target = targetFor(p, pp);
        const total = ppHoursForStaff(p.id, pp);
        if (total <= target) continue;
        const leave: { date: string; hours: number }[] = [];
        for (const [key, c] of grid) {
          if (c.step !== "request-leave") continue;
          const [sid, d] = [key.slice(0, key.lastIndexOf(":")), key.slice(key.lastIndexOf(":") + 1)];
          if (sid !== p.id || d < pp.startDate || d > pp.endDate) continue;
          const st = stById.get(c.shiftTypeId);
          const hours = st?.countsTowardFte ? getShiftHours(p.id, st, overrideMap, dayTypeOf(d, holidaySet)) : 0;
          leave.push({ date: d, hours });
        }
        if (leave.length === 0) continue;
        const leaveHours = leave.reduce((s, l) => s + l.hours, 0);
        for (const d of excessLeaveDays(target, total - leaveHours, leave)) {
          const key = `${p.id}:${d}`;
          const c = grid.get(key)!;
          const idx = suggestions.findIndex((x) => x.staffId === p.id && x.date === d && x.step === "request-leave");
          grid.set(key, { ...c, shiftTypeId: off.id, code: off.code, step: LEAVE_OFF_STEP });
          if (idx >= 0) {
            suggestions[idx] = {
              ...suggestions[idx],
              shiftTypeId: off.id,
              code: off.code,
              step: LEAVE_OFF_STEP,
              reason: `Requested leave not needed: already at the pay-period hours target (${off.code})`,
            };
          }
          byStep["request-leave"] = Math.max(0, (byStep["request-leave"] ?? 0) - 1);
          byStep[LEAVE_OFF_STEP] = (byStep[LEAVE_OFF_STEP] ?? 0) + 1;
        }
      }
    }
  }

  function recheckConditionalRules() {
    const owners = activeStaff.filter((p) => p.availabilityRules.some((r) => r.conditionStaffId && r.conditionType));
    if (owners.length === 0) return;
    const HUMAN_STEPS = new Set(["request-leave", LEAVE_OFF_STEP, "request-shift", "request-tentative"]);
    const nameOf = (id: string) => staff.find((p) => p.id === id)?.initials ?? "another staff member";
    // The conditional rules that apply on `date` and currently say "unavailable" (a rule
    // granting availability whose condition fails, or a ban whose condition holds).
    const describe = (p: ScheduleStaff, date: string) => {
      const parts = new Set<string>();
      for (const r of p.availabilityRules) {
        if (!r.conditionStaffId || !r.conditionType) continue;
        if (!matchesWhen(ruleToWhen(r), date, payPeriods)) continue;
        parts.add(`'only when ${nameOf(r.conditionStaffId)} is ${r.conditionType === "working" ? "" : "not "}working'`);
      }
      return [...parts].join(" / ") || "availability rule";
    };
    // The engine cell of `p` on `date` that its conditional rules reject now, or null.
    const brokenCell = (p: ScheduleStaff, date: string) => {
      const cell = grid.get(`${p.id}:${date}`);
      if (!cell || cell.step === undefined || cell.locked || HUMAN_STEPS.has(cell.step)) return null;
      if (isAwayShift(cell.shiftTypeId)) return null;
      const st = stById.get(cell.shiftTypeId);
      if (!st || st.ignoresWorkingDays) return null;
      if (evaluateAvailability(p.availabilityRules, date, payPeriods, (pid, d) => isWorking(pid, d)).available) return null;
      return { cell, st };
    };
    // Why a broken cell must stay (null = it may be freed). Freeing makes the day X in STEP 4,
    // so it must not split a weekend pair or break a follow rule with the day before or after.
    const keepReason = (staffId: string, date: string, cell: NonNullable<ReturnType<typeof grid.get>>, st: ScheduleShiftType): string | null => {
      if (cell.step === "standing") return "standing commitment";
      if (cell.step === "follower") return "required follower";
      if (cell.step === "holiday") return "holiday entitlement";
      if (cell.step === "holiday-rule") return "holiday pair"; // card #210: never freed alone
      if (cell.noCount) return "does not count toward targets";
      if (followerBySource.has(cell.shiftTypeId)) return "it has a required follower";
      if (st.weekendPaired && (isWeekend(date) || (st.holidayWeekendPaired && holidaySet.has(date)))) return "weekend pair";
      // Card #260: freeing a middle day must not split a Hard-gap stretch into two too close.
      if (gapHard(st)) {
        const snap = gapSnapshot([staffId], [date]);
        grid.delete(`${staffId}:${date}`);
        const split = gapNewSince(snap);
        grid.set(`${staffId}:${date}`, cell);
        if (split) return `freeing it would leave two ${st.code} closer than ${gapOf(st)} days`;
      }
      if (offShift) {
        // A neighbour as it will END: an empty in-window day (never filled, or freed by an
        // earlier removal) becomes X in STEP 4, so judge it as X (card #74: two adjacent
        // removals must not produce a forbidden X→X). Out-of-window and unknown days: no check.
        const endingAs = (d: string): string | null => grid.get(`${staffId}:${d}`)?.shiftTypeId ?? (dateSet.has(d) ? offShift.id : null);
        const prev = endingAs(prevDate(date));
        if (prev && !isShiftAllowedAfter(followMap, prev, offShift.id, true)) return "a day off is not allowed after the day before";
        const next = endingAs(nextDate(date));
        const nextSt = next ? stById.get(next) : undefined;
        if (next && nextSt && !isShiftAllowedAfter(followMap, offShift.id, next, nextSt.isOffShift)) return "the next day's shift is not allowed after a day off";
      }
      return null;
    };
    const maxPasses = dates.length * owners.length + 1;
    for (let pass = 0; pass < maxPasses; pass++) {
      let freed = 0;
      for (const date of dates) {
        for (const p of owners) {
          const b = brokenCell(p, date);
          if (!b || keepReason(p.id, date, b.cell, b.st) !== null) continue;
          releaseEngineCell(p.id, date);
          warnings.push(`${p.initials} ${date}: ${b.cell.code} removed — their rule ${describe(p, date)} no longer holds on the finished schedule`);
          freed++;
        }
      }
      if (freed === 0) break;
    }
    // Kept cells are reported only once nothing else will be freed, so a break a later
    // removal healed is never warned.
    for (const date of dates) {
      for (const p of owners) {
        const b = brokenCell(p, date);
        if (!b) continue;
        const why = keepReason(p.id, date, b.cell, b.st) ?? "not freed";
        warnings.push(`${p.initials} ${date}: ${b.cell.code} breaks their rule ${describe(p, date)} on the finished schedule (kept: ${why})`);
      }
    }
  }

  type EngineSnapshot = {
    sug: Suggestion[];
    steps: Record<string, number>;
    warn: number;
    cells: [string, ReturnType<typeof grid.get>][];
  };
  function snapshotFor(staffIds: string | string[], extraDates: string[]): EngineSnapshot {
    const ids = Array.isArray(staffIds) ? staffIds : [staffIds];
    const keys = new Set(ids.flatMap((id) => [...dates, ...extraDates].map((d) => `${id}:${d}`)));
    return { sug: suggestions.slice(), steps: { ...byStep }, warn: warnings.length, cells: [...keys].map((k) => [k, grid.get(k)]) };
  }
  function restoreSnapshot(snap: EngineSnapshot) {
    suggestions.length = 0;
    suggestions.push(...snap.sug);
    for (const k of Object.keys(byStep)) delete byStep[k];
    Object.assign(byStep, snap.steps);
    warnings.length = snap.warn;
    for (const [k, v] of snap.cells) { if (v) grid.set(k, v); else grid.delete(k); }
  }

  type RearrangePlan = {
    staff: ScheduleStaff;
    release: string[]; // dates whose discretionary cell is released
    refill: string[]; // dates that received a fill shift back
    over: boolean; // the move pushed the staffer further over target (only where coverage may)
  };

  // Which cells `p` must give up to take `st` on `date`, or null if a protected cell is in the way.
  function releasesNeeded(p: ScheduleStaff, date: string, st: ScheduleShiftType): string[] | null {
    const release: string[] = [];
    if (!isOpenCell(p.id, date)) {
      if (!releasableCellAt(p.id, date, true)) return null;
      release.push(date);
    }
    const follower = followerBySource.get(st.id);
    const nd = nextDate(date);
    const nextCell = getCell(p.id, nd);
    if (nextCell) {
      const nst = stById.get(nextCell.shiftTypeId);
      const conflicts = !!nst && !isShiftAllowedAfter(followMap, st.id, nextCell.shiftTypeId, nst.isOffShift);
      const followerWantsDay = follower?.scope === "each_day" && dateSet.has(nd) && nextCell.shiftTypeId !== follower.follower.id;
      if (conflicts || followerWantsDay) {
        if (releasableCellAt(p.id, nd, false)) release.push(nd);
        else if (conflicts) return null;
      }
    }
    const pd = prevDate(date);
    const prevCell = getCell(p.id, pd);
    if (prevCell && !isShiftAllowedAfter(followMap, prevCell.shiftTypeId, st.id, st.isOffShift)) {
      if (!releasableCellAt(p.id, pd, false)) return null;
      release.push(pd);
    }
    return release;
  }

  // Perform the move on the live state. Returns the plan if every guarantee holds; the
  // caller rolls back (trial) or keeps it (commit).
  function performRearrange(
    p: ScheduleStaff, date: string, st: ScheduleShiftType, release: string[], reason: string,
    step = "repair", confidence = 0.85,
  ): RearrangePlan | null {
    const pp = findPPForDate(date);
    const target = pp ? targetFor(p, pp) : 0;
    const before = pp ? ppHoursForStaff(p.id, pp) : 0;
    const coverageBefore = countCoverage(st.code, date);
    const releasedCells = release.map((d) => ({ d, c: grid.get(`${p.id}:${d}`)! }));
    const gapSnap = gapSnapshot([p.id], pp ? dates.filter((d) => d >= pp.startDate && d <= pp.endDate).concat(release, [date]) : [...release, date]);
    for (const d of release) releaseEngineCell(p.id, d);
    if (!isAvailable(p, date, st)) return null;
    assign(p.id, date, st, reason, step, confidence);
    placeEachDayFollower(p.id, date, st);
    const refill: string[] = [];
    if (pp && fillShift && target > 0) {
      for (const d of dates) {
        if (ppHoursForStaff(p.id, pp) >= target) break;
        if (d < pp.startDate || d > pp.endDate || d === date || release.includes(d)) continue;
        if (!isOpenCell(p.id, d) || holidaySet.has(d)) continue;
        if (!eligibleShiftSets.get(p.id)?.has(fillShift.id) || !isAvailable(p, d, fillShift)) continue;
        const add = getShiftHours(p.id, fillShift, overrideMap, dayTypeOf(d, holidaySet));
        if (!fillMayOvershoot && fillShift.countsTowardFte && ppHoursForStaff(p.id, pp) + add > target) continue;
        assign(p.id, d, fillShift, `Refill after rearranging for ${st.code} on ${date}`, "fill", 0.8);
        refill.push(d);
      }
    }
    // Guarantees.
    if (grid.get(`${p.id}:${date}`)?.shiftTypeId !== st.id) return null;
    if (gapNewSince(gapSnap)) return null; // card #260: a released day split a Hard-gap stretch
    if (countCoverage(st.code, date) <= coverageBefore) return null;
    for (const { d, c } of releasedCells) {
      const rst = stById.get(c.shiftTypeId);
      if (rst && countCoverage(rst.code, d) < getRequiredCount(rst, d)) return null; // would open a gap there
    }
    const follower = followerBySource.get(st.id);
    if (follower?.scope === "each_day" && dateSet.has(nextDate(date))) {
      const fc = grid.get(`${p.id}:${nextDate(date)}`);
      if (fc && fc.shiftTypeId !== follower.follower.id && !isFillableOffCell(fc)) return null;
    }
    let over = false;
    if (pp && target > 0) {
      const after = ppHoursForStaff(p.id, pp);
      const worseOver = Math.max(0, after - target) > Math.max(0, before - target);
      const worseUnder = Math.max(0, target - after) > Math.max(0, target - before);
      if (worseOver && !coverageBeatsOverHours) return null;
      if (worseUnder && !beatsHoursRow("coverage", "underHours")) return null;
      over = worseOver;
    }
    return { staff: p, release, refill, over };
  }

  function tryRearrange(p: ScheduleStaff, date: string, st: ScheduleShiftType): RearrangePlan | null {
    const release = releasesNeeded(p, date, st);
    if (!release) return null;
    const snap = snapshotFor(p.id, [prevDate(date), nextDate(date)]);
    try {
      return performRearrange(p, date, st, release, "trial");
    } finally {
      restoreSnapshot(snap);
    }
  }

  // Commit the best plan; re-verified on the real state, rolled back if anything differs.
  function commitRearrange(plan: RearrangePlan, date: string, st: ScheduleShiftType, reason: string): RearrangePlan | null {
    const snap = snapshotFor(plan.staff.id, [prevDate(date), nextDate(date)]);
    const done = performRearrange(plan.staff, date, st, plan.release, reason);
    if (!done) { restoreSnapshot(snap); return null; }
    return done;
  }

  // Best rearrangement for an unmet (st, date) slot: least disruption first (not over
  // target, fewest released then refilled cells), then neediest hours, then id.
  function bestRearrange(st: ScheduleShiftType, date: string, excludeId?: string): RearrangePlan | null {
    if (followerBySource.get(st.id)?.scope === "each_run") return null; // run followers not maintained here
    // A weekend-paired shift is placed as a Sat+Sun unit; a one-day repair would split it.
    if (st.weekendPaired && (isWeekend(date) || (st.holidayWeekendPaired && holidaySet.has(date)))) return null;
    const pp = findPPForDate(date);
    const plans: { plan: RearrangePlan; deficit: number }[] = [];
    for (const p of eligibleStaff(st, date)) {
      if (p.id === excludeId) continue;
      const plan = tryRearrange(p, date, st);
      if (plan) plans.push({ plan, deficit: pp ? targetFor(p, pp) - ppHoursForStaff(p.id, pp) : 0 });
    }
    plans.sort((a, b) =>
      Number(a.plan.over) - Number(b.plan.over)
      || a.plan.release.length - b.plan.release.length
      || a.plan.refill.length - b.plan.refill.length
      || b.deficit - a.deficit
      || a.plan.staff.id.localeCompare(b.plan.staff.id),
    );
    return plans[0]?.plan ?? null;
  }

  // Find and commit the best move for (st, date); null when none holds.
  function rearrangeFor(st: ScheduleShiftType, date: string, reason: string, excludeId?: string): RearrangePlan | null {
    const plan = bestRearrange(st, date, excludeId);
    return plan ? commitRearrange(plan, date, st, reason) : null;
  }

  // Give `p` the freed (st, date) slot under the same guarantees as a rearrangement:
  // release only discretionary cells, place the each_day follower, refill released hours,
  // and keep it only if no released day's minimum opens and no protected hours line is
  // crossed. Rolled back (null) otherwise. Used by reconciliation's direct backfill.
  function placeGuarded(p: ScheduleStaff, date: string, st: ScheduleShiftType, reason: string, step: string, confidence: number): RearrangePlan | null {
    const release = releasesNeeded(p, date, st);
    if (!release) return null;
    const snap = snapshotFor(p.id, [prevDate(date), nextDate(date)]);
    const done = performRearrange(p, date, st, release, reason, step, confidence);
    if (!done) { restoreSnapshot(snap); return null; }
    return done;
  }

  function describeRearrange(plan: RearrangePlan, date: string, st: ScheduleShiftType): string {
    const parts = [`${plan.staff.initials} takes ${st.code} on ${date}`];
    if (plan.release.length) parts.push(`moved discretionary day(s) ${plan.release.join(", ")}`);
    if (plan.refill.length) parts.push(`refilled ${plan.refill.join(", ")}`);
    if (plan.over) parts.push("over pay-period target");
    return parts.join("; ");
  }

  // Fill every still-unmet daily minimum of the scheduled shifts (schedule-priority order)
  // by rearrangement. Runs after reconciliation, before the shortfall audit. Each commit
  // strictly raises one slot's coverage and never lowers another minimum, so it terminates.
  function repairCoverageByRearrange() {
    for (const st of scheduledShifts) {
      for (const date of dates) {
        let guard = 0;
        while (hasUnmetCoverageMinimum(date, st) && guard++ < 50) {
          const plan = rearrangeFor(st, date, `Coverage repair: ${st.code} minimum (rearranged)`);
          if (!plan) break;
          warnings.push(`${date}: ${st.code} minimum met by rearranging — ${describeRearrange(plan, date, st)}`);
        }
      }
    }
  }

  // ── Request reconciliation (tentative → confirm / revoke + backfill) ──
  // (#221 Slice 2) Forced REQUEST_SHIFTs were placed TENTATIVELY in STEP 0b so the
  // plan could build around them. Now that coverage and hours are settled, confirm
  // each tentative cell only if it's conflict-free; otherwise revoke it and backfill
  // the freed slot to whoever needs it. First-come (receivedAt) wins a contended
  // slot; the requester's PP-hours cap is inviolable. Human-approved placements are
  // never tentative, so they are untouched. No-op under the "honor-always" policy.
  function reconcileRequests() {
    // Revocable REQUEST_SHIFT claimants per `${shiftId}:${date}` (NOT human-approved).
    const claimantsBySlot = new Map<string, { staffId: string; receivedAt: string }[]>();
    for (const r of requestList) {
      if (r.kind !== "REQUEST_SHIFT" || r.strength !== "hard") continue;
      if (r.status === "approved" && r.autoApproved !== true) continue; // human-approved → authoritative
      if (r.status === "pending" && pendingMode !== "full") continue; // pending only forced in "full"
      if (r.status !== "approved" && r.status !== "pending") continue; // declined/withdrawn/fulfilled never force
      const recv = r.receivedAt ?? "";
      for (const date of dates) {
        if (!coversDate(r, date)) continue;
        for (const stId of r.shiftTypeIds) {
          const st = stById.get(stId);
          if (!st || st.isLeave || st.isOffShift) continue;
          const slot = `${stId}:${date}`;
          let arr = claimantsBySlot.get(slot);
          if (!arr) { arr = []; claimantsBySlot.set(slot, arr); }
          arr.push({ staffId: r.staffId, receivedAt: recv });
        }
      }
    }

    // A discretionary day-filling cell (STEP 3 "fill") the staff holds on `date`. It's
    // reclaimable: backfill may convert it to the scarce requested shift (e.g. a YA OR
    // fill day → the ORL they needed to hit target). Locked / follower / off cells aren't.
    // An entitlement HOL (STEP 2.75, step "holiday") is reclaimable the same way:
    // working the holiday means the work shift, not HOL (handoff 740, decision 3).
    const RECLAIMABLE_STEPS = new Set(["fill", "holiday"]);
    function fillCellAt(staffId: string, date: string) {
      const c = grid.get(`${staffId}:${date}`);
      return c && c.step !== undefined && RECLAIMABLE_STEPS.has(c.step) && !c.locked && !c.noCount ? c : null;
    }

    // Can `p` legally take `st` on `date`, treating a reclaimable fill cell as free?
    function canTake(p: ScheduleStaff, date: string, st: ScheduleShiftType): boolean {
      const key = `${p.id}:${date}`;
      const fc = fillCellAt(p.id, date);
      if (fc) grid.delete(key); // virtually free the fill day for the legality + hour test
      const ok = isAvailable(p, date, st) && !wouldBreakPPHours(p.id, date, st);
      if (fc) grid.set(key, fc);
      return ok;
    }


    // Best backfill for a freed (st, date) slot: conflict-free claimants by first-come,
    // then the neediest non-claimant by remaining PP hours. excludeId = deferred holder.
    // Returns null when nothing can legally take the slot (Slice 1a then flags it).
    function backfillCandidates(st: ScheduleShiftType, date: string, excludeId: string): ScheduleStaff[] {
      const recvByStaff = new Map<string, string>();
      for (const c of claimantsBySlot.get(`${st.id}:${date}`) ?? []) {
        const cur = recvByStaff.get(c.staffId);
        if (cur === undefined || c.receivedAt < cur) recvByStaff.set(c.staffId, c.receivedAt);
      }
      const pp = findPPForDate(date);
      const cands = eligibleStaff(st, date).filter((p) => p.id !== excludeId && canTake(p, date, st));
      cands.sort((a, b) => {
        const ra = recvByStaff.get(a.id);
        const rb = recvByStaff.get(b.id);
        if (!!ra !== !!rb) return ra ? -1 : 1; // claimants before non-claimants
        if (ra && rb && ra !== rb) return ra < rb ? -1 : 1; // earlier receivedAt wins
        const defA = pp ? targetFor(a, pp) - ppHoursForStaff(a.id, pp) : 0;
        const defB = pp ? targetFor(b, pp) - ppHoursForStaff(b.id, pp) : 0;
        if (defA !== defB) return defB - defA; // neediest hours first
        return a.id.localeCompare(b.id);
      });
      return cands;
    }

    function refillHolder(p: ScheduleStaff, pp: PayPeriod, target: number, freed: string) {
      if (!fillShift || target <= 0) return;
      const order = [freed, ...dates.filter((d) => d !== freed)];
      for (const d of order) {
        if (ppHoursForStaff(p.id, pp) >= target) break;
        if (d < pp.startDate || d > pp.endDate || !isOpenCell(p.id, d) || holidaySet.has(d)) continue;
        if (!eligibleShiftSets.get(p.id)?.has(fillShift.id) || !isAvailable(p, d, fillShift)) continue;
        const add = getShiftHours(p.id, fillShift, overrideMap, dayTypeOf(d, holidaySet));
        if (!fillMayOvershoot && fillShift.countsTowardFte && ppHoursForStaff(p.id, pp) + add > target) continue;
        assign(p.id, d, fillShift, "Refill after giving up a requested shift", "fill", 0.8);
      }
    }

    // Snapshot the tentative cells, then process by first-come so an earlier request
    // resolves before a later one competes for the same slot.
    const tentatives: { staffId: string; date: string; st: ScheduleShiftType; receivedAt: string }[] = [];
    for (const [key, meta] of tentativeMeta) {
      const cell = grid.get(key);
      if (!cell || cell.step !== "request-tentative") continue;
      const sep = key.lastIndexOf(":");
      const st = stById.get(cell.shiftTypeId);
      if (st) tentatives.push({ staffId: key.slice(0, sep), date: key.slice(sep + 1), st, receivedAt: meta.receivedAt });
    }
    tentatives.sort((a, b) =>
      (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0)
      || a.date.localeCompare(b.date)
      || a.staffId.localeCompare(b.staffId),
    );

    for (const t of tentatives) {
      const key = `${t.staffId}:${t.date}`;
      const cell = grid.get(key);
      if (!cell || cell.step !== "request-tentative") continue; // already resolved
      const pp = findPPForDate(t.date);
      const holder = activeStaff.find((p) => p.id === t.staffId);
      if (!pp || !holder) continue; // can't reason → leave placed

      // Over the requester's PP-hours target WITH this cell?
      const target = targetFor(holder, pp);
      const hoursWith = ppHoursForStaff(t.staffId, pp);
      const holderOverCap = t.st.countsTowardFte && target > 0 && hoursWith > target;

      // Temporarily free the slot so challenger / backfill legality (incl. the per-day Max)
      // evaluates as if the holder weren't occupying it.
      const holderGap = gapSnapshot([t.staffId], [t.date]);
      grid.delete(key);
      // Card #260: taking the cell away would leave the holder two of a Hard-gap shift too
      // close (it split a stretch): the holder keeps it, as when nobody challenges.
      if (gapNewSince(holderGap)) {
        grid.set(key, cell);
        if (holderOverCap) warnings.push(`${holder.initials}: over target — ${hoursWith}/${target}hrs (+${hoursWith - target}) in PP ${pp.startDate} to honor ${t.st.code} request on ${t.date} (taking it away would break a minimum gap)`);
        continue;
      }

      // The department's hours policy decides whether over-target revokes the request
      // (it used to be an inviolable cap). Keep it when requests may push past over-target,
      // or when revoking would leave the holder UNDER target and landing under is the worse
      // outcome. Nothing refills the holder after reconciliation, so the hours without the
      // cell are exactly what revoking leaves them with.
      const hoursWithout = ppHoursForStaff(t.staffId, pp);
      const keepOverTarget = holderOverCap && (
        beatsHoursRow("requests", "overHours") ||
        (hoursWithout < target && underIsWorseThanOver())
      );
      const overBlocks = holderOverCap && !keepOverTarget;

      // An EARLIER conflict-free claimant who should take the slot ahead of the holder.
      let challenger: ScheduleStaff | null = null;
      const sorted = (claimantsBySlot.get(`${t.st.id}:${t.date}`) ?? []).slice().sort(
        (a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.staffId.localeCompare(b.staffId)),
      );
      for (const c of sorted) {
        if (c.staffId === t.staffId || !(c.receivedAt < t.receivedAt)) continue;
        const cand = activeStaff.find((p) => p.id === c.staffId);
        // The challenger must be able to COMMIT the slot under the same guarantees the
        // backfill applies (placeGuarded); a trial that fails leaves the holder in place.
        if (cand && canTake(cand, t.date, t.st) && tryRearrange(cand, t.date, t.st)) { challenger = cand; break; }
      }

      if (!overBlocks && !challenger) {
        grid.set(key, cell); // rightful holder → confirm (restore)
        if (holderOverCap) {
          warnings.push(
            `${holder.initials}: over target — ${hoursWith}/${target}hrs (+${hoursWith - target}) in PP ${pp.startDate} to honor ${t.st.code} request on ${t.date}` +
            (hoursWithout < target ? ` (revoking it would leave ${hoursWithout}/${target}hrs, under target)` : ""),
          );
        }
        continue;
      }

      // A first-come transfer (not an hours-driven revoke) must leave the holder whole too:
      // snapshot both staffers so the whole transfer can be undone.
      const transferSnap = challenger && !overBlocks
        ? snapshotFor([t.staffId, challenger.id], [prevDate(t.date), nextDate(t.date)])
        : null;

      // Holder loses the slot: drop its suggestion, then award to the best claimant.
      const idx = suggestions.findIndex(
        (s) => s.staffId === t.staffId && s.date === t.date && s.code === t.st.code && s.step === "request-tentative",
      );
      if (idx >= 0) suggestions.splice(idx, 1);
      byStep["request-tentative"] = Math.max(0, (byStep["request-tentative"] ?? 0) - 1);

      // Backfill in first-come / hour-need order, each attempt transactional (placeGuarded):
      // the first candidate whose move keeps every guarantee takes the slot.
      let chosen: ScheduleStaff | null = null;
      for (const cand of backfillCandidates(t.st, t.date, t.staffId)) {
        if (placeGuarded(cand, t.date, t.st, `Reconciliation: ${t.st.code} re-homed (first-come / hour need)`, "fill", 0.9)) { chosen = cand; break; }
      }
      // Give the holder back the hours the lost cell carried: ordinary fill on open days of
      // the period (the freed day first), never past target unless fill may overshoot.
      refillHolder(holder, pp, target, t.date);
      if (transferSnap) {
        const after = ppHoursForStaff(t.staffId, pp);
        const worseUnder = Math.max(0, target - after) > Math.max(0, target - hoursWith);
        if (!chosen || (worseUnder && underHoursPolicy === "prohibited")) {
          // The transfer would leave the holder under a protected target → undo it all.
          restoreSnapshot(transferSnap);
          grid.set(key, cell);
          continue;
        }
      }
      const reason = overBlocks ? "over pay-period hour cap" : "later than an earlier request";
      // Nobody can take the slot as the grid stands, but it's a required minimum →
      // rearrange discretionary days to cover it.
      const rearranged = !chosen && hasUnmetCoverageMinimum(t.date, t.st)
        ? rearrangeFor(t.st, t.date, `Reconciliation: ${t.st.code} re-homed by rearranging`, t.staffId)
        : null;
      if (rearranged) {
        warnings.push(`${t.date}: deferred ${holder.initials}'s ${t.st.code} request (${reason}) — ${describeRearrange(rearranged, t.date, t.st)}`);
      } else if (chosen) {
        warnings.push(`${t.date}: deferred ${holder.initials}'s ${t.st.code} request (${reason}) — slot granted to ${chosen.initials}`);
      } else {
        warnings.push(`${t.date}: deferred ${holder.initials}'s ${t.st.code} request (${reason}) — no eligible backfill, slot left open`);
      }
    }
  }
  if (reconcilePolicy === "reconcile" && tentativeMeta.size > 0) {
    reconcileRequests();
    // A holiday cell a revoked tentative request just vacated is still owed HOL.
    grantHolidayEntitlement();
  }
  // Any daily minimum still unmet (whatever the cause) gets one-level rearrangement.
  if (fillShift) repairCoverageByRearrange();

  // ── Card #73: re-check conditional availability rules on the finished grid ──
  // A rule like "AB only when CD is (not) working" is checked when AB is placed, but a
  // later step may place CD (or free CD) and break it. evaluateAvailability reads the grid
  // ONLY through isWorking, and every engine step except honored requests checked it before
  // placing, so an engine cell that reads unavailable now was broken by a later change.
  // Free the rule owner's cell when it is discretionary (STEP 4 makes it X; the audits below
  // report and score the gap), keep standing / follower cells with a warning, and never
  // touch human cells (locked, loaded, honored requests). Repeat until nothing is freed:
  // freeing AB can break "EF only when AB is working". Before the audits and STEP 4.
  recheckConditionalRules();

  // ── Card #175: leave only up to the pay-period target ──
  // Fixed hours (loaded cells, required coverage, HOL) can leave a person over target
  // even after STEP 0 put leave only on days they'd work. Turn this run's own leave
  // cells into X, latest first, while they are over by at least that day's hours —
  // never under target. Only cells this run placed (step "request-leave"): never a
  // loaded, locked or approval-placed cell, never a frozen earlier month.
  if (leavePolicy === "up-to-target" && offShift) trimLeaveToTarget(offShift);

  // ── Post-repair hours audit ──
  // Emit one warning per residual nonzero PP-hour deviation, AFTER the repair so
  // it reflects final state. Tag deviations driven by scarce-eligibility shifts
  // (tiny eligible pool, e.g. ICU/CARD) as structural — no legal rebalance exists
  // (Class 2: needs more eligible staff / a count change, not an engine fix).
  auditPayPeriodHours();

  // ── Coverage-shortfall audit ──
  // After all placement (incl. STEP 3b repair) but before STEP 4 day-off fill,
  // flag every date × shift whose staffing minimum is still unmet, classifying
  // WHY so a scheduler can tell an unavoidable leave-driven shortage (nothing to
  // do — flag and move on) from a fixable distribution bug. This generalizes the
  // old away-request-only check below; it inspects ALL shortfalls regardless of
  // whether a request is involved. Reporting only — no placement or schema change.
  for (const date of dates) {
    for (const st of shiftTypes) {
      if (st.isOffShift || st.isLeave) continue;
      const required = getRequiredCount(st, date);
      if (required <= 0) continue;
      const assigned = countCoverage(st.code, date);
      if (assigned >= required) continue;

      const elig = eligibleStaff(st, date);
      // An eligible body that's free to take the shift AND has pay-period hour
      // headroom is a FIXABLE gap — STEP 3 should have used it. Shouldn't occur
      // under current STEP 3 logic (defensive: if it fires, it signals a day-off
      // distribution bug — see Slice 1b in handoff #219).
      const hasFixableBody = elig.some(
        (p) => isAvailable(p, date, st) && !wouldBreakPPHours(p.id, date, st),
      );
      // A body that could otherwise cover, but is held by a human-approved/locked
      // cell (honored leave, honored shift request, or a pre-locked assignment).
      const blockedByApproved = elig.some((p) => {
        const cell = grid.get(`${p.id}:${date}`);
        if (!cell) return false;
        return cell.locked || cell.step === "request-leave" || cell.step === LEAVE_OFF_STEP || cell.step === "request-shift";
      });

      // Card #260: a free, under-cap person held off only by a Hard minimum gap.
      const gapBlocked = !hasFixableBody && gapHard(st) && elig.some(
        (p) => isAvailable(p, date, st, { skipGap: true }) && !wouldBreakPPHours(p.id, date, st),
      );
      const cause = hasFixableBody
        ? "fixable — an eligible, under-cap staff member is free this day (distribution gap)"
        : gapBlocked
          ? `everyone free to work it would break the minimum gap between two ${st.code} (at least ${gapOf(st)} days, Hard)`
          : blockedByApproved
          ? "limited by approved leave / locked assignments"
          : "true shortage — every eligible staff member is unavailable or already at their pay-period hour cap";
      warnings.push(`${date}: ${st.code} below its required minimum (${assigned}/${required}) — ${cause}`);
      // Raw coverage gap — counted for EVERY shortfall (the expanding re-solve needs
      // to see gaps that `hardBreaches` sanctions away when a locked cell blocks them).
      qCoverageShortfall += required - assigned;
      // `coverage` term: count the missing slots UNLESS the gap is sanctioned by a
      // human-approved leave / locked cell (#220: human-approved > coverage).
      if (!blockedByApproved) qCoverage += required - assigned;
    }
  }

  // ── STEP 4: Fill all remaining empty cells with X (day off) ──
  if (offShift) {
    for (const date of dates) {
      for (const staff of activeStaff) {
        if (!isAssigned(staff.id, date)) {
          // A day off left blank rather than break a Hard gap set on the off shift itself.
          if (hardGapBlocks(staff.id, offShift, [date])) continue;
          assign(staff.id, date, offShift, "Day off", "off", 0.95);
        }
      }
    }
  }

  // ── Check minimum targets (after all assignments are final) ──
  for (const staff of activeStaff) {
    if (!staff.shiftMinimumTargets || staff.shiftMinimumTargets.length === 0) continue;
    for (const target of staff.shiftMinimumTargets) {
      const st = stById.get(target.shiftTypeId);
      if (!st) continue;
      const ppRanges = payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate }));
      const checkedWindows = new Set<string>();

      for (const date of dates) {
        const bounds = getWindowBounds(target, date, ppRanges);
        if (!bounds) continue;
        const windowKey = `${bounds.start}:${bounds.end}`;
        if (checkedWindows.has(windowKey)) continue;
        checkedWindows.add(windowKey);

        const assigned: string[] = [];
        for (const [k, v] of grid.entries()) {
          if (k.startsWith(staff.id + ":") && v.code === st.code && !v.noCount) {
            const d = k.split(":")[1];
            if (d >= bounds.start && d <= bounds.end) assigned.push(d);
          }
        }
        const { met, current, needed } = checkMinimumTargetMet(target, assigned);
        // Soft (preference) targets are advisory-only — bias without warnings.
        if (!met && targetIsHard(target)) {
          warnings.push(`${staff.initials}: only ${current}/${needed} ${st.code} in ${target.window} (${bounds.start}..${bounds.end})`);
          qHardLimits += needed - current; // hardLimits: hard per-staff minimum shortfall
        }
      }

      // MIN is audited per fixed block above. MAX is a ROLLING cap
      // (isAtRollingMaximum), so audit it with the same rolling semantics — a
      // fixed-block count can't see a violation that straddles a block boundary,
      // nor one introduced by a locked / honored placement that bypassed
      // isAvailable. A date is flagged when some N-window span containing it holds
      // more than maxCount counting the OTHER placements.
      // Only HARD max caps are audited — a soft max is a penalty, not a violation.
      if (target.maxCount != null && targetIsHard(target)) {
        const placed: string[] = [];
        for (const [k, v] of grid.entries()) {
          if (k.startsWith(staff.id + ":") && v.code === st.code && !v.noCount) {
            placed.push(k.split(":")[1]);
          }
        }
        const overCap = placed
          .filter((d) => isAtRollingMaximum(target, d, placed.filter((x) => x !== d), ppRanges))
          .sort();
        if (overCap.length > 0) {
          const windowDesc =
            target.window === "days"
              ? `${target.windowDays}d`
              : `${(target.windowCount ?? 1) > 1 ? `${target.windowCount} ` : ""}${target.window}`;
          warnings.push(`${staff.initials}: ${st.code} exceeds max ${target.maxCount} per ${windowDesc} (rolling) — ${overCap.join(", ")}`);
          qHardLimits += overCap.length; // hardLimits: hard per-staff (rolling) MAX overage
        }
      }
    }
  }

  // ── Flag rule breaks caused by HONORING away requests (advisory) ──
  // Pre-placing an approved/honored leave or off shift is authoritative — it bypasses
  // availability and can push a day past its soft leave cap or strand a staffing
  // requirement. Surface both so the scheduler doesn't honor a request into a silently
  // broken day. Scoped to dates that actually carry a request-honored away placement
  // (step "request-leave", or "request-shift" landing on an off/leave shift).
  if (requestList.length > 0) {
    const requestAwayByDate = new Map<string, Set<string>>();
    for (const s of suggestions) {
      if (s.step !== "request-leave" && s.step !== LEAVE_OFF_STEP && s.step !== "request-shift") continue;
      if (!isAwayShift(s.shiftTypeId)) continue;
      let set = requestAwayByDate.get(s.date);
      if (!set) { set = new Set(); requestAwayByDate.set(s.date, set); }
      set.add(s.staffId);
    }

    const maxLeavePerDay = schedulingPreferences.maxLeavePerDay ?? 0;
    // Card #207: the configured holiday shift (by id) is not "away", under every holiday
    // policy — a persisted holiday cell reads the same as a fresh one.
    const holidayShiftIdForCap = schedulingPreferences.holidayShiftId ?? null;
    // Soft leave cap: count EVERY away assignment on the day, not just honored ones.
    // (Staffing minimums stranded by honored-away requests are now reported by the
    // generalized coverage-shortfall audit above, classified "limited by approved
    // leave / locked assignments".)
    if (maxLeavePerDay > 0) {
      for (const [date] of requestAwayByDate) {
        let awayTotal = 0;
        for (const [k, v] of grid.entries()) {
          // The holiday shift is hours credit, not an absence the cap is meant to limit — on a
          // holiday it would otherwise count every staffer. Keyed on the SHIFT, not
          // the placing step: a persisted HOL (existingAssignments carry no step)
          // must read the same on a re-run / Live re-solve as a fresh one.
          if (k.endsWith(`:${date}`) && isAwayShift(v.shiftTypeId) && v.shiftTypeId !== holidayShiftIdForCap) awayTotal++;
        }
        if (awayTotal > maxLeavePerDay) {
          warnings.push(`${date}: ${awayTotal} staff away exceeds the soft leave limit of ${maxLeavePerDay} (honoring away requests)`);
        }
      }
    }
  }

  // ── Assemble the global quality objective (#224 item 4, Slice 4a) ──
  // T2: non-human-approved REQUEST_SHIFTs (forced under the active policy) that the
  // final grid does NOT honor — the reconciliation outcome (#221). Same eligibility
  // filter as reconcileRequests so the two stay consistent.
  let qRequestsDenied = 0;
  for (const r of requestList) {
    if (r.kind !== "REQUEST_SHIFT" || r.strength !== "hard") continue;
    if (r.status === "approved" && r.autoApproved !== true) continue; // human-approved → authoritative, not scored
    if (r.status === "pending" && pendingMode !== "full") continue;
    if (r.status !== "approved" && r.status !== "pending") continue;
    // STEP 0b places one of the requested WORK shifts on EVERY covered date, and
    // reconcileRequests claims a slot per (shift, date) — so a multi-day request
    // wants the shift each day. Count denials PER covered date (a partially-honored
    // multi-day request still contributes its unfilled days), scoped to work shifts
    // (away placements aren't reconciled — that's #3, deferred).
    const wantWork = r.shiftTypeIds.filter((id) => {
      const st = stById.get(id);
      return !!st && !st.isLeave && !st.isOffShift;
    });
    if (wantWork.length === 0) continue;
    for (const date of dates) {
      if (!coversDate(r, date)) continue;
      const cell = grid.get(`${r.staffId}:${date}`);
      if (!cell || !wantWork.includes(cell.shiftTypeId)) qRequestsDenied++;
    }
  }

  // T3: evenness of the undesirable/desirable shift load across staff, measured on
  // the FINISHED grid (so it differentiates candidates — the input `fairness` is
  // history-based and identical across them). FTE-normalized desirability score per
  // staff, then its standard deviation: lower = more even = fairer.
  const desScores: number[] = [];
  for (const staff of activeStaff) {
    // Card #71: staff whose employment type is not in fairness never sway the equity spread.
    if (!staff.inFairness) continue;
    const fte = staff.ftePercentage > 0 ? staff.ftePercentage : 1;
    let des = 0;
    for (const date of dates) {
      const cell = grid.get(`${staff.id}:${date}`);
      if (!cell) continue;
      des += dwMap.get(`${cell.shiftTypeId}:${getDow(date)}`) ?? 0;
    }
    desScores.push(des / fte);
  }
  const desMean = desScores.reduce((s, v) => s + v, 0) / (desScores.length || 1);
  const desVar = desScores.reduce((s, v) => s + (v - desMean) ** 2, 0) / (desScores.length || 1);
  const qFairnessSpread = Math.round(Math.sqrt(desVar) * 1000) / 1000;

  const quality: ScheduleQuality = {
    breakdown: {
      coverage: qCoverage,
      hardLimits: qHardLimits,
      overHours: qOverHours,
      underHours: qUnderHours,
      requestsDenied: qRequestsDenied,
      fairnessSpread: qFairnessSpread,
      // Derived aggregate kept for the Slice-1 feasibility floor (redesigned in 2b).
      hardBreaches: qCoverage + qHardLimits,
      coverageShortfall: qCoverageShortfall,
    },
    rank: buildRankFromConfig(
      {
        coverage: qCoverage,
        hardLimits: qHardLimits,
        overHours: qOverHours,
        underHours: qUnderHours,
        requests: qRequestsDenied,
        fairness: qFairnessSpread,
      },
      factorOrder,
    ),
  };

  // Card #174 backstop: nothing before writableFrom ever leaves the engine.
  if (writableFrom) {
    for (let i = suggestions.length - 1; i >= 0; i--) if (isFrozen(suggestions[i].date)) suggestions.splice(i, 1);
  }

  // Card #177: name every soft-avoided pair the run placed (one side is an engine cell),
  // so the scheduler can see where the preference gave way.
  if (avoidSet.size > 0) {
    const placed = new Set(suggestions.map((x) => `${x.staffId}:${x.date}`));
    const seen = new Set<string>();
    const initialsOf = new Map(staff.map((p) => [p.id, p.initials]));
    for (const x of [...suggestions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.staffId < b.staffId ? -1 : 1))) {
      for (const first of [prevDate(x.date), x.date]) {
        const second = nextDate(first);
        const key = `${x.staffId}:${first}`;
        if (seen.has(key)) continue;
        const a = grid.get(`${x.staffId}:${first}`), b = grid.get(`${x.staffId}:${second}`);
        if (!a || !b || !isAvoidedPair(a.shiftTypeId, b.shiftTypeId)) continue;
        if (!placed.has(`${x.staffId}:${first}`) && !placed.has(`${x.staffId}:${second}`)) continue;
        seen.add(key);
        warnings.push(`${initialsOf.get(x.staffId) ?? x.staffId} ${second}: ${b.code} after ${a.code} (an avoided pair)`);
      }
    }
  }

  // Card #178: name a person whose marked shifts the run left bunched — 3+ in some 7 days
  // (one of them engine-placed) while a whole 7 days of the range holds none. Reads the
  // final grid, so frozen context and the days just across the range's edges count.
  if (spreadIds.size > 0 && dates.length > 0) {
    const first = [...dates].sort()[0], last = [...dates].sort()[dates.length - 1];
    const placedMarked = new Set(suggestions.filter((x) => spreadIds.has(x.shiftTypeId)).map((x) => `${x.staffId}:${x.date}`));
    const initialsOf = new Map(staff.map((p) => [p.id, p.initials]));
    const span = (from: string, n: number) => { const out = [from]; for (let i = 1; i < n; i++) out.push(nextDate(out[i - 1])); return out; };
    let start = first;
    for (let i = 0; i < 6; i++) start = prevDate(start);
    const starts: string[] = [];
    for (let d = start; d <= last; d = nextDate(d)) starts.push(d);
    for (const p of staff) {
      if (![...placedMarked].some((k) => k.startsWith(`${p.id}:`))) continue;
      const marked = (d: string) => spreadIds.has(grid.get(`${p.id}:${d}`)?.shiftTypeId ?? "");
      let busy: string[] | null = null, busyN = 0;
      for (const s0 of starts) {
        const w = span(s0, 7);
        const n = w.filter(marked).length;
        if (n > busyN && w.some((d) => placedMarked.has(`${p.id}:${d}`))) { busyN = n; busy = w; }
      }
      if (!busy || busyN < 3) continue;
      // The empty week must be one this run could still fill (inside the range, none of it frozen).
      const empty = starts.map((s0) => span(s0, 7)).find((w) => w[0] >= first && w[6] <= last && !isFrozen(w[0]) && !w.some(marked));
      if (!empty) continue;
      warnings.push(`${initialsOf.get(p.id) ?? p.id}: ${busyN} spread shifts in 7 days (${busy[0].slice(5)}..${busy[6].slice(5)}), none in ${empty[0].slice(5)}..${empty[6].slice(5)}`);
    }
  }

  // Card #260: every pair of the same shift closer than its minimum, for one person, with a day
  // in this run. Prefer: "wanted"; Hard: only ever two hand-entered/approved cells (the engine
  // never places one — an engine cell here is a bug, named so it is never silent).
  if (gapShifts.length > 0 && dates.length > 0) {
    const sorted = [...dates].sort();
    const first = sorted[0], last = sorted[sorted.length - 1];
    const placed = new Set(suggestions.map((x) => `${x.staffId}:${x.date}:${x.shiftTypeId}`));
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const fmt = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
    for (const st of gapShifts) {
      const n = gapOf(st);
      for (const p of staff) {
        for (const pair of gapBreaks(holdsAt(p.id, st.id), first, last, n)) {
          const [a, b] = pair.split("|");
          if (b < first || a > last) continue;
          const engine = placed.has(`${p.id}:${a}:${st.id}`) || placed.has(`${p.id}:${b}:${st.id}`);
          const why = gapHard(st)
            ? engine ? `at least ${n} required` : `at least ${n} required — both entered by hand`
            : engine ? `at least ${n} wanted` : `at least ${n} wanted — both entered by hand`;
          warnings.push(`${p.initials}: ${st.code} ${fmt(a)} and ${fmt(b)} are ${daysBetween(a, b)} days apart (${why})`);
        }
      }
    }
  }

  let balances: AutoScheduleResult["balances"];
  if (evenIds.size > 0) {
    balances = {};
    for (const stId of evenIds) {
      const b = evenBalance(stById.get(stId)!);
      balances[stId] = Object.fromEntries(activeIds.map((id) => [id, { run: b.run.get(id)!, carried: b.carried.get(id)! }]));
    }
  }

  return {
    suggestions,
    warnings,
    stats: {
      totalSlotsFilled: suggestions.length,
      byStep,
    },
    quality,
    ...(balances ? { balances } : {}),
  };
}

// One generated alternative: the seed that produced it plus its full result.
export type ScheduleCandidate = {
  seed: number;
  result: AutoScheduleResult;
};

// Canonical identity of a schedule's placement — order/reason/confidence-agnostic
// so two seeds that land the exact same assignments are recognized as the same
// candidate and de-duplicated.
function suggestionSetKey(suggestions: Suggestion[]): string {
  return suggestions
    .map((s) => `${s.staffId}|${s.date}|${s.shiftTypeId}`)
    .sort()
    .join(";");
}

// Multi-option candidate generation (Slice 4b). Runs the engine for seeds
// 0, 1, 2, … — seed 0 is the canonical schedule and is always included first —
// de-dups runs that collapse to the same placement (common when ties are rare),
// and returns up to `count` DISTINCT candidates ranked best-first by the global
// quality objective (Slice 4a). Pure + deterministic: same input+count ⇒ same list.
//
// FEASIBILITY FLOOR (Slice 2b-3 redesign, Codex #1779 C1/W1): the seeded tiebreak only
// reorders TRUE ties and never makes an individually-infeasible placement — but the
// engine is greedy, so a different tie-order can still change which slots go unfilled.
// We never surface a candidate that is strictly WORSE than canonical on the hard terms.
// Pre-2b that test was the aggregate `hardBreaches` (coverage + hardLimits). Now that an
// admin can rank coverage above hardLimits (and the builder will trade a hard MAX for
// coverage), a single aggregate would wrongly drop a candidate that trades one for the
// other. So the floor is a LEXICOGRAPHIC compare over just [coverage, hardLimits] IN THE
// CONFIGURED ORDER: drop only if strictly worse on that prefix; an equal prefix is kept
// and the full-objective sort below decides. This lets the sanctioned trade survive in
// whichever direction it's ranked while still hiding dominated options. Lower tiers
// (hours, requests, fairness) MAY vary — the trade-offs the compare/choose UI shows.
//
// `count` is the number of DISTINCT candidates wanted. We try a bounded budget of
// seeds to find them (a highly-constrained schedule may yield fewer distinct
// options than asked — the caller gets what genuinely exists). `attemptsPerWant`
// caps wasted runs when ties are scarce.
export function autoScheduleCandidates(
  input: AutoScheduleInput,
  count: number,
  attemptsPerWant = 6,
): ScheduleCandidate[] {
  const want = Math.max(1, Math.floor(count));
  const maxSeeds = want * attemptsPerWant + 1; // seeds 0 .. maxSeeds-1
  const seen = new Set<string>();
  const candidates: ScheduleCandidate[] = [];

  // The hard terms in the configured order (validated-or-default), the prefix the floor
  // compares lexicographically. With the default order this is ["hardLimits","coverage"].
  // A Prohibited hours row is a hard term too (it was moved to the front of the order).
  const prohibitedHours = new Set(
    (input.factorOrder ?? []).filter((f) => (f.key === "overHours" || f.key === "underHours") && parseHoursPolicy(f.hoursPolicy) === "prohibited").map((f) => f.key),
  );
  const hardPrefix = effectiveFactorKeys(input.factorOrder).filter(
    (k): k is "coverage" | "hardLimits" | "overHours" | "underHours" =>
      k === "coverage" || k === "hardLimits" || prohibitedHours.has(k),
  );
  const worseOnHardPrefix = (cand: ScheduleQuality, base: ScheduleQuality): boolean => {
    for (const k of hardPrefix) {
      const cv = cand.breakdown[k];
      const bv = base.breakdown[k];
      if (cv !== bv) return cv > bv; // first differing hard term decides
    }
    return false; // equal on the hard prefix → keep; lower tiers decide
  };

  // Canonical schedule (seed 0): always included; its hard-term prefix is the floor
  // every other candidate must match or beat.
  const canonical = autoSchedule({ ...input, seed: 0 });
  seen.add(suggestionSetKey(canonical.suggestions));
  candidates.push({ seed: 0, result: canonical });

  for (let seed = 1; seed < maxSeeds && candidates.length < want; seed++) {
    const result = autoSchedule({ ...input, seed });
    // Drop any candidate strictly worse than canonical on the hard-term prefix (a
    // perturbed tie-order stranded coverage/limits). Equal or better is kept; a
    // better-than-canonical run will simply rank ahead of seed 0 below.
    if (worseOnHardPrefix(result.quality, canonical.quality)) continue;
    const key = suggestionSetKey(result.suggestions);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ seed, result });
  }

  // Rank best-first by the lexicographic quality objective. Stable ties keep
  // lower seeds (incl. the canonical seed 0) ahead, so output is deterministic.
  candidates.sort((a, b) => compareScheduleQuality(a.result.quality, b.result.quality));
  return candidates;
}
