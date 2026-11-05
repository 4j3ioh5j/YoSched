/**
 * seed-restore-settings-2026-11.ts — put back Settings values lost with the database (2026-11-01).
 * The values were recovered from the pre-loss handoffs, manual and git history, and David approved
 * them on 2026-11-03 (report: recovered-settings-2026-11-03.md). This is DATA only: every row is what
 * the Settings / Staff pages would write, so nothing department-specific is hard-coded in the app.
 *
 * Shift types
 *  - auto-schedulable ON: CALL OR ORC ORL X PAIN (ICU, CARD, RS stay off)
 *  - counts toward FTE ON for the leave types AL SL HOL PPL AA ILD JD CB LY (decided 2026-05-20)
 *  - hotkeys as decided 2026-05-28, except ILD, which shared "L" with ORL (left without one)
 *  - max one per day: ORC ORL CALL CARD ICU PAIN
 *  - HOL holiday hours 8; ICU weekend hours 8 and holiday hours 10; PRE weekday hours 10
 * Rules
 *  - follow rules: ORC → only an off shift; CALL → off, CALL or ADM; ORL → never ORL
 *  - required followers: ORC → X each day; CALL → ADM once per run (neither counts toward targets)
 *  - staffing rules: ORC minimum 1 on holidays (with max 1/day = exactly 1); ICU minimum 1 every day
 *  - department pay-period preference: ORL 2 per pay period per 1.0 FTE (soft)
 * Calendar
 *  - pay-period anchor 2026-01-11 (14 days); holidays 2021–2027 (the app's federal list)
 * Groups: Staff loses "View Statistics" (David, 2026-06-10)
 * Staff: FTE SR 0.8, CL 0.6, KZ 0.4, RM 0.3, AR 0.3, SS 0.2; RM and AR available Mon–Wed only.
 *
 * Only rows that differ are touched; settings David has already set in the app are left alone where a
 * row exists (follow rules / followers / department target are created only when none exist for that
 * shift). One transaction; DRY_RUN=1 rolls back. Idempotent.
 * Run on the VM from ~/YoSched:  DRY_RUN=1 npx tsx prisma/seed-restore-settings-2026-11.ts
 */
import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { getFederalHolidays } from "../src/lib/federal-holidays";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const DRY_RUN = process.env.DRY_RUN === "1";
class Rollback extends Error {}

const AUTO_ON = ["CALL", "OR", "ORC", "ORL", "X", "PAIN"];
const FTE_COUNTING_LEAVE = ["AL", "SL", "HOL", "PPL", "AA", "ILD", "JD", "CB", "LY"];
const HOTKEYS: Record<string, string> = {
  ORC: "C", ORL: "L", CALL: "W", AL: "A", SL: "S", X: "X", ADM: "D", CARD: "H", ICU: "I",
  JD: "J", PRE: "P", QA: "Q", PAIN: "N", UCLA: "U", RS: "R", CITC: "T",
};
const MAX_ONE_PER_DAY = ["ORC", "ORL", "CALL", "CARD", "ICU", "PAIN"];
const HOURS: Record<string, Partial<Record<"defaultHours" | "defaultHoursWeekend" | "defaultHoursHoliday", number>>> = {
  HOL: { defaultHoursHoliday: 8 },
  ICU: { defaultHoursWeekend: 8, defaultHoursHoliday: 10 },
  PRE: { defaultHours: 10 },
};
const FOLLOW_RULES: { source: string; mode: "allow" | "block"; allowOff: boolean; codes: string[] }[] = [
  { source: "ORC", mode: "allow", allowOff: true, codes: [] },
  { source: "CALL", mode: "allow", allowOff: true, codes: ["CALL", "ADM"] },
  { source: "ORL", mode: "block", allowOff: false, codes: ["ORL"] },
];
const FOLLOWERS = [
  { source: "ORC", follower: "X", scope: "each_day" },
  { source: "CALL", follower: "ADM", scope: "each_run" },
];
const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6", "holiday"];
const MINIMUMS: { code: string; dayKey: string; min: number }[] = [
  { code: "ORC", dayKey: "holiday", min: 1 },
  ...DAY_KEYS.map((dayKey) => ({ code: "ICU", dayKey, min: 1 })),
];
const DEPT_TARGET = { code: "ORL", minCount: 2, window: "pay_period", windowCount: 1, strength: "preference", perFte: true };
const ANCHOR = "2026-01-11";
const HOLIDAY_YEARS = [2021, 2022, 2023, 2024, 2025, 2026, 2027];
const STAFF_GROUP = { name: "Staff", remove: "statistics:view" };
const FTE: Record<string, number> = { SR: 0.8, CL: 0.6, KZ: 0.4, RM: 0.3, AR: 0.3, SS: 0.2 };
const MON_WED_ONLY = ["RM", "AR"];

