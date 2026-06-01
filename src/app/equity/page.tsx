import { prisma } from "@/lib/prisma";
import type { RawStatsData } from "@/lib/graph/model";
import { DEFAULT_SPEC, decodeSpec } from "@/lib/graph/spec";
import { EquityPage } from "./equity-page";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
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
  const { error } = await getSession(["statistics:view", "schedule:view"]);
  if (error) redirect("/");
  const [providers, shiftTypes, assignments, holidays, desirabilityWeights, payPeriods, schedPrefs, equityFactors, eligibilities, overrides] =
    await Promise.all([
      prisma.provider.findMany({ orderBy: { sortOrder: "asc" }, include: { employmentType: true } }),
      prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.assignment.findMany({ include: { shiftType: true } }),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
      prisma.desirabilityWeight.findMany(),
      prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
      prisma.schedulingPreferences.findFirst(),
      prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.providerEligibleShift.findMany(),
      prisma.providerShiftOverride.findMany(),
    ]);

  const eligMap = new Map<string, string[]>();
  for (const e of eligibilities) {
    const arr = eligMap.get(e.providerId) || [];
    arr.push(e.shiftTypeId);
    eligMap.set(e.providerId, arr);
  }

  // The whole Statistics computation now runs client-side (computeStatsModel),
  // so the server ships the raw, serializable arrays it needs. This lets the
  // upcoming date-range/staff pickers recompute over a subset without a round trip.
  const raw: RawStatsData = {
    providers: providers.map((p) => ({
      id: p.id,
      initials: p.initials,
      name: p.name,
      ftePercentage: p.ftePercentage,
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      employmentTypeName: p.employmentType.name,
      eligibleShiftTypeIds: eligMap.get(p.id) ?? [],
    })),
    assignments: assignments.map((a) => ({
      providerId: a.providerId,
      shiftTypeId: a.shiftTypeId,
      date: a.date.toISOString().split("T")[0],
      shiftType: {
        id: a.shiftType.id,
        code: a.shiftType.code,
        defaultHours: a.shiftType.defaultHours,
        countsTowardFte: a.shiftType.countsTowardFte,
        isLeave: a.shiftType.isLeave,
        isOffShift: a.shiftType.isOffShift,
      },
    })),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id,
      countsTowardFte: st.countsTowardFte,
      countsOnWeekend: st.countsOnWeekend,
      defaultHours: st.defaultHours,
    })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId,
      dayOfWeek: dw.dayOfWeek,
      weight: dw.weight,
    })),
    holidays: holidays.map((h) => ({ date: h.date.toISOString().split("T")[0] })),
    equityFactors: equityFactors.map((f) => ({
      factorType: f.factorType,
      shiftCode: f.shiftCode,
      weight: f.weight,
      enabled: f.enabled,
    })),
    overrides: overrides.map((o) => ({
      providerId: o.providerId,
      shiftTypeId: o.shiftTypeId,
      durationHrs: o.durationHrs,
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
    <main className="flex flex-col h-screen">
      <NavHeader />
      <EquityPage raw={raw} equityThresholds={equityThresholds} payPeriods={payPeriodRefs} initialSpec={initialSpec} />
    </main>
  );
}
