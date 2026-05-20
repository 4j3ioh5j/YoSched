import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Shift Types ---
  const shiftTypes = [
    { code: "OR",     name: "Operating Room",       defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#3b82f6", sortOrder: 1, isFillShift: true, schedulePriority: 100 },
    { code: "ORC",    name: "OR Call",               defaultHours: 16, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#6366f1", sortOrder: 2, postShiftRule: "day_off_after", schedulePriority: 20, eligibilityRule: "takesCall", noConsecutiveGroup: "call-late" },
    { code: "ORL",    name: "OR Late",               defaultHours: 12, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#8b5cf6", sortOrder: 3, schedulePriority: 30, eligibilityRule: "takesLate", noConsecutiveGroup: "call-late" },
    { code: "ADM",    name: "Administrative",         defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#f59e0b", sortOrder: 4 },
    { code: "PREOP",  name: "Pre-op Clinic",          defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#10b981", sortOrder: 5 },
    { code: "PAIN",   name: "Pain Service",           defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#ef4444", sortOrder: 7 },
    { code: "ICU",    name: "Intensive Care",          defaultHours: 10, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#dc2626", sortOrder: 8 },
    { code: "CARD",   name: "Cardiac",                defaultHours: 10, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#e11d48", sortOrder: 9 },
    { code: "CALL",   name: "Weekend Call",            defaultHours: 0,  countsTowardFte: false, isLeave: false, isPaid: false, category: "work",  color: "#a855f7", sortOrder: 10, schedulePriority: 10, weekendPaired: true, ignoresWorkingDays: true, eligibilityRule: "takesCall", noConsecutiveGroup: "call-late" },
    { code: "QA",     name: "Quality Assurance",       defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#0ea5e9", sortOrder: 11 },
    { code: "TEL",    name: "Telehealth",              defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#06b6d4", sortOrder: 12 },
    { code: "UCLA",   name: "UCLA Rotation",           defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#2563eb", sortOrder: 13 },
    { code: "CITC",   name: "Clinic",                  defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#059669", sortOrder: 14 },
    { code: "RS",     name: "Research",                defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#7c3aed", sortOrder: 15 },
    { code: "AL",     name: "Annual Leave",            defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#84cc16", sortOrder: 20 },
    { code: "SL",     name: "Sick Leave",              defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#eab308", sortOrder: 21 },
    { code: "HOL",    name: "Holiday",                 defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#f97316", sortOrder: 22 },
    { code: "PPL",    name: "Paid Parental Leave",     defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#a3e635", sortOrder: 23 },
    { code: "AA",     name: "Authorized Absence",      defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#fbbf24", sortOrder: 24 },
    { code: "ILD",    name: "Banked Hours Day Off",    defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#34d399", sortOrder: 25 },
    { code: "JD",     name: "Jury Duty",               defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#fcd34d", sortOrder: 26 },
    { code: "X",      name: "Off",                     defaultHours: 0,  countsTowardFte: false, isLeave: false, isPaid: false, category: "other", color: "#d1d5db", sortOrder: 99, isOffShift: true },
  ];

  for (const st of shiftTypes) {
    await prisma.shiftType.upsert({
      where: { code: st.code },
      update: st,
      create: st,
    });
  }
  console.log(`Seeded ${shiftTypes.length} shift types`);

  // --- Providers ---
  const providers = [
    { initials: "YA",  name: "YA",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 1 },
    { initials: "CC",  name: "CC",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 2 },
    { initials: "SC",  name: "SC",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 3 },
    { initials: "BC",  name: "BC",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 4 },
    { initials: "CD",  name: "CD",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 5 },
    { initials: "RD",  name: "RD",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 6, specialQualifications: ["cardiac"] },
    { initials: "DH",  name: "DH",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 7 },
    { initials: "SH",  name: "SH",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 8 },
    { initials: "AH",  name: "AH",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 9 },
    { initials: "CL",  name: "CL",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 10 },
    { initials: "RM",  name: "RM",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 11 },
    { initials: "LM",  name: "LM",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 12 },
    { initials: "KO",  name: "KO",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 13 },
    { initials: "AR",  name: "AR",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 14 },
    { initials: "SR",  name: "SR",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 15 },
    { initials: "SS",  name: "SS",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 16, specialQualifications: ["cardiac"] },
    { initials: "STa", name: "STa", employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 17 },
    { initials: "KZ",  name: "KZ",  employmentType: "fte", ftePercentage: 1.0, takesCall: true,  takesLate: true,  sortOrder: 18, workingDays: [1, 3] },
    { initials: "CWr", name: "CWr", employmentType: "fee_basis", takesCall: false, takesLate: false, sortOrder: 19 },
    { initials: "NH",  name: "NH",  employmentType: "fee_basis", takesCall: false, takesLate: false, sortOrder: 20 },
    { initials: "PN",  name: "PN",  employmentType: "fee_basis", takesCall: false, takesLate: false, sortOrder: 21 },
    { initials: "HC",  name: "HC",  employmentType: "fee_basis", takesCall: false, takesLate: false, sortOrder: 22 },
  ];

  for (const p of providers) {
    await prisma.provider.upsert({
      where: { initials: p.initials },
      update: p,
      create: p,
    });
  }
  console.log(`Seeded ${providers.length} providers`);

  // --- Provider Shift Overrides ---
  const rdId = (await prisma.provider.findUnique({ where: { initials: "RD" } }))!.id;
  const koId = (await prisma.provider.findUnique({ where: { initials: "KO" } }))!.id;
  const cardId = (await prisma.shiftType.findUnique({ where: { code: "CARD" } }))!.id;
  const admId = (await prisma.shiftType.findUnique({ where: { code: "ADM" } }))!.id;
  const preopId = (await prisma.shiftType.findUnique({ where: { code: "PREOP" } }))!.id;

  const overrides = [
    { providerId: rdId, shiftTypeId: cardId, durationHrs: 8 },
    { providerId: koId, shiftTypeId: admId, durationHrs: 10 },
    { providerId: koId, shiftTypeId: preopId, durationHrs: 10 },
  ];

  for (const o of overrides) {
    await prisma.providerShiftOverride.upsert({
      where: { providerId_shiftTypeId: { providerId: o.providerId, shiftTypeId: o.shiftTypeId } },
      update: o,
      create: o,
    });
  }
  console.log(`Seeded ${overrides.length} provider shift overrides`);

  // --- KZ day preference ---
  const kzId = (await prisma.provider.findUnique({ where: { initials: "KZ" } }))!.id;
  const orcId = (await prisma.shiftType.findUnique({ where: { code: "ORC" } }))!.id;

  await prisma.providerDayPreference.upsert({
    where: { providerId_dayOfWeek: { providerId: kzId, dayOfWeek: 2 } },
    update: { preference: "ORC" },
    create: { providerId: kzId, dayOfWeek: 2, preference: "ORC" },
  });
  console.log("Seeded KZ day preference (ORC on Tuesday)");

  // --- STa standing commitment (Research) ---
  const staId = (await prisma.provider.findUnique({ where: { initials: "STa" } }))!.id;
  const rsId = (await prisma.shiftType.findUnique({ where: { code: "RS" } }))!.id;

  await prisma.standingCommitment.deleteMany({ where: { providerId: staId, shiftTypeId: rsId } });
  await prisma.standingCommitment.create({
    data: { providerId: staId, shiftTypeId: rsId, frequency: "weekly", notes: "Standing research days" },
  });
  console.log("Seeded STa standing commitment (Research)");

  // --- Desirability Weights ---
  const orlId = (await prisma.shiftType.findUnique({ where: { code: "ORL" } }))!.id;

  const callId = (await prisma.shiftType.findUnique({ where: { code: "CALL" } }))!.id;

  const weights = [
    { shiftTypeId: callId, dayOfWeek: 6, weight: -2, reason: "Weekend call — gives up Saturday" },
    { shiftTypeId: callId, dayOfWeek: 0, weight: -2, reason: "Weekend call — gives up Sunday" },
    { shiftTypeId: orcId, dayOfWeek: 1, weight: -1, reason: "16-hour call shift" },
    { shiftTypeId: orcId, dayOfWeek: 2, weight: -1, reason: "16-hour call shift" },
    { shiftTypeId: orcId, dayOfWeek: 3, weight: -1, reason: "16-hour call shift" },
    { shiftTypeId: orcId, dayOfWeek: 4, weight: 2, reason: "Three-day weekend (Fri off after)" },
    { shiftTypeId: orcId, dayOfWeek: 5, weight: -2, reason: "Ruins weekend plans" },
    { shiftTypeId: orlId, dayOfWeek: 1, weight: -1, reason: "12-hour late shift" },
    { shiftTypeId: orlId, dayOfWeek: 2, weight: 2, reason: "Resident leaves at 3PM" },
    { shiftTypeId: orlId, dayOfWeek: 3, weight: -2, reason: "Nothing starts until 9AM" },
    { shiftTypeId: orlId, dayOfWeek: 4, weight: -1, reason: "12-hour late shift" },
    { shiftTypeId: orlId, dayOfWeek: 5, weight: -1, reason: "12-hour late shift" },
  ];

  for (const w of weights) {
    await prisma.desirabilityWeight.upsert({
      where: { shiftTypeId_dayOfWeek: { shiftTypeId: w.shiftTypeId, dayOfWeek: w.dayOfWeek } },
      update: w,
      create: w,
    });
  }
  console.log(`Seeded ${weights.length} desirability weights`);

  // --- Staffing Minimums (legacy) ---
  const staffingMins = [
    { role: "staff", dayType: "weekday", minimumCount: 6 },
    { role: "staff", dayType: "weekend", minimumCount: 1 },
    { role: "staff", dayType: "holiday", minimumCount: 1 },
  ];

  for (const sm of staffingMins) {
    await prisma.staffingMinimum.upsert({
      where: { role_dayType: { role: sm.role, dayType: sm.dayType } },
      update: sm,
      create: sm,
    });
  }
  console.log(`Seeded ${staffingMins.length} staffing minimums`);

  // --- Shift Count Rules (legacy) ---
  const shiftCountRules = [
    { shiftCode: "ORC", dayType: "weekday", exactCount: 1 },
    { shiftCode: "ORC", dayType: "holiday", exactCount: 1 },
    { shiftCode: "ORC", dayType: "weekend", exactCount: 0 },
    { shiftCode: "ORL", dayType: "weekday", exactCount: 1 },
    { shiftCode: "ORL", dayType: "holiday", exactCount: 0 },
    { shiftCode: "ORL", dayType: "weekend", exactCount: 0 },
  ];

  for (const rule of shiftCountRules) {
    await prisma.shiftCountRule.upsert({
      where: { shiftCode_dayType: { shiftCode: rule.shiftCode, dayType: rule.dayType } },
      update: rule,
      create: rule,
    });
  }
  console.log(`Seeded ${shiftCountRules.length} shift count rules`);

  // --- Staffing Requirements (per day-of-week grid) ---
  const WEEKDAYS = ["1", "2", "3", "4", "5"]; // Mon-Fri
  const WEEKENDS = ["0", "6"]; // Sun, Sat
  const staffReqs: { shiftCode: string; dayKey: string; minCount: number }[] = [];

  for (const day of WEEKDAYS) {
    staffReqs.push({ shiftCode: "OR", dayKey: day, minCount: 4 });
    staffReqs.push({ shiftCode: "ORC", dayKey: day, minCount: 1 });
    staffReqs.push({ shiftCode: "ORL", dayKey: day, minCount: 1 });
    staffReqs.push({ shiftCode: "CALL", dayKey: day, minCount: 0 });
  }
  for (const day of WEEKENDS) {
    staffReqs.push({ shiftCode: "OR", dayKey: day, minCount: 0 });
    staffReqs.push({ shiftCode: "ORC", dayKey: day, minCount: 0 });
    staffReqs.push({ shiftCode: "ORL", dayKey: day, minCount: 0 });
    staffReqs.push({ shiftCode: "CALL", dayKey: day, minCount: 1 });
  }
  staffReqs.push({ shiftCode: "OR", dayKey: "holiday", minCount: 0 });
  staffReqs.push({ shiftCode: "ORC", dayKey: "holiday", minCount: 0 });
  staffReqs.push({ shiftCode: "ORL", dayKey: "holiday", minCount: 0 });
  staffReqs.push({ shiftCode: "CALL", dayKey: "holiday", minCount: 1 });

  for (const req of staffReqs) {
    await prisma.staffingRequirement.upsert({
      where: { shiftCode_dayKey: { shiftCode: req.shiftCode, dayKey: req.dayKey } },
      update: req,
      create: req,
    });
  }
  console.log(`Seeded ${staffReqs.length} staffing requirements`);

  // --- FTE Targets ---
  const baseHours = 80;
  const fteTargets = [
    { ftePercentage: 1.0, targetHours: baseHours },
    { ftePercentage: 0.8, targetHours: baseHours * 0.8 },
    { ftePercentage: 0.6, targetHours: baseHours * 0.6 },
    { ftePercentage: 0.4, targetHours: baseHours * 0.4 },
    { ftePercentage: 0.2, targetHours: baseHours * 0.2 },
  ];

  for (const ft of fteTargets) {
    await prisma.fteTarget.upsert({
      where: { ftePercentage: ft.ftePercentage },
      update: ft,
      create: ft,
    });
  }
  console.log(`Seeded ${fteTargets.length} FTE targets`);

  // --- Pay Periods (biweekly, 2026) ---
  // Starting Sunday Dec 14, 2025 — generates 26 biweekly periods
  const ppStart = new Date("2025-12-14T00:00:00Z");
  let seededPPs = 0;
  for (let i = 0; i < 26; i++) {
    const start = new Date(ppStart);
    start.setDate(start.getDate() + i * 14);
    const end = new Date(start);
    end.setDate(end.getDate() + 13);
    const targetHours = 80;

    const startStr = start.toISOString().split("T")[0];
    const endStr = end.toISOString().split("T")[0];

    const existing = await prisma.payPeriod.findFirst({
      where: { startDate: new Date(startStr + "T00:00:00Z") },
    });
    if (!existing) {
      await prisma.payPeriod.create({
        data: {
          startDate: new Date(startStr + "T00:00:00Z"),
          endDate: new Date(endStr + "T00:00:00Z"),
          targetHours,
        },
      });
      seededPPs++;
    }
  }
  console.log(`Seeded ${seededPPs} pay periods`);

  // --- Scheduling Preferences ---
  await prisma.schedulingPreferences.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", prefer3DayWeekends: true, prefer4DayWeekends: true, preferSequentialOff: true },
  });
  console.log("Seeded scheduling preferences");
}

main()
  .then(() => {
    console.log("Seed complete");
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
