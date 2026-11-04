/**
 * seed-restore-settings-2026-11b.ts — second batch of restored Settings/Staff data, from David's answers
 * of 2026-11-04 (follow-up to seed-restore-settings-2026-11.ts). DATA only, entered as the Settings and
 * Staff pages would:
 *  - FTE: CC 0.6, SC 0.45, SH 0.8 (estimated from Aug–Dec hours; David agreed)
 *  - KZ: also available on Tuesdays (Mon/Tue/Wed)
 *  - per-staff targets (pre-loss handoffs 202/208, 739, 079, 9922251): RM ORC min 1 / max 1 per 2 pay
 *    periods; AR PAIN min 2 per pay period; AR ORC min 1 per 2 pay periods; YA ADM min 1 / max 1 per
 *    pay period. Created only when that staff member has no target for that shift.
 *  - ADM auto-schedulable ON: pre-loss YA's ADM target was met by the engine, which only places a
 *    target's shift when that shift is auto-schedulable. ADM has no schedule priority, so this lets
 *    targets/followers place it without making it a general fill shift. Every target's shift is then
 *    checked to be auto-schedulable (Codex #116).
 *  - auto-schedule OFF for the Fee Basis staff AD, MF, LS (JM already off)
 *  - CB = "Care and Bereavement": the same as SL in every setting, and eligible for the same staff and
 *    employment-type defaults as SL.
 * One transaction; DRY_RUN=1 rolls back; idempotent.
 * Run on the VM from ~/YoSched:  DRY_RUN=1 npx tsx prisma/seed-restore-settings-2026-11b.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DRY_RUN = process.env.DRY_RUN === "1";
class Rollback extends Error {}

const FTE: Record<string, number> = { CC: 0.6, SC: 0.45, SH: 0.8 };
const ADD_DAY = { initials: "KZ", day: 2 }; // Tuesday
const TARGETS = [
  { initials: "RM", code: "ORC", minCount: 1, maxCount: 1, window: "pay_period", windowCount: 2 },
  { initials: "AR", code: "PAIN", minCount: 2, maxCount: null, window: "pay_period", windowCount: 1 },
  { initials: "AR", code: "ORC", minCount: 1, maxCount: null, window: "pay_period", windowCount: 2 },
  { initials: "YA", code: "ADM", minCount: 1, maxCount: 1, window: "pay_period", windowCount: 1 },
];
const AUTO_OFF = ["AD", "MF", "LS"];
const AUTO_SCHEDULABLE_ON = ["ADM"];
const CB = { code: "CB", name: "Care and Bereavement", sameAs: "SL" };
// Fields that identify a shift type rather than describe its behaviour; everything else is copied.
const NOT_COPIED = new Set(["id", "code", "name", "hotkey", "sortOrder", "createdAt", "updatedAt"]);

async function run(tx: Prisma.TransactionClient, log: (s: string) => void) {
  const staffBy = async (ini: string) => { const s = await tx.staff.findUnique({ where: { initials: ini }, include: { availabilityRules: true, eligibleShifts: true } }); if (!s) throw new Error(`staff ${ini} not found`); return s; };
  const shiftBy = async (code: string) => { const s = await tx.shiftType.findUnique({ where: { code } }); if (!s) throw new Error(`shift type ${code} not found`); return s; };

  for (const [ini, fte] of Object.entries(FTE)) {
    const s = await staffBy(ini);
    if (s.ftePercentage !== fte) { await tx.staff.update({ where: { id: s.id }, data: { ftePercentage: fte } }); log(`staff ${ini}: FTE ${s.ftePercentage} → ${fte}`); }
  }

  {
    const s = await staffBy(ADD_DAY.initials);
    const has = s.availabilityRules.some((r) => r.type === "available" && r.whenKind === "every" && r.whenDays.includes(ADD_DAY.day) && !r.conditionStaffId);
    if (!has) {
      await tx.availabilityRule.create({ data: { staffId: s.id, type: "available", strength: "rule", whenKind: "every", whenDays: [ADD_DAY.day] } });
      log(`staff ${ADD_DAY.initials}: now also available on Tuesdays`);
    }
  }

  for (const code of AUTO_SCHEDULABLE_ON) {
    const sh = await shiftBy(code);
    if (sh.schedulePriority != null || sh.isFillShift) throw new Error(`${code} has a schedule priority or is a fill shift; turning on auto-schedule would make the engine place it broadly`);
    if (!sh.autoSchedulable) { await tx.shiftType.update({ where: { id: sh.id }, data: { autoSchedulable: true } }); log(`shift ${code}: autoSchedulable false → true (targets only; no schedule priority)`); }
  }

  for (const t of TARGETS) {
    const s = await staffBy(t.initials);
    const sh = await shiftBy(t.code);
    if (!s.eligibleShifts.some((e) => e.shiftTypeId === sh.id)) throw new Error(`${t.initials} is not eligible for ${t.code}`);
    if (await tx.shiftMinimumTarget.count({ where: { staffId: s.id, shiftTypeId: sh.id } })) { log(`target ${t.initials} ${t.code}: already set, left alone`); continue; }
    await tx.shiftMinimumTarget.create({ data: { staffId: s.id, shiftTypeId: sh.id, minCount: t.minCount, maxCount: t.maxCount, window: t.window, windowCount: t.windowCount } });
    log(`target ${t.initials} ${t.code}: min ${t.minCount}${t.maxCount != null ? ` / max ${t.maxCount}` : ""} per ${t.windowCount > 1 ? `${t.windowCount} pay periods` : "pay period"}`);
  }
  // The engine ignores a target whose shift is not auto-schedulable: refuse to leave one unfillable.
  for (const t of TARGETS) {
    const sh = await shiftBy(t.code);
    if (!sh.autoSchedulable) throw new Error(`target ${t.initials} ${t.code} could never be met: ${t.code} is not auto-schedulable`);
  }

  for (const ini of AUTO_OFF) {
    const s = await staffBy(ini);
    if (s.isAutoScheduled) { await tx.staff.update({ where: { id: s.id }, data: { isAutoScheduled: false } }); log(`staff ${ini}: auto-schedule off`); }
  }

  {
    const cb = await shiftBy(CB.code), sl = await shiftBy(CB.sameAs);
    const data: Record<string, unknown> = {};
    const notes: string[] = [];
    if (cb.name !== CB.name) { data.name = CB.name; notes.push(`name "${cb.name}" → "${CB.name}"`); }
    for (const [k, v] of Object.entries(sl)) {
      if (NOT_COPIED.has(k)) continue;
      const cur = (cb as Record<string, unknown>)[k];
      if (cur !== v) { data[k] = v; notes.push(`${k} ${cur} → ${v}`); }
    }
    if (notes.length) { await tx.shiftType.update({ where: { id: cb.id }, data }); log(`shift CB: ${notes.join(", ")}`); }
    const slStaff = await tx.staffEligibleShift.findMany({ where: { shiftTypeId: sl.id } });
    const e1 = await tx.staffEligibleShift.createMany({ data: slStaff.map((r) => ({ staffId: r.staffId, shiftTypeId: cb.id })), skipDuplicates: true });
    const slDefaults = await tx.employmentTypeDefaultShift.findMany({ where: { shiftTypeId: sl.id } });
    const e2 = await tx.employmentTypeDefaultShift.createMany({ data: slDefaults.map((r) => ({ employmentTypeId: r.employmentTypeId, shiftTypeId: cb.id })), skipDuplicates: true });
    if (e1.count || e2.count) log(`shift CB eligibility: +${e1.count} staff (of ${slStaff.length} with SL), +${e2.count} employment-type defaults (of ${slDefaults.length})`);
  }
}

async function main() {
  console.log(DRY_RUN ? "*** DRY RUN — the transaction is rolled back at the end ***" : "*** LIVE RUN ***");
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx, (s) => console.log("  " + s));
      if (DRY_RUN) throw new Rollback();
    }, { timeout: 60_000, maxWait: 10_000 });
    console.log("COMMITTED");
  } catch (e) {
    if (e instanceof Rollback) console.log("DRY RUN complete — rolled back, nothing written");
    else throw e;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error("FAILED — rolled back, nothing written:", e instanceof Error ? e.message : e); return prisma.$disconnect().then(() => process.exit(1)); });
