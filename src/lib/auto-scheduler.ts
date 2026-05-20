import { computeFairness, type FairnessSummary } from "./fairness";

export type ScheduleProvider = {
  id: string;
  initials: string;
  employmentType: string;
  ftePercentage: number;
  takesCall: boolean;
  takesLate: boolean;
  workingDays: number[];
  isActive: boolean;
  specialQualifications: string[];
};

export type ScheduleShiftType = {
  id: string;
  code: string;
  name: string;
  defaultHours: number;
  countsTowardFte: boolean;
  countsOnWeekend: boolean;
  isLeave: boolean;
  isOffShift: boolean;
  isFillShift: boolean;
  schedulePriority: number | null;
  weekendPaired: boolean;
  ignoresWorkingDays: boolean;
  eligibilityRule: string | null;
  category: string;
  postShiftRule: string | null;
};

export type ScheduleAssignment = {
  providerId: string;
  date: string;
  shiftTypeId: string;
  code: string;
  isLocked: boolean;
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
  providerId: string;
  shiftTypeId: string;
  dayOfWeek: number | null;
  frequency: string;
};

type ProviderOverride = {
  providerId: string;
  shiftTypeId: string;
  durationHrs: number;
};

type DayPreference = {
  providerId: string;
  dayOfWeek: number;
  preference: string;
};

type StaffingRequirement = {
  shiftCode: string;
  dayKey: string;
  minCount: number;
};

