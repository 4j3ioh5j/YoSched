import { prisma } from "@/lib/prisma";
import { StaffPage } from "./staff-page";
import { NavHeader } from "../nav-header";
import { getPageSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { USER_SELECT, toClientUser } from "@/lib/user-view";
import { STAFF_PAGE_INCLUDE, toClientStaff } from "@/lib/staff-client-row";

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
      include: STAFF_PAGE_INCLUDE,
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
        staff={staff.map(toClientStaff)}
        employmentTypes={employmentTypes.map((et) => ({
          id: et.id,
          name: et.name,
          defaultIsAutoScheduled: et.defaultIsAutoScheduled,
          defaultFtePercentage: et.defaultFtePercentage,
          usesFtePercentage: et.usesFtePercentage,
          allowsFixedHours: et.allowsFixedHours,
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
