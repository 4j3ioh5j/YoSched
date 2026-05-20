import { prisma } from "@/lib/prisma";
import { ScheduleGrid } from "./schedule-grid";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [providers, shiftTypes, assignments, payPeriods, holidays, providerOverrides, staffingMins] =
    await Promise.all([
      prisma.provider.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.assignment.findMany({
        include: { shiftType: true },
      }),
      prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
      prisma.providerShiftOverride.findMany(),
      prisma.staffingMinimum.findMany(),
    ]);

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
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">YoSched</h1>
          <span className="text-sm text-slate-400">Schedule Grid</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-400">
          <Link href="/staff" className="text-slate-400 hover:text-slate-200 transition-colors">
            Staff
          </Link>
          <Link href="/settings" className="text-slate-400 hover:text-slate-200 transition-colors">
            Settings
          </Link>
        </div>
      </header>

      <ScheduleGrid
        providers={providers.map((p) => ({
          id: p.id,
          initials: p.initials,
          name: p.name,
          employmentType: p.employmentType,
          ftePercentage: p.ftePercentage ?? 1.0,
          workingDays: p.workingDays,
          takesCall: p.takesCall,
          takesLate: p.takesLate,
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
      />
    </main>
  );
}
