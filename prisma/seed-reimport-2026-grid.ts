/**
 * seed-reimport-2026-grid.ts — Phase 1 of the 2026 column-shift re-import.
 * Sets each Jan-Jul 2026 main-grid staff cell to the value from the printed
 * PDF (prisma/data/grid-2026-jan-jul.json, produced by parse-2026-pdf-grid.mjs
 * with monotonic column assignment — validated, zero collisions).
 *
 * Rules (all pre-August data is historical and must match the print):
 *  - PRESERVE ICU: if a cell currently holds ICU, never overwrite it (ICU is
 *    governed by the summary column and was already reconciled). The grid JSON
 *    excludes ICU, so we never write it here either.
 *  - Otherwise set the cell to the printed code (overwriting any value — auto,
 *    imported, OR a manual edit; the user wants historical reverted to print).
 *  - Create the cell if missing. Never deletes. Only touches Jan-Jul 2026 and
 *    only the staff columns present in the printed grid (OTHER/CARD = Phase 2).
 *
 * Idempotent. DRY_RUN=1 to preview. Run on the VM: pnpm tsx prisma/seed-reimport-2026-grid.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.env.DRY_RUN === "1";
const GRID: { date: string; initials: string; code: string }[] =
  JSON.parse(readFileSync(new URL("./data/grid-2026-jan-jul.json", import.meta.url), "utf8"));

async function main() {
  if (DRY_RUN) console.log("*** DRY RUN — no writes ***");
  for (const g of GRID) {
    if (g.date < "2026-01-01" || g.date >= "2026-08-01") throw new Error(`out-of-scope date ${g.date}`);
  }

  const staffMap = new Map<string, string>();
  for (const p of await prisma.staff.findMany()) staffMap.set(p.initials, p.id);
  const shiftMap = new Map<string, string>();
  const codeById = new Map<string, string>();
  let icuId = "";
  for (const s of await prisma.shiftType.findMany()) { shiftMap.set(s.code, s.id); codeById.set(s.id, s.code); if (s.code === "ICU") icuId = s.id; }

  let changed = 0, created = 0, preservedICU = 0, unchanged = 0, skipped = 0;
  const changeLog: string[] = [];

  for (const { date: dateStr, initials, code } of GRID) {
    const staffId = staffMap.get(initials);
    const shiftTypeId = shiftMap.get(code);
    if (!staffId) { console.warn(`SKIP ${dateStr} ${initials}: staff not found`); skipped++; continue; }
    if (!shiftTypeId) { console.warn(`SKIP ${dateStr} ${initials} ${code}: shift type not found`); skipped++; continue; }
    const date = new Date(dateStr + "T00:00:00Z");
    const existing = await prisma.assignment.findFirst({ where: { staffId, date } });

    if (existing && existing.shiftTypeId === icuId) { preservedICU++; continue; }      // never clobber ICU
    if (existing && existing.shiftTypeId === shiftTypeId) { unchanged++; continue; }    // already correct

    if (existing) {
      const was = codeById.get(existing.shiftTypeId) ?? "?";
      if (!DRY_RUN) await prisma.assignment.update({ where: { id: existing.id }, data: { shiftTypeId, source: "imported" } });
      changed++;
      if (was !== "X" && code !== "X") changeLog.push(`CHANGE ${dateStr} ${initials} ${was} -> ${code} (src ${existing.source})`);
      else changeLog.push(`change ${dateStr} ${initials} ${was} -> ${code} (src ${existing.source})`);
    } else {
      if (!DRY_RUN) await prisma.assignment.create({ data: { staffId, date, shiftTypeId, source: "imported" } });
      created++;
    }
  }

  // Show the real-shift corrections (the audit-critical ones) in full; summarize X-only flips.
  const realChanges = changeLog.filter(l => l.startsWith("CHANGE"));
  console.log(`\nReal-shift corrections (${realChanges.length}):`);
  for (const l of realChanges) console.log("  " + l);
  console.log(`\nX-only flips: ${changeLog.length - realChanges.length}, created: ${created}`);
  console.log(`\nTotals — changed ${changed}, created ${created}, preserved ICU ${preservedICU}, unchanged ${unchanged}, skipped ${skipped} (of ${GRID.length})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
