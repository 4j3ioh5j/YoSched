import { prisma } from "@/lib/prisma";
import { StaffPage } from "./staff-page";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Staff() {
  const [providers, employmentTypes, allShiftTypes] = await Promise.all([
    prisma.provider.findMany({
      orderBy: { sortOrder: "asc" },
      include: { employmentType: true, eligibleShifts: true, availabilityRules: true },
    }),
    prisma.employmentType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { defaultEligibleShifts: true, defaultAvailability: true },
    }),
    prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <main className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700 bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xl font-bold tracking-tight hover:text-blue-400 transition-colors">
            YoSched
          </Link>
          <span className="text-sm text-slate-400">Staff</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
            Settings
          </Link>
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
            ← Schedule
          </Link>
        </div>
      </header>

      <StaffPage
        providers={providers.map((p) => ({
          id: p.id,
          name: p.name,
          initials: p.initials,
          employmentTypeId: p.employmentTypeId,
          employmentTypeName: p.employmentType.name,
          ftePercentage: p.ftePercentage ?? 1.0,
          availabilityRules: p.availabilityRules.map((ar) => ({
            dayOfWeek: ar.dayOfWeek,
            type: ar.type,
            strength: ar.strength,
            pattern: ar.pattern,
            cycleLength: ar.cycleLength,
            cycleOffset: ar.cycleOffset,
            conditionProviderId: ar.conditionProviderId,
            conditionType: ar.conditionType,
          })),
          eligibleShiftTypeIds: p.eligibleShifts.map((es) => es.shiftTypeId),
          specialQualifications: p.specialQualifications,
          isActive: p.isActive,
          isAutoScheduled: p.isAutoScheduled,
          sortOrder: p.sortOrder,
        }))}
        employmentTypes={employmentTypes.map((et) => ({
          id: et.id,
          name: et.name,
          defaultIsAutoScheduled: et.defaultIsAutoScheduled,
          defaultFtePercentage: et.defaultFtePercentage,
          defaultEligibleShiftTypeIds: et.defaultEligibleShifts.map((ds) => ds.shiftTypeId),
          defaultAvailabilityRules: et.defaultAvailability.map((da) => ({
            dayOfWeek: da.dayOfWeek,
            type: da.type,
            strength: da.strength,
            pattern: da.pattern,
          })),
        }))}
        allShiftTypes={allShiftTypes.map((st) => ({
          id: st.id,
          code: st.code,
          name: st.name,
          color: st.color ?? "#6b7280",
          category: st.category,
          isLeave: st.isLeave,
        }))}
      />
    </main>
  );
}
