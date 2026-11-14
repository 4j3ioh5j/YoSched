import { describe, it, expect } from "vitest";
import { autoSchedule, countedHoursFn, type AutoScheduleInput, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #176 (David, Feb 2027 review): auto-schedule lands everyone on their hours exactly.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-orl", "st-hol"],
  availabilityRules: avail([1, 2, 3, 4, 5]),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true });
const ORC = shift("st-orc", "ORC", { defaultHours: 16, schedulePriority: 20 });
const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 25 });
const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });

// PP Sun 2025-05-11 .. Sat 2025-05-24.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const req = (shiftTypeId: string, code: string, min: number) =>
  ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: min, preferredCount: min, maxCount: null }));

function input(o: Partial<AutoScheduleInput> = {}, prefs: Partial<AutoScheduleInput["schedulingPreferences"]> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [],
    shiftTypes: [OR, OFF, ORC, ORL, HOL],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, ...prefs },
    equityFactors: [], followRules: [],
    ...o,
  });
}

function ppHours(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, who: string): number {
  const h = countedHoursFn(inp);
  const g = new Map<string, string>();
  for (const a of inp.existingAssignments) if (a.staffId === who) g.set(a.date, a.shiftTypeId);
  for (const s of r.suggestions) if (s.staffId === who) g.set(s.date, s.shiftTypeId);
  let t = 0;
  for (const [d, sid] of g) if (d >= PP.startDate && d <= PP.endDate) t += h(who, sid, d);
  return t;
}

describe("a day preference gives way to the hours target, holiday included (card #176)", () => {
  // KZ: 0.4 FTE (32 h), works Mon + Tue, prefers ORC on Tuesdays. Monday W2 is a holiday:
  // KZ is owed HOL (8 h) there, so only ONE Tuesday ORC fits (16 + 8 + 8 = 32).
  // Card #204: the preference is the staff card's visible "eligible · Prefer" rule on Tuesdays
  // (the hidden day-preference table is retired).
  const preferTue = { shiftTypeId: "st-orc", type: "eligible" as const, strength: "preference" as const, ...wEvery(2) };
  const kz = () => staff("kz", "KZ", { ftePercentage: 0.4, availabilityRules: avail([1, 2]), shiftEligibilityRules: [preferTue] });
  const others = () => [staff("p2", "AB"), staff("p3", "CD"), staff("p4", "EF"), staff("p5", "GH"), staff("p6", "IJ")];
  const build = (holidayPolicy?: "entitlement" | "fill" | "none") => input({
    staff: [kz(), ...others()],
    holidays: [{ date: W2[0] }],
    staffingRequirements: [...req("st-orc", "ORC", 1)],
    requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: true }],
  }, holidayPolicy ? { holidayPolicy } : {});

  it("KZ lands on 32, not 40: the second Tuesday ORC goes to someone else", () => {
    const inp = build();
    const r = autoSchedule(inp);
    expect(ppHours(inp, r, "kz")).toBe(32);
    const kzORC = r.suggestions.filter((s) => s.staffId === "kz" && s.shiftTypeId === "st-orc");
    expect(kzORC).toHaveLength(1);
    expect(r.suggestions.find((s) => s.staffId === "kz" && s.date === W2[0])?.shiftTypeId).toBe("st-hol");
    // Coverage is still met every working day (the holiday has no ORC minimum).
    for (const d of [...W1, ...W2].filter((x) => x !== W2[0])) expect(r.suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-orc")).toHaveLength(1);
  });

  it("without a holiday the preference still gets both Tuesdays", () => {
    const inp = { ...build(), holidays: [] };
    const r = autoSchedule(inp);
    expect(r.suggestions.filter((s) => s.staffId === "kz" && s.shiftTypeId === "st-orc").map((s) => s.date)).toEqual([W1[1], W2[1]]);
  });

  it('holiday policy "none": no HOL is owed, so no reservation', () => {
    const inp = build("none");
    const r = autoSchedule(inp);
    expect(r.suggestions.filter((s) => s.staffId === "kz" && s.shiftTypeId === "st-orc").map((s) => s.date)).toEqual([W1[1], W2[1]]);
  });
});

