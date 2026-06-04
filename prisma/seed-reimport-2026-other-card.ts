/**
 * seed-reimport-2026-other-card.ts — Phase 2 of the 2026 re-import. Applies the
 * OTHER and CARD summary-column assignments (prisma/data/other-card-2026-jan-jul
 * .json, from parse-2026-pdf-other-card.mjs) for Jan-Jul 2026.
 *
 * Rules (user-confirmed): OTHER bare->OR / Name(SHIFT)->SHIFT; CARD single
 * bare->CARD, multi-name bare->OR / Name(SHIFT)->SHIFT; name variants CWr->CW,
 * PNw->PN. PRECEDENCE: a specialty column wins over the provider's main column —
 * so this OVERWRITES the main-grid value — but it NEVER overwrites a real ICU
 * (ICU is the top specialty, already reconciled). Most of these providers have
 * no main-grid column, so they are creates. Never deletes.
 *
 * Also applies ONE ICU-column correction missed by the earlier ICU backfill:
 * 2026-04-24 the ICU cell is "LM:ADh(ADM)" => ADh does ADM (not ICU). Guarded:
 * only flips ADh if it is currently ICU.
 *
 * Idempotent. DRY_RUN=1 to preview. Run on the VM: pnpm tsx prisma/seed-reimport-2026-other-card.ts
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
const ROWS: { date: string; initials: string; code: string; col: string }[] =
  JSON.parse(readFileSync(new URL("./data/other-card-2026-jan-jul.json", import.meta.url), "utf8"));

// ICU-column parenthetical corrections (Name(SHIFT) in the ICU column = that
// shift, not ICU). Only one across the whole PDF.
const ICU_CORRECTIONS = [{ date: "2026-04-24", initials: "ADh", code: "ADM" }];

async function main() {
  if (DRY_RUN) console.log("*** DRY RUN — no writes ***");
  for (const r of ROWS) if (r.date < "2026-01-01" || r.date >= "2026-08-01") throw new Error(`out-of-scope date ${r.date}`);

  const providerMap = new Map<string, string>();
  for (const p of await prisma.provider.findMany()) providerMap.set(p.initials, p.id);
  const shiftMap = new Map<string, string>(); const codeById = new Map<string, string>(); let icuId = "";
  for (const s of await prisma.shiftType.findMany()) { shiftMap.set(s.code, s.id); codeById.set(s.id, s.code); if (s.code === "ICU") icuId = s.id; }

  let created = 0, changed = 0, unchanged = 0, preservedICU = 0, skipped = 0;
  const log: string[] = [];

  for (const { date: dateStr, initials, code, col } of ROWS) {
    const providerId = providerMap.get(initials);
    const shiftTypeId = shiftMap.get(code);
    if (!providerId) { console.warn(`SKIP ${dateStr} ${initials}: provider not found`); skipped++; continue; }
    if (!shiftTypeId) { console.warn(`SKIP ${dateStr} ${initials} ${code}: shift type not found`); skipped++; continue; }
    const date = new Date(dateStr + "T00:00:00Z");
    const existing = await prisma.assignment.findFirst({ where: { providerId, date } });

    if (existing && existing.shiftTypeId === icuId) { preservedICU++; continue; }
    if (existing && existing.shiftTypeId === shiftTypeId) { unchanged++; continue; }
    if (existing) {
      const was = codeById.get(existing.shiftTypeId) ?? "?";
      if (!DRY_RUN) await prisma.assignment.update({ where: { id: existing.id }, data: { shiftTypeId, source: "imported" } });
      changed++; log.push(`CHANGE ${dateStr} ${initials} ${was} -> ${code} [${col}] (src ${existing.source})`);
    } else {
      if (!DRY_RUN) await prisma.assignment.create({ data: { providerId, date, shiftTypeId, source: "imported" } });
      created++;
    }
  }

  // ICU-column corrections — explicitly overwrite a wrong ICU.
  let icuFixed = 0;
  for (const { date: dateStr, initials, code } of ICU_CORRECTIONS) {
    const providerId = providerMap.get(initials); const shiftTypeId = shiftMap.get(code);
    if (!providerId || !shiftTypeId) { console.warn(`SKIP icu-fix ${dateStr} ${initials}`); continue; }
    const date = new Date(dateStr + "T00:00:00Z");
    const existing = await prisma.assignment.findFirst({ where: { providerId, date } });
    if (existing && existing.shiftTypeId === icuId) {
      if (!DRY_RUN) await prisma.assignment.update({ where: { id: existing.id }, data: { shiftTypeId, source: "imported" } });
      icuFixed++; log.push(`ICU-FIX ${dateStr} ${initials} ICU -> ${code}`);
    } else {
      console.warn(`icu-fix ${dateStr} ${initials}: expected ICU, found ${existing ? codeById.get(existing.shiftTypeId) : "none"} — skipped`);
    }
  }

  console.log("\nChanges/overrides (creates not listed):");
  for (const l of log) console.log("  " + l);
  console.log(`\nTotals — created ${created}, changed ${changed}, ICU-fixed ${icuFixed}, preserved ICU ${preservedICU}, unchanged ${unchanged}, skipped ${skipped} (of ${ROWS.length} + ${ICU_CORRECTIONS.length} icu-fix)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
