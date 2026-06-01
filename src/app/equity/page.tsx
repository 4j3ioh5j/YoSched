import { prisma } from "@/lib/prisma";
import { computeFairness } from "@/lib/fairness";
import { assembleEquityModel } from "@/lib/graph/model";
import { EquityPage } from "./equity-page";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Equity() {
  const { error } = await getSession("statistics:view");
  if (error) redirect("/");
  const [providers, shiftTypes, assignments, holidays, desirabilityWeights, payPeriods, schedPrefs, equityFactors, eligibilities] =
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
    ]);

  const eligMap = new Map<string, string[]>();
  for (const e of eligibilities) {
    const arr = eligMap.get(e.providerId) || [];
    arr.push(e.shiftTypeId);
    eligMap.set(e.providerId, arr);
  }

  const equity = computeFairness({
    assignments: assignments.map((a) => ({
      providerId: a.providerId,
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
    providers: providers.map((p) => ({
      id: p.id,
      initials: p.initials,
      ftePercentage: p.ftePercentage ?? 1.0,
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      eligibleShiftTypeIds: eligMap.get(p.id) ?? [],
    })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId,
      dayOfWeek: dw.dayOfWeek,
      weight: dw.weight,
    })),
    holidays,
    equityFactors,
  });

  const equityThresholds = {
    low: schedPrefs?.equityThresholdLow ?? 0.25,
    med: schedPrefs?.equityThresholdMed ?? 0.75,
    high: schedPrefs?.equityThresholdHigh ?? 1.5,
  };

  const overrides = await prisma.providerShiftOverride.findMany();

  const model = assembleEquityModel({
    fairness: equity,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      isAutoScheduled: p.isAutoScheduled,
      ftePercentage: p.ftePercentage,
      employmentTypeName: p.employmentType.name,
    })),
    assignments: assignments.map((a) => ({
      providerId: a.providerId,
      shiftTypeId: a.shiftTypeId,
      date: a.date.toISOString().split("T")[0],
      code: a.shiftType.code,
      isOffShift: a.shiftType.isOffShift,
    })),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id,
      countsTowardFte: st.countsTowardFte,
      countsOnWeekend: st.countsOnWeekend,
      defaultHours: st.defaultHours,
    })),
    overrides: overrides.map((o) => ({
      providerId: o.providerId,
      shiftTypeId: o.shiftTypeId,
      durationHrs: o.durationHrs,
    })),
  });

  return (
    <main className="flex flex-col h-screen">
      <NavHeader />
      <EquityPage
        data={model.data}
        averages={model.averages}
        trackedShiftCodes={model.trackedShiftCodes}
        dateRange={model.dateRange}
        shiftCodes={model.shiftCodes}
        equityThresholds={equityThresholds}
        activeFactors={equityFactors.map((f) => ({
          factorType: f.factorType,
          shiftCode: f.shiftCode,
          enabled: f.enabled,
        }))}
      />
    </main>
  );
}