// ── Compound repair trades (card #176) ──
import type { ScheduleAssignment } from "../auto-scheduler";
const manual = (staffId: string, date: string, shiftTypeId: string, code: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code, isLocked: false, source: "manual" });
const ORL_NO_REPEAT = [{ sourceShiftId: "st-orl", allowedShiftId: "st-orl", allowOffShifts: false, mode: "block" }];

function devs(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of inp.staff) out[p.initials] = ppHours(inp, r, p.id) - 80 * p.ftePercentage;
  return out;
}

function bcShape() {
  // Week 1 is an earlier, frozen month. BC and CD worked an ORL there (44 h), so week 2
  // must be 36 h = one ORL + three ORs. Everyone else worked 40 h of OR.
  const ids = ["bc", "cd", "rm", "ya", "dh", "cl"];
  const staffList = ids.map((id) => staff(id, id.toUpperCase()));
  const wk1: ScheduleAssignment[] = [];
  for (const id of ids) W1.forEach((d, i) => wk1.push(i === 0 && (id === "bc" || id === "cd") ? manual(id, d, "st-orl", "ORL") : manual(id, d, "st-or", "OR")));
  return input({
    staff: staffList,
    writableFrom: W2[0],
    existingAssignments: wk1,
    staffingRequirements: [...req("st-or", "OR", 3), ...req("st-orl", "ORL", 1).map((x) => ({ ...x, maxCount: 1 }))],
    followRules: ORL_NO_REPEAT,
  });
}

describe("compound trades clear the ±4s (card #176)", () => {
  it("BC shape: three +4s (an ORL in the frozen week) end as one ±4 — the parity floor", () => {
    const inp = bcShape();
    const r = autoSchedule(inp);
    const d = Object.values(devs(inp, r));
    // Three people end at +4 today (BC, CD, DH). An ORL↔OR swap changes two people's hours
    // by 4 each, so with three "odd" people one must stay odd: the best is one left at ±4.
    expect(d.reduce((a, x) => a + Math.abs(x), 0), JSON.stringify(devs(inp, r))).toBe(4);
    // Coverage and rules hold in week 2: one ORL a day, OR at or above its minimum, no ORL→ORL.
    for (const day of W2) {
      expect(r.suggestions.filter((s) => s.date === day && s.shiftTypeId === "st-orl")).toHaveLength(1);
      expect(r.suggestions.filter((s) => s.date === day && s.shiftTypeId === "st-or").length).toBeGreaterThanOrEqual(3);
    }
    for (const p of inp.staff) for (let i = 1; i < W2.length; i++) {
      const a = r.suggestions.find((s) => s.staffId === p.id && s.date === W2[i - 1])?.shiftTypeId;
      const b = r.suggestions.find((s) => s.staffId === p.id && s.date === W2[i])?.shiftTypeId;
      expect(a === "st-orl" && b === "st-orl", `${p.initials} ORL→ORL`).toBe(false);
    }
    // The frozen week is never written.
    expect(r.suggestions.filter((s) => s.date < W2[0])).toEqual([]);
  });

  it("is deterministic", () => {
    const a = autoSchedule(bcShape()).suggestions.map((s) => `${s.staffId}${s.date}${s.shiftTypeId}`).sort();
    const b = autoSchedule(bcShape()).suggestions.map((s) => `${s.staffId}${s.date}${s.shiftTypeId}`).sort();
    expect(a).toEqual(b);
  });
});

// ── Card #176, plan round 2: the remaining guards ──

/** Exactly one suggestion per cell, none on a frozen date, none over a kept human cell. */
function wellFormed(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>): void {
  const keys = r.suggestions.map((s) => `${s.staffId}:${s.date}`);
  expect(new Set(keys).size, "one suggestion per cell").toBe(keys.length);
  const human = new Set(inp.existingAssignments.filter((a) => a.isLocked || a.source !== "auto").map((a) => `${a.staffId}:${a.date}`));
  for (const k of keys) expect(human.has(k), `overwrote human cell ${k}`).toBe(false);
  if (inp.writableFrom) expect(r.suggestions.filter((s) => s.date < inp.writableFrom!)).toEqual([]);
  expect(r.stats.totalSlotsFilled).toBe(r.suggestions.length);
}
const absSum = (d: Record<string, number>) => Object.values(d).reduce((a, x) => a + Math.abs(x), 0);
const codeAt = (inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, who: string, d: string): string | undefined =>
  r.suggestions.find((s) => s.staffId === who && s.date === d)?.code ?? inp.existingAssignments.find((a) => a.staffId === who && a.date === d)?.code;