export type Suggestion = {
  providerId: string;
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
  providerId: string,
  shiftType: ScheduleShiftType,
  overrides: Map<string, number>
): number {
  const key = `${providerId}:${shiftType.id}`;
  return overrides.get(key) ?? shiftType.defaultHours;
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

export function autoSchedule({
  dates,
  providers,
  shiftTypes,
  existingAssignments,
  payPeriods,
  holidays,
  desirabilityWeights,
  standingCommitments,
  providerOverrides,
  dayPreferences,
  historicalAssignments,
  staffingRequirements,
}: {
  dates: string[];
  providers: ScheduleProvider[];
  shiftTypes: ScheduleShiftType[];
  existingAssignments: ScheduleAssignment[];
  payPeriods: PayPeriod[];
  holidays: Holiday[];
  desirabilityWeights: DesirabilityWeight[];
  standingCommitments: StandingCommitment[];
  providerOverrides: ProviderOverride[];
  dayPreferences: DayPreference[];
  historicalAssignments: ScheduleAssignment[];
  staffingRequirements: StaffingRequirement[];
}): AutoScheduleResult {
  const suggestions: Suggestion[] = [];
  const warnings: string[] = [];
  const byStep: Record<string, number> = {};

  const holidaySet = new Set(holidays.map((h) => h.date));
  const dateSet = new Set(dates);

  const stByCode = new Map<string, ScheduleShiftType>();
  const stById = new Map<string, ScheduleShiftType>();
  for (const st of shiftTypes) {
    stByCode.set(st.code, st);
    stById.set(st.id, st);
  }

  const offShift = shiftTypes.find((st) => st.isOffShift);

  const overrideMap = new Map<string, number>();
  for (const o of providerOverrides) {
    overrideMap.set(`${o.providerId}:${o.shiftTypeId}`, o.durationHrs);
  }

  const grid = new Map<string, { shiftTypeId: string; code: string; locked: boolean }>();
  for (const a of existingAssignments) {
    grid.set(`${a.providerId}:${a.date}`, {
      shiftTypeId: a.shiftTypeId,
      code: a.code,
      locked: a.isLocked,
    });
  }

  const activeProviders = providers.filter(
    (p) => p.isActive && p.employmentType === "fte"
  );

  const dwMap = new Map<string, number>();
  for (const dw of desirabilityWeights) {
    dwMap.set(`${dw.shiftTypeId}:${dw.dayOfWeek}`, dw.weight);
  }

  const prefMap = new Map<string, string>();
  for (const dp of dayPreferences) {
    prefMap.set(`${dp.providerId}:${dp.dayOfWeek}`, dp.preference);
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
      providerId: a.providerId,
      date: a.date,
      shiftType: (() => {
        const st = stById.get(a.shiftTypeId);
        return {
          id: a.shiftTypeId,
          code: a.code,
          defaultHours: st?.defaultHours ?? 0,
          countsTowardFte: st?.countsTowardFte ?? false,
          isLeave: st?.isLeave ?? false,
        };
      })(),
    })),
    providers: providers.map((p) => ({
      id: p.id,
      initials: p.initials,
      employmentType: p.employmentType,
      ftePercentage: p.ftePercentage,
      takesCall: p.takesCall,
      takesLate: p.takesLate,
      isActive: p.isActive,
    })),
    desirabilityWeights,
    holidays,
  });

  function getCell(providerId: string, date: string) {
    return grid.get(`${providerId}:${date}`);
  }

  function isAssigned(providerId: string, date: string): boolean {
    return grid.has(`${providerId}:${date}`);
  }

  function isAvailable(provider: ScheduleProvider, date: string, st: ScheduleShiftType): boolean {
    if (isAssigned(provider.id, date)) return false;
    if (!st.ignoresWorkingDays) {
      const dow = getDow(date);
      if (!provider.workingDays.includes(dow)) return false;
    }
    const prev = getCell(provider.id, prevDate(date));
    if (prev) {
      const prevSt = stById.get(prev.shiftTypeId);
      if (prevSt?.postShiftRule === "day_off_after") return false;
    }
    return true;
  }

  function assign(
    providerId: string,
    date: string,
    shiftType: ScheduleShiftType,
    reason: string,
    step: string,
    confidence: number
  ) {
    const key = `${providerId}:${date}`;
    if (grid.has(key)) return;
    grid.set(key, { shiftTypeId: shiftType.id, code: shiftType.code, locked: false });
    suggestions.push({
      providerId,
      date,
      shiftTypeId: shiftType.id,
      code: shiftType.code,
      reason,
      step,
      confidence,
    });
    byStep[step] = (byStep[step] || 0) + 1;
  }

  function ppHoursForProvider(providerId: string, pp: PayPeriod): number {
    let hours = 0;
    const cur = new Date(pp.startDate + "T12:00:00");
    const end = new Date(pp.endDate + "T12:00:00");
    while (cur <= end) {
      const d = toDateStr(cur);
      const cell = getCell(providerId, d);
      if (cell) {
        const st = stById.get(cell.shiftTypeId);
        if (st?.countsTowardFte) {
          const isWknd = isWeekend(d);
          if (!isWknd || st.countsOnWeekend) {
            hours += getShiftHours(providerId, st, overrideMap);
          }
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return hours;
  }

  function fairnessScore(providerId: string): number {
    return fairness.deviations.get(providerId)?.overall ?? 0;
  }

  function sortByFairness(pIds: string[]): string[] {
    return [...pIds].sort((a, b) => fairnessScore(a) - fairnessScore(b));
  }

  function eligibleProviders(st: ScheduleShiftType): ScheduleProvider[] {
    if (!st.eligibilityRule) return activeProviders;
    return activeProviders.filter((p) => {
      if (st.eligibilityRule === "takesCall") return p.takesCall;
      if (st.eligibilityRule === "takesLate") return p.takesLate;
      return true;
    });
  }

  function getRequiredCount(st: ScheduleShiftType, date: string): number {
    const dayMap = reqsByShift.get(st.code);
    if (!dayMap) return 0;
    const dayKey = holidaySet.has(date) ? "holiday" : String(getDow(date));
    return dayMap.get(dayKey) ?? 0;
  }

  function countAssigned(code: string, date: string): number {
    let count = 0;
    for (const [k, v] of grid.entries()) {
      if (k.endsWith(`:${date}`) && v.code === code) count++;
    }
    return count;
  }

  // ── STEP 1: Apply standing commitments ──
  for (const sc of standingCommitments) {
    const st = stById.get(sc.shiftTypeId);
    if (!st) continue;
    const provider = providers.find((p) => p.id === sc.providerId);
    if (!provider?.isActive) continue;

    for (const date of dates) {
      if (isAssigned(sc.providerId, date)) continue;
      const dow = getDow(date);

      if (sc.dayOfWeek !== null && sc.dayOfWeek !== dow) continue;
      if (sc.frequency === "weekly" || sc.dayOfWeek === null) {
        if (!provider.workingDays.includes(dow)) continue;
        if (isWeekend(date) || holidaySet.has(date)) continue;

        assign(
          sc.providerId,
          date,
          st,
          `Standing commitment: ${st.code}`,
          "standing",
          0.9
        );
      }
    }
  }

  // ── STEP 2: Fill staffing requirements (data-driven) ──
  // Get all shift types that have a schedulePriority and are not fill shifts
  const scheduledShifts = shiftTypes
    .filter((st) => st.schedulePriority != null && !st.isFillShift && !st.isOffShift)
    .sort((a, b) => (a.schedulePriority ?? 0) - (b.schedulePriority ?? 0));

  for (const st of scheduledShifts) {
    const eligible = eligibleProviders(st);
    const stepName = st.code.toLowerCase();

    if (st.weekendPaired) {
      // Paired weekend scheduling: assign same provider to Sat+Sun
      const saturdayDates = dates.filter((d) => getDow(d) === 6);

      for (const sat of saturdayDates) {
        const sun = nextDate(sat);
        const satRequired = getRequiredCount(st, sat);
        const sunRequired = getRequiredCount(st, sun);
        if (satRequired <= 0 && sunRequired <= 0) continue;
        if (!dateSet.has(sun)) continue;

        const satCount = countAssigned(st.code, sat);
        const sunCount = countAssigned(st.code, sun);
        if (satCount >= satRequired && sunCount >= sunRequired) continue;

        const available = eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun)
        );

        if (available.length === 0) {
          warnings.push(`No eligible ${st.code} provider for ${sat}/${sun}`);
          continue;
        }

        const sorted = sortByFairness(available.map((p) => p.id));
        const chosen = sorted[0];
        const provider = providers.find((p) => p.id === chosen)!;

        assign(chosen, sat, st, `Weekend ${st.code} (fairness pick — ${provider.initials} is underloaded)`, `weekend-${stepName}`, 0.8);
        assign(chosen, sun, st, `Weekend ${st.code} (fairness pick — ${provider.initials} is underloaded)`, `weekend-${stepName}`, 0.8);
      }

      // Also fill holiday requirements for paired shifts
      for (const date of dates) {
        if (!holidaySet.has(date) || isWeekend(date)) continue;
        const required = getRequiredCount(st, date);
        if (required <= 0) continue;
        const current = countAssigned(st.code, date);
        if (current >= required) continue;

        const available = eligible.filter((p) => !isAssigned(p.id, date));
        if (available.length === 0) {
          warnings.push(`No eligible ${st.code} provider for holiday ${date}`);
          continue;
        }

        const sorted = sortByFairness(available.map((p) => p.id));
        const chosen = sorted[0];
        const provider = providers.find((p) => p.id === chosen)!;
        assign(chosen, date, st, `Holiday ${st.code} (fairness pick — ${provider.initials})`, `holiday-${stepName}`, 0.8);
      }
    } else {
      // Standard per-day scheduling
      for (const date of dates) {
        const required = getRequiredCount(st, date);
        if (required <= 0) continue;

        const current = countAssigned(st.code, date);
        if (current >= required) continue;

        const needed = required - current;
        const available = eligible.filter((p) => isAvailable(p, date, st));

        if (available.length === 0) {
          warnings.push(`No eligible ${st.code} provider for ${date}`);
          continue;
        }

        const dow = getDow(date);
        const preferred = available.filter(
          (p) => prefMap.get(`${p.id}:${dow}`) === st.code
        );

        const pool = preferred.length > 0 ? preferred : available;
        const sorted = sortByFairness(pool.map((p) => p.id));
        const desirability = dwMap.get(`${st.id}:${dow}`) ?? 0;

        for (let i = 0; i < needed && i < sorted.length; i++) {
          const chosen = sorted[i];
          const provider = providers.find((p) => p.id === chosen)!;

          assign(
            chosen,
            date,
            st,
            `${st.code} (fairness${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
            stepName,
            0.7
          );

          if (st.postShiftRule === "day_off_after" && offShift) {
            const next = nextDate(date);
            if (dateSet.has(next) && !isAssigned(chosen, next)) {
              assign(chosen, next, offShift, `Day off after ${st.code}`, `${stepName}-recovery`, 0.95);
            }
          }
        }
      }
    }
  }

  // ── STEP 3: Fill shift to hit FTE hour targets ──
  const fillShift = shiftTypes.find((st) => st.isFillShift);
  if (fillShift) {
    const sortedPPs = [...payPeriods]
      .filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    for (const pp of sortedPPs) {
      const ppDates = dates.filter(
        (d) =>
          d >= pp.startDate &&
          d <= pp.endDate &&
          !isWeekend(d) &&
          !holidaySet.has(d)
      );

      for (const provider of activeProviders) {
        const target = pp.targetHours * provider.ftePercentage;
        if (target <= 0) continue;

        let currentHours = ppHoursForProvider(provider.id, pp);
        if (currentHours >= target) continue;

        const availableDates = ppDates.filter((d) =>
          isAvailable(provider, d, fillShift)
        );

        for (const date of availableDates) {
          if (currentHours >= target) break;

          const hours = getShiftHours(provider.id, fillShift, overrideMap);
          assign(
            provider.id,
            date,
            fillShift,
            `${fillShift.code} to fill hours (${currentHours}/${target}hrs)`,
            "fill",
            0.6
          );
          currentHours += hours;
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
