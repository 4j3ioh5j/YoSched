import { FollowRuleMap, isShiftAllowedAfter } from "./follow-rules";

export type Warning = {
  type: "understaffed" | "post-shift" | "non-working-day" | "over-hours" | "shift-count";
  message: string;
};

type ShiftType = {
  id: string;
  code: string;
  defaultHours: number;
  countsTowardFte: boolean;
  postShiftRule: string | null;
  isOffShift: boolean;
  ignoresWorkingDays: boolean;
  noConsecutiveGroup: string | null;
};

type AvailabilityRuleData = {
  dayOfWeek: number;
  type: string;
  strength: string;
  pattern: string;
};

type Provider = {
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
  providerId,
  date,
  shiftTypeId,
  provider,
  shiftTypeMap,
  assignmentMap,
  providers,
  holidaySet,
  staffingMins,
  followRuleMap,
}: {
  providerId: string;
  date: string;
  shiftTypeId: string | null;
  provider: Provider;
  shiftTypeMap: Map<string, ShiftType>;
  assignmentMap: AssignmentLookup;
  providers: Provider[];
  holidaySet: Set<string>;
  staffingMins: StaffingMinimum[];
  followRuleMap?: FollowRuleMap;
}): Warning[] {
  const warnings: Warning[] = [];
  if (!shiftTypeId) return warnings;

  const st = shiftTypeMap.get(shiftTypeId);
  if (!st) return warnings;

  const dow = parseDate(date).getDay();

  // Non-working day
  const hasWorkRule = provider.availabilityRules.some(
    (r) => r.dayOfWeek === dow && r.type === "available" && r.strength === "rule"
  );
  if (!hasWorkRule && !st.isOffShift && !st.ignoresWorkingDays) {
    warnings.push({
      type: "non-working-day",
      message: `${provider.initials} doesn't normally work on ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]}s`,
    });
  }

  // Follow rules: check if PREVIOUS day's shift restricts what can follow
  const prevDate = prevDateStr(date);
  const prevAssignment = assignmentMap.get(`${providerId}:${prevDate}`);
  if (prevAssignment && followRuleMap) {
    const prevSt = shiftTypeMap.get(prevAssignment.shiftTypeId);
    if (prevSt && !isShiftAllowedAfter(followRuleMap, prevAssignment.shiftTypeId, shiftTypeId!, st.isOffShift)) {
      warnings.push({
        type: "post-shift",
        message: `${st.code} cannot follow ${prevSt.code} — ${provider.initials} had ${prevSt.code} yesterday`,
      });
    }
  }

  // Follow rules: check if THIS shift restricts what can follow and NEXT day violates it
  if (followRuleMap?.has(shiftTypeId!)) {
    const nextDate = nextDateStr(date);
    const nextAssignment = assignmentMap.get(`${providerId}:${nextDate}`);
    if (nextAssignment) {
      const nextSt = shiftTypeMap.get(nextAssignment.shiftTypeId);
      if (nextSt && !isShiftAllowedAfter(followRuleMap, shiftTypeId!, nextAssignment.shiftTypeId, nextSt.isOffShift)) {
        warnings.push({
          type: "post-shift",
          message: `${nextSt.code} cannot follow ${st.code} — ${provider.initials} has ${nextSt.code} tomorrow`,
        });
      }
    }
  }

  // No back-to-back: check if previous or next day has a shift in the same restriction group
  if (st.noConsecutiveGroup) {
    const pd = prevDateStr(date);
    const pa = assignmentMap.get(`${providerId}:${pd}`);
    if (pa) {
      const pst = shiftTypeMap.get(pa.shiftTypeId);
      if (pst?.noConsecutiveGroup === st.noConsecutiveGroup) {
        warnings.push({
          type: "post-shift",
          message: `Back-to-back ${pst.code} and ${st.code} — ${provider.initials} had ${pst.code} yesterday`,
        });
      }
    }
    const nd = nextDateStr(date);
    const na = assignmentMap.get(`${providerId}:${nd}`);
    if (na) {
      const nst = shiftTypeMap.get(na.shiftTypeId);
      if (nst?.noConsecutiveGroup === st.noConsecutiveGroup) {
        warnings.push({
          type: "post-shift",
          message: `Back-to-back ${st.code} and ${nst.code} — ${provider.initials} has ${nst.code} tomorrow`,
        });
      }
    }
  }

  return warnings;
}

export function checkDayStaffing({
  date,
  providers,
  assignmentMap,
  shiftTypeMap,
  holidaySet,
  staffingMins,
  staffingReqs,
}: {
  date: string;
  providers: Provider[];
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
    for (const p of providers) {
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
    for (const p of providers) {
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

export function checkProviderPPHours({
  providerId,
  provider,
  pp,
  currentHours,
}: {
  providerId: string;
  provider: Provider;
  pp: PayPeriod | null;
  currentHours: number;
}): Warning | null {
  if (!pp) return null;
  const target = pp.targetHours * provider.ftePercentage;
  if (target <= 0) return null;
  if (currentHours > target * 1.05) {
    return {
      type: "over-hours",
      message: `${provider.initials}: ${currentHours}/${target}hrs this pay period`,
    };
  }
  return null;
}
