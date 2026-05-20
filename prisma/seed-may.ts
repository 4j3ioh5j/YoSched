import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// May 2026 schedule from PDF — provider columns in order
const PROVIDERS = ["YA","CC","SC","BC","CD","RD","DH","SH","AH","CL","RM","LM","KO","AR","SR","SS","STa","KZ"];

// Each row: [date, ...assignments per provider]
// Assignments not in our shift_types are mapped: CALL→CALL, UCLA→UCLA, CITC→CITC, QA→QA, TEL→TEL, RS→RS
// Skip OTHER/CARD/ICU summary columns — those are handled separately
const MAY: [string, ...string[]][] = [
  ["2026-05-01", "ADM","OR","X","SL","OR","ILD","ORC","AL","OR","X","X","ICU","X","X","ORL","X","X","X"],
  ["2026-05-02", "CALL","X","X","X","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X"],
  ["2026-05-03", "CALL","X","X","X","X","X","X","X","X","X","X","ICU","X","X","X","X","X","X"],
  ["2026-05-04", "ADM","TEL","OR","ORL","OR","OR","SL","AL","ADM","OR","X","ICU","PREOP","PAIN","X","ADM","X","ORC"],
  ["2026-05-05", "X","X","X","X","OR","OR","ORL","AL","UCLA","ORC","OR","ADM","PREOP","X","ICU","OR","X","X"],
  ["2026-05-06", "OR","X","CITC","OR","ORC","OR","OR","OR","ADM","X","PAIN","OR","PREOP","X","ICU","X","ORL","X"],
  ["2026-05-07", "ORL","ORC","X","OR","X","CARD","OR","OR","OR","X","X","OR","PREOP","X","ICU","X","OR","X"],
  ["2026-05-08", "OR","X","X","ORL","OR","OR","OR","OR","ADM","X","X","TEL","PREOP","X","ICU","X","ORC","X"],
  ["2026-05-09", "X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","ICU","X","X","X"],
  ["2026-05-10", "X","X","CALL","X","X","X","X","X","X","X","X","X","X","X","ICU","X","X","X"],
  ["2026-05-11", "OR","AL","ADM","OR","OR","ADM","OR","X","ADM","ORC","PAIN","AL","X","X","ICU","ADM","OR","ORL"],
  ["2026-05-12", "OR","X","X","TEL","ADM","OR","X","X","UCLA","X","X","AL","SL","OR","ADM","ICU","ORC","ORL"],
  ["2026-05-13", "ADM","X","CITC","OR","ORC","OR","ORL","OR","ADM","X","X","AL","PREOP","PAIN","UCLA","ICU","X","X"],
  ["2026-05-14", "AL","AL","X","ORC","X","OR","OR","AL","ADM","X","X","AL","PREOP","X","X","ICU","ORL","X"],
  ["2026-05-15", "ORL","SL","X","X","OR","ILD","OR","AL","OR","X","X","AL","X","X","ORC","ICU","QA","X"],
  ["2026-05-16", "X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X"],
  ["2026-05-17", "X","X","X","X","X","X","CALL","X","X","X","X","X","X","X","X","X","X","X"],
  ["2026-05-18", "OR","X","TEL","OR","OR","CARD","ADM","X","ADM","ORC","X","OR","AL","PAIN","JD","ADM","ORL","X"],
  ["2026-05-19", "OR","X","X","TEL","OR","OR","X","X","UCLA","OR","OR","ORL","PREOP","X","JD","ICU","OR","ORC"],
  ["2026-05-20", "ORC","X","CITC","ORL","OR","OR","X","X","ADM","X","PAIN","OR","PREOP","X","UCLA","ICU","OR","X"],
  ["2026-05-21", "X","OR","X","OR","ORC","OR","ORL","AL","ADM","X","X","TEL","JD","X","JD","ICU","OR","X"],
  ["2026-05-22", "OR","ORL","X","OR","X","CARD","OR","AL","OR","X","X","ORC","PPL","X","JD","ADM","X","X"],
  ["2026-05-23", "X","X","X","CALL","X","CARD","X","X","X","X","X","X","X","X","X","X","X","X"],
  ["2026-05-24", "X","X","X","CALL","X","CARD","X","X","X","X","X","X","X","X","X","X","X","X"],
  ["2026-05-25", "HOL","HOL","HOL","CALL","HOL","CARD","HOL","HOL","HOL","HOL","HOL","HOL","HOL","X","HOL","HOL","HOL","HOL"],
  ["2026-05-26", "ORC","X","X","ADM","OR","OR","ORL","ICU","UCLA","OR","X","X","AL","AL","OR","OR","OR","X"],
  ["2026-05-27", "X","X","AL","OR","ORC","OR","OR","ICU","ADM","X","X","ORL","AL","AL","UCLA","X","RS","OR"],
  ["2026-05-28", "OR","ORL","X","ORC","X","OR","OR","ICU","ADM","X","X","OR","AL","X","UCLA","X","QA","X"],
  ["2026-05-29", "ADM","OR","X","X","OR","ILD","ORC","ICU","OR","X","X","X","AL","X","OR","X","ORL","X"],
  ["2026-05-30", "X","CALL","X","X","X","X","X","ICU","X","X","X","X","X","X","X","X","X","X"],
  ["2026-05-31", "X","CALL","X","X","X","X","X","ICU","X","X","X","X","X","X","X","X","X","X"],
];

