/**
 * seed-restore-roster-renames.ts — bridge from the May-2026 roster that seed.ts,
 * seed-historical.ts and seed-may.ts produce to the June-2026 roster the later
 * imports expect (prisma/data/*.json and the ICU/re-import seeds).
 *
 * In the live DB these changes were made through the app between May and June, so
 * no seed recorded them. A DB rebuilt from the repo (after the 2026-11 SSD loss)
 * needs them before seed-historical-import.ts, whose pre-flight otherwise fails
 * with missing PRE / AD, CW, MF, ST. Mapping source: handoff #108 (user-confirmed):
 *  - staff STa -> ST and CWr -> CW: same people, renamed (initials only).
 *  - shift code PREOP -> PRE: same shift type, renamed (code only).
 *  - AD and MF: existing CARD/OTHER-coverage staff with no main column. Created
 *    exactly like seed-historical.ts creates LS (Fee Basis, FTE 0, active).
 *
 * Rebuild order: seed.ts -> seed-historical.ts -> seed-may.ts -> THIS ->
 * seed-historical-import.ts -> ICU/re-import seeds (see docs/historical-schedule-import.md).
 *
 * Idempotent: a rename runs only when the old name exists and the new one does
 * not. It refuses (throws, nothing written) if both exist. DRY_RUN=1 previews.
 * Run on the VM: npx tsx prisma/seed-restore-roster-renames.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DRY_RUN = process.env.DRY_RUN === "1";

const STAFF_RENAMES: [from: string, to: string][] = [
  ["STa", "ST"],
  ["CWr", "CW"],
];
const SHIFT_RENAMES: [from: string, to: string][] = [["PREOP", "PRE"]];
const COVERAGE_STAFF = ["AD", "MF"];

async function main() {
  const feeBasis = await prisma.employmentType.findFirst({ where: { name: "Fee Basis" } });
  if (!feeBasis) throw new Error("Fee Basis employment type not found — run seed.ts first");

  // ---- Plan (read-only); refuse on any conflict before writing anything ----
  const staffOps: [string, string][] = [];
  for (const [from, to] of STAFF_RENAMES) {
    const [a, b] = await Promise.all([
      prisma.staff.findUnique({ where: { initials: from } }),
      prisma.staff.findUnique({ where: { initials: to } }),
    ]);
    if (a && b) throw new Error(`Both staff ${from} and ${to} exist — resolve by hand, nothing written`);
    if (a) staffOps.push([from, to]);
    else console.log(`skip staff ${from} -> ${to}: ${b ? "already renamed" : `${from} not found`}`);
  }
  const shiftOps: [string, string][] = [];
  for (const [from, to] of SHIFT_RENAMES) {
    const [a, b] = await Promise.all([
      prisma.shiftType.findUnique({ where: { code: from } }),
      prisma.shiftType.findUnique({ where: { code: to } }),
    ]);
    if (a && b) throw new Error(`Both shift codes ${from} and ${to} exist — resolve by hand, nothing written`);
    if (a) shiftOps.push([from, to]);
    else console.log(`skip shift ${from} -> ${to}: ${b ? "already renamed" : `${from} not found`}`);
  }
  const existing = await prisma.staff.findMany({ where: { initials: { in: COVERAGE_STAFF } } });
  const toCreate = COVERAGE_STAFF.filter((i) => !existing.some((s) => s.initials === i));

  for (const [f, t] of staffOps) console.log(`${DRY_RUN ? "[dry] " : ""}rename staff ${f} -> ${t}`);
  for (const [f, t] of shiftOps) console.log(`${DRY_RUN ? "[dry] " : ""}rename shift ${f} -> ${t}`);
  for (const i of toCreate) console.log(`${DRY_RUN ? "[dry] " : ""}create staff ${i} (Fee Basis, FTE 0, active)`);
  if (DRY_RUN) return;

  // ---- Apply atomically ----
  await prisma.$transaction(async (tx) => {
    for (const [from, to] of staffOps) {
      // Only the initials change. A name equal to the old initials (seed default) follows.
      const s = await tx.staff.findUniqueOrThrow({ where: { initials: from } });
      await tx.staff.update({
        where: { id: s.id },
        data: { initials: to, ...(s.name === from ? { name: to } : {}) },
      });
    }
    for (const [from, to] of shiftOps) {
      await tx.shiftType.update({ where: { code: from }, data: { code: to } });
    }
    let order = (await tx.staff.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    for (const initials of toCreate) {
      await tx.staff.create({
        data: {
          initials,
          name: initials,
          employmentTypeId: feeBasis.id,
          ftePercentage: 0,
          isActive: true,
          sortOrder: ++order,
        },
      });
    }
  });
  console.log("Roster bridge applied.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
