import { autoSchedule } from "../src/lib/auto-scheduler";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://david:yosched@dph-devbox-yosched-staging:5432/yosched" });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const reqStartDate = "2026-08-01";
  const reqEndDate = "2026-08-31";

  const allPayPeriods = await prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } });
  const overlappingPPs = allPayPeriods.filter(pp => {
    const ppStart = pp.startDate.toISOString().split("T")[0];
    const ppEnd = pp.endDate.toISOString().split("T")[0];
    return ppEnd >= reqStartDate && ppStart <= reqEndDate;
  });
  const startDate = overlappingPPs.length > 0
    ? overlappingPPs.reduce((min, pp) => {
        const s = pp.startDate.toISOString().split("T")[0];
        return s < min ? s : min;
      }, reqStartDate)
    : reqStartDate;
  const endDate = overlappingPPs.length > 0
    ? overlappingPPs.reduce((max, pp) => {
        const e = pp.endDate.toISOString().split("T")[0];
        return e > max ? e : max;
      }, reqEndDate)
    : reqEndDate;

  console.log(`Requested: ${reqStartDate} to ${reqEndDate}`);
  console.log(`Effective: ${startDate} to ${endDate}`);

  const [
    providers, shiftTypes, existingAssignments, holidays,
    desirabilityWeights, standingCommitments, providerOverrides,
    dayPreferences, historicalAssignments, staffingRequirements,
    schedulingPrefsRow, providerEligibleShifts, availabilityRules, equityFactors,
  ] = await Promise.all([
    prisma.provider.findMany({ where: { isActive: true } }),
    prisma.shiftType.findMany(),
    prisma.assignment.findMany({
      where: {
        date: { gte: new Date(startDate + "T00:00:00Z"), lte: new Date(endDate + "T00:00:00Z") },
        OR: [{ source: "imported" }, { source: "manual" }, { isLocked: true }],
      },
      include: { shiftType: true },
    }),
    prisma.holiday.findMany(),
    prisma.desirabilityWeight.findMany(),
    prisma.standingCommitment.findMany(),
    prisma.providerShiftOverride.findMany(),
    prisma.providerDayPreference.findMany(),
    prisma.assignment.findMany({
      where: { date: { lt: new Date(startDate + "T00:00:00Z") } },
      include: { shiftType: true },
    }),
    prisma.staffingRequirement.findMany(),
    prisma.schedulingPreferences.findFirst(),
    prisma.providerEligibleShift.findMany(),
    prisma.availabilityRule.findMany(),
    prisma.equityFactor.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const payPeriods = allPayPeriods;

  const stMap = new Map(shiftTypes.map(st => [st.id, st]));
  const shiftCodeMap = new Map(shiftTypes.map(st => [st.id, st.code]));
  const eligibilityMap = new Map<string, string[]>();
  for (const pes of providerEligibleShifts) {
    if (!eligibilityMap.has(pes.providerId)) eligibilityMap.set(pes.providerId, []);
    eligibilityMap.get(pes.providerId)!.push(pes.shiftTypeId);
  }
  const rulesMap = new Map<string, typeof availabilityRules>();
  for (const ar of availabilityRules) {
    if (!rulesMap.has(ar.providerId)) rulesMap.set(ar.providerId, []);
    rulesMap.get(ar.providerId)!.push(ar);
  }

  const start = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }

  const result = autoSchedule({
    dates,
    providers: providers.map(p => ({
      id: p.id, initials: p.initials, ftePercentage: p.ftePercentage ?? 1.0,
      eligibleShiftTypeIds: eligibilityMap.get(p.id) ?? [],
      availabilityRules: (rulesMap.get(p.id) ?? []).map(ar => ({
        dayOfWeek: ar.dayOfWeek, type: ar.type as "available" | "unavailable",
        strength: ar.strength as "rule" | "preference",
        pattern: ar.pattern as "every" | "pp_week_1" | "pp_week_2" | "every_n",
        cycleLength: ar.cycleLength, cycleOffset: ar.cycleOffset,
        conditionProviderId: ar.conditionProviderId,
        conditionType: ar.conditionType as "working" | "not_working" | null,
      })),
      isActive: p.isActive, isAutoScheduled: p.isAutoScheduled,
      specialQualifications: p.specialQualifications,
    })),
    shiftTypes: shiftTypes.map(st => ({
      id: st.id, code: st.code, name: st.name, defaultHours: st.defaultHours,
      countsTowardFte: st.countsTowardFte, countsOnWeekend: st.countsOnWeekend,
      countsAsHolidayWork: st.countsAsHolidayWork,
      isLeave: st.isLeave, isOffShift: st.isOffShift, isFillShift: st.isFillShift,
      schedulePriority: st.schedulePriority, weekendPaired: st.weekendPaired,
      ignoresWorkingDays: st.ignoresWorkingDays, noConsecutiveGroup: st.noConsecutiveGroup,
      maxPerDay: st.maxPerDay, category: st.category, autoSchedulable: st.autoSchedulable,
    })),
    existingAssignments: existingAssignments.map(a => ({
      providerId: a.providerId, date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId, code: shiftCodeMap.get(a.shiftTypeId) ?? "?",
      isLocked: a.isLocked,
    })),
    payPeriods: payPeriods.map(pp => ({
      startDate: pp.startDate.toISOString().split("T")[0],
      endDate: pp.endDate.toISOString().split("T")[0],
      targetHours: pp.targetHours,
    })),
    holidays: holidays.map(h => ({ date: h.date.toISOString().split("T")[0] })),
    desirabilityWeights: desirabilityWeights.map(dw => ({
      shiftTypeId: dw.shiftTypeId, dayOfWeek: dw.dayOfWeek, weight: dw.weight,
    })),
    standingCommitments: standingCommitments.map(sc => ({
      providerId: sc.providerId, shiftTypeId: sc.shiftTypeId,
      dayOfWeek: sc.dayOfWeek, frequency: sc.frequency,
    })),
    providerOverrides: providerOverrides.map(po => ({
      providerId: po.providerId, shiftTypeId: po.shiftTypeId, durationHrs: po.durationHrs,
    })),
    dayPreferences: dayPreferences.map(dp => ({
      providerId: dp.providerId, dayOfWeek: dp.dayOfWeek, preference: dp.preference,
    })),
    historicalAssignments: historicalAssignments.map(a => ({
      providerId: a.providerId, date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId, code: shiftCodeMap.get(a.shiftTypeId) ?? "?",
      isLocked: a.isLocked,
    })),
    staffingRequirements: staffingRequirements.map(sr => ({
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
    equityFactors: equityFactors.map(f => ({
      factorType: f.factorType, shiftCode: f.shiftCode, weight: f.weight, enabled: f.enabled,
    })),
  });

  // Calculate hours per provider per PP (existing + new suggestions)
  const providerMap = new Map(providers.map(p => [p.id, p]));

  // Build a combined grid: existing + suggestions
  const allAssignments = new Map<string, string>(); // key -> shiftTypeId
  for (const a of existingAssignments) {
    const dateStr = a.date.toISOString().split("T")[0];
    allAssignments.set(`${a.providerId}:${dateStr}`, a.shiftTypeId);
  }
  for (const s of result.suggestions) {
    allAssignments.set(`${s.providerId}:${s.date}`, s.shiftTypeId);
  }

  // Find PPs overlapping with date range
  const displayPPs = payPeriods.filter(pp => {
    const ppStart = pp.startDate.toISOString().split("T")[0];
    const ppEnd = pp.endDate.toISOString().split("T")[0];
    return ppEnd >= startDate && ppStart <= endDate;
  });

  // Show DH's assignments for debugging
  const dhProvider = providers.find(p => p.initials === "DH");
  if (dhProvider) {
    console.log("\n=== DH assignments in PP Aug 9-22 ===");
    const dhSuggestions = result.suggestions.filter(s =>
      s.providerId === dhProvider.id && s.date >= "2026-08-09" && s.date <= "2026-08-22"
    );
    for (const s of dhSuggestions.sort((a, b) => a.date.localeCompare(b.date))) {
      const st = stMap.get(s.shiftTypeId);
      console.log(`  ${s.date} ${s.code.padEnd(5)} ${(st?.defaultHours ?? 0).toString().padStart(2)}hrs  [${s.step}] ${s.reason}`);
    }
    // Show existing too
    const dhExisting = existingAssignments.filter(a =>
      a.providerId === dhProvider.id
    ).map(a => ({ date: a.date.toISOString().split("T")[0], code: shiftCodeMap.get(a.shiftTypeId) ?? "?", source: "existing" }));
    for (const a of dhExisting.sort((x, y) => x.date.localeCompare(y.date))) {
      console.log(`  ${a.date} ${a.code.padEnd(5)} [existing]`);
    }
  }

  console.log("\n=== Hour totals per auto-scheduled provider ===");
  const autoProviders = providers.filter(p => p.isActive && p.isAutoScheduled);

  for (const pp of displayPPs) {
    const ppStart = pp.startDate.toISOString().split("T")[0];
    const ppEnd = pp.endDate.toISOString().split("T")[0];
    console.log(`\nPP ${ppStart} to ${ppEnd} (target=${pp.targetHours}hrs):`);

    for (const p of autoProviders.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
      const target = pp.targetHours * (p.ftePercentage ?? 1);
      let hours = 0;
      const cur = new Date(ppStart + "T12:00:00");
      const end = new Date(ppEnd + "T12:00:00");
      while (cur <= end) {
        const d = cur.toISOString().split("T")[0];
        const stId = allAssignments.get(`${p.id}:${d}`);
        if (stId) {
          const st = stMap.get(stId);
          if (st?.countsTowardFte) {
            const dow = cur.getDay();
            if (dow !== 0 && dow !== 6 || st.countsOnWeekend) {
              hours += st.defaultHours;
            }
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
      const diff = hours - target;
      const flag = diff !== 0 ? ` *** ${diff > 0 ? "+" : ""}${diff}` : "";
      if (diff !== 0) {
        console.log(`  ${p.initials.padEnd(4)} FTE=${(p.ftePercentage ?? 1).toFixed(1)}  target=${target.toString().padStart(3)}  actual=${hours.toString().padStart(3)}${flag}`);
      }
    }
  }

  console.log(`\nWarnings (${result.warnings.length}):`);
  for (const w of result.warnings) console.log(`  - ${w}`);

  console.log(`\nStats: ${result.stats.totalSlotsFilled} slots filled`);
  for (const [step, count] of Object.entries(result.stats.byStep)) {
    console.log(`  ${step}: ${count}`);
  }

  await prisma.$disconnect();
  pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
