import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoSchedule } from "@/lib/auto-scheduler";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { startDate, endDate } = body as { startDate: string; endDate: string };

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate required" },
      { status: 400 }
    );
  }

  const [
    providers,
    shiftTypes,
    existingAssignments,
    payPeriods,
    holidays,
    desirabilityWeights,
    standingCommitments,
    providerOverrides,
    dayPreferences,
    historicalAssignments,
    staffingRequirements,
    schedulingPrefsRow,
  ] = await Promise.all([
    prisma.provider.findMany({ where: { isActive: true } }),
    prisma.shiftType.findMany(),
    prisma.assignment.findMany({
      where: {
        date: {
          gte: new Date(startDate + "T00:00:00Z"),
          lte: new Date(endDate + "T00:00:00Z"),
        },
      },
      include: { shiftType: true },
    }),
    prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } }),
    prisma.holiday.findMany(),
    prisma.desirabilityWeight.findMany(),
    prisma.standingCommitment.findMany(),
    prisma.providerShiftOverride.findMany(),
    prisma.providerDayPreference.findMany(),
    prisma.assignment.findMany({
      where: {
        date: { lt: new Date(startDate + "T00:00:00Z") },
      },
      include: { shiftType: true },
    }),
    prisma.staffingRequirement.findMany(),
    prisma.schedulingPreferences.findFirst(),
  ]);

  const start = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
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

  const result = autoSchedule({
    dates,
    providers: providers.map((p) => ({
      id: p.id,
      initials: p.initials,
      employmentType: p.employmentType,
      ftePercentage: p.ftePercentage ?? 1.0,
      takesCall: p.takesCall,
      takesLate: p.takesLate,
      workingDays: p.workingDays,
      isActive: p.isActive,
      isAutoScheduled: p.isAutoScheduled,
      specialQualifications: p.specialQualifications,
    })),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id,
      code: st.code,
      name: st.name,
      defaultHours: st.defaultHours,
      countsTowardFte: st.countsTowardFte,
      countsOnWeekend: st.countsOnWeekend,
      isLeave: st.isLeave,
      isOffShift: st.isOffShift,
      isFillShift: st.isFillShift,
      schedulePriority: st.schedulePriority,
      weekendPaired: st.weekendPaired,
      ignoresWorkingDays: st.ignoresWorkingDays,
      eligibilityRule: st.eligibilityRule,
      noConsecutiveGroup: st.noConsecutiveGroup,
      maxPerDay: st.maxPerDay,
      category: st.category,
      postShiftRule: st.postShiftRule,
    })),
    existingAssignments: existingAssignments.map((a) => ({
      providerId: a.providerId,
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
      providerId: sc.providerId,
      shiftTypeId: sc.shiftTypeId,
      dayOfWeek: sc.dayOfWeek,
      frequency: sc.frequency,
    })),
    providerOverrides: providerOverrides.map((po) => ({
      providerId: po.providerId,
      shiftTypeId: po.shiftTypeId,
      durationHrs: po.durationHrs,
    })),
    dayPreferences: dayPreferences.map((dp) => ({
      providerId: dp.providerId,
      dayOfWeek: dp.dayOfWeek,
      preference: dp.preference,
    })),
    historicalAssignments: historicalAssignments.map((a) => ({
      providerId: a.providerId,
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
      fairnessDesirabilityWeight: schedulingPrefsRow?.fairnessDesirabilityWeight ?? 0.75,
      fairnessHolidayWeight: schedulingPrefsRow?.fairnessHolidayWeight ?? 0.25,
    },
  });

  return NextResponse.json(result);
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { suggestions } = body as {
    suggestions: Array<{
      providerId: string;
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
  for (const s of suggestions) {
    const result = await prisma.assignment.upsert({
      where: {
        providerId_date: {
          providerId: s.providerId,
          date: new Date(s.date + "T00:00:00Z"),
        },
      },
      update: { shiftTypeId: s.shiftTypeId, source: "auto" },
      create: {
        providerId: s.providerId,
        date: new Date(s.date + "T00:00:00Z"),
        shiftTypeId: s.shiftTypeId,
        source: "auto",
      },
    });
    const st = stMap.get(result.shiftTypeId);
    applied.push({
      id: result.id,
      providerId: result.providerId,
      date: result.date.toISOString().split("T")[0],
      shiftTypeId: result.shiftTypeId,
      isLocked: result.isLocked,
      code: st?.code ?? "?",
      color: st?.color ?? "#6b7280",
    });
  }

  return NextResponse.json({ applied });
}

export async function DELETE(req: NextRequest) {
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
      providerId: a.providerId,
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

  return NextResponse.json({ removed });
}
