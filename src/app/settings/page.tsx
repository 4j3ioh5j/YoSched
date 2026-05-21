import { prisma } from "@/lib/prisma";
import { SettingsPage } from "./settings-page";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const [shiftTypes, staffingReqs, payPeriods, fteTargets, holidays, desirabilityWeights, schedulingPrefsRow, employmentTypes] = await Promise.all([
    prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.staffingRequirement.findMany({ orderBy: [{ shiftCode: "asc" }, { dayKey: "asc" }] }),
    prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
    prisma.fteTarget.findMany({ orderBy: { ftePercentage: "desc" } }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.desirabilityWeight.findMany(),
    prisma.schedulingPreferences.findFirst(),
    prisma.employmentType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { providers: true } } },
    }),
  ]);

  const schedulingPrefs = {
    prefer3DayWeekends: schedulingPrefsRow?.prefer3DayWeekends ?? true,
    prefer4DayWeekends: schedulingPrefsRow?.prefer4DayWeekends ?? true,
    preferSequentialOff: schedulingPrefsRow?.preferSequentialOff ?? true,
  };

  return (
    <main className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xl font-bold tracking-tight hover:text-blue-400 transition-colors">
            YoSched
          </Link>
          <span className="text-sm text-slate-400">Settings</span>
        </div>
        <Link
          href="/"
          className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          ← Back to Schedule
        </Link>
      </header>

      <SettingsPage
        shiftTypes={shiftTypes.map((st) => ({
          id: st.id,
          code: st.code,
          name: st.name,
          defaultHours: st.defaultHours,
          countsTowardFte: st.countsTowardFte,
          countsOnWeekend: st.countsOnWeekend,
          isLeave: st.isLeave,
          isPaid: st.isPaid,
          category: st.category,
          postShiftRule: st.postShiftRule,
          color: st.color ?? "#6b7280",
          sortOrder: st.sortOrder,
          schedulePriority: st.schedulePriority,
          isOffShift: st.isOffShift,
          isFillShift: st.isFillShift,
          weekendPaired: st.weekendPaired,
          ignoresWorkingDays: st.ignoresWorkingDays,
          eligibilityRule: st.eligibilityRule,
          noConsecutiveGroup: st.noConsecutiveGroup,
          maxPerDay: st.maxPerDay,
        }))}
        staffingReqs={staffingReqs.map((r) => ({
          id: r.id,
          shiftCode: r.shiftCode,
          dayKey: r.dayKey,
          minCount: r.minCount,
        }))}
        payPeriods={payPeriods.map((pp) => ({
          id: pp.id,
          startDate: pp.startDate.toISOString().split("T")[0],
          endDate: pp.endDate.toISOString().split("T")[0],
          targetHours: pp.targetHours,
        }))}
        fteTargets={fteTargets.map((ft) => ({
          id: ft.id,
          ftePercentage: ft.ftePercentage,
          targetHours: ft.targetHours,
        }))}
        holidays={holidays.map((h) => ({
          id: h.id,
          date: h.date.toISOString().split("T")[0],
          name: h.name,
        }))}
        desirabilityWeights={desirabilityWeights.map((dw) => ({
          id: dw.id,
          shiftTypeId: dw.shiftTypeId,
          dayOfWeek: dw.dayOfWeek,
          weight: dw.weight,
          reason: dw.reason,
        }))}
        schedulingPrefs={schedulingPrefs}
        employmentTypes={employmentTypes.map((et) => ({
          id: et.id,
          name: et.name,
          defaultIsAutoScheduled: et.defaultIsAutoScheduled,
          defaultFtePercentage: et.defaultFtePercentage,
          defaultTakesCall: et.defaultTakesCall,
          defaultTakesWeekendCall: et.defaultTakesWeekendCall,
          defaultTakesLate: et.defaultTakesLate,
          defaultWorkingDays: et.defaultWorkingDays,
          sortOrder: et.sortOrder,
          providerCount: et._count.providers,
        }))}
      />
    </main>
  );
}
