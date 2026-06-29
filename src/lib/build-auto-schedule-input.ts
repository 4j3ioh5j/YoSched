// Builds the full AutoScheduleInput bundle from the database for a date range.
//
// Extracted from the POST /api/auto-schedule route (#231 S1b) so the SAME input
// the generator runs on can also be served to the browser (GET .../inputs) for
// Live mode's client-side what-if re-solves. Server-only (imports prisma); the
// returned value is plain JSON-serializable data (dates are "YYYY-MM-DD").

import { prisma } from "@/lib/prisma";
import { type AutoScheduleInput } from "@/lib/auto-scheduler";
import { parsePendingRequestMode, parseRequestConflictPolicy, parseOffStrategyOrder, type ScheduleRequestData } from "@/lib/schedule-requests";
import { effectiveTargetsForStaff, type DepartmentShiftTarget } from "@/lib/department-targets";

/**
 * Assemble the engine input for [startDate, endDate], expanded outward to cover
 * any pay period that overlaps the range (so per-PP math sees whole periods).
 */
export async function buildAutoScheduleInput(startDate: string, endDate: string): Promise<AutoScheduleInput> {
  const allPayPeriods = await prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } });

  const overlappingPPs = allPayPeriods.filter((pp) => {
    const ppStart = pp.startDate.toISOString().split("T")[0];
    const ppEnd = pp.endDate.toISOString().split("T")[0];
    return ppEnd >= startDate && ppStart <= endDate;
  });

  const effectiveStart = overlappingPPs.length > 0
    ? overlappingPPs.reduce((min, pp) => {
        const s = pp.startDate.toISOString().split("T")[0];
        return s < min ? s : min;
      }, startDate)
    : startDate;
  const effectiveEnd = overlappingPPs.length > 0
    ? overlappingPPs.reduce((max, pp) => {
        const e = pp.endDate.toISOString().split("T")[0];
        return e > max ? e : max;
      }, endDate)
    : endDate;

  const [
    staff,
    shiftTypes,
    existingAssignments,
    holidays,
    desirabilityWeights,
    standingCommitments,
    staffOverrides,
    dayPreferences,
    historicalAssignments,
    staffingRequirements,
    schedulingPrefsRow,
    staffEligibleShifts,
    availabilityRules,
    equityFactors,
    followRules,
    shiftEligibilityRules,
    shiftMinimumTargets,
    departmentTargets,
    scheduleRequests,
    requiredFollowers,
    autoGenFactors,
  ] = await Promise.all([
    prisma.staff.findMany({ where: { isActive: true } }),
    prisma.shiftType.findMany(),
    prisma.assignment.findMany({
      where: {
        date: {
          gte: new Date(effectiveStart + "T00:00:00Z"),
          lte: new Date(effectiveEnd + "T00:00:00Z"),
        },
      },
      include: { shiftType: true },
    }),
    prisma.holiday.findMany(),
    prisma.desirabilityWeight.findMany(),
    prisma.standingCommitment.findMany(),
    prisma.staffShiftOverride.findMany(),
    prisma.staffDayPreference.findMany(),
    prisma.assignment.findMany({
      where: {
        date: { lt: new Date(effectiveStart + "T00:00:00Z") },
      },
      include: { shiftType: true },
    }),
    prisma.staffingRequirement.findMany(),
    prisma.schedulingPreferences.findFirst(),
    prisma.staffEligibleShift.findMany(),
    prisma.availabilityRule.findMany(),
    prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftFollowRule.findMany(),
    prisma.shiftEligibilityRule.findMany(),
    prisma.shiftMinimumTarget.findMany(),
    prisma.departmentShiftTarget.findMany(),
    // Approved + pending requests overlapping the (effective) scheduling window.
    // Overlap = req.startDate <= windowEnd AND req.endDate >= windowStart. We always
    // load pending too; the scheduler's `pendingRequestMode` decides whether pending
    // requests exert force (and at what strength) — in "off" mode they're ignored.
    prisma.scheduleRequest.findMany({
      where: {
        status: { in: ["approved", "pending"] },
        startDate: { lte: new Date(effectiveEnd + "T00:00:00Z") },
        endDate: { gte: new Date(effectiveStart + "T00:00:00Z") },
      },
    }),
    prisma.requiredFollower.findMany(),
    prisma.autoGenFactor.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const payPeriods = allPayPeriods;

  const start = new Date(effectiveStart + "T12:00:00");
  const end = new Date(effectiveEnd + "T12:00:00");
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }

  const shiftCodeMap = new Map<string, string>();
  for (const st of shiftTypes) shiftCodeMap.set(st.id, st.code);

  // Department defaults only reach a staffer when the shift is auto-schedulable.
  // If a shift isn't auto-schedulable, its department target is a no-op for
  // everyone; combined with per-staff eligibility below, a dept default only
  // affects people for whom that shift is actually auto-scheduled.
  const autoSchedulableShiftIds = new Set(shiftTypes.filter((st) => st.autoSchedulable).map((st) => st.id));

  const eligibilityMap = new Map<string, string[]>();
  for (const pes of staffEligibleShifts) {
    if (!eligibilityMap.has(pes.staffId)) {
      eligibilityMap.set(pes.staffId, []);
    }
    eligibilityMap.get(pes.staffId)!.push(pes.shiftTypeId);
  }

  const rulesMap = new Map<string, typeof availabilityRules>();
  for (const ar of availabilityRules) {
    if (!rulesMap.has(ar.staffId)) {
      rulesMap.set(ar.staffId, []);
    }
    rulesMap.get(ar.staffId)!.push(ar);
  }

  const eligRulesMap = new Map<string, typeof shiftEligibilityRules>();
  for (const er of shiftEligibilityRules) {
    if (!eligRulesMap.has(er.staffId)) {
      eligRulesMap.set(er.staffId, []);
    }
    eligRulesMap.get(er.staffId)!.push(er);
  }

  const minTargetsMap = new Map<string, typeof shiftMinimumTargets>();
  for (const mt of shiftMinimumTargets) {
    if (!minTargetsMap.has(mt.staffId)) {
      minTargetsMap.set(mt.staffId, []);
    }
    minTargetsMap.get(mt.staffId)!.push(mt);
  }

  // Department-wide "Pay-period preferences": defaults expressed per 1.0 FTE that
  // apply to every staffer, scaled to their FTE and overridden by any per-staff
  // target sharing the same (shift, window, windowCount). Normalize the window
  // union once so the FTE-scaling helper stays typed.
  const deptTargets: DepartmentShiftTarget[] = departmentTargets.map((d) => ({
    shiftTypeId: d.shiftTypeId,
    minCount: d.minCount,
    maxCount: d.maxCount,
    window: d.window as "week" | "pay_period" | "month" | "days",
    windowDays: d.windowDays,
    windowCount: d.windowCount,
    strength: d.strength === "rule" ? "rule" : "preference",
    perFte: d.perFte,
  }));

  return {
    dates,
    staff: staff.map((p) => ({
      id: p.id,
      initials: p.initials,
      ftePercentage: p.ftePercentage ?? 1.0,
      eligibleShiftTypeIds: eligibilityMap.get(p.id) ?? [],
      availabilityRules: (rulesMap.get(p.id) ?? []).map((ar) => ({
        type: ar.type as "available" | "unavailable",
        strength: ar.strength as "rule" | "preference",
        conditionStaffId: ar.conditionStaffId,
        conditionType: ar.conditionType as "working" | "not_working" | null,
        // WHEN columns — the sole recurrence representation (slice 7).
        whenKind: ar.whenKind,
        whenDays: ar.whenDays,
        whenPpWeek: ar.whenPpWeek,
        whenOrds: ar.whenOrds,
        whenCycleUnit: ar.whenCycleUnit,
        whenCycleN: ar.whenCycleN,
        whenCycleOffset: ar.whenCycleOffset,
      })),
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      specialQualifications: p.specialQualifications,
      shiftEligibilityRules: (eligRulesMap.get(p.id) ?? []).map((er) => ({
        shiftTypeId: er.shiftTypeId,
        type: er.type as "eligible" | "ineligible",
        strength: er.strength as "rule" | "preference",
        whenKind: er.whenKind,
        whenDays: er.whenDays,
        whenPpWeek: er.whenPpWeek,
        whenOrds: er.whenOrds,
        whenCycleUnit: er.whenCycleUnit,
        whenCycleN: er.whenCycleN,
        whenCycleOffset: er.whenCycleOffset,
      })),
      // Per-staff targets merged with FTE-scaled department defaults (staff wins
      // on a key collision). Slice 1 feeds these into the EXISTING min/max
      // machinery in the engine shape; the strength/source carried by
      // effectiveTargetsForStaff is consumed in slice 2 (soft-vs-hard).
      shiftMinimumTargets: effectiveTargetsForStaff(
        (minTargetsMap.get(p.id) ?? []).map((mt) => ({
          shiftTypeId: mt.shiftTypeId,
          minCount: mt.minCount,
          maxCount: mt.maxCount,
          window: mt.window as "week" | "pay_period" | "month" | "days",
          windowDays: mt.windowDays,
          windowCount: mt.windowCount,
        })),
        deptTargets,
        p.ftePercentage ?? 1.0,
        // Dept defaults apply only to shifts this staffer is eligible for AND that
        // are auto-schedulable — so ORL targets never touch staff who don't do ORL.
        new Set((eligibilityMap.get(p.id) ?? []).filter((id) => autoSchedulableShiftIds.has(id))),
      ).map((t) => ({
        shiftTypeId: t.shiftTypeId,
        minCount: t.minCount,
        maxCount: t.maxCount,
        window: t.window,
        windowDays: t.windowDays,
        windowCount: t.windowCount,
        // strength drives soft-vs-hard enforcement in the engine: per-staff
        // targets are "rule" (hard), department defaults carry their own strength.
        strength: t.strength,
      })),
    })),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id,
      code: st.code,
      name: st.name,
      defaultHours: st.defaultHours,
      defaultHoursWeekend: st.defaultHoursWeekend,
      defaultHoursHoliday: st.defaultHoursHoliday,
      countsTowardFte: st.countsTowardFte,
      countsAsHolidayWork: st.countsAsHolidayWork,
      isLeave: st.isLeave,
      isOffShift: st.isOffShift,
      isFillShift: st.isFillShift,
      sortOrder: st.sortOrder,
      schedulePriority: st.schedulePriority,
      weekendPaired: st.weekendPaired,
      holidayWeekendPaired: st.holidayWeekendPaired,
      ignoresWorkingDays: st.ignoresWorkingDays,
      maxPerDay: st.maxPerDay,
      category: st.category,
      autoSchedulable: st.autoSchedulable,
    })),
    existingAssignments: existingAssignments.map((a) => ({
      staffId: a.staffId,
      date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId,
      code: shiftCodeMap.get(a.shiftTypeId) ?? "?",
      isLocked: a.isLocked,
      source: a.source,
    })),
    payPeriods: payPeriods.map((pp) => ({
      startDate: pp.startDate.toISOString().split("T")[0],
      endDate: pp.endDate.toISOString().split("T")[0],
      targetHours: pp.targetHours,
    })),
    holidays: holidays.map((h) => ({
      date: h.date.toISOString().split("T")[0],
    })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId,
      dayOfWeek: dw.dayOfWeek,
      weight: dw.weight,
    })),
    standingCommitments: standingCommitments.map((sc) => ({
      staffId: sc.staffId,
      shiftTypeId: sc.shiftTypeId,
      whenKind: sc.whenKind,
      whenDays: sc.whenDays,
      whenPpWeek: sc.whenPpWeek,
      whenOrds: sc.whenOrds,
      whenCycleUnit: sc.whenCycleUnit,
      whenCycleN: sc.whenCycleN,
      whenCycleOffset: sc.whenCycleOffset,
    })),
    staffOverrides: staffOverrides.map((po) => ({
      staffId: po.staffId,
      shiftTypeId: po.shiftTypeId,
      durationHrs: po.durationHrs,
      durationHrsWeekday: po.durationHrsWeekday,
      durationHrsWeekend: po.durationHrsWeekend,
      durationHrsHoliday: po.durationHrsHoliday,
    })),
    dayPreferences: dayPreferences.map((dp) => ({
      staffId: dp.staffId,
      dayOfWeek: dp.dayOfWeek,
      preference: dp.preference,
    })),
    historicalAssignments: historicalAssignments.map((a) => ({
      staffId: a.staffId,
      date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId,
      code: shiftCodeMap.get(a.shiftTypeId) ?? "?",
      isLocked: a.isLocked,
    })),
    staffingRequirements: staffingRequirements.map((sr) => ({
      shiftCode: sr.shiftCode,
      dayKey: sr.dayKey,
      minCount: sr.minCount,
    })),
    schedulingPreferences: {
      prefer3DayWeekends: schedulingPrefsRow?.prefer3DayWeekends ?? true,
      prefer4DayWeekends: schedulingPrefsRow?.prefer4DayWeekends ?? true,
      preferSequentialOff: schedulingPrefsRow?.preferSequentialOff ?? true,
      sequentialOffWeight: schedulingPrefsRow?.sequentialOffWeight ?? 2,
      threeDayWeekendWeight: schedulingPrefsRow?.threeDayWeekendWeight ?? 5,
      fourDayWeekendWeight: schedulingPrefsRow?.fourDayWeekendWeight ?? 8,
      // Lenient parse: a missing/legacy/corrupt stored value falls back to the default.
      pendingRequestMode: parsePendingRequestMode(schedulingPrefsRow?.pendingRequestMode),
      maxLeavePerDay: schedulingPrefsRow?.maxLeavePerDay ?? 0,
      requestConflictPolicy: parseRequestConflictPolicy(schedulingPrefsRow?.requestConflictPolicy),
    },
    equityFactors: equityFactors.map((f) => ({
      factorType: f.factorType,
      shiftCode: f.shiftCode,
      weight: f.weight,
      enabled: f.enabled,
    })),
    followRules: followRules.map((r) => ({
      sourceShiftId: r.sourceShiftId,
      allowedShiftId: r.allowedShiftId,
      allowOffShifts: r.allowOffShifts,
      mode: r.mode,
    })),
    scheduleRequests: scheduleRequests.map((r) => ({
      id: r.id,
      staffId: r.staffId,
      startDate: r.startDate.toISOString().split("T")[0],
      endDate: r.endDate.toISOString().split("T")[0],
      kind: r.kind as ScheduleRequestData["kind"],
      shiftTypeIds: r.shiftTypeIds,
      leaveShiftTypeId: r.leaveShiftTypeId,
      strength: r.strength as ScheduleRequestData["strength"],
      status: r.status as ScheduleRequestData["status"],
      autoApproved: r.autoApproved,
      receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
      // Lenient parse: drops unknown/dup tokens (stale leave shifts can't be re-checked
      // here without the eligibility set, but the engine only acts on known tokens).
      offStrategyOrder: parseOffStrategyOrder(r.offStrategyOrder),
    })),
    requiredFollowers: requiredFollowers.map((r) => ({
      sourceShiftId: r.sourceShiftId,
      followerShiftId: r.followerShiftId,
      scope: r.scope,
      countsTowardTargets: r.countsTowardTargets,
    })),
    factorOrder: autoGenFactors.map((f) => ({
      key: f.key,
      sortOrder: f.sortOrder,
      enabled: f.enabled,
    })),
  };
}
