import { prisma } from "@/lib/prisma";
import { computeFairness } from "@/lib/fairness";
import { ScheduleGrid } from "./schedule-grid";
import { NavHeader } from "./nav-header";
import { getSession } from "@/lib/auth-guard";
import { isRequestVisibleToViewer } from "@/lib/schedule-requests";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { error, permissions, staffId } = await getSession("schedule:view");
  if (error) redirect("/login");
  const canEdit = permissions!.includes("schedule:edit");
  // Viewing OTHER staff's requests requires requests:view. Users without it (e.g.
  // Staff) only ever see their OWN pending request chrome on the grid; everyone
  // else's pending asks are withheld server-side so they never reach the client.
  // Approved requests are honored as real shifts (the published schedule) and stay
  // visible to all — they're not "viewing a request" any more than seeing a shift.
  const canViewAllRequests = permissions!.includes("requests:view");
  const [staff, shiftTypes, assignments, payPeriods, holidays, staffOverrides, staffingMins, desirabilityWeights, staffingReqs, schedPrefs, equityFactors, followRules, countColumns, currentVersions, scheduleRequests] =
    await Promise.all([
      prisma.staff.findMany({
        // Active roster + any inactive staff that has assignments, so the grid
        // can show historical staff as columns on the months they worked.
        // computeFairness still gates on isActive && isAutoScheduled, so this does
        // not change the schedule's fairness badges.
        where: { OR: [{ isActive: true }, { assignments: { some: {} } }] },
        orderBy: { sortOrder: "asc" },
        include: { availabilityRules: true, eligibleShifts: true, employmentType: true },
      }),
      prisma.shiftType.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.assignment.findMany({
        include: { shiftType: true },
      }),
      prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
      prisma.holiday.findMany({ orderBy: { date: "asc" } }),
      prisma.staffShiftOverride.findMany(),
      prisma.staffingMinimum.findMany(),
      prisma.desirabilityWeight.findMany(),
      prisma.staffingRequirement.findMany(),
      prisma.schedulingPreferences.findFirst(),
      prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.shiftFollowRule.findMany(),
      prisma.countColumn.findMany({ orderBy: { sortOrder: "asc" } }),
      // Current saved version per month (metadata only) so the grid footer can
      // show the version number and detect live drift via snapshotHash.
      prisma.scheduleVersion.findMany({
        where: { isCurrent: true },
        select: { year: true, month: true, versionNumber: true, comment: true, snapshotHash: true, createdAt: true },
      }),
      // Schedule requests — the grid filters to the visible month client-side and
      // renders approved (live) vs pending (proposed) differently.
      prisma.scheduleRequest.findMany({ orderBy: { receivedAt: "desc" } }),
    ]);

  const fairness = computeFairness({
    assignments: assignments.map((a) => ({
      staffId: a.staffId,
      date: a.date.toISOString().split("T")[0],
      shiftType: {
        id: a.shiftType.id,
        code: a.shiftType.code,
        defaultHours: a.shiftType.defaultHours,
        countsTowardFte: a.shiftType.countsTowardFte,
        countsAsHolidayWork: a.shiftType.countsAsHolidayWork,
        isLeave: a.shiftType.isLeave,
        isOffShift: a.shiftType.isOffShift,
      },
    })),
    staff: staff.map((p) => ({
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

  const fairnessData: Record<string, { metrics: (typeof fairness.metrics)[0]; deviation: { desirability: number; holidayWork: number; overall: number }; displayDeviation: { desirability: number; holidayWork: number; overall: number } }> = {};
  for (const m of fairness.metrics) {
    const dev = fairness.deviations.get(m.staffId);
    const disp = fairness.displayDeviations.get(m.staffId);
    if (dev && disp) {
      fairnessData[m.staffId] = { metrics: m, deviation: dev, displayDeviation: disp };
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
    <main className="flex flex-col h-dvh">
      <NavHeader />

      <ScheduleGrid
        canEdit={canEdit}
        staff={staff.map((p) => ({
          id: p.id,
          initials: p.initials,
          name: p.name,
          ftePercentage: p.ftePercentage ?? 1.0,
          employmentTypeName: p.employmentType.name,
          collapsesIntoOther: p.employmentType.collapsesIntoOther,
          availabilityRules: p.availabilityRules.map((ar) => ({
            dayOfWeek: ar.dayOfWeek,
            type: ar.type,
            strength: ar.strength,
            pattern: ar.pattern,
            conditionStaffId: ar.conditionStaffId,
          })),
          isAutoScheduled: p.isAutoScheduled,
          isActive: p.isActive,
        }))}
        assignments={assignments.map((a) => ({
          id: a.id,
          staffId: a.staffId,
          date: a.date.toISOString().split("T")[0],
          shiftTypeId: a.shiftTypeId,
          isLocked: a.isLocked,
          updatedAt: a.updatedAt.toISOString(),
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
          defaultHours: st.defaultHours,
          countsTowardFte: st.countsTowardFte,
          countsOnWeekend: st.countsOnWeekend,
          hotkey: st.hotkey,
          dedicatedColumn: st.dedicatedColumn,
          boldOnSchedule: st.boldOnSchedule,
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
        staffOverrides={staffOverrides.map((o) => ({
          staffId: o.staffId,
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
        followRules={followRules.map((r) => ({
          sourceShiftId: r.sourceShiftId,
          allowedShiftId: r.allowedShiftId,
          allowOffShifts: r.allowOffShifts,
          mode: r.mode,
        }))}
        countColumns={countColumns.map((c) => ({
          label: c.label,
          shiftCodes: c.shiftCodes,
        }))}
        dateFormat={schedPrefs?.dateFormat ?? "MMMM D, YYYY"}
        collapseOtherOnPrint={schedPrefs?.collapseOtherOnPrint ?? true}
        currentVersions={currentVersions.map((v) => ({
          year: v.year,
          month: v.month,
          versionNumber: v.versionNumber,
          comment: v.comment,
          snapshotHash: v.snapshotHash,
          savedAt: v.createdAt.toISOString(),
        }))}
        scheduleRequests={scheduleRequests
          .filter((r) => isRequestVisibleToViewer(r, { canViewAll: canViewAllRequests, viewerStaffId: staffId }))
          .map((r) => ({
          id: r.id,
          staffId: r.staffId,
          startDate: r.startDate.toISOString().split("T")[0],
          endDate: r.endDate.toISOString().split("T")[0],
          kind: r.kind as "OFF" | "LEAVE" | "NEGATE_SHIFT" | "REQUEST_SHIFT",
          shiftTypeIds: r.shiftTypeIds,
          leaveShiftTypeId: r.leaveShiftTypeId,
          strength: r.strength as "hard" | "soft",
          status: r.status as "pending" | "approved" | "declined" | "withdrawn" | "fulfilled",
          receivedAt: r.receivedAt.toISOString(),
        }))}
      />
    </main>
  );
}
