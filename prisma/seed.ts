import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashSync } from "bcryptjs";
import { resolveBootstrapPassword } from "../src/lib/seed-admin.js";
import { PERMISSION_KEYS } from "../src/lib/permission-catalog.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Shift Types ---
  const shiftTypes = [
    { code: "OR",     name: "Operating Room",       defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#3b82f6", sortOrder: 1, isFillShift: true, schedulePriority: 100 },
    { code: "ORC",    name: "OR Call",               defaultHours: 16, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#8b5cf6", printBackgroundColor: "#abcde2", sortOrder: 2, schedulePriority: 20, noConsecutiveGroup: "call-late", maxPerDay: 1, boldOnSchedule: true },
    { code: "ORL",    name: "OR Late",               defaultHours: 12, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#6366f1", printBackgroundColor: "#cae4aa", sortOrder: 3, schedulePriority: 30, noConsecutiveGroup: "call-late", maxPerDay: 1, boldOnSchedule: true },
    { code: "ADM",    name: "Administrative",         defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#f59e0b", sortOrder: 4 },
    { code: "PREOP",  name: "Pre-op Clinic",          defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#10b981", sortOrder: 5 },
    { code: "PAIN",   name: "Pain Service",           defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#ef4444", sortOrder: 7 },
    { code: "ICU",    name: "Intensive Care",          defaultHours: 10, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#dc2626", sortOrder: 8 },
    { code: "CARD",   name: "Cardiac",                defaultHours: 10, countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#e11d48", sortOrder: 9 },
    { code: "CALL",   name: "Weekend Call",            defaultHours: 0,  countsTowardFte: false, isLeave: false, isPaid: false, category: "work",  color: "#14b8a6", printBackgroundColor: "#abcde2", sortOrder: 10, schedulePriority: 10, weekendPaired: true, ignoresWorkingDays: true, noConsecutiveGroup: "call-late", maxPerDay: 1, boldOnSchedule: true },
    { code: "QA",     name: "Quality Assurance",       defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#0ea5e9", sortOrder: 11 },
    { code: "TEL",    name: "Telehealth",              defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#06b6d4", sortOrder: 12 },
    { code: "UCLA",   name: "UCLA Rotation",           defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#2563eb", sortOrder: 13 },
    { code: "CITC",   name: "Clinic",                  defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#059669", sortOrder: 14 },
    { code: "RS",     name: "Research",                defaultHours: 8,  countsTowardFte: true,  isLeave: false, isPaid: true,  category: "work",  color: "#7c3aed", sortOrder: 15 },
    { code: "AL",     name: "Annual Leave",            defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#84cc16", sortOrder: 20 },
    { code: "SL",     name: "Sick Leave",              defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#eab308", sortOrder: 21 },
    { code: "HOL",    name: "Holiday",                 defaultHours: 8,  countsTowardFte: false, isLeave: true,  isPaid: true,  category: "leave", color: "#f97316", printBackgroundColor: "#e5dbe6", sortOrder: 22 },
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

  // --- Employment Types ---
  const fteType = await prisma.employmentType.upsert({
    where: { name: "FTE" },
    update: {},
    create: { name: "FTE", defaultIsAutoScheduled: true, defaultFtePercentage: 1.0, sortOrder: 0 },
  });
  const feeBasisType = await prisma.employmentType.upsert({
    where: { name: "Fee Basis" },
    update: { collapsesIntoOther: true },
    create: { name: "Fee Basis", collapsesIntoOther: true, defaultIsAutoScheduled: false, defaultFtePercentage: 0, sortOrder: 1 },
  });
  console.log("Seeded 2 employment types");

  // --- Staff ---
  // Fee basis staff are ineligible for ORC, CALL, ORL
  const feeBasisInitials = new Set(["CWr", "NH", "PN", "HC"]);

  const staff = [
    { initials: "YA",  name: "YA",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 1 },
    { initials: "CC",  name: "CC",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 2 },
    { initials: "SC",  name: "SC",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 3 },
    { initials: "BC",  name: "BC",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 4 },
    { initials: "CD",  name: "CD",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 5 },
    { initials: "RD",  name: "RD",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 6, specialQualifications: ["cardiac"] },
    { initials: "DH",  name: "DH",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 7 },
    { initials: "SH",  name: "SH",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 8 },
    { initials: "AH",  name: "AH",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 9 },
    { initials: "CL",  name: "CL",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 10 },
    { initials: "RM",  name: "RM",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 11 },
    { initials: "LM",  name: "LM",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 12 },
    { initials: "KO",  name: "KO",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 13 },
    { initials: "AR",  name: "AR",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 14 },
    { initials: "SR",  name: "SR",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 15 },
    { initials: "SS",  name: "SS",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 16, specialQualifications: ["cardiac"] },
    { initials: "STa", name: "STa", employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 17 },
    { initials: "KZ",  name: "KZ",  employmentTypeId: fteType.id, ftePercentage: 1.0, sortOrder: 18 },
    { initials: "CWr", name: "CWr", employmentTypeId: feeBasisType.id, isAutoScheduled: false, sortOrder: 19 },
    { initials: "NH",  name: "NH",  employmentTypeId: feeBasisType.id, isAutoScheduled: false, sortOrder: 20 },
    { initials: "PN",  name: "PN",  employmentTypeId: feeBasisType.id, isAutoScheduled: false, sortOrder: 21 },
    { initials: "HC",  name: "HC",  employmentTypeId: feeBasisType.id, isAutoScheduled: false, sortOrder: 22 },
  ];

  for (const p of staff) {
    await prisma.staff.upsert({
      where: { initials: p.initials },
      update: p,
      create: p,
    });
  }
  console.log(`Seeded ${staff.length} staff`);

  // --- Eligible Shifts (join table) ---
  const allShiftTypeRecords = await prisma.shiftType.findMany();
  const allStaffRecords = await prisma.staff.findMany();
  const restrictedCodes = new Set(["ORC", "CALL", "ORL"]);

  await prisma.staffEligibleShift.deleteMany({});
  const eligibilityRows: { staffId: string; shiftTypeId: string }[] = [];
  for (const prov of allStaffRecords) {
    for (const st of allShiftTypeRecords) {
      if (feeBasisInitials.has(prov.initials) && restrictedCodes.has(st.code)) continue;
      eligibilityRows.push({ staffId: prov.id, shiftTypeId: st.id });
    }
  }
  await prisma.staffEligibleShift.createMany({ data: eligibilityRows });
  console.log(`Seeded ${eligibilityRows.length} staff eligible shifts`);

  // --- Employment Type Default Shifts (join table) ---
  await prisma.employmentTypeDefaultShift.deleteMany({});
  const etDefaultRows: { employmentTypeId: string; shiftTypeId: string }[] = [];
  for (const st of allShiftTypeRecords) {
    etDefaultRows.push({ employmentTypeId: fteType.id, shiftTypeId: st.id });
    if (!restrictedCodes.has(st.code)) {
      etDefaultRows.push({ employmentTypeId: feeBasisType.id, shiftTypeId: st.id });
    }
  }
  await prisma.employmentTypeDefaultShift.createMany({ data: etDefaultRows });
  console.log(`Seeded ${etDefaultRows.length} employment type default shifts`);

  // --- Default Availability Rules (employment types) ---
  await prisma.employmentTypeDefaultAvailability.deleteMany({});
  const fteDefaultDays = [1, 2, 3, 4, 5]; // Mon-Fri
  await prisma.employmentTypeDefaultAvailability.createMany({
    data: fteDefaultDays.map((d) => ({
      employmentTypeId: fteType.id,
      dayOfWeek: d,
      type: "available",
      strength: "rule",
      pattern: "every",
    })),
  });
  console.log("Seeded employment type default availability rules");

  // --- Staff Availability Rules ---
  await prisma.availabilityRule.deleteMany({});
  const availRules: { staffId: string; dayOfWeek: number; type: string; strength: string; pattern: string }[] = [];
  const defaultWorkDays = [1, 2, 3, 4, 5];
  const kzWorkDays = [1, 3]; // KZ only works Mon/Wed
  for (const prov of allStaffRecords) {
    const days = prov.initials === "KZ" ? kzWorkDays : (feeBasisInitials.has(prov.initials) ? [] : defaultWorkDays);
    for (const d of days) {
      availRules.push({ staffId: prov.id, dayOfWeek: d, type: "available", strength: "rule", pattern: "every" });
    }
  }
  if (availRules.length > 0) {
    await prisma.availabilityRule.createMany({ data: availRules });
  }
  console.log(`Seeded ${availRules.length} staff availability rules`);

  // --- Staff Shift Overrides ---
  const rdId = (await prisma.staff.findUnique({ where: { initials: "RD" } }))!.id;
  const koId = (await prisma.staff.findUnique({ where: { initials: "KO" } }))!.id;
  const cardId = (await prisma.shiftType.findUnique({ where: { code: "CARD" } }))!.id;
  const admId = (await prisma.shiftType.findUnique({ where: { code: "ADM" } }))!.id;
  const preopId = (await prisma.shiftType.findUnique({ where: { code: "PREOP" } }))!.id;

  const overrides = [
    { staffId: rdId, shiftTypeId: cardId, durationHrs: 8 },
    { staffId: koId, shiftTypeId: admId, durationHrs: 10 },
    { staffId: koId, shiftTypeId: preopId, durationHrs: 10 },
  ];

  for (const o of overrides) {
    await prisma.staffShiftOverride.upsert({
      where: { staffId_shiftTypeId: { staffId: o.staffId, shiftTypeId: o.shiftTypeId } },
      update: o,
      create: o,
    });
  }
  console.log(`Seeded ${overrides.length} staff shift overrides`);

  // --- KZ day preference ---
  const kzId = (await prisma.staff.findUnique({ where: { initials: "KZ" } }))!.id;
  const orcId = (await prisma.shiftType.findUnique({ where: { code: "ORC" } }))!.id;

  await prisma.staffDayPreference.upsert({
    where: { staffId_dayOfWeek: { staffId: kzId, dayOfWeek: 2 } },
    update: { preference: "ORC" },
    create: { staffId: kzId, dayOfWeek: 2, preference: "ORC" },
  });
  console.log("Seeded KZ day preference (ORC on Tuesday)");

  // --- STa standing commitment (Research) ---
  const staId = (await prisma.staff.findUnique({ where: { initials: "STa" } }))!.id;
  const rsId = (await prisma.shiftType.findUnique({ where: { code: "RS" } }))!.id;

  await prisma.standingCommitment.deleteMany({ where: { staffId: staId, shiftTypeId: rsId } });
  await prisma.standingCommitment.create({
    data: { staffId: staId, shiftTypeId: rsId, frequency: "weekly", notes: "Standing research days" },
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

  // --- Groups ---
  // Full permission set (Admin / Super User) comes from the shared catalog so it
  // never drifts from the API validator or the editor UI (see CR #578).
  const ALL_PERMISSIONS = PERMISSION_KEYS;

  const groupDefs = [
    { name: "Admin", permissions: ALL_PERMISSIONS, level: 3, isSystem: true, permissionsLocked: true },
    { name: "Super User", permissions: ALL_PERMISSIONS, level: 2, isSystem: true, permissionsLocked: true },
    { name: "Scheduler", permissions: ["schedule:view", "schedule:edit", "schedule:auto", "requests:view", "staff:view", "staff:edit", "statistics:view", "statistics:manage", "settings:view", "settings:edit"], level: 1, isSystem: true, permissionsLocked: false },
    { name: "Staff", permissions: ["schedule:view", "requests:self", "statistics:view", "settings:view"], level: 0, isSystem: true, permissionsLocked: false },
  ];

  for (const g of groupDefs) {
    await prisma.group.upsert({
      where: { name: g.name },
      update: { permissions: g.permissions, level: g.level, isSystem: g.isSystem, permissionsLocked: g.permissionsLocked },
      create: g,
    });
  }
  console.log(`Seeded ${groupDefs.length} groups`);

  const adminGroup = await prisma.group.findUnique({ where: { name: "Admin" } });

  // --- Bootstrap admin (only when nobody can administer the system) ---
  // NEVER plant a known-password admin. If any active user already has effective
  // `users:edit` we skip entirely (matches auth-guard's resolution: a grouped user's
  // perms come from the group, otherwise the role default — admin/manager include
  // users:edit). On a truly fresh DB we create ONE bootstrap admin using
  // SEED_ADMIN_PASSWORD if provided, else a random temp password printed once.
  // Every user belongs to a group (groupId is NOT NULL), so an administrator is simply an
  // active user whose group grants users:edit.
  const existingAdmins = await prisma.user.count({
    where: {
      isActive: true,
      group: { permissions: { has: "users:edit" } },
    },
  });
  if (existingAdmins > 0) {
    console.log(`Skipping bootstrap admin — ${existingAdmins} active administrator(s) already present.`);
  } else {
    const email = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@yosched.local";
    // The bootstrap email can already belong to a NON-admin or inactive login (those
    // don't count toward existingAdmins). Creating over it would throw a unique-constraint
    // error and abort the whole seed — detect the collision and skip with actionable advice
    // instead of crashing.
    const emailTaken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (emailTaken) {
      console.log(`WARNING: cannot bootstrap admin — ${email} is already in use by a non-administrator login.`);
      console.log("No active administrator exists. Set SEED_ADMIN_EMAIL to a free address (or promote/activate the");
      console.log("existing login from another admin session) and re-run the seed.");
    } else {
      const { password, fromEnv, envIgnored } = resolveBootstrapPassword(process.env.SEED_ADMIN_PASSWORD);
      await prisma.user.create({
        data: { email, name: "Admin", passwordHash: hashSync(password, 12), groupId: adminGroup!.id },
      });
      if (fromEnv) {
        console.log(`Created bootstrap admin ${email} using the provided SEED_ADMIN_PASSWORD.`);
      } else {
        // Generated password — ALWAYS reveal it, or the operator can't log in.
        if (envIgnored) {
          console.log("WARNING: SEED_ADMIN_PASSWORD was ignored (must be at least 8 characters).");
        }
        console.log("=".repeat(64));
        console.log(`Created bootstrap admin: ${email}`);
        console.log(`Temporary password (shown ONCE — log in and change it now): ${password}`);
        console.log("=".repeat(64));
      }
    }
  }
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
