import { prisma } from "@/lib/prisma";
import { computeFairness } from "@/lib/fairness";
import { ScheduleGrid } from "./schedule-grid";
import { NavHeader } from "./nav-header";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [providers, shiftTypes, assignments, payPeriods, holidays, providerOverrides, staffingMins, desirabilityWeights, staffingReqs, schedPrefs, equityFactors] =
    await Promise.all([
      prisma.provider.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        include: { availabilityRules: true, eligibleShifts: true },
      }),
      prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.assignment.findMany({
        include: { shiftType: true },
      }),
      prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
      prisma.providerShiftOverride.findMany(),
      prisma.staffingMinimum.findMany(),
      prisma.desirabilityWeight.findMany(),
      prisma.staffingRequirement.findMany(),
      prisma.schedulingPreferences.findFirst(),
      prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);

  const fairness = computeFairness({
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
      eligibleShiftTypeIds: p.eligibleShifts.map((es) => es.shiftTypeId),
    })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId,
      dayOfWeek: dw.dayOfWeek,
      weight: dw.weight,
    })),
    holidays,
    equityFactors,
  });

  const fairnessData: Record<string, { metrics: (typeof fairness.metrics)[0]; deviation: { desirability: number; holidayWork: number; overall: number } }> = {};
  for (const m of fairness.metrics) {
    const dev = fairness.deviations.get(m.providerId);
    if (dev) {
      fairnessData[m.providerId] = { metrics: m, deviation: dev };
    }
  }

  const shiftColorMap: Record<string, string> = {};
  for (const st of shiftTypes) {
    shiftColorMap[st.id] = st.color ?? "#6b7280";
  }

  const shiftCodeMap: Record<string, string> = {};
  for (const st of shiftTypes) {
    shiftCodeMap[st.id] = st.code;
  }

  return (
    <main className="flex flex-col h-screen">
      <NavHeader />

      <ScheduleGrid
        providers={providers.map((p) => ({
          id: p.id,
          initials: p.initials,
          name: p.name,
          ftePercentage: p.ftePercentage ?? 1.0,
          availabilityRules: p.availabilityRules.map((ar) => ({
            dayOfWeek: ar.dayOfWeek,
            type: ar.type,
            strength: ar.strength,
            pattern: ar.pattern,
            conditionProviderId: ar.conditionProviderId,
          })),
          isAutoScheduled: p.isAutoScheduled,
        }))}
        assignments={assignments.map((a) => ({
          id: a.id,
          providerId: a.providerId,
          date: a.date.toISOString().split("T")[0],
          shiftTypeId: a.shiftTypeId,
          isLocked: a.isLocked,
          code: shiftCodeMap[a.shiftTypeId] ?? "?",
          color: shiftColorMap[a.shiftTypeId] ?? "#6b7280",
        }))}
        shiftTypes={shiftTypes.map((st) => ({
          id: st.id,
          code: st.code,
          name: st.name,
          color: st.color ?? "#6b7280",
          category: st.category,
          isLeave: st.isLeave,
          isOffShift: st.isOffShift,
          ignoresWorkingDays: st.ignoresWorkingDays,
          noConsecutiveGroup: st.noConsecutiveGroup,
          defaultHours: st.defaultHours,
          countsTowardFte: st.countsTowardFte,
          countsOnWeekend: st.countsOnWeekend,
          postShiftRule: st.postShiftRule,
        }))}
        payPeriods={payPeriods.map((pp) => ({
          startDate: pp.startDate.toISOString().split("T")[0],
          endDate: pp.endDate.toISOString().split("T")[0],
          targetHours: pp.targetHours,
        }))}
        holidays={holidays.map((h) => ({
          date: h.date.toISOString().split("T")[0],
          name: h.name,
        }))}
        providerOverrides={providerOverrides.map((o) => ({
          providerId: o.providerId,
          shiftTypeId: o.shiftTypeId,
          durationHrs: o.durationHrs,
        }))}
        staffingMins={staffingMins.map((sm) => ({
          role: sm.role,
          dayType: sm.dayType,
          minimumCount: sm.minimumCount,
        }))}
        staffingReqs={staffingReqs.map((sr) => ({
          shiftCode: sr.shiftCode,
          dayKey: sr.dayKey,
          minCount: sr.minCount,
        }))}
        fairnessData={fairnessData}
        fairnessAverages={fairness.averages}
      />
    </main>
  );
}
