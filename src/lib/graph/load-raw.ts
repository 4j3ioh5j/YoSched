import { readTuning } from "@/lib/scheduler-tuning";
import { prisma } from "@/lib/prisma";
import { deriveEquityFactorCodes } from "@/lib/equity-factors";
import { effectiveFte } from "@/lib/fte";
import type { RawStatsData } from "@/lib/graph/model";

/**
 * The raw arrays the Statistics computation runs on (computeStatsModel), loaded once per page.
 * Shared by the Statistics page and the "Ask" page (card #367) so both read the schedule the same way.
 * It ships the whole schedule to the browser: callers must require schedule:view.
 */
export async function loadRawStatsData() {
  const [staff, shiftTypes, assignments, holidays, desirabilityWeights, schedPrefs, equityFactors, eligibilities, overrides] =
    await Promise.all([
      prisma.staff.findMany({ orderBy: { sortOrder: "asc" }, include: { employmentType: true } }),
      prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.assignment.findMany(),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
      prisma.desirabilityWeight.findMany(),
      prisma.schedulingPreferences.findFirst(),
      prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.staffEligibleShift.findMany(),
      prisma.staffShiftOverride.findMany(),
    ]);

  const shiftById = new Map(shiftTypes.map((st) => [st.id, st] as const));
  const eligMap = new Map<string, string[]>();
  for (const e of eligibilities) {
    const arr = eligMap.get(e.staffId) || [];
    arr.push(e.shiftTypeId);
    eligMap.set(e.staffId, arr);
  }

  const raw: RawStatsData = {
    staff: staff.map((p) => ({
      id: p.id,
      initials: p.initials,
      name: p.name,
      // Card #71: FTE % and fairness come from the employment type's settings, never its name.
      ftePercentage: effectiveFte(p, p.employmentType),
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      inFairness: p.employmentType.includedInFairness,
      employmentTypeId: p.employmentTypeId,
      employmentTypeName: p.employmentType.name,
      eligibleShiftTypeIds: eligMap.get(p.id) ?? [],
    })),
    // ONE shift snapshot for the whole page: the assignments' shift fields and the equity
    // factors' codes (below) both come from the shiftTypes list loaded above, never from a
    // per-row join — so a shift renamed between two queries cannot show two codes at once.
    assignments: assignments.flatMap((a) => {
      const st = shiftById.get(a.shiftTypeId);
      if (!st) return []; // not reachable (FK); never invent a shift
      return [{
        staffId: a.staffId,
        shiftTypeId: a.shiftTypeId,
        date: a.date.toISOString().split("T")[0],
        shiftType: {
          id: st.id,
          code: st.code,
          defaultHours: st.defaultHours,
          countsTowardFte: st.countsTowardFte,
          countsAsHolidayWork: st.countsAsHolidayWork,
          isLeave: st.isLeave,
          isOffShift: st.isOffShift,
        },
      }];
    }),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id,
      countsTowardFte: st.countsTowardFte,
      defaultHours: st.defaultHours,
      defaultHoursWeekend: st.defaultHoursWeekend,
      defaultHoursHoliday: st.defaultHoursHoliday,
    })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId,
      dayOfWeek: dw.dayOfWeek,
      weight: dw.weight,
    })),
    holidays: holidays.map((h) => ({ date: h.date.toISOString().split("T")[0] })),
    equityFactors: deriveEquityFactorCodes(
      equityFactors.map((f) => ({ factorType: f.factorType, shiftTypeId: f.shiftTypeId, weight: f.weight, enabled: f.enabled })),
      shiftTypes,
    ),
    overrides: overrides.map((o) => ({
      staffId: o.staffId,
      shiftTypeId: o.shiftTypeId,
      durationHrs: o.durationHrs,
      durationHrsWeekday: o.durationHrsWeekday,
      durationHrsWeekend: o.durationHrsWeekend,
      durationHrsHoliday: o.durationHrsHoliday,
    })),
    weekendStartDow: readTuning(schedPrefs).weekendStartDow, // card #215
  };
  return { raw, schedPrefs, shiftTypes, holidays };
}