/** Week 1 frozen (everyone 40 h of OR, `orlIn` worked one ORL there), week 2 writable. */
function frozenWeekShape(orlIn: string[], ids: string[], orlDays = 5, o: Partial<AutoScheduleInput> = {}, prefs: Partial<AutoScheduleInput["schedulingPreferences"]> = {}) {
  const wk1: ScheduleAssignment[] = [];
  for (const id of ids) W1.forEach((d, i) => wk1.push(i === 0 && orlIn.includes(id) ? manual(id, d, "st-orl", "ORL") : manual(id, d, "st-or", "OR")));
  const orl = req("st-orl", "ORL", 1).map((x) => ({ ...x, maxCount: 1 })).slice(0, orlDays);
  return input({
    staff: ids.map((id) => staff(id, id.toUpperCase())),
    writableFrom: W2[0],
    existingAssignments: wk1,
    staffingRequirements: [...req("st-or", "OR", 3), ...orl],
    followRules: ORL_NO_REPEAT,
    ...o,
  }, prefs);
}

describe("compound trades: shapes (card #176)", () => {
  it("DH/YA shape: two people off by 4, a partner exists → everyone exactly on target", () => {
    // Two +4s and four ORLs to place: 1 + 1 + 2 is reachable, so nobody need stay odd.
    const inp = frozenWeekShape(["dh", "ya"], ["dh", "ya", "g1", "g2", "g3", "g4"], 4);
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    expect(absSum(devs(inp, r)), JSON.stringify(devs(inp, r))).toBe(0);
  });

  it("a lone odd person: no partner, so one ±4 stays and nothing else gets worse", () => {
    // One +4 and four ORLs: some one person must end with an odd ORL count → the parity floor.
    const inp = frozenWeekShape(["rm"], ["rm", "g1", "g2", "g3", "g4", "g5"], 4);
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    expect(absSum(devs(inp, r)), JSON.stringify(devs(inp, r))).toBe(4);
    expect(absSum(devs(inp, r))).toBeLessThanOrEqual(absSum(devs(inp, autoSchedule({ ...inp, skipCompoundRepairForTest: true }))));
  });

  it("an ADD or MOVE destination is a fill day (reconciliation can reclaim it), once per cell", () => {
    // Unpaid weekends that people are available on: the fill counts a Saturday as a day, so
    // everyone lands 8 h short and the repair ADDs a weekday.
    const SAT = "2025-05-17", SUN = "2025-05-18";
    const inp = input({
      dates: [...W1, SAT, SUN, ...W2],
      staff: ["a1", "a2", "a3"].map((id) => staff(id, id.toUpperCase(), { availabilityRules: avail([0, 1, 2, 3, 4, 5, 6]) })),
    });
    const without = devs(inp, autoSchedule({ ...inp, skipCompoundRepairForTest: true }));
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    const added = r.suggestions.filter((s) => s.reason.includes("(hours repair)"));
    expect(added.length, JSON.stringify(without)).toBeGreaterThan(0);
    for (const s of added) expect(s.step, `${s.staffId} ${s.date}`).toBe("fill");
    expect(absSum(devs(inp, r))).toBeLessThan(absSum(without));
  });
});

