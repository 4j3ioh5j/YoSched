import { computeFairness, type FairnessSummary, type EquityFactor } from "./fairness";
import { evaluateAvailability, getBaseWorkDays, type AvailabilityRule, type PayPeriodRange } from "./availability";
import { type FollowRuleRow, buildFollowRuleMap, isShiftAllowedAfter } from "./follow-rules";
import { evaluateShiftEligibility, getWindowBounds, countInWindow, checkMinimumTargetMet, type ShiftEligibilityRule, type ShiftMinTarget } from "./shift-eligibility";
import { foldRequestsForDate, detectRequestConflicts, type ScheduleRequestData, type FoldedRequests, type PendingRequestMode } from "./schedule-requests";

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
  dayOfWeek: number | null;
  frequency: string;
};

type StaffOverride = {
  staffId: string;
  shiftTypeId: string;
  durationHrs: number;
};

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

function getShiftHours(
  staffId: string,
  shiftType: ScheduleShiftType,
  overrides: Map<string, number>
): number {
  const key = `${staffId}:${shiftType.id}`;
  return overrides.get(key) ?? shiftType.defaultHours;
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
  overrides: Map<string, number>
): number {
  let max = 0;
  for (const st of shiftTypes) {
    if (!staff.eligibleShiftTypeIds.includes(st.id)) continue;
    if (!st.countsTowardFte || st.isOffShift || st.isLeave || !st.autoSchedulable) continue;
    const hrs = getShiftHours(staff.id, st, overrides);
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

  const overrideMap = new Map<string, number>();
  for (const o of staffOverrides) {
    overrideMap.set(`${o.staffId}:${o.shiftTypeId}`, o.durationHrs);
  }

  // `noCount` marks a cell placed as a non-counting required follower: its worked
  // hours still count toward FTE, but it does NOT satisfy staffing requirements or
  // min/max targets for its shift (see countsTowardTargets).
  const grid = new Map<string, { shiftTypeId: string; code: string; locked: boolean; noCount?: boolean }>();
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
    grid.set(key, { shiftTypeId: shiftType.id, code: shiftType.code, locked: false, noCount });
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
            hours += getShiftHours(staffId, st, overrideMap);
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

  function getMinimumDeficit(staff: ScheduleStaff, st: ScheduleShiftType, date: string): number {
    if (!staff.shiftMinimumTargets || staff.shiftMinimumTargets.length === 0) return 0;
    const targets = staff.shiftMinimumTargets.filter((t) => t.shiftTypeId === st.id);
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

  function isAtMaximum(staff: ScheduleStaff, st: ScheduleShiftType, date: string): boolean {
    if (!staff.shiftMinimumTargets || staff.shiftMinimumTargets.length === 0) return false;
    const targets = staff.shiftMinimumTargets.filter((t) => t.shiftTypeId === st.id && t.maxCount != null);
    if (targets.length === 0) return false;

    for (const target of targets) {
      const bounds = getWindowBounds(
        target, date,
        payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate })),
      );
      if (!bounds) continue;

      let count = 0;
      for (const [k, v] of grid.entries()) {
        if (k.startsWith(staff.id + ":") && v.code === st.code && !v.noCount) {
          const d = k.split(":")[1];
          if (d >= bounds.start && d <= bounds.end) count++;
        }
      }
      if (count >= target.maxCount!) return true;
    }
    return false;
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
      ? getShiftHours(staffId, eachDayFollower.follower, overrideMap) : 0;
    const addHours = (st.countsTowardFte ? getShiftHours(staffId, st, overrideMap) : 0) + followerHrs;
    const current = ppHoursForStaff(staffId, pp);
    if (current + addHours > target) return true;

    // Value each remaining open day at the staff's longest reachable shift, not
    // the short fill shift, so a full-timer who can still hit target via 12h/16h
    // shifts isn't wrongly excluded. Fall back to this staff's fill-shift hours
    // (override-aware) when no longer shift qualifies.
    const fillHrs = getShiftHours(staffId, fillShift, overrideMap);
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
          assign(staff.id, date, st, `Approved shift request: ${st.code}`, "request-shift", 1.0);
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
  for (const sc of standingCommitments) {
    const st = stById.get(sc.shiftTypeId);
    if (!st || !st.autoSchedulable) continue;
    const member = staff.find((p) => p.id === sc.staffId);
    if (!member?.isActive) continue;

    for (const date of dates) {
      if (isAssigned(sc.staffId, date)) continue;
      const dow = getDow(date);

      if (sc.dayOfWeek !== null && sc.dayOfWeek !== dow) continue;
      if (sc.frequency === "weekly" || sc.dayOfWeek === null) {
        const avail = evaluateAvailability(
          member.availabilityRules, date, payPeriods,
          (pid, d) => isAssigned(pid, d)
        );
        if (!avail.available) continue;
        if (holidaySet.has(date)) continue;

        if (member.shiftEligibilityRules && member.shiftEligibilityRules.length > 0) {
          const eligResult = evaluateShiftEligibility(
            member.shiftEligibilityRules, st.id, date,
            payPeriods.map((pp) => ({ startDate: pp.startDate, endDate: pp.endDate })),
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
      pool.sort((a, b) => {
        if (date) {
          const defA = getMinimumDeficit(a, st, date);
          const defB = getMinimumDeficit(b, st, date);
          if (defA !== defB) return defB - defA;
          // Soft request preference: below hard minimum need, above even-
          // distribution. A staff who prefers this shift sorts ahead of one
          // who's indifferent; one who soft-avoids it (or prefers off) sorts behind.
          const biasA = requestBias(a.id, date, st);
          const biasB = requestBias(b.id, date, st);
          if (biasA !== biasB) return biasB - biasA;
        }
        const countDiff = (runCount.get(a.id) ?? 0) - (runCount.get(b.id) ?? 0);
        if (countDiff !== 0) return countDiff;
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

          const numGroups = Math.floor(ppNeedDates.length / pairingFactor);
          const usedDates = new Set<string>();

          for (let g = 0; g < numGroups; g++) {
            const remainDates = ppNeedDates.filter(d => !usedDates.has(d));

            let available = eligible.filter(p => {
              const provAvail = remainDates.filter(d => isAvailable(p, d, st));
              if (provAvail.length < pairingFactor) return false;
              const groupHrs = pairingFactor * getShiftHours(p.id, st, overrideMap);
              const currentHrs = ppHoursForStaff(p.id, pp);
              const target = pp.targetHours * p.ftePercentage;
              if (target > 0 && currentHrs + groupHrs > target) return false;
              return true;
            });

            if (available.length === 0) {
              available = eligible.filter(p => {
                const provAvail = remainDates.filter(d => isAvailable(p, d, st));
                return provAvail.length >= pairingFactor;
              });
            }

            if (available.length === 0) {
              warnings.push(`No eligible ${st.code} staff for group ${g + 1} in PP ${pp.startDate}`);
              continue;
            }

            const chosen = pickStaff([...available], remainDates[0]);
            const provAvailDates = remainDates.filter(d => isAvailable(chosen, d, st));
            provAvailDates.sort((a, b) => a.localeCompare(b));

            // Anchor dates: PP boundaries (so shifts push toward the middle)
            // plus dates where this staff already has other scheduled
            // shifts in this PP (e.g., ORC + recovery day).
            const anchorDates: string[] = [
              prevDate(pp.startDate),
              nextDate(pp.endDate),
            ];
            for (const date of dates) {
              if (date < pp.startDate || date > pp.endDate) continue;
              const cell = getCell(chosen.id, date);
              if (cell && cell.code !== st.code && !stById.get(cell.shiftTypeId)?.isOffShift) {
                anchorDates.push(date);
              }
            }

            function wouldViolateFollowRules(picked: string[], candidate: string): boolean {
              if (!followMap.has(st.id)) return false;
              for (const pd of picked) {
                if (nextDate(pd) === candidate && !isShiftAllowedAfter(followMap, st.id, st.id, st.isOffShift)) return true;
                if (prevDate(pd) === candidate && !isShiftAllowedAfter(followMap, st.id, st.id, st.isOffShift)) return true;
              }
              return false;
            }

            const pickedDates = bestSpread(
              provAvailDates,
              pairingFactor,
              anchorDates,
              (picked, candidate) => !wouldViolateFollowRules(picked, candidate),
            );

            if (pickedDates.length < pairingFactor) {
              warnings.push(`Could only place ${pickedDates.length}/${pairingFactor} ${st.code} for ${chosen.initials} in PP ${pp.startDate}`);
            }

            const assignedDates: string[] = [];
            for (const date of pickedDates) {
              if (isAtMaximum(chosen, st, date)) break;
              const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
              assign(
                chosen.id, date, st,
                `${st.code} (paired dist${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
                stepName, 0.7
              );
              usedDates.add(date);
              assignedDates.push(date);

              placeEachDayFollower(chosen.id, date, st);
            }
            for (const date of assignedDates) {
              recordAssignment(chosen.id, date);
            }
          }

          // Remainder dates that couldn't form a complete group (partial PP)
          const leftoverDates = ppNeedDates.filter(d => !usedDates.has(d));
          for (const date of leftoverDates) {
            let available = eligible.filter(
              p => isAvailable(p, date, st) && !wouldBreakPPHours(p.id, date, st)
            );
            if (available.length === 0) {
              available = eligible.filter(p => isAvailable(p, date, st));
            }
            if (available.length === 0) {
              warnings.push(`No eligible ${st.code} staff for ${date} (partial PP)`);
              continue;
            }
            const chosen = pickStaff([...available], date);
            const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
            assign(
              chosen.id, date, st,
              `${st.code} (partial PP${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
              stepName, 0.7
            );
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
            (p) => isAvailable(p, date, st) && !wouldBreakPPHours(p.id, date, st)
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
          warnings.push(`${staff.initials}: no available days for ${st.code} min target in ${target.window} (${bounds.start}..${bounds.end})`);
          continue;
        }

        for (const candidate of candidateDates) {
          if (countInWindow() >= target.minCount) break;
          if (isAtMaximum(staff, st, candidate)) break;
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

        const hoursPerDay = getShiftHours(staff.id, fillShift, overrideMap);
        const hoursNeeded = target - currentHours;

        const availableDates = ppDates.filter((d) =>
          isAvailable(staff, d, fillShift)
        );

        if (availableDates.length === 0) {
          if (hoursNeeded > 0) {
            warnings.push(`${staff.initials}: needs ${hoursNeeded}hrs but no available days in PP ${pp.startDate}`);
          }
          continue;
        }

        if (availableDates.length * hoursPerDay < hoursNeeded) {
          warnings.push(
            `${staff.initials}: cannot reach ${target}hrs — max ${currentHours + availableDates.length * hoursPerDay}hrs with ${availableDates.length} days`
          );
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
          if (isAtMaximum(staff, shift, date)) { cappedByMax = true; break; }
          const shiftHrs = getShiftHours(staff.id, shift, overrideMap);
          assign(staff.id, date, shift,
            `${shift.code} to fill hours (${hours}/${target}hrs)`,
            "fill", 0.6);
          hours += shiftHrs;
        }
        if (cappedByMax && hours < target) {
          warnings.push(`${staff.initials}: ${hours}/${target}hrs in PP ${pp.startDate} — capped by max shift limit`);
        }
      }
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
        if (!met) {
          warnings.push(`${staff.initials}: only ${current}/${needed} ${st.code} in ${target.window} (${bounds.start}..${bounds.end})`);
        }
        if (target.maxCount != null && assigned.length > target.maxCount) {
          warnings.push(`${staff.initials}: ${assigned.length}/${target.maxCount} max ${st.code} in ${target.window} (${bounds.start}..${bounds.end})`);
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
    for (const [date, awaySet] of requestAwayByDate) {
      // (a) soft leave cap: count EVERY away assignment on the day, not just honored ones.
      if (maxLeavePerDay > 0) {
        let awayTotal = 0;
        for (const [k, v] of grid.entries()) {
          if (k.endsWith(`:${date}`) && isAwayShift(v.shiftTypeId)) awayTotal++;
        }
        if (awayTotal > maxLeavePerDay) {
          warnings.push(`${date}: ${awayTotal} staff away exceeds the soft leave limit of ${maxLeavePerDay} (honoring away requests)`);
        }
      }
      // (b) staffing minimum stranded because an eligible staff was honored away.
      for (const st of shiftTypes) {
        if (st.isOffShift || st.isLeave) continue;
        const required = getRequiredCount(st, date);
        if (required <= 0) continue;
        const assigned = countCoverage(st.code, date);
        if (assigned >= required) continue;
        const eligIds = new Set(eligibleStaff(st, date).map((p) => p.id));
        if ([...awaySet].some((id) => eligIds.has(id))) {
          warnings.push(`${date}: honoring away requests left ${st.code} below its required minimum (${assigned}/${required})`);
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
