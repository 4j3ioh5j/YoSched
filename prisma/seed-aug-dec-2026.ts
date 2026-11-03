/**
 * seed-aug-dec-2026.ts — load David's Aug–Dec 2026 schedule (prisma/data/aug-dec-2026.json, from
 * parse-2026-aug-dec-xlsx.mjs) plus the roster and settings data it needs. Decisions are David's
 * (2026-11-03). Everything is DATA, entered the way the Settings / Staff pages would, so nothing
 * department-specific is hard-coded in the app:
 *
 *   1. Shift type LY "Time Off Award": a copy of AL's settings (leave, paid, hours, FTE flags), and
 *      eligible for every staff member and employment-type default that has AL.
 *   2. New staff RMc and BR: created like POST /api/staff does (name = initials, FTE type, FTE 1.0,
 *      the type's default availability), eligible for the shifts their schedule shows.
 *   3. JM split: the 2022 JM (ICU, Jan–May 2022) and the current JM (CARD, Sep 2025 on) share one
 *      record. A new inactive record JMo takes every JM shift before 2023; JM stays the current
 *      person, made active and Fee Basis (with that type's FTE % and auto-schedule defaults).
 *   4. The Aug 1 – Dec 31 2026 cells: created with source="imported"; a cell that already holds the
 *      same shift is left alone; an imported cell with a different shift is updated. ANY other
 *      existing cell in the range (manual/auto/request) aborts the whole run — never clobbered.
 *
 * All of it runs in ONE transaction: any check that fails rolls everything back. DRY_RUN=1 runs the
 * same transaction and rolls it back at the end, so its counts are the real ones. Idempotent: a second
 * run changes nothing. Never deletes.
 *
 * Run on the VM from ~/YoSched:  DRY_RUN=1 npx tsx prisma/seed-aug-dec-2026.ts   (then without DRY_RUN)
 */
import "dotenv/config";
import { readFileSync } from "fs";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DRY_RUN = process.env.DRY_RUN === "1";
const FROM = "2026-08-01";
const TO = "2026-12-31";
const CELLS: { date: string; initials: string; code: string; col: string }[] =
  JSON.parse(readFileSync(new URL("./data/aug-dec-2026.json", import.meta.url), "utf8"));

const LY = { code: "LY", name: "Time Off Award", copyOf: "AL", color: "#2dd4bf" };
const NEW_STAFF: { initials: string; shifts: string[] }[] = [
  { initials: "RMc", shifts: ["OR", "ORL", "ORC", "ADM", "CALL", "HOL", "X"] },
  { initials: "BR", shifts: ["OR", "ORL", "ORC", "ADM", "UCLA", "ICU", "HOL", "X"] },
];
const JM_SPLIT = { current: "JM", former: "JMo", formerBefore: "2023-01-01", currentFrom: "2025-09-01", currentType: "Fee Basis" };

const d = (s: string) => new Date(s + "T00:00:00Z");
class Rollback extends Error {}