describe("compound trades never touch protected cells (card #176)", () => {
  it("locked, manual and approved-request cells in the writable week stay as they were", () => {
    const base = bcShape();
    const kept: ScheduleAssignment[] = [
      { staffId: "rm", date: W2[0], shiftTypeId: "st-or", code: "OR", isLocked: true, source: "auto" },
      manual("ya", W2[1], "st-or", "OR"),
      { staffId: "cl", date: W2[2], shiftTypeId: "st-or", code: "OR", isLocked: false, source: "request" },
    ];
    const inp = { ...base, existingAssignments: [...base.existingAssignments, ...kept] };
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    for (const k of kept) expect(r.suggestions.find((s) => s.staffId === k.staffId && s.date === k.date)).toBeUndefined();
  });

  it("a DROP never takes OR below its minimum and an ADD never passes the ORL day Max", () => {
    const inp = bcShape();
    const r = autoSchedule(inp);
    for (const d of W2) {
      expect(r.suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-or").length).toBeGreaterThanOrEqual(3);
      expect(r.suggestions.filter((s) => s.date === d && s.shiftTypeId === "st-orl").length).toBeLessThanOrEqual(1);
    }
  });
});

describe("compound trades keep the end state legal (card #176)", () => {
  it("follow rule 'after ORL only OR': the repair adds no X (cleared day) right after an ORL", () => {
    // (STEP 3/4 can already leave an X after an ORL when someone runs out of hours; that is not
    // the repair's doing, so compare with the same run without the repair.)
    const rules = [{ sourceShiftId: "st-orl", allowedShiftId: "st-or", allowOffShifts: false, mode: "allow" }]; // (also rules out ORL→ORL)
    const inp = { ...bcShape(), followRules: rules };
    const breaks = (res: ReturnType<typeof autoSchedule>) => {
      const out: string[] = [];
      for (const p of inp.staff) for (let i = 0; i + 1 < W2.length; i++)
        if (codeAt(inp, res, p.id, W2[i]) === "ORL" && codeAt(inp, res, p.id, W2[i + 1]) !== "OR") out.push(`${p.initials} ${W2[i + 1]}`);
      return out;
    };
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    const without = breaks(autoSchedule({ ...inp, skipCompoundRepairForTest: true }));
    for (const b of breaks(r)) expect(without, b).toContain(b);
  });

  it("'EF only when BC works': a dropped or moved BC day never leaves EF working alone", () => {
    const base = bcShape();
    const cond = [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, conditionStaffId: "bc", conditionType: "working" as const, ...wEvery(d) }));
    const ef = staff("ef", "EF", { availabilityRules: cond });
    const efWk1 = W1.map((d) => manual("ef", d, "st-or", "OR"));
    const inp = { ...base, staff: [...base.staff, ef], existingAssignments: [...base.existingAssignments, ...efWk1] };
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    const works = (who: string, d: string) => { const c = codeAt(inp, r, who, d); return !!c && c !== "X"; };
    for (const d of W2) if (works("ef", d)) expect(works("bc", d), d).toBe(true);
  });

  it("card #185: the same holds when EF is scheduled by hand (not auto-scheduled)", () => {
    const base = bcShape();
    const cond = [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, conditionStaffId: "bc", conditionType: "working" as const, ...wEvery(d) }));
    const ef = staff("ef", "EF", { availabilityRules: cond, isAutoScheduled: false });
    // EF's whole fortnight is typed in by hand, on the days BC works before the repair.
    const pre = autoSchedule({ ...base, skipCompoundRepairForTest: true });
    const bcWorks = (d: string) => { const c = codeAt(base, pre, "bc", d); return !!c && c !== "X"; };
    const efDays = [...W1, ...W2].filter(bcWorks).map((d) => manual("ef", d, "st-or", "OR"));
    const inp = { ...base, staff: [...base.staff, ef], existingAssignments: [...base.existingAssignments, ...efDays] };
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    const works = (who: string, d: string) => { const c = codeAt(inp, r, who, d); return !!c && c !== "X"; };
    for (const d of [...W1, ...W2]) if (works("ef", d)) expect(works("bc", d), d).toBe(true);
  });

  it("prohibited over-hours: the repair never takes anyone further over target", () => {
    const order = [{ key: "overHours", sortOrder: 0, enabled: true, hoursPolicy: "prohibited" as const }];
    const inp = { ...bcShape(), factorOrder: order };
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    const before = devs(inp, autoSchedule({ ...inp, skipCompoundRepairForTest: true }));
    const after = devs(inp, r);
    for (const k of Object.keys(after)) expect(after[k], k).toBeLessThanOrEqual(Math.max(0, before[k]));
    expect(absSum(after)).toBeLessThanOrEqual(absSum(before));
  });
});

