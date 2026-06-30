// One-time, idempotent backfill: grant the "manual:view" permission to the default
// level-1-and-up system groups (Admin, Super User, Scheduler).
//
// Why this exists: a group's effective permissions come from the array stored on its
// DB row, not from the catalog. When a brand-new permission is added to the catalog,
// existing groups don't have it until their stored arrays are updated — and the
// Admin / Super User groups are locked, so they can't be fixed through the Groups
// editor. This script does exactly that one change and nothing else, so it's safe to
// run against a populated production database (unlike re-running the full seed).
//
// Staff (level 0) is intentionally excluded — the manual defaults to level 1 and up.
// Custom unlocked groups can add the permission themselves via the Groups editor.
// Safe to re-run: a group that already has the permission is skipped.
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const PERMISSION = "manual:view";
const TARGET_GROUPS = ["Admin", "Super User", "Scheduler"];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const groups = await prisma.group.findMany({
    where: { name: { in: TARGET_GROUPS } },
    select: { id: true, name: true, permissions: true },
  });

  let updated = 0;
  let skipped = 0;
  for (const g of groups) {
    if (g.permissions.includes(PERMISSION)) {
      skipped++;
      continue;
    }
    await prisma.group.update({
      where: { id: g.id },
      data: { permissions: { set: [...g.permissions, PERMISSION] } },
    });
    updated++;
    console.log(`Added "${PERMISSION}" to group "${g.name}".`);
  }

  const missing = TARGET_GROUPS.filter((n) => !groups.some((g) => g.name === n));
  if (missing.length) {
    console.warn(`Note: target group(s) not found (skipped): ${missing.join(", ")}.`);
  }

  console.log(
    `Backfill complete: ${updated} group(s) updated, ${skipped} already had "${PERMISSION}".`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