async function main() {
  // Clear existing assignments for May
  await prisma.assignment.deleteMany({
    where: {
      date: {
        gte: new Date("2026-05-01T00:00:00Z"),
        lte: new Date("2026-05-31T00:00:00Z"),
      },
    },
  });
  console.log("Cleared May assignments");

  // Build lookup maps
  const providerMap = new Map<string, string>();
  const allProviders = await prisma.provider.findMany();
  for (const p of allProviders) {
    providerMap.set(p.initials, p.id);
  }

  const shiftMap = new Map<string, string>();
  const allShifts = await prisma.shiftType.findMany();
  for (const s of allShifts) {
    shiftMap.set(s.code, s.id);
  }

  // Add 2026 federal holidays
  const federalHolidays = [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
    { date: "2026-02-16", name: "Presidents' Day" },
    { date: "2026-05-25", name: "Memorial Day" },
    { date: "2026-07-03", name: "Independence Day (observed)" },
    { date: "2026-09-07", name: "Labor Day" },
    { date: "2026-10-12", name: "Columbus Day" },
    { date: "2026-11-11", name: "Veterans Day" },
    { date: "2026-11-26", name: "Thanksgiving Day" },
    { date: "2026-12-25", name: "Christmas Day" },
  ];
  for (const h of federalHolidays) {
    await prisma.holiday.upsert({
      where: { date: new Date(h.date + "T00:00:00Z") },
      update: { name: h.name },
      create: { date: new Date(h.date + "T00:00:00Z"), name: h.name },
    });
  }
  console.log(`Seeded ${federalHolidays.length} federal holidays`);

  let created = 0;
  let skipped = 0;

  for (const row of MAY) {
    const date = row[0];
    const assignments = row.slice(1) as string[];

    for (let i = 0; i < PROVIDERS.length; i++) {
      const code = assignments[i];
      if (!code) continue;

      const providerId = providerMap.get(PROVIDERS[i]);
      const shiftTypeId = shiftMap.get(code);

      if (!providerId) {
        console.warn(`Provider not found: ${PROVIDERS[i]}`);
        skipped++;
        continue;
      }
      if (!shiftTypeId) {
        console.warn(`Shift type not found: ${code} (${PROVIDERS[i]} on ${date})`);
        skipped++;
        continue;
      }

      await prisma.assignment.create({
        data: {
          providerId,
          date: new Date(date + "T00:00:00Z"),
          shiftTypeId,
          source: "imported",
        },
      });
      created++;
    }
  }

  console.log(`Created ${created} assignments, skipped ${skipped}`);
}

main()
  .then(() => {
    console.log("May seed complete");
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
