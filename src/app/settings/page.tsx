import { prisma } from "@/lib/prisma";
import { SettingsPage } from "./settings-page";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
import { parsePendingRequestMode } from "@/lib/schedule-requests";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const { error, permissions } = await getSession("settings:view");
  if (error) redirect("/");
  const canEditSettings = permissions!.includes("settings:edit");
  const [shiftTypes, staffingReqs, payPeriods, holidays, desirabilityWeights, schedulingPrefsRow, employmentTypes, equityFactors, followRules, countColumns] = await Promise.all([
    prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.staffingRequirement.findMany({ orderBy: [{ shiftCode: "asc" }, { dayKey: "asc" }] }),
    prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.desirabilityWeight.findMany(),
    prisma.schedulingPreferences.findFirst(),
    prisma.employmentType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { staff: true } }, defaultEligibleShifts: true, defaultAvailability: true },
    }),
    prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftFollowRule.findMany(),
    prisma.countColumn.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const schedulingPrefs = {
    prefer3DayWeekends: schedulingPrefsRow?.prefer3DayWeekends ?? true,
    prefer4DayWeekends: schedulingPrefsRow?.prefer4DayWeekends ?? true,
    preferSequentialOff: schedulingPrefsRow?.preferSequentialOff ?? true,
    dateFormat: schedulingPrefsRow?.dateFormat ?? "MMMM D, YYYY",
    maxLeavePerDay: schedulingPrefsRow?.maxLeavePerDay ?? 0,
    collapseOtherOnPrint: schedulingPrefsRow?.collapseOtherOnPrint ?? true,
    pendingRequestMode: parsePendingRequestMode(schedulingPrefsRow?.pendingRequestMode),
  };

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />

      <SettingsPage
        shiftTypes={shiftTypes.map((st) => ({
          id: st.id,
          code: st.code,
          name: st.name,
          defaultHours: st.defaultHours,
          countsTowardFte: st.countsTowardFte,
          countsOnWeekend: st.countsOnWeekend,
          countsAsHolidayWork: st.countsAsHolidayWork,
          isLeave: st.isLeave,
          isPaid: st.isPaid,
          category: st.category,
          color: st.color ?? "#6b7280",
          sortOrder: st.sortOrder,
          schedulePriority: st.schedulePriority,
          isOffShift: st.isOffShift,
          isFillShift: st.isFillShift,
          weekendPaired: st.weekendPaired,
          ignoresWorkingDays: st.ignoresWorkingDays,
          maxPerDay: st.maxPerDay,
          autoSchedulable: st.autoSchedulable,
          hotkey: st.hotkey,
          dedicatedColumn: st.dedicatedColumn,
          boldOnSchedule: st.boldOnSchedule,
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
          defaultEligibleShiftTypeIds: et.defaultEligibleShifts.map((ds) => ds.shiftTypeId),
          defaultAvailabilityRules: et.defaultAvailability.map((da) => ({
            dayOfWeek: da.dayOfWeek,
            type: da.type,
            strength: da.strength,
            pattern: da.pattern,
          })),
          sortOrder: et.sortOrder,
          staffCount: et._count.staff,
        }))}
        equityFactors={equityFactors.map((f) => ({
          id: f.id,
          factorType: f.factorType,
          shiftCode: f.shiftCode,
          weight: f.weight,
          enabled: f.enabled,
          sortOrder: f.sortOrder,
        }))}
        shiftCodes={shiftTypes.filter((st) => !st.isOffShift && !st.isLeave).map((st) => st.code)}
        followRules={followRules.map((r) => ({
          id: r.id,
          sourceShiftId: r.sourceShiftId,
          allowedShiftId: r.allowedShiftId,
          allowOffShifts: r.allowOffShifts,
          mode: r.mode,
        }))}
        countColumns={countColumns.map((c) => ({
          id: c.id,
          label: c.label,
          shiftCodes: c.shiftCodes,
        }))}
        canEdit={canEditSettings}
      />
    </main>
  );
}
