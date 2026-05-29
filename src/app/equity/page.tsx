import { prisma } from "@/lib/prisma";
import { computeFairness } from "@/lib/fairness";
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

  // Build per-provider shift-code tallies
  const shiftTallies: Record<string, Record<string, number>> = {};
  for (const a of assignments) {
    const pid = a.providerId;
    if (!shiftTallies[pid]) shiftTallies[pid] = {};
    const code = a.shiftType.code;
    if (a.shiftType.isOffShift) continue;
    shiftTallies[pid][code] = (shiftTallies[pid][code] || 0) + 1;
  }

  // Compute total hours per provider
  const providerHours: Record<string, number> = {};
  const overrides = await prisma.providerShiftOverride.findMany();
  const overrideMap = new Map<string, number>();
  for (const o of overrides) overrideMap.set(`${o.providerId}:${o.shiftTypeId}`, o.durationHrs);

  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));

  for (const a of assignments) {
    const st = stMap.get(a.shiftTypeId);
    if (!st || !st.countsTowardFte) continue;
    const dateStr = a.date.toISOString().split("T")[0];
    const dow = new Date(dateStr + "T12:00:00").getDay();
    const isWknd = dow === 0 || dow === 6;
    if (isWknd && !st.countsOnWeekend) continue;
    const hrs = overrideMap.get(`${a.providerId}:${a.shiftTypeId}`) ?? st.defaultHours;
    providerHours[a.providerId] = (providerHours[a.providerId] || 0) + hrs;
  }

  const dateRange = {
    min: assignments.length > 0
      ? assignments.reduce((min, a) => a.date < min ? a.date : min, assignments[0].date).toISOString().split("T")[0]
      : "",
    max: assignments.length > 0
      ? assignments.reduce((max, a) => a.date > max ? a.date : max, assignments[0].date).toISOString().split("T")[0]
      : "",
  };

  const equityData = equity.metrics.map((m) => {
    const dev = equity.deviations.get(m.providerId)!;
    const disp = equity.displayDeviations.get(m.providerId)!;
    const p = providers.find((p) => p.id === m.providerId)!;
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
      employmentTypeName: p.employmentType.name,
      totalHours: providerHours[m.providerId] || 0,
      shiftTally: shiftTallies[m.providerId] || {},
    };
  });

  const shiftCodes = [...new Set(
    Object.values(shiftTallies).flatMap((t) => Object.keys(t))
  )].sort();

  const n = equityData.length || 1;
  const deptAverages = {
    ...equity.averages,
    totalHours: equityData.reduce((s, d) => s + d.totalHours / (d.ftePercentage || 1), 0) / n,
    totalWorkDays: equityData.reduce((s, d) => s + d.totalWorkDays / (d.ftePercentage || 1), 0) / n,
    totalLeaveDays: equityData.reduce((s, d) => s + d.totalLeaveDays / (d.ftePercentage || 1), 0) / n,
  };

  return (
    <main className="flex flex-col h-screen">
      <NavHeader />
      <EquityPage
        data={equityData}
        averages={deptAverages}
        trackedShiftCodes={equity.trackedShiftCodes}
        dateRange={dateRange}
        shiftCodes={shiftCodes}
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
