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
  noConsecutiveGroup: string | null;
  maxPerDay: number | null;
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

type SchedulingPreferences = {
  prefer3DayWeekends: boolean;
  prefer4DayWeekends: boolean;
  preferSequentialOff: boolean;
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
  schedulingPreferences,
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
  schedulingPreferences: SchedulingPreferences;
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
      if (st.noConsecutiveGroup && prevSt?.noConsecutiveGroup === st.noConsecutiveGroup) return false;
    }
    const next = getCell(provider.id, nextDate(date));
    if (next) {
      const nextSt = stById.get(next.shiftTypeId);
      if (st.noConsecutiveGroup && nextSt?.noConsecutiveGroup === st.noConsecutiveGroup) return false;
    }
    if (st.maxPerDay != null && countAssigned(st.code, date) >= st.maxPerDay) return false;
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

  function findPPForDate(date: string): PayPeriod | null {
    for (const pp of payPeriods) {
      if (date >= pp.startDate && date <= pp.endDate) return pp;
    }
    return null;
  }

  function wouldBreakPPHours(providerId: string, date: string, st: ScheduleShiftType): boolean {
    if (!st.countsTowardFte) return false;
    const pp = findPPForDate(date);
    if (!pp || !fillShift) return false;
    const provider = activeProviders.find((p) => p.id === providerId);
    if (!provider) return false;
    const target = pp.targetHours * provider.ftePercentage;
    if (target <= 0) return false;

    const addHours = getShiftHours(providerId, st, overrideMap);
    const current = ppHoursForProvider(providerId, pp);
    if (current + addHours > target) return true;

    // Check if taking this shift + its recovery day leaves enough fill days to hit target
    const fillHrs = getShiftHours(providerId, fillShift, overrideMap);
    let maxFillHrsPerDay = fillHrs;
    for (const sub of shiftTypes) {
      if (!sub.countsTowardFte || sub.isLeave || sub.isOffShift || sub.isFillShift) continue;
      if (sub.category !== "work" || sub.defaultHours <= maxFillHrsPerDay) continue;
      if (sub.schedulePriority == null || sub.postShiftRule) continue;
      if (sub.eligibilityRule === "takesCall" && !provider.takesCall) continue;
      if (sub.eligibilityRule === "takesLate" && !provider.takesLate) continue;
      maxFillHrsPerDay = sub.defaultHours;
    }
    let assignedDays = 0;
    let availDays = 0;
    const cur = new Date(pp.startDate + "T12:00:00");
    const end = new Date(pp.endDate + "T12:00:00");
    while (cur <= end) {
      const d = toDateStr(cur);
      const dow = cur.getDay();
      if (provider.workingDays.includes(dow) && !holidaySet.has(d)) {
        if (isAssigned(providerId, d)) assignedDays++;
        else availDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }

    // This shift consumes 1 day (+ 1 recovery if applicable)
    let daysConsumed = 1;
    if (st.postShiftRule === "day_off_after") daysConsumed = 2;
    const remainingAvail = availDays - daysConsumed;
    const hoursAfterAssign = current + addHours;
    const hoursStillNeeded = target - hoursAfterAssign;
    const maxFillable = remainingAvail * maxFillHrsPerDay;

    return hoursStillNeeded > 0 && maxFillable < hoursStillNeeded;
  }

  const fillShift = shiftTypes.find((st) => st.isFillShift) ?? null;

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
        if (holidaySet.has(date)) continue;

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

  // ── STEP 2: Fill staffing requirements (even distribution + equity tiebreak) ──
  //
  // For each shift type, distribute assignments evenly across eligible providers
  // within this scheduling run. Historical per-shift equity only breaks ties when
  // multiple providers have the same count — it never causes one person to absorb
  // all the burden just because they're historically underloaded.
  //
  // Sort priority: fewest-in-this-run → longest-gap-since-last → fewest-historical

  const scheduledShifts = shiftTypes
    .filter((st) => st.schedulePriority != null && !st.isFillShift && !st.isOffShift)
    .sort((a, b) => (a.schedulePriority ?? 0) - (b.schedulePriority ?? 0));

  const historicalShiftCounts = new Map<string, Record<string, number>>();
  for (const m of fairness.metrics) {
    historicalShiftCounts.set(m.providerId, m.shiftCounts);
  }

  function historicalCount(providerId: string, shiftCode: string): number {
    return historicalShiftCounts.get(providerId)?.[shiftCode] ?? 0;
  }

  for (const st of scheduledShifts) {
    const eligible = eligibleProviders(st);
    const stepName = st.code.toLowerCase();

    // Per-shift tracking for even distribution within this run
    const runCount = new Map<string, number>();
    const lastRunDate = new Map<string, string>();
    for (const p of eligible) runCount.set(p.id, 0);

    function pickProvider(pool: ScheduleProvider[]): ScheduleProvider {
      pool.sort((a, b) => {
        const countDiff = (runCount.get(a.id) ?? 0) - (runCount.get(b.id) ?? 0);
        if (countDiff !== 0) return countDiff;
        const lastA = lastRunDate.get(a.id) ?? "";
        const lastB = lastRunDate.get(b.id) ?? "";
        if (lastA !== lastB) return lastA.localeCompare(lastB);
        return historicalCount(a.id, st.code) - historicalCount(b.id, st.code);
      });
      return pool[0];
    }

    function recordAssignment(providerId: string, date: string) {
      runCount.set(providerId, (runCount.get(providerId) ?? 0) + 1);
      lastRunDate.set(providerId, date);
    }

    if (st.weekendPaired) {
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

        function noGroupConflict(providerId: string, sat: string, sun: string): boolean {
          if (!st.noConsecutiveGroup) return true;
          const fri = prevDate(sat);
          const mon = nextDate(sun);
          const friCell = getCell(providerId, fri);
          if (friCell) {
            const friSt = stById.get(friCell.shiftTypeId);
            if (friSt?.noConsecutiveGroup === st.noConsecutiveGroup) return false;
          }
          const monCell = getCell(providerId, mon);
          if (monCell) {
            const monSt = stById.get(monCell.shiftTypeId);
            if (monSt?.noConsecutiveGroup === st.noConsecutiveGroup) return false;
          }
          return true;
        }

        const available = eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
            noGroupConflict(p.id, sat, sun) &&
            !wouldBreakPPHours(p.id, sat, st)
        );

        if (available.length === 0) {
          const fallback = eligible.filter(
            (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
              noGroupConflict(p.id, sat, sun)
          );
          if (fallback.length === 0) {
            warnings.push(`No eligible ${st.code} provider for ${sat}/${sun}`);
            continue;
          }
          warnings.push(`${st.code} ${sat}/${sun}: all eligible providers would exceed PP hours`);
        }

        const pool = available.length > 0 ? available : eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun)
        );
        if (pool.length === 0) continue;
        const chosen = pickProvider(pool);
        assign(chosen.id, sat, st, `Weekend ${st.code} (even dist — ${chosen.initials})`, `weekend-${stepName}`, 0.8);
        assign(chosen.id, sun, st, `Weekend ${st.code} (even dist — ${chosen.initials})`, `weekend-${stepName}`, 0.8);
        recordAssignment(chosen.id, sat);
      }

      for (const date of dates) {
        if (!holidaySet.has(date) || isWeekend(date)) continue;
        const required = getRequiredCount(st, date);
        if (required <= 0) continue;
        const current = countAssigned(st.code, date);
        if (current >= required) continue;

        let available = eligible.filter(
          (p) => !isAssigned(p.id, date) && !wouldBreakPPHours(p.id, date, st)
        );
        if (available.length === 0) {
          available = eligible.filter((p) => !isAssigned(p.id, date));
        }
        if (available.length === 0) {
          warnings.push(`No eligible ${st.code} provider for holiday ${date}`);
          continue;
        }

        const chosen = pickProvider(available);
        assign(chosen.id, date, st, `Holiday ${st.code} (even dist — ${chosen.initials})`, `holiday-${stepName}`, 0.8);
        recordAssignment(chosen.id, date);
      }
    } else {
      for (const date of dates) {
        const required = getRequiredCount(st, date);
        if (required <= 0) continue;

        const current = countAssigned(st.code, date);
        if (current >= required) continue;

        const needed = required - current;
        let available = eligible.filter(
          (p) => isAvailable(p, date, st) && !wouldBreakPPHours(p.id, date, st)
        );
        if (available.length === 0) {
          // Relax hours constraint
          available = eligible.filter((p) => isAvailable(p, date, st));
        }

        if (available.length === 0) {
          warnings.push(`No eligible ${st.code} provider for ${date}`);
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
          const chosen = pickProvider([...pool]);
          const provider = providers.find((p) => p.id === chosen.id)!;

          assign(
            chosen.id,
            date,
            st,
            `${st.code} (even dist${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
            stepName,
            0.7
          );
          recordAssignment(chosen.id, date);

          if (st.postShiftRule === "day_off_after" && offShift) {
            const next = nextDate(date);
            const nextDow = getDow(next);
            const providerWorksNext = chosen.workingDays.includes(nextDow);
            if (dateSet.has(next) && !isAssigned(chosen.id, next) && providerWorksNext) {
              assign(chosen.id, next, offShift, `Day off after ${st.code}`, `${stepName}-recovery`, 0.95);
            }
          }

          pool = pool.filter((p) => p.id !== chosen.id);
        }
      }
    }
  }

  // ── STEP 3: Fill shift to hit FTE hour targets (shift mix + day-off clustering) ──
  //
  // For each provider, compute the optimal mix of OR + ORL (+ ORC) that hits
  // exact target hours while minimizing work days. Multiple ORLs per pay period
  // are allowed — each one traded for a day off improves quality of life.
  //
  // Key: fill substitutions skip the maxPerDay check. That constraint is a
  // staffing cap for Step 2 (how many people NEED the shift), not a capacity
  // limit on who can work longer days.

  // Like isAvailable but skips maxPerDay for fill substitutions
  function isAvailableForFill(provider: ScheduleProvider, date: string, st: ScheduleShiftType): boolean {
    if (isAssigned(provider.id, date)) return false;
    if (!st.ignoresWorkingDays) {
      const dow = getDow(date);
      if (!provider.workingDays.includes(dow)) return false;
    }
    const prev = getCell(provider.id, prevDate(date));
    if (prev) {
      const prevSt = stById.get(prev.shiftTypeId);
      if (prevSt?.postShiftRule === "day_off_after") return false;
      if (st.noConsecutiveGroup && prevSt?.noConsecutiveGroup === st.noConsecutiveGroup) return false;
    }
    const next = getCell(provider.id, nextDate(date));
    if (next) {
      const nextSt = stById.get(next.shiftTypeId);
      if (st.noConsecutiveGroup && nextSt?.noConsecutiveGroup === st.noConsecutiveGroup) return false;
    }
    return true;
  }

  function getProviderSubs(provider: ScheduleProvider, fillHrs: number): { shift: ScheduleShiftType; extra: number }[] {
    return shiftTypes
      .filter((st) => {
        if (!st.countsTowardFte || st.isLeave || st.isOffShift || st.isFillShift) return false;
        if (st.category !== "work" || st.defaultHours <= fillHrs) return false;
        if (st.schedulePriority == null) return false;
        if (st.postShiftRule) return false;
        if (st.eligibilityRule === "takesCall" && !provider.takesCall) return false;
        if (st.eligibilityRule === "takesLate" && !provider.takesLate) return false;
        return true;
      })
      .map((st) => ({ shift: st, extra: st.defaultHours - fillHrs }))
      .sort((a, b) => a.extra - b.extra);
  }

  function solveDeficit(
    deficit: number,
    subs: { shift: ScheduleShiftType; extra: number }[],
    maxSlots: number
  ): { shift: ScheduleShiftType; count: number }[] | null {
    if (deficit === 0) return [];
    if (deficit < 0 || subs.length === 0) return null;

    if (subs.length === 1) {
      if (deficit % subs[0].extra === 0) {
        const count = deficit / subs[0].extra;
        return count <= maxSlots ? [{ shift: subs[0].shift, count }] : null;
      }
      return null;
    }

    const [smaller, larger] = subs[0].extra <= subs[1].extra ? [subs[0], subs[1]] : [subs[1], subs[0]];
    for (let nLarge = 0; nLarge <= Math.floor(deficit / larger.extra); nLarge++) {
      const rem = deficit - nLarge * larger.extra;
      if (rem % smaller.extra === 0) {
        const nSmall = rem / smaller.extra;
        if (nLarge + nSmall <= maxSlots) {
          const result: { shift: ScheduleShiftType; count: number }[] = [];
          if (nSmall > 0) result.push({ shift: smaller.shift, count: nSmall });
          if (nLarge > 0) result.push({ shift: larger.shift, count: nLarge });
          return result;
        }
      }
    }
    return null;
  }

  function tryPlaceSubs(
    provider: ScheduleProvider,
    candidateDates: string[],
    subs: { shift: ScheduleShiftType; count: number }[]
  ): { date: string; shift: ScheduleShiftType }[] | null {
    const placed: { date: string; shift: ScheduleShiftType }[] = [];
    const usedDates = new Set<string>();

    for (const { shift, count } of subs) {
      let remaining = count;
      for (const date of candidateDates) {
        if (remaining <= 0) break;
        if (usedDates.has(date)) continue;
        if (!isAvailableForFill(provider, date, shift)) continue;
        if (shift.noConsecutiveGroup) {
          const pDate = prevDate(date);
          const nDate = nextDate(date);
          if (placed.some((p) =>
            (p.date === pDate || p.date === nDate) &&
            p.shift.noConsecutiveGroup === shift.noConsecutiveGroup
          )) continue;
        }
        placed.push({ date, shift });
        usedDates.add(date);
        remaining--;
      }
      if (remaining > 0) return null;
    }
    return placed;
  }

  if (fillShift) {
    const sortedPPs = [...payPeriods]
      .filter((pp) => dates.some((d) => d >= pp.startDate && d <= pp.endDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const fillReqsByDay = new Map<string, number>();
    const fillReqs = reqsByShift.get(fillShift.code);
    if (fillReqs) {
      for (const [dayKey, min] of fillReqs) fillReqsByDay.set(dayKey, min);
    }

    function fillStaffedCount(date: string): number {
      let count = 0;
      for (const [k, v] of grid.entries()) {
        if (k.endsWith(`:${date}`) && v.code === fillShift!.code) count++;
      }
      return count;
    }

    function fillRequiredOnDate(date: string): number {
      const dayKey = holidaySet.has(date) ? "holiday" : String(getDow(date));
      return fillReqsByDay.get(dayKey) ?? 0;
    }

    function scoreOffDays(offDays: Set<string>, allWorkdaysInPP: string[], providerWorkingDays: number[]): number {
      if (offDays.size === 0) return 0;

      const workingSet = new Set(providerWorkingDays);
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
            score += (runLen - 1) * 2;
          }
          if (runLen >= 3 && runTouchesNonWorkDay && schedulingPreferences.prefer3DayWeekends) {
            score += 5;
          }
          if (runLen >= 4 && runTouchesNonWorkDay && schedulingPreferences.prefer4DayWeekends) {
            score += 8;
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

    for (const pp of sortedPPs) {
      const ppDates = dates.filter(
        (d) => d >= pp.startDate && d <= pp.endDate && !holidaySet.has(d)
      );

      const sortedProviders = sortByFairness(activeProviders.map((p) => p.id))
        .map((id) => activeProviders.find((p) => p.id === id)!)
        .filter(Boolean);

      for (const provider of sortedProviders) {
        const target = pp.targetHours * provider.ftePercentage;
        if (target <= 0) continue;

        const currentHours = ppHoursForProvider(provider.id, pp);
        if (currentHours >= target) continue;

        const hoursPerDay = getShiftHours(provider.id, fillShift, overrideMap);
        const hoursNeeded = target - currentHours;
        const providerSubs = getProviderSubs(provider, hoursPerDay);
        const maxShiftHrs = providerSubs.length > 0
          ? Math.max(hoursPerDay, ...providerSubs.map((s) => s.shift.defaultHours))
          : hoursPerDay;

        const availableDates = ppDates.filter((d) =>
          isAvailable(provider, d, fillShift)
        );

        if (availableDates.length === 0) {
          if (hoursNeeded > 0) {
            warnings.push(`${provider.initials}: needs ${hoursNeeded}hrs but no available days in PP ${pp.startDate}`);
          }
          continue;
        }

        if (availableDates.length * maxShiftHrs < hoursNeeded) {
          warnings.push(
            `${provider.initials}: cannot reach ${target}hrs — max ${currentHours + availableDates.length * maxShiftHrs}hrs with ${availableDates.length} days`
          );
        }

        // Find the shift mix with fewest work days (most days off).
        // For d work days: deficit = hoursNeeded - d * fillHrs.
        // Subs must cover the deficit exactly. Fewer d = more subs = more days off.
        let bestPlan: {
          workDays: number;
          subPlacements: { date: string; shift: ScheduleShiftType }[];
          fillCount: number;
        } | null = null;

        const minWorkDays = Math.max(1, Math.ceil(hoursNeeded / maxShiftHrs));

        for (let d = minWorkDays; d <= availableDates.length; d++) {
          const deficit = hoursNeeded - d * hoursPerDay;
          if (deficit < 0) continue;

          if (deficit === 0) {
            bestPlan = { workDays: d, subPlacements: [], fillCount: d };
            break;
          }

          const solution = solveDeficit(deficit, providerSubs, d);
          if (!solution) continue;

          const placement = tryPlaceSubs(provider, availableDates, solution);
          if (placement) {
            const subDays = solution.reduce((s, x) => s + x.count, 0);
            bestPlan = { workDays: d, subPlacements: placement, fillCount: d - subDays };
            break;
          }
        }

        if (!bestPlan) {
          const maxDays = Math.min(availableDates.length, Math.floor(hoursNeeded / hoursPerDay));
          bestPlan = { workDays: maxDays, subPlacements: [], fillCount: maxDays };
          const filled = maxDays * hoursPerDay;
          if (filled < hoursNeeded) {
            warnings.push(`${provider.initials}: ${hoursNeeded - filled}hrs short — no valid shift mix found`);
          }
        }

        const subDateSet = new Set(bestPlan.subPlacements.map((p) => p.date));
        const nonSubDates = availableDates.filter((d) => !subDateSet.has(d));
        const daysOff = nonSubDates.length - bestPlan.fillCount;

        let fillDates: string[];
        if (daysOff > 0 && daysOff < nonSubDates.length) {
          const indices = nonSubDates.map((_, i) => i);
          let bestOffIndices: number[] = [];
          let bestScore = -Infinity;
          let comboCount = 0;

          for (const offIndices of combinations(indices, daysOff)) {
            comboCount++;
            let feasible = true;
            for (const idx of offIndices) {
              const date = nonSubDates[idx];
              const required = fillRequiredOnDate(date);
              if (required > 0 && fillStaffedCount(date) < required) {
                feasible = false;
                break;
              }
            }
            if (!feasible) continue;

            const offSet = new Set(offIndices.map((i) => nonSubDates[i]));
            const score = scoreOffDays(offSet, availableDates, provider.workingDays);
            if (score > bestScore) {
              bestScore = score;
              bestOffIndices = offIndices;
            }
            if (comboCount >= MAX_COMBOS) break;
          }

          const offDaySet = new Set(bestOffIndices.map((i) => nonSubDates[i]));
          fillDates = nonSubDates.filter((d) => !offDaySet.has(d));
        } else {
          fillDates = nonSubDates.slice(0, bestPlan.fillCount);
        }

        let hours = currentHours;
        for (const { date, shift } of bestPlan.subPlacements) {
          assign(provider.id, date, shift,
            `${shift.code} to fill hours (${hours}/${target}hrs)`,
            "fill-sub", 0.6);
          hours += shift.defaultHours;
        }

        for (const date of fillDates) {
          if (hours >= target) break;
          if (hours + hoursPerDay > target) break;
          assign(provider.id, date, fillShift,
            `${fillShift.code} to fill hours (${hours}/${target}hrs)`,
            "fill", 0.6);
          hours += hoursPerDay;
        }
      }
    }
  }

  // ── STEP 4: Fill all remaining empty cells with X (day off) ──
  if (offShift) {
    for (const date of dates) {
      for (const provider of providers) {
        if (!provider.isActive) continue;
        if (!isAssigned(provider.id, date)) {
          assign(provider.id, date, offShift, "Day off", "off", 0.95);
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
