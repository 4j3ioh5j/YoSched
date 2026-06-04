/**
 * seed-fix-mislocated-icu.ts — Correct 20 false second-ICU cells in Jan-Jul 2026.
 * The column-shift import had placed ICU on the WRONG provider on these days;
 * Phase 1's "preserve ICU" rule then protected that wrong ICU instead of
 * overwriting it with the printed main-grid value. Verified by diffing every
 * >=2-ICU DB day against the printed ICU truth (main-grid ICU cells UNION ICU
 * summary column) from the xlsx + PDF sources — the correct ICU person on each
 * day stays; only the mislocated extra is corrected to its printed shift.
 *
 * Guarded: only flips a cell that is CURRENTLY ICU. Idempotent. DRY_RUN=1 to
 * preview. Run on the VM: pnpm tsx prisma/seed-fix-mislocated-icu.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const DRY_RUN = process.env.DRY_RUN === "1";

// [date, provider currently-wrongly-ICU, printed main-grid code]
const FIX: [string, string, string][] = [
  ["2026-01-10", "SS", "X"],
  ["2026-01-11", "SS", "X"],
  ["2026-01-30", "KO", "X"],
  ["2026-03-01", "RM", "X"],
  ["2026-03-19", "DH", "ORL"],
  ["2026-04-04", "RM", "X"],
  ["2026-04-05", "RM", "X"],
  ["2026-04-16", "SR", "ORC"],
  ["2026-04-17", "SR", "X"],
  ["2026-06-02", "SR", "OR"],
  ["2026-06-06", "LM", "X"],
  ["2026-06-07", "LM", "X"],
  ["2026-06-10", "RM", "X"],
  ["2026-06-23", "SR", "X"],
  ["2026-06-26", "SR", "AL"],
  ["2026-06-27", "SR", "X"],
  ["2026-06-28", "SR", "X"],
  ["2026-07-21", "SR", "ORL"],
  ["2026-07-23", "SR", "UCLA"],
  ["2026-07-26", "SR", "X"],
];

async function main() {
  if (DRY_RUN) console.log("*** DRY RUN — no writes ***");
  const providerMap = new Map<string, string>();
  for (const p of await prisma.provider.findMany()) providerMap.set(p.initials, p.id);
  const shiftMap = new Map<string, string>(); let icuId = "";
  for (const s of await prisma.shiftType.findMany()) { shiftMap.set(s.code, s.id); if (s.code === "ICU") icuId = s.id; }

  let fixed = 0, skipped = 0;
  for (const [dateStr, initials, code] of FIX) {
    const providerId = providerMap.get(initials); const shiftTypeId = shiftMap.get(code);
    if (!providerId || !shiftTypeId) { console.warn(`SKIP ${dateStr} ${initials}: lookup failed`); skipped++; continue; }
    const date = new Date(dateStr + "T00:00:00Z");
    const existing = await prisma.assignment.findFirst({ where: { providerId, date } });
    if (existing && existing.shiftTypeId === icuId) {
      if (!DRY_RUN) await prisma.assignment.update({ where: { id: existing.id }, data: { shiftTypeId, source: "imported" } });
      console.log(`FIX ${dateStr} ${initials} ICU -> ${code}`); fixed++;
    } else {
      console.warn(`SKIP ${dateStr} ${initials}: not currently ICU (found ${existing ? "other" : "none"})`); skipped++;
    }
  }
  console.log(`\nFixed ${fixed}, skipped ${skipped} (of ${FIX.length})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
