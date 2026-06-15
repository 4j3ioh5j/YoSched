import { FollowRuleMap, isShiftAllowedAfter } from "./follow-rules";
import { checkRequestConflict, type ScheduleRequestData } from "./schedule-requests";

export type Warning = {
  type:
    | "understaffed"
    | "post-shift"
    | "non-working-day"
    | "over-hours"
    | "under-hours"
    | "shift-count"
    | "request-violation";
  message: string;
};

// Pay-period hour divergence is treated as STRICT: any difference from the
// target fires. This epsilon only swallows floating-point noise (e.g. a target
// of 72.0000001), never a real over/under. Mute-key rounding (roundPPHours)
// uses the same precision so a muted alert stays muted across recomputation.
export const PP_HOURS_EPSILON = 0.001;

// Round a pay-period hour figure to the epsilon's precision (3 dp). Used for the
// human-facing message AND the value-bearing mute key, so both are deterministic.
export function roundPPHours(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type ShiftType = {
  id: string;
  code: string;
  defaultHours: number;
  countsTowardFte: boolean;
  isOffShift: boolean;
  ignoresWorkingDays: boolean;
};

type AvailabilityRuleData = {
  dayOfWeek: number;
  type: string;
  strength: string;
  pattern: string;
};

type Staff = {
  id: string;
  initials: string;
  ftePercentage: number;
  availabilityRules: AvailabilityRuleData[];
};

type PayPeriod = {
  startDate: string;
  endDate: string;
  targetHours: number;
};

type StaffingMinimum = {
  role: string;
  dayType: string;
  minimumCount: number;
};

type StaffingRequirement = {
  shiftCode: string;
  dayKey: string;
  minCount: number;
};

type AssignmentLookup = {
  get(key: string): { shiftTypeId: string; code: string } | undefined;
};

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

function prevDateStr(dateStr: string): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

function nextDateStr(dateStr: string): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

function getDayType(dateStr: string, holidaySet: Set<string>): string {
  if (holidaySet.has(dateStr)) return "holiday";
  const dow = parseDate(dateStr).getDay();
  return dow === 0 || dow === 6 ? "weekend" : "weekday";
}

export function checkCellWarnings({
  staffId,
  date,
  shiftTypeId,
  staff,
  shiftTypeMap,
  assignmentMap,
  allStaff,
  holidaySet,
  staffingMins,
  followRuleMap,
  scheduleRequests,
}: {
  staffId: string;
  date: string;
  shiftTypeId: string | null;
  staff: Staff;
  shiftTypeMap: Map<string, ShiftType>;
  assignmentMap: AssignmentLookup;
  allStaff: Staff[];
  holidaySet: Set<string>;
  staffingMins: StaffingMinimum[];
  followRuleMap?: FollowRuleMap;
  scheduleRequests?: ScheduleRequestData[]; // approved requests for this staff (optional)
}): Warning[] {
  const warnings: Warning[] = [];
  if (!shiftTypeId) return warnings;

  const st = shiftTypeMap.get(shiftTypeId);
  if (!st) return warnings;

  const dow = parseDate(date).getDay();

  // Non-working day
  const hasWorkRule = staff.availabilityRules.some(
    (r) => r.dayOfWeek === dow && r.type === "available" && r.strength === "rule"
  );
  if (!hasWorkRule && !st.isOffShift && !st.ignoresWorkingDays) {
    warnings.push({
      type: "non-working-day",
      message: `${staff.initials} doesn't normally work on ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]}s`,
    });
  }

  // Follow rules: check if PREVIOUS day's shift restricts what can follow
  const prevDate = prevDateStr(date);
  const prevAssignment = assignmentMap.get(`${staffId}:${prevDate}`);
  if (prevAssignment && followRuleMap) {
    const prevSt = shiftTypeMap.get(prevAssignment.shiftTypeId);
    if (prevSt && !isShiftAllowedAfter(followRuleMap, prevAssignment.shiftTypeId, shiftTypeId!, st.isOffShift)) {
      warnings.push({
        type: "post-shift",
        message: `${st.code} cannot follow ${prevSt.code} — ${staff.initials} had ${prevSt.code} yesterday`,
      });
    }
  }

  // Follow rules: check if THIS shift restricts what can follow and NEXT day violates it
  if (followRuleMap?.has(shiftTypeId!)) {
    const nextDate = nextDateStr(date);
    const nextAssignment = assignmentMap.get(`${staffId}:${nextDate}`);
    if (nextAssignment) {
      const nextSt = shiftTypeMap.get(nextAssignment.shiftTypeId);
      if (nextSt && !isShiftAllowedAfter(followRuleMap, shiftTypeId!, nextAssignment.shiftTypeId, nextSt.isOffShift)) {
        warnings.push({
          type: "post-shift",
          message: `${nextSt.code} cannot follow ${st.code} — ${staff.initials} has ${nextSt.code} tomorrow`,
        });
      }
    }
  }

  // Schedule requests: flag where this assignment contradicts an approved hard
  // request (off / leave / negated shift / wanted-a-different-shift).
  if (scheduleRequests && scheduleRequests.length > 0) {
    const conflicts = checkRequestConflict({
      requests: scheduleRequests,
      staffId,
      date,
      assignedShiftTypeId: shiftTypeId,
      isOffShift: st.isOffShift,
      codeOf: (id) => shiftTypeMap.get(id)?.code ?? id,
    });
    for (const c of conflicts) {
      warnings.push({ type: "request-violation", message: c.message });
    }
  }

  return warnings;
}

export function checkDayStaffing({
  date,
  staff,
  assignmentMap,
  shiftTypeMap,
  holidaySet,
  staffingMins,
  staffingReqs,
}: {
  date: string;
  staff: Staff[];
  assignmentMap: AssignmentLookup;
  shiftTypeMap: Map<string, ShiftType>;
  holidaySet: Set<string>;
  staffingMins: StaffingMinimum[];
  staffingReqs?: StaffingRequirement[];
}): Warning[] {
  const warnings: Warning[] = [];
  const dayType = getDayType(date, holidaySet);
  const dow = parseDate(date).getDay();

  function isOff(a: { shiftTypeId: string }): boolean {
    return shiftTypeMap.get(a.shiftTypeId)?.isOffShift ?? false;
  }

  if (staffingReqs && staffingReqs.length > 0) {
    const dayKey = holidaySet.has(date) ? "holiday" : String(dow);

    const shiftCounts = new Map<string, number>();
    for (const p of staff) {
      const a = assignmentMap.get(`${p.id}:${date}`);
      if (a && !isOff(a)) {
        shiftCounts.set(a.code, (shiftCounts.get(a.code) || 0) + 1);
      }
    }

    for (const req of staffingReqs) {
      if (req.dayKey !== dayKey) continue;
      if (req.minCount <= 0) continue;
      const actual = shiftCounts.get(req.shiftCode) || 0;
      if (actual < req.minCount) {
        warnings.push({
          type: actual === 0 ? "shift-count" : "understaffed",
          message: `${actual}/${req.minCount} ${req.shiftCode} (${dayType})`,
        });
      }
    }
  }

  // Legacy staffing minimums (total staff count across tracked shifts)
  for (const min of staffingMins) {
    if (min.dayType !== dayType) continue;
    let staffed = 0;
    for (const p of staff) {
      const a = assignmentMap.get(`${p.id}:${date}`);
      if (a && !isOff(a)) staffed++;
    }
    if (staffed < min.minimumCount) {
      warnings.push({
        type: "understaffed",
        message: `${staffed}/${min.minimumCount} ${min.role} staffed (${dayType})`,
      });
    }
  }

  return warnings;
}

// Flag a staff member whose scheduled hours diverge from their pay-period target
// in EITHER direction. Strict: any non-noise difference fires (see PP_HOURS_EPSILON).
// `target = pp.targetHours * ftePercentage` — must match the grid's PP Totals row.
export function checkStaffPPHours({
  staff,
  pp,
  currentHours,
}: {
  staffId?: string; // accepted for call-site symmetry; not used
  staff: Staff;
  pp: PayPeriod | null;
  currentHours: number;
}): Warning | null {
  if (!pp) return null;
  const target = pp.targetHours * staff.ftePercentage;
  if (target <= 0) return null;
  const diff = currentHours - target;
  if (Math.abs(diff) <= PP_HOURS_EPSILON) return null;
  const over = diff > 0;
  const hrs = roundPPHours(currentHours);
  const tgt = roundPPHours(target);
  const d = roundPPHours(diff);
  return {
    type: over ? "over-hours" : "under-hours",
    message: `${staff.initials}: ${hrs}/${tgt}hrs this pay period (${over ? "+" : ""}${d})`,
  };
}
