/**
 * seed-icu-shift-repair.ts — Fix the 11 ICU days lost to the Jan-Jul 2026
 * column-shift import bug. On these days the printed schedule shows the person's
 * OWN cell = ICU, but the (mis-shifted) import stored the neighbouring column's
 * shift instead. This sets each to ICU — the exact person printed.
 *
 * These OVERWRITE a real (mis-imported) shift, so each row carries the EXACT
 * value we expect to find. The repair only replaces when the current value
 * still matches that expected misimport; otherwise it SKIPS + WARNS. Idempotent
 * (already-ICU is skipped). Set DRY_RUN=1 to preview.
 *
 * NOTE: this fixes ICU only. The same column shift also misplaced the *other*
 * shifts on these rows (e.g. STa/AH are missing the value that leaked onto
 * SS/SH); that is the separate full re-import, not this script.
 *
 * Run on the VM: pnpm tsx prisma/seed-icu-shift-repair.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.env.DRY_RUN === "1";

// [date, staff, expected current (misimported) code] -> set to ICU
const REPAIR: [string, string, string][] = [
  ["2026-03-19", "SH", "ADM"],
  ["2026-04-16", "SS", "OR"],
  ["2026-04-17", "SS", "QA"],
  ["2026-06-02", "SS", "ORL"],
  ["2026-06-10", "LM", "ORC"],
  ["2026-06-23", "SS", "QA"],
  ["2026-06-26", "SS", "OR"],
  ["2026-06-27", "SS", "CALL"],
  ["2026-06-28", "SS", "CALL"],
  ["2026-07-21", "SS", "OR"],
  ["2026-07-23", "SS", "SL"],
];

async function main() {
  if (DRY_RUN) console.log("*** DRY RUN — no writes ***");

  const staffMap = new Map<string, string>();
  for (const p of await prisma.staff.findMany()) staffMap.set(p.initials, p.id);

  const icu = await prisma.shiftType.findFirst({ where: { code: "ICU" } });
  if (!icu) throw new Error("ICU shift type not found");
  const codeById = new Map<string, string>();
  for (const s of await prisma.shiftType.findMany()) codeById.set(s.id, s.code);

  let repaired = 0, already = 0, skipped = 0;

  for (const [dateStr, initials, expected] of REPAIR) {
    const staffId = staffMap.get(initials);
    if (!staffId) { console.warn(`SKIP ${dateStr} ${initials}: staff not found`); skipped++; continue; }
    const date = new Date(dateStr + "T00:00:00Z");
    const existing = await prisma.assignment.findFirst({ where: { staffId, date } });
    const curCode = existing ? (codeById.get(existing.shiftTypeId) ?? "?") : null;

    if (curCode === "ICU") {
      console.log(`already ${dateStr} ${initials} = ICU (skip)`);
      already++;
    } else if (existing && curCode === expected) {
      if (!DRY_RUN) await prisma.assignment.update({ where: { id: existing.id }, data: { shiftTypeId: icu.id, source: "imported" } });
      console.log(`REPAIR  ${dateStr} ${initials} ${expected} -> ICU`);
      repaired++;
    } else {
      console.warn(`SKIP    ${dateStr} ${initials}: expected ${expected}, found ${curCode ?? "none"} (source=${existing?.source ?? "-"}) — left for review`);
      skipped++;
    }
  }

  console.log(`\nRepaired ${repaired}, already ICU ${already}, skipped ${skipped} (of ${REPAIR.length})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
