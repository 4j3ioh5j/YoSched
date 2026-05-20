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
  const callProviders = activeProviders.filter((p) => p.takesCall);
  const lateProviders = activeProviders.filter((p) => p.takesLate);

  const dwMap = new Map<string, number>();
  for (const dw of desirabilityWeights) {
    dwMap.set(`${dw.shiftTypeId}:${dw.dayOfWeek}`, dw.weight);
  }

  const prefMap = new Map<string, string>();
  for (const dp of dayPreferences) {
    prefMap.set(`${dp.providerId}:${dp.dayOfWeek}`, dp.preference);
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

  function isAvailable(provider: ScheduleProvider, date: string): boolean {
    if (isAssigned(provider.id, date)) return false;
    const dow = getDow(date);
    if (!provider.workingDays.includes(dow)) return false;
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

  function findPPForDate(date: string): PayPeriod | null {
    for (const pp of payPeriods) {
      if (date >= pp.startDate && date <= pp.endDate) return pp;
    }
    return null;
  }

  function fairnessScore(providerId: string): number {
    return fairness.deviations.get(providerId)?.overall ?? 0;
  }

  // Sort by fairness: most underloaded first (lowest overall deviation)
  function sortByFairness(pIds: string[]): string[] {
    return [...pIds].sort((a, b) => fairnessScore(a) - fairnessScore(b));
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

  // ── STEP 2: Weekend CALL (fairness-weighted) ──
  const callSt = stByCode.get("CALL");
  if (callSt) {
    const weekendDates = dates.filter((d) => isWeekend(d));
    const saturdayDates = weekendDates.filter((d) => getDow(d) === 6);

    for (const sat of saturdayDates) {
      const sun = nextDate(sat);
      if (!dateSet.has(sun)) continue;

      const eligible = callProviders.filter(
        (p) => !isAssigned(p.id, sat) && !isAssigned(p.id, sun)
      );

      if (eligible.length === 0) {
        warnings.push(`No eligible CALL provider for ${sat}/${sun}`);
        continue;
      }

      const sorted = sortByFairness(eligible.map((p) => p.id));
      const chosen = sorted[0];
      const provider = providers.find((p) => p.id === chosen)!;

      assign(chosen, sat, callSt, `Weekend CALL (fairness pick — ${provider.initials} is underloaded)`, "weekend-call", 0.8);
      assign(chosen, sun, callSt, `Weekend CALL (fairness pick — ${provider.initials} is underloaded)`, "weekend-call", 0.8);
    }
  }

  // ── STEP 3: Respect locked/imported cells (already in grid) ──
  // No action needed — locked cells are already in the grid and won't be overwritten.

  // ── STEP 4: Distribute ORC (one per weekday, fairness-weighted) ──
  const orcSt = stByCode.get("ORC");
  if (orcSt) {
    const weekdays = dates.filter(
      (d) => !isWeekend(d) && !holidaySet.has(d)
    );

    for (const date of weekdays) {
      const existing = [...grid.entries()].find(
        ([k, v]) => k.endsWith(`:${date}`) && v.code === "ORC"
      );
      if (existing) continue;

      const eligible = callProviders.filter((p) => isAvailable(p, date));
      if (eligible.length === 0) {
        warnings.push(`No eligible ORC provider for ${date}`);
        continue;
      }

      const dow = getDow(date);
      const preferred = eligible.filter(
        (p) => prefMap.get(`${p.id}:${dow}`) === "ORC"
      );

      let pool = preferred.length > 0 ? preferred : eligible;
      const sorted = sortByFairness(pool.map((p) => p.id));

      const desirability = dwMap.get(`${orcSt.id}:${dow}`) ?? 0;
      const chosen = sorted[0];
      const provider = providers.find((p) => p.id === chosen)!;

      assign(
        chosen,
        date,
        orcSt,
        `ORC (fairness${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
        "orc",
        0.7
      );

      // Post-shift: mark next day as off if provider works that day
      if (orcSt.postShiftRule === "day_off_after") {
        const next = nextDate(date);
        if (dateSet.has(next) && !isAssigned(chosen, next)) {
          const xSt = stByCode.get("X");
          if (xSt) {
            assign(chosen, next, xSt, `Day off after ORC`, "orc-recovery", 0.95);
          }
        }
      }
    }
  }

  // ── STEP 5: Distribute ORL (one per weekday, fairness-weighted) ──
  const orlSt = stByCode.get("ORL");
  if (orlSt) {
    const weekdays = dates.filter(
      (d) => !isWeekend(d) && !holidaySet.has(d)
    );

    for (const date of weekdays) {
      const existing = [...grid.entries()].find(
        ([k, v]) => k.endsWith(`:${date}`) && v.code === "ORL"
      );
      if (existing) continue;

      const eligible = lateProviders.filter((p) => isAvailable(p, date));
      if (eligible.length === 0) {
        warnings.push(`No eligible ORL provider for ${date}`);
        continue;
      }

      const dow = getDow(date);
      const desirability = dwMap.get(`${orlSt.id}:${dow}`) ?? 0;
      const sorted = sortByFairness(eligible.map((p) => p.id));
      const chosen = sorted[0];
      const provider = providers.find((p) => p.id === chosen)!;

      assign(
        chosen,
        date,
        orlSt,
        `ORL (fairness${desirability !== 0 ? `, desirability ${desirability > 0 ? "+" : ""}${desirability}` : ""})`,
        "orl",
        0.7
      );
    }
  }

  // ── STEP 6: Fill OR to hit FTE hour targets ──
  const orSt = stByCode.get("OR");
  if (orSt) {
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
          isAvailable(provider, d)
        );

        for (const date of availableDates) {
          if (currentHours >= target) break;

          const hours = getShiftHours(provider.id, orSt, overrideMap);
          assign(
            provider.id,
            date,
            orSt,
            `OR to fill hours (${currentHours}/${target}hrs)`,
            "or-fill",
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
