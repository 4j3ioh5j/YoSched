import { prisma } from "@/lib/prisma";
import { computeFairness } from "@/lib/fairness";
import { EquityPage } from "./equity-page";
import { NavHeader } from "../nav-header";

export const dynamic = "force-dynamic";

export default async function Equity() {
  const [providers, shiftTypes, assignments, holidays, desirabilityWeights, payPeriods, schedPrefs] =
    await Promise.all([
      prisma.provider.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.assignment.findMany({ include: { shiftType: true } }),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
      prisma.desirabilityWeight.findMany(),
      prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
      prisma.schedulingPreferences.findFirst(),
    ]);

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
    })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId,
      dayOfWeek: dw.dayOfWeek,
      weight: dw.weight,
    })),
    holidays,
    fairnessDesirabilityWeight: schedPrefs?.fairnessDesirabilityWeight ?? 0.75,
    fairnessHolidayWeight: schedPrefs?.fairnessHolidayWeight ?? 0.25,
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
    const p = providers.find((p) => p.id === m.providerId)!;
    return {
      ...m,
      deviation: dev,
      name: p.name,
      isAutoScheduled: p.isAutoScheduled,
      ftePercentage: p.ftePercentage ?? 1.0,
      totalHours: providerHours[m.providerId] || 0,
      shiftTally: shiftTallies[m.providerId] || {},
    };
  });

  const shiftCodes = [...new Set(
    Object.values(shiftTallies).flatMap((t) => Object.keys(t))
  )].sort();

  return (
    <main className="flex flex-col h-screen">
      <NavHeader />
      <EquityPage
        data={equityData}
        averages={equity.averages}
        trackedShiftCodes={equity.trackedShiftCodes}
        dateRange={dateRange}
        shiftCodes={shiftCodes}
        equityThresholds={equityThresholds}
      />
    </main>
  );
}