async function run(tx: Prisma.TransactionClient, log: (s: string) => void) {
  // ---- scope guard on the data file ----
  for (const c of CELLS) if (c.date < FROM || c.date > TO) throw new Error(`out-of-range cell ${c.date} ${c.initials}`);
  const seen = new Set<string>();
  for (const c of CELLS) { const k = `${c.initials}|${c.date}`; if (seen.has(k)) throw new Error(`duplicate cell ${k}`); seen.add(k); }

  const types = await tx.employmentType.findMany();
  const fte = types.find((t) => t.name === "FTE");
  const feeBasis = types.find((t) => t.name === JM_SPLIT.currentType);
  if (!fte || !feeBasis) throw new Error("employment types FTE / Fee Basis not found");

  // ---- 1. LY shift type ----
  let ly = await tx.shiftType.findUnique({ where: { code: LY.code } });
  const al = await tx.shiftType.findUnique({ where: { code: LY.copyOf } });
  if (!al) throw new Error(`${LY.copyOf} shift type not found`);
  if (!ly) {
    // Copy AL's settings field by field; LY differs only in code, name and colour.
    const { id: _id, createdAt: _c, updatedAt: _u, code: _code, name: _name, color: _color, hotkey: _hotkey, ...settings } = al;
    ly = await tx.shiftType.create({ data: { ...settings, code: LY.code, name: LY.name, color: LY.color, hotkey: null } });
    log(`created shift type ${LY.code} "${LY.name}" (settings copied from ${LY.copyOf})`);
  } else if (!ly.isLeave) {
    throw new Error(`existing ${LY.code} shift type is not a leave type; refusing to change it`);
  } else log(`shift type ${LY.code} already exists`);
  const alStaff = await tx.staffEligibleShift.findMany({ where: { shiftTypeId: al.id } });
  const e1 = await tx.staffEligibleShift.createMany({ data: alStaff.map((r) => ({ staffId: r.staffId, shiftTypeId: ly!.id })), skipDuplicates: true });
  const alDefaults = await tx.employmentTypeDefaultShift.findMany({ where: { shiftTypeId: al.id } });
  const e2 = await tx.employmentTypeDefaultShift.createMany({ data: alDefaults.map((r) => ({ employmentTypeId: r.employmentTypeId, shiftTypeId: ly!.id })), skipDuplicates: true });
  log(`LY eligibility: +${e1.count} staff (of ${alStaff.length} with AL), +${e2.count} employment-type defaults (of ${alDefaults.length})`);

  const shiftIds = new Map((await tx.shiftType.findMany()).map((s) => [s.code, s.id]));

  // ---- 2. new staff ----
  const fteAvailability = await tx.employmentTypeDefaultAvailability.findMany({ where: { employmentTypeId: fte.id } });
  for (const ns of NEW_STAFF) {
    if (await tx.staff.findUnique({ where: { initials: ns.initials } })) { log(`staff ${ns.initials} already exists`); continue; }
    const ids = ns.shifts.map((c) => { const id = shiftIds.get(c); if (!id) throw new Error(`shift ${c} not found`); return id; });
    const max = await tx.staff.aggregate({ _max: { sortOrder: true } });
    const s = await tx.staff.create({
      data: {
        name: ns.initials, initials: ns.initials, employmentTypeId: fte.id, ftePercentage: 1.0,
        isActive: true, isAutoScheduled: fte.defaultIsAutoScheduled, sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
    await tx.staffEligibleShift.createMany({ data: ids.map((shiftTypeId) => ({ staffId: s.id, shiftTypeId })) });
    if (fteAvailability.length) {
      await tx.availabilityRule.createMany({
        data: fteAvailability.map((da) => ({
          staffId: s.id, type: da.type, strength: da.strength, whenKind: da.whenKind, whenDays: da.whenDays,
          whenPpWeek: da.whenPpWeek, whenOrds: da.whenOrds, whenCycleUnit: da.whenCycleUnit,
          whenCycleN: da.whenCycleN, whenCycleOffset: da.whenCycleOffset,
        })),
      });
    }
    log(`created staff ${ns.initials} (FTE 1.0, ${ids.length} eligible shifts: ${ns.shifts.join(",")}, ${fteAvailability.length} default availability rules)`);
  }

  // ---- 3. JM split ----
  const jm = await tx.staff.findUnique({ where: { initials: JM_SPLIT.current } });
  if (!jm) throw new Error("JM not found");
  const middle = await tx.assignment.count({ where: { staffId: jm.id, date: { gte: d(JM_SPLIT.formerBefore), lt: d(JM_SPLIT.currentFrom) } } });
  if (middle) throw new Error(`JM has ${middle} shifts between ${JM_SPLIT.formerBefore} and ${JM_SPLIT.currentFrom}; cannot tell the two JMs apart`);
  let jmo = await tx.staff.findUnique({ where: { initials: JM_SPLIT.former } });
  if (!jmo) {
    const max = await tx.staff.aggregate({ _max: { sortOrder: true } });
    jmo = await tx.staff.create({
      data: { name: JM_SPLIT.former, initials: JM_SPLIT.former, employmentTypeId: jm.employmentTypeId, ftePercentage: jm.ftePercentage,
        isActive: false, isAutoScheduled: false, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    log(`created staff ${JM_SPLIT.former} (inactive)`);
  } else if (jmo.isActive) throw new Error(`${JM_SPLIT.former} exists and is active; refusing`);
  const moved = await tx.assignment.updateMany({ where: { staffId: jm.id, date: { lt: d(JM_SPLIT.formerBefore) } }, data: { staffId: jmo.id } });
  log(`moved ${moved.count} pre-${JM_SPLIT.formerBefore.slice(0, 4)} JM shifts to ${JM_SPLIT.former}`);
  if (!jm.isActive || jm.employmentTypeId !== feeBasis.id) {
    await tx.staff.update({
      where: { id: jm.id },
      data: { isActive: true, employmentTypeId: feeBasis.id, ftePercentage: feeBasis.defaultFtePercentage, isAutoScheduled: feeBasis.defaultIsAutoScheduled },
    });
    log(`JM: active, ${feeBasis.name} (FTE ${feeBasis.defaultFtePercentage}, auto-schedule ${feeBasis.defaultIsAutoScheduled ? "on" : "off"})`);
  } else log("JM already active Fee Basis");

  // ---- 4. Aug–Dec cells ----
  const staffIds = new Map((await tx.staff.findMany()).map((s) => [s.initials, s.id]));
  const codeById = new Map([...shiftIds].map(([c, id]) => [id, c]));
  const missing = new Set<string>();
  for (const c of CELLS) { if (!staffIds.has(c.initials)) missing.add(`staff ${c.initials}`); if (!shiftIds.has(c.code)) missing.add(`shift ${c.code}`); }
  if (missing.size) throw new Error(`not in DB: ${[...missing].join(", ")}`);

  const existing = await tx.assignment.findMany({ where: { date: { gte: d(FROM), lte: d(TO) } } });
  const byKey = new Map(existing.map((a) => [`${a.staffId}|${a.date.toISOString().slice(0, 10)}`, a]));
  const clashes: string[] = [];
  const toCreate: Prisma.AssignmentCreateManyInput[] = [];
  const toUpdate: { id: string; shiftTypeId: string; note: string }[] = [];
  let unchanged = 0;
  for (const c of CELLS) {
    const staffId = staffIds.get(c.initials)!, shiftTypeId = shiftIds.get(c.code)!;
    const ex = byKey.get(`${staffId}|${c.date}`);
    if (!ex) { toCreate.push({ staffId, date: d(c.date), shiftTypeId, source: "imported" }); continue; }
    if (ex.shiftTypeId === shiftTypeId) { unchanged++; continue; }
    if (ex.source !== "imported") { clashes.push(`${c.date} ${c.initials}: DB has ${codeById.get(ex.shiftTypeId)} (${ex.source}), file has ${c.code}`); continue; }
    toUpdate.push({ id: ex.id, shiftTypeId, note: `${c.date} ${c.initials} ${codeById.get(ex.shiftTypeId)} -> ${c.code}` });
  }
  if (clashes.length) throw new Error(`existing non-imported cells differ from the file (nothing written):\n  ${clashes.join("\n  ")}`);
  const created = await tx.assignment.createMany({ data: toCreate });
  for (const u of toUpdate) { await tx.assignment.update({ where: { id: u.id }, data: { shiftTypeId: u.shiftTypeId, source: "imported" } }); log(`update ${u.note}`); }
  const extra = existing.length - unchanged - toUpdate.length;
  log(`cells: created ${created.count}, updated ${toUpdate.length}, unchanged ${unchanged} (file ${CELLS.length}); ${extra} other existing cells in range left as they are`);

  // ---- verify: the range now matches the file exactly for every file cell ----
  const after = await tx.assignment.findMany({ where: { date: { gte: d(FROM), lte: d(TO) } }, include: { staff: true, shiftType: true } });
  const afterKey = new Map(after.map((a) => [`${a.staff.initials}|${a.date.toISOString().slice(0, 10)}`, a.shiftType.code]));
  const bad = CELLS.filter((c) => afterKey.get(`${c.initials}|${c.date}`) !== c.code);
  if (bad.length) throw new Error(`verify failed for ${bad.length} cells, e.g. ${JSON.stringify(bad[0])}`);
  const perMonth: Record<string, number> = {};
  for (const a of after) { const m = a.date.toISOString().slice(0, 7); perMonth[m] = (perMonth[m] ?? 0) + 1; }
  log(`verified: every file cell matches; cells per month now ${JSON.stringify(perMonth)}`);
}

async function main() {
  console.log(DRY_RUN ? "*** DRY RUN — the transaction is rolled back at the end ***" : "*** LIVE RUN ***");
  const lines: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx, (s) => { lines.push(s); console.log("  " + s); });
      if (DRY_RUN) throw new Rollback();
    }, { timeout: 120_000, maxWait: 10_000 });
    console.log("COMMITTED");
  } catch (e) {
    if (e instanceof Rollback) console.log("DRY RUN complete — rolled back, nothing written");
    else throw e;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error("FAILED — rolled back, nothing written:", e instanceof Error ? e.message : e); return prisma.$disconnect().then(() => process.exit(1)); });
