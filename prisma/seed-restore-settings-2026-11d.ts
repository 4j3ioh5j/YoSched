/**
 * seed-restore-settings-2026-11d.ts — batch 4 of the Settings restore: SR FTE 1.0, David's decision on
 * 2026-11-04 after batch 3. Two years of worked hours (Nov 2024 – Oct 2026, hours ÷ 2080) give SR
 * 0.94–1.03 including UCLA. Supersedes the "SR stays 0.8" note in batch 3.
 * DATA only; one transaction; DRY_RUN=1 rolls back; idempotent.
 * Run on the VM from ~/YoSched:  DRY_RUN=1 npx tsx prisma/seed-restore-settings-2026-11d.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DRY_RUN = process.env.DRY_RUN === "1";
class Rollback extends Error {}

const FTE: Record<string, number> = { SR: 1.0 };

async function run(tx: Prisma.TransactionClient, log: (s: string) => void) {
  for (const [ini, fte] of Object.entries(FTE)) {
    const s = await tx.staff.findUnique({ where: { initials: ini } });
    if (!s) throw new Error(`staff ${ini} not found`);
    if (s.ftePercentage !== fte) { await tx.staff.update({ where: { id: s.id }, data: { ftePercentage: fte } }); log(`staff ${ini}: FTE ${s.ftePercentage} → ${fte}`); }
  }
}

async function main() {
  console.log(DRY_RUN ? "*** DRY RUN — the transaction is rolled back at the end ***" : "*** LIVE RUN ***");
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx, (s) => console.log("  " + s));
      if (DRY_RUN) throw new Rollback();
    }, { timeout: 30_000, maxWait: 10_000 });
    console.log("COMMITTED");
  } catch (e) {
    if (e instanceof Rollback) console.log("DRY RUN complete — rolled back, nothing written");
    else throw e;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error("FAILED — rolled back, nothing written:", e instanceof Error ? e.message : e); return prisma.$disconnect().then(() => process.exit(1)); });
