import { prisma } from "@/lib/prisma";
import { getPayPeriods } from "@/lib/pay-periods-server";
import { deriveEquityFactorCodes } from "@/lib/equity-factors";
import type { RawStatsData } from "@/lib/graph/model";
import { DEFAULT_SPEC, decodeSpec } from "@/lib/graph/spec";
import { DEFAULT_DATE_FORMAT } from "@/lib/date-format";
import { EquityPage } from "./equity-page";
import { NavHeader } from "../nav-header";
import { getPageSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Equity({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  // Decode the shareable spec from ?g= on the server so the initial render is
  // already the requested view (no client mount-effect, no hydration mismatch).
  const { g } = await searchParams;
  const initialSpec = (g && decodeSpec(g)) || DEFAULT_SPEC;
  // Require schedule:view in addition to statistics:view: this page now ships the
  // raw per-date assignment list to the browser for client-side recompute, which
  // is the schedule itself. Do not drop schedule:view here without moving the
  // raw-data computation back to the server (see docs/statistics-revamp-plan.md).
  const session = await getPageSession(["statistics:view", "schedule:view"]);
  if (session.error) redirect("/");
  const canManageViews = session.permissions.includes("statistics:manage");
  const [staff, shiftTypes, assignments, holidays, desirabilityWeights, payPeriods, schedPrefs, equityFactors, eligibilities, overrides] =
    await Promise.all([
      prisma.staff.findMany({ orderBy: { sortOrder: "asc" }, include: { employmentType: true } }),
      prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.assignment.findMany(),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
      prisma.desirabilityWeight.findMany(),
      getPayPeriods(),
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

  // The whole Statistics computation now runs client-side (computeStatsModel),
  // so the server ships the raw, serializable arrays it needs. This lets the
  // upcoming date-range/staff pickers recompute over a subset without a round trip.
  const raw: RawStatsData = {
    staff: staff.map((p) => ({
      id: p.id,
      initials: p.initials,
      name: p.name,
      ftePercentage: p.ftePercentage,
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
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
  };

  const equityThresholds = {
    low: schedPrefs?.equityThresholdLow ?? 0.25,
    med: schedPrefs?.equityThresholdMed ?? 0.75,
    high: schedPrefs?.equityThresholdHigh ?? 1.5,
  };

  const payPeriodRefs = payPeriods.map((p) => ({
    id: p.id,
    startDate: p.startDate.toISOString().split("T")[0],
    endDate: p.endDate.toISOString().split("T")[0],
  }));

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />
      <EquityPage raw={raw} equityThresholds={equityThresholds} payPeriods={payPeriodRefs} initialSpec={initialSpec} dateFormat={schedPrefs?.dateFormat ?? DEFAULT_DATE_FORMAT} canManageViews={canManageViews} />
    </main>
  );
}
