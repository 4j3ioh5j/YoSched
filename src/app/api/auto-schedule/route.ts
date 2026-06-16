import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { autoSchedule } from "@/lib/auto-scheduler";
import { parsePendingRequestMode, type ScheduleRequestData } from "@/lib/schedule-requests";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";

export async function POST(req: NextRequest) {
  const { error } = await getSession("schedule:auto");
  if (error) return error;
  const body = await req.json();
  const { startDate, endDate } = body as { startDate: string; endDate: string };

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate required" },
      { status: 400 }
    );
  }

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
    scheduleRequests,
    requiredFollowers,
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

  const result = autoSchedule({
    dates,
    staff: staff.map((p) => ({
      id: p.id,
      initials: p.initials,
      ftePercentage: p.ftePercentage ?? 1.0,
      eligibleShiftTypeIds: eligibilityMap.get(p.id) ?? [],
      availabilityRules: (rulesMap.get(p.id) ?? []).map((ar) => ({
        dayOfWeek: ar.dayOfWeek,
        type: ar.type as "available" | "unavailable",
        strength: ar.strength as "rule" | "preference",
        pattern: ar.pattern as "every" | "pp_week_1" | "pp_week_2" | "every_n",
        cycleLength: ar.cycleLength,
        cycleOffset: ar.cycleOffset,
        conditionStaffId: ar.conditionStaffId,
        conditionType: ar.conditionType as "working" | "not_working" | null,
      })),
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      specialQualifications: p.specialQualifications,
      shiftEligibilityRules: (eligRulesMap.get(p.id) ?? []).map((er) => ({
        shiftTypeId: er.shiftTypeId,
        dayOfWeek: er.dayOfWeek,
        type: er.type as "eligible" | "ineligible",
        strength: er.strength as "rule" | "preference",
        pattern: er.pattern as "every" | "pp_week_1" | "pp_week_2" | "every_n",
        cycleLength: er.cycleLength,
        cycleOffset: er.cycleOffset,
      })),
      shiftMinimumTargets: (minTargetsMap.get(p.id) ?? []).map((mt) => ({
        shiftTypeId: mt.shiftTypeId,
        minCount: mt.minCount,
        maxCount: mt.maxCount,
        window: mt.window as "week" | "pay_period" | "month" | "days",
        windowDays: mt.windowDays,
      })),
    })),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id,
      code: st.code,
      name: st.name,
      defaultHours: st.defaultHours,
      countsTowardFte: st.countsTowardFte,
      countsOnWeekend: st.countsOnWeekend,
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
      dayOfWeek: sc.dayOfWeek,
      frequency: sc.frequency,
    })),
    staffOverrides: staffOverrides.map((po) => ({
      staffId: po.staffId,
      shiftTypeId: po.shiftTypeId,
      durationHrs: po.durationHrs,
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
    })),
    requiredFollowers: requiredFollowers.map((r) => ({
      sourceShiftId: r.sourceShiftId,
      followerShiftId: r.followerShiftId,
      scope: r.scope,
      countsTowardTargets: r.countsTowardTargets,
    })),
  });

  return NextResponse.json(result);
}

export async function PUT(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:auto");
  if (error) return error;
  const body = await req.json();
  const { suggestions } = body as {
    suggestions: Array<{
      staffId: string;
      date: string;
      shiftTypeId: string;
    }>;
  };

  if (!suggestions?.length) {
    return NextResponse.json({ error: "No suggestions to apply" }, { status: 400 });
  }

  const shiftTypes = await prisma.shiftType.findMany();
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));

  const applied = [];
  const skipped = [];
  for (const s of suggestions) {
    const existing = await prisma.assignment.findUnique({
      where: {
        staffId_date: {
          staffId: s.staffId,
          date: new Date(s.date + "T00:00:00Z"),
        },
      },
    });
    if (existing?.isLocked) {
      skipped.push({ staffId: s.staffId, date: s.date, reason: "locked" });
      continue;
    }
    const result = await prisma.assignment.upsert({
      where: {
        staffId_date: {
          staffId: s.staffId,
          date: new Date(s.date + "T00:00:00Z"),
        },
      },
      update: { shiftTypeId: s.shiftTypeId, source: "auto" },
      create: {
        staffId: s.staffId,
        date: new Date(s.date + "T00:00:00Z"),
        shiftTypeId: s.shiftTypeId,
        source: "auto",
      },
    });
    const st = stMap.get(result.shiftTypeId);
    applied.push({
      id: result.id,
      staffId: result.staffId,
      date: result.date.toISOString().split("T")[0],
      shiftTypeId: result.shiftTypeId,
      isLocked: result.isLocked,
      code: st?.code ?? "?",
      color: st?.color ?? "#6b7280",
    });
  }

  const requestChanges = await syncRequestApprovals(
    applied.map((a) => ({ staffId: a.staffId, date: a.date })),
    userId
  );

  return NextResponse.json({ applied, skipped, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}

export async function DELETE(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:auto");
  if (error) return error;
  const body = await req.json();
  const { startDate, endDate } = body as { startDate: string; endDate: string };

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });
  }

  const shiftTypes = await prisma.shiftType.findMany();
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));

  const toDelete = await prisma.assignment.findMany({
    where: {
      source: "auto",
      isLocked: false,
      date: {
        gte: new Date(startDate + "T00:00:00Z"),
        lte: new Date(endDate + "T00:00:00Z"),
      },
    },
  });

  const removed = toDelete.map((a) => {
    const st = stMap.get(a.shiftTypeId);
    return {
      id: a.id,
      staffId: a.staffId,
      date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId,
      isLocked: a.isLocked,
      code: st?.code ?? "?",
      color: st?.color ?? "#6b7280",
    };
  });

  await prisma.assignment.deleteMany({
    where: { id: { in: toDelete.map((a) => a.id) } },
  });

  const requestChanges = await syncRequestApprovals(
    removed.map((a) => ({ staffId: a.staffId, date: a.date })),
    userId
  );

  return NextResponse.json({ removed, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
