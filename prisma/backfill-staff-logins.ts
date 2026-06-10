// One-time, idempotent backfill: give every active staff member a disabled shell login.
//
// Foundation step for eager login provisioning (docs/staff-users-linking-plan.md).
// Safe to re-run — staff already backing a login are skipped. Creates nothing on a
// system that's already fully provisioned. New staff created after this run get their
// shell automatically (slice 2), so this script is only for existing staff.
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { planStaffLoginShells } from "../src/lib/staff-login-backfill.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const staffGroup = await prisma.group.findUnique({ where: { name: "Staff" }, select: { id: true } });
  if (!staffGroup) {
    // Every user must belong to a group — without the Staff group there's nowhere to put
    // the shells, so refuse rather than create orphaned logins.
    throw new Error('No "Staff" group found — run the seed before backfilling staff logins.');
  }

  const [staff, linked] = await Promise.all([
    prisma.staff.findMany({ where: { isActive: true }, select: { id: true, name: true, isActive: true } }),
    prisma.user.findMany({ where: { staffId: { not: null } }, select: { staffId: true } }),
  ]);

  const linkedStaffIds = new Set(linked.map((u) => u.staffId!));
  const shells = planStaffLoginShells(staff, linkedStaffIds, staffGroup.id);

  let created = 0;
  for (const shell of shells) {
    try {
      await prisma.user.create({ data: { ...shell, role: "viewer" } });
      created++;
    } catch (e) {
      // Unique staffId/email collision (e.g. a concurrent run) — safe to skip.
      console.warn(`Skipped shell for staff ${shell.staffId}: ${(e as Error).message}`);
    }
  }

  console.log(
    `Backfill complete: ${staff.length} active staff, ${linkedStaffIds.size} already linked, ${created} shell login(s) created.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