describe("compound trades: hours that aren't 8 (card #176)", () => {
  it("a person whose OR is 10 h by override is judged in 10s: everyone still lands on target", () => {
    const inp = frozenWeekShape(["dh", "ya"], ["dh", "ya", "g1", "g2", "g3", "tt"], 4, {
      staffOverrides: [{ staffId: "tt", shiftTypeId: "st-or", durationHrs: 10 }],
    });
    // TT's frozen week: four 10 h ORs (40 h), so week 2 owes 40 h = four 10 h days or an ORL mix.
    inp.existingAssignments = inp.existingAssignments.filter((a) => !(a.staffId === "tt" && a.date === W1[4]));
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    const d = devs(inp, r);
    expect(d.TT, JSON.stringify(d)).toBe(0);
  });

  it("weekend fill hours (12 h) only count for people who can work the weekend: everyone lands on target", () => {
    // DH can work Saturday (OR = 12 h there); the rest can't. G2 and G3 end at +4 each before the
    // repair: still "odd" for them (8 h days only), so Phase A pairs them through G1.
    const SAT = "2025-05-24";
    const OR12 = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true, defaultHoursWeekend: 12 });
    const base = frozenWeekShape(["dh"], ["dh", "g1", "g2", "g3", "g4", "g5"], 4, { shiftTypes: [OR12, OFF, ORC, ORL, HOL] });
    const inp = { ...base, dates: [...base.dates, SAT], staff: base.staff.map((p) => p.id === "dh" ? { ...p, availabilityRules: avail([1, 2, 3, 4, 5, 6]) } : p) };
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    expect(absSum(devs(inp, r)), JSON.stringify(devs(inp, r))).toBe(0);
  });
});

describe("compound trades: limits (card #176)", () => {
  it("more odd people than the search limit: a valid schedule and a warning", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `p${String(i).padStart(2, "0")}`);
    const inp = frozenWeekShape(ids.slice(0, 14), ids, 5);
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    expect(r.warnings.some((w) => w.startsWith("Hours repair: search limit reached"))).toBe(true);
    for (const day of W2) expect(r.suggestions.filter((s) => s.date === day && s.shiftTypeId === "st-orl")).toHaveLength(1);
  });
});

describe("owed HOL in the paired-shift projections (card #176)", () => {
  it("ORL (paired with OR) and a holiday in the pay period: everyone on target, HOL on the holiday", () => {
    const ids = ["a1", "a2", "a3", "a4", "a5", "a6"];
    // PT: 0.3 FTE = 24 h, 8 of them owed as HOL → only 16 h of room: an ORL pair (24 h) must not fit.
    const pt = staff("pt", "PT", { ftePercentage: 0.3 });
    const inp = input({
      staff: [pt, ...ids.map((id) => staff(id, id.toUpperCase()))],
      // ORL Mon–Thu (8 a pay period, an even count, so 0 is reachable); the holiday is W2 Friday.
      holidays: [{ date: W2[4] }],
      staffingRequirements: [...req("st-or", "OR", 3), ...req("st-orl", "ORL", 1).map((x) => ({ ...x, maxCount: 1 })).slice(0, 4)],
      followRules: ORL_NO_REPEAT,
    }, { holidayPolicy: "entitlement" });
    const r = autoSchedule(inp);
    wellFormed(inp, r);
    for (const id of [...ids, "pt"]) expect(codeAt(inp, r, id, W2[4]), id).toBe("HOL");
    expect(absSum(devs(inp, r)), JSON.stringify(devs(inp, r))).toBe(0);
  });
});

