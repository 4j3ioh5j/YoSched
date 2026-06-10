import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./src/generated/prisma/client";
import { autoSchedule } from "./src/lib/auto-scheduler";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const startDate = "2026-08-01";
  const endDate = "2026-08-31";

  const allPayPeriods = await prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } });

  const overlappingPPs = allPayPeriods.filter((pp) => {
    const ppStart = pp.startDate.toISOString().split("T")[0];
    const ppEnd = pp.endDate.toISOString().split("T")[0];
    return ppEnd >= startDate && ppStart <= endDate;
  });

  const effectiveStart = overlappingPPs.reduce((min, pp) => {
    const s = pp.startDate.toISOString().split("T")[0];
    return s < min ? s : min;
  }, startDate);
  const effectiveEnd = overlappingPPs.reduce((max, pp) => {
    const e = pp.endDate.toISOString().split("T")[0];
    return e > max ? e : max;
  }, endDate);

  const [
    staff, shiftTypes, existingAssignments, holidays,
    desirabilityWeights, standingCommitments, staffOverrides,
    dayPreferences, historicalAssignments, staffingRequirements,
    schedulingPrefsRow, staffEligibleShifts, availabilityRules,
    equityFactors, followRules,
  ] = await Promise.all([
    prisma.staff.findMany({ where: { isActive: true } }),
    prisma.shiftType.findMany(),
    prisma.assignment.findMany({
      where: { date: { gte: new Date(effectiveStart + "T00:00:00Z"), lte: new Date(effectiveEnd + "T00:00:00Z") } },
      include: { shiftType: true },
    }),
    prisma.holiday.findMany(),
    prisma.desirabilityWeight.findMany(),
    prisma.standingCommitment.findMany(),
    prisma.staffShiftOverride.findMany(),
    prisma.staffDayPreference.findMany(),
    prisma.assignment.findMany({
      where: { date: { lt: new Date(effectiveStart + "T00:00:00Z") } },
      include: { shiftType: true },
    }),
    prisma.staffingRequirement.findMany(),
    prisma.schedulingPreferences.findFirst(),
    prisma.staffEligibleShift.findMany(),
    prisma.availabilityRule.findMany(),
    prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shiftFollowRule.findMany(),
  ]);

  const shiftCodeMap = new Map<string, string>();
  for (const st of shiftTypes) shiftCodeMap.set(st.id, st.code);

  const eligibilityMap = new Map<string, string[]>();
  for (const pes of staffEligibleShifts) {
    if (!eligibilityMap.has(pes.staffId)) eligibilityMap.set(pes.staffId, []);
    eligibilityMap.get(pes.staffId)!.push(pes.shiftTypeId);
  }

  const rulesMap = new Map<string, typeof availabilityRules>();
  for (const ar of availabilityRules) {
    if (!rulesMap.has(ar.staffId)) rulesMap.set(ar.staffId, []);
    rulesMap.get(ar.staffId)!.push(ar);
  }

  const result = autoSchedule({
    dates: (() => {
      const dates: string[] = [];
      const cur = new Date(effectiveStart + "T12:00:00");
      const end = new Date(effectiveEnd + "T12:00:00");
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, "0");
        const d = String(cur.getDate()).padStart(2, "0");
        dates.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
      }
      return dates;
    })(),
    staff: staff.map((p) => ({
      id: p.id, initials: p.initials, ftePercentage: p.ftePercentage ?? 1.0,
      eligibleShiftTypeIds: eligibilityMap.get(p.id) ?? [],
      availabilityRules: (rulesMap.get(p.id) ?? []).map((ar) => ({
        dayOfWeek: ar.dayOfWeek, type: ar.type as "available" | "unavailable",
        strength: ar.strength as "rule" | "preference",
        pattern: ar.pattern as "every" | "pp_week_1" | "pp_week_2" | "every_n",
        cycleLength: ar.cycleLength, cycleOffset: ar.cycleOffset,
        conditionStaffId: ar.conditionStaffId,
        conditionType: ar.conditionType as "working" | "not_working" | null,
      })),
      isActive: p.isActive, isAutoScheduled: p.isAutoScheduled,
      specialQualifications: p.specialQualifications,
    })),
    shiftTypes: shiftTypes.map((st) => ({
      id: st.id, code: st.code, name: st.name, defaultHours: st.defaultHours,
      countsTowardFte: st.countsTowardFte, countsOnWeekend: st.countsOnWeekend,
      countsAsHolidayWork: st.countsAsHolidayWork,
      isLeave: st.isLeave, isOffShift: st.isOffShift, isFillShift: st.isFillShift,
      schedulePriority: st.schedulePriority, weekendPaired: st.weekendPaired,
      ignoresWorkingDays: st.ignoresWorkingDays, maxPerDay: st.maxPerDay,
      category: st.category, autoSchedulable: st.autoSchedulable,
    })),
    existingAssignments: existingAssignments.filter(a => a.isLocked).map((a) => ({
      staffId: a.staffId, date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId, code: shiftCodeMap.get(a.shiftTypeId) ?? "?", isLocked: a.isLocked,
    })),
    payPeriods: allPayPeriods.map((pp) => ({
      startDate: pp.startDate.toISOString().split("T")[0],
      endDate: pp.endDate.toISOString().split("T")[0],
      targetHours: pp.targetHours,
    })),
    holidays: holidays.map((h) => ({ date: h.date.toISOString().split("T")[0] })),
    desirabilityWeights: desirabilityWeights.map((dw) => ({
      shiftTypeId: dw.shiftTypeId, dayOfWeek: dw.dayOfWeek, weight: dw.weight,
    })),
    standingCommitments: standingCommitments.map((sc) => ({
      staffId: sc.staffId, shiftTypeId: sc.shiftTypeId,
      dayOfWeek: sc.dayOfWeek, frequency: sc.frequency,
    })),
    staffOverrides: staffOverrides.map((po) => ({
      staffId: po.staffId, shiftTypeId: po.shiftTypeId, durationHrs: po.durationHrs,
    })),
    dayPreferences: dayPreferences.map((dp) => ({
      staffId: dp.staffId, dayOfWeek: dp.dayOfWeek, preference: dp.preference,
    })),
    historicalAssignments: historicalAssignments.map((a) => ({
      staffId: a.staffId, date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId, code: shiftCodeMap.get(a.shiftTypeId) ?? "?", isLocked: a.isLocked,
    })),
    staffingRequirements: staffingRequirements.map((sr) => ({
      shiftCode: sr.shiftCode, dayKey: sr.dayKey, minCount: sr.minCount,
    })),
    schedulingPreferences: {
      prefer3DayWeekends: schedulingPrefsRow?.prefer3DayWeekends ?? true,
      prefer4DayWeekends: schedulingPrefsRow?.prefer4DayWeekends ?? true,
      preferSequentialOff: schedulingPrefsRow?.preferSequentialOff ?? true,
      sequentialOffWeight: schedulingPrefsRow?.sequentialOffWeight ?? 2,
      threeDayWeekendWeight: schedulingPrefsRow?.threeDayWeekendWeight ?? 5,
      fourDayWeekendWeight: schedulingPrefsRow?.fourDayWeekendWeight ?? 8,
    },
    equityFactors: equityFactors.map((f) => ({
      factorType: f.factorType, shiftCode: f.shiftCode, weight: f.weight, enabled: f.enabled,
    })),
    followRules: followRules.map((r) => ({
      sourceShiftId: r.sourceShiftId, allowedShiftId: r.allowedShiftId,
      allowOffShifts: r.allowOffShifts, mode: r.mode,
    })),
  });

  // Show ORL/ORC/CALL placement per staff per PP
  const ppList = allPayPeriods
    .map(pp => ({ start: pp.startDate.toISOString().split("T")[0], end: pp.endDate.toISOString().split("T")[0] }))
    .filter(pp => pp.end >= "2026-08-01" && pp.start <= "2026-08-31")
    .sort((a, b) => a.start.localeCompare(b.start));

  const provMap = new Map(staff.map(p => [p.id, p.initials]));
  const hardShifts = new Set(["ORL", "ORC", "CALL"]);

  for (const pp of ppList) {
    console.log(`\n=== PP ${pp.start} to ${pp.end} ===`);

    // Build grid per staff
    const staffGrid = new Map<string, Map<string, string>>();
    for (const s of result.suggestions) {
      if (s.date < pp.start || s.date > pp.end) continue;
      const initials = provMap.get(s.staffId) ?? s.staffId;
      if (!staffGrid.has(initials)) staffGrid.set(initials, new Map());
      staffGrid.get(initials)!.set(s.date, s.code);
    }

    // Generate all dates in PP
    const ppDates: string[] = [];
    const c = new Date(pp.start + "T12:00:00");
    const e = new Date(pp.end + "T12:00:00");
    while (c <= e) {
      ppDates.push(c.toISOString().slice(0, 10));
      c.setDate(c.getDate() + 1);
    }

    const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    // Only show staff with ORL/ORC/CALL
    for (const [initials, dateMap] of [...staffGrid.entries()].sort()) {
      const hasHard = [...dateMap.values()].some(c => hardShifts.has(c));
      if (!hasHard) continue;

      const line = ppDates.map(d => {
        const code = dateMap.get(d) ?? "---";
        const dayName = dow[new Date(d + "T12:00:00").getDay()];
        return `${d.slice(5)}(${dayName}):${code.padEnd(4)}`;
      }).join(" ");
      console.log(`${initials.padEnd(3)} ${line}`);
    }
  }

  console.log("\n=== Warnings ===");
  for (const w of result.warnings) console.log(w);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
