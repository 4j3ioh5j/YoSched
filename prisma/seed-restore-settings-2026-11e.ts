/**
 * seed-restore-settings-2026-11e.ts — Auto-Generation Priority for David's department, agreed 2026-11-05
 * with the human scheduler ("never under pay-period hours; over occasionally OK"):
 *   order   hardLimits, coverage, underHours, requests, overHours, fairness
 *   policy  underHours = prohibited, overHours = discouraged
 * Needs migration 20261105200000_autogen_hours_policy. Touches only those six autogen_factors rows
 * (sortOrder + hoursPolicy); refuses to run unless exactly those six keys exist.
 * DATA only; one transaction; DRY_RUN=1 rolls back; idempotent.
 * Run on the VM from ~/YoSched:  DRY_RUN=1 npx tsx prisma/seed-restore-settings-2026-11e.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DRY_RUN = process.env.DRY_RUN === "1";
class Rollback extends Error {}

const ORDER = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
const POLICY: Record<string, string | null> = { underHours: "prohibited", overHours: "discouraged" };

async function run(tx: Prisma.TransactionClient, log: (s: string) => void) {
  const rows = await tx.autoGenFactor.findMany();
  const keys = rows.map((r) => r.key).sort();
  if (keys.join(",") !== [...ORDER].sort().join(",")) throw new Error(`unexpected autogen_factors keys: ${keys.join(", ")}`);
  for (const r of rows) {
    const sortOrder = ORDER.indexOf(r.key);
    const hoursPolicy = POLICY[r.key] ?? r.hoursPolicy;
    if (r.sortOrder === sortOrder && r.hoursPolicy === hoursPolicy) continue;
    await tx.autoGenFactor.update({ where: { id: r.id }, data: { sortOrder, hoursPolicy } });
    log(`${r.key}: sortOrder ${r.sortOrder} → ${sortOrder}, hoursPolicy ${r.hoursPolicy ?? "(none)"} → ${hoursPolicy ?? "(none)"}`);
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