describe("a rejected compound leaves no trace (card #176)", () => {
  it("every candidate fails its end-state check → output identical to the run without the repair", () => {
    // AB is short (unpaid weekends they are available on), and EF works only when AB does NOT.
    // Every ADD onto an AB weekday lands on a day EF works, breaks EF's rule at the end-state
    // check, and is rolled back.
    const SAT = "2025-05-17", SUN = "2025-05-18";
    const notAB = [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, conditionStaffId: "ab", conditionType: "not_working" as const, ...wEvery(d) }));
    const inp = input({
      dates: [...W1, SAT, SUN, ...W2],
      staff: [staff("ab", "AB", { availabilityRules: avail([0, 1, 2, 3, 4, 5, 6]) }), staff("ef", "EF", { availabilityRules: notAB })],
    });
    const r = autoSchedule(inp);
    const without = autoSchedule({ ...inp, skipCompoundRepairForTest: true });
    wellFormed(inp, r);
    expect(devs(inp, r).AB).toBeLessThan(0);
    expect(r.suggestions).toEqual(without.suggestions); // same cells, same fields, same order
    expect(r.stats.byStep).toEqual(without.stats.byStep);
  });
});

describe("under-target Prohibited (the live ranking): Phase A may pass through it, the end state may not", () => {
  // Feb 2027 trial: with under-target Prohibited, every Phase A trade was refused because its
  // intermediary is 8 h under until Phase B gives them a day back; the pay period's END state
  // is what must respect the bounds.
  const live = [
    { key: "hardLimits", sortOrder: 0, enabled: true },
    { key: "coverage", sortOrder: 1, enabled: true },
    { key: "underHours", sortOrder: 2, enabled: true, hoursPolicy: "prohibited" as const },
    { key: "requests", sortOrder: 3, enabled: true },
    { key: "overHours", sortOrder: 4, enabled: true, hoursPolicy: "discouraged" as const },
    { key: "fairness", sortOrder: 5, enabled: true },
  ];
  for (const [name, shape] of [
    ["BC shape", () => bcShape()],
    ["DH/YA shape", () => frozenWeekShape(["dh", "ya"], ["dh", "ya", "g1", "g2", "g3", "g4"], 4)],
    ["weekend shape", () => {
      const OR12 = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true, defaultHoursWeekend: 12 });
      const b = frozenWeekShape(["dh"], ["dh", "g1", "g2", "g3", "g4", "g5"], 4, { shiftTypes: [OR12, OFF, ORC, ORL, HOL] });
      return { ...b, dates: [...b.dates, "2025-05-24"], staff: b.staff.map((p) => p.id === "dh" ? { ...p, availabilityRules: avail([1, 2, 3, 4, 5, 6]) } : p) };
    }],
    ["PP1 shape (the +4s hold no ORL; one person holds both)", () => {
      // ORL only Tue + Thu, so the pairing puts both on one person; BC and CD (+4 from a frozen
      // ORL) hold only ORs. The fix goes through that person: they give both ORLs away (−8),
      // BC and CD each drop an OR, and the intermediary gets a day back.
      const b = frozenWeekShape(["bc", "cd"], ["bc", "cd", "g1", "g2", "g3", "g4"], 0);
      const orl = req("st-orl", "ORL", 1).map((x) => ({ ...x, maxCount: 1 })).filter((x) => x.dayKey === "2" || x.dayKey === "4");
      return { ...b, staffingRequirements: [...b.staffingRequirements, ...orl] };
    }],
  ] as const) {
    it(`${name}: improves, and nobody ends further under than without the repair`, () => {
      const inp = { ...shape(), factorOrder: live };
      const r = autoSchedule(inp);
      wellFormed(inp, r);
      const without = devs(inp, autoSchedule({ ...inp, skipCompoundRepairForTest: true }));
      const after = devs(inp, r);
      expect(absSum(after), JSON.stringify({ after, without })).toBeLessThan(absSum(without));
      for (const k of Object.keys(after)) expect(-after[k], k).toBeLessThanOrEqual(Math.max(0, -without[k]));
    });
  }
});

