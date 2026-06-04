/**
 * seed-icu-backfill.ts — Restore ICU assignments dropped by the historical
 * imports. The source schedules (xlsx 2022-2025 + PDF 2026 Jan-Jul) record the
 * ICU duty in a dedicated "ICU" column; the importers only captured ICU when it
 * appeared in a provider's main-grid cell, so any day a provider covered ICU
 * without a main-grid column (DB, GL, ADh) — or only in the summary column — was
 * lost. Each pair below is the EXACT person named in that printed ICU column.
 *
 * Scope: the 65 cases we are certain of — the slot is either empty or holds an
 * auto-scheduler "X" (off). The 12 cases that collide with an imported real
 * shift (a separate column-shift import bug) are intentionally EXCLUDED here and
 * handled under manual review.
 *
 * Safety: idempotent. Inserts into empty days; replaces ONLY an off-shift ("X")
 * placeholder (regardless of source); SKIPS + WARNS on any real shift (auto-
 * scheduled or otherwise) rather than overwriting. Set DRY_RUN=1 to preview.
 *
 * Run on the VM (DB is localhost-only): pnpm tsx prisma/seed-icu-backfill.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.env.DRY_RUN === "1";

// [date, provider initials] — exact person from the printed ICU column.
const ICU_BACKFILL: [string, string][] = [
  ["2024-08-12", "ADh"],
  ["2025-02-28", "DB"],
  ["2025-02-28", "SHi"],
  ["2026-01-10", "SR"],
  ["2026-01-11", "SR"],
  ["2026-01-17", "DB"],
  ["2026-01-18", "DB"],
  ["2026-01-19", "DB"],
  ["2026-01-20", "ADh"],
  ["2026-01-21", "ADh"],
  ["2026-01-22", "ADh"],
  ["2026-01-23", "ADh"],
  ["2026-01-24", "GL"],
  ["2026-01-25", "GL"],
  ["2026-01-26", "GL"],
  ["2026-01-30", "LM"],
  ["2026-02-20", "GL"],
  ["2026-02-21", "GL"],
  ["2026-02-22", "GL"],
  ["2026-02-23", "GL"],
  ["2026-03-01", "LM"],
  ["2026-03-20", "DB"],
  ["2026-03-21", "DB"],
  ["2026-03-22", "DB"],
  ["2026-03-28", "DB"],
  ["2026-03-29", "DB"],
  ["2026-03-30", "GL"],
  ["2026-03-31", "GL"],
  ["2026-04-04", "LM"],
  ["2026-04-05", "LM"],
  ["2026-04-12", "ADh"],
  ["2026-04-18", "DB"],
  ["2026-04-19", "DB"],
  ["2026-04-20", "ADh"],
  ["2026-04-21", "ADh"],
  ["2026-04-22", "ADh"],
  ["2026-04-24", "ADh"],
  ["2026-04-25", "DB"],
  ["2026-04-26", "DB"],
  ["2026-04-27", "DB"],
  ["2026-05-16", "DB"],
  ["2026-05-17", "DB"],
  ["2026-05-18", "DB"],
  ["2026-05-22", "DB"],
  ["2026-05-23", "DB"],
  ["2026-05-24", "DB"],
  ["2026-05-25", "DB"],
  ["2026-06-06", "DB"],
  ["2026-06-07", "DB"],
  ["2026-06-08", "DB"],
  ["2026-06-15", "ADh"],
  ["2026-06-16", "ADh"],
  ["2026-06-17", "ADh"],
  ["2026-06-18", "ADh"],
  ["2026-06-19", "GL"],
  ["2026-06-20", "GL"],
  ["2026-06-21", "GL"],
  ["2026-07-11", "GL"],
  ["2026-07-12", "GL"],
  ["2026-07-17", "DB"],
  ["2026-07-18", "DB"],
  ["2026-07-19", "DB"],
  ["2026-07-20", "DB"],
  ["2026-07-25", "GL"],
  ["2026-07-26", "SS"],
];

async function main() {
  if (DRY_RUN) console.log("*** DRY RUN — no writes ***");

  const providerMap = new Map<string, string>();
  for (const p of await prisma.provider.findMany()) providerMap.set(p.initials, p.id);

  const icu = await prisma.shiftType.findFirst({ where: { code: "ICU" } });
  if (!icu) throw new Error("ICU shift type not found");

  const codeById = new Map<string, string>();
  const offShiftIds = new Set<string>();
  for (const s of await prisma.shiftType.findMany()) {
    codeById.set(s.id, s.code);
    if (s.isOffShift) offShiftIds.add(s.id);
  }

  let inserted = 0, replacedX = 0, already = 0, skipped = 0;

  for (const [dateStr, initials] of ICU_BACKFILL) {
    const providerId = providerMap.get(initials);
    if (!providerId) { console.warn(`SKIP ${dateStr} ${initials}: provider not found`); skipped++; continue; }
    const date = new Date(dateStr + "T00:00:00Z");

    const existing = await prisma.assignment.findFirst({ where: { providerId, date } });

    if (!existing) {
      if (!DRY_RUN) await prisma.assignment.create({ data: { providerId, date, shiftTypeId: icu.id, source: "imported" } });
      console.log(`INSERT  ${dateStr} ${initials} -> ICU`);
      inserted++;
    } else if (existing.shiftTypeId === icu.id) {
      console.log(`already ${dateStr} ${initials} = ICU (skip)`);
      already++;
    } else if (offShiftIds.has(existing.shiftTypeId)) {
      // Only ever replace an OFF-shift ("X") placeholder — never a real shift,
      // auto-scheduled or otherwise.
      const was = codeById.get(existing.shiftTypeId) ?? "?";
      if (!DRY_RUN) await prisma.assignment.update({ where: { id: existing.id }, data: { shiftTypeId: icu.id, source: "imported" } });
      console.log(`REPLACE ${dateStr} ${initials} ${was}(off,source=${existing.source}) -> ICU`);
      replacedX++;
    } else {
      const was = codeById.get(existing.shiftTypeId) ?? "?";
      console.warn(`SKIP    ${dateStr} ${initials}: unexpected existing real shift ${was} (source=${existing.source}) — left for review`);
      skipped++;
    }
  }

  console.log(`\nInserted ${inserted}, replaced auto-X ${replacedX}, already ICU ${already}, skipped ${skipped} (of ${ICU_BACKFILL.length})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
