import { prisma } from "@/lib/prisma";
import { StaffPage } from "./staff-page";
import { NavHeader } from "../nav-header";
import { getPageSession } from "@/lib/auth-guard";
import { staffLoginStatus } from "@/lib/staff-login-status";
import { redirect } from "next/navigation";
import { USER_SELECT, toClientUser } from "@/lib/user-view";

export const dynamic = "force-dynamic";

export default async function Staff() {
  const { error, permissions } = await getPageSession("staff:view");
  if (error) redirect("/");
  // Linking logins to staff is a users:edit action (Admin / Super User). Only they get the
  // login list (names + emails) and the link controls; everyone else sees the badge.
  const canEditUsers = permissions!.includes("users:edit");
  const [staff, employmentTypes, allShiftTypes] = await Promise.all([
    prisma.staff.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true, standingCommitments: true, shiftOverrides: true,
        loginUser: { select: { id: true, isActive: true, email: true, passwordHash: true } },
      },
    }),
    prisma.employmentType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { defaultEligibleShifts: true, defaultAvailability: true },
    }),
    prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const rawLogins = canEditUsers ? await prisma.user.findMany({ select: USER_SELECT, orderBy: { name: "asc" } }) : [];
  const logins = rawLogins.map(toClientUser).map((u) => ({
    id: u.id, name: u.name, email: u.email, staffId: u.staffId, isActive: u.isActive, loginComplete: u.loginComplete, isShell: u.isShell,
  }));

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />

      <StaffPage
        canEdit={permissions!.includes("staff:edit")}
        canEditUsers={canEditUsers}
        logins={logins}
        staff={staff.map((p) => ({
          id: p.id,
          name: p.name,
          loginStatus: staffLoginStatus(p.loginUser),
          loginUserId: p.loginUser?.id ?? null,
          initials: p.initials,
          employmentTypeId: p.employmentTypeId,
          employmentTypeName: p.employmentType.name,
          ftePercentage: p.ftePercentage ?? 1.0,
          availabilityRules: p.availabilityRules.map((ar) => ({
            type: ar.type,
            strength: ar.strength,
            conditionStaffId: ar.conditionStaffId,
            conditionType: ar.conditionType,
            whenKind: ar.whenKind,
            whenDays: ar.whenDays,
            whenPpWeek: ar.whenPpWeek,
            whenOrds: ar.whenOrds,
            whenCycleUnit: ar.whenCycleUnit,
            whenCycleN: ar.whenCycleN,
            whenCycleOffset: ar.whenCycleOffset,
          })),
          eligibleShiftTypeIds: p.eligibleShifts.map((es) => es.shiftTypeId),
          shiftEligibilityRules: p.shiftEligibilityRules.map((er) => ({
            shiftTypeId: er.shiftTypeId,
            type: er.type,
            strength: er.strength,
            whenKind: er.whenKind,
            whenDays: er.whenDays,
            whenPpWeek: er.whenPpWeek,
            whenOrds: er.whenOrds,
            whenCycleUnit: er.whenCycleUnit,
            whenCycleN: er.whenCycleN,
            whenCycleOffset: er.whenCycleOffset,
          })),
          shiftMinimumTargets: p.shiftMinimumTargets.map((mt) => ({
            shiftTypeId: mt.shiftTypeId,
            minCount: mt.minCount,
            maxCount: mt.maxCount,
            window: mt.window,
            windowDays: mt.windowDays,
            windowCount: mt.windowCount,
          })),
          standingCommitments: p.standingCommitments.map((sc) => ({
            shiftTypeId: sc.shiftTypeId,
            notes: sc.notes,
            whenKind: sc.whenKind,
            whenDays: sc.whenDays,
            whenPpWeek: sc.whenPpWeek,
            whenOrds: sc.whenOrds,
            whenCycleUnit: sc.whenCycleUnit,
            whenCycleN: sc.whenCycleN,
            whenCycleOffset: sc.whenCycleOffset,
          })),
          shiftOverrides: p.shiftOverrides.map((o) => ({
            shiftTypeId: o.shiftTypeId,
            durationHrs: o.durationHrs,
            durationHrsWeekday: o.durationHrsWeekday,
            durationHrsWeekend: o.durationHrsWeekend,
            durationHrsHoliday: o.durationHrsHoliday,
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
            type: da.type,
            strength: da.strength,
            whenKind: da.whenKind,
            whenDays: da.whenDays,
            whenPpWeek: da.whenPpWeek,
            whenOrds: da.whenOrds,
            whenCycleUnit: da.whenCycleUnit,
            whenCycleN: da.whenCycleN,
            whenCycleOffset: da.whenCycleOffset,
          })),
        }))}
        allShiftTypes={allShiftTypes.map((st) => ({
          id: st.id,
          code: st.code,
          name: st.name,
          color: st.color ?? "#6b7280",
          category: st.category,
          isLeave: st.isLeave,
          isOffShift: st.isOffShift,
          autoSchedulable: st.autoSchedulable,
          defaultHours: st.defaultHours,
          defaultHoursWeekend: st.defaultHoursWeekend,
          defaultHoursHoliday: st.defaultHoursHoliday,
        }))}
      />
    </main>
  );
}