describe("card #185: a work follower that can't land on a holiday isn't counted against the hours", () => {
  // AB (80 h) has 56 h by hand. Monday W2's ORC (16) + Tuesday's holiday HOL (8) = 80 exactly.
  // ORC's required follower ADM is a work shift, never placed on a holiday, so the ORC fits.
  const ADM = shift("st-adm", "ADM", { autoSchedulable: false, defaultHoursHoliday: 8 });
  const build = () => input({
    shiftTypes: [OR, OFF, ORC, ORL, HOL, ADM],
    staff: [staff("ab", "AB", { eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-hol", "st-adm"] })],
    holidays: [{ date: W2[1] }],
    existingAssignments: [...W1, W2[2], W2[3]].map((d) => ({ staffId: "ab", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false, source: "manual" as const })),
    staffingRequirements: [{ shiftTypeId: "st-orc", shiftCode: "ORC", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 }],
    requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: true }],
    factorOrder: [{ key: "overHours", sortOrder: 0, enabled: true, hoursPolicy: "prohibited" as const }],
  });

  it("AB gets the ORC and the HOL, lands on 80, and no ADM is placed on the holiday", () => {
    const inp = build();
    const r = autoSchedule(inp);
    const at = (d: string) => r.suggestions.find((s) => s.staffId === "ab" && s.date === d)?.code;
    expect(at(W2[0])).toBe("ORC");
    expect(at(W2[1])).toBe("HOL");
    expect(ppHours(inp, r, "ab")).toBe(80);
  });
});

describe("card #185 r2: an off follower on a holiday still leaves the HOL owed", () => {
  // AB (80 h) has 64 h by hand. Tuesday W2 is a holiday (HOL 8 → 72). Monday's ORC (16) would
  // reach 88. Its follower X is an off cell the holiday later turns into HOL, so the HOL stays owed
  // and, with over-hours Prohibited, AB must not get the ORC.
  const build = () => input({
    shiftTypes: [OR, OFF, ORC, ORL, HOL],
    staff: [staff("ab", "AB", { eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-hol"] })],
    holidays: [{ date: W2[1] }],
    existingAssignments: [...W1, W2[2], W2[3], W2[4]].map((d) => ({ staffId: "ab", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false, source: "manual" as const })),
    staffingRequirements: [{ shiftTypeId: "st-orc", shiftCode: "ORC", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 }],
    requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false }],
    factorOrder: [{ key: "overHours", sortOrder: 0, enabled: true, hoursPolicy: "prohibited" as const }],
  });

  it("AB does not get the ORC and ends at 80 at most", () => {
    const inp = build();
    const r = autoSchedule(inp);
    const at = (d: string) => r.suggestions.find((s) => s.staffId === "ab" && s.date === d)?.code;
    expect(at(W2[0])).not.toBe("ORC");
    expect(ppHours(inp, r, "ab")).toBeLessThanOrEqual(80);
  });
});

describe("card #189: a person's count target can be Prefer — only when it fits their hours", () => {
  // AR (24 h) is already full by hand. "At least 1 ORC per pay period". CD has room.
  const build = (strength?: "rule" | "preference") => input({
    staff: [
      staff("ar", "AR", { ftePercentage: 0.3, shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 1, maxCount: null, window: "pay_period", windowDays: null, windowCount: 1, ...(strength ? { strength } : {}) }] }),
      staff("cd", "CD"),
    ],
    existingAssignments: W1.slice(0, 3).map((d) => manual("ar", d, "st-or", "OR")),
    staffingRequirements: [{ shiftTypeId: "st-orc", shiftCode: "ORC", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 }],
  });
  const orcs = (r: ReturnType<typeof autoSchedule>, who: string) => r.suggestions.filter((s) => s.staffId === who && s.shiftTypeId === "st-orc").length;

  it("Hard (and no strength, as before): AR still gets an ORC and ends 16 h over", () => {
    for (const s of ["rule", undefined] as const) {
      const inp = build(s);
      const r = autoSchedule(inp);
      expect(orcs(r, "ar"), String(s)).toBe(1);
      expect(ppHours(inp, r, "ar"), String(s)).toBe(40);
    }
  });

  it("Prefer: AR gets no ORC, stays on 24 h, no warning; the ORCs go to CD", () => {
    const inp = build("preference");
    const r = autoSchedule(inp);
    expect(orcs(r, "ar")).toBe(0);
    expect(ppHours(inp, r, "ar")).toBe(24);
    expect(orcs(r, "cd")).toBe(2);
    expect(r.warnings.filter((w) => w.startsWith("AR:"))).toEqual([]);
  });
});
