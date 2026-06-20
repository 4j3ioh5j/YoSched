import { computeFairness, type FairnessSummary, type EquityFactor } from "./fairness";
import { evaluateAvailability, getBaseWorkDays, type AvailabilityRule, type PayPeriodRange } from "./availability";
import { type FollowRuleRow, buildFollowRuleMap, isShiftAllowedAfter } from "./follow-rules";
import { evaluateShiftEligibility, getWindowBounds, countInWindow, checkMinimumTargetMet, isAtRollingMaximum, type ShiftEligibilityRule, type ShiftMinTarget } from "./shift-eligibility";
import { foldRequestsForDate, detectRequestConflicts, coversDate, type ScheduleRequestData, type FoldedRequests, type PendingRequestMode, type RequestConflictPolicy } from "./schedule-requests";
import { matchesWhen, standingToWhen } from "./recurrence";

export type ScheduleStaff = {
  id: string;
  initials: string;
  ftePercentage: number;
  eligibleShiftTypeIds: string[];
  availabilityRules: AvailabilityRule[];
  isActive: boolean;
  isAutoScheduled: boolean;
  specialQualifications: string[];
  shiftEligibilityRules?: ShiftEligibilityRule[];
  shiftMinimumTargets?: ShiftMinTarget[];
};

export type ScheduleShiftType = {
  id: string;
  code: string;
  name: string;
  defaultHours: number;
  countsTowardFte: boolean;
  countsOnWeekend: boolean;
  countsAsHolidayWork: boolean;
  isLeave: boolean;
  isOffShift: boolean;
  isFillShift: boolean;
  sortOrder: number; // configured display order; orders OR-request placement deterministically
  schedulePriority: number | null;
  weekendPaired: boolean;
  holidayWeekendPaired: boolean;
  ignoresWorkingDays: boolean;
  maxPerDay: number | null;
  category: string;

  autoSchedulable: boolean;
};

export type ScheduleAssignment = {
  staffId: string;
  date: string;
  shiftTypeId: string;
  code: string;
  isLocked: boolean;
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

type Holiday = { date: string };

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
};

// Resolved per-(staff,shiftType) hour override, split by day type.
export type ShiftHourOverride = { weekday: number; weekend: number };

type DayPreference = {
  staffId: string;
  dayOfWeek: number;
  preference: string;
};

type StaffingRequirement = {
  shiftCode: string;
  dayKey: string;
  minCount: number;
};

type SchedulingPreferences = {
  prefer3DayWeekends: boolean;
  prefer4DayWeekends: boolean;
  preferSequentialOff: boolean;
  sequentialOffWeight: number;
  threeDayWeekendWeight: number;
  fourDayWeekendWeight: number;
  pendingRequestMode?: PendingRequestMode; // how to treat PENDING requests; default "off"
  maxLeavePerDay?: number; // soft cap on staff away per day; 0/undefined = no cap (warn-only)
  requestConflictPolicy?: RequestConflictPolicy; // forced-request contention resolution; default "reconcile"
};

export type Suggestion = {
  staffId: string;
  date: string;
  shiftTypeId: string;
  code: string;
  reason: string;
  step: string;
  confidence: number;
};

