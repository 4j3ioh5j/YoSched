import { prisma } from "@/lib/prisma";
import { StaffPage } from "./staff-page";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
import { staffLoginStatus } from "@/lib/staff-login-status";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Staff() {
  const { error, permissions } = await getSession("staff:view");
  if (error) redirect("/");
  const [staff, employmentTypes, allShiftTypes] = await Promise.all([
    prisma.staff.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true,
        loginUser: { select: { isActive: true, email: true, passwordHash: true } },
      },
    }),
    prisma.employmentType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { defaultEligibleShifts: true, defaultAvailability: true },
    }),
    prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />

      <StaffPage
        canEdit={permissions!.includes("staff:edit")}
        staff={staff.map((p) => ({
          id: p.id,
          name: p.name,
          loginStatus: staffLoginStatus(p.loginUser),
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
            conditionStaffId: ar.conditionStaffId,
            conditionType: ar.conditionType,
          })),
          eligibleShiftTypeIds: p.eligibleShifts.map((es) => es.shiftTypeId),
          shiftEligibilityRules: p.shiftEligibilityRules.map((er) => ({
            shiftTypeId: er.shiftTypeId,
            dayOfWeek: er.dayOfWeek,
            type: er.type,
            strength: er.strength,
            pattern: er.pattern,
            cycleLength: er.cycleLength,
            cycleOffset: er.cycleOffset,
          })),
          shiftMinimumTargets: p.shiftMinimumTargets.map((mt) => ({
            shiftTypeId: mt.shiftTypeId,
            minCount: mt.minCount,
            maxCount: mt.maxCount,
            window: mt.window,
            windowDays: mt.windowDays,
            windowCount: mt.windowCount,
          })),
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
          autoSchedulable: st.autoSchedulable,
        }))}
      />
    </main>
  );
}
