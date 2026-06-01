/**
 * assembleEquityModel — the pure assembly step of the Statistics page.
 *
 * Takes the `computeFairness` result plus the raw provider / assignment /
 * shift-type / override data and produces the per-provider rows, department
 * averages, tracked shift codes, date range, and the full shift-code list that
 * the Statistics view renders. Extracted verbatim from the server page so the
 * hours (override + countsOnWeekend) and tally logic is one pure, unit-tested
 * unit — the parity gate required by the revamp plan (slice 1b). Isomorphic:
 * no Prisma/Date-object dependency, so a later slice can run it client-side.
 */
import type { FairnessSummary } from "../fairness";

export type Deviation = {
  desirability: number;
  holidayWork: number;
  overall: number;
  perShift: Record<string, number>;
};

export type EquityRow = {
  providerId: string;
  initials: string;
  name: string;
  isAutoScheduled: boolean;
  ftePercentage: number;
  employmentTypeName: string;
  desirabilityScore: number;
  undesirableShiftCount: number;
  desirableShiftCount: number;
  holidayWorkCount: number;
  totalWorkDays: number;
  totalLeaveDays: number;
  totalHours: number;
  deviation: Deviation;
  displayDeviation: Deviation;
  shiftCounts: Record<string, number>;
  shiftTally: Record<string, number>;
};

export type EquityAverages = {
  desirabilityScore: number;
  holidayWorkCount: number;
  perShift: Record<string, number>;
  totalHours: number;
  totalWorkDays: number;
  totalLeaveDays: number;
};

export type AssembleProvider = {
  id: string;
  name: string;
  isAutoScheduled: boolean;
  ftePercentage: number | null;
  employmentTypeName: string;
};

export type AssembleAssignment = {
  providerId: string;
  shiftTypeId: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  code: string;
  isOffShift: boolean;
};

export type AssembleShiftType = {
  id: string;
  countsTowardFte: boolean;
  countsOnWeekend: boolean;
  defaultHours: number;
};

export type AssembleOverride = {
  providerId: string;
  shiftTypeId: string;
  durationHrs: number;
};

export type EquityModel = {
  data: EquityRow[];
  averages: EquityAverages;
  trackedShiftCodes: string[];
  dateRange: { min: string; max: string };
  shiftCodes: string[];
};

export function assembleEquityModel(input: {
  fairness: FairnessSummary;
  providers: AssembleProvider[];
  assignments: AssembleAssignment[];
  shiftTypes: AssembleShiftType[];
  overrides: AssembleOverride[];
}): EquityModel {
  const { fairness, providers, assignments, shiftTypes, overrides } = input;

  // Per-provider shift-code tallies. Off shifts are skipped, but the provider
  // entry is still created (matches the original loop ordering).
  const shiftTallies: Record<string, Record<string, number>> = {};
  for (const a of assignments) {
    const pid = a.providerId;
    if (!shiftTallies[pid]) shiftTallies[pid] = {};
    if (a.isOffShift) continue;
    shiftTallies[pid][a.code] = (shiftTallies[pid][a.code] || 0) + 1;
  }

  // Total FTE-counted hours per provider, honoring per-provider shift-hour
  // overrides and the weekday-only (countsOnWeekend) rule.
  const providerHours: Record<string, number> = {};
  const overrideMap = new Map<string, number>();
  for (const o of overrides) overrideMap.set(`${o.providerId}:${o.shiftTypeId}`, o.durationHrs);
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));
  for (const a of assignments) {
    const st = stMap.get(a.shiftTypeId);
    if (!st || !st.countsTowardFte) continue;
    const dow = new Date(a.date + "T12:00:00").getDay();
    const isWknd = dow === 0 || dow === 6;
    if (isWknd && !st.countsOnWeekend) continue;
    const hrs = overrideMap.get(`${a.providerId}:${a.shiftTypeId}`) ?? st.defaultHours;
    providerHours[a.providerId] = (providerHours[a.providerId] || 0) + hrs;
  }

  const dateRange = {
    min: assignments.length > 0
      ? assignments.reduce((min, a) => (a.date < min ? a.date : min), assignments[0].date)
      : "",
    max: assignments.length > 0
      ? assignments.reduce((max, a) => (a.date > max ? a.date : max), assignments[0].date)
      : "",
  };

  const provById = new Map(providers.map((p) => [p.id, p]));
  const data: EquityRow[] = fairness.metrics.map((m) => {
    const dev = fairness.deviations.get(m.providerId)!;
    const disp = fairness.displayDeviations.get(m.providerId)!;
    const p = provById.get(m.providerId)!;
    return {
      ...m,
      deviation: {
        desirability: dev.desirability,
        holidayWork: dev.holidayWork,
        overall: dev.overall,
        perShift: dev.perShift,
      },
      displayDeviation: {
        desirability: disp.desirability,
        holidayWork: disp.holidayWork,
        overall: disp.overall,
        perShift: disp.perShift,
      },
      name: p.name,
      isAutoScheduled: p.isAutoScheduled,
      ftePercentage: p.ftePercentage ?? 1.0,
      employmentTypeName: p.employmentTypeName,
      totalHours: providerHours[m.providerId] || 0,
      shiftTally: shiftTallies[m.providerId] || {},
    };
  });

  const shiftCodes = [...new Set(
    Object.values(shiftTallies).flatMap((t) => Object.keys(t)),
  )].sort();

  const n = data.length || 1;
  const averages: EquityAverages = {
    ...fairness.averages,
    totalHours: data.reduce((s, d) => s + d.totalHours / (d.ftePercentage || 1), 0) / n,
    totalWorkDays: data.reduce((s, d) => s + d.totalWorkDays / (d.ftePercentage || 1), 0) / n,
    totalLeaveDays: data.reduce((s, d) => s + d.totalLeaveDays / (d.ftePercentage || 1), 0) / n,
  };

  return { data, averages, trackedShiftCodes: fairness.trackedShiftCodes, dateRange, shiftCodes };
}
