import { computeFairness, type FairnessSummary, type EquityFactor } from "./fairness";
import { evaluateAvailability, getBaseWorkDays, type AvailabilityRule } from "./availability";

export type ScheduleProvider = {
  id: string;
  initials: string;
  ftePercentage: number;
  eligibleShiftTypeIds: string[];
  availabilityRules: AvailabilityRule[];
  isActive: boolean;
  isAutoScheduled: boolean;
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
  sequentialOffWeight: number;
  threeDayWeekendWeight: number;
  fourDayWeekendWeight: number;
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

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
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
  equityFactors,
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
  equityFactors: EquityFactor[];
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
    (p) => p.isActive && p.isAutoScheduled
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
      ftePercentage: p.ftePercentage,
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      eligibleShiftTypeIds: p.eligibleShiftTypeIds,
    })),
    desirabilityWeights,
    holidays,
    equityFactors,
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
      const avail = evaluateAvailability(
        provider.availabilityRules, date, payPeriods,
        (pid, d) => isAssigned(pid, d)
      );
      if (!avail.available) return false;
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

  const eligibleShiftSets = new Map<string, Set<string>>();
  for (const p of providers) {
    eligibleShiftSets.set(p.id, new Set(p.eligibleShiftTypeIds));
  }

  function eligibleProviders(st: ScheduleShiftType): ScheduleProvider[] {
    return activeProviders.filter((p) => eligibleShiftSets.get(p.id)?.has(st.id));
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
    const hasRecoveryCost = st.postShiftRule === "day_off_after";
    if (!st.countsTowardFte && !hasRecoveryCost) return false;

    const recoveryDate = hasRecoveryCost ? nextDate(date) : null;
    const recoveryPP = recoveryDate ? findPPForDate(recoveryDate) : null;
    const pp = st.countsTowardFte ? findPPForDate(date) : recoveryPP;
    if (!pp || !fillShift) return false;
    const provider = activeProviders.find((p) => p.id === providerId);
    if (!provider) return false;
    const target = pp.targetHours * provider.ftePercentage;
    if (target <= 0) return false;

    const addHours = st.countsTowardFte ? getShiftHours(providerId, st, overrideMap) : 0;
    const current = ppHoursForProvider(providerId, pp);
    if (st.countsTowardFte && current + addHours > target) return true;

    const fillHrs = getShiftHours(providerId, fillShift, overrideMap);
    let availDays = 0;
    const cur = new Date(pp.startDate + "T12:00:00");
    const end = new Date(pp.endDate + "T12:00:00");
    while (cur <= end) {
      const d = toDateStr(cur);
      if (isAvailable(provider, d, fillShift)) {
        availDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }

    let daysConsumed = 0;
    if (st.countsTowardFte) daysConsumed += 1;
    if (hasRecoveryCost && recoveryPP &&
        recoveryPP.startDate === pp.startDate) daysConsumed += 1;
    const remainingAvail = availDays - daysConsumed;
    const hoursAfterAssign = current + addHours;
    const hoursStillNeeded = target - hoursAfterAssign;
    const maxFillable = remainingAvail * fillHrs;

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
        const avail = evaluateAvailability(
          provider.availabilityRules, date, payPeriods,
          (pid, d) => isAssigned(pid, d)
        );
        if (!avail.available) continue;
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
            isAvailable(p, sat, st) && isAvailable(p, sun, st) &&
            noGroupConflict(p.id, sat, sun) &&
            !wouldBreakPPHours(p.id, sat, st)
        );

        if (available.length === 0) {
          const fallback = eligible.filter(
            (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
              isAvailable(p, sat, st) && isAvailable(p, sun, st) &&
              noGroupConflict(p.id, sat, sun)
          );
          if (fallback.length === 0) {
            warnings.push(`No eligible ${st.code} provider for ${sat}/${sun}`);
            continue;
          }
          warnings.push(`${st.code} ${sat}/${sun}: all eligible providers would exceed PP hours`);
        }

        const pool = available.length > 0 ? available : eligible.filter(
          (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun) &&
            isAvailable(p, sat, st) && isAvailable(p, sun, st)
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
          (p) => !isAssigned(p.id, date) && isAvailable(p, date, st) &&
            !wouldBreakPPHours(p.id, date, st)
        );
        if (available.length === 0) {
          available = eligible.filter(
            (p) => !isAssigned(p.id, date) && isAvailable(p, date, st)
          );
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
      // Compute pairing factor: shifts where (hours - fillHours) doesn't divide
      // evenly into fillHours need to be assigned in groups so the remaining
      // hours are always fill-divisible.
      const fillHrs = fillShift ? fillShift.defaultHours : 0;
      const extra = fillHrs > 0 ? st.defaultHours - fillHrs : 0;
      const pairingFactor = (extra > 0) ? fillHrs / gcd(extra, fillHrs) : 1;

      if (pairingFactor > 1 && fillShift) {
        // PP-grouped distribution: assign in groups of pairingFactor to ensure
        // each provider's total hours remain fill-divisible.
        const step2PPs = [...payPeriods]
          .filter(pp => dates.some(d => d >= pp.startDate && d <= pp.endDate))
          .sort((a, b) => a.startDate.localeCompare(b.startDate));

        for (const pp of step2PPs) {
          const ppNeedDates: string[] = [];
          for (const date of dates) {
            if (date < pp.startDate || date > pp.endDate) continue;
            if (getRequiredCount(st, date) > countAssigned(st.code, date)) {
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
              const recoveryDays = st.postShiftRule === "day_off_after" ? pairingFactor : 0;
              const currentHrs = ppHoursForProvider(p.id, pp);
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
              warnings.push(`No eligible ${st.code} provider for group ${g + 1} in PP ${pp.startDate}`);
              continue;
            }

            const chosen = pickProvider([...available]);
            const provAvailDates = remainDates.filter(d => isAvailable(chosen, d, st));
            provAvailDates.sort((a, b) => a.localeCompare(b));

            // Pick well-separated dates (stride through the list)
            const pickedDates: string[] = [];
            const stride = Math.max(1, Math.floor(provAvailDates.length / pairingFactor));
            for (let i = 0; i < provAvailDates.length && pickedDates.length < pairingFactor; i += stride) {
              const date = provAvailDates[i];
              const conflict = st.noConsecutiveGroup && pickedDates.some(pd =>
                nextDate(pd) === date || prevDate(date) === pd
              );
              if (!conflict) pickedDates.push(date);
            }
            // Fallback: fill sequentially if stride missed some
            if (pickedDates.length < pairingFactor) {
              for (const date of provAvailDates) {
                if (pickedDates.length >= pairingFactor) break;
                if (pickedDates.includes(date)) continue;
                const conflict = st.noConsecutiveGroup && pickedDates.some(pd =>
                  nextDate(pd) === date || prevDate(date) === pd
                );
                if (!conflict) pickedDates.push(date);
              }
            }

            if (pickedDates.length < pairingFactor) {
              warnings.push(`Could only place ${pickedDates.length}/${pairingFactor} ${st.code} for ${chosen.initials} in PP ${pp.startDate}`);
            }

            for (const date of pickedDates) {
              const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
              assign(
                chosen.id, date, st,
                `${st.code} (paired dist${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
                stepName, 0.7
              );
              usedDates.add(date);

              if (st.postShiftRule === "day_off_after" && offShift) {
                const next = nextDate(date);
                const nextAvail = evaluateAvailability(chosen.availabilityRules, next, payPeriods, (pid, d) => isAssigned(pid, d));
                if (dateSet.has(next) && !isAssigned(chosen.id, next) && nextAvail.available) {
                  assign(chosen.id, next, offShift, `Day off after ${st.code}`, `${stepName}-recovery`, 0.95);
                }
              }
            }
            recordAssignment(chosen.id, pickedDates[0]);
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
              warnings.push(`No eligible ${st.code} provider for ${date} (partial PP)`);
              continue;
            }
            const chosen = pickProvider([...available]);
            const desirability = dwMap.get(`${st.id}:${getDow(date)}`) ?? 0;
            assign(
              chosen.id, date, st,
              `${st.code} (partial PP${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
              stepName, 0.7
            );
            recordAssignment(chosen.id, date);

            if (st.postShiftRule === "day_off_after" && offShift) {
              const next = nextDate(date);
              const nextAvail = evaluateAvailability(chosen.availabilityRules, next, payPeriods, (pid, d) => isAssigned(pid, d));
              if (dateSet.has(next) && !isAssigned(chosen.id, next) && nextAvail.available) {
                assign(chosen.id, next, offShift, `Day off after ${st.code}`, `${stepName}-recovery`, 0.95);
              }
            }
          }
        }
      } else {
        // Day-by-day distribution (pairingFactor === 1)
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
              const nextAvail = evaluateAvailability(chosen.availabilityRules, next, payPeriods, (pid, d) => isAssigned(pid, d));
              if (dateSet.has(next) && !isAssigned(chosen.id, next) && nextAvail.available) {
                assign(chosen.id, next, offShift, `Day off after ${st.code}`, `${stepName}-recovery`, 0.95);
              }
            }

            pool = pool.filter((p) => p.id !== chosen.id);
          }
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

    for (const pp of sortedPPs) {
      const ppDates = dates.filter(
        (d) => d >= pp.startDate && d <= pp.endDate
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

        const availableDates = ppDates.filter((d) =>
          isAvailable(provider, d, fillShift)
        );

        if (availableDates.length === 0) {
          if (hoursNeeded > 0) {
            warnings.push(`${provider.initials}: needs ${hoursNeeded}hrs but no available days in PP ${pp.startDate}`);
          }
          continue;
        }

        if (availableDates.length * hoursPerDay < hoursNeeded) {
          warnings.push(
            `${provider.initials}: cannot reach ${target}hrs — max ${currentHours + availableDates.length * hoursPerDay}hrs with ${availableDates.length} days`
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
            const score = scoreOffDays(offSet, availableDates, getBaseWorkDays(provider.availabilityRules));
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
        for (const date of fillDates) {
          if (hours >= target) break;
          const shift = holidaySet.has(date) && holShift ? holShift : fillShift;
          const shiftHrs = getShiftHours(provider.id, shift, overrideMap);
          assign(provider.id, date, shift,
            `${shift.code} to fill hours (${hours}/${target}hrs)`,
            "fill", 0.6);
          hours += shiftHrs;
        }
      }
    }
  }

  // ── STEP 4: Fill all remaining empty cells with X (day off) ──
  if (offShift) {
    for (const date of dates) {
      for (const provider of activeProviders) {
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