export type AutoScheduleResult = {
  suggestions: Suggestion[];
  warnings: string[];
  stats: {
    totalSlotsFilled: number;
    byStep: Record<string, number>;
  };
};

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getDow(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

function isWeekend(dateStr: string): boolean {
  const d = getDow(dateStr);
  return d === 0 || d === 6;
}

// Hours a shift is worth for a staff on a given day type. A per-staff override
// can value the shift differently on weekdays vs weekends; with no override the
// shift's defaultHours applies regardless. `isWeekend` is required so every
// caller decides explicitly (capacity-bound callers without a single date take
// the max/min of both day types — see call sites).
export function getShiftHours(
  staffId: string,
  shiftType: ScheduleShiftType,
  overrides: Map<string, ShiftHourOverride>,
  isWeekend: boolean
): number {
  const ov = overrides.get(`${staffId}:${shiftType.id}`);
  if (!ov) return shiftType.defaultHours;
  return isWeekend ? ov.weekend : ov.weekday;
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
    // No single date here — this bounds capacity, so take the larger of the two
    // day types so a full-timer is never wrongly excluded from reaching target.
    const hrs = Math.max(
      getShiftHours(staff.id, st, overrides, false),
      getShiftHours(staff.id, st, overrides, true),
    );
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

// Find the combination of `count` dates from `candidates` that maximizes
// the minimum gap between any two selected dates (and optionally existing
// anchor dates like previously-assigned ORC shifts for the same staff).
export function bestSpread(
  candidates: string[],
  count: number,
  anchors: string[],
  isValid: (picked: string[], next: string) => boolean,
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
  dayPreferences,
  historicalAssignments,
  staffingRequirements,
  schedulingPreferences,
  equityFactors,
  followRules,
  scheduleRequests,
  requiredFollowers,
}: {
  dates: string[];
  staff: ScheduleStaff[];
  shiftTypes: ScheduleShiftType[];
  existingAssignments: ScheduleAssignment[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  desirabilityWeights: DesirabilityWeight[];
  standingCommitments: StandingCommitment[];
  staffOverrides: StaffOverride[];
  dayPreferences: DayPreference[];
  historicalAssignments: ScheduleAssignment[];
  staffingRequirements: StaffingRequirement[];
  schedulingPreferences: SchedulingPreferences;
  equityFactors: EquityFactor[];
  followRules?: FollowRuleRow[];
  scheduleRequests?: ScheduleRequestData[];
  requiredFollowers?: RequiredFollowerRow[];
}): AutoScheduleResult {
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

  // A working shift is anything that isn't an off-shift or a leave shift. A hard
  // OFF request forbids working shifts but still allows OFF / leave placement.
  function requestBlocksWork(staffId: string, date: string, st: ScheduleShiftType): boolean {
    if (requestList.length === 0) return false;
    const folded = foldFor(staffId, date);
    if (folded.forbidWorking && !st.isOffShift && !st.isLeave) return true;
    if (folded.forbiddenShiftIds.has(st.id)) return true;
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
    return bias;
  }

  const overrideMap = new Map<string, ShiftHourOverride>();
  for (const o of staffOverrides) {
    overrideMap.set(`${o.staffId}:${o.shiftTypeId}`, {
      weekday: o.durationHrsWeekday ?? o.durationHrs,
      weekend: o.durationHrsWeekend ?? o.durationHrs,
    });
  }

  // `noCount` marks a cell placed as a non-counting required follower: its worked
  // hours still count toward FTE, but it does NOT satisfy staffing requirements or
  // min/max targets for its shift (see countsTowardTargets).
  // `step` records the engine step that placed the cell (undefined for cells
  // loaded from existingAssignments). The hour-balancing repair (STEP 3b) reads
  // it to swap only scheduler-placed coverage/fill cells, never authoritative
  // placements (leave, standing commitments, honored requests, followers).
  const grid = new Map<string, { shiftTypeId: string; code: string; locked: boolean; noCount?: boolean; step?: string }>();
  for (const a of existingAssignments) {
    grid.set(`${a.staffId}:${a.date}`, {
      shiftTypeId: a.shiftTypeId,
      code: a.code,
      locked: a.isLocked,
    });
  }

  const activeStaff = staff.filter(
    (p) => p.isActive && p.isAutoScheduled
  );

  const dwMap = new Map<string, number>();
  for (const dw of desirabilityWeights) {
    dwMap.set(`${dw.shiftTypeId}:${dw.dayOfWeek}`, dw.weight);
  }

  const prefMap = new Map<string, string>();
  for (const dp of dayPreferences) {
    prefMap.set(`${dp.staffId}:${dp.dayOfWeek}`, dp.preference);
  }

  // Build staffing requirements lookup: shiftCode → Map<dayKey, minCount>
  const reqsByShift = new Map<string, Map<string, number>>();
  for (const sr of staffingRequirements) {
    if (sr.minCount <= 0) continue;
    let dayMap = reqsByShift.get(sr.shiftCode);
    if (!dayMap) {
      dayMap = new Map();
      reqsByShift.set(sr.shiftCode, dayMap);
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
      eligibleShiftTypeIds: p.eligibleShiftTypeIds,
    })),
    desirabilityWeights,
    holidays,
    equityFactors,
  });

  function getCell(staffId: string, date: string) {
    const cell = grid.get(`${staffId}:${date}`);
    if (cell && offShift && cell.shiftTypeId === offShift.id && !cell.locked) return undefined;
    return cell;
  }

  function isAssigned(staffId: string, date: string): boolean {
    const cell = grid.get(`${staffId}:${date}`);
    if (!cell) return false;
    if (offShift && cell.shiftTypeId === offShift.id && !cell.locked) return false;
    return true;
  }

  function isAvailable(staff: ScheduleStaff, date: string, st: ScheduleShiftType): boolean {
    if (isAssigned(staff.id, date)) return false;
    // Approved hard requests (OFF / NEGATE_SHIFT) gate every placement that flows
    // through isAvailable (staffing fills, minimum targets, FTE fill shift).
    if (requestBlocksWork(staff.id, date, st)) return false;
    if (staff.shiftEligibilityRules && staff.shiftEligibilityRules.length > 0) {
      const eligResult = evaluateShiftEligibility(
        staff.shiftEligibilityRules, st.id, date,
        payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate })),
      );
      if (eligResult !== null && !eligResult.eligible && !(eligResult.weight < 0 && eligResult.weight > -10)) return false;
    }
    if (!st.ignoresWorkingDays) {
      const avail = evaluateAvailability(
        staff.availabilityRules, date, payPeriods,
        (pid, d) => isAssigned(pid, d)
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
    if (st.maxPerDay != null && countAssigned(st.code, date) >= st.maxPerDay) return false;
    if (isAtMaximum(staff, st, date)) return false;
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
    const key = `${staffId}:${date}`;
    const existing = grid.get(key);
    if (existing && !(offShift && existing.shiftTypeId === offShift.id && !existing.locked)) return;
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
  function placeFollowerAfter(staffId: string, afterDate: string, sourceShift: ScheduleShiftType) {
    const spec = followerBySource.get(sourceShift.id);
    if (!spec) return;
    const next = nextDate(afterDate);
    if (!dateSet.has(next)) return; // follower would land outside the scheduling window
    const isWorkFollower = !spec.follower.isOffShift && !spec.follower.isLeave;
    const member = activeStaff.find((p) => p.id === staffId);
    if (!member) return;
    const warn = (why: string) => {
      if (isWorkFollower) warnings.push(`${member.initials}: could not place required ${spec.follower.code} after ${sourceShift.code} on ${next} (${why})`);
    };
    if (isAssigned(staffId, next)) { warn("cell already filled"); return; }
    const avail = evaluateAvailability(member.availabilityRules, next, payPeriods, (pid, d) => isAssigned(pid, d));
    if (!avail.available) { warn("staff unavailable"); return; }
    if (holidaySet.has(next) && isWorkFollower) { warn("holiday"); return; }
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
          const isWknd = isWeekend(d);
          if (!isWknd || st.countsOnWeekend) {
            hours += getShiftHours(staffId, st, overrideMap, isWknd);
          }
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
      if (date && p.shiftEligibilityRules && p.shiftEligibilityRules.length > 0) {
        const result = evaluateShiftEligibility(
          p.shiftEligibilityRules, st.id, date,
          payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate })),
        );
        if (result !== null) return result.eligible || (result.weight < 0 && result.weight > -10);
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
    const dayMap = reqsByShift.get(st.code);
    if (!dayMap) return 0;
    const dayKey = holidaySet.has(date) ? "holiday" : String(getDow(date));
    return dayMap.get(dayKey) ?? 0;
  }

  // Physical count of `code` cells on `date`, INCLUDING non-counting followers —
  // use for per-day caps (maxPerDay), where a follower still occupies a slot.
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

  function findPPForDate(date: string): PayPeriod | null {
    for (const pp of payPeriods) {
      if (date >= pp.startDate && date <= pp.endDate) return pp;
    }
    return null;
  }

  function wouldBreakPPHours(staffId: string, date: string, st: ScheduleShiftType): boolean {
    // An each_day follower (e.g. ORC→X) reliably drags one follower day — and its
    // hours — into the period per placement, so it's part of this projection.
    // each_run followers are shared across a run; their hours land via
    // ppHoursForStaff once placed, and Slice 2 refines their projection.
    const followerSpec = followerBySource.get(st.id);
    const eachDayFollower = followerSpec?.scope === "each_day" ? followerSpec : null;
    const hasFollowerDay = !!eachDayFollower;
    if (!st.countsTowardFte && !hasFollowerDay) return false;

    const followerDate = hasFollowerDay ? nextDate(date) : null;
    const followerPP = followerDate ? findPPForDate(followerDate) : null;
    const pp = st.countsTowardFte ? findPPForDate(date) : followerPP;
    if (!pp || !fillShift) return false;
    const staff = activeStaff.find((p) => p.id === staffId);
    if (!staff) return false;
    const target = pp.targetHours * staff.ftePercentage;
    if (target <= 0) return false;

    const sameFollowerPP = !!followerPP && followerPP.startDate === pp.startDate;
    const followerHrs = eachDayFollower && eachDayFollower.follower.countsTowardFte && sameFollowerPP
      ? getShiftHours(staffId, eachDayFollower.follower, overrideMap, followerDate ? isWeekend(followerDate) : false) : 0;
    const addHours = (st.countsTowardFte ? getShiftHours(staffId, st, overrideMap, isWeekend(date)) : 0) + followerHrs;
    const current = ppHoursForStaff(staffId, pp);
    if (current + addHours > target) return true;

    // Value each remaining open day at the staff's longest reachable shift, not
    // the short fill shift, so a full-timer who can still hit target via 12h/16h
    // shifts isn't wrongly excluded. Fall back to this staff's fill-shift hours
    // (override-aware) when no longer shift qualifies.
    // Generic per-open-day capacity estimate (no single date): take the larger
    // of the two day types so a reachable target isn't understated.
    const fillHrs = Math.max(
      getShiftHours(staffId, fillShift, overrideMap, false),
      getShiftHours(staffId, fillShift, overrideMap, true),
    );
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

    return hoursStillNeeded > 0 && maxFillable < hoursStillNeeded;
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
        (pid, d) => isAssigned(pid, d)
      );
      if (!avail.available) continue;
      if (holidaySet.has(date)) continue;

      if (member.shiftEligibilityRules && member.shiftEligibilityRules.length > 0) {
        const eligResult = evaluateShiftEligibility(
          member.shiftEligibilityRules, st.id, date, scPayPeriods,
        );
        if (eligResult !== null && !eligResult.eligible && !(eligResult.weight < 0 && eligResult.weight > -10)) continue;
      }

      if (isAtMaximum(member, st, date)) continue;
      // An approved hard OFF / NEGATE_SHIFT request overrides a standing
      // commitment (this path doesn't flow through isAvailable).
      if (requestBlocksWork(sc.staffId, date, st)) continue;

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
  // Sort priority: fewest-in-this-run → longest-gap-since-last → fewest-historical

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

  for (const st of scheduledShifts) {
    const eligible = eligibleStaff(st);
    const stepName = st.code.toLowerCase();

    // Per-shift tracking for even distribution within this run
    const runCount = new Map<string, number>();
    const lastRunDate = new Map<string, string>();
    for (const p of eligible) runCount.set(p.id, 0);

    function pickStaff(pool: ScheduleStaff[], date?: string): ScheduleStaff {
      // Option B: for shifts longer than the fill shift, prefer the staff whose
      // resulting PP hours land closest to their target (best fit), so scarce
      // long shifts (e.g. ORL=12h) go to whoever needs the extra hours to reach
      // target — not merely whoever is next in the even-distribution rotation.
      // This is ranked BELOW every hard/soft min/max + request signal AND below
      // even distribution (it only breaks ties among equally-distributed
      // candidates), so it can never concentrate a long shift on one person —
      // preserving the Slice-2 ORC even-distribution guarantee. Gated to long
      // shifts. It's the secondary lever; STEP 3b's repair pass is the guarantee.
      const fillHrsForFit = fillShift ? fillShift.defaultHours : 0;
      let fitMap: Map<string, number> | null = null;
      if (date && fillHrsForFit > 0 && st.defaultHours > fillHrsForFit) {
        const pp = findPPForDate(date);
        if (pp) {
          fitMap = new Map();
          for (const p of pool) {
            const target = pp.targetHours * p.ftePercentage;
            if (target <= 0) { fitMap.set(p.id, Infinity); continue; }
            const projected = ppHoursForStaff(p.id, pp) + getShiftHours(p.id, st, overrideMap, isWeekend(date));
            fitMap.set(p.id, Math.abs(target - projected));
          }
        }
      }
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
          // Soft request preference: a staff who prefers this shift sorts ahead of
          // one who's indifferent; one who soft-avoids it (or prefers off) behind.
          const biasA = requestBias(a.id, date, st);
          const biasB = requestBias(b.id, date, st);
          if (biasA !== biasB) return biasB - biasA;
        }
        const countDiff = (runCount.get(a.id) ?? 0) - (runCount.get(b.id) ?? 0);
        if (countDiff !== 0) return countDiff;
        // Option B best-fit (long shifts only): among equally-distributed
        // candidates, prefer whoever's post-assignment hours land closest to
        // target. Subordinate to even distribution so it never concentrates.
        if (fitMap) {
          const fitA = fitMap.get(a.id) ?? Infinity;
          const fitB = fitMap.get(b.id) ?? Infinity;
          if (fitA !== fitB) return fitA - fitB;
        }
        const lastA = lastRunDate.get(a.id) ?? "";
        const lastB = lastRunDate.get(b.id) ?? "";
        if (lastA !== lastB) return lastA.localeCompare(lastB);
        return historicalCount(a.id, st.code) - historicalCount(b.id, st.code);
      });
      return pool[0];
    }

    function recordAssignment(staffId: string, date: string) {
      runCount.set(staffId, (runCount.get(staffId) ?? 0) + 1);
      lastRunDate.set(staffId, date);
    }

    if (st.weekendPaired) {
      const saturdayDates = dates.filter((d) => getDow(d) === 6);

      for (const sat of saturdayDates) {
        const sun = nextDate(sat);
        const satRequired = getRequiredCount(st, sat);
        const sunRequired = getRequiredCount(st, sun);
        if (satRequired <= 0 && sunRequired <= 0) continue;
        if (!dateSet.has(sun)) continue;

        const satCount = countCoverage(st.code, sat);
        const sunCount = countCoverage(st.code, sun);
        if (satCount >= satRequired && sunCount >= sunRequired) continue;

        const available = eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
            isAvailable(p, sat, st) && isAvailable(p, sun, st) &&
            !wouldBreakPPHours(p.id, sat, st)
        );

        if (available.length === 0) {
          const fallback = eligible.filter(
            (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
              isAvailable(p, sat, st) && isAvailable(p, sun, st)
          );
          if (fallback.length === 0) {
            warnings.push(`No eligible ${st.code} staff for ${sat}/${sun}`);
            continue;
          }
          warnings.push(`${st.code} ${sat}/${sun}: all eligible staff would exceed PP hours`);
        }

        const pool = available.length > 0 ? available : eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
            isAvailable(p, sat, st) && isAvailable(p, sun, st)
        );
        if (pool.length === 0) continue;
        const chosen = pickStaff(pool, sat);
        assign(chosen.id, sat, st, `Weekend ${st.code} (even dist — ${chosen.initials})`, `weekend-${stepName}`, 0.8);
        if (!isAtMaximum(chosen, st, sun)) {
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
            (p) => !isAssigned(p.id, date) && isAvailable(p, date, st)
          );
        }
        if (available.length === 0) {
          warnings.push(`No eligible ${st.code} staff for holiday ${date}`);
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

          const usedDates = new Set<string>();

          // Find a COMPLETE group of `pairingFactor` legal, uncapped, well-spread
          // dates that `chosen` can take from `remainDates`, or null if they can't
          // host a full group. Returning a partial is intentionally impossible —
          // that is what used to leave a lone ORL (and a +4 overshoot).
          const completeGroupFor = (chosen: ScheduleStaff, remainDates: string[]): string[] | null => {
            const provAvailDates = remainDates
              .filter((d) => isAvailable(chosen, d, st))
              .sort((a, b) => a.localeCompare(b));
            if (provAvailDates.length < pairingFactor) return null;
            // Anchor dates: PP boundaries (push toward the middle) plus dates where
            // this staff already has other scheduled shifts in this PP.
            const anchorDates: string[] = [prevDate(pp.startDate), nextDate(pp.endDate)];
            for (const date of dates) {
              if (date < pp.startDate || date > pp.endDate) continue;
              const cell = getCell(chosen.id, date);
              if (cell && cell.code !== st.code && !stById.get(cell.shiftTypeId)?.isOffShift) anchorDates.push(date);
            }
            const violatesFollow = (picked: string[], candidate: string): boolean => {
              if (!followMap.has(st.id)) return false;
              for (const pd of picked) {
                if (nextDate(pd) === candidate && !isShiftAllowedAfter(followMap, st.id, st.id, st.isOffShift)) return true;
                if (prevDate(pd) === candidate && !isShiftAllowedAfter(followMap, st.id, st.id, st.isOffShift)) return true;
              }
              return false;
            };
            const picked = bestSpread(provAvailDates, pairingFactor, anchorDates, (p, c) => !violatesFollow(p, c))
              .filter((d) => !isAtMaximum(chosen, st, d));
            return picked.length >= pairingFactor ? picked.slice(0, pairingFactor) : null;
          };

          // Place COMPLETE groups only — never a partial. This keeps every staffer's
          // count of this shift a multiple of pairingFactor per PP (e.g. ORL is only
          // ever assigned in PAIRS), so a 12h ORL can't strand a full-timer at +4 over
          // an 8h-divisible target. If the best-fit staffer can't host a full group,
          // try the next; stop when no one can pair the remaining dates.
          while (true) {
            const remainDates = ppNeedDates.filter((d) => !usedDates.has(d));
            if (remainDates.length < pairingFactor) break;

            const hostable = eligible.filter((p) => remainDates.filter((d) => isAvailable(p, d, st)).length >= pairingFactor);
            // Prefer staff a full group does NOT push over their PP target (a hard
            // minimum overrides the cap); fall back to any hostable if none fit.
            const fits = hostable.filter((p) => {
              const target = pp.targetHours * p.ftePercentage;
              // The group spans pairingFactor of remainDates (weekday/weekend mix
              // not yet fixed); value each day at the larger day type so this cap
              // pre-check stays conservative and never overfills a staffer.
              const perDayHrs = Math.max(
                getShiftHours(p.id, st, overrideMap, false),
                getShiftHours(p.id, st, overrideMap, true),
              );
              const groupHrs = pairingFactor * perDayHrs;
              return !(target > 0 && ppHoursForStaff(p.id, pp) + groupHrs > target) || hasUnmetMinimum(p, st, remainDates[0]);
            });

            let placed = false;
            for (const tier of [fits, hostable]) {
              let poolList = [...tier];
              while (poolList.length > 0) {
                const chosen = pickStaff(poolList, remainDates[0]);
                const group = completeGroupFor(chosen, remainDates);
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
            let available = eligible.filter((p) => isAvailable(p, date, st) && (!wouldBreakPPHours(p.id, date, st) || hasUnmetMinimum(p, st, date)));
            if (available.length === 0) available = eligible.filter((p) => isAvailable(p, date, st));
            if (available.length === 0) {
              warnings.push(`No eligible ${st.code} staff for ${date} (unpaired remainder) in PP ${pp.startDate}`);
              continue;
            }
            const chosen = pickStaff([...available], date);
            const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
            assign(chosen.id, date, st, `${st.code} (unpaired remainder${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`, stepName, 0.7);
            recordAssignment(chosen.id, date);
            placeEachDayFollower(chosen.id, date, st);
          }
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
            (p) => isAvailable(p, date, st) &&
              (!wouldBreakPPHours(p.id, date, st) || hasUnmetMinimum(p, st, date))
          );
          if (available.length === 0) {
            available = eligible.filter((p) => isAvailable(p, date, st));
          }

          if (available.length === 0) {
            warnings.push(`No eligible ${st.code} staff for ${date}`);
            continue;
          }

          const dow = getDow(date);
          const preferred = available.filter(
            (p) => prefMap.get(`${p.id}:${dow}`) === st.code
          );

          let pool = preferred.length > 0 ? preferred : available;
          const desirability = dwMap.get(`${st.id}:${dow}`) ?? 0;

          for (let i = 0; i < needed; i++) {
            if (pool.length === 0) break;
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
        const candidateDates = windowDates.filter((d) =>
          !isAssigned(staff.id, d) && isAvailable(staff, d, st)
        );
        if (candidateDates.length === 0) {
          // Soft (preference) targets bias but never warn — only hard minimums do.
          if (targetIsHard(target)) {
            warnings.push(`${staff.initials}: no available days for ${st.code} min target in ${target.window} (${bounds.start}..${bounds.end})`);
          }
          continue;
        }

        for (const candidate of candidateDates) {
          if (countInWindow() >= target.minCount) break;
          // Rolling max is date-dependent: a candidate too close to an earlier
          // placement is capped, but a LATER one in this block may be fine — so
          // skip it and keep trying (respace) rather than abandoning the minimum.
          if (isAtMaximum(staff, st, candidate)) continue;
          // Soft (preference) targets respect pay-period hour protection — a
          // preference biases the mix but must never push a staffer past their
          // hours. Hard minimums intentionally override the cap (hasUnmetMinimum).
          if (!targetIsHard(target) && wouldBreakPPHours(staff.id, candidate, st)) continue;
          assign(
            staff.id, candidate, st,
            `${st.code} (min target: ${target.minCount}/${target.window === "pay_period" ? "PP" : target.window})`,
            "min-target", 0.75
          );
        }
      }
    }
  }

  // ── STEP 3: Fill shift to hit FTE hour targets (day-off clustering) ──

  // Records why STEP 3 couldn't lift a staff to target (key `staffId:ppStart` →
  // "days" = not enough available days / fill-divisibility, "max" = blocked by a
  // max-shift cap). The post-repair audit reads this so a residual shortfall is
  // reported with its real cause AND reflects the final (post-repair) state.
  const fillShortfallCause = new Map<string, string>();

  const holShift = shiftTypes.find((st) => st.code === "HOL" && st.countsTowardFte) ?? null;

  if (fillShift) {
    const sortedPPs = [...payPeriods]
      .filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const fillReqsByDay = new Map<string, number>();
    const fillReqs = reqsByShift.get(fillShift.code);
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
    const SOFT_REQUEST_OFF_WEIGHT = 5;

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

      for (const staff of sortedStaff) {
        const target = pp.targetHours * staff.ftePercentage;
        if (target <= 0) continue;

        const currentHours = ppHoursForStaff(staff.id, pp);
        if (currentHours >= target) continue;

        // Per-day estimate used to size how many fill days are needed (no single
        // date yet). Use the smaller day type so we never under-select fill days;
        // the assignment loop below stops at target using each day's real hours.
        const hoursPerDay = Math.min(
          getShiftHours(staff.id, fillShift, overrideMap, false),
          getShiftHours(staff.id, fillShift, overrideMap, true),
        );
        const hoursNeeded = target - currentHours;

        const availableDates = ppDates.filter((d) =>
          isAvailable(staff, d, fillShift)
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
          let bestScore = -Infinity;
          let comboCount = 0;

          for (const offIndices of combinations(indices, daysOff)) {
            comboCount++;
            let feasible = true;
            for (const idx of offIndices) {
              const date = availableDates[idx];
              const required = fillRequiredOnDate(date);
              if (required > 0 && fillStaffedCount(date) < required) {
                feasible = false;
                break;
              }
            }
            if (!feasible) continue;

            const offSet = new Set<string>(offIndices.map((i: number) => availableDates[i]));
            const score = scoreOffDays(offSet, availableDates, getBaseWorkDays(staff.availabilityRules))
              + softOffBonus(staff.id, offSet);
            if (score > bestScore) {
              bestScore = score;
              bestOffIndices = offIndices;
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
        for (const date of fillDates) {
          if (hours >= target) break;
          const shift = holidaySet.has(date) && holShift ? holShift : fillShift;
          // Rolling max is date-dependent — skip a capped date, keep trying later
          // ones. A residual shortfall is reported by the post-repair audit.
          if (isAtMaximum(staff, shift, date)) { cappedByMax = true; continue; }
          const shiftHrs = getShiftHours(staff.id, shift, overrideMap, isWeekend(date));
          assign(staff.id, date, shift,
            `${shift.code} to fill hours (${hours}/${target}hrs)`,
            "fill", 0.6);
          hours += shiftHrs;
        }
        if (cappedByMax && hours < target) {
          fillShortfallCause.set(`${staff.id}:${pp.startDate}`, "max");
        }
      }
    }
  }

  // Counted FTE hours a shift contributes for a staff on a date (honors the
  // weekend rule and per-staff overrides) — the unit the repair optimizes.
  function countedHrs(staffId: string, st: ScheduleShiftType, date: string): number {
    if (!st.countsTowardFte) return 0;
    const isWknd = isWeekend(date);
    if (isWknd && !st.countsOnWeekend) return 0;
    return getShiftHours(staffId, st, overrideMap, isWknd);
  }

  // Authoritative placements the repair must never disturb. Cells with no step
  // (loaded from existingAssignments), locked cells, and non-counting followers
  // are also excluded below.
  // "request-tentative" is excluded too: a tentatively-placed forced request is owned
  // by the reconciliation pass (which runs AFTER this repair). If STEP 3b were allowed
  // to swap a tentative cell's shift to another staff, reconciliation would never see
  // it — silently bypassing first-come ordering and the PP-cap revoke/backfill. The
  // repair therefore leaves tentative cells alone; reconcileRequests() resolves them.
  const NON_SWAPPABLE_STEPS = new Set(["request-leave", "request-shift", "request-tentative", "standing", "follower", "off"]);

  function isSwappableCell(cell: { shiftTypeId: string; locked: boolean; noCount?: boolean; step?: string }): boolean {
    if (cell.locked || cell.noCount || !cell.step || NON_SWAPPABLE_STEPS.has(cell.step)) return false;
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
      if (r !== null) eligible = r.eligible || (r.weight < 0 && r.weight > -10);
    }
    if (!eligible) return false;
    if (requestBlocksWork(staff.id, date, st)) return false;
    if (!st.ignoresWorkingDays) {
      const avail = evaluateAvailability(
        staff.availabilityRules, date, payPeriods, (pid, d) => isAssigned(pid, d)
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
          const target = pp.targetHours * p.ftePercentage;
          if (target <= 0) continue;
          dev.set(p.id, ppHoursForStaff(p.id, pp) - target);
        }

        type Swap = { aId: string; bId: string; date: string; aSt: ScheduleShiftType; bSt: ScheduleShiftType; gain: number; pref: number };
        let best: Swap | null = null;

        for (const date of ppDates) {
          const cells: { id: string; staff: ScheduleStaff; st: ScheduleShiftType }[] = [];
          for (const p of activeStaff) {
            if (!dev.has(p.id)) continue;
            const cell = grid.get(`${p.id}:${date}`);
            if (!cell || !isSwappableCell(cell)) continue;
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
              // Cheap reject before legality: only consider if it could beat best.
              if (best && gain < best.gain) continue;
              if (!canHoldForSwap(A.staff, B.st, date, ppRangesAll)) continue;
              if (!canHoldForSwap(B.staff, A.st, date, ppRangesAll)) continue;
              if (swapBreaksHardMin(A.staff, A.st, date, ppRangesAll)) continue;
              if (swapBreaksHardMin(B.staff, B.st, date, ppRangesAll)) continue;
              const pref = softPrefDelta(A.staff, B.st, A.st, date) + softPrefDelta(B.staff, A.st, B.st, date);
              if (!best || gain > best.gain || (gain === best.gain && pref > best.pref)) {
                best = { aId: A.id, bId: B.id, date, aSt: A.st, bSt: B.st, gain, pref };
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

  function auditPayPeriodHours(): void {
    const auditPPs = payPeriods.filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate));
    // Eligible-pool size per shift code among active auto-scheduled staff. A tiny
    // pool means coverage for that shift is structurally hard to balance.
    const SCARCE_POOL = 3;
    const poolByCode = new Map<string, number>();
    for (const st of shiftTypes) {
      let n = 0;
      for (const p of activeStaff) if (eligibleShiftSets.get(p.id)?.has(st.id)) n++;
      poolByCode.set(st.code, n);
    }
    for (const pp of auditPPs) {
      for (const staff of activeStaff) {
        const target = pp.targetHours * staff.ftePercentage;
        if (target <= 0) continue;
        const hours = ppHoursForStaff(staff.id, pp);
        const dev = Math.round(hours - target);
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
  if (fillShift) {
    repairPayPeriodHours();
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
    function fillCellAt(staffId: string, date: string) {
      const c = grid.get(`${staffId}:${date}`);
      return c && c.step === "fill" && !c.locked && !c.noCount ? c : null;
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

    // Drop a reclaimable fill cell (grid + suggestion + stat) so its slot can be reused.
    function releaseFill(staffId: string, date: string) {
      const fc = fillCellAt(staffId, date);
      if (!fc) return;
      grid.delete(`${staffId}:${date}`);
      const idx = suggestions.findIndex((s) => s.staffId === staffId && s.date === date && s.code === fc.code && s.step === "fill");
      if (idx >= 0) suggestions.splice(idx, 1);
      byStep["fill"] = Math.max(0, (byStep["fill"] ?? 0) - 1);
    }

    // Best backfill for a freed (st, date) slot: conflict-free claimants by first-come,
    // then the neediest non-claimant by remaining PP hours. excludeId = deferred holder.
    // Returns null when nothing can legally take the slot (Slice 1a then flags it).
    function pickBackfill(st: ScheduleShiftType, date: string, excludeId: string): ScheduleStaff | null {
      const recvByStaff = new Map<string, string>();
      for (const c of claimantsBySlot.get(`${st.id}:${date}`) ?? []) {
        const cur = recvByStaff.get(c.staffId);
        if (cur === undefined || c.receivedAt < cur) recvByStaff.set(c.staffId, c.receivedAt);
      }
      const pp = findPPForDate(date);
      const cands = eligibleStaff(st, date).filter((p) => p.id !== excludeId && canTake(p, date, st));
      if (cands.length === 0) return null;
      cands.sort((a, b) => {
        const ra = recvByStaff.get(a.id);
        const rb = recvByStaff.get(b.id);
        if (!!ra !== !!rb) return ra ? -1 : 1; // claimants before non-claimants
        if (ra && rb && ra !== rb) return ra < rb ? -1 : 1; // earlier receivedAt wins
        const defA = pp ? pp.targetHours * a.ftePercentage - ppHoursForStaff(a.id, pp) : 0;
        const defB = pp ? pp.targetHours * b.ftePercentage - ppHoursForStaff(b.id, pp) : 0;
        if (defA !== defB) return defB - defA; // neediest hours first
        return a.id.localeCompare(b.id);
      });
      return cands[0];
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

      // Over the requester's PP-hours cap WITH this cell? (cap is inviolable)
      const target = pp.targetHours * holder.ftePercentage;
      const holderOverCap = t.st.countsTowardFte && target > 0 && ppHoursForStaff(t.staffId, pp) > target;

      // Temporarily free the slot so challenger / backfill legality (incl. maxPerDay)
      // evaluates as if the holder weren't occupying it.
      grid.delete(key);

      // An EARLIER conflict-free claimant who should take the slot ahead of the holder.
      let challenger: ScheduleStaff | null = null;
      const sorted = (claimantsBySlot.get(`${t.st.id}:${t.date}`) ?? []).slice().sort(
        (a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.staffId.localeCompare(b.staffId)),
      );
      for (const c of sorted) {
        if (c.staffId === t.staffId || !(c.receivedAt < t.receivedAt)) continue;
        const cand = activeStaff.find((p) => p.id === c.staffId);
        if (cand && canTake(cand, t.date, t.st)) { challenger = cand; break; }
      }

      if (!holderOverCap && !challenger) {
        grid.set(key, cell); // rightful holder → confirm (restore)
        continue;
      }

      // Holder loses the slot: drop its suggestion, then award to the best claimant.
      const idx = suggestions.findIndex(
        (s) => s.staffId === t.staffId && s.date === t.date && s.code === t.st.code && s.step === "request-tentative",
      );
      if (idx >= 0) suggestions.splice(idx, 1);
      byStep["request-tentative"] = Math.max(0, (byStep["request-tentative"] ?? 0) - 1);

      const chosen = pickBackfill(t.st, t.date, t.staffId);
      const reason = holderOverCap ? "over pay-period hour cap" : "later than an earlier request";
      if (chosen) {
        releaseFill(chosen.id, t.date); // reclaim the chosen staff's fill day, if any
        assign(chosen.id, t.date, t.st, `Reconciliation: ${t.st.code} re-homed (first-come / hour need)`, "fill", 0.9);
        warnings.push(`${t.date}: deferred ${holder.initials}'s ${t.st.code} request (${reason}) — slot granted to ${chosen.initials}`);
      } else {
        warnings.push(`${t.date}: deferred ${holder.initials}'s ${t.st.code} request (${reason}) — no eligible backfill, slot left open`);
      }
    }
  }
  if (reconcilePolicy === "reconcile" && tentativeMeta.size > 0) {
    reconcileRequests();
  }

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
        return cell.locked || cell.step === "request-leave" || cell.step === "request-shift";
      });

      const cause = hasFixableBody
        ? "fixable — an eligible, under-cap staff member is free this day (distribution gap)"
        : blockedByApproved
          ? "limited by approved leave / locked assignments"
          : "true shortage — every eligible staff member is unavailable or already at their pay-period hour cap";
      warnings.push(`${date}: ${st.code} below its required minimum (${assigned}/${required}) — ${cause}`);
    }
  }

  // ── STEP 4: Fill all remaining empty cells with X (day off) ──
  if (offShift) {
    for (const date of dates) {
      for (const staff of activeStaff) {
        if (!isAssigned(staff.id, date)) {
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
      if (s.step !== "request-leave" && s.step !== "request-shift") continue;
      if (!isAwayShift(s.shiftTypeId)) continue;
      let set = requestAwayByDate.get(s.date);
      if (!set) { set = new Set(); requestAwayByDate.set(s.date, set); }
      set.add(s.staffId);
    }

    const maxLeavePerDay = schedulingPreferences.maxLeavePerDay ?? 0;
    // Soft leave cap: count EVERY away assignment on the day, not just honored ones.
    // (Staffing minimums stranded by honored-away requests are now reported by the
    // generalized coverage-shortfall audit above, classified "limited by approved
    // leave / locked assignments".)
    if (maxLeavePerDay > 0) {
      for (const [date] of requestAwayByDate) {
        let awayTotal = 0;
        for (const [k, v] of grid.entries()) {
          if (k.endsWith(`:${date}`) && isAwayShift(v.shiftTypeId)) awayTotal++;
        }
        if (awayTotal > maxLeavePerDay) {
          warnings.push(`${date}: ${awayTotal} staff away exceeds the soft leave limit of ${maxLeavePerDay} (honoring away requests)`);
        }
      }
    }
  }

  return {
    suggestions,
    warnings,
    stats: {
      totalSlotsFilled: suggestions.length,
      byStep,
    },
  };
}
