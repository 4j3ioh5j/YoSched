import { prisma } from "@/lib/prisma";
import { SettingsPage } from "./settings-page";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
import { parsePendingRequestMode, parseRequestConflictPolicy, parseOffStrategyOrder, DEFAULT_OFF_STRATEGY_ORDER } from "@/lib/schedule-requests";
import { effectiveConditions, coerceConditions } from "@/lib/print-column-visibility";
import { parseLiveScope } from "@/lib/live-scope";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const { error, permissions } = await getSession("settings:view");
  if (error) redirect("/");
  const canEditSettings = permissions!.includes("settings:edit");
  const [shiftTypes, staffingReqs, payPeriods, holidays, desirabilityWeights, schedulingPrefsRow, departmentTargets, employmentTypes, equityFactors, followRules, requiredFollowers, countColumns, printColumnRules, printAggregateColumns, autoGenFactors, autoGenProfiles] = await Promise.all([
    prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.staffingRequirement.findMany({ orderBy: [{ shiftCode: "asc" }, { dayKey: "asc" }] }),
    prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
    prisma.desirabilityWeight.findMany(),
    prisma.schedulingPreferences.findFirst(),
    prisma.departmentShiftTarget.findMany({ orderBy: { shiftType: { sortOrder: "asc" } } }),
    prisma.employmentType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { staff: true } }, defaultEligibleShifts: true, defaultAvailability: true },
    }),
    prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftFollowRule.findMany(),
    prisma.requiredFollower.findMany(),
    prisma.countColumn.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.printColumnRule.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.printAggregateColumn.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.autoGenPriorityProfile.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  // Lenient read of the dept-default day-off order: drop tokens for since-deleted
  // leave shifts. Seed the canonical default only when no prefs row exists yet (an
  // existing row's explicit empty order is respected — "no preference").
  const leaveShiftIds = new Set(shiftTypes.filter((s) => s.isLeave && !s.isOffShift).map((s) => s.id));
  const schedulingPrefs = {
    prefer3DayWeekends: schedulingPrefsRow?.prefer3DayWeekends ?? true,
    prefer4DayWeekends: schedulingPrefsRow?.prefer4DayWeekends ?? true,
    preferSequentialOff: schedulingPrefsRow?.preferSequentialOff ?? true,
    dateFormat: schedulingPrefsRow?.dateFormat ?? "MMMM D, YYYY",
    maxLeavePerDay: schedulingPrefsRow?.maxLeavePerDay ?? 0,
    pendingRequestMode: parsePendingRequestMode(schedulingPrefsRow?.pendingRequestMode),
    requestConflictPolicy: parseRequestConflictPolicy(schedulingPrefsRow?.requestConflictPolicy),
    defaultOffStrategyOrder: schedulingPrefsRow
      ? parseOffStrategyOrder(schedulingPrefsRow.defaultOffStrategyOrder, leaveShiftIds)
      : [...DEFAULT_OFF_STRATEGY_ORDER],
    defaultLiveScope: parseLiveScope(schedulingPrefsRow?.defaultLiveScope),
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
          defaultHoursWeekend: st.defaultHoursWeekend,
          defaultHoursHoliday: st.defaultHoursHoliday,
          countsTowardFte: st.countsTowardFte,
          countsAsHolidayWork: st.countsAsHolidayWork,
          isLeave: st.isLeave,
          isPaid: st.isPaid,
          category: st.category,
          color: st.color ?? "#6b7280",
          printBackgroundColor: st.printBackgroundColor ?? null,
          sortOrder: st.sortOrder,
          schedulePriority: st.schedulePriority,
          isOffShift: st.isOffShift,
          isFillShift: st.isFillShift,
          weekendPaired: st.weekendPaired,
          holidayWeekendPaired: st.holidayWeekendPaired,
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
        departmentTargets={departmentTargets.map((d) => ({
          id: d.id,
          shiftTypeId: d.shiftTypeId,
          minCount: d.minCount,
          maxCount: d.maxCount,
          window: d.window,
          windowDays: d.windowDays,
          windowCount: d.windowCount,
          strength: d.strength,
          perFte: d.perFte,
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
        autoGenFactors={autoGenFactors.map((f) => ({
          id: f.id,
          key: f.key,
          label: f.label,
          sortOrder: f.sortOrder,
          enabled: f.enabled,
          hardness: f.hardness,
        }))}
        autoGenProfiles={autoGenProfiles.map((p) => ({
          id: p.id,
          name: p.name,
          order: Array.isArray(p.order) ? (p.order as string[]) : [],
          createdByName: p.createdByName,
          createdAt: p.createdAt.toISOString(),
        }))}
        shiftCodes={shiftTypes.filter((st) => !st.isOffShift && !st.isLeave).map((st) => st.code)}
        followRules={followRules.map((r) => ({
          id: r.id,
          sourceShiftId: r.sourceShiftId,
          allowedShiftId: r.allowedShiftId,
          allowOffShifts: r.allowOffShifts,
          mode: r.mode,
        }))}
        requiredFollowers={requiredFollowers.map((r) => ({
          id: r.id,
          sourceShiftId: r.sourceShiftId,
          followerShiftId: r.followerShiftId,
          scope: r.scope,
          countsTowardTargets: r.countsTowardTargets,
        }))}
        countColumns={countColumns.map((c) => ({
          id: c.id,
          label: c.label,
          shiftCodes: c.shiftCodes,
        }))}
        printColumnRules={printColumnRules.map((r) => ({
          id: r.id,
          label: r.label,
          enabled: r.enabled,
          mode: r.mode,
          employmentTypeIds: r.employmentTypeIds,
          minFtePercentage: r.minFtePercentage,
          maxFtePercentage: r.maxFtePercentage,
          conditions: effectiveConditions(r.conditions, r.shiftCodes, r.shiftMatch),
        }))}
        printAggregateColumns={printAggregateColumns.map((c) => ({
          id: c.id,
          label: c.label,
          enabled: c.enabled,
          isOther: c.isOther,
          suppressMembers: c.suppressMembers,
          employmentTypeIds: c.employmentTypeIds,
          minFtePercentage: c.minFtePercentage,
          maxFtePercentage: c.maxFtePercentage,
          conditions: coerceConditions(c.conditions),
          conditionScope: c.conditionScope,
        }))}
        canEdit={canEditSettings}
      />
    </main>
  );
}
