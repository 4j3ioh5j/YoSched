/**
 * seed-historical-import.ts — load the 2022–2025 historical schedules into the DB.
 *
 * Static data lives in `prisma/data/historical-2022-2025.json` (a flat list of
 * {date, initials, code}, already mapped + deduped — see handoff #108 and the
 * generator `prisma/data/parse-historical-xlsx.mjs`). This loader is intentionally
 * dumb: ensure the one new shift type (CB) and the 13 new staff exist, then
 * bulk-insert the assignments.
 *
 * Idempotent for its date range: it clears existing assignments in [min,max] first.
 * Run ON the staging VM (DB is localhost-only):
 *   ssh <staging> "cd ~/YoSched && npx tsx prisma/seed-historical-import.ts"
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { findUnmappedTargets, type ImportRow } from "../src/lib/historical-import.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// New staff to ensure exist (handoff #108). active+autoScheduled => in equity pool.
const NEW_PROVIDERS: { initials: string; isActive: boolean }[] = [
  // active ICU staff — in equity pool
  { initials: "ADh", isActive: true },
  { initials: "DB", isActive: true },
  { initials: "GL", isActive: true },
  // departed — inactive, imported as-is (excluded from /equity by the engine)
  { initials: "STs", isActive: false },
  { initials: "JCS", isActive: false },
  { initials: "HZ", isActive: false },
  { initials: "JM", isActive: false },
  { initials: "SP", isActive: false },
  { initials: "VS", isActive: false },
  { initials: "AG", isActive: false },
  { initials: "CO", isActive: false },
  { initials: "MS", isActive: false },
  { initials: "SHi", isActive: false },
];

async function main() {
  // ---- Load the static data ----
  const data: ImportRow[] = JSON.parse(
    readFileSync(join(__dirname, "data", "historical-2022-2025.json"), "utf8"),
  );
  if (data.length === 0) throw new Error("historical data file is empty");

  // ---- PRE-FLIGHT (read-only): verify everything resolves BEFORE any writes ----
  // This guarantees we never create CB / new staff and then bomb out on a
  // missing remap target (e.g. PRE), which would leave partial setup rows.
  const sl = await prisma.shiftType.findUnique({ where: { code: "SL" } });
  if (!sl) throw new Error("SL shift type not found — cannot clone CB");
  const fte = await prisma.employmentType.findUnique({ where: { id: "empl_fte" } });
  if (!fte) throw new Error("employment type 'empl_fte' not found");

  const existingShiftTypes = await prisma.shiftType.findMany();
  const existingStaff = await prisma.staff.findMany();
  const unmapped = findUnmappedTargets(
    data,
    existingShiftTypes.map((s) => s.code),
    existingStaff.map((p) => p.initials),
    ["CB"], // the one shift type this seed creates
    NEW_PROVIDERS.map((p) => p.initials), // the staff this seed creates
  );
  if (unmapped.codes.length || unmapped.initials.length) {
    throw new Error(
      "Pre-flight failed — the target database is missing remap targets, no rows written. " +
        `Missing shift codes: [${unmapped.codes.join(", ")}]; ` +
        `missing staff initials: [${unmapped.initials.join(", ")}]`,
    );
  }

  const minDate = data.reduce((m, a) => (a.date < m ? a.date : m), data[0].date);
  const maxDate = data.reduce((m, a) => (a.date > m ? a.date : m), data[0].date);
  const maxShiftOrder = (await prisma.shiftType.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  const maxProvOrder0 = (await prisma.staff.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;

  // ---- ATOMIC: all mutations in one transaction; any failure rolls back fully ----
  const { created } = await prisma.$transaction(
    async (tx) => {
      // 1) Ensure CB exists as an exact clone of SL (handoff #108).
      await tx.shiftType.upsert({
        where: { code: "CB" },
        update: {}, // never clobber an existing CB
        create: {
          name: "CB",
          code: "CB",
          defaultHours: sl.defaultHours,
          countsTowardFte: sl.countsTowardFte,
          countsOnWeekend: sl.countsOnWeekend,
          isLeave: sl.isLeave,
          isPaid: sl.isPaid,
          category: sl.category,
          color: sl.color,
          sortOrder: maxShiftOrder + 1,
          isOffShift: sl.isOffShift,
          isFillShift: sl.isFillShift,
          autoSchedulable: sl.autoSchedulable,
        },
      });

      // 2) Ensure the 13 new staff exist (FTE, 1.0, all auto-scheduled).
      let order = maxProvOrder0;
      for (const np of NEW_PROVIDERS) {
        await tx.staff.upsert({
          where: { initials: np.initials },
          update: {}, // never clobber an existing record's flags
          create: {
            name: np.initials,
            initials: np.initials,
            employmentTypeId: "empl_fte",
            ftePercentage: 1.0,
            isActive: np.isActive,
            isAutoScheduled: true,
            sortOrder: ++order,
          },
        });
      }

      // 3) Build lookup maps from the now-complete set.
      const staffMap = new Map((await tx.staff.findMany()).map((p) => [p.initials, p.id]));
      const shiftMap = new Map((await tx.shiftType.findMany()).map((s) => [s.code, s.id]));

      // 4) Resolve rows (pre-flight already guarantees these all resolve).
      const rows = data.map((a) => ({
        staffId: staffMap.get(a.initials)!,
        date: new Date(a.date + "T00:00:00Z"),
        shiftTypeId: shiftMap.get(a.code)!,
        source: "imported",
      }));

      // 5) Clear the imported range, then bulk-insert in chunks.
      const deleted = await tx.assignment.deleteMany({
        where: { date: { gte: new Date(minDate + "T00:00:00Z"), lte: new Date(maxDate + "T00:00:00Z") } },
      });
      console.log(`Cleared ${deleted.count} existing assignments in ${minDate}..${maxDate}`);

      const CHUNK = 1000;
      let n = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await tx.assignment.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
        n += res.count;
      }
      return { created: n };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  // ---- Summary ----
  const byYear: Record<string, number> = {};
  for (const a of data) byYear[a.date.slice(0, 4)] = (byYear[a.date.slice(0, 4)] || 0) + 1;
  console.log(`Inserted ${created} of ${data.length} assignments.`);
  console.log("By year:", byYear);
  console.log(`New shift type: CB. New staff: ${NEW_PROVIDERS.map((p) => p.initials).join(", ")}`);
}

main()
  .then(() => {
    console.log("Historical import complete");
    return prisma.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
