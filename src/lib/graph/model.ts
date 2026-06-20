/**
 * assembleEquityModel — the pure assembly step of the Statistics page.
 *
 * Takes the `computeFairness` result plus the raw staff / assignment /
 * shift-type / override data and produces the per-staff rows, department
 * averages, tracked shift codes, date range, and the full shift-code list that
 * the Statistics view renders. Extracted verbatim from the server page so the
 * hours (per-day-type defaults + override) and tally logic is one pure,
 * unit-tested unit — the parity gate required by the revamp plan (slice 1b). Isomorphic:
 * no Prisma/Date-object dependency, so a later slice can run it client-side.
 */
import { computeFairness } from "../fairness";
import type { FairnessSummary, EquityFactor } from "../fairness";

export type Deviation = {
  desirability: number;
  holidayWork: number;
  overall: number;
  perShift: Record<string, number>;
};

export type EquityRow = {
  staffId: string;
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

export type AssembleStaff = {
  id: string;
  name: string;
  isAutoScheduled: boolean;
  ftePercentage: number | null;
  employmentTypeName: string;
};

export type AssembleAssignment = {
  staffId: string;
  shiftTypeId: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  code: string;
  isOffShift: boolean;
};

export type AssembleShiftType = {
  id: string;
  countsTowardFte: boolean;
  defaultHours: number; // weekday hours
  defaultHoursWeekend: number; // 0 = does not accrue weekend hours
  defaultHoursHoliday: number; // 0 = does not accrue holiday hours; holiday wins over weekend
};

export type AssembleOverride = {
  staffId: string;
  shiftTypeId: string;
  durationHrs: number;
  // Day-type-aware overrides; null/undefined falls back to durationHrs.
  durationHrsWeekday?: number | null;
  durationHrsWeekend?: number | null;
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
  staff: AssembleStaff[];
  assignments: AssembleAssignment[];
  shiftTypes: AssembleShiftType[];
  overrides: AssembleOverride[];
  holidays: Array<{ date: string }>;
}): EquityModel {
  const { fairness, staff, assignments, shiftTypes, overrides, holidays } = input;
  const holidaySet = new Set(holidays.map((h) => h.date));

  // Per-staff shift-code tallies. Off shifts are skipped, but the staff
  // entry is still created (matches the original loop ordering).
  const shiftTallies: Record<string, Record<string, number>> = {};
  for (const a of assignments) {
    const pid = a.staffId;
    if (!shiftTallies[pid]) shiftTallies[pid] = {};
    if (a.isOffShift) continue;
    shiftTallies[pid][a.code] = (shiftTallies[pid][a.code] || 0) + 1;
  }

  // Total FTE-counted hours per staff, honoring per-staff shift-hour overrides
  // and each shift's per-day-type hours (weekday / weekend / holiday). A day type
  // the shift doesn't accrue on resolves to 0, so no explicit day-type gate.
  const staffHours: Record<string, number> = {};
  const overrideMap = new Map<string, { weekday: number; weekend: number; holiday: number }>();
  for (const o of overrides) {
    const weekend = o.durationHrsWeekend ?? o.durationHrs;
    // Item 1: overrides have no holiday value yet — mirror the weekend resolution.
    overrideMap.set(`${o.staffId}:${o.shiftTypeId}`, {
      weekday: o.durationHrsWeekday ?? o.durationHrs,
      weekend,
      holiday: weekend,
    });
  }
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));
  for (const a of assignments) {
    const st = stMap.get(a.shiftTypeId);
    if (!st || !st.countsTowardFte) continue;
    const dow = new Date(a.date + "T12:00:00").getDay();
    const dayType: "weekday" | "weekend" | "holiday" = holidaySet.has(a.date)
      ? "holiday"
      : dow === 0 || dow === 6
        ? "weekend"
        : "weekday";
    const ov = overrideMap.get(`${a.staffId}:${a.shiftTypeId}`);
    const hrs = ov
      ? ov[dayType]
      : dayType === "holiday"
        ? st.defaultHoursHoliday
        : dayType === "weekend"
          ? st.defaultHoursWeekend
          : st.defaultHours;
    staffHours[a.staffId] = (staffHours[a.staffId] || 0) + hrs;
  }

  const dateRange = {
    min: assignments.length > 0
      ? assignments.reduce((min, a) => (a.date < min ? a.date : min), assignments[0].date)
      : "",
    max: assignments.length > 0
      ? assignments.reduce((max, a) => (a.date > max ? a.date : max), assignments[0].date)
      : "",
  };

  const provById = new Map(staff.map((p) => [p.id, p]));
  const data: EquityRow[] = fairness.metrics.map((m) => {
    const dev = fairness.deviations.get(m.staffId)!;
    const disp = fairness.displayDeviations.get(m.staffId)!;
    const p = provById.get(m.staffId)!;
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
      totalHours: staffHours[m.staffId] || 0,
      shiftTally: shiftTallies[m.staffId] || {},
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

/* ------------------------------------------------------------------ *
 * Raw payload + full engine entry point.
 *
 * computeStatsModel runs the whole Statistics computation — computeFairness
 * then assembleEquityModel — from the raw arrays. It is pure and isomorphic so
 * it can run on the client; a later slice filters `raw.assignments` by date
 * range before calling it to recompute over a subset.
 * ------------------------------------------------------------------ */

export type RawShiftTypeRef = {
  id: string;
  code: string;
  defaultHours: number;
  countsTowardFte: boolean;
  countsAsHolidayWork: boolean;
  isLeave: boolean;
  isOffShift: boolean;
};

export type RawStaff = {
  id: string;
  initials: string;
  name: string;
  ftePercentage: number | null;
  isActive: boolean;
  isAutoScheduled: boolean;
  employmentTypeName: string;
  eligibleShiftTypeIds: string[];
};

export type RawAssignment = {
  staffId: string;
  shiftTypeId: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  shiftType: RawShiftTypeRef;
};

export type RawDesirabilityWeight = { shiftTypeId: string; dayOfWeek: number; weight: number };

export type RawStatsData = {
  staff: RawStaff[];
  assignments: RawAssignment[];
  shiftTypes: AssembleShiftType[];
  desirabilityWeights: RawDesirabilityWeight[];
  holidays: Array<{ date: string }>;
  equityFactors: EquityFactor[];
  overrides: AssembleOverride[];
};

export function computeStatsModel(raw: RawStatsData): EquityModel {
  const fairness = computeFairness({
    assignments: raw.assignments.map((a) => ({
      staffId: a.staffId,
      date: a.date,
      shiftType: {
        id: a.shiftType.id,
        code: a.shiftType.code,
        defaultHours: a.shiftType.defaultHours,
        countsTowardFte: a.shiftType.countsTowardFte,
        countsAsHolidayWork: a.shiftType.countsAsHolidayWork,
        isLeave: a.shiftType.isLeave,
        isOffShift: a.shiftType.isOffShift,
      },
    })),
    staff: raw.staff.map((p) => ({
      id: p.id,
      initials: p.initials,
      ftePercentage: p.ftePercentage ?? 1.0,
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      eligibleShiftTypeIds: p.eligibleShiftTypeIds,
    })),
    desirabilityWeights: raw.desirabilityWeights,
    holidays: raw.holidays,
    equityFactors: raw.equityFactors,
  });

  return assembleEquityModel({
    fairness,
    staff: raw.staff.map((p) => ({
      id: p.id,
      name: p.name,
      isAutoScheduled: p.isAutoScheduled,
      ftePercentage: p.ftePercentage,
      employmentTypeName: p.employmentTypeName,
    })),
    assignments: raw.assignments.map((a) => ({
      staffId: a.staffId,
      shiftTypeId: a.shiftTypeId,
      date: a.date,
      code: a.shiftType.code,
      isOffShift: a.shiftType.isOffShift,
    })),
    shiftTypes: raw.shiftTypes,
    overrides: raw.overrides,
    holidays: raw.holidays,
  });
}
