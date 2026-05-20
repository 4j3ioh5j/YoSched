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
};

type Provider = {
  id: string;
  initials: string;
  ftePercentage: number;
  workingDays: number[];
  takesCall: boolean;
  takesLate: boolean;
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
}): Warning[] {
  const warnings: Warning[] = [];
  if (!shiftTypeId) return warnings;

  const st = shiftTypeMap.get(shiftTypeId);
  if (!st) return warnings;

  const dow = parseDate(date).getDay();

  // Non-working day
  if (!provider.workingDays.includes(dow) && !st.isOffShift && !st.ignoresWorkingDays) {
    warnings.push({
      type: "non-working-day",
      message: `${provider.initials} doesn't normally work on ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]}s`,
    });
  }

  // Post-shift rule: check if PREVIOUS day had a shift with day_off_after
  const prevDate = prevDateStr(date);
  const prevAssignment = assignmentMap.get(`${providerId}:${prevDate}`);
  if (prevAssignment) {
    const prevSt = shiftTypeMap.get(prevAssignment.shiftTypeId);
    if (prevSt?.postShiftRule === "day_off_after" && !st.isOffShift) {
      warnings.push({
        type: "post-shift",
        message: `Should be off — ${provider.initials} had ${prevSt.code} yesterday`,
      });
    }
  }

  // Post-shift rule: check if THIS assignment has day_off_after and NEXT day is not off
  if (st.postShiftRule === "day_off_after") {
    const nextDate = nextDateStr(date);
    const nextAssignment = assignmentMap.get(`${providerId}:${nextDate}`);
    if (nextAssignment) {
      const nextSt = shiftTypeMap.get(nextAssignment.shiftTypeId);
      if (nextSt && !nextSt.isOffShift) {
        warnings.push({
          type: "post-shift",
          message: `${st.code} requires day off after — ${provider.initials} is scheduled ${nextSt.code} tomorrow`,
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