const d = (s: string) => new Date(s + "T00:00:00Z");

async function run(tx: Prisma.TransactionClient, log: (s: string) => void) {
  const types = await tx.shiftType.findMany();
  const st = new Map(types.map((t) => [t.code, t]));
  const need = (code: string) => { const t = st.get(code); if (!t) throw new Error(`shift type ${code} not found`); return t; };

  // ---- shift types ----
  for (const t of types) {
    const data: Prisma.ShiftTypeUpdateInput = {};
    const notes: string[] = [];
    const set = <K extends keyof typeof t>(k: K, v: (typeof t)[K]) => { if (t[k] !== v) { (data as Record<string, unknown>)[k as string] = v; notes.push(`${String(k)} ${t[k]} → ${v}`); } };
    if (AUTO_ON.includes(t.code)) set("autoSchedulable", true);
    if (FTE_COUNTING_LEAVE.includes(t.code)) set("countsTowardFte", true);
    if (t.code in HOTKEYS) set("hotkey", HOTKEYS[t.code]);
    for (const [k, v] of Object.entries(HOURS[t.code] ?? {})) set(k as "defaultHours", v);
    if (notes.length) { await tx.shiftType.update({ where: { id: t.id }, data }); log(`shift ${t.code}: ${notes.join(", ")}`); }
  }
  for (const c of [...AUTO_ON, ...FTE_COUNTING_LEAVE, ...Object.keys(HOTKEYS), ...MAX_ONE_PER_DAY, ...Object.keys(HOURS)]) need(c);
  const keyOwners = new Map<string, string[]>();
  for (const t of await tx.shiftType.findMany({ where: { hotkey: { not: null } } })) keyOwners.set(t.hotkey!, [...(keyOwners.get(t.hotkey!) ?? []), t.code]);
  for (const [k, codes] of keyOwners) if (codes.length > 1) log(`NOTE hotkey ${k} is shared by ${codes.join(", ")}`);

  // ---- follow rules (only where none exist for that shift) ----
  for (const r of FOLLOW_RULES) {
    const src = need(r.source);
    if (await tx.shiftFollowRule.count({ where: { sourceShiftId: src.id } })) { log(`follow rule ${r.source}: already set, left alone`); continue; }
    const rows = [
      ...(r.allowOff ? [{ sourceShiftId: src.id, allowedShiftId: null, allowOffShifts: true, mode: r.mode }] : []),
      ...r.codes.map((c) => ({ sourceShiftId: src.id, allowedShiftId: need(c).id, allowOffShifts: false, mode: r.mode })),
    ];
    await tx.shiftFollowRule.createMany({ data: rows });
    log(`follow rule ${r.source}: ${r.mode} ${[r.allowOff ? "off shifts" : "", ...r.codes].filter(Boolean).join(", ")}`);
  }
  for (const f of FOLLOWERS) {
    const src = need(f.source);
    if (await tx.requiredFollower.findUnique({ where: { sourceShiftId: src.id } })) { log(`required follower ${f.source}: already set, left alone`); continue; }
    await tx.requiredFollower.create({ data: { sourceShiftId: src.id, followerShiftId: need(f.follower).id, scope: f.scope, countsTowardTargets: false } });
    log(`required follower ${f.source} → ${f.follower} (${f.scope})`);
  }

  // ---- staffing rules ----
  // At most one of these per day (Staffing Rules "Max", every day key incl. holidays;
  // formerly shift_types.maxPerDay).
  for (const code of MAX_ONE_PER_DAY) {
    for (const dayKey of ["0", "1", "2", "3", "4", "5", "6", "holiday"]) {
      const ex = await tx.staffingRequirement.findUnique({ where: { shiftCode_dayKey: { shiftCode: code, dayKey } } });
      if (ex?.maxCount === 1) continue;
      if (ex) await tx.staffingRequirement.update({ where: { id: ex.id }, data: { maxCount: 1 } });
      else await tx.staffingRequirement.create({ data: { shiftCode: code, dayKey, minCount: 0, maxCount: 1 } });
      log(`staffing max ${code} day ${dayKey}: ${ex?.maxCount ?? "none"} → 1`);
    }
  }
  for (const m of MINIMUMS) {
    need(m.code);
    const ex = await tx.staffingRequirement.findUnique({ where: { shiftCode_dayKey: { shiftCode: m.code, dayKey: m.dayKey } } });
    if (ex?.minCount === m.min) continue;
    if (ex) await tx.staffingRequirement.update({ where: { id: ex.id }, data: { minCount: m.min } });
    else await tx.staffingRequirement.create({ data: { shiftCode: m.code, dayKey: m.dayKey, minCount: m.min } });
    log(`staffing minimum ${m.code} day ${m.dayKey}: ${ex?.minCount ?? "none"} → ${m.min}`);
  }
  {
    const s = need(DEPT_TARGET.code);
    if (await tx.departmentShiftTarget.count({ where: { shiftTypeId: s.id } })) log(`department target ${DEPT_TARGET.code}: already set, left alone`);
    else {
      const { code: _c, ...rest } = DEPT_TARGET;
      await tx.departmentShiftTarget.create({ data: { ...rest, shiftTypeId: s.id } });
      log(`department target ${DEPT_TARGET.code}: min ${DEPT_TARGET.minCount} per pay period per 1.0 FTE (soft)`);
    }
  }

  // ---- calendar ----
  const prefs = await tx.schedulingPreferences.findMany();
  if (prefs.length !== 1) throw new Error(`expected 1 scheduling preferences row, found ${prefs.length}`);
  const p = prefs[0];
  if (!p.payPeriodAnchor) {
    const stored = await tx.payPeriod.findMany({ orderBy: { startDate: "asc" } });
    const len = p.payPeriodLengthDays;
    const off = stored.filter((pp) => ((pp.startDate.getTime() - d(ANCHOR).getTime()) / 864e5) % len !== 0);
    if (off.length) throw new Error(`${off.length} stored pay periods are not on the ${ANCHOR} ${len}-day ladder`);
    await tx.schedulingPreferences.update({ where: { id: p.id }, data: { payPeriodAnchor: d(ANCHOR) } });
    log(`pay-period anchor: none → ${ANCHOR} (${stored.length} stored periods all on the same ladder)`);
  } else log(`pay-period anchor already ${p.payPeriodAnchor.toISOString().slice(0, 10)}, left alone`);
  const hol = HOLIDAY_YEARS.flatMap((y) => getFederalHolidays(y));
  const h = await tx.holiday.createMany({ data: hol.map((x) => ({ date: d(x.date), name: x.name })), skipDuplicates: true });
  log(`holidays ${HOLIDAY_YEARS[0]}–${HOLIDAY_YEARS.at(-1)}: +${h.count} (of ${hol.length}; existing dates kept)`);

  // ---- groups ----
  const g = await tx.group.findUnique({ where: { name: STAFF_GROUP.name } });
  if (!g) throw new Error(`group ${STAFF_GROUP.name} not found`);
  if (g.permissions.includes(STAFF_GROUP.remove)) {
    await tx.group.update({ where: { id: g.id }, data: { permissions: g.permissions.filter((x) => x !== STAFF_GROUP.remove) } });
    log(`group ${STAFF_GROUP.name}: removed ${STAFF_GROUP.remove}`);
  }

  // ---- staff ----
  for (const [ini, fte] of Object.entries(FTE)) {
    const s = await tx.staff.findUnique({ where: { initials: ini } });
    if (!s) throw new Error(`staff ${ini} not found`);
    if (s.ftePercentage !== fte) { await tx.staff.update({ where: { id: s.id }, data: { ftePercentage: fte } }); log(`staff ${ini}: FTE ${s.ftePercentage} → ${fte}`); }
  }
  for (const ini of MON_WED_ONLY) {
    const s = await tx.staff.findUnique({ where: { initials: ini }, include: { availabilityRules: true } });
    if (!s) throw new Error(`staff ${ini} not found`);
    // Only the plain weekday rules the FTE default creates; anything else on the record is left alone.
    const thuFri = s.availabilityRules.filter((r) => r.type === "available" && r.whenKind === "every" && r.whenDays.length === 1 && (r.whenDays[0] === 4 || r.whenDays[0] === 5) && !r.conditionStaffId);
    if (thuFri.length) { await tx.availabilityRule.deleteMany({ where: { id: { in: thuFri.map((r) => r.id) } } }); log(`staff ${ini}: removed Thu/Fri availability (${thuFri.length} rules) → Mon–Wed`); }
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
